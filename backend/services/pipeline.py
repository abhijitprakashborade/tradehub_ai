"""
Pipeline orchestration — the single source of truth for every automation task.

Used both by interactive endpoints (routers/events, routers/leads, ...) and
by the scheduler, so a "Run Now" executes the exact same code path as a
manual click.
"""
import asyncio
import logging
from datetime import datetime
from typing import Dict, List, Optional

from database import SessionLocal
from models import (
    TradeShowEvent, Lead, OutreachEmail, ScrapeJob, EmailStatus, LeadStatus, LeadPriority,
)
from services import ai_service, scraper, job_logger, gmail_service
from config import settings

logger = logging.getLogger(__name__)


# ─── Event discovery ─────────────────────────────────────────────────────────

def _escape_like(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return escaped


# Never-save nav/footer strings that scrape pages sometimes expose as "companies"
_JUNK_COMPANY_NAMES = {
    "", "home", "about", "contact", "menu", "login", "register", "search",
    "more info", "read more", "buy now", "register now", "sign up", "sign in",
    "get tickets", "book now", "learn more", "view more", "download",
    "sponsor", "exhibit", "exhibitors", "attend", "visit", "press",
    "news", "faq", "agenda", "speakers", "venue", "travel", "hotels",
    "sponsorship", "contact us", "about us", "privacy policy", "terms of use",
    "terms & conditions", "privacy", "add to calendar", "join now", "subscribe",
    "our business categories", "all companies", "a", "an", "the",
}


async def discover_and_save_events(
    industry: str,
    location: str,
    max_events: int,
    job_id: Optional[int] = None,
    finalize: bool = True,
) -> Dict:
    """Grounded discovery of real trade shows + DB persistence with dedup."""
    db = SessionLocal()
    try:
        if job_id is not None:
            job_logger.job_start(job_id, f"Discovering {industry} trade shows in {location}")
        if job_id:
            db_job = db.query(ScrapeJob).filter(ScrapeJob.id == job_id).first()
            if db_job:
                db_job.status = "running"
                db_job.started_at = datetime.utcnow()
                db.commit()

        discovery_error: Optional[str] = None
        try:
            events_data = await scraper.discover_events(
                industry=industry, location=location, max_events=max_events, job_id=job_id,
            )
        except Exception as exc:
            events_data = []
            discovery_error = f"{type(exc).__name__}: {exc}"[:400]
            if job_id:
                job_logger.job_step(job_id, f"❌ Discovery error: {discovery_error}", level="error")
            logger.error(f"Event discovery failed: {discovery_error}")

        saved_count = 0
        saved_event_ids: list = []
        saved_event_names: list = []
        for event_dict in events_data:
            name = event_dict.get("name", "").strip()
            if not name:
                continue
            like = f"%{_escape_like(name)}%"
            existing = db.query(TradeShowEvent).filter(
                TradeShowEvent.name.ilike(like, escape="\\")
            ).first()
            if existing:
                # Backfill any newly available verified source link
                if not existing.source_url and event_dict.get("source_url"):
                    existing.source_url = event_dict["source_url"]
                    db.commit()
                if job_id:
                    job_logger.job_step(job_id, f"↷ Skipped duplicate event: {name}")
                continue
            event = TradeShowEvent(
                name=name,
                location=event_dict.get("location") or location,
                country=event_dict.get("country", "United States"),
                industry=event_dict.get("industry", industry),
                start_date=event_dict.get("start_date"),
                end_date=event_dict.get("end_date"),
                venue=event_dict.get("venue"),
                website=event_dict.get("website"),
                description=event_dict.get("description"),
                source_url=event_dict.get("source_url"),
                expected_exhibitors=event_dict.get("expected_exhibitors"),
                expected_attendees=event_dict.get("expected_attendees"),
                status="upcoming",
            )
            db.add(event)
            db.commit()
            db.refresh(event)
            saved_count += 1
            saved_event_ids.append(event.id)
            saved_event_names.append(name)
            if job_id:
                job_logger.job_step(job_id, f"💾 Saved event: {name}")
        db.commit()

        if job_id and finalize:
            db_job = db.query(ScrapeJob).filter(ScrapeJob.id == job_id).first()
            if db_job:
                if discovery_error and saved_count == 0:
                    db_job.status = "failed"
                    db_job.error_message = discovery_error
                else:
                    db_job.status = "completed"
                db_job.records_found = len(events_data)
                db_job.records_saved = saved_count
                db_job.completed_at = datetime.utcnow()
                db.commit()
            if discovery_error and saved_count == 0:
                job_logger.job_done(job_id, "failed", f"discovery failed: {discovery_error}")
            else:
                job_logger.job_done(job_id, "completed", f"Saved {saved_count} new events (found {len(events_data)})")
        elif job_id:
            job_logger.job_step(job_id, f"✅ Discovery stage done — {saved_count} new event(s); continuing with exhibitor collection...")
        return {
            "found": len(events_data),
            "saved": saved_count,
            "saved_event_ids": saved_event_ids,
            "saved_event_names": saved_event_names,
            "error": discovery_error,
        }

    except Exception as exc:
        logger.exception(f"Event pipeline job {job_id} failed: {exc}")
        if job_id:
            db_job = db.query(ScrapeJob).filter(ScrapeJob.id == job_id).first()
            if db_job:
                db_job.status = "failed"
                db_job.error_message = str(exc)
                db.commit()
            job_logger.job_done(job_id, "failed", str(exc))
        raise
    finally:
        db.close()


def finalize_job(job_id: int, status: str, message: str, records_found=None, records_saved=None) -> None:
    """Finalize a chained job: set ScrapeJob totals + close the live log feed."""
    db = SessionLocal()
    try:
        db_job = db.query(ScrapeJob).filter(ScrapeJob.id == job_id).first()
        if db_job:
            db_job.status = status
            if records_found is not None:
                db_job.records_found = records_found
            if records_saved is not None:
                db_job.records_saved = records_saved
            if status == "failed":
                db_job.error_message = message[:500]
            db_job.completed_at = db_job.completed_at or datetime.utcnow()
            db.commit()
    finally:
        db.close()
    job_logger.job_done(job_id, status, message)



async def scrape_and_save_leads(event_id: int, max_leads: int, job_id: Optional[int] = None, finalize: bool = True) -> Dict:
    """Collect REAL exhibitors for an event + DB persistence (new-row dedup)."""
    db = SessionLocal()
    try:
        job = db.query(ScrapeJob).filter(ScrapeJob.id == job_id).first() if job_id else None
        if job:
            job.status = "running"
            job.started_at = datetime.utcnow()
            db.commit()
        if job_id is not None:
            job_logger.job_start(job_id, f"Collecting exhibitors for event #{event_id} (max {max_leads})")

        event = db.query(TradeShowEvent).filter(TradeShowEvent.id == event_id).first()
        if not event:
            raise ValueError(f"Event {event_id} not found")
        if job_id is not None and job is not None:
            job_logger.job_step(job_id, f"Target event: {event.name}")

        exhibitor_url = event.exhibitor_directory_url or ""
        if not exhibitor_url and event.website and "/exhibit" in (event.website or "").lower():
            exhibitor_url = event.website

        if job_id:
            job_logger.job_step(job_id, f"Collecting exhibitors for: {event.name}")

        try:
            leads_data = await scraper.discover_leads_for_event(
                event_name=event.name,
                industry=event.industry or "Technology",
                exhibitor_url=exhibitor_url or "",
                max_leads=max_leads,
                job_id=job_id,
            )
        except Exception as exc:
            logger.exception(f"Lead discovery failed: {exc}")
            leads_data = []
            if job_id:
                job_logger.job_step(job_id, f"Lead discovery error: {exc}", level="error")

        saved = 0
        duplicates_skipped = 0
        for ld in leads_data:
            company = ld.get("company_name", "").strip()
            if not company:
                continue
            if company.lower() in _JUNK_COMPANY_NAMES:
                if job_id:
                    job_logger.job_step(job_id, f"↪ Skipped non-company navigation text: '{company}'", level="info")
                continue
            existing = db.query(Lead).filter(
                Lead.company_name.ilike(f"%{_escape_like(company)}%", escape="\\"),
                Lead.event_id == event_id,
            ).first()
            if existing:
                # The duplicate check inverted the old behavior here:
                # the NEW row is the duplicate occurrence information-wise, but the
                # first record stays the canonical one — we keep the existing row
                # visible and just note the sighting. (No data is hidden.)
                duplicates_skipped += 1
                continue

            lead = Lead(
                event_id=event_id,
                company_name=company,
                company_website=ld.get("company_website"),
                business_category=ld.get("business_category"),
                contact_name=ld.get("contact_name"),
                contact_email=ld.get("contact_email"),
                contact_phone=ld.get("contact_phone"),
                booth_number=ld.get("booth_number"),
                source_url=ld.get("source_url"),
                industry=event.industry,
                company_description=ld.get("company_description"),
                status=LeadStatus.NEW,
                priority=LeadPriority.MEDIUM,
                relevance_score=50.0,
                data_verified=bool(ld.get("data_verified") or ld.get("source_url")),
            )
            db.add(lead)
            saved += 1
            if job_id:
                job_logger.job_step(job_id, f"💾 Saved lead: {company}")

        db.commit()

        if job and finalize:
            job.status = "completed"
            job.records_found = job.records_found or 0
            job.records_found += len(leads_data)
            job.records_saved = (job.records_saved or 0) + saved
            job.completed_at = datetime.utcnow()
            db.commit()
        if job_id:
            message = f"{saved} new leads for event #{event_id} ({duplicates_skipped} duplicates skipped)"
            if finalize:
                job_logger.job_done(job_id, "completed", message)
            else:
                job_logger.job_step(job_id, message)
        return {"found": len(leads_data), "saved": saved, "duplicates": duplicates_skipped}

    except Exception as exc:
        logger.exception(f"Lead pipeline job {job_id} failed: {exc}")
        db_job = None
        if job_id:
            db_job = db.query(ScrapeJob).filter(ScrapeJob.id == job_id).first()
            if db_job:
                db_job.status = "failed"
                db_job.error_message = str(exc)
                db.commit()
            job_logger.job_done(job_id, "failed", str(exc))
        raise
    finally:
        db.close()


# ─── Qualification ───────────────────────────────────────────────────────────

_QUALIFY_KEEP = {LeadStatus.CONTACTED, LeadStatus.RESPONDED, LeadStatus.CLOSED, LeadStatus.DISQUALIFIED}


async def qualify_leads(lead_ids: Optional[List[int]] = None, icp: Optional[str] = None, job_id: Optional[int] = None) -> Dict:
    """AI-qualify the given leads, or all non-duplicate NEW leads."""
    db = SessionLocal()
    try:
        query = db.query(Lead).filter(Lead.is_duplicate == False)
        if lead_ids:
            query = query.filter(Lead.id.in_(lead_ids))
        else:
            query = query.filter(Lead.status == LeadStatus.NEW)
        leads = query.order_by(Lead.created_at.desc()).limit(settings.MAX_LEADS_PER_EVENT * 2).all()
        if not leads:
            if job_id:
                job_logger.job_done(job_id, "completed", "No leads to qualify")
            return {"qualified": 0}

        if job_id:
            job_logger.job_step(job_id, f"🧠 AI-qualifying {len(leads)} leads")
        results = await ai_service.bulk_qualify_leads(
            leads=leads,
            icp_description=icp or "B2B technology companies with 10-500 employees attending US trade shows",
        )
        updated = 0
        for lead, result in zip(leads, results):
            lead.relevance_score = result["relevance_score"]
            lead.priority = LeadPriority(result["priority"])
            lead.qualification_notes = result["qualification_notes"]
            if lead.status not in _QUALIFY_KEEP:
                lead.status = LeadStatus.QUALIFIED if result["relevance_score"] >= 50 else lead.status
            lead.updated_at = datetime.utcnow()
            updated += 1
        db.commit()
        if job_id:
            job_logger.job_done(job_id, "completed", f"Qualified {updated} leads")
        return {"qualified": updated}

    except Exception as exc:
        logger.exception(f"Qualification job {job_id} failed: {exc}")
        if job_id:
            job_logger.job_done(job_id, "failed", str(exc))
        raise
    finally:
        db.close()


# ─── Draft generation ────────────────────────────────────────────────────────

async def generate_drafts(
    lead_ids: Optional[List[int]] = None,
    sender_name: str = "Your Name",
    sender_company: str = "Your Company",
    sender_role: str = "Business Development",
    custom_notes: Optional[str] = None,
    tone: str = "professional",
    limit: int = 20,
    job_id: Optional[int] = None,
) -> Dict:
    """Generate AI outreach emails (status pending_review — approval required)."""
    db = SessionLocal()
    try:
        query = db.query(Lead).filter(Lead.is_duplicate == False)
        if lead_ids:
            query = query.filter(Lead.id.in_(lead_ids))
        else:
            query = query.filter(Lead.status == LeadStatus.QUALIFIED)
            # Skip leads that already have a pending/sent outreach email
            query = query.filter(
                ~Lead.emails.any(OutreachEmail.status.in_(
                    [EmailStatus.PENDING_REVIEW, EmailStatus.APPROVED, EmailStatus.SENT, EmailStatus.DRAFT]
                ))
            )
        leads = query.order_by(Lead.relevance_score.desc()).limit(limit).all()
        if not leads:
            if job_id:
                job_logger.job_done(job_id, "completed", "No eligible leads for draft generation")
            return {"generated": 0, "errors": []}

        if job_id:
            job_logger.job_step(job_id, f"✉️ Generating drafts for {len(leads)} leads via {settings.GEMINI_MODEL}")

        generated = 0
        errors: List[Dict] = []
        for lead in leads:
            try:
                event = lead.event
                result = await ai_service.generate_outreach_email(
                    company_name=lead.company_name,
                    contact_name=lead.contact_name,
                    contact_designation=lead.contact_designation,
                    business_category=lead.business_category,
                    company_description=lead.company_description,
                    event_name=event.name if event else None,
                    sender_name=sender_name,
                    sender_company=sender_company,
                    sender_role=sender_role,
                    custom_notes=custom_notes,
                    tone=tone,
                )
                email = OutreachEmail(
                    lead_id=lead.id,
                    subject=result["subject"],
                    body=result["body"],
                    recipient_email=lead.contact_email,
                    recipient_name=lead.contact_name,
                    ai_generated=True,
                    ai_model_used=settings.GEMINI_MODEL,
                    status=EmailStatus.PENDING_REVIEW,
                    tracking_token=gmail_service.generate_tracking_token(),
                )
                db.add(email)
                generated += 1
                lead.status = LeadStatus.QUALIFIED if lead.status == LeadStatus.NEW else lead.status
            except Exception as exc:
                logger.warning(f"Email generation failed for lead {lead.id}: {exc}")
                errors.append({"lead_id": lead.id, "company": lead.company_name, "error": str(exc)[:200]})
                if job_id:
                    job_logger.job_step(job_id, f"⚠ Generation failed for {lead.company_name}: {exc}", level="warn")
        db.commit()

        if job_id:
            job_logger.job_done(job_id, "completed", f"Generated {generated} drafts ({len(errors)} errors)")
        return {"generated": generated, "errors": errors}

    except Exception as exc:
        logger.exception(f"Draft generation job {job_id} failed: {exc}")
        if job_id:
            job_logger.job_done(job_id, "failed", str(exc))
        raise
    finally:
        db.close()
