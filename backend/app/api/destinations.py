from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import log_action
from app.core.database import get_db
from app.core.destination_delivery import invalidate_destination_sinks
from app.core.security import require_auth, require_write
from app.models import Destination
from app.schemas.destination import (
    DestinationCreate,
    DestinationResponse,
    DestinationUpdate,
    validate_destination_config,
)

router = APIRouter(
    prefix="/destinations", tags=["destinations"], dependencies=[Depends(require_auth)]
)


def _db_to_response(d: Destination) -> DestinationResponse:
    return DestinationResponse(
        id=d.id,
        name=d.name,
        type=d.type,
        config=d.config or {},
        enabled=d.enabled,
        created_at=d.created_at,
    )


def _get_destination(db: Session, destination_id: int) -> Destination:
    d = db.get(Destination, destination_id)
    if d is None:
        raise HTTPException(status_code=404, detail="Destination not found")
    return d


@router.get("", response_model=list[DestinationResponse])
def list_destinations(db: Session = Depends(get_db)):
    return [_db_to_response(d) for d in db.execute(select(Destination)).scalars().all()]


@router.get("/{destination_id}", response_model=DestinationResponse)
def get_destination(destination_id: int, db: Session = Depends(get_db)):
    return _db_to_response(_get_destination(db, destination_id))


@router.post(
    "",
    response_model=DestinationResponse,
    status_code=201,
    dependencies=[Depends(require_write)],
)
def create_destination(payload: DestinationCreate, db: Session = Depends(get_db)):
    try:
        config = validate_destination_config(payload.type, payload.config)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    destination = Destination(
        name=payload.name.strip() or payload.type,
        type=payload.type,
        config=config,
        enabled=payload.enabled,
    )
    db.add(destination)
    db.commit()
    db.refresh(destination)
    invalidate_destination_sinks()
    log_action(
        db,
        action="create",
        entity_type="destination",
        entity_id=destination.id,
        after={"name": destination.name, "type": destination.type, "enabled": destination.enabled},
    )
    db.commit()
    return _db_to_response(destination)


@router.patch(
    "/{destination_id}",
    response_model=DestinationResponse,
    dependencies=[Depends(require_write)],
)
def update_destination(
    destination_id: int, payload: DestinationUpdate, db: Session = Depends(get_db)
):
    destination = _get_destination(db, destination_id)
    before = {"name": destination.name, "enabled": destination.enabled}
    if payload.name is not None:
        destination.name = payload.name.strip() or destination.name
    if payload.enabled is not None:
        destination.enabled = payload.enabled
    if payload.config is not None:
        try:
            destination.config = validate_destination_config(destination.type, payload.config)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
    db.commit()
    invalidate_destination_sinks()
    log_action(
        db,
        action="update",
        entity_type="destination",
        entity_id=destination.id,
        before=before,
        after={"name": destination.name, "enabled": destination.enabled},
    )
    db.commit()
    db.refresh(destination)
    return _db_to_response(destination)


@router.delete(
    "/{destination_id}", status_code=204, dependencies=[Depends(require_write)]
)
def delete_destination(destination_id: int, db: Session = Depends(get_db)):
    destination = _get_destination(db, destination_id)
    before = {"name": destination.name, "type": destination.type}
    db.delete(destination)
    db.commit()
    invalidate_destination_sinks()
    log_action(
        db, action="delete", entity_type="destination", entity_id=destination_id, before=before
    )
    db.commit()
