#!/usr/bin/env bash
# Let the Container App (API) pull images from ACR using its system-assigned Managed Identity.
# Run from repo root. Requires: az login.
# After this, the Container App can pull lifebook-api:* from your ACR without username/password.
set -e

RG="${AZURE_RESOURCE_GROUP:-rg-lifebook-v1}"
ACR_NAME="${AZURE_ACR_NAME:-lifebookv1acr}"
CONTAINER_APP="${AZURE_CONTAINER_APP:-aca-lifebook-api-v1}"

echo "Resource group: $RG"
echo "ACR:           $ACR_NAME"
echo "Container App: $CONTAINER_APP"
echo ""

# 1. Enable system-assigned identity on the Container App
echo "[1/4] Enabling system-assigned identity on Container App..."
az containerapp identity assign --resource-group "$RG" --name "$CONTAINER_APP" --system-assigned --output none 2>/dev/null || true
echo "      Waiting 5s for identity to propagate..."
sleep 5

# 2. Get the principal ID
echo "[2/4] Getting Container App principal ID..."
PRINCIPAL_ID=$(az containerapp show --resource-group "$RG" --name "$CONTAINER_APP" --query "identity.principalId" -o tsv 2>/dev/null || true)
if [ -z "$PRINCIPAL_ID" ] || [ "$PRINCIPAL_ID" = "None" ]; then
  echo "ERROR: Could not get Container App identity. Ensure system-assigned identity is On and try again."
  exit 1
fi
echo "      Principal ID: $PRINCIPAL_ID"

# 3. Get ACR resource ID and assign AcrPull via CLI (role exists in Azure even if Portal hides it)
echo "[3/4] Assigning AcrPull to Container App on ACR (can take 15-60s)..."
ACR_ID=$(az acr show --name "$ACR_NAME" --resource-group "$RG" --query id -o tsv 2>/dev/null || true)
if [ -z "$ACR_ID" ]; then
  echo "ERROR: ACR '$ACR_NAME' not found in $RG."
  exit 1
fi
if az role assignment create --assignee "$PRINCIPAL_ID" --role AcrPull --scope "$ACR_ID" 2>/dev/null; then
  echo "AcrPull assigned."
elif az role assignment list --assignee "$PRINCIPAL_ID" --scope "$ACR_ID" --query "[?roleDefinitionName=='AcrPull']" -o tsv 2>/dev/null | grep -q .; then
  echo "AcrPull already assigned."
else
  echo "WARNING: AcrPull assignment failed or not found. Trying built-in role ID..."
  # AcrPull role definition ID (same in all Azure subscriptions)
  ACR_PULL_ROLE_ID="7f951dda-4ed3-4680-a7ca-43fe172d538d"
  if az role assignment create --assignee "$PRINCIPAL_ID" --role "$ACR_PULL_ROLE_ID" --scope "$ACR_ID" 2>/dev/null; then
    echo "AcrPull (by ID) assigned."
  else
    echo "ERROR: Could not assign AcrPull. Ensure you have 'User Access Administrator' or Owner on the ACR or resource group."
    exit 1
  fi
fi

# 4. Tell the Container App to use this identity when pulling from this ACR (retry if "operation in progress")
SERVER="${ACR_NAME}.azurecr.io"
echo "[4/4] Registering ACR with Container App (retrying every 60s if app is busy)..."
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if az containerapp registry set \
    --resource-group "$RG" \
    --name "$CONTAINER_APP" \
    --server "$SERVER" \
    --identity system; then
    echo "      Registry set successfully."
    break
  fi
  if [ "$attempt" -eq 10 ]; then
    echo ""
    echo "Step 4 failed after 10 retries (app kept busy). AcrPull is already assigned."
    echo "  Option A: Restart the Container App in Azure Portal, wait 2-3 min, then run this script again."
    echo "  Option B: Try 'Deploy All' in GitHub Actions — pull may already work if registry was set earlier."
    exit 1
  fi
  echo "      Attempt $attempt: app busy. Waiting 60s..."
  sleep 60
done

echo ""
echo "Done. The Container App can now pull images from $ACR_NAME."
echo "Run 'Deploy All' in GitHub Actions to deploy a new image."
