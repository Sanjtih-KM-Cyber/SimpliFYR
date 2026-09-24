from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Simplifyr"
    app_version: str = "0.1.0"

    database_url: str = "sqlite:///./simplifyr.db"

    raw_storage_dir: str = "./data/raw"

    syslog_enabled: bool = True
    syslog_udp_host: str = "127.0.0.1"
    syslog_udp_port: int = 5514

    syslog_tcp_enabled: bool = False
    syslog_tcp_host: str = "127.0.0.1"
    syslog_tcp_port: int = 5515

    file_watch_enabled: bool = False
    file_watch_path: str = "./data/inbox/app.log"
    file_watch_interval_seconds: float = 1.0

    kafka_ingress_enabled: bool = False
    kafka_ingress_topic: str = "external.logs"
    kafka_ingress_group: str = "simplifyr-ingress"

    ai_provider: str = "heuristic"  # "heuristic" (offline/deterministic), "ollama" (local LLM), "groq"/"gemini" (cloud demo keys)
    ollama_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "qwen2.5:0.5b"
    groq_api_keys: str = ""  # comma-separated; rotated with per-key cooldown
    groq_model: str = "llama-3.3-70b-versatile"
    gemini_api_keys: str = ""  # comma-separated; rotated with per-key cooldown
    gemini_model: str = "gemini-2.0-flash"

    # --- Learning / confidence-based automation ---
    # AI proposes; humans teach. When enabled, high-confidence drift proposals are
    # applied automatically; medium-confidence ones are flagged for review; low
    # confidence ones wait for human input.
    ai_auto_apply: bool = False
    ai_auto_apply_threshold: float = 0.9
    ai_review_threshold: float = 0.5

    # --- Horizontal scaling ---
    pipeline_workers: int = 1
    pipeline_max_queue: int = 10000  # in-memory buffer; full queue sheds load

    # --- Scale backends ("inmemory" = dev default; production swaps) ---
    pipeline_backend: str = "inmemory"  # "inmemory" | "kafka"
    raw_store_backend: str = "filesystem"  # "filesystem" | "s3"
    cache_backend: str = "inmemory"  # "inmemory" | "redis"

    # Kafka (used when pipeline_backend == "kafka")
    kafka_bootstrap_servers: str = "127.0.0.1:9092"
    kafka_topic_raw: str = "simplifyr.raw"
    # Stage topics (§35 event streaming architecture)
    kafka_topic_parsed: str = "simplifyr.parsed"
    kafka_topic_normalized: str = "simplifyr.normalized"
    kafka_topic_output: str = "simplifyr.output"
    kafka_topic_quarantine: str = "simplifyr.quarantine"
    kafka_topic_drift: str = "simplifyr.drift"
    kafka_topic_dlq: str = "simplifyr.dlq"

    # S3 / MinIO (used when raw_store_backend == "s3")
    s3_bucket: str = "simplifyr"
    s3_endpoint_url: str | None = None
    s3_region: str = "us-east-1"
    s3_prefix: str = "raw/"
    s3_access_key: str | None = None
    s3_secret_key: str | None = None

    # Redis (used when cache_backend == "redis")
    redis_url: str = "redis://127.0.0.1:6379"

    # --- Output Delivery (comma-separated enabled sinks; empty = none) ---
    delivery_sinks: str = ""  # e.g. "console,http,s3,kafka"
    sink_http_url: str | None = None
    sink_s3_bucket: str | None = None
    sink_s3_prefix: str = "output/"
    sink_kafka_topic: str = "simplifyr.output"

    # --- Security ---
    auth_enabled: bool = False
    api_keys: dict[str, str] = {}  # role -> token (hashed in memory at load; see security.py)
    auth_backend: str = "tokens"  # "tokens" | "oidc"
    oidc_issuer: str | None = None
    oidc_audience: str | None = None
    oidc_jwks_url: str | None = None  # defaults to {issuer}/.well-known/jwks.json
    oidc_role_claim: str = "roles"
    rate_limit_per_minute: int = 0  # 0 = unlimited (applies to ingest)
    trust_proxy_headers: bool = False  # honor X-Forwarded-For only behind a known proxy
    max_raw_bytes: int = 1_000_000  # cap for GET /events/{id}/raw responses

    # --- Retention (0 = disabled; tiers per §59, recommended 30/90/365) ---
    retention_days: int = 0  # legacy: full event delete window (overrides normalized tier if > 0)
    raw_retention_days: int = 0  # raw files older than this are deleted (rows kept)
    normalized_retention_days: int = 0  # event rows older than this are deleted
    audit_retention_days: int = 0  # audit log rows older than this are deleted
    retention_interval_seconds: int = 3600


settings = Settings()