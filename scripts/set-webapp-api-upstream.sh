#!/usr/bin/env bash
# Set the Web App's API_UPSTREAM to the Container App URL (so /api and Talk work).
# Run from repo root. Requires: az login.
#
# Uses same defaults as deploy-web: rg-lifebook-v1, app-lifebook-web-v1, aca-lifebook-api-v1.
# Override: AZURE_RESOURCE_GROUP, AZURE_WEBAPP_NAME, AZURE_CONTAINER_APP

set -e

RG="${AZURE_RESOURCE_GROUP:-rg-lifebook-v1}"
WEBAPP="${AZURE_WEBAPP_NAME:-app-lifebook-web-v1}"
CONTAINER_APP="${AZURE_CONTAINER_APP:-aca-lifebook-api-v1}"

echo "Resource group: $RG"
echo "Web App:        $WEBAPP"
echo "Container App: $CONTAINER_APP"

FQDN=$(az containerapp show -g "$RG" -n "$CONTAINER_APP" --query "properties.configuration.ingress.fqdn" -o tsv 2>/dev/null || true)
if [ -z "$FQDN" ]; then
  echo "Error: Could not get Container App FQDN. Is '$CONTAINER_APP' in '$RG'? Run: az login" >&2
  exit 1
fi

API_UPSTREAM="https://$FQDN"
echo "Container App URL: $API_UPSTREAM"

az webapp config appsettings set -g "$RG" -n "$WEBAPP" --settings API_UPSTREAM="$API_UPSTREAM" --output none
echo "Set Web App '$WEBAPP' API_UPSTREAM=$API_UPSTREAM"
