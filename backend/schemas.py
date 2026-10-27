from pydantic import BaseModel, EmailStr, HttpUrl, Field, validator
from typing import Optional, List
from datetime import datetime
from models import EventStatus, LeadStatus, EmailStatus, LeadPriority

# ─── Trade Show Event Schemas ────────────────────────────────────────────────

class EventBase(BaseModel):
    name: str
    location: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: str = "United States"
    industry: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    venue: Optional[str] = None
    website: Optional[str] = None
    exhibitor_directory_url: Optional[str] = None
    description: Optional[str] = None
    expected_exhibitors: Optional[int] = None
    expected_attendees: Optional[int] = None
    source_url: Optional[str] = None
    status: EventStatus = EventStatus.UPCOMING


class EventCreate(EventBase):
    pass


class EventUpdate(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    industry: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    venue: Optional[str] = None
    website: Optional[str] = None
    exhibitor_directory_url: Optional[str] = None
    description: Optional[str] = None
    status: Optional[EventStatus] = None


class EventResponse(EventBase):
    id: int
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None
    leads_count: Optional[int] = 0

    class Config:
        from_attributes = True


class EventListResponse(BaseModel):
    total: int
    events: List[EventResponse]


# ─── Lead Schemas ────────────────────────────────────────────────────────────

class LeadBase(BaseModel):
    company_name: str
    company_website: Optional[str] = None
    industry: Optional[str] = None
    business_category: Optional[str] = None
    company_description: Optional[str] = None
    company_size: Optional[str] = None
    contact_name: Optional[str] = None
    contact_designation: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_linkedin: Optional[str] = None
    status: LeadStatus = LeadStatus.NEW
    priority: LeadPriority = LeadPriority.MEDIUM
    relevance_score: float = Field(default=0.0, ge=0.0, le=100.0)
    qualification_notes: Optional[str] = None
    source_url: Optional[str] = None
    booth_number: Optional[str] = None
    event_id: Optional[int] = None


class LeadCreate(LeadBase):
    pass


class LeadUpdate(BaseModel):
    company_website: Optional[str] = None
    contact_name: Optional[str] = None
    contact_designation: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    status: Optional[LeadStatus] = None
    priority: Optional[LeadPriority] = None
    relevance_score: Optional[float] = None
    qualification_notes: Optional[str] = None
    data_verified: Optional[bool] = None


class LeadResponse(LeadBase):
    id: int
    data_verified: bool
    is_duplicate: bool
    created_at: datetime
    updated_at: Optional[datetime] = None
    last_contacted_at: Optional[datetime] = None
    emails_count: Optional[int] = 0

    class Config:
        from_attributes = True


class LeadListResponse(BaseModel):
    total: int
    qualified: int
    leads: List[LeadResponse]


# ─── Email Schemas ────────────────────────────────────────────────────────────

class EmailGenerateRequest(BaseModel):
    lead_id: int
    sender_name: str = "Your Name"
    sender_company: str = "Your Company"
    sender_role: str = "Business Development"
    custom_notes: Optional[str] = None
    tone: str = "professional"  # professional, friendly, urgent


class EmailBase(BaseModel):
    subject: str
    body: str
    recipient_email: Optional[str] = None
    recipient_name: Optional[str] = None


class EmailCreate(EmailBase):
    lead_id: int


class EmailUpdate(BaseModel):
    subject: Optional[str] = None
    body: Optional[str] = None
    status: Optional[EmailStatus] = None


class EmailResponse(EmailBase):
    id: int
    lead_id: int
    ai_generated: bool
    ai_model_used: Optional[str] = None
    gmail_draft_id: Optional[str] = None
    gmail_message_id: Optional[str] = None
    status: EmailStatus
    sent_at: Optional[datetime] = None
    error_message: Optional[str] = None
    opens: int = 0
    last_opened_at: Optional[datetime] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    lead: Optional[LeadResponse] = None

    class Config:
        from_attributes = True


class EmailListResponse(BaseModel):
    total: int
    emails: List[EmailResponse]


# ─── Gmail Auth Schemas ──────────────────────────────────────────────────────

class GmailAuthRequest(BaseModel):
    authorization_code: str

class GmailDraftRequest(BaseModel):
    email_id: int


class GmailSendRequest(BaseModel):
    email_id: int


# ─── Report Schemas ──────────────────────────────────────────────────────────

class DashboardStats(BaseModel):
    total_events: int
    upcoming_events: int
    total_leads: int
    qualified_leads: int
    contacted_leads: int
    total_emails: int
    emails_sent: int
    emails_drafted: int
    ai_generated_emails: int
    avg_lead_score: float
    high_priority_leads: int
    conversion_rate: float


class ReportResponse(BaseModel):
    stats: DashboardStats
    events_by_industry: List[dict]
    leads_by_status: List[dict]
    leads_by_priority: List[dict]
    email_pipeline: List[dict]
    recent_activity: List[dict]


# ─── Scrape Schemas ──────────────────────────────────────────────────────────

class ScrapeEventRequest(BaseModel):
    industry: str = "technology"
    location: str = "United States"
    max_events: int = Field(default=10, ge=1, le=50)


class ScrapeLeadsRequest(BaseModel):
    event_id: int
    max_leads: int = Field(default=20, ge=1, le=100)


class ScrapeJobResponse(BaseModel):
    job_id: int
    status: str
    records_found: int
    records_saved: int
    message: str


# ─── Bulk AI Qualify ─────────────────────────────────────────────────────────

class BulkQualifyRequest(BaseModel):
    lead_ids: List[int]
    icp_description: str = "B2B technology companies with 10-500 employees"


# ─── Bulk Email Generate (proper body contract) ──────────────────────────────

class BulkGenerateRequest(BaseModel):
    lead_ids: List[int] = Field(min_length=1)
    sender_name: str = "Your Name"
    sender_company: str = "Your Company"
    sender_role: str = "Business Development"
    custom_notes: Optional[str] = None
    tone: str = "professional"


# ─── Gmail connect flow + replies + tracking ─────────────────────────────────

class GmailAuthStatus(BaseModel):
    authenticated: bool
    user_email: Optional[str] = None
    auth_url: Optional[str] = None
    content_file_missing: Optional[bool] = None
    detail: Optional[str] = None


class GmailConnectStatus(BaseModel):
    status: str  # idle | started | awaiting_user | connected | error
    user_email: Optional[str] = None
    error: Optional[str] = None


class ReplyResponse(BaseModel):
    id: int
    email_id: int
    sender: Optional[str] = None
    subject: Optional[str] = None
    snippet: Optional[str] = None
    received_at: Optional[datetime] = None
    seen: bool
    created_at: datetime

    class Config:
        from_attributes = True


# ─── AI status ────────────────────────────────────────────────────────────────

class AIStatus(BaseModel):
    configured: bool
    ok: bool
    model: str
    latency_ms: Optional[int] = None
    error: Optional[str] = None
