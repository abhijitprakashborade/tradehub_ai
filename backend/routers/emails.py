from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from typing import Optional
import logging
from datetime import datetime

from config import settings
from database import get_db
from models import OutreachEmail, Lead, EmailStatus
from schemas import (
    EmailCreate, EmailUpdate, EmailResponse, EmailListResponse,
    EmailGenerateRequest, BulkGenerateRequest
)
from services import ai_service, gmail_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/emails", tags=["Emails"])


def _coerce_status(value: Optional[str]) -> Optional[EmailStatus]:
    if value is None:
        return None
    try:
        return EmailStatus(value.lower())
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid status filter: '{value}'. Valid: {', '.join(s.value for s in EmailStatus)}",
        )


@router.get("/", response_model=EmailListResponse)
def list_emails(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    status: Optional[str] = None,
    lead_id: Optional[int] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """List all outreach emails with optional filtering."""
    query = db.query(OutreachEmail).options(joinedload(OutreachEmail.lead))

    status_enum = _coerce_status(status)
    if status_enum:
        query = query.filter(OutreachEmail.status == status_enum)
    if lead_id:
        query = query.filter(OutreachEmail.lead_id == lead_id)
    if search:
        search_like = f"%{search.replace('%', '')}%"
        query = query.filter(
            OutreachEmail.subject.ilike(search_like) |
            OutreachEmail.recipient_email.ilike(search_like)
        )

    total = query.count()
    emails = query.order_by(OutreachEmail.created_at.desc()).offset(skip).limit(limit).all()

    return EmailListResponse(total=total, emails=[EmailResponse.model_validate(e) for e in emails])


@router.post("/generate", response_model=EmailResponse, status_code=201)
async def generate_email(
    request: EmailGenerateRequest,
    db: Session = Depends(get_db),
):
    """Use Gemini AI to generate a personalized outreach email for a lead."""
    lead = db.query(Lead).options(joinedload(Lead.event)).filter(Lead.id == request.lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    if not lead.contact_email:
        raise HTTPException(
            status_code=400,
            detail="This lead has no contact email address. Add one (from a verified public source) before generating outreach.",
        )

    # No duplicate-outreach to the same lead silently
    existing_pending = db.query(OutreachEmail).filter(
        OutreachEmail.lead_id == lead.id,
        OutreachEmail.status.in_([EmailStatus.PENDING_REVIEW, EmailStatus.APPROVED, EmailStatus.DRAFT, EmailStatus.SENT]),
    ).first()
    if existing_pending:
        raise HTTPException(
            status_code=409,
            detail=f"This lead already has an outreach email (ID: {existing_pending.id}, status: {existing_pending.status.value}).",
        )

    try:
        generated = await ai_service.generate_outreach_email(
            company_name=lead.company_name,
            contact_name=lead.contact_name,
            contact_designation=lead.contact_designation,
            business_category=lead.business_category,
            company_description=lead.company_description,
            event_name=lead.event.name if lead.event else None,
            sender_name=request.sender_name,
            sender_company=request.sender_company,
            sender_role=request.sender_role,
            custom_notes=request.custom_notes,
            tone=request.tone,
        )
    except Exception as exc:
        from services.scheduler_service import _friendly_error

        logger.error(f"Email generation failed for lead {lead.id}: {exc}")
        message = _friendly_error(f"{type(exc).__name__}: {exc}")[:400]
        raise HTTPException(status_code=502, detail=f"AI generation failed — {message}")

    email = OutreachEmail(
        lead_id=lead.id,
        subject=generated["subject"],
        body=generated["body"],
        recipient_email=lead.contact_email,
        recipient_name=lead.contact_name,
        ai_generated=True,
        ai_model_used=settings.GEMINI_MODEL,
        generation_prompt=f"Sender: {request.sender_name}, {request.sender_role} at {request.sender_company} | tone: {request.tone}",
        status=EmailStatus.PENDING_REVIEW,
        tracking_token=gmail_service.generate_tracking_token(),
    )
    db.add(email)
    db.commit()
    db.refresh(email)

    return EmailResponse.model_validate(email)


@router.post("/bulk/generate", status_code=200)
async def bulk_generate_emails(
    request: BulkGenerateRequest,
    db: Session = Depends(get_db),
):
    """Generate AI emails for multiple leads at once (all land in pending_review)."""
    from services import pipeline

    result = await pipeline.generate_drafts(
        lead_ids=request.lead_ids,
        sender_name=request.sender_name,
        sender_company=request.sender_company,
        sender_role=request.sender_role,
        custom_notes=request.custom_notes,
        tone=request.tone,
        limit=len(request.lead_ids),
    )
    if result["generated"] == 0 and not result["errors"]:
        raise HTTPException(status_code=404, detail="No eligible leads found for draft generation")
    return {
        "generated": result["generated"],
        "errors": result["errors"],
        "message": f"Generated {result['generated']} emails. {len(result['errors'])} errors.",
    }


@router.get("/{email_id}", response_model=EmailResponse)
def get_email(email_id: int, db: Session = Depends(get_db)):
    """Get a single email by ID."""
    email = db.query(OutreachEmail).options(
        joinedload(OutreachEmail.lead)
    ).filter(OutreachEmail.id == email_id).first()
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    return EmailResponse.model_validate(email)


@router.post("/", response_model=EmailResponse, status_code=201)
def create_email(email_data: EmailCreate, db: Session = Depends(get_db)):
    """Manually create an email draft."""
    lead = db.query(Lead).filter(Lead.id == email_data.lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    email = OutreachEmail(
        **email_data.model_dump(),
        ai_generated=False,
        status=EmailStatus.DRAFT,
        tracking_token=gmail_service.generate_tracking_token(),
    )
    db.add(email)
    db.commit()
    db.refresh(email)
    return EmailResponse.model_validate(email)


@router.put("/{email_id}", response_model=EmailResponse)
def update_email(email_id: int, email_data: EmailUpdate, db: Session = Depends(get_db)):
    """Update an email (edit subject, body, or status)."""
    email = db.query(OutreachEmail).filter(OutreachEmail.id == email_id).first()
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")

    if email.status == EmailStatus.SENT:
        raise HTTPException(status_code=400, detail="Cannot edit an already-sent email")

    update_data = email_data.model_dump(exclude_unset=True)
    if "status" in update_data and update_data["status"]:
        # Any explicit status change must flow through the approval gate,
        # never skipping the review step entirely.
        new_status = _coerce_status(str(update_data["status"]))
        allowed = {
            EmailStatus.DRAFT: {EmailStatus.PENDING_REVIEW, EmailStatus.APPROVED, EmailStatus.SKIPPED},
            EmailStatus.PENDING_REVIEW: {EmailStatus.APPROVED, EmailStatus.SKIPPED},
        }.get(email.status)
        if new_status and allowed and new_status not in allowed and new_status != email.status:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot move email from {email.status.value} to {new_status.value} directly — use approve/reject endpoints.",
            )
        update_data["status"] = new_status

    for key, value in update_data.items():
        setattr(email, key, value)
    email.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(email)
    return EmailResponse.model_validate(email)


@router.post("/{email_id}/approve")
def approve_email(email_id: int, db: Session = Depends(get_db)):
    """Approve an email for sending (pending_review/draft -> approved)."""
    email = db.query(OutreachEmail).filter(OutreachEmail.id == email_id).first()
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    if email.status not in [EmailStatus.PENDING_REVIEW, EmailStatus.DRAFT]:
        raise HTTPException(status_code=400, detail=f"Cannot approve email with status: {email.status.value}")
    if not email.recipient_email:
        raise HTTPException(status_code=400, detail="Email has no recipient address — cannot approve for sending")

    email.status = EmailStatus.APPROVED
    email.updated_at = datetime.utcnow()
    db.commit()
    return {"message": "Email approved for sending", "email_id": email_id}


@router.post("/{email_id}/reject")
def reject_email(email_id: int, db: Session = Depends(get_db)):
    """Reject/skip an email."""
    email = db.query(OutreachEmail).filter(OutreachEmail.id == email_id).first()
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    email.status = EmailStatus.SKIPPED
    email.updated_at = datetime.utcnow()
    db.commit()
    return {"message": "Email skipped", "email_id": email_id}


@router.delete("/{email_id}")
def delete_email(email_id: int, db: Session = Depends(get_db)):
    """Delete an email draft."""
    email = db.query(OutreachEmail).filter(OutreachEmail.id == email_id).first()
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    if email.status == EmailStatus.SENT:
        raise HTTPException(status_code=400, detail="Cannot delete a sent email")
    db.delete(email)
    db.commit()
    return {"message": "Email deleted successfully"}
