"""Email open tracking — a real 1x1 GIF pixel served by this backend.

Count-only tracking: increments an open counter and a last-opened timestamp.
No user agent, IP, or profile data is stored — this is deliberately honest.
"""
import logging
from base64 import b64decode
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from database import get_db
from models import OutreachEmail

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/track", tags=["Tracking"])

# 1x1 transparent GIF
PIXEL_GIF = b64decode("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")


@router.get("/open/{token}.gif")
def track_open(token: str, db: Session = Depends(get_db)):
    """Email open pixel — increments the open counter for the matching email."""
    email = db.query(OutreachEmail).filter(OutreachEmail.tracking_token == token).first()
    if email:
        email.opens = (email.opens or 0) + 1
        email.last_opened_at = datetime.utcnow()
        db.commit()
    return Response(
        content=PIXEL_GIF,
        media_type="image/gif",
        headers={"Cache-Control": "no-store, no-cache, must-revalidate"},
    )


@router.get("/stats/{email_id}")
def tracking_stats(email_id: int, db: Session = Depends(get_db)):
    """Open stats for one outreach email."""
    email = db.query(OutreachEmail).filter(OutreachEmail.id == email_id).first()
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    return {
        "email_id": email_id,
        "opens": email.opens or 0,
        "last_opened_at": email.last_opened_at.isoformat() if email.last_opened_at else None,
    }
