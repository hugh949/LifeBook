#!/usr/bin/env bash
# Run the narration voice log dump against the Azure database.
# Similar to "docker compose logs api" but for the clone-voice diagnostic dump.
#
# Prereq: copy .env.azure.example to .env.azure and set DATABASE_URL to your Azure Postgres URL.
#
# Usage (from repo root):
#   ./scripts/dump_narration_voice_azure.sh           # dump for Harry
#   ./scripts/dump_narration_voice_azure.sh Sarah     # dump for Sarah
#   ./scripts/dump_narration_voice_azure.sh > azure_narration.log 2>&1
set -e
cd "$(dirname "$0")/.."
ENV_FILE=".env.azure"
if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE. Copy .env.azure.example to .env.azure and set DATABASE_URL." >&2
  exit 1
fi
NAME="${1:-Harry}"
# Read DATABASE_URL from .env.azure and pass via -e (avoids --env-file which some compose versions reject)
DATABASE_URL=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2- | tr -d '\r')
export DATABASE_URL
# Mount scripts so /app/scripts/dump_narration_voice_log.py exists without rebuilding the image
docker compose run --rm -e DATABASE_URL -v "$(pwd)/services/api/scripts:/app/scripts:ro" api python /app/scripts/dump_narration_voice_log.py --name "$NAME"
