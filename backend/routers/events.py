from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
import logging
from datetime import datetime

from database import get_db
from models import TradeShowEvent, Lead, ScrapeJob, EventStatus
from schemas import (
    EventCreate, EventUpdate, EventResponse, EventListResponse,
    ScrapeEventRequest, ScrapeJobResponse
)
from services import pipeline

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/events", tags=["Events"])


def _coerce_status(value: Optional[str]) -> Optional[EventStatus]:
    """Convert API value strings into enum members; raise 422 on junk input."""
    if value is None:
        return None
    try:
        return EventStatus(value.lower())
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid status filter: '{value}'. Valid: {', '.join(s.value for s in EventStatus)}",
        )


@router.get("/", response_model=EventListResponse)
def list_events(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    industry: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """List all trade show events with optional filtering."""
    query = db.query(TradeShowEvent).filter(TradeShowEvent.is_active == True)

    if industry:
        query = query.filter(TradeShowEvent.industry.ilike(f"%{industry}%"))
    status_enum = _coerce_status(status)
    if status_enum:
        query = query.filter(TradeShowEvent.status == status_enum)
    if search:
        search_like = f"%{search.replace('%', '')}%"
        query = query.filter(
            TradeShowEvent.name.ilike(search_like) |
            TradeShowEvent.location.ilike(search_like)
        )

    total = query.count()
    events = query.order_by(TradeShowEvent.created_at.desc()).offset(skip).limit(limit).all()

    response_events = []
    counts = dict(
        db.query(Lead.event_id, func.count(Lead.id))
        .filter(Lead.event_id.in_([e.id for e in events] or [0]))
        .group_by(Lead.event_id)
        .all()
    )
    for event in events:
        event_dict_data = EventResponse.model_validate(event).model_dump()
        event_dict_data["leads_count"] = counts.get(event.id, 0)
        response_events.append(EventResponse(**event_dict_data))

    return EventListResponse(total=total, events=response_events)


@router.get("/scrape/status/{job_id}")
def get_scrape_status(job_id: int, db: Session = Depends(get_db)):
    """Check the status of a scraping job."""
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


@router.get("/{event_id}", response_model=EventResponse)
def get_event(event_id: int, db: Session = Depends(get_db)):
    """Get a single trade show event by ID."""
    event = db.query(TradeShowEvent).filter(
        TradeShowEvent.id == event_id,
        TradeShowEvent.is_active == True
    ).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    leads_count = db.query(func.count(Lead.id)).filter(Lead.event_id == event_id).scalar()
    result_dict = EventResponse.model_validate(event).model_dump()
    result_dict["leads_count"] = leads_count or 0
    return EventResponse(**result_dict)


@router.post("/", response_model=EventResponse, status_code=201)
def create_event(event_data: EventCreate, db: Session = Depends(get_db)):
    """Manually create a trade show event."""
    event = TradeShowEvent(**event_data.model_dump())
    db.add(event)
    db.commit()
    db.refresh(event)
    result_dict = EventResponse.model_validate(event).model_dump()
    result_dict["leads_count"] = 0
    return EventResponse(**result_dict)


@router.put("/{event_id}", response_model=EventResponse)
def update_event(event_id: int, event_data: EventUpdate, db: Session = Depends(get_db)):
    """Update a trade show event."""
    event = db.query(TradeShowEvent).filter(TradeShowEvent.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    update_data = event_data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(event, key, value)
    event.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(event)
    leads_count = db.query(func.count(Lead.id)).filter(Lead.event_id == event_id).scalar()
    result_dict = EventResponse.model_validate(event).model_dump()
    result_dict["leads_count"] = leads_count or 0
    return EventResponse(**result_dict)


@router.delete("/{event_id}")
def delete_event(event_id: int, db: Session = Depends(get_db)):
    """Soft-delete a trade show event."""
    event = db.query(TradeShowEvent).filter(TradeShowEvent.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    event.is_active = False
    db.commit()
    return {"message": "Event deleted successfully"}


@router.post("/scrape", response_model=ScrapeJobResponse)
async def scrape_events(
    request: ScrapeEventRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    Trigger real, web-grounded discovery of upcoming trade shows.
    Returns a job ID — stream live progress at /jobs/{job_id}/stream (SSE).
    """
    job = ScrapeJob(
        job_type="event_discovery",
        target_url=f"Grounded search: {request.industry} events in {request.location}",
        status="pending",
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    background_tasks.add_task(
        pipeline.discover_and_save_events,
        request.industry, request.location, request.max_events, job.id,
    )

    return ScrapeJobResponse(
        job_id=job.id,
        status="started",
        records_found=0,
        records_saved=0,
        message=f"Discovering real {request.industry} trade shows in {request.location}. Watch live at /jobs/{job.id}/stream.",
    )
