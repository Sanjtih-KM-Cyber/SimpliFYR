from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.formparsers import MultiPartException
from starlette.requests import Request as StarletteRequest

from app.core.config import settings
from app.core.database import init_db

# The form/multipart parser must be more permissive than the application's payload
# limit so the business rule in the ingest handler is the authority on size.
PARSER_PART_LIMIT = 4 * 1024 * 1024  # 4 MB

_original_form = StarletteRequest.form


def _form_with_larger_limit(
    self,
    *,
    max_files: int | float = 1000,
    max_fields: int | float = 1000,
    max_part_size: int = PARSER_PART_LIMIT,
):
    return _original_form(
        self,
        max_files=max_files,
        max_fields=max_fields,
        max_part_size=max_part_size,
    )


StarletteRequest.form = _form_with_larger_limit


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio

    from app.adapters import syslog_udp
    from app.core import pipeline, retention
    from app.core.database import SessionLocal
    from app.core.live import hub

    hub.set_loop(asyncio.get_running_loop())

    init_db()
    with SessionLocal() as db:
        output_profiles.seed_presets(db)
        from app.api import environments

        environments.seed_default_environment(db)

    tasks = []
    # Spawn workers for the configured pipeline backend (in-memory or Kafka).
    for i, factory in enumerate(pipeline.worker_factories()):
        tasks.append(asyncio.create_task(factory(), name=f"pipeline-worker-{i}"))

    if (
        settings.retention_days > 0
        or settings.raw_retention_days > 0
        or settings.normalized_retention_days > 0
        or settings.audit_retention_days > 0
    ):
        tasks.append(asyncio.create_task(_retention_loop(), name="retention-cleanup"))

    syslog_transport = None
    if settings.syslog_enabled:
        try:
            syslog_transport = await syslog_udp.run_udp_listener(
                settings.syslog_udp_host,
                settings.syslog_udp_port,
                syslog_udp.build_syslog_handler(),
            )
            print(
                f"syslog UDP listener on {settings.syslog_udp_host}:{settings.syslog_udp_port}"
            )
        except OSError as exc:
            print(f"syslog UDP listener not started: {exc}")

    tcp_server = None
    if settings.syslog_tcp_enabled:
        from app.adapters import syslog_tcp

        try:
            tcp_server = await syslog_tcp.run_tcp_listener(
                settings.syslog_tcp_host,
                settings.syslog_tcp_port,
                syslog_tcp.build_syslog_tcp_handler(),
            )
            print(
                f"syslog TCP listener on {settings.syslog_tcp_host}:{settings.syslog_tcp_port}"
            )
        except OSError as exc:
            print(f"syslog TCP listener not started: {exc}")

    file_watcher = None
    if settings.file_watch_enabled:
        from app.adapters.file_watcher import start_file_watcher

        file_watcher = start_file_watcher(
            settings.file_watch_path,
            interval=settings.file_watch_interval_seconds,
            source=settings.file_watch_source,
        )
        print(f"file watcher tailing {settings.file_watch_path}")

    if settings.kafka_ingress_enabled:
        from app.adapters import kafka_ingress

        loop = asyncio.get_running_loop()
        tasks.append(
            asyncio.create_task(
                loop.run_in_executor(None, kafka_ingress.run_ingress_consumer),
                name="kafka-ingress",
            )
        )

    yield

    for task in tasks:
        task.cancel()
    if syslog_transport is not None:
        syslog_transport.close()
    if tcp_server is not None:
        tcp_server.close()
    if file_watcher is not None:
        file_watcher.stop()


async def _retention_loop() -> None:
    import asyncio

    from app.core.database import SessionLocal
    from app.core.retention import run_retention_cleanup

    while True:
        await asyncio.sleep(settings.retention_interval_seconds)
        try:
            with SessionLocal() as db:
                run_retention_cleanup(db)
        except Exception:  # noqa: BLE001
            print("retention cleanup failed")


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    lifespan=lifespan,
)


@app.exception_handler(MultiPartException)
async def multipart_exception_handler(request: Request, exc: MultiPartException):
    status_code = 413 if "size" in str(exc) else 400
    return JSONResponse(status_code=status_code, content={"detail": str(exc)})


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    # Starlette converts parser size errors into a 400; present oversized payloads
    # consistently as a 413 to callers.
    detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
    if exc.status_code == 400 and "size" in detail.lower():
        return JSONResponse(
            status_code=413, content={"detail": "Payload exceeds size limit"}
        )
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": detail},
        headers=exc.headers,
    )

from app.api import analytics, audit, catalog, connections, destinations, drift, environments, events, export, health, ingest, mappings, metrics, onboarding, output_profiles, process, recipes, stats, system, ws  # noqa: E402,F401

app.include_router(health.router, prefix="/api/v1")
app.include_router(ingest.router, prefix="/api/v1")
app.include_router(process.router, prefix="/api/v1")
app.include_router(onboarding.router, prefix="/api/v1")
app.include_router(mappings.router, prefix="/api/v1")
app.include_router(catalog.router, prefix="/api/v1")
app.include_router(output_profiles.router, prefix="/api/v1")
app.include_router(events.router, prefix="/api/v1")
app.include_router(drift.router, prefix="/api/v1")
app.include_router(connections.router, prefix="/api/v1")
app.include_router(recipes.router, prefix="/api/v1")
app.include_router(destinations.router, prefix="/api/v1")
app.include_router(export.router, prefix="/api/v1")
app.include_router(ws.router, prefix="/api/v1")
app.include_router(stats.router, prefix="/api/v1")
app.include_router(audit.router, prefix="/api/v1")
app.include_router(analytics.router, prefix="/api/v1")
app.include_router(environments.router, prefix="/api/v1")
app.include_router(system.router, prefix="/api/v1")
app.include_router(metrics.router, prefix="/api/v1")