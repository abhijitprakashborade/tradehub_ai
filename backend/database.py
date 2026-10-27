from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker
from config import settings

sqlite = settings.DATABASE_URL.startswith("sqlite")
engine = create_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False} if sqlite else {},
    echo=settings.DEBUG,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """Dependency injection for database sessions."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_tables():
    """Create all database tables + lightweight startup migrations."""
    Base.metadata.create_all(bind=engine)
    _add_missing_columns()
    _normalize_legacy_values()
    _flag_junk_leads()


_JUNK_NAMES_SQL = (
    "'buy now','register now','sign up','sign in','get tickets','book now',"
    "'learn more','view more','download','sponsor','exhibit','exhibitors',"
    "'exhibitor','attend','visit','press','news','faq','agenda','speakers',"
    "'venue','travel','hotels','sponsorship','contact us','about us',"
    "'privacy policy','terms of use','terms & conditions','privacy',"
    "'add to catalog','add to calendar','join now','subscribe',"
    "'2026 exhibitors','2027 exhibitors','organizer','all companies',"
    "'our business categories','more info','read more','home','about','contact',"
    "'menu','login','register','search'"
)


def _flag_junk_leads():
    """
    Mark scrape-garbage rows as duplicates (hidden everywhere, data preserved):
    booth-number-only names, percent fragments, navigation strings, and
    run-on card text that no real company would have as its name.
    Idempotent — runs on every startup, only touches unflagged rows.
    """
    with engine.connect() as conn:
        conn.execute(text(
            "UPDATE leads SET is_duplicate = 1 "
            "WHERE is_duplicate = 0 AND ("
            "  (TRIM(company_name) NOT GLOB '*[^0-9]*' AND length(TRIM(company_name)) <= 6)"
            "  OR instr(company_name, '%') > 0"
            "  OR length(TRIM(company_name)) > 90"
            f"  OR lower(TRIM(company_name)) IN ({_JUNK_NAMES_SQL})"
            ")"
        ))
        conn.commit()


def _add_missing_columns():
    """Add columns introduced in v1.1 to existing tables (idempotent)."""
    with engine.connect() as conn:
        tables = {
            row[0]
            for row in conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'"))
        }
        additions = {
            "outreach_emails": [
                ("tracking_token", "VARCHAR(64)"),
                ("opens", "INTEGER DEFAULT 0"),
                ("last_opened_at", "DATETIME"),
            ],
        }
        for table, columns in additions.items():
            if table not in tables:
                continue
            existing = {
                row[1]
                for row in conn.execute(text(f"PRAGMA table_info({table})"))
            }
            for column, ddl in columns:
                if column not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
        conn.commit()


def _normalize_legacy_values():
    """
    Fix rows written by the earlier name-keyed enum columns
    ("UPCOMING" instead of "upcoming", etc.) and stray raw strings.
    Runs on every startup; cheap and idempotent.
    """
    value_sets = {
        "trade_show_events": {
            ("UPCOMING", "upcoming"), ("ONGOING", "ongoing"), ("COMPLETED", "completed"),
        },
        "leads": {
            ("NEW", "new"), ("QUALIFIED", "qualified"), ("CONTACTED", "contacted"),
            ("RESPONDED", "responded"), ("CLOSED", "closed"), ("DISQUALIFIED", "disqualified"),
        },
        "outreach_emails": {
            ("DRAFT", "draft"), ("PENDING_REVIEW", "pending_review"), ("APPROVED", "approved"),
            ("SENT", "sent"), ("FAILED", "failed"), ("SKIPPED", "skipped"),
        },
    }

    with engine.connect() as conn:
        tables = {
            row[0]
            for row in conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'"))
        }
        for table, pairs in value_sets.items():
            if table not in tables:
                continue
            for bad, good in pairs:
                conn.execute(
                    text(f"UPDATE {table} SET status = :good WHERE status = :bad COLLATE NOCASE"),
                    {"good": good, "bad": bad},
                )
        if "leads" in tables:
            for bad, good in [("HIGH", "high"), ("MEDIUM", "medium"), ("LOW", "low")]:
                conn.execute(
                    text("UPDATE leads SET priority = :good WHERE priority = :bad COLLATE NOCASE"),
                    {"good": good, "bad": bad},
                )
        conn.commit()
