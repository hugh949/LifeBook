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
# Use PORT from env so Azure Container Apps (default 80) and local (8000) both work
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
