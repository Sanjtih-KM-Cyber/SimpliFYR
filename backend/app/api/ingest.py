from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.engine import ProcessingEngine
from app.core.environment import get_environment
from app.core.ratelimit import check_rate_limit

from app.models import Mapping as MappingModel
from app.models import OutputProfile
from app.schemas.ingest import DetectionSchema, EnvelopeSchema, IngestResponse, IngestSourceSchema, PreviewResponse
from simplifyr_parsers import Format, detect_format, parse

router = APIRouter(
    prefix="/ingest",
    tags=["ingest"],
    dependencies=[Depends(check_rate_limit)],
)

MAX_PAYLOAD = 1_000_000  # 1 MB


def _content_type_to_format(content_type: str | None) -> Format | None:
    if not content_type:
        return None
    ctype = content_type.lower()
    if "json" in ctype:
        return Format.JSON
    if "xml" in ctype:
        return Format.XML
    if "csv" in ctype:
        return Format.CSV
    return None


@router.post("", response_model=IngestResponse)
async def ingest(
    db: Session = Depends(get_db),
    environment: str = Depends(get_environment),
    file: UploadFile | None = File(default=None),
    raw: str | None = Form(default=None),
    source: str | None = Form(default=None),
    hint: Format | None = Form(default=None),
    mapping_id: int | None = Form(default=None),
    output_profile_id: int | None = Form(default=None),
) -> IngestResponse:
    """Ingest an event and run it through the deterministic processing engine.

    A source with an active mapping is processed automatically; otherwise the event
    is preserved and quarantined (fail-safe)."""
    if file is not None:
        content = (await file.read()).decode("utf-8", errors="replace")
        content_type = file.content_type or "text/plain"
        ingestion_type = "file"
        address = file.filename
    elif raw is not None:
        content = raw
        content_type = "text/plain"
        ingestion_type = "http"
        address = source
    else:
        raise HTTPException(status_code=422, detail="Provide either 'file' or 'raw'")

    if len(content.encode("utf-8")) > MAX_PAYLOAD:
        raise HTTPException(status_code=413, detail="Payload exceeds size limit")

    # Line-oriented formats (syslog/CEF/LEEF/raw) are one event per line.
    # A multi-line blob through single-event /ingest would detect+parse as
    # ONE event and silently drop lines — fail loudly and point at the
    # batch endpoint which preserves every line with its own format.
    # A JSON array is N events whether or not it spans lines — route to
    # batch so every element survives (single-event ingest would quarantine
    # it whole, and the single-event response schema cannot carry a list).
    if hint is None:
        from simplifyr_parsers import Format as _Format

        _probe_early = detect_format(content, content_type=content_type)
        if _probe_early.format == _Format.JSON:
            import json as _json_early

            try:
                _doc_early = _json_early.loads(content)
            except Exception:
                _doc_early = None
            if isinstance(_doc_early, list):
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"JSON array with {len(_doc_early)} elements: "
                        "POST /api/v1/process/batch instead (one event per element, zero loss)"
                    ),
                )

    _non_empty = [ln for ln in content.splitlines() if ln.strip()]
    if len(_non_empty) > 1 and hint is None:
        from simplifyr_parsers import Format as _Format

        _probe = detect_format(content, content_type=content_type)
        if _probe.format in (_Format.SYSLOG, _Format.CEF, _Format.LEEF, _Format.RAW):
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Multi-line {_probe.format.value} payload ({len(_non_empty)} lines): "
                    "POST /api/v1/process/batch instead (one event per line, "
                    "per-line format detection, zero loss)"
                ),
            )
        if _probe.format == _Format.JSON:
            import json as _json

            try:
                _doc = _json.loads(content)
            except Exception:
                _doc = None
            # A JSON array is N events, not one — route to batch so every
            # element survives (single-event ingest would quarantine it whole).
            if isinstance(_doc, list):
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"JSON array with {len(_doc)} elements: "
                        "POST /api/v1/process/batch instead (one event per element, zero loss)"
                    ),
                )
        if _probe.format == _Format.CSV:
            try:
                from simplifyr_parsers.detect import parse_csv as _parse_csv

                _rows = [r for r in _parse_csv(content) if any(c.strip() for c in r)]
            except Exception:
                _rows = []
            # Header + N rows = N events. Single-event ingest keeps the first
            # row only — route multi-row tables to batch.
            if len(_rows) > 2:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"CSV table with {len(_rows) - 1} rows: "
                        "POST /api/v1/process/batch instead (one event per row, zero loss)"
                    ),
                )


    if mapping_id is not None and db.get(MappingModel, mapping_id) is None:
        raise HTTPException(status_code=404, detail="Mapping not found")
    if output_profile_id is not None and db.get(OutputProfile, output_profile_id) is None:
        raise HTTPException(status_code=404, detail="Output profile not found")

    engine = ProcessingEngine(db)
    hint_used = hint or _content_type_to_format(content_type)
    result = engine.process_payload(
        content,
        source=source,
        mapping_id=mapping_id,
        output_profile_id=output_profile_id,
        content_type=content_type,
        hint=hint_used,
        environment=environment,
        ingestion_type=ingestion_type,
        address=address,
    )
    envelope = result["envelope"]

    return IngestResponse(
        envelope=EnvelopeSchema(
            event_id=envelope.event_id,
            received_at=envelope.received_at,
            ingestion_source=IngestSourceSchema(
                type=envelope.ingestion_source.type,
                address=envelope.ingestion_source.address,
            ),
            raw_payload=envelope.raw_payload,
            content_type=envelope.content_type,
            metadata=envelope.metadata,
        ),
        detection=DetectionSchema(
            format=result["detection"].format,
            confidence=result["detection"].confidence,
            detail=result["detection"].detail,
        ),
        status=result["status"].value,
        parsed=result["parsed"],
        normalized=result["normalized"],
        provenance=result["provenance"],
        output=result["output"],
        stored_event_id=result["stored_event_id"],
        duplicate=bool(result.get("duplicate", False)),
    )


@router.post("/preview", response_model=PreviewResponse)
async def preview(
    file: UploadFile | None = File(default=None),
    raw: str | None = Form(default=None),
    hint: Format | None = Form(default=None),
) -> PreviewResponse:
    """Detect + parse a sample WITHOUT storing anything.

    Side-effect-free analysis for wizards and quick inspection: no event row,
    no raw file, no drift record. Use /ingest when the event should persist.
    """
    if file is not None:
        content = (await file.read()).decode("utf-8", errors="replace")
        content_type = file.content_type or "text/plain"
    elif raw is not None:
        content = raw
        content_type = "text/plain"
    else:
        raise HTTPException(status_code=422, detail="Provide either 'file' or 'raw'")

    if not content.strip():
        raise HTTPException(status_code=422, detail="Sample is empty")
    if len(content.encode("utf-8")) > MAX_PAYLOAD:
        raise HTTPException(status_code=413, detail="Payload exceeds size limit")

    hint_used = hint or _content_type_to_format(content_type)
    detection = detect_format(content, content_type=content_type, hint=hint_used)
    try:
        parsed = parse(detection.format, content)
    except Exception:
        parsed = None
    return PreviewResponse(
        detection=DetectionSchema(
            format=detection.format,
            confidence=detection.confidence,
            detail=detection.detail,
        ),
        parsed=parsed,
    )