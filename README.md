# Simplifyr

Simplify the signal. Preserve the truth.

**Simplifyr** is an enterprise Universal Log Pre-processing Framework (ULPF). It ingests
heterogeneous logs/events from perimeter network devices, understands their meaning, and
emits standardized, user-defined representations — **without losing the original event** and
**without requiring manual parser maintenance**.

> Not a SIEM, firewall, data lake, or chatbot. Simplifyr is the semantic-normalization layer
> that sits between heterogeneous event producers and downstream analytics/SIEM/ML systems.

## Principles

- **Lossless** — raw + parsed + normalized + output + provenance are all retained and traceable.
- **Vendor-agnostic & configuration-driven** — vendor knowledge is *data*, processing logic is *software*.
- **Deterministic runtime, adaptive AI** — AI is never on the hot path; it only helps with unknown/drifted events.
- **Human-in-the-loop** — intervene only on low confidence / ambiguity / policy.
- **Versioned knowledge** — a vendor's mappings never overwrite prior versions; updates are additive.

## Repository layout

```
backend/            FastAPI application (control plane, models, APIs)
frontend/           React + TypeScript + Vite + Tailwind UI
packages/           Shared, reusable domain packages
  event-model/      Event envelope + lifecycle
  semantic-model/   Semantic field registry
  mappings/         Field mapping engine
  output-profiles/  Output representation profiles
parsers/            Format parsers (Syslog, JSON, CEF, LEEF, ...)
sample-data/        Golden dataset / fixtures for tests
tests/              Unit + integration + regression suites
docs/               Design documentation
```

## Requirements

- Python 3.14+
- Node.js 20+ / npm

## Running locally (no Docker)

### 1. Backend (FastAPI)

```bash
# from repo root
python -m venv .venv
.venv\Scripts\activate          # Windows  |  source .venv/bin/activate  (macOS/Linux)
pip install -r backend\requirements.txt
```

```bash
# from backend/
uvicorn app.main:app --reload --port 8000
```

> Dev note: schema is managed by Alembic (`backend/migrations/`, auto-applied at
> startup via `init_db()`). For a clean dev DB, delete it and restart — do not
> hand-edit schema. Test DBs live in pytest tmp dirs (see `tests/conftest.py`),
> never in the repo root.

API docs: <http://127.0.0.1:8000/docs>

### 2. Frontend (Vite)

```bash
# from frontend/
npm install
npm run dev
```

Open <http://localhost:5173>. The Vite dev server proxies `/api` to the backend on port 8000.

## Tests

```bash
.venv\Scripts\python -m pytest tests -v      # from repo root
```

## Status

- **Phase 0 — Foundation** ✅
  - Monorepo structure + Git
  - FastAPI backend with SQLAlchemy (SQLite dev DB), config, health endpoint
  - Core data model (Environment, Vendor, Product, Source, SourceVersion, Mapping,
    MappingField, OutputProfile, Onboarding, Approval, Event, AuditLog)
  - React + TypeScript + Vite + Tailwind app shell (dashboard + nav + health status)
- **Phase 1 — Event Envelope + Format Detection** ✅
  - `event-model` package: Common Event Envelope (event_id, received_at, ingestion_source,
    raw_payload, content_type, metadata) — lossless by construction
  - `parsers` package: canonical `Format` enum + deterministic `detect_format()`
    (Syslog, JSON, XML, CSV, CEF, LEEF, RAW, UNKNOWN) + modular parsers
  - `POST /api/v1/ingest` (file upload or raw text → envelope → format detection →
    persist lossless raw event with SHA-256 hash; 1 MB payload limit enforced as 413)
  - Golden sample-data corpus for every supported format
  - 26 unit + integration tests passing
- **Phase 2 — Parsing** ✅
  - Modular parser system in `parsers` package: `BaseParser` interface + `PARSERS`
    registry (`get_parser()`, `parse()`) covering Syslog, JSON, XML, CSV, CEF, LEEF, Raw
  - Syslog parser extracts header (pri/timestamp/hostname) + key=value body fields
  - Parsing wired into `/api/v1/ingest`: detects → parses → persists `parsed`
    (status advances `received` → `parsed`); unparseable events fail safely
  - Additional golden datasets (VPN, IDS, auth) to demonstrate framework generality
  - 45 unit + integration tests passing
- **Phase 3 — Semantic Mapping + Normalization** ✅
  - `semantic-model` package: canonical semantic-field registry (26 fields, dotted paths,
    data types) e.g. `source.ip`, `network.action`, `identity.user`
  - `mappings` package: `FieldMapping`/`Mapping` model + normalization engine
    (`apply_mapping`, `apply_mapping_with_provenance`) with value transformations
    (e.g. `deny → BLOCKED`), nested-path support, and pass-through defaults
  - `extract_fields()` collapses format-specific parsed shapes into a flat field map so
    mappings reference stable source fields regardless of format
- `POST/GET /api/v1/mappings` CRUD; `/api/v1/ingest` accepts `mapping_id` to normalize,
  persisting `normalized` + per-field `provenance` (status → `normalized`)
  - 71 unit + integration tests passing
- **Phase 4 — Output Profiles** ✅
  - `output-profiles` package: `OutputProfile`/`OutputField` model + `apply_output_profile()`
    rendering engine (select semantic fields, nest output paths, deep-copy general view)
  - Six versioned presets seeded as data: General, SOC Investigation, Network Operations,
    SIEM, Analytics, Machine Learning
  - `POST/GET /api/v1/output-profiles` CRUD (presets auto-seeded at startup)
  - `/api/v1/ingest` accepts `output_profile_id` to render final output
    (status → `output`), completing the ingest→detect→parse→normalize→output pipeline
  - 86 unit + integration tests passing
- **Phase 5 — Provenance + Persistence / Event Explorer data layer** ✅
  - Abstract `RawStore` (protocol) with `FilesystemRawStore` (swap for MinIO/S3 later);
    every raw event is mirrored to disk (`data/raw/{event_id}.raw`) with a `raw_ref`
  - `/api/v1/events` — list (filter by status/source, paginated), `GET /{id}` detail with
    the four Explorer views (`raw`, `parsed`, `normalized`, `output`), and
    `GET /{id}/raw` (text/plain) reading from the raw store
  - 92 unit + integration tests passing
- **Phase 6 — UI** ✅
  - Full console frontend (React + TS + Vite + Tailwind) wired to the API:
    - **Dashboard** (`/`) — health + events by pipeline stage
    - **Connections** (`/connections`) — source list derived from mappings/recipes;
      **AddConnection** (`/connections/new`) wizard — paste sample → detect →
      map fields → pick profile → preview; **Connection detail**
      (`/connections/:source`) tabs: Overview / Mappings / Output / Learning /
      Needs-review
    - **Logs** (`/logs`) — Event Explorer list + detail with RAW/PARSED/
      NORMALIZED/OUTPUT tabs + provenance
    - **NeedsReview** (`/needs-review`) — drift operator console
      (analyze/approve/correct/reject)
    - **Analytics** (`/analytics`) — hunt/search, aggregation, anomalies,
      correlations
    - **Mappings / Outputs / Knowledge / Settings / Audit** — mapping editor,
      presets + custom profile builder, version tree, config, audit trail
  - Vite dev proxy forwards `/api` → backend; build and lint pass clean
  - Note: legacy pages `Drift/Events/Sources/Onboarding.tsx` were consolidated
    into `Connections/Logs/NeedsReview/AddConnection` — any reference to the
    old names is stale.
- **Phase 7 — Runtime Engine + Continuous Ingestion** ✅
  - `ProcessingEngine` — deterministic runtime: detects → parses → auto-resolves the
    active mapping by source → normalizes → renders output; unknown/unmapped/unparseable
    events are **preserved and quarantined** (fail-safe), never dropped
  - `find_active_mapping()` resolves published/approved mappings by source name so known
    sources are processed with no manual mapping reference
  - In-process `asyncio` queue + background `worker_loop` (Kafka-swappable buffer contract)
  - **Syslog UDP listener** adapter (`127.0.0.1:5514`, configurable) feeding the pipeline
  - `/api/v1/ingest` refactored through the engine and returns `status`
    (`quarantined` / `normalized` / `output`); explicit bad mapping/profile ids → 404
  - 96 unit + integration tests passing
- **Phase 8 — Drift Detection + Local AI** ✅
  - Deterministic drift detection: known source structure changed (new/renamed fields) →
    event preserved + quarantined, `DriftRecord` created (`detected`)
  - Provider-independent intelligence layer (`app/core/ai`): `HeuristicAIProvider`
    (offline, deterministic keyword + name-similarity rename detection) and an optional
    `OllamaAIProvider` (local LLM, strict JSON output, treated as untrusted); configurable
    via `ai_provider`
  - AI proposes structured mappings with confidence; **never auto-publishes**
  - Human-in-the-loop lifecycle: `/api/v1/drift` list/get, `analyze` (proposal),
    `approve` (publishes a new mapping version + reprocesses quarantined events),
    `reject`
  - Version-aware knowledge: a software update creates a new mapping version; old
    versions remain intact; reprocessing reruns quarantined events in place
  - 107 unit + integration tests passing
- **Phase 9 — Dashboards, Monitoring, Observability + Audit** ✅
  - `GET /api/v1/stats` — events by pipeline stage, events/sec, sources, mappings,
    output profiles, drift counts, quarantine pending
  - **Audit logging**: every config-changing action (create/update mapping, analyze/
    approve/reject drift, create profile) recorded with actor + before/after +
    timestamp; `GET /api/v1/audit`
  - `PATCH /api/v1/mappings/{id}` to advance mapping lifecycle (e.g. publish)
  - Frontend: live **Dashboard** stats, **NeedsReview** drift console
    (analyze/approve/correct/reject, also per-connection), **Knowledge** version
    tree, **Audit** trail (`/settings/audit`), and **Settings**
  - 110 unit + integration tests passing
- **Phase 9 — Scale** ✅
  - **Horizontal workers**: configurable `pipeline_workers` (N concurrent consumers) so
    ingestion capacity scales with workers; Kafka partitioning distributes work across
    processes later without touching the engine
  - **Batch / load endpoint** `POST /api/v1/process/batch` (one event per line) with
    throughput (`events/sec`) and latency (`avg_latency_ms`) metrics — the primary
    load-testing tool
- **Phase 10 — Enterprise Hardening** ✅
  - **Token authentication + RBAC** (opt-in via `AUTH_ENABLED`; default off for dev):
    roles `admin` / `operator` / `analyst`; reads need any authenticated role, writes
    (ingest, mapping create/publish, drift analyze/approve/reject, profile create,
    batch) need `operator`/`admin`; `HTTPBearer` + constant-time token comparison
  - **Rate limiting** on ingest (per-minute, in-process, 429)
  - **Retention** — configurable `RETENTION_DAYS` + background cleanup deleting old
    events and their raw files
  - **Secrets hygiene** — `GET /api/v1/config` exposes non-secret config only
    (never tokens/keys); tokens via env
  - 121 unit + integration tests passing; build + lint clean
- **Phase 10 — Foundations (production-readiness step 1)** ✅
  - **Alembic migrations** replace `create_all`: `backend/migrations/` with an initial
    migration for the full schema; migrations auto-apply on startup and are DB-agnostic
  - **Postgres readiness**: `psycopg2` dependency; set `DATABASE_URL` to Postgres for prod
    (SQLite remains the dev default); migrations work against either
  - **Config/secrets**: `.env.example` documents all env vars; `/api/v1/config` never
    exposes tokens/keys
  - **AI auto-onboarding**: intelligence layer gains `propose_mapping()`; new
    `POST /api/v1/onboarding/analyze` suggests a full field→semantic mapping from a fresh
    sample; the Onboarding UI has an **Auto-suggest** button that pre-fills the mapping
  - **Docker packaging**: `backend/Dockerfile`, `frontend/Dockerfile` (+ nginx), and
    `docker-compose.yml` (Postgres, Redis, MinIO, Ollama) for scale/integration
    deployment (validated with `docker compose config`; Kafka/Redis/MinIO/Postgres
    health-gated)
  - 125 unit + integration tests passing; build + lint clean
- **Phase 10 — Scale (production-readiness step 2)** ✅
  - **Pluggable backends** behind the existing interfaces, config-selected, defaulting to
    the working in-process implementations:
    - `PIPELINE_BACKEND` — `inmemory` (asyncio queue + workers) or `kafka`
      (producer publishes to `simplifyr.raw`; a consumer worker drains it) via
      `app/core/kafka_pipeline.py`
    - `RAW_STORE_BACKEND` — `filesystem` or `s3`/MinIO (`S3RawStore` implementing the
      same `RawStore` protocol; boto3, optional)
    - `CACHE_BACKEND` — `inmemory` or `redis` (`Cache` interface) powering
      **distributed rate limiting** and a **mapping cache**
  - **Mapping cache**: active mapping resolution cached by source (TTL) and invalidated
    on publish/approve — cuts DB lookups on the hot path
  - Optional scale deps in `backend/requirements-scale.txt` (kafka-python, boto3, redis)
  - Settings UI shows the active pipeline/raw-store/cache backends
  - 132 unit + integration tests passing; build + lint clean
- **Phase 10 — Delivery (production-readiness step 3)** ✅
  - **Output Delivery layer** (`app/core/delivery.py`): configurable sinks that push the
    standardized output downstream — `console`, `http` (webhook/SIEM HEC), `s3` (NDJSON
    to S3/MinIO data lake), and `kafka` (output topic). Enabled via `DELIVERY_SINKS`.
  - Engine **delivers on OUTPUT** events, **fail-safe** (a failing sink never breaks
    processing); empty sink list = no-op
  - Settings UI shows active delivery sinks; `GET /api/v1/config` exposes them
  - **Test isolation**: shared conftest `client` fixture gives each DB-bound module its
    own SQLite + raw dir (reset engine/store/cache per module) — eliminates the
    cross-module interference; lifespan now resolves the session dynamically
  - 139 unit + integration tests passing; build + lint clean
- **Phase 10 — Analytics (production-readiness step 4)** ✅
  - `GET /api/v1/analytics/search` — threat hunting over normalized events by semantic
    filters (`?filter=source.ip=10.1.1.5`), optional status
  - `GET /api/v1/analytics/aggregate` — count events grouped by a semantic field (top N)
  - `GET /api/v1/analytics/anomalies` — high-volume sources + scanner fan-out detection
  - `GET /api/v1/analytics/correlations` — rule-based detection (`port_scan`, `beaconing`)
  - Analytics UI page: hunt/search, aggregation, anomaly detection, correlations
  - 144 unit + integration tests passing; build + lint clean
- **Phase 10 — Multi-tenancy + Hardening final (production-readiness step 5)** ✅
  - **Multi-tenancy**: `Event.environment` column (new Alembic migration) + an
    `X-Environment` header scoping ingest, events, stats, and analytics — data planes are
    isolated per environment; a default environment is seeded; `GET/POST
    /api/v1/environments` manages environments
  - **Observability**: `GET /api/v1/metrics` exposes Prometheus text metrics (events,
    by-stage, drift, mappings, profiles)
  - **Config backup**: `GET/POST /api/v1/system/export|import` for environments,
    mappings, and output profiles
  - 151 unit + integration tests passing; build + lint clean; build + lint clean

## Test isolation (Phase 0 hardening)
- `tests/conftest.py` gives each test module its own tmp-dir SQLite + raw store
  (`tmp_path_factory`), resetting engine/store/cache + AI/delivery singletons.
  No `*.db` / `*_raw` litter is ever written to the repo root (both gitignored).
- `tests/test_migrations.py` pins the Alembic head (`e7f8a9b0c2d3`) and asserts
  Phase-10 columns (`events.processing_ms`, `raw_hash`, `environment`) and
  tables (`destinations`, `recipes`) exist on a fresh migrate.
- Legacy per-file `client` fixtures and hardcoded `test_*_raw` paths were
  removed — all DB-bound tests use the shared fixture and resolve the raw dir
  via `get_raw_store().base_dir`.

## Phase 1 — Core correctness

- **Source identity (§12):** the engine registers every source string as a real
  `Source` (+ `v1` `SourceVersion`) via `app/core/sources.py` — `Event.source_id`
  is always populated. Alembic `e7f8a9b0c2d3` backfills pre-existing events.
- **Knowledge catalog (§13-14):** `/api/v1/catalog` CRUD for
  vendors/products/sources/versions, environment-scoped; `POST /mappings`
  accepts `source_version_id` (source label kept in sync).
- **Onboarding E2E (§17-20/51):** `POST /onboarding` → `POST /{id}/analyze`
  (side-effect-free) → `POST /{id}/approve` publishes Source + Version +
  PUBLISHED Mapping + Recipe with Approval + audit. The AddConnection wizard
  saves through this path (legacy stateless `POST /onboarding/analyze` kept).
- **Lifecycle (§27-28):** mapping status moves forward only
  (`draft→testing→approved→published→deprecated`, jumps allowed, 422 on
  backward); every mapping transition and drift approve/correct/reject/ignore
  writes an `Approval` row + audit entry.
- **Quarantine vs DLQ (§46):** parser failures → `dlq`, unknown/drifted →
  `quarantined`; `POST /events/{id}/retry` re-runs dlq/quarantined events
  (409 otherwise). Connections report real `avg_latency_ms` from
  `events.processing_ms`.
- 193 tests passing; frontend `tsc -b && vite build` clean.

## Phase 2 — Integrity + tenancy

- **Idempotency (§58):** `POST /ingest` and `/process/batch` dedup on
  (payload hash, source, environment) — replays return the original outcome
  with `duplicate: true` and store nothing. Batch counts gained `dlq`.
- **Retention tiers (§59):** `RAW/NORMALIZED/AUDIT_RETENTION_DAYS` (default 0 =
  disabled; recommended 30/90/365 in `.env.example`). Raw tier strips raw
  files but keeps rows; events tier deletes rows; audit tier prunes audit
  logs. Legacy `RETENTION_DAYS` still works as an events-window override.
- **Multi-env knowledge (§60):** mappings/recipes/drift/connections/stats are
  scoped through the env-scoped Source catalog (`core/scoping.py`) — creation
  auto-registers the source, so tenants never read each other's knowledge.
  Sourceless/global rows stay visible everywhere. UI sends `Authorization` +
  `X-Environment` (Settings page has token/environment inputs, persisted).
- **Delivery (§34-35):** `Destination` table kept and used (CRUD + engine
  fan-out with TTL cache). Kafka producer is a reused singleton; S3 sink
  uploads batched NDJSON objects (500-line/size trigger + 60s background
  flush) instead of one object per event.
- 211 tests passing; frontend `tsc -b && vite build` + `oxlint` clean.

## Phase 3 — Ingest + scale

- **Adapters (§9):** syslog UDP (existing) + TCP (`adapters/syslog_tcp.py`,
  newline-delimited, opt-in via `SYSLOG_TCP_*`) + file tail
  (`adapters/file_watcher.py`, stdlib polling, rotation-aware, opt-in via
  `FILE_WATCH_*`) + Kafka ingress (`adapters/kafka_ingress.py`, external
  topic via `KAFKA_INGRESS_*`, no-op without kafka-python). All feed the same
  pipeline envelope; all wired in `main.py:lifespan` with graceful shutdown.
- **Backpressure (§45):** in-memory queue bounded (`PIPELINE_MAX_QUEUE`,
  default 10000). Full buffer sheds async load (drop + counter) — UDP/TCP/file
  cannot propagate backpressure, so shed + metric is the correct semantics;
  HTTP/batch stay synchronous behind size limits. Depth + dropped totals in
  `/metrics` (`simplifyr_queue_depth`, `simplifyr_queue_dropped_total`).
- **Stage bus (§35):** topic map `simplifyr.{raw,parsed,normalized,output,
  quarantine,drift,dlq}` in config; shared-producer `publish_stage()` helper;
  OUTPUT events mirrored when `PIPELINE_BACKEND=kafka`.
- **Compose:** Kafka KRaft service added, Redis/MinIO/Kafka/Ollama env wired
  (`REDIS_URL`, `S3_*`, `KAFKA_*`), health-gated `depends_on`, TCP syslog
  port mapped. `docker compose config` validates clean.
- **Perf:** batch endpoint commits every 500 rows (was per-event); engine
  memoizes source identity + converted mappings/profiles per lifetime;
  `reprocess()` re-delivers new OUTPUT; drift approval rebinds stale recipes
  to the new mapping version (found by test). New index
  `ix_events_status_received_at` (migration `f8a9b0c3d4e5`).
- **Measured, not claimed:** 3000-event batch on SQLite/Windows single-thread:
  ~86 eps at ~11.5 ms avg latency (up from ~10 eps pre-Phase-3). The 11k eps
  target needs Postgres + parallel workers + Kafka — the path is built, the
  number is not claimed on SQLite.
- 221+ tests passing; frontend `tsc -b && vite build` + `oxlint` clean.

## Phase 4 — Security hardening

- **Token hashing (§39):** API tokens live only as SHA-256 hashes after load;
  `POST /api/v1/system/rotate-keys` (admin) rotates a role and returns the
  secret once, audited without persisting it. Dev default stays open
  (`AUTH_ENABLED=false`); **compose ships locked** (`AUTH_ENABLED=true`,
  600/min ingest limit, demo tokens documented for rotation).
- **OIDC-ready:** `AUTH_BACKEND=oidc` verifies bearer JWTs via JWKS
  (issuer/audience enforced, unsigned tokens never accepted); 503 with a
  clear message when PyJWT is absent.
- **Rate limiting (§39):** `X-Forwarded-For` honored only with
  `TRUST_PROXY_HEADERS=true` (nginx sends it; spoofed headers ignored
  otherwise); cache failures fail open with a warning; Redis-backed when
  configured.
- **Raw cap:** `GET /events/{id}/raw` returns 413 over `MAX_RAW_BYTES`
  (default 1 MB, aligned with ingest); larger payloads go through export.
- 228 tests passing; frontend `tsc -b && vite build` + `oxlint` clean.

## Phase 5.1 — AI flywheel (data + provider repair, all-local)

- **Proposal→correction pairs:** drift approve/correct and onboarding approve
  audit `before` (what the AI proposed) vs `after` (what the human
  published). Onboarding rows gained a `proposal` column (migration
  `a1b2c3d4e5f7`) so approve needs no extra model call.
- **`GET /api/v1/system/export-training`:** instruction-tuning JSONL —
  approvals first, then synthetic bootstrap pairs distilled from the
  heuristic rules. Deterministic 80/20 train/val split in `meta`; `?limit`
  capped. The supervision target is always the human-approved mapping.
- **Provider repair:** `OllamaAIProvider.propose_mapping` is a real method
  (was stranded module-level, never called); responses retried (3x backoff)
  and strictly schema-validated; per-call heuristic fallback
  (`analyze_drift_safe`/`propose_mapping_safe`) so one bad model response
  never breaks analysis. AI stays off the per-event hot path.
- 236 tests passing.

## Phase 5.2 — AI eval harness (the ship gate, all-local)

- **Golden corpus** (`tests/golden/records.json`, `drift_pairs.json`): 9
  records across syslog/json/xml/csv/cef/leef/raw + unknown-vendor
  abstention cases, 2 drift pairs (field rename, new enum value).
  Expectations authored from real parser output.
- **Runner** (`backend/app/core/eval.py::run_eval`): format detection,
  field-mapping micro P/R/F1, drift-rename recall, no-hallucination
  abstention. META keys excluded exactly like drift detection.
- **Baseline** (`tests/golden/baseline.json`, heuristic): F1 0.9333, drift
  1.0, abstention 1.0 — with honest headroom (port confusions) for the
  fine-tune to claim. Gate test fails any provider change scoring below it.
- 239 tests passing.

## Phase 5.3 — Local training setup + generic-model measurement (all-local)

- **Reality check first:** RTX 3050 4GB + CUDA in WSL2 confirmed; torch
  cu121 + transformers/peft/bitsandbytes installed user-space (Unsloth
  needs torch ≥ 2.8 — documented fallback `train_hf.py` uses the vanilla
  stack that works today).
- **Data ready:** `training/combine_data.py` merged export-training +
  `augment.py` output → **2435 records** (train 2188), deterministic.
- **Measured, not assumed:** generic `qwen2.5:1.5b` (Ollama, local) scores
  **F1 0.0** on the gate — it invents `source.srcip`-style fields, never
  having seen our catalog. This is precisely the gap the fine-tune closes.
- **Shippable remainder:** `training/Modelfile-simplifyr` (catalog-pinned
  system prompt, 4GB-tuned `num_gpu`), `wsl_fetch_weights.sh`
  (resume-capable HF fetch — the CDN is KB/s here, run overnight),
  `train_hf.py`, `wsl_convert.sh`, full runbook in `training/README.md`.
  Binaries/data gitignored; scripts committed. Fine-tune itself pending
  weights — one overnight command away.
- 243 tests passing.

## UX pass — real-time, honest review counts, instant ingest

- **Real-time (`frontend/src/hooks/useLive.ts`):** Dashboard subscribes to
  the existing `/api/v1/ws/live` stream (Vite already proxied WS) with
  reconnect + heartbeat skip. New events refresh stats/connections live;
  quarantined arrivals toast an info, DLQ an error. 30s polling covers
  missed frames.
- **Review counts that agree:** `quarantine_pending` now includes every open
  drift status; connections expose `open_drift`; the Home attention panel
  lists only connections with decisions pending ("N changes to review") —
  quarantined events without drift live under Logs → Needs Review instead
  of crying wolf on Home. The confusing By Pipeline Stage panel is gone.
- **Instant ingest (Logs → + Ingest):** paste or drop a file, pick the
  connection (drives its recipe), ingest immediately with result + toast —
  known sources normalize, unknown ones quarantine for review.
- **Wizard hygiene:** AddConnection analysis uses side-effect-free
  `POST /ingest/preview` (detect + parse, stores nothing) instead of an
  ingest that polluted review queues.
- 247 tests passing; frontend `tsc -b && vite build` + `oxlint` clean.

## UX pass 2 — quick parse, event actions, honest badges

- **Home Quick Parse modal:** paste/drop logs, choose a mapping, parse
  immediately — events route straight to the selected mapping, output shown
  with one-click JSON download.
- **Quarantined events are actionable now:** every quarantined event offers
  Onboard (name the connection — existing = new version, new name = new
  vendor — AI-suggested editable mapping, reprocessed on publish), Retry,
  and Delete. Same actions inline in the connection Needs Review tab, whose
  badge now equals its content (open drift + quarantined).
- **Why quarantine happens:** no mapping attached (usually: ingested without
  selecting a connection). The UI says so where it matters instead of a bare
  badge.
- **Connection Output tab** is now try-it-first: ingest box, bound-profile
  rendering, output + download on the spot; preset catalog collapsed to a
  reference section (binding still one click in the status card).
- New `POST /events/{id}/onboard|suggest`, `DELETE /events/{id}`,
  `GET /events?source=` behind the same published-knowledge path as
  onboarding (shared `core/publishing.py` — no divergent copies).
- 253 tests passing; frontend `tsc -b && vite build` + `oxlint` clean.