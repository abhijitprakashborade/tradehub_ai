"""
Gmail reply detection — matches real INBOX replies to sent outreach emails
using Gmail thread IDs (a reply always keeps the original thread's ID).
"""
import logging
from datetime import datetime
from email.utils import parsedate_to_datetime
from typing import Dict, Optional

from database import SessionLocal
from models import OutreachEmail, EmailReply, Lead, EmailStatus, LeadStatus
from services import gmail_service, job_logger

logger = logging.getLogger(__name__)


def _parse_date(value: str) -> Optional[datetime]:
    if not value:
        return None
    try:
        return parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None


def check_replies(job_id: Optional[int] = None, auto_mark: bool = True) -> Dict:
    """
    Poll Gmail inbox for replies to our sent outreach.
    Creates EmailReply rows and auto-marks the corresponding leads RESPONDED.
    """
    if job_id:
        job_logger.job_step(job_id, "📬 Checking Gmail inbox for replies to sent outreach...")

    if not gmail_service.is_authenticated():
        error = "Gmail not authenticated — connect Gmail first."
        if not gmail_service.credentials_file_exists():
            error += " Gmail credentials file is missing: save it at backend/credentials/gmail_credentials.json."
        if job_id:
            job_logger.job_done(job_id, "failed", error)
        return {"connected": False, "error": error}

    db = SessionLocal()
    try:
        sent = db.query(OutreachEmail).filter(
            OutreachEmail.status == EmailStatus.SENT.value,
            OutreachEmail.gmail_thread_id != None,  # noqa: E711
        ).all()
        if not sent:
            result = {"connected": True, "new_replies": 0, "sent_emails": 0}
            if job_id:
                job_logger.job_done(job_id, "completed", "No sent outreach emails to match replies against yet")
            return result

        sent_by_thread = {em.gmail_thread_id: em for em in sent}

        inbox_messages = gmail_service.fetch_inbox_thread_ids(max_results=100)
        if job_id:
            job_logger.job_step(
                job_id,
                f"Fetched {len(inbox_messages)} inbox messages; matching against {len(sent_by_thread)} sent threads",
            )

        new_replies = 0
        for stub in inbox_messages:
            thread_id = stub.get("thread_id")
            email_row = sent_by_thread.get(thread_id)
            if not email_row:
                continue
            if not stub.get("id") or stub["id"] == email_row.gmail_message_id:
                continue  # the original sent message, not a new reply

            already = db.query(EmailReply).filter(
                EmailReply.gmail_message_id == stub["id"]
            ).first()
            if already:
                continue

            details = gmail_service.get_message_details(stub["id"])
            if not details:
                continue

            reply = EmailReply(
                email_id=email_row.id,
                gmail_message_id=stub["id"],
                gmail_thread_id=thread_id,
                sender=details.get("from", ""),
                subject=details.get("subject", ""),
                snippet=details.get("snippet", ""),
                received_at=_parse_date(details.get("date", "")),
                seen=False,
            )
            db.add(reply)
            new_replies += 1
            if job_id:
                job_logger.job_step(job_id, f"✉️ Reply detected: {reply.sender or 'unknown sender'} — {reply.subject}")

            if auto_mark:
                lead = db.query(Lead).filter(Lead.id == email_row.lead_id).first()
                if lead and lead.status not in (LeadStatus.RESPONDED, LeadStatus.CLOSED):
                    lead.status = LeadStatus.RESPONDED
                    if job_id:
                        job_logger.job_step(job_id, f"🟢 Lead marked RESPONDED: {lead.company_name}")

        db.commit()
        result = {
            "connected": True,
            "new_replies": new_replies,
            "sent_emails": len(sent),
            "inbox_checked": len(inbox_messages),
        }
        if job_id:
            job_logger.job_done(job_id, "completed", f"{new_replies} new replies matched")
        return result

    except Exception as exc:
        logger.exception(f"Reply check failed: {exc}")
        if job_id:
            job_logger.job_done(job_id, "failed", str(exc))
        raise
    finally:
        db.close()
