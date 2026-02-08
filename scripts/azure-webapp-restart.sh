#!/usr/bin/env bash
# Restart the Azure Web App so it picks up the latest deployment or config.
# Run from repo root. Requires: az login.
#
# Override: AZURE_RESOURCE_GROUP, AZURE_WEBAPP_NAME (defaults: rg-lifebook-v1, app-lifebook-web-v1)

set -e

RG="${AZURE_RESOURCE_GROUP:-rg-lifebook-v1}"
WEBAPP="${AZURE_WEBAPP_NAME:-app-lifebook-web-v1}"

echo "Restarting Web App: $WEBAPP (resource group: $RG)"
az webapp restart -g "$RG" -n "$WEBAPP"
echo "Done. Wait a few seconds then try the site again."
