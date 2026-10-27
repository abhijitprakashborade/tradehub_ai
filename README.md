# ⚡ TradeHub AI — Lead Intelligence Platform

> AI-powered trade show research, lead generation & outreach automation — built on **real,
> verifiable data** (Google-Search-grounded Gemini). No fabricated companies, no invented emails.

FastAPI · React · Gemini 2.5 Flash (Google Search grounding) · Gmail OAuth2 · Live job streaming

---

## ✨ What actually works (and how)

| Feature | Status | How it works |
|---|---|---|
| 🔍 **Event discovery** | ✅ Real | Gemini + Google **Search grounding** scans the live web for upcoming trade shows. Every event saved carries a **verifiable source link** (citation URL from the search). TSNN.com is scraped as a best-effort secondary source. |
| 👥 **Exhibitor collection** | ✅ Real | Fetches the event's real exhibitor directory page, then grounded search for real exhibitor-listing pages, then grounded exhibitor verification. **Source URLs are verified by actually fetching them** — a claimed link that doesn't load is dropped, never stored. |
| 📇 **Public contact info** | ✅ Real (data-dependent) | Regex extraction of emails/phones from companies' **real websites** (home, /contact, /about). If a site blocks robots or hides contacts, the lead honestly shows none. |
| 🤖 **AI qualification** | ✅ Real | Gemini 2.5 Flash scores each lead 0–100 against your ICP with reasoning. Batched, free-tier friendly. Already-contacted leads keep their pipeline status. |
| ✉️ **AI email generation** | ✅ Real | Personalized subject + body per lead. Failures are reported — nothing placeholder-laden is silently substituted. All drafts land in **Pending Review** (human approval required). |
| 📧 **Gmail (OAuth2 loopback)** | ✅ Real | One-click connect: backend opens Google sign-in in your browser, catches the localhost redirect, stores the token locally. Requires a Google Cloud `credentials.json`. Draft → Send, with an approval gate enforced server-side. |
| 🛡 **Duplicate guard** | ✅ Real | Checks your Gmail SENT folder (`labelIds=["SENT"]`) before any draft/send; blocks repeat outreach to the same address. |
| 💬 **Reply detection** | ✅ Real | Matches real INBOX replies to sent outreach via Gmail thread IDs. Leads auto-marked RESPONDED. Manual "Check Now" or daily automation. |
| 👁 **Open tracking** | ✅ Real | A 1×1 GIF pixel served by this backend embedded in sent mail. Count-only — no personal data collected. |
| ⏰ **Automation scheduler** | ✅ Real | Schedule any pipeline task daily (APScheduler) — event discovery, exhibitor collection, qualification, reply check, draft generation. Plus "Run Now" which executes the exact same code path. |
| 📺 **Live scrape monitor** | ✅ Real | SSE stream of every job step — you see each real Google Search query, each page fetched, each record saved. |
| 📊 **Reports & export** | ✅ Real | KPIs, real score-distribution buckets, pipeline breakdowns, CSV export (Sheets-compatible). |

### What is deliberately NOT here (honesty)
- **No fabricated fallback data.** The old version hallucinated companies/emails/phones when scraping failed. Removed. If the web has fewer exhibitors than you asked for, you get fewer.
- **No fake analytics.** Trends/scores are computed from your actual database rows.
- **Settings API-key boxes removed.** Keys live server-side in `backend/.env`, never in the browser.

---

## 🚀 Quick Start

### Prerequisites
- Python 3.11+ · Node.js 18+
- A free [Gemini API key](https://aistudio.google.com/app/apikey)
- *(Optional, for Gmail)* Google Cloud OAuth credentials — see below

### Windows (no bash required)
```bat
cd backend
python -m venv venv
venv\Scripts\pip install -r requirements.txt
copy .env.example .env   & edit .env, paste your GEMINI_API_KEY
venv\Scripts\uvicorn main:app --host 0.0.0.0 --port 8000   (keep running)

cd ..\frontend
npm install --include=dev
npm run dev
```

### macOS / Linux
```bash
bash start.sh
```

- 🎨 **Frontend** → http://localhost:5173
- 🚀 **Backend** → http://localhost:8000
- 📚 **API Docs** → http://localhost:8000/docs

> ℹ️ If `npm install` skips dev packages (`tsc` not found), run
> `npm install --include=dev` (happens when NODE_ENV=production).

---

## 📧 Gmail setup (optional, for draft/send + replies)

1. [Google Cloud Console](https://console.cloud.google.com/) → create project → enable **Gmail API**
2. **Credentials → OAuth 2.0 Client ID → Desktop app**
3. Download JSON → save as `backend/credentials/gmail_credentials.json`
4. In the app: **Reports → Gmail Integration → Connect Gmail** — your browser opens, approve, done.

Token storage: `backend/credentials/gmail_token.json` (local only). Revoke anytime from the UI.

---

## ⏰ Automation

Sidebar → **Automation** → New Automation. Task types:

| Task | What it runs daily |
|---|---|
| Discover Events | Grounded search for new real trade shows (industry/location in JSON config) |
| Collect Exhibitors | Real exhibitor pipeline for one event (`{"event_id": N, "max_leads": 50}`) |
| AI Qualify New Leads | Scores all NEW leads against `{"icp": "..."}` |
| Check Gmail Replies | Polls inbox, matches replies, marks leads RESPONDED |
| Generate Email Drafts | Drafts for QUALIFIED leads without outreach (→ Pending Review) |

Set daily hour/minute (UTC), pause/enable, **Run Now** for immediate execution, and watch any run
live in Trade Shows' built-in job monitor.

---

## 🔑 Environment Variables (`backend/.env`)

| Variable | Required | Default |
|---|---|---|
| `GEMINI_API_KEY` | ✅ | — (free at AI Studio) |
| `GEMINI_MODEL` | | `gemini-2.5-flash` (grounding-capable) |
| `DATABASE_URL` | | `sqlite:///tradehub.db` (backend dir) |
| `GMAIL_CREDENTIALS_FILE` / `GMAIL_TOKEN_FILE` | | `credentials/*.json` (backend dir) |
| `SCRAPE_DELAY_SECONDS` / `REQUEST_TIMEOUT` | | `1.5` / `30` |
| `MAX_EVENTS_PER_SOURCE` / `MAX_LEADS_PER_EVENT` | | `20` / `50` |
| `TRACKING_BASE_URL` | | `http://localhost:8000` — for real outreach set this to a publicly reachable host (e.g. a tunnel) |
| `CORS_ORIGINS` | | `http://localhost:5173` |
| `LOG_LEVEL` | | `INFO` |

> ⚠️ **Security note:** a Gemini API key once shipped inside this repo's `.env.example`.
> If you're using a key from before, **rotate it** at [AI Studio](https://aistudio.google.com/app/apikey).

---

## 🏗 Architecture

```
backend/
├── main.py                 # App + lifespan (scheduler start)
├── config.py               # Pydantic settings (cwd-independent paths)
├── database.py             # SQLAlchemy + startup migrations (enum fix, new columns)
├── models.py               # Event, Lead, OutreachEmail, EmailReply, ScheduledTask, ScrapeJob
├── schemas.py
├── routers/
│   ├── events.py / leads.py / emails.py      # CRUD + discovery endpoints
│   ├── gmail.py            # OAuth connect, drafts, send, replies
│   ├── jobs.py             # SSE log streaming (/jobs/{id}/stream)
│   ├── tracking.py         # Open-tracking pixel
│   ├── scheduler.py        # Automation CRUD + run-now
│   ├── ai.py               # Real Gemini health probe
│   └── reports.py          # Dashboard, score buckets, CSV export
└── services/
    ├── scraper.py          # Grounded discovery + real page fetching (no fabrication)
    ├── ai_service.py       # google-genai SDK, thread-offloaded calls
    ├── pipeline.py         # Single source of truth for all tasks (UI + scheduler)
    ├── gmail_service.py    # Loopback OAuth, drafts/send, sent lookups, pixel
    ├── reply_detector.py   # Thread-ID reply matching
    ├── scheduler_service.py# APScheduler wrapper
    ├── job_logger.py       # Per-job live log ring buffer (powering SSE)
    └── json_utils.py       # Balanced-brace JSON extraction

frontend/  React 18 + Vite + TS — pages for Dashboard, Trade Shows, Leads,
           Outreach, Automation, Reports, Settings + live SSE job monitor component
```

## Demo dataset
Run **Discover Events → Collect Exhibitors → Bulk AI Qualify → Generate Drafts** on one event to
produce a fully-sourced workflow sample (every row keeps its `source_url`). The Reports → Export
Leads CSV is the sample lead database with source links, ready for Google Sheets.

## License
MIT — educational and commercial use.
