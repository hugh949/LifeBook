#!/usr/bin/env bash
# Run LifeBook locally with Docker.
# Usage: ./scripts/run-local.sh   (or: bash scripts/run-local.sh)

set -e
cd "$(dirname "$0")/.."

echo "→ Copying .env.example to .env (if .env missing)..."
cp -n .env.example .env 2>/dev/null || true

echo "→ Starting stack (db, api, web)..."
docker compose up --build

# Then open http://localhost:3000
