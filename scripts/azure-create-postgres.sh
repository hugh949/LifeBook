#!/usr/bin/env bash
# Create Azure PostgreSQL Flexible Server (Burstable B1ms) - under ~$30/month.
# Keeps minimal config: Burstable, 32GB storage, 7-day backup.
#
# Usage:
#   PG_ADMIN_PASSWORD='YourSecurePassword123!' ./scripts/azure-create-postgres.sh
#   # Or you'll be prompted for the password
#
# Output: DATABASE_URL to add to GitHub Secrets

set -e

RG="${AZURE_RESOURCE_GROUP:-rg-lifebook-v1}"
LOC="${AZURE_LOCATION:-westus3}"
# Server name must be globally unique; add random suffix if default is taken
BASE_NAME="${PG_SERVER_NAME:-lifebook-pg}"
ADMIN_USER="${PG_ADMIN_USER:-lifebookadmin}"
DB_NAME="${PG_DATABASE:-lifebook}"

echo "=== Azure PostgreSQL Flexible Server (Burstable, ~\$15-30/month) ==="
echo "Resource group: $RG"
echo "Location: $LOC"
echo ""

# Ensure resource group exists
if ! az group show -n "$RG" &>/dev/null; then
  echo "Creating resource group $RG..."
  az group create -n "$RG" -l "$LOC"
fi

# Admin password
if [[ -z "${PG_ADMIN_PASSWORD:-}" ]]; then
  echo "Enter admin password (min 8 chars, must include upper, lower, number, special):"
  read -rs PG_ADMIN_PASSWORD
  echo ""
  if [[ -z "$PG_ADMIN_PASSWORD" ]]; then
    echo "Password required. Set PG_ADMIN_PASSWORD or run again."
    exit 1
  fi
fi

# Find a unique server name (try base, then base-random)
SERVER_NAME="$BASE_NAME"
for _ in 1 2 3 4 5; do
  if az postgres flexible-server show -g "$RG" -n "$SERVER_NAME" &>/dev/null; then
    SERVER_NAME="${BASE_NAME}-$(openssl rand -hex 3)"
    echo "Name $BASE_NAME taken, trying $SERVER_NAME"
  else
    break
  fi
done

echo "Creating server: $SERVER_NAME (Burstable B1ms, 32GB storage)..."
echo "This may take 5-10 minutes."
echo ""

az postgres flexible-server create \
  --resource-group "$RG" \
  --name "$SERVER_NAME" \
  --location "$LOC" \
  --admin-user "$ADMIN_USER" \
  --admin-password "$PG_ADMIN_PASSWORD" \
  --sku-name Standard_B1ms \
  --tier Burstable \
  --storage-size 32 \
  --storage-auto-grow Disabled \
  --backup-retention 7 \
  --version 15 \
  --public-access 0.0.0.0 \
  --yes

echo ""
echo "Creating database: $DB_NAME"
az postgres flexible-server db create \
  --resource-group "$RG" \
  --server-name "$SERVER_NAME" \
  --database-name "$DB_NAME"

# Get FQDN
FQDN=$(az postgres flexible-server show -g "$RG" -n "$SERVER_NAME" --query "fullyQualifiedDomainName" -o tsv)

# Build DATABASE_URL (escape special chars in password for URL)
# User must ensure password doesn't have & ? # etc. or URL-encode them
PWD_ESC="$PG_ADMIN_PASSWORD"
DATABASE_URL="postgresql://${ADMIN_USER}:${PWD_ESC}@${FQDN}:5432/${DB_NAME}?sslmode=require"

echo ""
echo "=== Done ==="
echo ""
echo "Server: $SERVER_NAME"
echo "FQDN:   $FQDN"
echo ""
echo "Add this to GitHub Secrets (Settings → Secrets → DATABASE_URL):"
echo ""
echo "  $DATABASE_URL"
echo ""
echo "If your password contains special chars (& ? # etc.), URL-encode them in the secret."
echo ""
echo "Then run migrations and redeploy:"
echo "  cd services/api && DATABASE_URL=\"...\" alembic upgrade head"
echo "  # Update GitHub Secret DATABASE_URL, then trigger Deploy All"
echo ""
