#!/usr/bin/env bash
# Run Alembic migrations. Uses Docker so DATABASE_URL host "db" resolves.
# Usage: ./scripts/run-migrations.sh   (run from project root: LifeBook)
#
# Full path: /Users/hughrashid/Cursor/LifeBook/scripts/run-migrations.sh

set -e
cd "$(dirname "$0")/.."

echo "→ Running migrations inside API container (so host 'db' resolves)..."
docker compose run --rm api alembic upgrade head
