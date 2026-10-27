"""
Per-job live log ring buffer.

Wired into every scrape/discovery pipeline step so the frontend can stream
via SSE (GET /jobs/{id}/stream) and see exactly what the job is doing live.
"""
import threading
import time
from collections import deque
from datetime import datetime, timezone
from typing import Dict, List, Optional

MAX_ENTRIES = 500

_lock = threading.Lock()
_logs: Dict[int, deque] = {}
_status: Dict[int, str] = {}
_summary: Dict[int, str] = {}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def job_start(job_id: int, description: str) -> None:
    with _lock:
        _logs[job_id] = deque(maxlen=MAX_ENTRIES)
        _status[job_id] = "running"
        _summary[job_id] = description
        _logs[job_id].append({"ts": _now(), "level": "info", "message": f"▶ {description}"})


def job_step(job_id: int, message: str, level: str = "info") -> None:
    with _lock:
        if job_id not in _logs:
            _logs[job_id] = deque(maxlen=MAX_ENTRIES)
        _logs[job_id].append({"ts": _now(), "level": level, "message": message})


def job_done(job_id: int, status: str, message: str = "") -> None:
    with _lock:
        if job_id not in _logs:
            _logs[job_id] = deque(maxlen=MAX_ENTRIES)
        _status[job_id] = status
        _summary[job_id] = message or _summary.get(job_id, "")
        icon = "✅" if status == "completed" else "❌"
        _logs[job_id].append({"ts": _now(), "level": "info", "message": f"{icon} {status}: {message}"})


def snapshot(job_id: int) -> List[dict]:
    with _lock:
        return list(_logs.get(job_id, []))


def status(job_id: int) -> Optional[str]:
    with _lock:
        return _status.get(job_id)


def summary(job_id: int) -> Optional[str]:
    with _lock:
        return _summary.get(job_id)


def clear_old(keep_seconds: int = 3600) -> None:
    """Housekeeping hook — not time-based; ring buffer maxes anyway."""
    return None
