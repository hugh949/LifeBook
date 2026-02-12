#!/usr/bin/env bash
# Rollback to a snapshot tag: checkout tag, optionally push and trigger deploy.
# Usage: SNAPSHOT_TAG=release/pre-perf-20250211 ./scripts/rollback-to-snapshot.sh
#   SKIP_DEPLOY=1  only checkout tag, do not push or trigger workflow.
# Output: logs/rollback-YYYYMMDD_HHMM.log

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TS=$(date +%Y%m%d_%H%M)
LOG_DIR="$REPO_ROOT/logs"
LOG_FILE="$LOG_DIR/rollback-$TS.log"
mkdir -p "$LOG_DIR"

log() { echo "$@" | tee -a "$LOG_FILE"; }

TAG="${SNAPSHOT_TAG:-}"
if [[ -z "$TAG" ]]; then
  log "ERROR: Set SNAPSHOT_TAG (e.g. release/pre-perf-20250211)"
  exit 1
fi

log "=== Rollback to snapshot: $TAG ==="
cd "$REPO_ROOT"

if ! git rev-parse "$TAG" >/dev/null 2>&1; then
  log "ERROR: Tag $TAG not found. Fetch with: git fetch origin tag $TAG"
  exit 1
fi
log "Tag found: $(git rev-parse "$TAG")"

log "Checking out $TAG..."
git checkout "$TAG"
log "Checked out $TAG"

if [[ -n "${SKIP_DEPLOY:-}" ]]; then
  log "SKIP_DEPLOY=1: not pushing or triggering deploy."
  log "To deploy this snapshot: push to main and run: gh workflow run deploy-all.yml"
  log "Then run: ./scripts/qa-verify-prod.sh"
  exit 0
fi

log "Pushing to origin main (force to match tag)..."
if git push origin "$TAG:main" --force 2>>"$LOG_FILE"; then
  log "Pushed. Trigger deploy: gh workflow run deploy-all.yml"
  if command -v gh >/dev/null 2>&1; then
    gh workflow run deploy-all.yml 2>>"$LOG_FILE" || true
    log "Deploy workflow triggered. After it completes, run: ./scripts/qa-verify-prod.sh"
  else
    log "Install gh and run: gh workflow run deploy-all.yml"
  fi
else
  log "Push failed (e.g. branch protected). Push manually or run from another branch."
fi
log "Reminder: if you changed DB (migrations), restore from pre-change dump separately. See docs/Backup_And_Recovery.md"
