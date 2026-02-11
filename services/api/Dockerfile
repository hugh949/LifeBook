FROM python:3.11-slim

# ffmpeg required for pydub to convert WebM (client) to WAV for Azure Speaker Recognition
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml /app/pyproject.toml

RUN pip install --no-cache-dir -U pip && pip install --no-cache-dir .

# BUILD_SHA from CI (e.g. github.sha) so this layer is unique per commit and not served from stale cache
ARG BUILD_SHA
RUN echo "${BUILD_SHA:-none}" > /app/.build_sha
COPY app /app/app
COPY scripts /app/scripts
COPY alembic.ini /app/alembic.ini
COPY alembic /app/alembic

EXPOSE 8000
EXPOSE 80
ENV PYTHONPATH=/app
# Unbuffered stdout/stderr so logs appear immediately in Azure Log Stream
ENV PYTHONUNBUFFERED=1
# Use PORT from env so Azure Container Apps (default 80) and local (8000) both work.
# Wait for DB to be ready, then run migrations; if migrations fail, still start the app.
CMD ["sh", "-c", "python /app/scripts/wait_for_db.py && (alembic upgrade head || echo '[STARTUP] Migration failed — starting API anyway.' >&2); exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
