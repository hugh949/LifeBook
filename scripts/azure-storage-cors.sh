#!/usr/bin/env bash
# Set CORS on the Azure Storage Account (Blob service) so the browser can load
# images/audio from blob URLs (and upload via SAS). Run once per storage account.
#
# Without this, loading a photo from the Web App gives:
#   "Preflight response is not successful. Status code: 403"
#
# Usage (from repo root):
#   AZURE_STORAGE_ACCOUNT=lifebookv1prod AZURE_STORAGE_ACCOUNT_KEY='<key>' ./scripts/azure-storage-cors.sh
# Or set WEB_APP_ORIGIN to override the default.
#
# Requires: az login (or account key), storage account name and key.

set -e

ACCOUNT="${AZURE_STORAGE_ACCOUNT:-}"
KEY="${AZURE_STORAGE_ACCOUNT_KEY:-}"
# Web App origin (no trailing slash). Add more in ALLOWED_ORIGINS if needed.
WEB_APP_ORIGIN="${WEB_APP_ORIGIN:-https://app-lifebook-web-v1.azurewebsites.net}"
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-$WEB_APP_ORIGIN http://localhost:3000}"

if [ -z "$ACCOUNT" ] || [ -z "$KEY" ]; then
  echo "Usage: AZURE_STORAGE_ACCOUNT=<name> AZURE_STORAGE_ACCOUNT_KEY='<key>' ./scripts/azure-storage-cors.sh"
  echo "Optional: WEB_APP_ORIGIN=https://your-app.azurewebsites.net  ALLOWED_ORIGINS='origin1 origin2'"
  exit 1
fi

echo "Storage account: $ACCOUNT"
echo "Allowed origins: $ALLOWED_ORIGINS"

# Clear existing blob CORS rules then add one rule for our app(s).
# Methods: GET, HEAD (load images), PUT (upload via SAS), OPTIONS (preflight)
az storage cors clear --account-name "$ACCOUNT" --account-key "$KEY" --services b --output none
az storage cors add \
  --account-name "$ACCOUNT" \
  --account-key "$KEY" \
  --services b \
  --methods GET HEAD PUT OPTIONS \
  --origins $ALLOWED_ORIGINS \
  --allowed-headers "*" \
  --exposed-headers "*" \
  --max-age 3600 \
  --output none

echo "Blob CORS updated. Try loading a photo again in the app."
