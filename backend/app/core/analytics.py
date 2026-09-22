from __future__ import annotations

from collections import Counter, defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Event, EventStatus

_NORMALIZED = (EventStatus.NORMALIZED, EventStatus.OUTPUT)


def _get_path(data: dict, path: str):
    value = data
    for part in path.split("."):
        if not isinstance(value, dict) or part not in value:
            return None
        value = value[part]
    return value


def _normalized_events(db: Session, environment: str = "default", status: EventStatus | None = None):
    stmt = select(Event).where(
        Event.status.in_(_NORMALIZED), Event.environment == environment
    )
    if status is not None:
        stmt = stmt.where(Event.status == status)
    for event in db.execute(stmt).scalars().all():
        if event.normalized:
            yield event


def search_events(
    db: Session,
    filters: dict[str, str],
    status: EventStatus | None = None,
    limit: int = 50,
    environment: str = "default",
) -> list[dict]:
    """Hunt over normalized events by semantic field filters (e.g. source.ip=10.1.1.5)."""
    results = []
    for event in _normalized_events(db, environment=environment, status=status):
        matched = True
        for path, expected in filters.items():
            value = _get_path(event.normalized, path)
            if value is None or str(value).lower() != expected.lower():
                matched = False
                break
        if matched:
            results.append(_summary(event))
        if len(results) >= limit:
            break
    return results


def aggregate(
    db: Session, group_by: str, limit: int = 10, environment: str = "default"
) -> list[dict]:
    """Count normalized events grouped by a semantic field value (top N)."""
    counts: Counter = Counter()
    for event in _normalized_events(db, environment=environment):
        value = _get_path(event.normalized, group_by)
        if value is not None:
            counts[str(value)] += 1
    return [{"value": value, "count": count} for value, count in counts.most_common(limit)]


def detect_anomalies(db: Session, threshold: int = 5, environment: str = "default") -> dict:
    """Flag sources with abnormally high volume or a wide fan-out (scanner-like)."""
    volume: Counter = Counter()
    fan_out: dict[str, set] = defaultdict(set)
    for event in _normalized_events(db, environment=environment):
        src = _get_path(event.normalized, "source.ip")
        dst = _get_path(event.normalized, "destination.ip")
        if src is not None:
            volume[str(src)] += 1
            if dst is not None:
                fan_out[str(src)].add(str(dst))

    high_volume = [
        {"source_ip": src, "count": count}
        for src, count in volume.items()
        if count >= threshold
    ]
    scanners = [
        {"source_ip": src, "distinct_destinations": len(dsts)}
        for src, dsts in fan_out.items()
        if len(dsts) >= threshold
    ]
    high_volume.sort(key=lambda x: x["count"], reverse=True)
    scanners.sort(key=lambda x: x["distinct_destinations"], reverse=True)
    return {"high_volume": high_volume, "scanners": scanners}


def correlate(db: Session, rule: str, threshold: int = 5, environment: str = "default") -> list[dict]:
    """Run a detection rule over normalized events."""
    if rule == "port_scan":
        # A source touching many distinct destination ports.
        ports: dict[str, set] = defaultdict(set)
        for event in _normalized_events(db, environment=environment):
            src = _get_path(event.normalized, "source.ip")
            port = _get_path(event.normalized, "destination.port")
            if src is not None and port is not None:
                ports[str(src)].add(str(port))
        findings = [
            {"source_ip": src, "distinct_ports": len(ps)}
            for src, ps in ports.items()
            if len(ps) >= threshold
        ]
        findings.sort(key=lambda x: x["distinct_ports"], reverse=True)
        return findings

    if rule == "beaconing":
        # A source repeatedly contacting a single destination (beacon-like).
        pairs: Counter = Counter()
        for event in _normalized_events(db, environment=environment):
            src = _get_path(event.normalized, "source.ip")
            dst = _get_path(event.normalized, "destination.ip")
            if src is not None and dst is not None:
                pairs[(str(src), str(dst))] += 1
        findings = [
            {"source_ip": src, "destination_ip": dst, "count": count}
            for (src, dst), count in pairs.items()
            if count >= threshold
        ]
        findings.sort(key=lambda x: x["count"], reverse=True)
        return findings

    raise ValueError(f"Unknown correlation rule: {rule}")


def _summary(event: Event) -> dict:
    return {
        "id": event.id,
        "event_id": event.event_id,
        "source": event.source,
        "status": event.status,
        "received_at": event.received_at.isoformat(),
        "normalized": event.normalized,
    }