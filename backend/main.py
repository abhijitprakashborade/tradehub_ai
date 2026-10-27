"""
TradeHub AI — Backend API
FastAPI + SQLite + Gemini AI (Google Search grounding) + Gmail OAuth2

Run: uvicorn main:app --reload --host 0.0.0.0 --port 8000
"""
import logging
import os
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from config import settings
from database import create_tables
from routers import events, leads, emails, gmail, reports, jobs, tracking, scheduler, ai
from services import scheduler_service
from config import BASE_DIR

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown."""
    logger.info("🚀 Starting TradeHub AI Backend...")
    # Ensure credentials directory exists (absolute, backend-relative)
    Path(settings.GMAIL_CREDENTIALS_FILE).parent.mkdir(parents=True, exist_ok=True)
    # Create all DB tables + startup migrations
    create_tables()
    logger.info("✅ Database tables ready")
    logger.info(f"🔑 Gemini API: {'Configured ✅' if settings.GEMINI_API_KEY else 'NOT SET ❌ — add GEMINI_API_KEY to .env'}")
    logger.info(f"📧 Gmail: {'credentials.json found ✅' if os.path.exists(settings.GMAIL_CREDENTIALS_FILE) else 'credentials.json missing ❌ (Gmail features require it)'}")
    # Daily automation scheduler
    scheduler_service.start()
    logger.info("⏰ Automation scheduler running")
    logger.info("🌐 API running at http://localhost:8000")
    logger.info("📖 Docs at http://localhost:8000/docs")
    yield
    scheduler_service.shutdown()
    logger.info("👋 Shutting down TradeHub AI...")


# ─── App ────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="TradeHub AI",
    description=(
        "AI-Powered Trade Show Research, Lead Generation & Email Outreach Automation. "
        "Discover events, qualify leads with Gemini AI, and send personalized emails via Gmail."
    ),
    version=settings.APP_VERSION,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# ─── Middleware ──────────────────────────────────────────────────────────────
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Routers ────────────────────────────────────────────────────────────────
app.include_router(events.router, prefix="/api/v1")
app.include_router(leads.router, prefix="/api/v1")
app.include_router(emails.router, prefix="/api/v1")
app.include_router(gmail.router, prefix="/api/v1")
app.include_router(reports.router, prefix="/api/v1")
app.include_router(jobs.router, prefix="/api/v1")
app.include_router(tracking.router, prefix="/api/v1")
app.include_router(scheduler.router, prefix="/api/v1")
app.include_router(ai.router, prefix="/api/v1")


# ─── Root ────────────────────────────────────────────────────────────────────
@app.get("/")
def root():
    return {
        "name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "status": "running",
        "docs": "/docs",
        "api_base": "/api/v1",
    }


@app.get("/health")
def health_check():
    """Health check endpoint."""
    from database import engine
    from sqlalchemy import text
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_status = "healthy"
    except Exception as e:
        db_status = f"unhealthy: {e}"

    return {
        "status": "ok",
        "database": db_status,
        "gemini_configured": bool(settings.GEMINI_API_KEY),
        "gmail_credentials": os.path.exists(settings.GMAIL_CREDENTIALS_FILE),
        "gmail_authenticated": os.path.exists(settings.GMAIL_TOKEN_FILE),
    }
