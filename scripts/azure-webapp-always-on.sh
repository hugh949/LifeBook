#!/usr/bin/env bash
# Enable Always On for the Web App (reduces cold-start on first request after idle).
# Usage: ./scripts/azure-webapp-always-on.sh
# Requires: az login. Override: AZURE_RESOURCE_GROUP, AZURE_WEBAPP_NAME
# Output: logs/azure-webapp-always-on-YYYYMMDD_HHMM.log

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RG="${AZURE_RESOURCE_GROUP:-rg-lifebook-v1}"
WEBAPP="${AZURE_WEBAPP_NAME:-app-lifebook-web-v1}"
TS=$(date +%Y%m%d_%H%M)
LOG_DIR="$REPO_ROOT/logs"
LOG_FILE="$LOG_DIR/azure-webapp-always-on-$TS.log"
mkdir -p "$LOG_DIR"

log() { echo "$@" | tee -a "$LOG_FILE"; }

log "=== Web App Always On at $TS ==="
log "Applying Always On..."
if ! az webapp config set -g "$RG" -n "$WEBAPP" --always-on true --output none 2>>"$LOG_FILE"; then
  log "FAIL: az webapp config set failed"
  exit 1
fi
log "Verifying alwaysOn == true..."
VAL=$(az webapp config show -g "$RG" -n "$WEBAPP" --query alwaysOn -o tsv 2>>"$LOG_FILE" || true)
if [[ "$VAL" == "true" ]]; then
  log "OK: Always On enabled"
  exit 0
else
  log "FAIL: alwaysOn is not true (got: $VAL)"
  exit 1
fi
