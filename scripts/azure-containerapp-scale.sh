#!/usr/bin/env bash
# Set Container App min/max replicas (pilot: min=1, max=1 to minimize cost).
# Usage: ./scripts/azure-containerapp-scale.sh
# Env: MIN_REPLICAS=1 MAX_REPLICAS=1 (defaults for pilot). Optional: CPU, MEMORY.
# Requires: az login. Override: AZURE_RESOURCE_GROUP, AZURE_CONTAINER_APP
# Output: logs/azure-containerapp-scale-YYYYMMDD_HHMM.log

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RG="${AZURE_RESOURCE_GROUP:-rg-lifebook-v1}"
APP="${AZURE_CONTAINER_APP:-aca-lifebook-api-v1}"
MIN_REPLICAS="${MIN_REPLICAS:-1}"
MAX_REPLICAS="${MAX_REPLICAS:-1}"
TS=$(date +%Y%m%d_%H%M)
LOG_DIR="$REPO_ROOT/logs"
LOG_FILE="$LOG_DIR/azure-containerapp-scale-$TS.log"
mkdir -p "$LOG_DIR"

log() { echo "$@" | tee -a "$LOG_FILE"; }

log "=== Container App scale at $TS ==="
log "Applying scale (min=$MIN_REPLICAS, max=$MAX_REPLICAS)..."
ARGS=(--min-replicas "$MIN_REPLICAS" --max-replicas "$MAX_REPLICAS")
[[ -n "${CPU:-}" ]] && ARGS+=(--cpu "$CPU")
[[ -n "${MEMORY:-}" ]] && ARGS+=(--memory "$MEMORY")
if ! az containerapp update -g "$RG" -n "$APP" "${ARGS[@]}" --output none 2>>"$LOG_FILE"; then
  log "FAIL: az containerapp update failed"
  exit 1
fi
log "Verifying minReplicas/maxReplicas..."
MIN=$(az containerapp show -g "$RG" -n "$APP" --query "properties.template.scale.minReplicas" -o tsv 2>>"$LOG_FILE" || true)
MAX=$(az containerapp show -g "$RG" -n "$APP" --query "properties.template.scale.maxReplicas" -o tsv 2>>"$LOG_FILE" || true)
if [[ "$MIN" == "$MIN_REPLICAS" && "$MAX" == "$MAX_REPLICAS" ]]; then
  log "OK: scale updated (minReplicas=$MIN, maxReplicas=$MAX)"
  exit 0
else
  log "FAIL: expected min=$MIN_REPLICAS max=$MAX_REPLICAS, got min=$MIN max=$MAX"
  exit 1
fi
