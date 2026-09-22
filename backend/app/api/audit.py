from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import require_auth
from app.models import AuditLog
from app.schemas.stats import AuditEntry

router = APIRouter(prefix="/audit", tags=["audit"], dependencies=[Depends(require_auth)])


@router.get("", response_model=list[AuditEntry])
def list_audit(
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    rows = db.execute(select(AuditLog).order_by(AuditLog.id.desc()).limit(limit)).scalars().all()
    return [
        AuditEntry(
            id=a.id,
            actor=a.actor,
            action=a.action,
            entity_type=a.entity_type,
            entity_id=a.entity_id,
            before=a.before,
            after=a.after,
            created_at=a.created_at,
        )
        for a in rows
    ]