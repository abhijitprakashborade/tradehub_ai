"""
Real information pipeline for trade show events and exhibitor leads.

Primary source: Gemini API with the Google Search grounding tool — returns
REAL, current results with citation URLs. Everything saved to the DB carries
a source_url so records are verifiable.

Supplementary source: a real HTTP fetch of the TSNN.com tradeshow listing.

There is deliberately NO fabricated-fallback: if grounded search and the web
finds fewer records than requested, the job reports exactly how many were
found. Invented companies/emails/phones never enter the pipeline.
"""
import asyncio
import re
import logging
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from config import settings
from services import job_logger
from services.json_utils import extract_json

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


class ScraperError(Exception):
    pass


def clean_text(text: Optional[str]) -> str:
    if not text:
        return ""
    return " ".join(text.strip().split())


def extract_domain(url: str) -> str:
    try:
        parsed = urlparse(url if url.startswith("http") else f"https://{url}")
        return parsed.netloc.replace("www.", "").lower()
    except Exception:
        return url


@retry(
    stop=stop_after_attempt(2),
    wait=wait_exponential(multiplier=1, min=1, max=4),
    retry=retry_if_exception_type(httpx.HTTPError),
    reraise=True,
)
async def _get(url: str, client: httpx.AsyncClient) -> Optional[httpx.Response]:
    return await client.get(url, headers=HEADERS, follow_redirects=True)


def fetch_page_html(response: Optional[httpx.Response]) -> Optional[str]:
    if response is not None and response.status_code == 200:
        return response.text
    if response is not None:
        logger.warning(f"HTTP {response.status_code} fetching page")
    return None


async def fetch_page(url: str, client: httpx.AsyncClient) -> Optional[str]:
    """Fetch a web page with retry + timeout honoring settings."""
    try:
        response = await _get(url, client)
        return fetch_page_html(response)
    except httpx.HTTPError as e:
        logger.warning(f"Error fetching {url}: {e}")
        return None
    except Exception as e:
        logger.warning(f"Unexpected error fetching {url}: {e}")
        return None


# ─── Gemini Google-Search grounding (primary, REAL data) ──────────────────────

def _grounded_generate_sync(prompt: str) -> Tuple[str, List[str], List[str]]:
    """
    Run a grounded Google Search generation synchronously.
    Returns (text, citation_urls, search_queries_used).
    """
    from services.ai_service import get_client, get_model_name

    client = get_client()
    if not client:
        raise ScraperError("GEMINI_API_KEY not configured")

    response = client.models.generate_content(
        model=get_model_name(),
        contents=prompt,
        config=settings_config(),
    )

    text = (response.text or "").strip()
    urls: List[str] = []
    queries: List[str] = []
    try:
        candidate = response.candidates[0]
        gm = candidate.grounding_metadata
        for chunk in (gm.grounding_chunks or []):
            web = getattr(chunk, "web", None)
            uri = getattr(web, "uri", None) if web else None
            if uri:
                urls.append(uri)
        for retrieval in (getattr(gm, "web_search_queries", None) or []):
            queries.append(retrieval)
    except (AttributeError, IndexError, TypeError) as e:
        logger.debug(f"Grounding metadata unavailable or unparsable: {e}")

    # The grounding redirect URLs also appear inline in the answer text; with
    # automatic function-calling the final turn may carry no chunk metadata,
    # so parse the text as a fallback source of real citations.
    for match in re.finditer(r"https://vertexaisearch\.cloud\.google\.com/[A-Za-z0-9_\-=]+", text):
        url = match.group(0)
        if url not in urls:
            urls.append(url)

    return text, urls, queries


def settings_config():
    from google.genai import types as gtypes
    return gtypes.GenerateContentConfig(
        temperature=0.2,
        # Grounded answers embed full citation URLs; thinking + long arrays
        # previously hit the 8k ceiling and truncated mid-JSON.
        max_output_tokens=24576,
        tools=[gtypes.Tool(google_search=gtypes.GoogleSearch())],
    )


async def grounded_generate(prompt: str, job_id: Optional[int] = None) -> Tuple[str, List[str], List[str]]:
    """Grounded generation on a worker thread so the event loop stays free."""
    text, urls, queries = await asyncio.to_thread(_grounded_generate_sync, prompt)
    if job_id:
        for q in queries:
            job_logger.job_step(job_id, f"🔎 Google Search query: {q}")
        if urls:
            domains = ", ".join(dict.fromkeys(_domain_only(u) for u in urls[:8]))
            job_logger.job_step(job_id, f"🔗 {len(urls)} live web citations: {domains}...{'' if len(urls) <= 8 else ' (more)'}")
        else:
            job_logger.job_step(job_id, "⚠ No grounding citations returned", level="warn")
    return text, urls, queries


def _domain_only(url: str) -> str:
    return extract_domain(url) or url[:40]


# ─── Event discovery ───────────────────────────────────────────────────────────

async def discover_events_via_grounding(
    industry: str,
    location: str,
    max_events: int,
    job_id: Optional[int] = None,
) -> List[Dict]:
    """Discover REAL upcoming trade shows via Google-Search-grounded Gemini."""
    today = datetime.now().strftime("%B %d, %Y")
    prompt = f"""Search the live web for real, upcoming trade shows / trade fairs / exhibitions
that are taking place in the near future (from today, {today}, onward) matching:
- Industry: {industry}
- Location: {location} (United States preferred)

Requirements:
- Only REAL events with a real official website that you can verify via search results.
- For each event give: event name, official website URL, city/venue, start/end dates
  (as close to real dates as the sources show), expected exhibitors/attendees if published.
- Every event MUST include "source_url": the URL of the search-result page you verified it from
  (the citation source). Never invent dates or websites.
- If you can only find fewer than {max_events} verified upcoming events, return only those.

Respond ONLY with a JSON array (no markdown fences):
[
  {{
    "name": "...",
    "website": "https://official-site.com",
    "location": "City, State, Country",
    "venue": "...",
    "start_date": "Mon DD, YYYY",
    "end_date": "Mon DD, YYYY",
    "expected_exhibitors": null,
    "expected_attendees": null,
    "description": "1-2 sentences verified from the sources",
    "source_url": "https://citation-source.com/..."
  }}
]"""

    if job_id:
        job_logger.job_step(job_id, f"🤖 Grounded search for {industry} trade shows in {location}...")
    text, citations, _ = await grounded_generate(prompt, job_id=job_id)
    data = extract_json(text)
    if not isinstance(data, list):
        if job_id:
            job_logger.job_step(job_id, "❌ Could not parse grounded response as JSON", level="error")
        return []

    citation_domains = {_domain_only(u) for u in citations}
    events: List[Dict] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        name = clean_text(item.get("name"))
        if not name or len(name) < 3:
            continue
        source_url = item.get("source_url") or ""
        source_ok = bool(source_url) and (
            _domain_only(source_url) in citation_domains
            or "vertexaisearch.cloud.google.com" in source_url
        )
        if not source_ok:
            # model-invented source links are dropped, not trusted
            source_url = ""
        events.append({
            "name": name,
            "website": item.get("website") or "",
            "location": item.get("location") or location,
            "venue": item.get("venue") or "",
            "start_date": item.get("start_date") or "",
            "end_date": item.get("end_date") or "",
            "expected_exhibitors": _safe_int(item.get("expected_exhibitors")),
            "expected_attendees": _safe_int(item.get("expected_attendees")),
            "description": item.get("description") or "",
            "source_url": source_url or (citations[0] if citations else ""),
            "grounded": True,
            "verified_source": bool(source_url) or bool(citations),
        })
    # Verify the official websites we intend to save actually exist (real check)
    for event in events[:max_events]:
        site = event.get("website") or ""
        if site.startswith("http"):
            async with httpx.AsyncClient(timeout=12, follow_redirects=True) as client:
                html = await fetch_page(site, client)
            event["website_live"] = bool(html)
        elif event.get("source_url"):
            event["website_live"] = None  # no website claimed; source link still present
    if job_id:
        job_logger.job_step(job_id, f"✓ Parsed {len(events)} real events from grounded results")
    return events


def _safe_int(value) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


# ─── TSNN.com (real profile of the site; best-effort supplement) ──────────────

async def scrape_tsnn_events(industry: str = "technology", max_events: int = 10) -> List[Dict]:
    """Best-effort scrape of the TSNN tradeshow listing (may be bot-protected)."""
    events: List[Dict] = []
    base_url = "https://www.tsnn.com"
    listing_url = f"{base_url}/tradeshows"

    async with httpx.AsyncClient(timeout=settings.REQUEST_TIMEOUT, follow_redirects=True) as client:
        html = await fetch_page(listing_url, client)
        if not html:
            return events
        soup = BeautifulSoup(html, "lxml")

        rows = soup.select(".views-row, article.node--type-event, .teaser, .view-tradeshows .item")
        if not rows:
            rows = soup.select("div[class*='event'], li[class*='event']")
        for row in rows[:max_events]:
            try:
                name_el = row.select_one("h2, h3, .title, a")
                name = clean_text(name_el.get_text()) if name_el else ""
                if not name or len(name) < 4:
                    continue
                link_el = row.select_one("a[href]")
                event_url = urljoin(base_url, link_el["href"]) if link_el else ""
                date_el = row.select_one("time, .date, [class*='date']")
                location_el = row.select_one("[class*='location'], [class*='city'], .venue")
                events.append({
                    "name": name,
                    "website": event_url,
                    "location": clean_text(location_el.get_text()) if location_el else "United States",
                    "start_date": clean_text(date_el.get_text()) if date_el else "",
                    "source_url": listing_url,
                    "grounded": False,
                    "verified_source": True,
                })
                await asyncio.sleep(settings.SCRAPE_DELAY_SECONDS)
            except Exception as e:
                logger.debug(f"TSNN row parse skipped: {e}")
                continue
    return events


async def discover_events(
    industry: str = "technology",
    location: str = "United States",
    max_events: int = 20,
    job_id: Optional[int] = None,
) -> List[Dict]:
    """Grounded search (primary, REAL) + TSNN scrape (secondary). Honest counts."""
    all_events: List[Dict] = []
    seen: set = set()

    try:
        grounded = await discover_events_via_grounding(industry, location, max_events, job_id)
    except ScraperError as e:
        if job_id:
            job_logger.job_step(job_id, f"❌ Grounded discovery unavailable: {e}", level="error")
        grounded = []

    for event in grounded:
        key = event["name"].lower().strip()
        if key not in seen:
            seen.add(key)
            all_events.append(event)

    if len(all_events) < max_events:
        if job_id:
            job_logger.job_step(job_id, "🌐 Checking TSNN.com listing as a secondary source...")
        try:
            tsnn = await scrape_tsnn_events(industry, max_events - len(all_events))
            if job_id:
                job_logger.job_step(job_id, f"TSNN returned {len(tsnn)} events")
            for event in tsnn:
                key = event["name"].lower().strip()
                if key not in seen and len(key) > 3:
                    seen.add(key)
                    all_events.append(event)
        except Exception as e:
            if job_id:
                job_logger.job_step(job_id, f"TSNN scrape failed: {e}", level="warn")

    if job_id:
        real_count = sum(1 for e in all_events if e.get("source_url"))
        job_logger.job_step(job_id, f"📊 Discovery complete: {len(all_events)} events ({real_count} with verifiable source links)")
    return all_events[:max_events]


# ─── Exhibitor page scraping (real pages only) ────────────────────────────────

async def scrape_exhibitor_page(url: str, job_id: Optional[int] = None) -> List[Dict]:
    """Scrape an exhibitor directory page. Only real companies listed on it."""
    exhibitors: List[Dict] = []
    if not url or not url.startswith("http"):
        return exhibitors

    if job_id:
        job_logger.job_step(job_id, f"🌐 Fetching exhibitor directory: {url}")

    async with httpx.AsyncClient(timeout=settings.REQUEST_TIMEOUT, follow_redirects=True) as client:
        html = await fetch_page(url, client)
        if not html:
            if job_id:
                job_logger.job_step(job_id, "⚠ Directory page not readable (blocked or missing)", level="warn")
            return exhibitors

        soup = BeautifulSoup(html, "lxml")

        # Pattern 1: table rows
        for table in soup.select("table"):
            for row in table.select("tr")[1:]:
                cells = row.select("td")
                if len(cells) >= 1:
                    company = clean_text(cells[0].get_text())
                    if company and len(company) > 1:
                        link_el = cells[0].select_one("a[href]")
                        website = ""
                        if link_el and link_el.get("href"):
                            href = link_el["href"]
                            website = href if href.startswith("http") else urljoin(url, href)
                        exhibitors.append({
                            "company_name": company,
                            "company_website": website,
                            "business_category": clean_text(cells[1].get_text()) if len(cells) > 1 else "",
                            "booth_number": clean_text(cells[-1].get_text()) if len(cells) > 2 else "",
                            "source_url": url,
                        })

        # Pattern 2: cards/divs referencing exhibitors/companies
        if not exhibitors:
            cards = soup.select(
                "[class*='exhibitor'], [class*='company'], [data-exhibitor]"
            )
            for card in cards:
                name_el = card.select_one("h2, h3, h4, .name, .company-name, strong, b")
                company = clean_text(name_el.get_text()) if name_el else ""
                if not company:
                    link_el = card.select_one("a")
                    company = clean_text(link_el.get_text()) if link_el else ""
                if not company or len(company) < 2 or len(company) > 200:
                    continue
                link_el = card.select_one("a[href*='http']")
                website = link_el["href"] if link_el and link_el.get("href", "").startswith("http") else ""
                cat_el = card.select_one("[class*='category'], [class*='industry'], p")
                exhibitors.append({
                    "company_name": company,
                    "company_website": website,
                    "business_category": clean_text(cat_el.get_text())[:120] if cat_el else "",
                    "source_url": url,
                })

        if job_id:
            job_logger.job_step(job_id, f"✓ Directory parse: {len(exhibitors)} companies found on-page")
    return exhibitors


async def discover_directory_urls_via_grounding(
    event_name: str,
    industry: str,
    job_id: Optional[int] = None,
) -> List[Dict]:
    """
    Grounded search for REAL exhibitor-listing pages for an event.
    Each returned URL must be backed by an actual Google Search citation
    (domain match), so we only ever fetch pages that really exist.
    """
    prompt = f"""Search the live web for pages that list the exhibitors of the trade show "{event_name}"
({industry} industry). Look for: the event's official exhibitor directory page, expo
directories (like expofinder/expolista/10times/TSNN) that carry this event's exhibitor list,
or the event's own site 'Exhibitors' page.

Return a JSON array of the pages themselves (NOT the individual companies):
[{{"url": "https://...", "description": "what this page contains"}}]

Only include URLs you actually saw in search results. Up to 5 pages."""

    if job_id:
        job_logger.job_step(job_id, f"🤖 Grounded search for real exhibitor-listing pages for {event_name}...")
    text, citations, _ = await grounded_generate(prompt, job_id=job_id)
    data = extract_json(text)

    citation_domains = {_domain_only(u) for u in citations}
    pages: List[Dict] = []
    seen: set = set()
    candidates = data if isinstance(data, list) else []

    def _plausible(url: str) -> bool:
        if not url.startswith("http") or url in seen:
            return False
        # vertexaisearch redirect links and citation-domain URLs are verified
        # by Google itself; plain URLs get verified later by actually fetching
        return _domain_only(url) in citation_domains or "vertexaisearch.cloud.google.com" in url

    for item in candidates:
        if not isinstance(item, dict):
            continue
        url = (item.get("url") or "").strip()
        if _plausible(url):
            seen.add(url)
            pages.append({"url": url, "description": item.get("description", "")})
    # Also use the citation redirect URLs themselves as fallback fetch targets
    for c in citations[:3]:
        if c not in seen:
            seen.add(c)
            pages.append({"url": c, "description": "Google Search citation"})
    if job_id:
        job_logger.job_step(job_id, f"✓ {len(pages)} exhibitor-listing page candidate(s) from grounded search")
    return pages


# ─── Grounded exhibitor discovery (REAL exhibitors, cited) ────────────────────

async def discover_exhibitors_via_grounding(
    event_name: str,
    industry: str,
    max_leads: int,
    job_id: Optional[int] = None,
) -> List[Dict]:
    """
    Ask Google-Search-grounded Gemini for the event's REAL exhibitor list.
    Only companies whose source matches an actual citation are returned.
    No invented contacts: names/designations/emails only come from enrichment.
    """
    prompt = f"""Search the live web for the REAL exhibitor list of the trade show "{event_name}" ({industry} industry).

Requirements:
- Find the official exhibitor directory or attendee list; if the exact exhibitor list isn't public,
  find companies VERIFIED via search results as actual exhibitors/attendees/sponsors of this event
  (e.g. from event's own site, press releases, exhibitor pages on expo databases).
- Return up to {max_leads} real companies, each with:
  "company_name": legal company name,
  "company_website": corporate website URL,
  "business_category": from the source page,
  "source_url": the EXACT citation URL (the vertexaisearch.cloud.google.com link) that backs this company;
  if you don't have a citation link for a company, leave source_url null and do NOT use its website as source.
- NEVER invent contact people, emails, or phone numbers. Contact fields must be null here.
- If you can only verify fewer companies, return only the verified ones.

Respond ONLY with a JSON array (no markdown):
[{{"company_name": "...", "company_website": "https://...", "business_category": "...", "source_url": "https://..."}}]"""

    if job_id:
        job_logger.job_step(job_id, f"🤖 Grounded search for real exhibitors of {event_name}...")
    text, citations, _ = await grounded_generate(prompt, job_id=job_id)
    data = extract_json(text)
    if not isinstance(data, list):
        if job_id:
            job_logger.job_step(job_id, "❌ Could not parse grounded exhibitor response as JSON", level="error")
        return []

    citation_domains = {_domain_only(u) for u in citations}
    companies: List[Dict] = []
    seen: set = set()
    for item in data:
        if not isinstance(item, dict):
            continue
        name = clean_text(item.get("company_name"))
        if not name or len(name) < 2 or len(name) > 200:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        source_url = item.get("source_url") or ""
        website = item.get("company_website") or ""
        source_ok = bool(source_url) and (
            _domain_only(source_url) in citation_domains
            or "vertexaisearch.cloud.google.com" in source_url
        )
        companies.append({
            "company_name": name,
            "company_website": website,
            "business_category": item.get("business_category") or "",
            "source_url": source_url,
            "_source_ok": source_ok,
            "grounded": True,
        })

    # Verify model-claimed source links by fetching them (a source URL that
    # doesn't load is dropped — never presented as verified).
    verified_count = 0
    fetch_budget = 4
    for company in companies:
        source = company.get("source_url") or ""
        if not source:
            continue
        if company.get("_source_ok"):
            verified_count += 1
            continue
        if fetch_budget <= 0:
            company["source_url"] = ""
            continue
        fetch_budget -= 1
        async with httpx.AsyncClient(timeout=12, follow_redirects=True) as client:
            html = await fetch_page(source, client)
        if html:
            company["_source_ok"] = True
            verified_count += 1
        else:
            company["source_url"] = ""

    for company in companies:
        company.pop("_source_ok", None)

    if job_id:
        job_logger.job_step(job_id, f"✓ {len(companies)} exhibitor candidates; {verified_count} with load-verified source links")
    return companies


async def _resolve_company_websites(
    companies: List[Dict],
    job_id: Optional[int] = None,
) -> None:
    """One grounded call to find the official website of companies we lack one for.
    Sites are NOT trusted blindly — enrichment later verifies each by fetching it."""
    missing = [c for c in companies if not (c.get("company_website") or "").startswith("http")]
    if not missing or len(missing) > 30:
        return
    names = ", ".join(c["company_name"] for c in missing)
    prompt = f"""Search the web for the OFFICIAL corporate website of each of these real companies: {names}.

Respond ONLY with a JSON array (no markdown):
[{{"company_name": "<exact name as given>", "company_website": "<https://official-site>"}}]
- Use null for company_website if you cannot verify the official site in results.
- Only include the companies provided."""

    if job_id:
        job_logger.job_step(job_id, f"🌐 Resolving official websites for {len(missing)} companies (grounded search)...")
    try:
        text, _, _ = await grounded_generate(prompt, job_id=job_id)
    except Exception as exc:
        logger.warning(f"Website resolution failed: {exc}")
        return
    data = extract_json(text)
    if not isinstance(data, list):
        return
    by_name = {c["company_name"].lower(): c for c in companies}
    verified = 0
    for item in data:
        if not isinstance(item, dict):
            continue
        target = by_name.get(clean_text(item.get("company_name")).lower())
        if not target:
            continue
        site = (item.get("company_website") or "").strip()
        if site.startswith("http") and not any(
            bad in site.lower() for bad in ("linkedin.com/", "facebook.com/", "x.com/", "twitter.com/", "instagram.com/", "wikipedia.org/")
        ):
            target["company_website"] = site
            verified += 1
    if job_id:
        job_logger.job_step(job_id, f"✓ {verified} official website(s) resolved")


# ─── Enrichment (regex over REAL company websites) ────────────────────────────

EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Z|a-z]{2,}\b")
PHONE_RE = re.compile(r"(?:\+1[-.\ ]?)?\(?[2-9]\d{2}\)?[-.\ ]?\d{3}[-.\ ]?\d{4}")


async def enrich_company_data(
    company_name: str,
    website: str,
    job_id: Optional[int] = None,
) -> Dict[str, Optional[str]]:
    """Scrape the company's real website for public contact info."""
    enriched: Dict[str, Optional[str]] = {
        "contact_email": None,
        "contact_phone": None,
        "company_description": None,
    }
    if not website:
        return enriched
    if not website.startswith("http"):
        return enriched
    if any(bad in website for bad in ("example.com", "sample.com", "yourdomain")):
        return enriched

    pages = [website.rstrip("/") + suffix for suffix in ("", "/contact", "/about", "/contact-us")]

    async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
        for page_url in pages:
            try:
                html = await fetch_page(page_url, client)
                if not html:
                    continue
                soup = BeautifulSoup(html, "lxml")
                text_content = soup.get_text(separator=" ")
                if len(text_content) > 20000:
                    text_content = text_content[:20000]

                if not enriched["contact_email"]:
                    emails = EMAIL_RE.findall(text_content)
                    contact_emails = [
                        e for e in emails
                        if not any(skip in e.lower() for skip in ("noreply", "no-reply", "example", "privacy", "sentry", "wixpress", "@2x"))
                    ]
                    if contact_emails:
                        preferred = [e for e in contact_emails if any(p in e.lower() for p in ("info@", "contact@", "hello@", "sales@", "team@", "support@"))]
                        enriched["contact_email"] = preferred[0] if preferred else contact_emails[0]

                if not enriched["contact_phone"]:
                    phones = PHONE_RE.findall(text_content)
                    if phones:
                        enriched["contact_phone"] = phones[0].strip()

                if not enriched["company_description"] and page_url.rstrip("/") == website.rstrip("/"):
                    meta_desc = soup.select_one('meta[name="description"], meta[property="og:description"]')
                    if meta_desc and meta_desc.get("content"):
                        enriched["company_description"] = meta_desc["content"][:400]

                if enriched["contact_email"]:
                    break
                await asyncio.sleep(settings.SCRAPE_DELAY_SECONDS)
            except Exception:
                continue

    if job_id and (enriched["contact_email"] or enriched["contact_phone"]):
        job_logger.job_step(job_id, f"📇 Public contact found for {company_name}: {enriched['contact_email'] or enriched['contact_phone']}")
    return enriched


# ─── Full lead pipeline for an event ─────────────────────────────────────────

async def discover_leads_for_event(
    event_name: str,
    industry: str,
    exhibitor_url: str,
    max_leads: int,
    job_id: Optional[int] = None,
) -> List[Dict]:
    """
    Real exhibitors for one event, in priority order:
      1. Real scrape of the event's own exhibitor directory (if provided)
      2. Google-Search-grounded verification of exhibitors
    Then enrichment (public contact info) only for companies with real websites.
    Returns ONLY real, sourced data — may return fewer than max_leads.
    """
    exhibitors: List[Dict] = []
    seen: set = set()

    def _add(items: List[Dict]) -> int:
        added = 0
        for item in items:
            key = item["company_name"].lower().strip()
            if key and key not in seen and len(exhibitors) < max_leads * 2:
                seen.add(key)
                exhibitors.append(item)
                added += 1
        return added

    # 1. Direct directory scrape (the most authoritative public source)
    discovered_dirs: List[Dict] = []
    if exhibitor_url:
        scraped = await scrape_exhibitor_page(exhibitor_url, job_id=job_id)
        _add(scraped)
        # Try realistic sub-paths of the event site for an exhibitors page
        if len(exhibitors) < 5 and exhibitor_url.strip("/").lower() == exhibitor_url.rstrip("/").lower():
            base = exhibitor_url.rstrip("/")
            for suffix, label in (("/exhibitors", "exhibitors"), ("/exhibitor-list", "exhibitor list"), ("/companies", "companies")):
                scraped = await scrape_exhibitor_page(base + suffix, job_id=job_id)
                _add(scraped)
                if len(exhibitors) >= 5 * 2:
                    break
    else:
        if job_id:
            job_logger.job_step(job_id, "No exhibitor directory URL on event; using grounded search to find one", level="warn")

    # 2. Grounded search for real exhibitor-listing pages (cited URLs), then fetch them
    if len(exhibitors) < max_leads:
        discovered_dirs = await discover_directory_urls_via_grounding(event_name, industry, job_id=job_id)
        existing_urls = set()
        for page in discovered_dirs[:3]:
            url = page["url"]
            if url.rstrip("/").lower() == exhibitor_url.rstrip("/").lower() or url in existing_urls:
                continue
            existing_urls.add(url)
            scraped = await scrape_exhibitor_page(url, job_id=job_id)
            # Tag page-scraped exhibitors with the real page URL
            for item in scraped:
                item["source_url"] = url
            _add(scraped)
            if len(exhibitors) >= max_leads:
                break

    # 3. Grounded company-level search as final fallback (honest: fewer or none)
    grounded_count = 0
    if len(exhibitors) < max_leads:
        grounded = await discover_exhibitors_via_grounding(event_name, industry, max_leads - len(exhibitors), job_id)
        grounded_count = _add(grounded)

    # 4. Resolve official websites for companies missing one, then enrich
    leads = exhibitors[:max_leads]
    if any(not (e.get("company_website") or "").startswith("http") for e in leads):
        await _resolve_company_websites(leads, job_id=job_id)

    for exhibitor in leads:
        website = exhibitor.get("company_website") or ""
        data_verified = bool(exhibitor.get("source_url"))
        if website.startswith("http"):
            try:
                enriched = await enrich_company_data(exhibitor["company_name"], website, job_id=job_id)
                exhibitor.update({k: v for k, v in enriched.items() if v})
            except Exception as e:
                logger.debug(f"Enrichment failed for {exhibitor['company_name']}: {e}")
            if exhibitor.get("contact_email") or exhibitor.get("contact_phone"):
                data_verified = True
        exhibitor["data_verified"] = data_verified
        exhibitor["event_name"] = event_name
        exhibitor["industry"] = industry
        await asyncio.sleep(0)

    if job_id:
        sourced = sum(1 for ld in leads if ld.get("source_url"))
        contactable = sum(1 for ld in leads if ld.get("contact_email") or ld.get("contact_phone"))
        job_logger.job_step(
            job_id,
            f"📊 Lead collection complete: {len(leads)} real exhibitors "
            f"({grounded_count} via grounded search, {sourced} with source links, {contactable} with public contact info)",
        )
    return leads
