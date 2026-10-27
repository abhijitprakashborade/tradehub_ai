"""Automation scheduler API — create, list, toggle, delete, run-now."""
import logging
from typing import Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db, SessionLocal
from models import ScheduledTask, TaskType, ScrapeJob
from services import scheduler_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/scheduler", tags=["Scheduler"])


class ScheduledTaskCreate(BaseModel):
    name: str
    task_type: TaskType
    hour: int = Field(default=9, ge=0, le=23)
    minute: int = Field(default=0, ge=0, le=59)
    enabled: bool = True
    config_json: Dict = Field(default_factory=dict)


class ScheduledTaskUpdate(BaseModel):
    name: Optional[str] = None
    hour: Optional[int] = Field(default=None, ge=0, le=23)
    minute: Optional[int] = Field(default=None, ge=0, le=59)
    enabled: Optional[bool] = None
    config_json: Optional[Dict] = None


class ScheduledTaskOut(BaseModel):
    id: int
    name: str
    task_type: str
    hour: int
    minute: int
    enabled: bool
    config_json: Optional[Dict] = None
    last_run_at: Optional[str] = None
    last_status: Optional[str] = None
    last_result: Optional[str] = None

    class Config:
        from_attributes = True


def _dump(task: ScheduledTask) -> ScheduledTaskOut:
    return ScheduledTaskOut(
        id=task.id,
        name=task.name,
        task_type=task.task_type.value if task.task_type else "unknown",
        hour=task.hour,
        minute=task.minute,
        enabled=task.enabled,
        config_json=task.config_json,
        last_run_at=task.last_run_at.isoformat() if task.last_run_at else None,
        last_status=task.last_status,
        last_result=task.last_result,
    )


@router.get("/tasks", response_model=List[ScheduledTaskOut])
def list_tasks(db: Session = Depends(get_db)):
    return [_dump(t) for t in db.query(ScheduledTask).order_by(ScheduledTask.id).all()]


@router.post("/tasks", response_model=ScheduledTaskOut, status_code=201)
def create_task(data: ScheduledTaskCreate, db: Session = Depends(get_db)):
    task = ScheduledTask(
        name=data.name,
        task_type=data.task_type,
        hour=data.hour,
        minute=data.minute,
        enabled=data.enabled,
        config_json=data.config_json,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    scheduler_service.register_all()
    return _dump(task)


@router.put("/tasks/{task_id}", response_model=ScheduledTaskOut)
def update_task(task_id: int, data: ScheduledTaskUpdate, db: Session = Depends(get_db)):
    task = db.query(ScheduledTask).filter(ScheduledTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Scheduled task not found")
    update = data.model_dump(exclude_unset=True)
    for key, value in update.items():
        setattr(task, key, value)
    db.commit()
    scheduler_service.register_all()
    return _dump(task)


@router.delete("/tasks/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db)):
    task = db.query(ScheduledTask).filter(ScheduledTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Scheduled task not found")
    db.delete(task)
    db.commit()
    scheduler_service.register_all()
    return {"message": f"Deleted scheduled task {task_id}"}


@router.post("/tasks/{task_id}/run-now")
async def run_task_now(task_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """
    Execute this task immediately with the exact same code the daily job uses.
    Runs in the background and returns the job id right away, so the UI can
    stream the run live (GET /jobs/{job_id}/stream).
    """
    task = db.query(ScheduledTask).filter(ScheduledTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Scheduled task not found")
    if task.last_status == "running":
        raise HTTPException(status_code=409, detail="This task is already running")

    # Every run gets a real ScrapeJob row so the whole run is streamable live,
    # regardless of task type.
    job = ScrapeJob(
        job_type=f"automation:{task.task_type.value}",
        target_url=f"run-now:{task.name}",
        status="pending",
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    background_tasks.add_task(scheduler_service.run_task, task.id, job.id)

    return {
        "ok": True,
        "task": task.name,
        "job_id": job.id,
        "message": f"Task '{task.name}' started — stream it live at /jobs/{job.id}/stream",
    }


@router.get("/runs")
def list_runs(db: Session = Depends(get_db)):
    """Last-run summaries across all scheduled tasks."""
    tasks = db.query(ScheduledTask).filter(ScheduledTask.last_run_at != None).order_by(  # noqa: E711
        ScheduledTask.last_run_at.desc()
    ).limit(20).all()
    return [
        {
            "task_id": t.id,
            "name": t.name,
            "task_type": t.task_type.value if t.task_type else None,
            "last_run_at": t.last_run_at.isoformat() if t.last_run_at else None,
            "last_status": t.last_status,
            "last_result": t.last_result,
        }
        for t in tasks
    ]
