"""
Automation scheduler — runs any pipeline task daily via APScheduler
(AsyncIOScheduler inside the FastAPI event loop). Users can also trigger
"Run Now", which executes the exact same function synchronously in a worker.

One runner function resolves the ScheduledTask -> pipeline call; the APS JOB
just calls the runner with the task id.
"""
import json
import logging
from datetime import datetime
from typing import Dict, Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from config import settings
from services import pipeline, reply_detector
from services import job_logger

logger = logging.getLogger(__name__)


def _friendly_error(error: Optional[str]) -> Optional[str]:
    if not error:
        return None
    if "429" in error or "RESOURCE_EXHAUSTED" in error or "RetryError" in error or "ClientError" in error:
        return (
            "Gemini API quota hit (most common: free-tier daily limit — it resets at "
            "midnight Pacific time; check https://ai.dev/rate-limit). If the key/plan is "
            "fine, retry in a few minutes."
        )
    return error

scheduler = AsyncIOScheduler(timezone="UTC")


async def run_task(task_id: int, job_id: Optional[int] = None) -> Dict:
    """Execute a ScheduledTask right now and record the outcome."""
    from database import SessionLocal
    from models import ScheduledTask, ScrapeJob

    db = SessionLocal()
    task = None
    try:
        task = db.query(ScheduledTask).filter(ScheduledTask.id == task_id).first()
        if not task:
            return {"ok": False, "error": f"Scheduled task {task_id} not found"}

        config = task.config_json or {}
        task.last_run_at = datetime.utcnow()
        task.last_status = "running"
        task.last_result = ""
        db.commit()

        if job_id:
            job_logger.job_start(job_id, f"⏰ Running automation '{task.name}' ({task.task_type.value})")
        else:
            # Daily-scheduler path: create the ScrapeJob row itself
            if task.task_type in ("discover_events", "scrape_leads"):
                job = ScrapeJob(
                    job_type="event_discovery" if task.task_type == "discover_events" else "exhibitor_research",
                    target_url=json.dumps(config) if config else f"scheduled:{task.name}",
                    status="pending",
                )
                db.add(job)
                db.commit()
                db.refresh(job)
                job_id = job.id
                job_logger.job_start(job_id, f"📅 Daily automation '{task.name}' started")

        if task.task_type == "discover_events":
            industries = config.get("industries") or [config.get("industry", "technology")]
            location = config.get("location", "United States")
            max_events = int(config.get("max_events", settings.MAX_EVENTS_PER_SOURCE))
            auto_collect = bool(config.get("auto_collect"))
            leads_per_event = int(config.get("leads_per_event", 20))

            total_found = 0
            total_saved = 0
            total_leads = 0
            collected_events = 0
            names = []
            discovery_error: Optional[str] = None
            duplicated_skips = 0

            for idx, industry in enumerate(industries, 1):
                if len(industries) > 1 and job_id:
                    job_logger.job_step(job_id, f"🏭 Industry {idx}/{len(industries)}: {industry}")
                result = await pipeline.discover_and_save_events(
                    industry=industry,
                    location=location,
                    max_events=max_events,
                    job_id=job_id,
                    finalize=False,
                )
                total_found += result["found"]
                total_saved += result["saved"]
                duplicated_skips += result["found"] - result["saved"]
                names.extend(result.get("saved_event_names", []))
                if result.get("error"):
                    discovery_error = result["error"]
                    if job_id:
                        job_logger.job_step(job_id, f"❌ No results for industry '{industry}': {discovery_error}", level="error")
                # Optional chained stage: collect exhibitors for the NEW events
                if auto_collect and not result.get("error"):
                    for event_id in result.get("saved_event_ids", []):
                        collected_events += 1
                        try:
                            lead_result = await pipeline.scrape_and_save_leads(
                                event_id=event_id,
                                max_leads=leads_per_event,
                                job_id=job_id,
                                finalize=False,
                            )
                        except Exception as exc:
                            job_logger.job_step(job_id, f"⚠ exhibitor collection failed for event #{event_id}: {exc}", level="warn")
                            continue
                        total_leads += lead_result["saved"]
                        # stall guard: don't chain beyond sensible per-run limits
                        if collected_events >= 10:
                            job_logger.job_step(job_id, "Chained collection capped at 10 events per run", level="warn")
                            break

            if job_id:
                if discovery_error and total_saved == 0:
                    message = f"Discovery failed: {_friendly_error(discovery_error)}"
                    pipeline.finalize_job(job_id, "failed", message)
                else:
                    parts = [f"found {total_found}", f"saved {total_saved} new event(s)"]
                    if duplicated_skips > 0:
                        parts.append(f"{duplicated_skips} duplicate(s) skipped")
                    if auto_collect:
                        parts.append(f"{total_leads} new lead(s) auto-collected from {collected_events} event(s)")
                    pipeline.finalize_job(job_id, "completed", ", ".join(parts).capitalize())
            result = {
                "found": total_found,
                "saved_events": total_saved,
                "auto_collected_events": collected_events if auto_collect else 0,
                "saved_leads": total_leads,
                "event_names": names[:10],
                **({"error": _friendly_error(discovery_error)} if discovery_error and total_saved == 0 else {}),
            }
        elif task.task_type == "scrape_leads":
            event_id = config.get("event_id")
            if not event_id:
                raise ValueError("scrape_leads requires event_id in task config")
            result = await pipeline.scrape_and_save_leads(
                event_id=int(event_id),
                max_leads=int(config.get("max_leads", settings.MAX_LEADS_PER_EVENT)),
                job_id=job_id,
            )
        elif task.task_type == "qualify_leads":
            result = await pipeline.qualify_leads(
                icp=config.get("icp"),
                lead_ids=config.get("lead_ids"),
            )
        elif task.task_type == "check_replies":
            result = await reply_detector.check_replies(auto_mark=True)
        elif task.task_type == "generate_drafts":
            result = await pipeline.generate_drafts(
                lead_ids=config.get("lead_ids"),
                sender_name=config.get("sender_name", "Your Name"),
                sender_company=config.get("sender_company", "Your Company"),
                sender_role=config.get("sender_role", "Business Development"),
                custom_notes=config.get("custom_notes"),
                tone=config.get("tone", "professional"),
                limit=int(config.get("limit", 20)),
            )
        else:
            raise ValueError(f"Unknown task type: {task.task_type}")

        task = db.query(ScheduledTask).filter(ScheduledTask.id == task_id).first()
        if task:
            task.last_status = "completed"
            task.last_result = json.dumps(result, default=str)[:2000]
            db.commit()
        return {"ok": True, "task": task.name, "result": result}

    except Exception as exc:
        logger.exception(f"Scheduled task {task_id} failed: {exc}")
        task = db.query(ScheduledTask).filter(ScheduledTask.id == task_id).first()
        if task:
            task.last_status = "failed"
            task.last_result = f"{type(exc).__name__}: {exc}"[:2000]
            db.commit()
        return {"ok": False, "task_id": task_id, "error": str(exc)}
    finally:
        db.close()


def register_all() -> None:
    """(Re)register APS jobs for every enabled ScheduledTask."""
    from database import SessionLocal
    from models import ScheduledTask

    for existing in list(scheduler.get_jobs()):
        if existing.id.startswith("task-"):
            existing.remove()

    db = SessionLocal()
    try:
        tasks = db.query(ScheduledTask).filter(ScheduledTask.enabled == True).all()  # noqa: E712
        for task in tasks:
            scheduler.add_job(
                run_task,
                trigger=CronTrigger(hour=int(task.hour), minute=int(task.minute)),
                id=f"task-{task.id}",
                replace_existing=True,
                kwargs={"task_id": task.id},
                misfire_grace_time=3600,
            )
        logger.info(f"📅 Scheduler registered {len(tasks)} daily task(s)")
    finally:
        db.close()


def start() -> None:
    if not scheduler.running:
        scheduler.start()
        register_all()


def shutdown() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
