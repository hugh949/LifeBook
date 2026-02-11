#!/usr/bin/env bash
# Release LifeBook to production: verify → backup/migrations (optional) → version → commit → confirm → push → deploy → verify.
# Ensures all local changes are committed and offers to back up DB and run pending migrations so release matches your tested local environment.
# Production will show the version from apps/web/src/app/version.ts.
# Usage: ./scripts/release.sh [version]
#   With no arg: prompts to keep current version or bump minor (e.g. 1.0 → 1.1).
#   With version (e.g. 1.1): still prompts to confirm that version, then continues.
# Set DATABASE_URL to production Postgres URL to get prompts for backup and pending migrations.
# Run in a terminal for full interactive prompts and a clear log for troubleshooting.
set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_FILE="$REPO_ROOT/apps/web/src/app/version.ts"
cd "$REPO_ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

# Log a step message (visible in terminal for troubleshooting)
log() { echo "[release] $*"; }
log_step() { echo ""; echo -e "${BOLD}[release] $*${NC}"; }

# All prompts use (y/n). Accept single letter y/n or yes/no. Return 0 if y, 1 if n.
confirm_yn() {
  local prompt="$1"
  local reply
  while true; do
    read -r -p "$prompt (y/n) " reply
    reply=$(echo "$reply" | tr '[:upper:]' '[:lower:]' | tr -d ' ')
    if [[ "$reply" == "yes" || "$reply" == "y" ]]; then return 0; fi
    if [[ "$reply" == "no" || "$reply" == "n" ]]; then return 1; fi
    echo "Please answer y or n."
  done
}

cancel_msg() {
  log "Cancelled. Run ./scripts/release.sh again to start from the beginning."
}

# Show DATABASE_URL with password masked (user:***@host)
mask_db_url() {
  local u="${1:-}"
  if [[ -z "$u" ]]; then echo "(not set)"; return; fi
  # Replace password (between : and @ after the scheme) with ***
  echo "$u" | sed -e 's|://\([^:]*\):[^@]*@|://\1:***@|' 2>/dev/null || echo "(masked)"
}

# Check if production DB (DATABASE_URL) has pending Alembic migrations. Return 0 if pending, 1 if up to date or unable to check.
check_pending_migrations() {
  [[ -z "${DATABASE_URL:-}" ]] && return 1
  local current_rev head_rev
  current_rev=$(cd "$REPO_ROOT/services/api" && uv run alembic current 2>/dev/null | awk '{print $1}' | head -1)
  head_rev=$(cd "$REPO_ROOT/services/api" && uv run alembic heads 2>/dev/null | awk '{print $1}' | head -1)
  [[ -z "$head_rev" ]] && return 1
  [[ "$current_rev" != "$head_rev" ]] && return 0
  return 1
}

echo ""
echo "=============================================="
echo "  LifeBook Release → Production"
echo "=============================================="
log "Repo root: $(pwd)"

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo -e "${RED}Not a git repository. Run from LifeBook root.${NC}"
  exit 1
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo -e "${RED}No remote 'origin'. Add it first.${NC}"
  exit 1
fi

# If there are uncommitted changes, offer to commit them so we can proceed in one run
if [ -n "$(git status --porcelain)" ]; then
  log_step "Uncommitted changes detected"
  git status --short
  echo ""
  if confirm_yn "Commit all changes now and continue with release?"; then
    read -r -p "Enter commit message (or press Enter for 'Pre-release commit'): " msg
    msg="${msg:-Pre-release commit}"
    log "Running: git add -A && git commit -m \"$msg\""
    git add -A
    git commit -m "$msg"
    log "Committed. Continuing with release."
  else
    cancel_msg
    exit 0
  fi
fi

# Step 1: Pre-release check (deploy config + require clean working tree)
log_step "Step 1/7: Pre-release check (clean repo required)"
if ! "$REPO_ROOT/scripts/check-deploy-ready.sh" --require-clean; then
  echo ""
  echo -e "${RED}Fix the issues above, then run ./scripts/release.sh again.${NC}"
  exit 1
fi
log "Pre-release check passed."

# Step 2: Confirm or set DATABASE_URL (for backup and migrations)
log_step "Step 2/7: Production database (backup and migrations)"
if [ -n "${DATABASE_URL:-}" ]; then
  echo "  Current DATABASE_URL: $(mask_db_url "$DATABASE_URL")"
  echo ""
  if ! confirm_yn "Is this the correct production database?"; then
    read -r -p "Enter new DATABASE_URL (or press Enter to skip backup and migration): " new_url
    if [[ -z "${new_url// /}" ]]; then
      export DATABASE_URL=""
      log "DATABASE_URL cleared. Skipping backup and migration prompts."
    else
      export DATABASE_URL="$new_url"
      log "DATABASE_URL updated."
    fi
  fi
else
  if confirm_yn "DATABASE_URL is not set. Set it now for backup and migration?"; then
    read -r -p "Enter DATABASE_URL: " new_url
    if [[ -n "${new_url// /}" ]]; then
      export DATABASE_URL="$new_url"
      log "DATABASE_URL set."
    fi
  else
    log "Skipping backup and migration prompts."
  fi
fi

# Step 2b: Back up production database (only if DATABASE_URL is set)
if [ -n "${DATABASE_URL:-}" ]; then
  log_step "Backup: production database"
  log "Backup is recommended before deploy so you can restore if needed. Requires pg_dump (PostgreSQL client tools)."
  if confirm_yn "Back up production database now?"; then
    if "$REPO_ROOT/scripts/backup-db.sh"; then
      log "Backup completed."
    else
      echo -e "${YELLOW}[release] Backup failed (e.g. pg_dump not found). Install PostgreSQL client tools or run backup manually.${NC}"
      if ! confirm_yn "Continue with release without backup?"; then
        cancel_msg
        exit 1
      fi
    fi
  else
    log "Skipping backup."
  fi
fi

# Step 3: Pending migrations on production (only if DATABASE_URL is set)
if [ -n "${DATABASE_URL:-}" ]; then
  log_step "Step 3/7: Migrations: production database"
  if check_pending_migrations; then
    current_rev=$(cd "$REPO_ROOT/services/api" && uv run alembic current 2>/dev/null | head -1)
    head_rev=$(cd "$REPO_ROOT/services/api" && uv run alembic heads 2>/dev/null | head -1)
    echo "  Current revision (on DB): $current_rev"
    echo "  Head revision (in code): $head_rev"
    echo ""
    log "Pending migrations will also run in the Deploy workflow; running now ensures DB is ready before new code goes live."
    if confirm_yn "Run pending migrations on production database now?"; then
      if "$REPO_ROOT/scripts/prod-migrations.sh"; then
        log "Migrations completed."
      else
        echo -e "${RED}[release] Migrations failed. Fix the error above, then run ./scripts/release.sh again.${NC}"
        exit 1
      fi
    else
      log "Skipping. Migrations will run during the Deploy All workflow (if DATABASE_URL is in GitHub Secrets)."
    fi
  else
    log "Database is up to date (no pending migrations)."
  fi
else
  log "DATABASE_URL not set; migration check skipped."
fi

# Step 4: Version (always prompt for explicit choice or confirmation)
log_step "Step 4/7: Version and commit"
current_version=""
if [ -f "$VERSION_FILE" ]; then
  current_version=$(grep -oE 'APP_VERSION\s*=\s*"[^"]+"' "$VERSION_FILE" | sed 's/.*"\([^"]*\)".*/\1/')
fi
if [ -z "$current_version" ]; then
  echo -e "${RED}Could not read APP_VERSION from $VERSION_FILE${NC}"
  exit 1
fi

if [ -n "$1" ]; then
  # Version passed on command line: validate and require explicit confirmation
  NEW_VERSION="$1"
  if [[ ! "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+$ ]]; then
    echo -e "${RED}Version must be x.y (e.g. 1.1). Got: $NEW_VERSION${NC}"
    exit 1
  fi
  log "You specified version: $NEW_VERSION (current in file: $current_version)"
  if ! confirm_yn "Proceed with version $NEW_VERSION for this release?"; then
    cancel_msg
    exit 0
  fi
  if [ "$NEW_VERSION" != "$current_version" ]; then
    log "Updating version.ts to $NEW_VERSION"
    sed -i.bak "s/APP_VERSION = \"$current_version\"/APP_VERSION = \"$NEW_VERSION\"/" "$VERSION_FILE"
    rm -f "${VERSION_FILE}.bak"
    git add "$VERSION_FILE"
  fi
else
  # No version arg: require explicit 1, 2, or 3
  choice=""
  while [[ ! "$choice" =~ ^[123]$ ]]; do
    echo ""
    echo "Current app version in version.ts: $current_version"
    echo ""
    echo "  (1) Deploy current version ($current_version) as-is (no file change)"
    echo "  (2) Bump minor and deploy (e.g. $current_version → next minor)"
    echo "  (3) Cancel release"
    echo ""
    read -r -p "Enter 1, 2, or 3: " choice
    choice=$(echo "$choice" | tr -d ' ')
    if [[ ! "$choice" =~ ^[123]$ ]]; then
      echo "Invalid. Please enter 1, 2, or 3."
    fi
  done
  case "$choice" in
    1)
      NEW_VERSION="$current_version"
      log "Deploying current version as-is: $NEW_VERSION"
      ;;
    2)
      major="${current_version%%.*}"
      minor="${current_version##*.}"
      minor=$((minor + 1))
      NEW_VERSION="$major.$minor"
      log "Bumping version: $current_version → $NEW_VERSION"
      sed -i.bak "s/APP_VERSION = \"$current_version\"/APP_VERSION = \"$NEW_VERSION\"/" "$VERSION_FILE"
      rm -f "${VERSION_FILE}.bak"
      git add "$VERSION_FILE"
      ;;
    3)
      cancel_msg
      exit 0
      ;;
  esac
fi

# Commit only if we have staged changes (e.g. version bump)
if ! git diff --cached --quiet 2>/dev/null; then
  log "Committing version change: Release $NEW_VERSION"
  git commit -m "Release $NEW_VERSION"
else
  log "No version file change; no new commit (deploying existing commit)."
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
  log_step "Not on main branch (current: $BRANCH)"
  if ! confirm_yn "Merge $BRANCH into main and push from main?"; then
    cancel_msg
    exit 0
  fi
  log "Checking out main and merging $BRANCH..."
  git checkout main
  git merge "$BRANCH" -m "Merge $BRANCH for release $NEW_VERSION"
fi

# Step 5: Explicit confirmation before push and deploy
log_step "Step 5/7: Confirm push and deploy"
BRANCH=$(git rev-parse --abbrev-ref HEAD)
ORIGIN_URL=$(git remote get-url origin 2>/dev/null || echo "origin")
echo ""
echo "  Version to release:  $NEW_VERSION"
echo "  Branch to push:      $BRANCH"
echo "  Remote:              $ORIGIN_URL"
echo "  Action:               git push -u origin $BRANCH, then trigger workflow 'Deploy All (Web + API)'"
echo ""
if ! confirm_yn "Push to origin $BRANCH and trigger the deploy workflow?"; then
  cancel_msg
  exit 0
fi

log_step "Step 6/7: Push to origin $BRANCH"
log "Running: git push -u origin $BRANCH"
git push -u origin "$BRANCH"

# Ensure remote main is exactly our commit so the workflow builds this commit
log "Verifying push (origin/main must match HEAD)..."
git fetch origin main
OUR_HEAD=$(git rev-parse HEAD)
ORIGIN_MAIN=$(git rev-parse origin/main)
if [ "$OUR_HEAD" != "$ORIGIN_MAIN" ]; then
  echo -e "${RED}ERROR: After push, origin/main ($ORIGIN_MAIN) is not our commit ($OUR_HEAD). Deploy would build the wrong code. Fix sync (e.g. pull --rebase, push) and run release again.${NC}"
  exit 1
fi
log "Push verified: origin/main = HEAD."

log_step "Step 7/7: Trigger deploy and optional verification"
PROD_WEB_URL="${PROD_WEB_URL:-https://app-lifebook-web-v1.azurewebsites.net}"
if command -v gh >/dev/null 2>&1; then
  log "Triggering workflow: Deploy All (Web + API)"
  gh workflow run deploy-all.yml
  ACTIONS_URL=$(git remote get-url origin 2>/dev/null | sed 's/\.git$//')/actions
  log "Workflow started. Watch: $ACTIONS_URL"
  echo ""
  if confirm_yn "Wait for the workflow to finish and run verify-prod.sh?"; then
    log "Waiting for workflow to complete (~5–15 min)..."
    sleep 5
    RUN_ID=$(gh run list --workflow=deploy-all.yml --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)
    if [ -n "$RUN_ID" ]; then
      gh run watch "$RUN_ID" || true
    fi
    echo ""
    log "Running production verification..."
    if PROD_WEB_URL="$PROD_WEB_URL" EXPECTED_VERSION="$NEW_VERSION" "$REPO_ROOT/scripts/verify-prod.sh"; then
      echo ""
      echo -e "${GREEN}[release] Verification passed. Production is live with version $NEW_VERSION.${NC}"
    else
      echo ""
      echo -e "${YELLOW}[release] Verification had issues. Check the output above and Azure/GitHub if needed.${NC}"
    fi
  else
    log "Skipping wait. After the workflow turns green (~5–15 min), run:"
    echo "  PROD_WEB_URL=$PROD_WEB_URL ./scripts/verify-prod.sh"
    echo "  EXPECTED_VERSION=$NEW_VERSION PROD_WEB_URL=$PROD_WEB_URL ./scripts/verify-prod.sh"
  fi
else
  echo -e "${YELLOW}GitHub CLI (gh) not found. Trigger the workflow manually:${NC}"
  echo "  1. Open your repo on GitHub → Actions"
  echo "  2. Select 'Deploy All (Web + API)' → Run workflow → Run workflow"
  echo "  Or install gh and run: gh workflow run deploy-all.yml"
  echo ""
  log "After deploy, verify: PROD_WEB_URL=$PROD_WEB_URL ./scripts/verify-prod.sh"
fi
echo ""
echo -e "${GREEN}[release] Done. Production will show version $NEW_VERSION after deploy completes.${NC}"
