#!/usr/bin/env bash
# Grant the LifeBook-GitHub service principal AcrPush on your ACR so GitHub Actions can push images.
# Run from repo root. Requires: az login, ACR and SP to exist.
set -e
RG="rg-lifebook-v1"
ACR_NAME="${ACR_NAME:-lifebookv1acr}"
SP_NAME="LifeBook-GitHub"

echo "Looking up service principal '$SP_NAME'..."
APP_ID=$(az ad sp list --display-name "$SP_NAME" --query "[0].appId" -o tsv)
if [ -z "$APP_ID" ] || [ "$APP_ID" = "" ]; then
  echo "Service principal '$SP_NAME' not found. Create it first with ./scripts/azure-create-sp.sh"
  exit 1
fi
echo "Found app (client) ID: $APP_ID"
echo ""

ACR_ID=$(az acr show --name "$ACR_NAME" --resource-group "$RG" --query id -o tsv 2>/dev/null || true)
if [ -z "$ACR_ID" ]; then
  echo "ACR '$ACR_NAME' not found in $RG. Create it first with ./scripts/azure-create-acr.sh"
  exit 1
fi

echo "Assigning role AcrPush to '$SP_NAME' on ACR '$ACR_NAME'..."
if az role assignment create --assignee "$APP_ID" --role AcrPush --scope "$ACR_ID" 2>/dev/null; then
  echo "Done. GitHub Actions can now push to $ACR_NAME."
elif az role assignment list --assignee "$APP_ID" --scope "$ACR_ID" --query "[?roleDefinitionName=='AcrPush']" -o tsv 2>/dev/null | grep -q .; then
  echo "AcrPush was already assigned. You're good."
else
  echo "Failed. You may need Owner or 'User Access Administrator' on the ACR or subscription."
  echo "Try in Azure Portal: ACR → IAM → Add role assignment → AcrPush → Members → search for: $APP_ID"
  exit 1
fi
