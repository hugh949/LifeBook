#!/usr/bin/env bash
# Run Alembic migrations via Docker (so DATABASE_URL host "db" resolves).
# If you see "column voice_participants.recall_passphrase does not exist", run this.
# Usage: ./run-migrations.sh   (from services/api)
# Or from project root: docker compose run --rm api alembic upgrade head

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_ROOT"
docker compose run --rm api alembic upgrade head
