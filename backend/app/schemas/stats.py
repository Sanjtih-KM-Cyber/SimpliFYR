from datetime import datetime

from pydantic import BaseModel


class StatsResponse(BaseModel):
    total_events: int
    events_by_status: dict[str, int]
    events_per_second: float
    sources: int
    mappings: int
    output_profiles: int
    drift_by_status: dict[str, int]
    quarantine_pending: int


class AuditEntry(BaseModel):
    id: int
    actor: str | None
    action: str
    entity_type: str
    entity_id: int
    before: dict | None = None
    after: dict | None = None
    created_at: datetime


class ConfigResponse(BaseModel):
    auth_enabled: bool
    ai_provider: str
    ai_auto_apply: bool
    ai_auto_apply_threshold: float
    ai_review_threshold: float
    pipeline_workers: int
    pipeline_max_queue: int = 10000
    retention_days: int
    raw_retention_days: int = 0
    normalized_retention_days: int = 0
    audit_retention_days: int = 0
    rate_limit_per_minute: int
    syslog_enabled: bool = True
    syslog_udp_host: str = "127.0.0.1"
    syslog_udp_port: int = 5514
    syslog_tcp_enabled: bool = False
    syslog_tcp_port: int = 5515
    file_watch_enabled: bool = False
    kafka_ingress_enabled: bool = False
    syslog_enabled: bool
    syslog_udp_host: str
    syslog_udp_port: int
    pipeline_backend: str
    raw_store_backend: str
    cache_backend: str
    delivery_sinks: list[str]