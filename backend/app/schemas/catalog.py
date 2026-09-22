from datetime import datetime

from pydantic import BaseModel

from app.models import SourceStatus


class VendorCreate(BaseModel):
    name: str
    environment: str | None = None


class VendorResponse(BaseModel):
    id: int
    name: str
    environment_id: int
    created_at: datetime | None = None


class ProductCreate(BaseModel):
    name: str
    vendor_id: int


class ProductResponse(BaseModel):
    id: int
    name: str
    vendor_id: int
    created_at: datetime | None = None


class SourceCreate(BaseModel):
    name: str
    product_id: int | None = None
    address: str | None = None
    environment: str | None = None


class SourceStatusUpdate(BaseModel):
    status: SourceStatus | None = None
    address: str | None = None


class SourceResponse(BaseModel):
    id: int
    name: str
    environment_id: int
    product_id: int | None = None
    address: str | None = None
    status: SourceStatus
    created_at: datetime | None = None


class VersionCreate(BaseModel):
    version: str


class VersionResponse(BaseModel):
    id: int
    source_id: int
    version: str
    active: bool
    created_at: datetime | None = None
