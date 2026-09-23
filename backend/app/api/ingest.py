from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.engine import ProcessingEngine
from app.core.environment import get_environment
from app.core.ratelimit import check_rate_limit
from app.core.security import require_write
from app.models import Mapping as MappingModel
from app.models import OutputProfile
from app.schemas.ingest import DetectionSchema, EnvelopeSchema, IngestResponse, IngestSourceSchema, PreviewResponse
from simplifyr_parsers import Format, detect_format, parse

router = APIRouter(
    prefix="/ingest",
    tags=["ingest"],
    dependencies=[Depends(require_write), Depends(check_rate_limit)],
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