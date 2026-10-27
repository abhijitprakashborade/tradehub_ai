"""
AI service using Google Gemini (google-genai SDK — the current, supported one).
Handles:
  - Lead qualification & scoring
  - Personalized email subject + body generation
  - AI strategy suggestions
  - Health probe for /ai/status
All genai calls are synchronous in the SDK — we run them via asyncio.to_thread
so the FastAPI event loop never blocks.
"""
import asyncio
import logging
from typing import Any, Dict, Optional

from google import genai
from google.genai import types as gtypes
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_not_exception_type

from config import settings
from services.json_utils import extract_json

logger = logging.getLogger(__name__)

_client: Optional[genai.Client] = None


def get_client() -> Optional[genai.Client]:
    """ Lazily create a Gemini client. Returns None when no API key configured."""
    global _client
    if not settings.GEMINI_API_KEY:
        logger.warning("GEMINI_API_KEY not set — AI features disabled")
        return None
    if _client is None:
        _client = genai.Client(api_key=settings.GEMINI_API_KEY)
    return _client


def get_model_name() -> str:
    return settings.GEMINI_MODEL


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=8),
    retry=retry_if_not_exception_type(ValueError),
    reraise=True,
)
def _generate_sync(prompt: str) -> str:
    client = get_client()
    if not client:
        raise ValueError("Gemini client not initialized — check GEMINI_API_KEY in .env")

    response = client.models.generate_content(
        model=settings.GEMINI_MODEL,
        contents=prompt,
        config=gtypes.GenerateContentConfig(
            temperature=0.7,
            max_output_tokens=2048,
        ),
    )
    return (response.text or "").strip()


async def _call_gemini(prompt: str) -> str:
    """Call Gemini API with retry on failure; never blocks the event loop."""
    return await asyncio.to_thread(_generate_sync, prompt)


async def ping_gemini(timeout: float = 15.0) -> Dict[str, Any]:
    """Real AI health probe — actually calls the API with a tiny prompt."""
    result: Dict[str, Any] = {"model": settings.GEMINI_MODEL, "ok": False}
    try:
        loop = asyncio.get_running_loop()
        start = asyncio.get_event_loop().time()
        text = await asyncio.wait_for(_call_gemini("Reply with exactly: OK"), timeout=timeout)
        result["latency_ms"] = int((asyncio.get_event_loop().time() - start) * 1000)
        result["ok"] = "ok" in text.lower()
        result["reply"] = text[:32]
    except Exception as exc:  # noqa: BLE001 — report any failure verbatim
        result["error"] = f"{type(exc).__name__}: {exc}"[:500]
    return result


def _clamp_score(value) -> float:
    try:
        return min(100.0, max(0.0, float(value)))
    except (TypeError, ValueError):
        return 50.0


async def qualify_lead(
    company_name: str,
    company_website: Optional[str],
    industry: Optional[str],
    business_category: Optional[str],
    company_description: Optional[str],
    icp_description: str = "B2B technology companies with 10-500 employees attending US trade shows",
) -> Dict[str, Any]:
    """
    Use Gemini to score and qualify a lead against an ICP.
    Returns a score 0-100 and qualification notes. NOTE: fallback scoring is
    explicitly labeled as heuristic — it is not presented as AI output.
    """
    prompt = f"""You are an expert B2B lead qualification specialist.

Evaluate this company as a potential business lead based on the provided Ideal Customer Profile (ICP).

COMPANY INFORMATION:
- Name: {company_name}
- Website: {company_website or "Not available"}
- Industry: {industry or "Unknown"}
- Business Category: {business_category or "Unknown"}
- Description: {company_description or "Not available"}

IDEAL CUSTOMER PROFILE (ICP):
{icp_description}

Your task:
1. Score this lead from 0 to 100 (100 = perfect match)
2. Determine priority: HIGH (80+), MEDIUM (50-79), LOW (<50)
3. Write 2-3 sentences of qualification notes explaining your score
4. Suggest the most relevant pain point or value proposition

Respond ONLY with valid JSON in this exact format:
{{
  "relevance_score": <number 0-100>,
  "priority": "<high|medium|low>",
  "qualification_notes": "<2-3 sentences>",
  "pain_point": "<one sentence>",
  "recommended_approach": "<one sentence>"
}}"""

    try:
        text = await _call_gemini(prompt)
        data = extract_json(text)
        if isinstance(data, dict):
            return {
                "ai_used": True,
                "relevance_score": _clamp_score(data.get("relevance_score", 50)),
                "priority": str(data.get("priority", "medium")).lower(),
                "qualification_notes": data.get("qualification_notes", ""),
                "pain_point": data.get("pain_point", ""),
                "recommended_approach": data.get("recommended_approach", ""),
            }
    except Exception as e:
        logger.error(f"Gemini qualify_lead error: {e}")

    # Heuristic fallback — clearly flagged as non-AI so callers can be honest
    score = 50.0
    if company_website:
        score += 10
    if business_category:
        score += 10
    if company_description:
        score += 5
    return {
        "ai_used": False,
        "relevance_score": score,
        "priority": "medium",
        "qualification_notes": "Heuristic score from available data (AI unavailable). Manual review recommended.",
        "pain_point": "To be determined after research.",
        "recommended_approach": "Start with an introductory email.",
    }


async def generate_outreach_email(
    company_name: str,
    contact_name: Optional[str],
    contact_designation: Optional[str],
    business_category: Optional[str],
    company_description: Optional[str],
    event_name: Optional[str],
    sender_name: str,
    sender_company: str,
    sender_role: str,
    custom_notes: Optional[str] = None,
    tone: str = "professional",
) -> Dict[str, str]:
    """
    Generate a personalized cold outreach email using Gemini.
    Raises on failure — callers decide how to surface it; no fabricated
    placeholder-laden "fallback email" is silently substituted.
    """
    tone_guidance = {
        "professional": "formal, respectful, and business-focused",
        "friendly": "warm, conversational, and approachable while staying professional",
        "urgent": "concise, value-forward, and subtly time-sensitive",
    }.get(tone, "professional, respectful, and business-focused")

    prompt = f"""You are an expert B2B sales copywriter with 15 years of experience writing cold outreach emails that get replies.

Write a personalized cold outreach email for the following scenario:

PROSPECT:
- Company: {company_name}
- Contact Name: {contact_name or "the appropriate decision maker"}
- Title/Role: {contact_designation or "Business Owner/Manager"}
- Industry/Category: {business_category or "Business"}
- About the company: {company_description or f"{company_name} is a company we discovered at a trade show."}
- Event where found: {event_name or "a recent trade show"}

SENDER:
- Name: {sender_name}
- Company: {sender_company}
- Role: {sender_role}

TONE: Write in a {tone_guidance} tone.

ADDITIONAL CONTEXT: {custom_notes or "No additional context provided."}

EMAIL REQUIREMENTS:
1. Subject line: Compelling, personalized, under 60 characters, no spam triggers
2. Opening: Reference the trade show or event (creates context)
3. Value proposition: 2-3 sentences explaining WHY you're reaching out and what value you bring
4. Social proof or credibility: One brief sentence
5. Clear CTA: Specific ask (15-min call, demo, etc.)
6. Signature: Professional closing with sender info
7. Total length: 150-250 words (not too long!)
8. NO placeholders like [YOUR NAME] — use the actual provided names
9. Sound human, NOT like a template

Respond ONLY with valid JSON:
{{
  "subject": "<email subject>",
  "body": "<full email body with proper line breaks using \\n>"
}}"""

    text = await _call_gemini(prompt)
    data = extract_json(text)
    if not isinstance(data, dict) or not data.get("subject") or not data.get("body"):
        raise ValueError("Gemini returned an unparsable email — no AI-guessed content substituted.")
    return {
        "subject": str(data["subject"]).strip(),
        "body": str(data["body"]).strip(),
    }


async def bulk_qualify_leads(leads: list, icp_description: str) -> list:
    """Qualify multiple leads in batches of 5 with free-tier-friendly pacing."""
    results = []
    batch_size = 5
    for i in range(0, len(leads), batch_size):
        batch = leads[i:i + batch_size]
        tasks = [
            qualify_lead(
                company_name=lead.company_name,
                company_website=lead.company_website,
                industry=lead.industry,
                business_category=lead.business_category,
                company_description=lead.company_description,
                icp_description=icp_description,
            )
            for lead in batch
        ]
        batch_results = await asyncio.gather(*tasks, return_exceptions=True)
        for j, result in enumerate(batch_results):
            if isinstance(result, Exception):
                logger.error(f"Error qualifying lead {batch[j].id}: {result}")
                results.append({
                    "ai_used": False,
                    "relevance_score": 50.0,
                    "priority": "medium",
                    "qualification_notes": "AI qualification failed for this lead; neutral score kept.",
                })
            else:
                results.append(result)
        if i + batch_size < len(leads):
            await asyncio.sleep(3)
    return results


async def suggest_new_features_for_icp(
    icp_description: str,
    current_leads_count: int,
    top_industries: list,
) -> Dict[str, Any]:
    """AI-powered suggestions for improving the lead generation workflow.
    Returns {"recommendations": [...], "ai_used": bool} — honest about source."""
    prompt = f"""You are a B2B growth strategy consultant.

Based on this setup:
- ICP: {icp_description}
- Current qualified leads: {current_leads_count}
- Top industries in pipeline: {', '.join(top_industries) if top_industries else 'Mixed'}

Provide 3 specific, actionable recommendations to improve lead quality and email response rates.

Respond with JSON:
{{
  "recommendations": [
    {{"title": "...", "description": "...", "expected_impact": "..."}},
    {{"title": "...", "description": "...", "expected_impact": "..."}},
    {{"title": "...", "description": "...", "expected_impact": "..."}}
  ]
}}"""

    try:
        text = await _call_gemini(prompt)
        data = extract_json(text)
        if isinstance(data, dict) and isinstance(data.get("recommendations"), list):
            data["ai_used"] = True
            return data
    except Exception as e:
        logger.error(f"Gemini suggestions error: {e}")

    return {
        "ai_used": False,
        "recommendations": [
            {"title": "Personalize at scale", "description": "Use company-specific pain points in subject lines.", "expected_impact": "Higher open rate"},
            {"title": "Follow-up sequence", "description": "Send 3-touch sequence: Day 1, Day 4, Day 9.", "expected_impact": "Higher response rate"},
            {"title": "LinkedIn pre-warm", "description": "Connect on LinkedIn before emailing.", "expected_impact": "Higher reply rate"},
        ],
    }
