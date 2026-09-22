from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import log_action
from app.core.database import get_db
from app.core.security import require_auth, require_write
from app.models import OutputProfile
from app.schemas.output_profile import OutputProfileCreate, OutputProfileResponse
from output_profiles import OutputProfile as PkgProfile

router = APIRouter(
    prefix="/output-profiles",
    tags=["output-profiles"],
    dependencies=[Depends(require_auth)],
)


def _db_to_response(profile: OutputProfile) -> OutputProfileResponse:
    return OutputProfileResponse(
        id=profile.id,
        name=profile.name,
        description=profile.description or "",
        is_preset=profile.is_preset,
        profile_schema=profile.schema,
    )


def seed_presets(db: Session) -> None:
    """Idempotently ensure the built-in presets exist as OutputProfile rows."""
    from output_profiles import PRESETS

    existing = {p.name for p in db.execute(select(OutputProfile)).scalars().all()}
    for preset in PRESETS:
        if preset.name in existing:
            continue
        db.add(
            OutputProfile(
                name=preset.name,
                description=preset.description,
                is_preset=True,
                schema=preset.to_schema(),
            )
        )
    db.commit()


@router.get("", response_model=list[OutputProfileResponse])
def list_output_profiles(db: Session = Depends(get_db)):
    return [
        _db_to_response(p)
        for p in db.execute(select(OutputProfile).order_by(OutputProfile.name)).scalars().all()
    ]


@router.get("/{profile_id}", response_model=OutputProfileResponse)
def get_output_profile(profile_id: int, db: Session = Depends(get_db)):
    profile = db.get(OutputProfile, profile_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Output profile not found")
    return _db_to_response(profile)


@router.post("", response_model=OutputProfileResponse, status_code=201, dependencies=[Depends(require_write)])
def create_output_profile(payload: OutputProfileCreate, db: Session = Depends(get_db)):
    schema = {
        "include_all": payload.include_all,
        "fields": [
            {"output_field": f.output_field, "from": f.from_semantic}
            for f in payload.fields
        ],
    }
    profile = OutputProfile(
        name=payload.name,
        description=payload.description,
        is_preset=False,
        schema=schema,
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)
    log_action(
        db,
        action="create",
        entity_type="output_profile",
        entity_id=profile.id,
        after={"name": profile.name, "is_preset": profile.is_preset},
    )
    db.commit()
    return _db_to_response(profile)