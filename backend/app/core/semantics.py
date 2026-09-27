"""Shared semantic vocabulary as data (not code).

The built-in catalog lives in the `semantic_model` package; this module
persists it to the database (seeded idempotently at startup) and records
human-approved custom values so pickers, suggestions, and future model
training learn them instead of forgetting them per mapping.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import SemanticField


def seed_catalog(db: Session) -> None:
    """Idempotently ensure the built-in catalog exists as SemanticField rows."""
    from semantic_model import SEMANTIC_FIELDS

    existing = {row.name for row in db.execute(select(SemanticField)).scalars().all()}
    for name in sorted(SEMANTIC_FIELDS):
        if name in existing:
            continue
        field = SEMANTIC_FIELDS[name]
        db.add(
            SemanticField(
                name=name,
                data_type=field.data_type,
                description=field.description,
                is_custom=False,
            )
        )
    db.commit()


def register_custom_semantics(db: Session, names) -> list[str]:
    """Record human-approved custom semantic names. No commit (caller owns it).

    Returns the names actually added (already-known names are skipped).
    Matching is exact after stripping; the catalog keeps the author's
    spelling verbatim.
    """
    cleaned: list[str] = []
    for name in names or []:
        text = (name or "").strip()
        if text and text not in cleaned:
            cleaned.append(text)
    if not cleaned:
        return []
    existing = {
        row.name
        for row in db.execute(
            select(SemanticField).where(SemanticField.name.in_(cleaned))
        ).scalars().all()
    }
    added: list[str] = []
    for text in cleaned:
        if text in existing:
            continue
        db.add(SemanticField(name=text, is_custom=True))
        db.flush()
        added.append(text)
        existing.add(text)
    return added
