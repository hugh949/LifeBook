#!/usr/bin/env bash
# Enable blob soft delete on the Azure Storage Account so deleted or overwritten blobs
# can be recovered for a set number of days. Applies to all containers (photos, audio, etc.).
#
# Usage (from repo root):
#   AZURE_STORAGE_ACCOUNT=myaccount AZURE_STORAGE_ACCOUNT_KEY='<key>' ./scripts/azure-storage-backup-policy.sh
#
# Optional:
#   DELETE_RETENTION_DAYS=14   (default 14; range 1–365)
#
# Requires: az (Azure CLI).
set -e

ACCOUNT="${AZURE_STORAGE_ACCOUNT:-}"
KEY="${AZURE_STORAGE_ACCOUNT_KEY:-}"
DAYS="${DELETE_RETENTION_DAYS:-14}"

if [ -z "$ACCOUNT" ] || [ -z "$KEY" ]; then
  echo "Usage: AZURE_STORAGE_ACCOUNT=<name> AZURE_STORAGE_ACCOUNT_KEY='<key>' ./scripts/azure-storage-backup-policy.sh"
  echo "Optional: DELETE_RETENTION_DAYS=14 (default 14, range 1–365)"
  exit 1
fi

if ! command -v az &>/dev/null; then
  echo "ERROR: Azure CLI (az) is required. Install: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli"
  exit 1
fi

echo "Enabling blob soft delete on storage account: $ACCOUNT (retention: $DAYS days)"
az storage blob service-properties delete-policy update \
  --account-name "$ACCOUNT" \
  --account-key "$KEY" \
  --enable true \
  --days-retained "$DAYS" \
  --output none

echo "Done. Deleted or overwritten blobs in any container will be recoverable for $DAYS days."
echo "To restore a blob: Azure Portal → Storage account → Containers → container → Show deleted blobs → Undelete; or use: az storage blob undelete --account-name $ACCOUNT --container-name CONTAINER --name BLOB_NAME"
