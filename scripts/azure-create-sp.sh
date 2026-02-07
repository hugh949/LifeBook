#!/usr/bin/env bash
# Create Azure resource group (if missing) and service principal for GitHub Actions.
# Run from repo root. Requires: az login
set -e
SUB_ID=$(az account show --query id -o tsv)
RG="rg-lifebook-v1"
LOCATION="westus3"
echo "Subscription: $SUB_ID"
echo "Resource group: $RG"
echo ""

if ! az group show --name "$RG" &>/dev/null; then
  echo "Creating resource group '$RG' in $LOCATION..."
  az group create --name "$RG" --location "$LOCATION"
  echo ""
else
  echo "Resource group '$RG' already exists."
  echo ""
fi

echo "Creating service principal 'LifeBook-GitHub' with Contributor on the resource group..."
echo "Copy the entire JSON output below into GitHub secret AZURE_CREDENTIALS."
echo ""
az ad sp create-for-rbac --name "LifeBook-GitHub" --role contributor \
  --scopes "/subscriptions/${SUB_ID}/resourceGroups/${RG}" \
  --sdk-auth
