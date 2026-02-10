#!/usr/bin/env bash
# Run only DB + API locally (Docker). Use when you run the web app with npm run dev in apps/web.
# Then set API_UPSTREAM=http://localhost:8000 in apps/web/.env.local.
# Usage: ./scripts/local-api.sh
set -e
cd "$(dirname "$0")/.."
cp -n .env.example .env 2>/dev/null || true
echo "→ Starting db + api (no web). Use http://localhost:8000/health to check API."
echo "  To run the web app: cd apps/web && npm run dev (with API_UPSTREAM=http://localhost:8000 in .env.local)"
docker compose up --build db api
