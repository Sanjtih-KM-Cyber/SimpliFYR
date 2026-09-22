# Simplifyr Event Model

Core transport/envelope primitives shared across Simplifyr services.

Every incoming event is wrapped in a `Common Event Envelope` before processing:

- `event_id` — unique identifier
- `received_at` — ISO timestamp of receipt
- `ingestion_source` — how/where the event was received (type + address)
- `raw_payload` — the complete original event (lossless)
- `content_type` — declared media type
- `metadata` — extensible transport metadata