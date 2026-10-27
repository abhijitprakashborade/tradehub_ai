from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
import logging
from datetime import datetime

from config import settings
from database import get_db
from models import OutreachEmail, Lead, EmailStatus, LeadStatus, EmailReply
from schemas import (
    GmailAuthStatus, GmailAuthRequest, GmailConnectStatus, ReplyResponse,
)
from services import gmail_service, reply_detector

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/gmail", tags=["Gmail"])


@router.get("/auth/status", response_model=GmailAuthStatus)
def gmail_auth_status():
    """Check Gmail auth state; includes precise guidance when not connected."""
    if gmail_service.is_authenticated():
        user_email = gmail_service.get_authenticated_user_email()
        return GmailAuthStatus(authenticated=True, user_email=user_email)

    detail = None
    if not gmail_service.credentials_file_exists():
        detail = (
            f"Gmail credentials file missing. Create an OAuth 2.0 Desktop client in Google Cloud Console "
            f"and save the JSON at {settings.GMAIL_CREDENTIALS_FILE}"
        )
    return GmailAuthStatus(
        authenticated=False,
        user_email=None,
        auth_url=None,
        content_file_missing=not gmail_service.credentials_file_exists(),
        detail=detail,
    )


@router.post("/auth/connect")
def gmail_auth_connect():
    """
    Start the Gmail OAuth loopback flow: opens your browser on this machine,
    you approve access, and the backend catches the redirect automatically.
    Poll GET /gmail/auth/connect/status for progress.
    """
    if not gmail_service.credentials_file_exists():
        raise HTTPException(
            status_code=400,
            detail=(
                f"Gmail credentials file not found at: {settings.GMAIL_CREDENTIALS_FILE}. "
                "Create an OAuth 2.0 Client ID (Desktop app) in Google Cloud Console, enable the Gmail API, "
                "download the credentials JSON and save it at that path."
            ),
        )
    state = gmail_service.start_oauth_connect()
    return {"message": "Connecting Gmail: your browser should open for the Google sign-in/approval.", "state": state}


@router.get("/auth/connect/status", response_model=GmailConnectStatus)
def gmail_auth_connect_status():
    """Poll status of a /auth/connect flow."""
    state = gmail_service.get_connect_state()
    return GmailConnectStatus(
        status=state.get("status", "idle"),
        user_email=state.get("user_email"),
        error=state.get("error"),
    )


@router.post("/auth/callback")
def gmail_auth_callback(request: GmailAuthRequest):
    """Legacy manual callback: exchange a code (kept for advanced users)."""
    try:
        credentials = gmail_service.exchange_code_for_token(request.authorization_code)
        gmail_service.save_credentials(credentials)
        user_email = gmail_service.get_authenticated_user_email()
        return {"message": "Gmail authentication successful", "user_email": user_email}
    except gmail_service.GmailServiceError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Authentication failed: {str(e)}")


@router.post("/auth/revoke")
def revoke_gmail_auth():
    """Revoke Gmail authentication (sign out)."""
    import os

    try:
        if os.path.exists(settings.GMAIL_TOKEN_FILE):
            os.remove(settings.GMAIL_TOKEN_FILE)
        gmail_service._connect_state.update({"status": "idle", "error": None, "user_email": None})
        return {"message": "Gmail authentication revoked"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/sent")
def list_sent_emails_from_gmail():
    """Recently sent emails (real subject/to/date metadata) for tracking."""
    if not gmail_service.is_authenticated():
        raise HTTPException(status_code=401, detail="Gmail not authenticated.")
    messages = gmail_service.list_recent_sent_emails(max_results=20)
    return {"sent_count": len(messages), "messages": messages}


# ─── Replies ──────────────────────────────────────────────────────────────────

@router.get("/replies", response_model=List[ReplyResponse])
def list_replies(db: Session = Depends(get_db)):
    """All detected replies to our outreach emails."""
    replies = (
        db.query(EmailReply)
        .order_by(EmailReply.received_at.desc())
        .limit(50)
        .all()
    )
    return [ReplyResponse.model_validate(r) for r in replies]


@router.post("/replies/check")
def check_replies_now(db: Session = Depends(get_db)):
    """Manually poll Gmail for new replies right now."""
    try:
        result = reply_detector.check_replies()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Reply check failed: {exc}")
    return result


# ─── Drafts / send ────────────────────────────────────────────────────────────

@router.post("/drafts/{email_id}")
def create_gmail_draft(email_id: int, db: Session = Depends(get_db)):
    """Create a Gmail draft from an email (does NOT change approval state)."""
    if not gmail_service.is_authenticated():
        raise HTTPException(status_code=401, detail="Gmail not authenticated. Please connect Gmail first.")

    email = db.query(OutreachEmail).filter(OutreachEmail.id == email_id).first()
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    if not email.recipient_email:
        raise HTTPException(status_code=400, detail="Email has no recipient address")
    if email.status == EmailStatus.SENT:
        raise HTTPException(status_code=400, detail="Email already sent")

    is_duplicate = gmail_service.check_duplicate_outreach(email.recipient_email)
    if is_duplicate:
        email.is_duplicate_check_passed = False
        db.commit()
        raise HTTPException(
            status_code=409,
            detail=f"We've already emailed {email.recipient_email} before. Duplicate outreach blocked.",
        )

    try:
        result = gmail_service.create_draft(
            to=email.recipient_email,
            subject=email.subject,
            body=email.body,
            tracking_token=email.tracking_token,
        )
        email.gmail_draft_id = result["draft_id"]
        email.gmail_message_id = result["message_id"]
        email.gmail_thread_id = result.get("thread_id")
        email.updated_at = datetime.utcnow()
        db.commit()

        return {
            "message": "Draft created in Gmail successfully (approval state unchanged)",
            "draft_id": result["draft_id"],
            "email_id": email_id,
        }
    except gmail_service.GmailServiceError as e:
        email.status = EmailStatus.FAILED
        email.error_message = str(e)
        db.commit()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/send/{email_id}")
def send_gmail_email(email_id: int, db: Session = Depends(get_db)):
    """Send via Gmail. Requires explicit APPROVED status (human in the loop)."""
    if not gmail_service.is_authenticated():
        raise HTTPException(status_code=401, detail="Gmail not authenticated.")

    email = db.query(OutreachEmail).filter(OutreachEmail.id == email_id).first()
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    if email.status == EmailStatus.SENT:
        raise HTTPException(status_code=400, detail="Email already sent")

    # Approval gate: DRAFT/PENDING emails must be approved in the UI first.
    if email.status != EmailStatus.APPROVED:
        raise HTTPException(
            status_code=403,
            detail=(
                f"This email must be APPROVED before sending. "
                f"Open it in the Emails page and click Approve first. Current status: {email.status.value}."
            ),
        )
    if not email.recipient_email:
        raise HTTPException(status_code=400, detail="No recipient email address")

    is_dup = gmail_service.check_duplicate_outreach(email.recipient_email)
    if is_dup:
        raise HTTPException(status_code=409, detail=f"Duplicate outreach detected for {email.recipient_email}")

    if not email.tracking_token:
        email.tracking_token = gmail_service.generate_tracking_token()

    try:
        if email.gmail_draft_id:
            result = gmail_service.send_draft(email.gmail_draft_id)
        else:
            result = gmail_service.send_email(
                to=email.recipient_email,
                subject=email.subject,
                body=email.body,
                tracking_token=email.tracking_token,
            )

        email.status = EmailStatus.SENT
        email.sent_at = datetime.utcnow()
        email.gmail_message_id = result["message_id"]
        email.gmail_thread_id = result.get("thread_id")
        email.updated_at = datetime.utcnow()

        lead = db.query(Lead).filter(Lead.id == email.lead_id).first()
        if lead:
            lead.status = LeadStatus.CONTACTED
            lead.last_contacted_at = datetime.utcnow()

        db.commit()

        return {
            "message": "Email sent successfully via Gmail (reply + open tracking active)",
            "message_id": result["message_id"],
            "email_id": email_id,
            "recipient": email.recipient_email,
        }
    except gmail_service.GmailServiceError as e:
        email.status = EmailStatus.FAILED
        email.error_message = str(e)
        db.commit()
        raise HTTPException(status_code=500, detail=str(e))
