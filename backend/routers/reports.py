from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, desc, cast, Float
from typing import List
import logging

from database import get_db
from models import (
    TradeShowEvent, Lead, OutreachEmail,
    LeadStatus, EmailStatus, LeadPriority, EventStatus
)
from schemas import DashboardStats, ReportResponse
from services import ai_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/reports", tags=["Reports"])


@router.get("/dashboard", response_model=DashboardStats)
def get_dashboard_stats(db: Session = Depends(get_db)):
    """Aggregate stats for the main dashboard."""
    total_events = db.query(func.count(TradeShowEvent.id)).filter(
        TradeShowEvent.is_active == True
    ).scalar() or 0

    upcoming_events = db.query(func.count(TradeShowEvent.id)).filter(
        TradeShowEvent.is_active == True,
        TradeShowEvent.status == EventStatus.UPCOMING,
    ).scalar() or 0

    total_leads = db.query(func.count(Lead.id)).filter(
        Lead.is_duplicate == False
    ).scalar() or 0

    qualified_leads = db.query(func.count(Lead.id)).filter(
        Lead.status == LeadStatus.QUALIFIED,
        Lead.is_duplicate == False,
    ).scalar() or 0

    high_priority_leads = db.query(func.count(Lead.id)).filter(
        Lead.priority == LeadPriority.HIGH,
        Lead.is_duplicate == False,
    ).scalar() or 0

    total_emails = db.query(func.count(OutreachEmail.id)).scalar() or 0

    emails_sent = db.query(func.count(OutreachEmail.id)).filter(
        OutreachEmail.status == EmailStatus.SENT
    ).scalar() or 0

    emails_drafted = db.query(func.count(OutreachEmail.id)).filter(
        OutreachEmail.status.in_([EmailStatus.DRAFT, EmailStatus.PENDING_REVIEW])
    ).scalar() or 0

    avg_score_result = db.query(func.avg(Lead.relevance_score)).filter(
        Lead.is_duplicate == False,
        Lead.relevance_score > 0,
    ).scalar()
    avg_lead_score = round(float(avg_score_result or 0), 1)

    contacted_leads = db.query(func.count(Lead.id)).filter(
        Lead.status.in_([LeadStatus.CONTACTED, LeadStatus.RESPONDED, LeadStatus.CLOSED]),
        Lead.is_duplicate == False,
    ).scalar() or 0

    ai_generated_emails = db.query(func.count(OutreachEmail.id)).filter(
        OutreachEmail.ai_generated == True
    ).scalar() or 0

    conversion_rate = round((contacted_leads / total_leads * 100) if total_leads > 0 else 0, 1)

    return DashboardStats(
        total_events=total_events,
        upcoming_events=upcoming_events,
        total_leads=total_leads,
        qualified_leads=qualified_leads,
        contacted_leads=contacted_leads,
        total_emails=total_emails,
        emails_sent=emails_sent,
        emails_drafted=emails_drafted,
        ai_generated_emails=ai_generated_emails,
        avg_lead_score=avg_lead_score,
        high_priority_leads=high_priority_leads,
        conversion_rate=conversion_rate,
    )


@router.get("/full", response_model=ReportResponse)
def get_full_report(db: Session = Depends(get_db)):
    """Comprehensive report for the Reports page."""
    stats = get_dashboard_stats(db)

    # Events by industry
    events_by_industry = (
        db.query(TradeShowEvent.industry, func.count(TradeShowEvent.id).label("count"))
        .filter(TradeShowEvent.is_active == True, TradeShowEvent.industry != None)
        .group_by(TradeShowEvent.industry)
        .order_by(desc("count"))
        .limit(10)
        .all()
    )
    events_by_industry_data = [
        {"industry": row[0] or "Unknown", "count": row[1]}
        for row in events_by_industry
    ]

    # Leads by status
    leads_by_status = (
        db.query(Lead.status, func.count(Lead.id).label("count"))
        .filter(Lead.is_duplicate == False)
        .group_by(Lead.status)
        .all()
    )
    leads_by_status_data = [
        {"status": row[0].value if row[0] else "unknown", "count": row[1]}
        for row in leads_by_status
    ]

    # Leads by priority
    leads_by_priority = (
        db.query(Lead.priority, func.count(Lead.id).label("count"))
        .filter(Lead.is_duplicate == False)
        .group_by(Lead.priority)
        .all()
    )
    leads_by_priority_data = [
        {"priority": row[0].value if row[0] else "unknown", "count": row[1]}
        for row in leads_by_priority
    ]

    # Email pipeline
    email_pipeline = (
        db.query(OutreachEmail.status, func.count(OutreachEmail.id).label("count"))
        .group_by(OutreachEmail.status)
        .all()
    )
    email_pipeline_data = [
        {"status": row[0].value if row[0] else "unknown", "count": row[1]}
        for row in email_pipeline
    ]

    # Recent activity — last 10 leads
    recent_leads = (
        db.query(Lead)
        .filter(Lead.is_duplicate == False)
        .order_by(desc(Lead.created_at))
        .limit(10)
        .all()
    )
    recent_activity = [
        {
            "type": "lead",
            "company": lead.company_name,
            "status": lead.status.value if lead.status else "new",
            "score": lead.relevance_score,
            "created_at": lead.created_at.isoformat() if lead.created_at else None,
        }
        for lead in recent_leads
    ]

    # Append recent emails
    recent_emails = (
        db.query(OutreachEmail)
        .filter(OutreachEmail.status == EmailStatus.SENT)
        .order_by(desc(OutreachEmail.sent_at))
        .limit(5)
        .all()
    )
    for em in recent_emails:
        recent_activity.append({
            "type": "email_sent",
            "company": em.recipient_name or em.recipient_email or "Unknown",
            "status": "sent",
            "score": None,
            "created_at": em.sent_at.isoformat() if em.sent_at else None,
        })

    return ReportResponse(
        stats=stats,
        events_by_industry=events_by_industry_data,
        leads_by_status=leads_by_status_data,
        leads_by_priority=leads_by_priority_data,
        email_pipeline=email_pipeline_data,
        recent_activity=recent_activity,
    )


@router.get("/export/leads")
def export_leads_csv(db: Session = Depends(get_db)):
    """
    Export all non-duplicate leads as a clean, analysis-ready CSV
    (opens directly in Google Sheets / Excel, UTF-8 safe).
    """
    from fastapi.responses import Response
    import csv
    import io

    leads = (
        db.query(Lead, TradeShowEvent)
        .outerjoin(TradeShowEvent, Lead.event_id == TradeShowEvent.id)
        .filter(Lead.is_duplicate == False)
        .order_by(Lead.relevance_score.desc(), Lead.company_name.asc())
        .all()
    )

    output = io.StringIO()
    writer = csv.writer(output, lineterminator="\r\n")
    writer.writerow([
        "Company",
        "Website",
        "Contact Person",
        "Designation",
        "Email",
        "Phone",
        "Event / Trade Show",
        "Event Location",
        "Industry",
        "Business Category",
        "Booth #",
        "Status",
        "Priority",
        "AI Score / 100",
        "AI Qualification Notes",
        "Verified Source Link",
        "Data Verified",
        "Added On",
    ])

    from datetime import datetime as _dt

    def _friendly_status(value) -> str:
        return (value.value if value else "").replace("_", " ").title()

    for lead, event in leads:
        score = f"{lead.relevance_score:.0f}" if lead.relevance_score is not None else ""
        added = (
            lead.created_at.strftime("%d %b %Y, %H:%M")
            if isinstance(lead.created_at, _dt) else ""
        )
        writer.writerow([
            lead.company_name,
            lead.company_website or "",
            lead.contact_name or "",
            lead.contact_designation or "",
            lead.contact_email or "",
            lead.contact_phone or "",
            event.name if event else "",
            event.location if event else "",
            (lead.industry or "").title() if lead.industry else "",
            lead.business_category or "",
            lead.booth_number or "",
            _friendly_status(lead.status),
            _friendly_status(lead.priority),
            score,
            lead.qualification_notes or "",
            lead.source_url or "",
            "Yes" if lead.data_verified else "No",
            added,
        ])

    # UTF-8 BOM makes Excel auto-detect encoding for names like "Börsen AG"
    content = output.getvalue().encode("utf-8-sig")
    stamp = _dt.now().strftime("%Y%m%d")
    return Response(
        content=content,
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename=TradeHub_AI_Leads_{stamp}.csv',
        },
    )


@router.get("/score-buckets", response_model=List[dict])
def get_score_buckets(db: Session = Depends(get_db)):
    """REAL lead score distribution (0-20 ... 81-100) computed from the DB."""
    buckets = [
        {"range": "0-20", "min": 0.0, "max": 20.0},
        {"range": "21-40", "min": 21.0, "max": 40.0},
        {"range": "41-60", "min": 41.0, "max": 60.0},
        {"range": "61-80", "min": 61.0, "max": 80.0},
        {"range": "81-100", "min": 81.0, "max": 100.0},
    ]
    results = []
    for bucket in buckets:
        count = db.query(func.count(Lead.id)).filter(
            Lead.is_duplicate == False,  # noqa: E712
            Lead.relevance_score >= bucket["min"],
            Lead.relevance_score <= bucket["max"],
        ).scalar() or 0
        results.append({"range": bucket["range"], "count": count})
    return results


@router.get("/ai/suggestions")
async def get_ai_suggestions(db: Session = Depends(get_db)):
    """Get AI-powered suggestions for improving lead generation."""
    # Get top industries in pipeline
    industries = (
        db.query(Lead.industry)
        .filter(Lead.is_duplicate == False, Lead.industry != None)
        .distinct()
        .limit(5)
        .all()
    )
    industry_list = [i[0] for i in industries if i[0]]

    total_leads = db.query(func.count(Lead.id)).filter(
        Lead.is_duplicate == False
    ).scalar() or 0

    suggestions = await ai_service.suggest_new_features_for_icp(
        icp_description="B2B technology and manufacturing companies attending US trade shows",
        current_leads_count=total_leads,
        top_industries=industry_list,
    )
    return suggestions
