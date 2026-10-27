from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from typing import List, Optional
import logging
from datetime import datetime

from database import get_db
from models import Lead, TradeShowEvent, OutreachEmail, LeadStatus, LeadPriority, ScrapeJob
from schemas import (
    LeadCreate, LeadUpdate, LeadResponse, LeadListResponse,
    ScrapeLeadsRequest, ScrapeJobResponse, BulkQualifyRequest
)
from services import pipeline

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/leads", tags=["Leads"])


def _coerce_status(value: Optional[str]) -> Optional[LeadStatus]:
    if value is None:
        return None
    try:
        return LeadStatus(value.lower())
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid status filter: '{value}'. Valid: {', '.join(s.value for s in LeadStatus)}",
        )


def _coerce_priority(value: Optional[str]) -> Optional[LeadPriority]:
    if value is None:
        return None
    try:
        return LeadPriority(value.lower())
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid priority filter: '{value}'. Valid: {', '.join(p.value for p in LeadPriority)}",
        )


@router.get("/", response_model=LeadListResponse)
def list_leads(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    event_id: Optional[int] = None,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    search: Optional[str] = None,
    min_score: Optional[float] = None,
    db: Session = Depends(get_db),
):
    """List leads with filtering by event, status, priority, score, and search."""
    query = db.query(Lead).filter(Lead.is_duplicate == False)

    if event_id:
        query = query.filter(Lead.event_id == event_id)
    status_enum = _coerce_status(status)
    if status_enum:
        query = query.filter(Lead.status == status_enum)
    priority_enum = _coerce_priority(priority)
    if priority_enum:
        query = query.filter(Lead.priority == priority_enum)
    if min_score is not None:
        query = query.filter(Lead.relevance_score >= min_score)
    if search:
        search_like = f"%{search.replace('%', '')}%"
        query = query.filter(
            or_(
                Lead.company_name.ilike(search_like),
                Lead.contact_name.ilike(search_like),
                Lead.contact_email.ilike(search_like),
                Lead.industry.ilike(search_like),
            )
        )

    total = query.count()
    qualified = db.query(func.count(Lead.id)).filter(
        Lead.status == LeadStatus.QUALIFIED,
        Lead.is_duplicate == False,
    ).scalar() or 0

    leads = query.order_by(Lead.relevance_score.desc(), Lead.created_at.desc()).offset(skip).limit(limit).all()

    response_leads = []
    counts = dict(
        db.query(OutreachEmail.lead_id, func.count(OutreachEmail.id))
        .filter(OutreachEmail.lead_id.in_([l.id for l in leads] or [0]))
        .group_by(OutreachEmail.lead_id)
        .all()
    )
    for lead in leads:
        lead_dict = LeadResponse.model_validate(lead).model_dump()
        lead_dict["emails_count"] = counts.get(lead.id, 0)
        response_leads.append(LeadResponse(**lead_dict))

    return LeadListResponse(total=total, qualified=qualified, leads=response_leads)


@router.get("/scrape/status/{job_id}")
def get_lead_scrape_status(job_id: int, db: Session = Depends(get_db)):
    """Check the status of a lead scraping job."""
    job = db.query(ScrapeJob).filter(ScrapeJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Scrape job not found")
    return {
        "job_id": job.id,
        "status": job.status,
        "records_found": job.records_found,
        "records_saved": job.records_saved,
        "error": job.error_message,
        "started_at": job.started_at,
        "completed_at": job.completed_at,
    }


@router.get("/{lead_id}", response_model=LeadResponse)
def get_lead(lead_id: int, db: Session = Depends(get_db)):
    """Get a single lead by ID."""
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    emails_count = db.query(func.count(OutreachEmail.id)).filter(
        OutreachEmail.lead_id == lead_id
    ).scalar() or 0
    result_dict = LeadResponse.model_validate(lead).model_dump()
    result_dict["emails_count"] = emails_count
    return LeadResponse(**result_dict)


@router.post("/", response_model=LeadResponse, status_code=201)
def create_lead(lead_data: LeadCreate, db: Session = Depends(get_db)):
    """Manually create a lead."""
    if lead_data.contact_email:
        existing = db.query(Lead).filter(
            Lead.contact_email == lead_data.contact_email,
            Lead.is_duplicate == False,
        ).first()
        if existing:
            raise HTTPException(
                status_code=409,
                detail=f"Lead with email {lead_data.contact_email} already exists (ID: {existing.id})"
            )

    lead = Lead(**lead_data.model_dump())
    db.add(lead)
    db.commit()
    db.refresh(lead)
    result_dict = LeadResponse.model_validate(lead).model_dump()
    result_dict["emails_count"] = 0
    return LeadResponse(**result_dict)


@router.put("/{lead_id}", response_model=LeadResponse)
def update_lead(lead_id: int, lead_data: LeadUpdate, db: Session = Depends(get_db)):
    """Update a lead."""
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    update_data = lead_data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(lead, key, value)
    lead.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(lead)
    emails_count = db.query(func.count(OutreachEmail.id)).filter(
        OutreachEmail.lead_id == lead_id
    ).scalar() or 0
    result_dict = LeadResponse.model_validate(lead).model_dump()
    result_dict["emails_count"] = emails_count
    return LeadResponse(**result_dict)


@router.delete("/{lead_id}")
def delete_lead(lead_id: int, db: Session = Depends(get_db)):
    """Delete a lead."""
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    db.delete(lead)
    db.commit()
    return {"message": "Lead deleted successfully"}


# ─── AI Qualification ─────────────────────────────────────────────────────────

_KEEP_STATUS_ON_QUALIFY = {LeadStatus.CONTACTED, LeadStatus.RESPONDED, LeadStatus.CLOSED, LeadStatus.DISQUALIFIED}


@router.post("/{lead_id}/qualify")
async def qualify_single_lead(
    lead_id: int,
    icp_description: str = "B2B technology companies with 10-500 employees",
    db: Session = Depends(get_db),
):
    """Use AI to qualify and score a single lead."""
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    result = await ai_service_qualify(db, lead, icp_description)
    return result


async def ai_service_qualify(db: Session, lead, icp_description: str) -> dict:
    from services import ai_service

    result = await ai_service.qualify_lead(
        company_name=lead.company_name,
        company_website=lead.company_website,
        industry=lead.industry,
        business_category=lead.business_category,
        company_description=lead.company_description,
        icp_description=icp_description,
    )

    lead.relevance_score = result["relevance_score"]
    lead.priority = LeadPriority(result["priority"])
    lead.qualification_notes = result["qualification_notes"]
    if lead.status not in _KEEP_STATUS_ON_QUALIFY:
        lead.status = LeadStatus.QUALIFIED if result["relevance_score"] >= 50 else lead.status
    lead.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(lead)

    return {
        "lead_id": lead.id,
        "relevance_score": result["relevance_score"],
        "priority": result["priority"],
        "qualification_notes": result["qualification_notes"],
        "pain_point": result.get("pain_point", ""),
        "recommended_approach": result.get("recommended_approach", ""),
        "ai_used": result.get("ai_used", False),
    }


@router.post("/bulk/qualify")
async def bulk_qualify_leads(
    request: BulkQualifyRequest,
    db: Session = Depends(get_db),
):
    """Use AI to qualify multiple leads at once."""
    leads = db.query(Lead).filter(Lead.id.in_(request.lead_ids)).all()
    if not leads:
        raise HTTPException(status_code=404, detail="No leads found")

    results = await pipeline.qualify_leads(lead_ids=request.lead_ids, icp=request.icp_description)

    return {"qualified_count": results["qualified"], "message": f"Qualified {results['qualified']} leads"}


# ─── Lead discovery (grounded, real data) ─────────────────────────────────────

@router.post("/scrape", response_model=ScrapeJobResponse)
async def scrape_leads(
    request: ScrapeLeadsRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Trigger real exhibitor collection for an event (directory scrape + grounded search)."""
    event = db.query(TradeShowEvent).filter(TradeShowEvent.id == request.event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    job = ScrapeJob(
        job_type="exhibitor_research",
        target_url=event.exhibitor_directory_url or event.website or f"grounded://{event.name}",
        status="pending",
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    background_tasks.add_task(
        pipeline.scrape_and_save_leads, request.event_id, request.max_leads, job.id,
    )

    return ScrapeJobResponse(
        job_id=job.id,
        status="started",
        records_found=0,
        records_saved=0,
        message=f"Collecting real exhibitors for: {event.name}. Watch live at /jobs/{job.id}/stream.",
    )
