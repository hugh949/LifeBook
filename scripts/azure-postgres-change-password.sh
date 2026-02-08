#!/usr/bin/env bash
# Change the Azure PostgreSQL Flexible Server admin password.
# Prompts for current password (to verify) and new password.
# Outputs the new DATABASE_URL with password URL-encoded for GitHub Secrets.
#
# Usage: ./scripts/azure-postgres-change-password.sh
#   (run from repo root)

set -e

RG="${AZURE_RESOURCE_GROUP:-rg-lifebook-v1}"
SERVER_NAME="${PG_SERVER_NAME:-lifebook-pg}"
ADMIN_USER="${PG_ADMIN_USER:-lifebookadmin}"
DB_NAME="${PG_DATABASE:-lifebook}"

echo "=== Change Azure PostgreSQL Admin Password ==="
echo "Server: $SERVER_NAME"
echo "Resource group: $RG"
echo ""

# Check server exists
if ! az postgres flexible-server show -g "$RG" -n "$SERVER_NAME" &>/dev/null; then
  echo "Error: Server '$SERVER_NAME' not found in resource group '$RG'."
  echo "Set PG_SERVER_NAME if your server has a different name."
  exit 1
fi

FQDN=$(az postgres flexible-server show -g "$RG" -n "$SERVER_NAME" --query "fullyQualifiedDomainName" -o tsv)

# Prompt for existing password and verify by connecting
echo "Enter EXISTING (current) password:"
read -rs CURRENT_PASSWORD
echo ""
if [[ -z "$CURRENT_PASSWORD" ]]; then
  echo "Current password cannot be empty."
  exit 1
fi

# URL-encode current password for connection string
CURRENT_ENCODED=$(python3 -c "
import urllib.parse, sys
print(urllib.parse.quote(sys.argv[1], safe=''))
" "$CURRENT_PASSWORD")

CURRENT_URL="postgresql://${ADMIN_USER}:${CURRENT_ENCODED}@${FQDN}:5432/${DB_NAME}?sslmode=require"

echo "Verifying current password..."
API_DIR="$(cd "$(dirname "$0")/../services/api" && pwd)"
run_verify() {
  (cd "$API_DIR" && "$@" python3 -c '
import psycopg, sys
try:
  conn = psycopg.connect(sys.argv[1])
  conn.close()
except Exception:
  sys.exit(1)
' "$CURRENT_URL") 2>/dev/null
}
if (command -v uv &>/dev/null && run_verify uv run) || run_verify; then
  :
else
  echo "Failed to connect with current password. Check the password and try again."
  echo "(Install API deps: cd services/api && pip install -e .)"
  exit 1
fi
echo "Current password verified."
echo ""

# Prompt for new password (silent - nothing will show as you type)
echo "Enter NEW password (min 8 chars, upper, lower, number, special; @ is allowed):"
read -rs NEW_PASSWORD
echo ""
if [[ -z "$NEW_PASSWORD" ]]; then
  echo "Password cannot be empty."
  exit 1
fi

echo "Confirm new password:"
read -rs NEW_PASSWORD_CONFIRM
echo ""
if [[ "$NEW_PASSWORD" != "$NEW_PASSWORD_CONFIRM" ]]; then
  echo "Passwords do not match."
  exit 1
fi

echo "Updating password on Azure (this may take a moment)..."
az postgres flexible-server update \
  --resource-group "$RG" \
  --name "$SERVER_NAME" \
  --admin-password "$NEW_PASSWORD" \
  --output none

echo "Password updated successfully."
echo ""

# URL-encode the password for use in DATABASE_URL
# Handles @ : / ? # [ ] % & + etc.
ENCODED_PWD=$(python3 -c "
import urllib.parse
import sys
pwd = sys.argv[1]
print(urllib.parse.quote(pwd, safe=''))
" "$NEW_PASSWORD")

DATABASE_URL="postgresql://${ADMIN_USER}:${ENCODED_PWD}@${FQDN}:5432/${DB_NAME}?sslmode=require"

echo "=== Add this to GitHub Secrets (DATABASE_URL) ==="
echo ""
echo "$DATABASE_URL"
echo ""
echo "Then trigger Deploy All so the Container App gets the new secret."
echo ""
