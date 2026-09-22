from fastapi import APIRouter, Depends, Form, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.ai.provider import get_ai_provider
from app.core.audit import log_action
from app.core.database import get_db
from app.core.engine import ProcessingEngine
from app.core.environment import get_environment
from app.core.security import require_auth, require_write
from app.core.sources import get_or_create_source, resolve_environment
from app.models import (
    Approval,
    ApprovalStatus,
    Mapping as MappingModel,
    MappingField,
    MappingStatus,
    Onboarding,
    OnboardingStatus,
    OutputProfile,
    Recipe,
    SourceVersion,
)
from app.schemas.onboarding import (
    OnboardingAnalyzeResponse,
    OnboardingApprove,
    OnboardingApproveResponse,
    OnboardingCreate,
    OnboardingResponse,
    OnboardingSuggestion,
)
from simplifyr_parsers import detect_format, extract_fields, parse

router = APIRouter(
    prefix="/onboarding",
    tags=["onboarding"],
    dependencies=[Depends(require_auth)],
)

MAX_SAMPLE = 1_000_000


def _to_response(o: Onboarding) -> OnboardingResponse:
    return OnboardingResponse(
        id=o.id,
        status=str(o.status),
        source_id=o.source_id,
        sample_payload=o.sample_payload,
        detected_format=o.detected_format,
        detected_event_family=str(o.detected_event_family),
        detected_vendor=o.detected_vendor,
        detected_product=o.detected_product,
        confidence=o.confidence,
    )


def _check_sample(raw: str) -> str:
    if not raw.strip():
        raise HTTPException(status_code=422, detail="Sample is empty")
    if len(raw.encode("utf-8")) > MAX_SAMPLE:
        raise HTTPException(status_code=413, detail="Sample too large")
    return raw


@router.post("", response_model=OnboardingResponse, status_code=201, dependencies=[Depends(require_write)])
def create_onboarding(
    payload: OnboardingCreate,
    environment: str = Depends(get_environment),
    db: Session = Depends(get_db),
):
    """Persist a fresh onboarding sample (status=pending). No side effects."""
    raw = _check_sample(payload.sample)
    env = resolve_environment(db, environment)
    detection = detect_format(raw)
    onboarding = Onboarding(
        environment_id=env.id,
        status=OnboardingStatus.PENDING,
        sample_payload=raw,
        detected_format=detection.format,
    )
    if payload.source_name and payload.source_name.strip():
        try:
            source = get_or_create_source(db, payload.source_name, environment)
            onboarding.source_id = source.id
        except ValueError:
            pass
    db.add(onboarding)
    db.commit()
    db.refresh(onboarding)
    return _to_response(onboarding)


@router.get("", response_model=list[OnboardingResponse])
def list_onboardings(db: Session = Depends(get_db)):
    return [_to_response(o) for o in db.execute(select(Onboarding).order_by(Onboarding.id.desc())).scalars().all()]


@router.get("/{onboarding_id}", response_model=OnboardingResponse)
def get_onboarding(onboarding_id: int, db: Session = Depends(get_db)):
    onboarding = db.get(Onboarding, onboarding_id)
    if onboarding is None:
        raise HTTPException(status_code=404, detail="Onboarding not found")
    return _to_response(onboarding)


@router.post("/{onboarding_id}/analyze", response_model=OnboardingAnalyzeResponse, dependencies=[Depends(require_write)])
def analyze_onboarding_by_id(onboarding_id: int, db: Session = Depends(get_db)):
    """Side-effect-free analysis: detect + parse + AI proposal, stored on the row."""
    onboarding = db.get(Onboarding, onboarding_id)
    if onboarding is None:
        raise HTTPException(status_code=404, detail="Onboarding not found")

    raw = onboarding.sample_payload
    detection = detect_format(raw)
    try:
        parsed = parse(detection.format, raw)
    except Exception:
        parsed = None
    if parsed is None:
        raise HTTPException(status_code=422, detail="Could not parse the sample")

    field_map = extract_fields(parsed, detection.format)
    source_name = None
    if onboarding.source_id is not None:
        from app.models import Source

        src = db.get(Source, onboarding.source_id)
        source_name = src.name if src else None
    proposal = get_ai_provider().propose_mapping(source=source_name, field_map=field_map, sample=raw)

    onboarding.detected_format = detection.format
    onboarding.confidence = proposal.confidence
    onboarding.status = OnboardingStatus.REVIEW
    db.commit()

    return OnboardingAnalyzeResponse(
        source=source_name,
        detected_format=detection.format,
        confidence=proposal.confidence,
        suggestions=[
            OnboardingSuggestion(
                input_field=s.input_field,
                semantic_field=s.semantic_field,
                confidence=s.confidence,
                reason=s.reason,
            )
            for s in proposal.new_field_suggestions
        ],
    )


@router.post("/{onboarding_id}/approve", response_model=OnboardingApproveResponse, dependencies=[Depends(require_write)])
def approve_onboarding(
    onboarding_id: int,
    payload: OnboardingApprove,
    environment: str = Depends(get_environment),
    db: Session = Depends(get_db),
):
    """Publish onboarding knowledge: Source -> Version -> Mapping -> Recipe.

    The approved field assignments become a PUBLISHED mapping so incoming
    events for the source process automatically from here on.
    """
    onboarding = db.get(Onboarding, onboarding_id)
    if onboarding is None:
        raise HTTPException(status_code=404, detail="Onboarding not found")
    if str(onboarding.status) in ("approved", "rejected"):
        raise HTTPException(status_code=409, detail=f"Onboarding already {onboarding.status}")

    source_name = (payload.source_name or "").strip()
    if not source_name and onboarding.source_id is not None:
        from app.models import Source

        src = db.get(Source, onboarding.source_id)
        source_name = src.name if src else ""
    if not source_name:
        raise HTTPException(status_code=422, detail="source_name is required to approve")

    raw = onboarding.sample_payload
    fields = [(f.input_field, f.semantic_field) for f in payload.fields if f.input_field.strip() and f.semantic_field.strip()]
    if not fields:
        # No human edits supplied: fall back to the AI proposal for the sample.
        detection = detect_format(raw)
        try:
            parsed = parse(detection.format, raw)
        except Exception:
            parsed = None
        if parsed is None:
            raise HTTPException(status_code=422, detail="Could not parse the sample")
        proposal = get_ai_provider().propose_mapping(
            source=source_name, field_map=extract_fields(parsed, detection.format), sample=raw
        )
        fields = [(s.input_field, s.semantic_field) for s in proposal.new_field_suggestions if s.semantic_field]
    if not fields:
        raise HTTPException(status_code=422, detail="No mappable fields found; provide fields explicitly")

    source = get_or_create_source(db, source_name, environment)
    version_row = _next_version(db, source)

    profile = None
    if payload.output_profile_id is not None:
        profile = db.get(OutputProfile, payload.output_profile_id)
        if profile is None:
            raise HTTPException(status_code=404, detail="Output profile not found")

    mapping = MappingModel(
        name=payload.mapping_name.strip() if payload.mapping_name and payload.mapping_name.strip() else f"{source.name} Mapping",
        source=source.name,
        source_version_id=version_row.id,
        status=MappingStatus.PUBLISHED,
        version=version_row_number(version_row.version),
    )
    for input_field, semantic_field in fields:
        mapping.fields.append(MappingField(input_field=input_field, semantic_field=semantic_field, confidence=1.0))
    db.add(mapping)
    db.flush()

    recipe = db.execute(select(Recipe).where(Recipe.source == source.name)).scalars().first()
    if recipe is None:
        recipe = Recipe(source=source.name, mapping_id=mapping.id, output_profile_id=profile.id if profile else None)
        db.add(recipe)
        db.flush()
    else:
        recipe.mapping_id = mapping.id
        if profile is not None:
            recipe.output_profile_id = profile.id

    onboarding.status = OnboardingStatus.APPROVED
    onboarding.source_id = source.id
    db.add(
        Approval(entity_type="onboarding", entity_id=onboarding.id, status=ApprovalStatus.APPROVED, actor="system", comment=f"approved -> mapping {mapping.name}")
    )
    log_action(
        db,
        action="approve",
        entity_type="onboarding",
        entity_id=onboarding.id,
        after={"source_id": source.id, "mapping_id": mapping.id, "recipe_id": recipe.id},
    )
    db.commit()
    db.refresh(mapping)
    db.refresh(recipe)

    from app.core.mapping_cache import invalidate_active_mapping

    invalidate_active_mapping(source.name)

    return OnboardingApproveResponse(
        onboarding_id=onboarding.id,
        source_id=source.id,
        mapping_id=mapping.id,
        mapping_version=mapping.version,
        recipe_id=recipe.id,
    )


def _next_version(db: Session, source) -> SourceVersion:
    """Allocate the next version label for a source (v1 for brand-new sources)."""
    rows = db.execute(select(SourceVersion).where(SourceVersion.source_id == source.id)).scalars().all()
    has_knowledge = (
        db.execute(select(MappingModel).where(MappingModel.source == source.name).limit(1)).first() is not None
    )
    if not rows:
        # get_or_create_source already ensured v1; reuse it for first knowledge.
        return ensure_v1(db, source)
    if not has_knowledge:
        return rows[0]
    taken = {v.version for v in rows}
    n = 2
    while f"v{n}" in taken:
        n += 1
    row = SourceVersion(source_id=source.id, version=f"v{n}", active=True)
    db.add(row)
    db.flush()
    return row


def ensure_v1(db: Session, source) -> SourceVersion:
    from app.core.sources import ensure_source_version

    return ensure_source_version(db, source)


def version_row_number(label: str) -> int:
    try:
        return int(label.lstrip("v"))
    except (ValueError, AttributeError):
        return 1


@router.post("/analyze", response_model=OnboardingAnalyzeResponse, dependencies=[Depends(require_write)])
def analyze_onboarding(
    raw: str = Form(...),
    source: str | None = Form(default=None),
    hint: str | None = Form(default=None),
    db: Session = Depends(get_db),
):
    """Legacy stateless analysis (kept for backward compatibility).

    Suggestions are advisory only — a human reviews and approves before any mapping
    is published. Prefer the persisted flow: POST /onboarding -> analyze -> approve.
    """
    if not raw.strip():
        raise HTTPException(status_code=422, detail="Sample is empty")
    if len(raw.encode("utf-8")) > MAX_SAMPLE:
        raise HTTPException(status_code=413, detail="Sample too large")

    engine = ProcessingEngine(db)
    result = engine.process_payload(
        raw, source=source, ingestion_type="onboarding"
    )
    detection = result["detection"]
    parsed = result["parsed"]

    if parsed is None:
        raise HTTPException(status_code=422, detail="Could not parse the sample")

    field_map = extract_fields(parsed, detection.format)
    proposal = get_ai_provider().propose_mapping(
        source=source, field_map=field_map, sample=raw
    )

    return OnboardingAnalyzeResponse(
        source=source,
        detected_format=detection.format,
        confidence=proposal.confidence,
        suggestions=[
            OnboardingSuggestion(
                input_field=s.input_field,
                semantic_field=s.semantic_field,
                confidence=s.confidence,
                reason=s.reason,
            )
            for s in proposal.new_field_suggestions
        ],
    )
