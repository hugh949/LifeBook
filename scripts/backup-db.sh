#!/usr/bin/env bash
# Create a full backup of the LifeBook database (pg_dump custom format).
# Optionally upload the dump to Azure Blob Storage for retention.
#
# Usage (from repo root):
#   DATABASE_URL='postgresql+psycopg://USER:PASS@HOST:5432/lifebook' ./scripts/backup-db.sh
#
# With Azure Blob upload (optional):
#   DATABASE_URL='...' AZURE_STORAGE_ACCOUNT=myaccount AZURE_STORAGE_ACCOUNT_KEY='...' ./scripts/backup-db.sh
#
# Output: lifebook_backup_YYYYMMDD_HHMM.dump (in current directory, or upload only if Azure set)
# Requires: pg_dump (PostgreSQL client tools). For upload: az (Azure CLI).
set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

BACKUP_CONTAINER="${AZURE_STORAGE_BACKUP_CONTAINER:-lifebook-db-backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M)
OUTPUT_FILE="lifebook_backup_${TIMESTAMP}.dump"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: Set DATABASE_URL to your Postgres connection string."
  echo "Example: export DATABASE_URL='postgresql+psycopg://user:pass@host:5432/lifebook'"
  exit 1
fi

# pg_dump uses libpq; use postgresql:// if URL has postgresql+psycopg://
DUMP_URL="$DATABASE_URL"
if [[ "$DUMP_URL" == postgresql+* ]]; then
  DUMP_URL="postgresql://${DUMP_URL#*://}"
fi

echo "Creating backup: $OUTPUT_FILE"
pg_dump "$DUMP_URL" -F c -f "$OUTPUT_FILE"
echo "Backup written to $OUTPUT_FILE ($(du -h "$OUTPUT_FILE" | cut -f1))"

ACCOUNT="${AZURE_STORAGE_ACCOUNT:-}"
KEY="${AZURE_STORAGE_ACCOUNT_KEY:-}"
if [[ -n "$ACCOUNT" && -n "$KEY" ]]; then
  if ! command -v az &>/dev/null; then
    echo "Azure storage account and key set but 'az' CLI not found. Skipping upload. Install Azure CLI to upload to blob."
    exit 0
  fi
  echo "Uploading to Azure Blob container: $BACKUP_CONTAINER"
  az storage blob upload \
    --account-name "$ACCOUNT" \
    --account-key "$KEY" \
    --container-name "$BACKUP_CONTAINER" \
    --name "$OUTPUT_FILE" \
    --file "$OUTPUT_FILE" \
    --overwrite \
    --output none
  echo "Uploaded to $BACKUP_CONTAINER/$OUTPUT_FILE"
  echo "Keep local copy? Delete with: rm $OUTPUT_FILE"
else
  echo "To upload to Azure Blob, set AZURE_STORAGE_ACCOUNT and AZURE_STORAGE_ACCOUNT_KEY (optional: AZURE_STORAGE_BACKUP_CONTAINER, default: lifebook-db-backups)."
fi

echo "Done."
