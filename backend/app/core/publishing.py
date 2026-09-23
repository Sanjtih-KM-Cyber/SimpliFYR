"""Shared knowledge publishing (Phase 6): Source -> Version -> Mapping -> Recipe.

Extracted from the onboarding approve flow so quarantined events can be
onboarded directly (`POST /events/{id}/onboard`) through the exact same path:
same versioning, same recipe binding, same audit trail. One implementation,
no divergent copies.
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.sources import ensure_source_version, get_or_create_source
from app.models import (
    Mapping as MappingModel,
    MappingField,
    MappingStatus,
    OutputProfile,
    Recipe,
    Source,
    SourceVersion,
)


def next_version(db: Session, source: Source) -> SourceVersion:
    """Allocate the next version label for a source (v1 for brand-new sources)."""
    rows = db.execute(select(SourceVersion).where(SourceVersion.source_id == source.id)).scalars().all()
    has_knowledge = (
        db.execute(select(MappingModel).where(MappingModel.source == source.name).limit(1)).first() is not None
    )
    if not rows:
        return ensure_source_version(db, source)
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


def version_number(label: str) -> int:
    try:
        return int(label.lstrip("v"))
    except (ValueError, AttributeError):
        return 1


def publish_mapping_knowledge(
    db: Session,
    *,
    source_name: str,
    fields: list[tuple[str, str]],
    mapping_name: str | None,
    output_profile_id: int | None,
    environment: str,
) -> tuple[Source, SourceVersion, MappingModel, Recipe]:
    """Create (or version up) the full knowledge chain for a source.

    Returns (source, version, mapping, recipe). Raises HTTPException on bad
    input so API handlers can call it directly.
    """
    cleaned = (source_name or "").strip()
    if not cleaned:
        raise HTTPException(status_code=422, detail="source_name is required")
    clean_fields = [(i.strip(), s.strip()) for i, s in fields if i.strip() and s.strip()]
    if not clean_fields:
        raise HTTPException(status_code=422, detail="Provide at least one mapped field")

    source = get_or_create_source(db, cleaned, environment)
    version_row = next_version(db, source)

    profile = None
    if output_profile_id is not None:
        profile = db.get(OutputProfile, output_profile_id)
        if profile is None:
            raise HTTPException(status_code=404, detail="Output profile not found")

    mapping = MappingModel(
        name=mapping_name.strip() if mapping_name and mapping_name.strip() else f"{source.name} Mapping",
        source=source.name,
        source_version_id=version_row.id,
        status=MappingStatus.PUBLISHED,
        version=version_number(version_row.version),
    )
    for input_field, semantic_field in clean_fields:
        mapping.fields.append(
            MappingField(input_field=input_field, semantic_field=semantic_field, confidence=1.0)
        )
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

    from app.core.mapping_cache import invalidate_active_mapping

    invalidate_active_mapping(source.name)
    return source, version_row, mapping, recipe
