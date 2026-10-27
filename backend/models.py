from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, Text, ForeignKey, Enum as SAEnum, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from database import Base


class EventStatus(str, enum.Enum):
    UPCOMING = "upcoming"
    ONGOING = "ongoing"
    COMPLETED = "completed"


class LeadStatus(str, enum.Enum):
    NEW = "new"
    QUALIFIED = "qualified"
    CONTACTED = "contacted"
    RESPONDED = "responded"
    CLOSED = "closed"
    DISQUALIFIED = "disqualified"


class EmailStatus(str, enum.Enum):
    DRAFT = "draft"
    PENDING_REVIEW = "pending_review"
    APPROVED = "approved"
    SENT = "sent"
    FAILED = "failed"
    SKIPPED = "skipped"


class LeadPriority(str, enum.Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class TaskType(str, enum.Enum):
    DISCOVER_EVENTS = "discover_events"
    SCRAPE_LEADS = "scrape_leads"
    QUALIFY_LEADS = "qualify_leads"
    CHECK_REPLIES = "check_replies"
    GENERATE_DRAFTS = "generate_drafts"


# Store enum VALUES ("upcoming", not "UPCOMING") so DB rows match the API contract
def _value_enum(enum_cls):
    return SAEnum(
        enum_cls,
        native_enum=False,
        values_callable=lambda e: [m.value for m in e],
    )


class TradeShowEvent(Base):
    __tablename__ = "trade_show_events"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(500), nullable=False, index=True)
    location = Column(String(300))
    city = Column(String(100))
    state = Column(String(50))
    country = Column(String(100), default="United States")
    industry = Column(String(200))
    start_date = Column(String(50))
    end_date = Column(String(50))
    venue = Column(String(300))
    website = Column(String(500))
    exhibitor_directory_url = Column(String(500))
    description = Column(Text)
    expected_exhibitors = Column(Integer)
    expected_attendees = Column(Integer)
    source_url = Column(String(500))
    status = Column(_value_enum(EventStatus), default=EventStatus.UPCOMING)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    leads = relationship("Lead", back_populates="event", cascade="all, delete-orphan")


class Lead(Base):
    __tablename__ = "leads"

    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("trade_show_events.id"), nullable=True)

    # Company info
    company_name = Column(String(500), nullable=False, index=True)
    company_website = Column(String(500))
    industry = Column(String(200))
    business_category = Column(String(200))
    company_description = Column(Text)
    company_size = Column(String(50))  # "1-10", "11-50", "51-200", "200+"

    # Contact info
    contact_name = Column(String(200))
    contact_designation = Column(String(200))
    contact_email = Column(String(300), index=True)
    contact_phone = Column(String(50))
    contact_linkedin = Column(String(500))

    # Lead metadata
    status = Column(_value_enum(LeadStatus), default=LeadStatus.NEW)
    priority = Column(_value_enum(LeadPriority), default=LeadPriority.MEDIUM)
    relevance_score = Column(Float, default=0.0)  # 0-100
    qualification_notes = Column(Text)

    # Source
    source_url = Column(String(500))
    booth_number = Column(String(50))
    data_verified = Column(Boolean, default=False)
    is_duplicate = Column(Boolean, default=False)

    # Tracking
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    last_contacted_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    event = relationship("TradeShowEvent", back_populates="leads")
    emails = relationship("OutreachEmail", back_populates="lead", cascade="all, delete-orphan")


class OutreachEmail(Base):
    __tablename__ = "outreach_emails"

    id = Column(Integer, primary_key=True, index=True)
    lead_id = Column(Integer, ForeignKey("leads.id"), nullable=False)

    # Email content
    subject = Column(String(500), nullable=False)
    body = Column(Text, nullable=False)
    recipient_email = Column(String(300))
    recipient_name = Column(String(200))

    # AI generation
    ai_generated = Column(Boolean, default=True)
    ai_model_used = Column(String(100))
    generation_prompt = Column(Text)

    # Gmail integration
    gmail_draft_id = Column(String(200), nullable=True)
    gmail_message_id = Column(String(200), nullable=True)
    gmail_thread_id = Column(String(200), nullable=True)

    # Status & tracking
    status = Column(_value_enum(EmailStatus), default=EmailStatus.DRAFT)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    error_message = Column(Text, nullable=True)
    is_duplicate_check_passed = Column(Boolean, default=True)

    # Open tracking (real 1x1 pixel served by this backend)
    tracking_token = Column(String(64), unique=True, index=True, nullable=True)
    opens = Column(Integer, default=0)
    last_opened_at = Column(DateTime(timezone=True), nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    lead = relationship("Lead", back_populates="emails")
    replies = relationship("EmailReply", back_populates="outreach_email", cascade="all, delete-orphan")


class EmailReply(Base):
    """A real reply found in the user's Gmail inbox, matched to an outreach email thread."""
    __tablename__ = "email_replies"

    id = Column(Integer, primary_key=True, index=True)
    email_id = Column(Integer, ForeignKey("outreach_emails.id"), nullable=False)
    gmail_message_id = Column(String(200), unique=True, index=True)
    gmail_thread_id = Column(String(200), index=True)
    sender = Column(String(300))
    subject = Column(String(500))
    snippet = Column(Text)
    received_at = Column(DateTime(timezone=True))
    seen = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    outreach_email = relationship("OutreachEmail", back_populates="replies")


class ScheduledTask(Base):
    """User-defined automation: run a pipeline task daily at a set time."""
    __tablename__ = "scheduled_tasks"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    task_type = Column(_value_enum(TaskType), nullable=False)
    hour = Column(Integer, default=9)
    minute = Column(Integer, default=0)
    enabled = Column(Boolean, default=True)
    config_json = Column(JSON, default=dict)  # {industry, location, max_events, icp, event_id, max_leads, sender_*}
    last_run_at = Column(DateTime(timezone=True))
    last_status = Column(String(50))  # completed | failed | running
    last_result = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ScrapeJob(Base):
    __tablename__ = "scrape_jobs"

    id = Column(Integer, primary_key=True, index=True)
    job_type = Column(String(100))  # "event_discovery", "exhibitor_research"
    target_url = Column(String(500))
    status = Column(String(50), default="pending")  # pending, running, completed, failed
    records_found = Column(Integer, default=0)
    records_saved = Column(Integer, default=0)
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
