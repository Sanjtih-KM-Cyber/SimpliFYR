from datetime import datetime

from pydantic import BaseModel, field_validator


class DestinationCreate(BaseModel):
    name: str
    type: str  # console | http | s3 | kafka
    config: dict = {}
    enabled: bool = True

    @field_validator("type")
    @classmethod
    def check_type(cls, v: str) -> str:
        if v not in ("console", "http", "s3", "kafka"):
            raise ValueError("type must be one of: console, http, s3, kafka")
        return v


class DestinationUpdate(BaseModel):
    name: str | None = None
    config: dict | None = None
    enabled: bool | None = None


class DestinationResponse(BaseModel):
    id: int
    name: str
    type: str
    config: dict
    enabled: bool
    created_at: datetime


def validate_destination_config(dtype: str, config: dict) -> dict:
    if dtype == "http" and not (config.get("url") or "").strip():
        raise ValueError("HTTP destinations require a 'url' in config")
    if dtype == "s3" and not (config.get("bucket") or "").strip():
        raise ValueError("S3 destinations require a 'bucket' in config")
    if dtype == "kafka" and not (config.get("topic") or "").strip():
        raise ValueError("Kafka destinations require a 'topic' in config")
    return config
