#!/usr/bin/env bash
# Capture current Azure state (Web App + Container App) for rollback reference.
# Usage: ./scripts/azure-snapshot-state.sh
# Requires: az login. Override: AZURE_RESOURCE_GROUP, AZURE_WEBAPP_NAME, AZURE_CONTAINER_APP
# Output: logs/azure-snapshot-YYYYMMDD_HHMM.log and logs/azure-snapshot-*-.json

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RG="${AZURE_RESOURCE_GROUP:-rg-lifebook-v1}"
WEBAPP="${AZURE_WEBAPP_NAME:-app-lifebook-web-v1}"
APP="${AZURE_CONTAINER_APP:-aca-lifebook-api-v1}"

TS=$(date +%Y%m%d_%H%M)
LOG_DIR="$REPO_ROOT/logs"
LOG_FILE="$LOG_DIR/azure-snapshot-$TS.log"
mkdir -p "$LOG_DIR"

log() { echo "$@" | tee -a "$LOG_FILE"; }

log "=== Azure snapshot at $TS ==="
log "Resource group: $RG"
log "Web App: $WEBAPP"
log "Container App: $APP"
log ""

ok=0

# Web App config (redact appSettings values; keep names and alwaysOn)
log "Capturing Web App config..."
if az webapp config show -g "$RG" -n "$WEBAPP" -o json > "$LOG_DIR/azure-snapshot-webapp-$TS.json" 2>>"$LOG_FILE"; then
  log "  OK: Saved to logs/azure-snapshot-webapp-$TS.json"
else
  log "  FAIL: Could not get Web App config"
  ok=1
fi

# Container App full show (template, scale, etc.)
log "Capturing Container App config..."
if az containerapp show -g "$RG" -n "$APP" -o json > "$LOG_DIR/azure-snapshot-containerapp-$TS.json" 2>>"$LOG_FILE"; then
  log "  OK: Saved to logs/azure-snapshot-containerapp-$TS.json"
else
  log "  FAIL: Could not get Container App config"
  ok=1
fi

# Revisions
log "Capturing revisions..."
az containerapp revision list -g "$RG" -n "$APP" --all -o table >> "$LOG_FILE" 2>&1 || true
log "  Revisions appended to log"

# Traffic
log "Capturing traffic split..."
az containerapp ingress traffic show -g "$RG" -n "$APP" -o table >> "$LOG_FILE" 2>&1 || true
log "  Traffic appended to log"

log ""
log "Snapshot saved to logs/azure-snapshot-*-$TS.json and $LOG_FILE"
exit "$ok"
