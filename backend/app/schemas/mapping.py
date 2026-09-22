from datetime import datetime

from pydantic import BaseModel, Field

from app.models import EventFamily, MappingStatus


class FieldMappingSchema(BaseModel):
    input_field: str
    semantic_field: str
    transformation: dict[str, str] | None = None
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)


class MappingCreate(BaseModel):
    name: str
    source: str | None = None
    source_version_id: int | None = None
    event_family: EventFamily = EventFamily.NETWORK_TRAFFIC
    version: int = 1
    fields: list[FieldMappingSchema]


class MappingResponse(BaseModel):
    id: int
    name: str
    source: str | None = None
    source_version_id: int | None = None
    event_family: EventFamily
    version: int
    status: MappingStatus
    created_at: datetime | None = None
    fields: list[FieldMappingSchema]