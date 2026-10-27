# TradeHub AI — Technical Documentation

**Version 1.1 · deliverable for the "AI-Powered Trade Show Research, Lead Generation & Email
Outreach Automation" assessment.**

---

## 1. System overview

TradeHub AI is a web application (FastAPI + SQLite backend, React + Vite frontend) that runs a
lead-generation pipeline for US trade shows:

```
[ Discover Events ]  →  [ Collect Exhibitors ]  →  [ AI Qualify ]  →
[ Generate Outreach Drafts ]  →  [ Review/Approve ]  →  [ Gmail Draft / Send ]
        ↘ live SSE job monitor (every step visible)          ↘ reply + open tracking
```

**Everything is displayed with a verifiable source link.** The system never invents companies,
contacts, dates, or scores of results.

## 2. Why this approach

- **Gemini API with the Google Search grounding tool** replaced brittle web scraping as the
  primary data source. Search grounding returns *current* results *with citations*, so the oldest
  problem of scraper demos — invented or stale data — disappears, and every record is auditable.
- **Real-page scraping (httpx + BeautifulSoup)** is still used where it's strongest: fetching the
  event's own exhibitor directory and public company websites for public contact info.
- **SQLite + SQLAlchemy** keeps the prototype self-contained (single-file DB, zero infra), and the
  CSV export maps 1:1 to Google Sheets for the sample lead database.
- **Single pipeline module** (`services/pipeline.py`) is used both by UI buttons and by the daily
  scheduler, so automation and manual use are guaranteed to behave identically.
- **google-genai SDK** (the currently supported SDK) with `gemini-2.5-flash` — a stable, free-tier
  model with Search grounding support.

## 3. What is fully automated vs. manual

| Step | Automated | Manual |
|---|---|---|
| Event discovery (grounded web search + TSNN page) | ✅ fully; schedulable daily | — |
| Exhibitor collection (directory page + grounded verification) | ✅ fully; schedulable | Optionally paste an exhibitor-directory URL per event for best results |
| Public contact info extraction | ✅ runs automatically on real company sites | — |
| AI lead qualification (0–100 + notes vs your ICP) | ✅ single/bulk; schedulable | Review/edit the ICP text (persisted in Settings) |
| Outreach email drafting (per lead) | ✅ single/bulk; schedulable | **Human review & approval required** — the UI gate is enforced server-side |
| Gmail draft creation | ✅ one click | First-time OAuth connect (~2 min, one per machine) |
| Gmail sending | ✅ after approval | Explicit "Send" click per email (never auto-sent) |
| Reply detection (inbox → lead status) | ✅ "Check Now" or daily schedule | One-click review of detected replies |
| Open tracking | ✅ pixel embedded automatically | Set `TRACKING_BASE_URL` to a public host for real recipients |
| Duplicate-outreach guard | ✅ always on (checks Gmail SENT) | — |
| Verification of records (source links) | ✅ automatic; unresolvable links are dropped | Spot-check any record via its Source link |

**Human-in-the-loop by design:** no email leaves Gmail without `pending_review → approved → send`,
and the backend rejects send attempts on un-approved emails.

## 4. The workflow for the requested demo (1 event / ~20 exhibitors / 10+ qualified leads)

1. **Trade Shows → Discover Events** — pick industry + location. Watch the live feed run real
   Google searches. Result: real events with official websites + source links.
2. **(Optional) Edit an event** → paste its official exhibitor-directory URL if you know it.
3. **Collect Exhibitors** (⚡ on the event card) — the pipeline fetches real directory pages
   (verified by being fetched), resolves official websites via grounded search, and extracts
   public emails/phones from real company sites. The feed reports exactly what was found.
4. **Leads → select → Bulk AI Qualify** (saved ICP prefilled) — Gemini scores each lead.
5. **Outreach → Bulk Generate** — pick the event, select its qualified leads, drafts appear in
   Pending Review.
6. **Review → Approve → Create Gmail Draft / Send** (requires the one-time Gmail connect).
7. **Reports** — stats, real score buckets, detected replies, AI strategy tips.
8. **Export Leads CSV** — the sample lead database with source links (Sheets-ready).

## 5. Limitations & dependencies (stated plainly)

- **Leader account:** Google Cloud OAuth credentials file is required for Gmail features
  (free, one-time). Without it, everything up to sending works.
- **Grounding quota:** Search-grounded Gemini calls are billed per prompt / per query on some
  tiers; the system batches and paces calls, and discovery is backed by honest counts.
- **Contact availability** varies by company — sites that block bots or hide emails simply yield
  no contact fields (never fake ones).
- **JS-heavy exhibitor platforms** (e.g. some directories) may resist direct scraping; the
  grounded-search path covers this, but coverage is not guaranteed at 100%.
- **Open-tracking pixel reachability:** for real recipients, host the backend publicly or tunnel
  it, and set `TRACKING_BASE_URL` accordingly.
- **Compliance posture:** only public pages, respectful delays, authorized Gmail access via
  OAuth, no bulk sends without per-email approval, no fabricated data.

## 6. Estimated costs

### One-time development effort (already implemented in this repo)
| Component | Effort |
|---|---|
| Backend pipeline + grounding + Gmail + scheduler + SSE monitor | ~5–7 dev-days |
| Frontend (7 pages, live monitor, automation UI) | ~4–6 dev-days |
| Testing, docs, demo dataset | ~1 day |

### Recurring operating costs (prototype scale, per user)
| Item | Cost |
|---|---|
| Gemini API (free tier: 2.5-flash text; grounding billed per search query on some tiers) | $0 typical for hundreds of leads/mo; heavy use ≈ $14 / 1,000 grounded search queries (per-prompt billing for 2.5 models) |
| Gmail API | $0 |
| Hosting option A: runs on your machine | $0 |
| Hosting option B: small VPS (2 vCPU, e.g. DigitalOcean/Railway) | ~$6–12 / month |
| SQLite → Postgres (managed, when scaling) | ~$15–30 / month |
| Domain + tunnel (for tracking pixel + public API) | ~$10 / year |
| **Realistic total (small team)** | **≈ $10–50 / month** |

## 7. Scaling to multiple industries, locations & events

- **More industries/locations:** event discovery is parameterized (industry + location JSON);
  the Automation page schedules a discovery per industry. Nothing else changes.
- **Scale data:** SQLite handles tens of thousands of rows fine; switch `DATABASE_URL` to
  Postgres (SQLAlchemy URL swap) for multi-user deployments.
- **Scale throughput:** the pipeline already batches Gemini calls; move to paid Gemini tier and
  rotate keys for larger volumes; queue-based workers (e.g. Celery/ARQ) can run long jobs
  out-of-process.
- **Scaling anti-fabrication:** the grounded-verification pattern (citations + fetch-verified
  links) is the core safeguard and scales unchanged.
- **Multi-user:** add auth (JWT sessions), per-user Gmail tokens keyed by user id, and per-user
  ICP profiles.
- **Deliverability:** SMB-level sending should cap daily volumes, add SPF/DKIM on the sender
  domain, and continue respecting reply/bounce signals (already tracked).

## 8. Deployed-used endpoints (summary)

Docs and interactive OpenAPI are served at `/docs` on the backend. Highlights:
`POST /api/v1/events/scrape`, `POST /api/v1/leads/scrape`, `GET /api/v1/jobs/{id}/stream` (SSE),
`POST /api/v1/leads/bulk/qualify`, `POST /api/v1/emails/generate|bulk/generate`,
`POST /api/v1/gmail/auth/connect`, `GET /api/v1/gmail/replies`, `POST /api/v1/gmail/replies/check`,
`GET /api/v1/track/open/{token}.gif`, `GET /api/v1/ai/status`,
`GET /api/v1/reports/score-buckets`, `GET /api/v1/reports/export/leads`,
`GET/POST/PUT/DELETE /api/v1/scheduler/tasks`, `POST /api/v1/scheduler/tasks/{id}/run-now`.
