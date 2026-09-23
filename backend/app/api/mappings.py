from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import log_action
from app.core.database import get_db
from app.core.datetimes import as_utc
from app.core.environment import get_environment
from app.core.security import require_auth, require_write
from app.models import Mapping as MappingModel
from app.models import Approval, ApprovalStatus, MappingField, MappingStatus, SourceVersion
from app.schemas.mapping import MappingCreate, MappingResponse

router = APIRouter(prefix="/mappings", tags=["mappings"], dependencies=[Depends(require_auth)])


class MappingStatusUpdate(BaseModel):
    status: MappingStatus


def _db_to_response(mapping: MappingModel) -> MappingResponse:
    return MappingResponse(
        id=mapping.id,
        name=mapping.name,
        source=mapping.source,
        source_version_id=mapping.source_version_id,
        event_family=mapping.event_family,
        version=mapping.version,
        status=mapping.status,
        created_at=as_utc(mapping.created_at),
        fields=[
            {
                "input_field": f.input_field,
                "semantic_field": f.semantic_field,
                "transformation": f.transformation,
                "confidence": f.confidence,
            }
            for f in mapping.fields
        ],
    )


@router.get("", response_model=list[MappingResponse])
def list_mappings(environment: str = Depends(get_environment), db: Session = Depends(get_db)):
    """List mappings visible in this environment.

    Scoped through the env-scoped Source catalog: a mapping shows when its
    source is registered in this environment (or has no source = global
    template). Prevents cross-tenant knowledge leakage on reads.
    """
    from app.core.scoping import source_names_in_env

    names = source_names_in_env(db, environment)
    stmt = select(MappingModel)
    if names:
        stmt = stmt.where(MappingModel.source.is_(None) | MappingModel.source.in_(names))
    else:
        stmt = stmt.where(MappingModel.source.is_(None))
    return [_db_to_response(m) for m in db.execute(stmt).scalars().all()]


@router.get("/{mapping_id}", response_model=MappingResponse)
def get_mapping(mapping_id: int, db: Session = Depends(get_db)):
    mapping = db.get(MappingModel, mapping_id)
    if mapping is None:
        raise HTTPException(status_code=404, detail="Mapping not found")
    return _db_to_response(mapping)


@router.post("", response_model=MappingResponse, status_code=201, dependencies=[Depends(require_write)])
def create_mapping(
    payload: MappingCreate,
    environment: str = Depends(get_environment),
    db: Session = Depends(get_db),
):
    source_name = payload.source
    if payload.source_version_id is not None:
        version_row = db.get(SourceVersion, payload.source_version_id)
        if version_row is None:
            raise HTTPException(status_code=404, detail="Source version not found")
        # Keep the denormalized source label in sync with the linked version.
        if version_row.source is not None:
            source_name = version_row.source.name
    elif source_name is not None and source_name.strip():
        # Register the source in this environment so env-scoped reads
        # (mappings/recipes/drift/connections) can resolve it — the same
        # identity the engine creates on first ingest.
        from app.core.sources import get_or_create_source

        source_name = get_or_create_source(db, source_name, environment).name
    mapping = MappingModel(
        name=payload.name,
        source=source_name,
        source_version_id=payload.source_version_id,
        event_family=payload.event_family,
        version=payload.version,
        status=MappingStatus.DRAFT,
    )
    for field in payload.fields:
        mapping.fields.append(
            MappingField(
                input_field=field.input_field,
                semantic_field=field.semantic_field,
                transformation=field.transformation,
                confidence=field.confidence,
            )
        )
    db.add(mapping)
    db.commit()
    db.refresh(mapping)
    log_action(
        db,
        action="create",
        entity_type="mapping",
        entity_id=mapping.id,
        after={"name": mapping.name, "status": mapping.status},
    )
    db.commit()
    return _db_to_response(mapping)


# Canonical lifecycle order. Transitions must move forward (jumps allowed, e.g.
# DRAFT -> PUBLISHED in tests and one-click publishes); moving backward or
# re-activating a DEPRECATED mapping is rejected with 422.
_LIFECYCLE_ORDER = ("draft", "testing", "approved", "published", "deprecated")


def _status_key(status) -> str:
    # MappingStatus is a str-enum: str() yields "MappingStatus.draft" on some
    # versions, so normalize via .value explicitly.
    return getattr(status, "value", status)


@router.patch("/{mapping_id}", response_model=MappingResponse, dependencies=[Depends(require_write)])
def update_mapping_status(
    mapping_id: int, payload: MappingStatusUpdate, db: Session = Depends(get_db)
):
    mapping = db.get(MappingModel, mapping_id)
    if mapping is None:
        raise HTTPException(status_code=404, detail="Mapping not found")
    before = mapping.status
    try:
        before_idx = _LIFECYCLE_ORDER.index(_status_key(before))
        after_idx = _LIFECYCLE_ORDER.index(_status_key(payload.status))
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Unknown status {payload.status}")
    if after_idx < before_idx:
        raise HTTPException(
            status_code=422,
            detail=f"Cannot move mapping backward from {before} to {payload.status}",
        )
    mapping.status = payload.status
    db.commit()
    if mapping.source and payload.status == MappingStatus.PUBLISHED:
        from app.core.mapping_cache import invalidate_active_mapping

        invalidate_active_mapping(mapping.source)
    log_action(
        db,
        action="update_status",
        entity_type="mapping",
        entity_id=mapping.id,
        before={"status": before},
        after={"status": mapping.status},
    )
    db.add(
        Approval(
            entity_type="mapping",
            entity_id=mapping.id,
            status=ApprovalStatus.APPROVED,
            actor="system",
            comment=f"lifecycle {before} -> {mapping.status}",
        )
    )
    db.commit()
    db.refresh(mapping)
    return _db_to_response(mapping)