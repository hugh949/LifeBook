#!/usr/bin/env bash
# Create Azure Container Registry (ACR) for LifeBook API images.
# Run from repo root. Requires: az login, resource group rg-lifebook-v1 to exist.
# After this, assign AcrPush to the LifeBook-GitHub service principal on this ACR.
set -e
RG="rg-lifebook-v1"
LOCATION="westus3"
# ACR name: 5–50 alphanumeric, globally unique. Change if taken.
ACR_NAME="${ACR_NAME:-lifebookv1acr}"

if ! az group show --name "$RG" &>/dev/null; then
  echo "Resource group '$RG' not found. Create it first:"
  echo "  az group create --name $RG --location $LOCATION"
  exit 1
fi

echo "Creating Container Registry '$ACR_NAME' in $RG ($LOCATION)..."
if az acr show --name "$ACR_NAME" &>/dev/null; then
  echo "ACR '$ACR_NAME' already exists."
else
  az acr create --resource-group "$RG" --name "$ACR_NAME" --sku Basic --location "$LOCATION"
  echo "Created."
fi

echo ""
echo "Next: In Azure Portal → Container registries → $ACR_NAME → Access control (IAM)"
echo "      Add role assignment: AcrPush → assign to 'LifeBook-GitHub'."
echo ""
echo "If you used a different ACR name, set GitHub variable AZURE_ACR_NAME=$ACR_NAME"
