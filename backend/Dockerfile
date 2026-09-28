# Simplifyr backend (API + in-process workers)
FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/backend

WORKDIR /app

# Install runtime deps first for layer caching.
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Install the shared packages (they are part of the product, not the internet).
# NOTE: ./ prefixes are load-bearing — bare names make pip search PyPI
# instead of the local folders (fails the Docker build).
COPY packages packages
RUN pip install --no-cache-dir \
    ./packages/event-model \
    ./packages/semantic-model \
    ./packages/mappings \
    ./packages/output-profiles
COPY parsers parsers
RUN pip install --no-cache-dir ./parsers

COPY backend backend

EXPOSE 8000
# Render (and most PaaS) assigns the public port via $PORT — a fixed 8000
# would leave the service unreachable after a healthy boot.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]