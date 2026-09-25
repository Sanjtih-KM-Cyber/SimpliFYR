from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import log_action
from app.core.database import get_db
from app.core.datetimes import as_utc
from app.core.environment import get_environment
from app.core.mapping_cache import invalidate_active_mapping

from app.models import Mapping as MappingModel
from app.models import OutputProfile, Recipe
from app.schemas.recipe import RecipeCreate, RecipeResponse

router = APIRouter(prefix="/recipes", tags=["recipes"])


def _db_to_response(recipe: Recipe) -> RecipeResponse:
    return RecipeResponse(
        id=recipe.id,
        source=recipe.source,
        mapping_id=recipe.mapping_id,
        output_profile_id=recipe.output_profile_id,
        created_at=as_utc(recipe.created_at),
    )


def _validate_bindings(
    db: Session, payload: RecipeCreate
) -> tuple[MappingModel, OutputProfile | None]:
    mapping = db.get(MappingModel, payload.mapping_id)
    if mapping is None:
        raise HTTPException(status_code=404, detail="Mapping not found")
    profile = None
    if payload.output_profile_id is not None:
        profile = db.get(OutputProfile, payload.output_profile_id)
        if profile is None:
            raise HTTPException(status_code=404, detail="Output profile not found")
    return mapping, profile


@router.get("", response_model=list[RecipeResponse])
def list_recipes(environment: str = Depends(get_environment), db: Session = Depends(get_db)):
    """Recipes visible in this environment (scoped via the Source catalog)."""
    from app.core.scoping import source_names_in_env

    names = source_names_in_env(db, environment)
    if not names:
        return []
    stmt = select(Recipe).where(Recipe.source.in_(names))
    return [_db_to_response(r) for r in db.execute(stmt).scalars().all()]


@router.get("/{recipe_id}", response_model=RecipeResponse)
def get_recipe(recipe_id: int, db: Session = Depends(get_db)):
    recipe = db.get(Recipe, recipe_id)
    if recipe is None:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return _db_to_response(recipe)


@router.post(
    "", response_model=RecipeResponse, status_code=201
)
def create_recipe(
    payload: RecipeCreate,
    environment: str = Depends(get_environment),
    db: Session = Depends(get_db),
):
    source = payload.source.strip()
    if not source:
        raise HTTPException(status_code=422, detail="Source is required")
    mapping, profile = _validate_bindings(db, payload)
    from app.core.sources import get_or_create_source

    source = get_or_create_source(db, source, environment).name

    existing = db.execute(select(Recipe).where(Recipe.source == source)).scalars().first()
    if existing is not None:
        # Configure once: re-saving the recipe updates the binding in place.
        before = {
            "mapping_id": existing.mapping_id,
            "output_profile_id": existing.output_profile_id,
        }
        existing.mapping_id = mapping.id
        existing.output_profile_id = profile.id if profile else None
        db.commit()
        invalidate_active_mapping(source)
        log_action(
            db,
            action="update",
            entity_type="recipe",
            entity_id=existing.id,
            before=before,
            after={"mapping_id": mapping.id, "output_profile_id": existing.output_profile_id},
        )
        db.commit()
        db.refresh(existing)
        return _db_to_response(existing)

    recipe = Recipe(
        source=source, mapping_id=mapping.id, output_profile_id=profile.id if profile else None
    )
    db.add(recipe)
    db.commit()
    db.refresh(recipe)
    invalidate_active_mapping(source)
    log_action(
        db,
        action="create",
        entity_type="recipe",
        entity_id=recipe.id,
        after={"source": recipe.source, "mapping_id": recipe.mapping_id},
    )
    db.commit()
    return _db_to_response(recipe)


@router.delete("/{recipe_id}", status_code=204)
def delete_recipe(recipe_id: int, db: Session = Depends(get_db)):
    recipe = db.get(Recipe, recipe_id)
    if recipe is None:
        raise HTTPException(status_code=404, detail="Recipe not found")
    source = recipe.source
    before = {"source": source, "mapping_id": recipe.mapping_id}
    db.delete(recipe)
    db.commit()
    invalidate_active_mapping(source)
    log_action(db, action="delete", entity_type="recipe", entity_id=recipe_id, before=before)
    db.commit()
