"""
Gmail API integration using Google OAuth2 (installed-app loopback flow).
Handles: OAuth connect, create drafts, send emails, sent-folder lookups,
duplicate-outreach guard, reply detection helpers, open-tracking pixel.
Uses official Google API client libraries — authorized access only.
"""
import base64
import logging
import os
import secrets
import threading
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Any, Dict, List, Optional

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from config import settings

logger = logging.getLogger(__name__)


class GmailServiceError(Exception):
    pass


def credentials_file_exists() -> bool:
    return os.path.exists(settings.GMAIL_CREDENTIALS_FILE)


# ─── OAuth (loopback flow — Google removed the old copy/paste OOB flow) ─────

_connect_state: Dict[str, Optional[str]] = {"status": "idle", "error": None, "user_email": None}


def get_connect_state() -> Dict[str, Optional[str]]:
    return dict(_connect_state)


_MANUAL_REDIRECT_URI = "http://localhost:8090/"


def get_auth_url() -> str:
    """
    Generate the OAuth2 authorization URL for a manual paste-the-code flow
    (legacy/advanced alternative to /auth/connect). Requires the redirect
    URI "http://localhost:8090/" to be whitelisted on the OAuth client.
    """
    if not credentials_file_exists():
        raise GmailServiceError(
            f"Gmail credentials file not found at: {settings.GMAIL_CREDENTIALS_FILE}\n"
            "Create an OAuth 2.0 Client ID (type: Desktop app) in Google Cloud Console,\n"
            "download the JSON, and save it at that path."
        )
    flow = InstalledAppFlow.from_client_secrets_file(
        settings.GMAIL_CREDENTIALS_FILE,
        scopes=settings.GMAIL_SCOPES,
        redirect_uri=_MANUAL_REDIRECT_URI,
    )
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )
    return auth_url


def exchange_code_for_token(authorization_code: str) -> Credentials:
    """Exchange a manually-obtained authorization code for OAuth2 credentials."""
    if not credentials_file_exists():
        raise GmailServiceError("Gmail credentials file not found.")
    flow = InstalledAppFlow.from_client_secrets_file(
        settings.GMAIL_CREDENTIALS_FILE,
        scopes=settings.GMAIL_SCOPES,
        redirect_uri=_MANUAL_REDIRECT_URI,
    )
    flow.fetch_token(code=authorization_code)
    return flow.credentials


def run_and_save_oauth_flow() -> None:
    """
    Open the browser on the local machine for a loopback OAuth flow
    (redirect to localhost, port auto-assigned), exchange the code and persist
    the credentials. Runs in a worker thread started by the API endpoint.
    """
    _connect_state.update({"status": "awaiting_user", "error": None, "user_email": None})
    try:
        if not credentials_file_exists():
            raise GmailServiceError(
                f"Gmail credentials file not found at: {settings.GMAIL_CREDENTIALS_FILE}\n"
                "Create an OAuth 2.0 Client ID (type: Desktop app) in Google Cloud Console,\n"
                "download the JSON, and save it at that path."
            )
        flow = InstalledAppFlow.from_client_secrets_file(
            settings.GMAIL_CREDENTIALS_FILE,
            scopes=settings.GMAIL_SCOPES,
        )
        # run_local_server opens the browser itself
        credentials = flow.run_local_server(
            access_type="offline",
            include_granted_scopes="true",
            prompt="consent",
            timeout_seconds=300,
        )
        save_credentials(credentials)
        user_email = None
        try:
            user_email = get_authenticated_user_email()
        except Exception:
            pass
        _connect_state.update({"status": "connected", "error": None, "user_email": user_email})
        logger.info(f"Gmail OAuth loopback flow completed for {user_email}")
    except Exception as exc:  # noqa: BLE001 — surfaced to the UI via state polling
        _connect_state.update({"status": "error", "error": str(exc)[:500], "user_email": None})
        logger.error(f"Gmail OAuth flow failed: {exc}")


def start_oauth_connect() -> Dict[str, Any]:
    """Kick off the loopback flow in a background thread (single connection at a time)."""
    if _connect_state["status"] in ("awaiting_user",):
        return {"status": "already_running"}
    thread = threading.Thread(target=run_and_save_oauth_flow, daemon=True)
    thread.start()
    return {"status": "started"}


# ─── Credential persistence ──────────────────────────────────────────────────

def save_credentials(credentials: Credentials) -> None:
    token_dir = os.path.dirname(settings.GMAIL_TOKEN_FILE)
    if token_dir:
        os.makedirs(token_dir, exist_ok=True)
    with open(settings.GMAIL_TOKEN_FILE, "w") as f:
        f.write(credentials.to_json())
    logger.info(f"Gmail credentials saved to {settings.GMAIL_TOKEN_FILE}")


def load_credentials() -> Optional[Credentials]:
    if not os.path.exists(settings.GMAIL_TOKEN_FILE):
        return None
    try:
        credentials = Credentials.from_authorized_user_file(
            settings.GMAIL_TOKEN_FILE, scopes=settings.GMAIL_SCOPES
        )
        if credentials and credentials.expired and credentials.refresh_token:
            credentials.refresh(Request())
            save_credentials(credentials)
        return credentials if credentials and credentials.valid else None
    except Exception as e:
        logger.error(f"Error loading Gmail credentials: {e}")
        return None


def get_gmail_service():
    credentials = load_credentials()
    if not credentials:
        raise GmailServiceError(
            "Gmail not authenticated. Connect Gmail from the Reports page (or POST /api/v1/gmail/auth/connect)."
        )
    return build("gmail", "v1", credentials=credentials)


def get_authenticated_user_email() -> Optional[str]:
    try:
        service = get_gmail_service()
        profile = service.users().getProfile(userId="me").execute()
        return profile.get("emailAddress")
    except Exception as e:
        logger.error(f"Error getting Gmail user email: {e}")
        return None


def is_authenticated() -> bool:
    try:
        creds = load_credentials()
        return creds is not None and creds.valid
    except Exception:
        return False


# ─── MIME building + open-tracking pixel ─────────────────────────────────────

def generate_tracking_token() -> str:
    return secrets.token_urlsafe(24)


def new_tracking_url(token: str) -> str:
    return f"{settings.TRACKING_BASE_URL}/api/v1/track/open/{token}.gif"


def _build_mime_message(
    to: str,
    subject: str,
    body: str,
    sender: Optional[str] = None,
    tracking_token: Optional[str] = None,
) -> str:
    """Build and encode a MIME email. Contains an HTML part; if a tracking
    token is supplied, a 1x1 open-tracking pixel (served by this backend) is
    embedded. Count-only tracking: no personal data is collected."""
    msg = MIMEMultipart("alternative")
    msg["To"] = to
    msg["Subject"] = subject
    if sender:
        msg["From"] = sender

    msg.attach(MIMEText(body, "plain", "utf-8"))

    html_body = body.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    html_body = html_body.replace("\n", "<br>")
    pixel = ""
    if tracking_token:
        pixel = f'<img src="{new_tracking_url(tracking_token)}" width="1" height="1" alt="" style="display:none">'
    html_email = f"""<!DOCTYPE html>
<html><body style="font-family: Arial, sans-serif; font-size: 14px; color: #333; max-width: 600px;">
<div style="line-height: 1.6;">{html_body}</div>{pixel}
</body></html>"""
    msg.attach(MIMEText(html_email, "html", "utf-8"))

    return base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")


# ─── Drafts / sending ────────────────────────────────────────────────────────

def _draft_or_send_failure(exc: Exception, action: str) -> GmailServiceError:
    if isinstance(exc, HttpError):
        return GmailServiceError(f"Gmail API error while {action}: {exc}")
    return GmailServiceError(str(exc))


def create_draft(
    to: str,
    subject: str,
    body: str,
    tracking_token: Optional[str] = None,
) -> Dict[str, Any]:
    """Create a Gmail draft (does NOT change any approval status)."""
    try:
        service = get_gmail_service()
        raw = _build_mime_message(to=to, subject=subject, body=body, tracking_token=tracking_token)
        draft = service.users().drafts().create(userId="me", body={"message": {"raw": raw}}).execute()
        return {
            "draft_id": draft.get("id"),
            "message_id": draft.get("message", {}).get("id"),
            "thread_id": draft.get("message", {}).get("threadId"),
        }
    except GmailServiceError:
        raise
    except Exception as exc:
        raise _draft_or_send_failure(exc, "creating draft")


def send_email(
    to: str,
    subject: str,
    body: str,
    tracking_token: Optional[str] = None,
) -> Dict[str, Any]:
    """Send an email via Gmail API. Only call after explicit user approval.
    Returns message ID and thread ID."""
    try:
        service = get_gmail_service()
        raw = _build_mime_message(to=to, subject=subject, body=body, tracking_token=tracking_token)
        message = service.users().messages().send(userId="me", body={"raw": raw}).execute()
        return {"message_id": message.get("id"), "thread_id": message.get("threadId")}
    except GmailServiceError:
        raise
    except Exception as exc:
        raise _draft_or_send_failure(exc, "sending email")


def send_draft(draft_id: str) -> Dict[str, Any]:
    try:
        service = get_gmail_service()
        message = service.users().drafts().send(userId="me", body={"id": draft_id}).execute()
        return {"message_id": message.get("id"), "thread_id": message.get("threadId")}
    except HttpError as exc:
        raise GmailServiceError(f"Failed to send Gmail draft: {exc}")


# ─── Listing / lookups ───────────────────────────────────────────────────────

def list_recent_sent_emails(max_results: int = 20) -> List[Dict[str, Any]]:
    """Recently sent emails, resolved to {id, thread_id, subject, to, date}."""
    try:
        service = get_gmail_service()
        results = service.users().messages().list(
            userId="me", labelIds=["SENT"], maxResults=max_results
        ).execute()
        messages = []
        for stub in results.get("messages", []):
            try:
                msg = service.users().messages().get(
                    userId="me", id=stub["id"], format="metadata",
                    metadataHeaders=["Subject", "To", "Date"],
                ).execute()
                headers = {h["name"].lower(): h["value"] for h in msg.get("payload", {}).get("headers", [])}
                messages.append({
                    "id": stub["id"],
                    "thread_id": msg.get("threadId"),
                    "subject": headers.get("subject", ""),
                    "to": headers.get("to", ""),
                    "date": headers.get("date", ""),
                })
            except Exception as e:
                logger.debug(f"Metadata fetch failed for {stub['id']}: {e}")
        return messages
    except Exception as e:
        logger.error(f"Error listing sent emails: {e}")
        return []


def check_duplicate_outreach(recipient_email: str) -> bool:
    """
    Check if we've already emailed this address via Gmail (SENT folder).
    Uses labelIds=["SENT"] + to: query — the valid Gmail API way.
    """
    try:
        service = get_gmail_service()
        results = service.users().messages().list(
            userId="me",
            q=f"to:{recipient_email}",
            labelIds=["SENT"],
            maxResults=1,
        ).execute()
        return len(results.get("messages", [])) > 0
    except Exception as e:
        logger.error(f"Error checking duplicate outreach: {e}")
        return False  # Assume not duplicate if the check itself fails


def fetch_inbox_thread_ids(max_results: int = 100) -> List[Dict[str, str]]:
    """Fetch recent INBOX messages (id + threadId) for reply matching."""
    try:
        service = get_gmail_service()
        results = service.users().messages().list(
            userId="me", labelIds=["INBOX"], maxResults=max_results
        ).execute()
        return [
            {"id": m["id"], "thread_id": m.get("threadId", "")}
            for m in results.get("messages", [])
        ]
    except Exception as e:
        logger.error(f"Error listing inbox messages: {e}")
        return []


def get_message_details(message_id: str) -> Optional[Dict[str, Any]]:
    """Fetch metadata (From, Subject, Date) + snippet for one message."""
    try:
        service = get_gmail_service()
        msg = service.users().messages().get(
            userId="me", id=message_id, format="metadata",
            metadataHeaders=["From", "Subject", "Date", "In-Reply-To"],
        ).execute()
        headers = {h["name"].lower(): h["value"] for h in msg.get("payload", {}).get("headers", [])}
        return {
            "id": msg.get("id"),
            "thread_id": msg.get("threadId"),
            "from": headers.get("from", ""),
            "subject": headers.get("subject", ""),
            "date": headers.get("date", ""),
            "snippet": msg.get("snippet", ""),
        }
    except Exception as e:
        logger.error(f"Error fetching message {message_id}: {e}")
        return None
