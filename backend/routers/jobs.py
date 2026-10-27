"""Job log streaming (SSE) + snapshot endpoints for the live scrape viewer."""
import asyncio
import json
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from services import job_logger

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Jobs"])


@router.get("/jobs/{job_id}/stream")
async def stream_job_logs(job_id: int):
    """
    Server-Sent Events stream of live scrape/automation logs for a job.
    Terminates when the job reaches a terminal state.
    """
    done_marker = {"error": job_logger.status(job_id)}
    if done_marker["error"] is None and not job_logger.snapshot(job_id):
        # Unknown job — let the client display it as starting (job may be registered soon)
        pass

    async def event_generator():
        sent = 0
        unknown_grace = 120  # iterations job may take to register (0.5s each)
        seen_any = False
        for _ in range(3600):  # hard cap ~30 minutes at 0.5s cadence
            entries = job_logger.snapshot(job_id)
            for entry in entries[sent:]:
                payload = json.dumps(entry, default=str)
                yield f"data: {payload}\n\n"
                seen_any = True
            sent = len(entries)
            status = job_logger.status(job_id)
            if status in ("completed", "failed"):
                yield f"event: end\ndata: {json.dumps({'status': status})}\n\n"
                return
            if status is None:
                if seen_any or unknown_grace <= 0:
                    yield f"event: end\ndata: {json.dumps({'status': 'unknown'})}\n\n"
                    return
                unknown_grace -= 1
            await asyncio.sleep(0.5)
        yield f"event: end\ndata: {json.dumps({'status': 'timeout'})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/jobs/{job_id}/logs")
def get_job_logs(job_id: int):
    """Snapshot of all log entries recorded so far for a job."""
    entries = job_logger.snapshot(job_id)
    if not entries:
        raise HTTPException(status_code=404, detail="No logs for this job (it may not have started or expired)")
    return {"job_id": job_id, "status": job_logger.status(job_id), "entries": entries}
