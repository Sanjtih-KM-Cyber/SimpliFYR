from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core import analytics as engine
from app.core.database import get_db
from app.core.environment import get_environment
from app.core.security import require_auth
from app.models import EventStatus
from app.schemas.analytics import (
    AggregateRow,
    AnalyticsEvent,
    AnomaliesResponse,
    AnomalyHighVolume,
    AnomalyScanner,
    BeaconingFinding,
    DedupPattern,
    DedupRequest,
    DedupResponse,
    PortScanFinding,
)

router = APIRouter(
    prefix="/analytics",
    tags=["analytics"],
    dependencies=[Depends(require_auth)],
)

_GROUPABLE = (
    "source.ip",
    "source.port",
    "destination.ip",
    "destination.port",
    "network.protocol",
    "network.action",
    "event.type",
    "event.severity",
    "identity.user",
)


@router.get("/search", response_model=list[AnalyticsEvent])
def search(
    filter: list[str] = Query(default=[]),
    status: EventStatus | None = None,
    limit: int = Query(default=50, ge=1, le=500),
    environment: str = Depends(get_environment),
    db: Session = Depends(get_db),
):
    """Hunt over normalized events by semantic filters, e.g. ?filter=source.ip=10.1.1.5."""
    filters: dict[str, str] = {}
    for item in filter:
        if "=" in item:
            key, _, value = item.partition("=")
            if value:
                filters[key] = value
    return engine.search_events(db, filters, status=status, limit=limit, environment=environment)


@router.get("/aggregate", response_model=list[AggregateRow])
def aggregate(
    group_by: str = Query(default="source.ip"),
    limit: int = Query(default=10, ge=1, le=100),
    environment: str = Depends(get_environment),
    db: Session = Depends(get_db),
):
    if group_by not in _GROUPABLE:
        raise HTTPException(status_code=422, detail=f"Unsupported group_by: {group_by}")
    return engine.aggregate(db, group_by, limit=limit, environment=environment)


@router.get("/anomalies", response_model=AnomaliesResponse)
def anomalies(
    threshold: int = Query(default=5, ge=1),
    environment: str = Depends(get_environment),
    db: Session = Depends(get_db),
):
    result = engine.detect_anomalies(db, threshold=threshold, environment=environment)
    return AnomaliesResponse(
        high_volume=[AnomalyHighVolume(**r) for r in result["high_volume"]],
        scanners=[AnomalyScanner(**r) for r in result["scanners"]],
    )


@router.get("/correlations", response_model=list[dict])
def correlations(
    rule: str = Query(default="port_scan"),
    threshold: int = Query(default=5, ge=1),
    environment: str = Depends(get_environment),
    db: Session = Depends(get_db),
):
    try:
        return engine.correlate(db, rule, threshold=threshold, environment=environment)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


_MAX_DEDUP_LINES = 10_000


@router.post("/dedup", response_model=DedupResponse)
def dedup_logs(payload: DedupRequest):
    """Collapse pasted/dropped logs pattern-wise: one entry per structural
    shape (format + field set), keeping the first log of each pattern.

    Side-effect-free: nothing is stored, so it doubles as a pre-ingest
    scout (how many shapes am I about to onboard?).
    """
    from simplifyr_parsers import detect_format, extract_fields, parse

    lines = [ln.strip() for ln in payload.raw.splitlines() if ln.strip()]
    if not lines:
        raise HTTPException(status_code=422, detail="No log lines found in payload")
    if len(lines) > _MAX_DEDUP_LINES:
        raise HTTPException(status_code=422, detail="Too many lines (max 10000)")

    groups: dict[tuple, DedupPattern] = {}
    for line in lines:
        try:
            detection = detect_format(line)
            fmt = detection.format.value
        except Exception:  # noqa: BLE001
            fmt = "unknown"
            detection = None
        fields: list[str] = []
        if detection is not None:
            try:
                parsed = parse(detection.format, line)
            except Exception:  # noqa: BLE001
                parsed = None
            if parsed is not None:
                try:
                    fields = sorted(extract_fields(parsed, detection.format).keys())
                except Exception:  # noqa: BLE001
                    fields = []
        # Unparseable lines group by exact content: identical junk collapses,
        # distinct junk stays visible instead of merging into one blob.
        key = (fmt, tuple(fields)) if fields else ("__raw__", line)
        existing = groups.get(key)
        if existing is None:
            groups[key] = DedupPattern(format=fmt, fields=fields, count=1, sample=line)
        else:
            existing.count += 1
    return DedupResponse(total=len(lines), patterns=list(groups.values()))