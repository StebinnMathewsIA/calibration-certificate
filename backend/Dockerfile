# Prowalco calibration signing service.
# Build context is the REPO ROOT (see render.yaml dockerContext) — the backend
# validates submissions against the JSON Schema exported to shared/schema/json.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv

COPY backend/requirements.txt backend/requirements.txt
RUN pip install -r backend/requirements.txt

COPY shared/schema/json shared/schema/json
COPY backend backend

WORKDIR /srv/backend

# Render injects PORT. Startup is fail-fast: missing Supabase config, an
# unapplied schema, or a missing bucket refuses to boot (app/main.py).
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
