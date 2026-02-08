FROM python:3.11-slim

WORKDIR /app
COPY pyproject.toml /app/pyproject.toml

RUN pip install --no-cache-dir -U pip && pip install --no-cache-dir .

COPY app /app/app
COPY alembic.ini /app/alembic.ini
COPY alembic /app/alembic

EXPOSE 8000
EXPOSE 80
ENV PYTHONPATH=/app
# Unbuffered stdout/stderr so logs appear immediately in Azure Log Stream
ENV PYTHONUNBUFFERED=1
# Use PORT from env so Azure Container Apps (default 80) and local (8000) both work.
# Run migrations first; if they fail (e.g. DB unreachable), log and still start the app
# so the container stays up and health probes pass — you get logs instead of restart loops.
CMD ["sh", "-c", "alembic upgrade head || (echo '[STARTUP] Migration failed — starting API anyway. Check DATABASE_URL and DB connectivity.' >&2); exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
