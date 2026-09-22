from pydantic import BaseModel


class AnalyticsEvent(BaseModel):
    id: int
    event_id: str
    source: str | None = None
    status: str
    received_at: str
    normalized: dict


class AggregateRow(BaseModel):
    value: str
    count: int


class AnomalyHighVolume(BaseModel):
    source_ip: str
    count: int


class AnomalyScanner(BaseModel):
    source_ip: str
    distinct_destinations: int


class AnomaliesResponse(BaseModel):
    high_volume: list[AnomalyHighVolume]
    scanners: list[AnomalyScanner]


class PortScanFinding(BaseModel):
    source_ip: str
    distinct_ports: int


class BeaconingFinding(BaseModel):
    source_ip: str
    destination_ip: str
    count: int