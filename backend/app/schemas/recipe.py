from datetime import datetime

from pydantic import BaseModel


class RecipeCreate(BaseModel):
    source: str
    mapping_id: int
    output_profile_id: int | None = None


class RecipeResponse(BaseModel):
    id: int
    source: str
    mapping_id: int
    output_profile_id: int | None
    created_at: datetime
