from sqlalchemy.orm import Session

from app.models import AuditLog


def log_action(
    db: Session,
    *,
    action: str,
    entity_type: str,
    entity_id: int,
    before: dict | None = None,
    after: dict | None = None,
    actor: str = "system",
) -> AuditLog:
    """Record a configuration-changing action for auditability."""
    entry = AuditLog(
        actor=actor,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        before=before,
        after=after,
    )
    db.add(entry)
    db.flush()
    return entry