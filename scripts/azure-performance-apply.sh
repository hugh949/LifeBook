#!/usr/bin/env bash
# Apply all Azure performance settings (Always On + Container App scale) with verification.
# Usage: ./scripts/azure-performance-apply.sh
# Runs: azure-webapp-always-on.sh, then azure-containerapp-scale.sh.
# Output: logs/azure-performance-apply-YYYYMMDD_HHMM.log

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TS=$(date +%Y%m%d_%H%M)
LOG_DIR="$REPO_ROOT/logs"
LOG_FILE="$LOG_DIR/azure-performance-apply-$TS.log"
mkdir -p "$LOG_DIR"

exec > >(tee -a "$LOG_FILE") 2>&1

echo "=== Azure performance apply at $TS ==="
ok=0

if "$REPO_ROOT/scripts/azure-webapp-always-on.sh"; then
  echo "Always On: applied and verified"
else
  echo "Always On: FAILED"
  ok=1
fi

if "$REPO_ROOT/scripts/azure-containerapp-scale.sh"; then
  echo "Container App scale: applied and verified"
else
  echo "Container App scale: FAILED"
  ok=1
fi

if [[ $ok -eq 0 ]]; then
  echo "All Azure performance settings applied and verified"
else
  echo "One or more steps failed. See log above."
  exit 1
fi
