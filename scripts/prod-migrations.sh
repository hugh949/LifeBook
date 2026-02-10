#!/usr/bin/env bash
# Run Alembic migrations against the PRODUCTION database.
# Usage: DATABASE_URL='postgresql+psycopg://USER:PASS@HOST:5432/lifebook' ./scripts/prod-migrations.sh
# Get DATABASE_URL from Azure Portal → PostgreSQL → Connection strings (or from your secrets).
set -e
cd "$(dirname "$0")/.."
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: Set DATABASE_URL to your production Postgres URL."
  echo "Example: export DATABASE_URL='postgresql+psycopg://user:pass@your-server.postgres.database.azure.com:5432/lifebook'"
  exit 1
fi
echo "Running migrations against production DB (host in DATABASE_URL)..."
cd services/api
uv run alembic upgrade head
echo "Done. Verify in Azure that the Container App can still connect."
