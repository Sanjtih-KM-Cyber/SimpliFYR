"""Semantic field registry (§15 internal semantic representation, as data).

The built-in catalog is seeded at startup; this API lists it and accepts
human-proposed custom values. Approving a custom value anywhere (onboarding,
drift correction, manual mapping) also registers it, so team vocabulary
accumulates instead of scattering across mappings.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import log_action
from app.core.database import get_db
from app.core.datetimes import as_utc

from app.models import SemanticField

router = APIRouter(prefix="/semantic-fields", tags=["semantic-fields"])


class SemanticFieldCreate(BaseModel):
    name: str
    data_type: str = "string"
    description: str = ""


class SemanticFieldResponse(BaseModel):
    id: int
    name: str
    data_type: str
    description: str
    is_custom: bool
    created_at: datetime | None = None


def _to_response(field: SemanticField) -> SemanticFieldResponse:
    return SemanticFieldResponse(
        id=field.id,
        name=field.name,
        data_type=field.data_type,
        description=field.description or "",
        is_custom=field.is_custom,
        created_at=as_utc(field.created_at),
    )


@router.get("", response_model=list[SemanticFieldResponse])
def list_semantic_fields(db: Session = Depends(get_db)):
    rows = db.execute(select(SemanticField).order_by(SemanticField.name)).scalars().all()
    return [_to_response(f) for f in rows]


@router.post("", response_model=SemanticFieldResponse, status_code=201)
def propose_semantic_field(payload: SemanticFieldCreate, db: Session = Depends(get_db)):
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Field name is required")
    existing = db.execute(select(SemanticField).where(SemanticField.name == name)).scalars().first()
    if existing is not None:
        raise HTTPException(status_code=409, detail=f"Semantic field '{name}' is already registered")
    field = SemanticField(
        name=name,
        data_type=(payload.data_type or "string").strip() or "string",
        description=(payload.description or "").strip(),
        is_custom=True,
    )
    db.add(field)
    db.commit()
    db.refresh(field)
    log_action(db, action="create", entity_type="semantic_field", entity_id=field.id, after={"name": name})
    db.commit()
    return _to_response(field)
