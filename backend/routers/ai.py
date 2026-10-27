"""AI status — a REAL Gemini health probe used by the Settings 'Test' button."""
import logging

from fastapi import APIRouter

from config import settings
from services import ai_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ai", tags=["AI"])


@router.get("/status")
async def ai_status():
    """Actually calls Gemini with a tiny prompt and reports the real result."""
    if not settings.GEMINI_API_KEY:
        return {
            "configured": False,
            "ok": False,
            "model": settings.GEMINI_MODEL,
            "error": "GEMINI_API_KEY is not set in backend/.env",
        }
    result = await ai_service.ping_gemini()
    result["configured"] = True
    error = str(result.get("error") or "")
    if "RetryError" in error or "429" in error or "RESOURCE_EXHAUSTED" in error:
        result["error"] = (
            "Gemini API rejected the test call (retries exhausted). Most common cause: "
            "free-tier daily quota exhausted — it resets at midnight Pacific time. "
            "Check usage at https://ai.dev/rate-limit or upgrade the plan."
        )
    return result
