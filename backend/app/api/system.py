from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import require_admin, require_auth, require_write
from app.models import Environment, Mapping, OutputProfile

router = APIRouter(prefix="/system", tags=["system"], dependencies=[Depends(require_auth)])


class ExportPayload(BaseModel):
    environments: list[dict]
    mappings: list[dict]
    output_profiles: list[dict]


class RotateKeysRequest(BaseModel):
    role: str


class RotateKeysResponse(BaseModel):
    role: str
    token: str

@router.post("/rotate-keys", response_model=RotateKeysResponse, dependencies=[Depends(require_admin)])
def rotate_keys(payload: RotateKeysRequest, db: Session = Depends(get_db)):
    """Rotate a role's API token (admin only). Only the hash is stored; the
    plaintext is returned once and must be saved by the caller."""
    from app.core.audit import log_action
    from app.core.security import READ_ROLES, rotate_token

    if payload.role not in READ_ROLES:
        raise HTTPException(status_code=422, detail=f"Unknown role {payload.role!r}")
    token = rotate_token(payload.role)
    # Audit the rotation without ever persisting the secret itself.
    # Roles have no table; entity_id is the stable role index (documented).
    log_action(
        db,
        action="rotate_key",
        entity_type="role",
        entity_id=list(READ_ROLES).index(payload.role),
        after={"role": payload.role},
    )
    db.commit()
    return RotateKeysResponse(role=payload.role, token=token)


@router.get("/export-training", dependencies=[Depends(require_write)])
def export_training(limit: int = 1000, db: Session = Depends(get_db)):
    """Export instruction-tuning JSONL for the AI flywheel (Phase 5.1).

    One record per line: human-approved approvals first (highest value),
    then synthetic bootstrap pairs distilled from the heuristic rules.
    Each record carries a deterministic train/val split in `meta`.
    """
    import json

    from fastapi.responses import PlainTextResponse

    from app.core.training import iter_training_records

    lines = [json.dumps(record) for record in iter_training_records(db, limit=max(1, min(limit, 10000)))]
    return PlainTextResponse("\n".join(lines) + ("\n" if lines else ""), media_type="application/x-ndjson")


@router.get("/export", response_model=ExportPayload)
def export_config(db: Session = Depends(get_db)):
    """Export non-secret configuration (environments, mappings, profiles) for backup."""
    environments = [
        {"name": e.name, "description": e.description}
        for e in db.execute(select(Environment)).scalars().all()
    ]
    mappings = [
        {
            "name": m.name,
            "source": m.source,
            "event_family": m.event_family,
            "version": m.version,
            "status": m.status,
            "fields": [
                {
                    "input_field": f.input_field,
                    "semantic_field": f.semantic_field,
                    "transformation": f.transformation,
                    "confidence": f.confidence,
                }
                for f in m.fields
            ],
        }
        for m in db.execute(select(Mapping)).scalars().all()
    ]
    profiles = [
        {"name": p.name, "description": p.description, "is_preset": p.is_preset, "schema": p.schema}
        for p in db.execute(select(OutputProfile)).scalars().all()
    ]
    return ExportPayload(
        environments=environments, mappings=mappings, output_profiles=profiles
    )


@router.post("/import", dependencies=[Depends(require_write)])
def import_config(payload: ExportPayload, db: Session = Depends(get_db)):
    """Restore environments, mappings, and output profiles from an export payload."""
    from app.models import MappingField

    created = {"environments": 0, "mappings": 0, "output_profiles": 0}

    existing_envs = {e.name for e in db.execute(select(Environment)).scalars().all()}
    for e in payload.environments:
        if e["name"] not in existing_envs:
            db.add(Environment(name=e["name"], description=e.get("description")))
            created["environments"] += 1
            existing_envs.add(e["name"])

    existing_maps = {m.name for m in db.execute(select(Mapping)).scalars().all()}
    for m in payload.mappings:
        if m["name"] in existing_maps:
            continue
        mapping = Mapping(
            name=m["name"],
            source=m.get("source"),
            event_family=m.get("event_family"),
            version=m.get("version", 1),
            status=m.get("status"),
        )
        for f in m.get("fields", []):
            mapping.fields.append(
                MappingField(
                    input_field=f["input_field"],
                    semantic_field=f["semantic_field"],
                    transformation=f.get("transformation"),
                    confidence=f.get("confidence", 1.0),
                )
            )
        db.add(mapping)
        created["mappings"] += 1
        existing_maps.add(m["name"])

    existing_profiles = {p.name for p in db.execute(select(OutputProfile)).scalars().all()}
    for p in payload.output_profiles:
        if p["name"] in existing_profiles:
            continue
        db.add(
            OutputProfile(
                name=p["name"],
                description=p.get("description"),
                is_preset=p.get("is_preset", False),
                schema=p["schema"],
            )
        )
        created["output_profiles"] += 1

    db.commit()
    return created