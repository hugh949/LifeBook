#!/usr/bin/env bash
# Run LifeBook locally with Docker.
# Usage: ./scripts/run-local.sh   (or: bash scripts/run-local.sh)

set -e
cd "$(dirname "$0")/.."

# One .env at repo root (see docs/Env_Files_Where_to_Edit.md). Create from example only if missing; never overwrite.
echo "→ Using .env at repo root (creating from .env.example only if it doesn't exist)..."
cp -n .env.example .env 2>/dev/null || true

echo "→ Starting stack (db, api, web)..."
docker compose up --build

# Then open http://localhost:3000
