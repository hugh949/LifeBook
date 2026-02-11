#!/usr/bin/env bash
# Release LifeBook to production: verify → set version → commit → push → deploy → verify.
# Ensures all local changes are committed so nothing is left out of production.
# Production will show the version from apps/web/src/app/version.ts.
# Usage: ./scripts/release.sh [version]
#   With no arg: prompts to keep current version or bump minor (e.g. 1.0 → 1.1).
#   With version (e.g. 1.1): sets that version, commits, pushes, triggers deploy.
set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_FILE="$REPO_ROOT/apps/web/src/app/version.ts"
cd "$REPO_ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "LifeBook Release → Production"
echo "=============================="

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo -e "${RED}Not a git repository. Run from LifeBook root.${NC}"
  exit 1
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo -e "${RED}No remote 'origin'. Add it first.${NC}"
  exit 1
fi

# Step 1: Pre-release check (deploy config + require clean working tree)
# Require all changes committed so production never misses code that worked locally.
echo ""
echo "Step 1: Pre-release check (clean repo required)..."
if ! "$REPO_ROOT/scripts/check-deploy-ready.sh" --require-clean; then
  echo ""
  echo -e "${RED}Fix the issues above, then run ./scripts/release.sh again.${NC}"
  echo "  To commit everything: git add -A && git commit -m 'Your message'"
  exit 1
fi
echo ""

# Step 2: Version
echo "Step 2: Version & commit..."
# Read current version from version.ts
current_version=""
if [ -f "$VERSION_FILE" ]; then
  current_version=$(grep -oE 'APP_VERSION\s*=\s*"[^"]+"' "$VERSION_FILE" | sed 's/.*"\([^"]*\)".*/\1/')
fi
if [ -z "$current_version" ]; then
  echo -e "${RED}Could not read APP_VERSION from $VERSION_FILE${NC}"
  exit 1
fi

NEW_VERSION="$1"
if [ -n "$NEW_VERSION" ]; then
  # Validate x.y format (major.minor)
  if [[ ! "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+$ ]]; then
    echo -e "${RED}Version must be x.y (e.g. 1.1). Got: $NEW_VERSION${NC}"
    exit 1
  fi
  echo "Setting version to $NEW_VERSION (current: $current_version)"
  if [ "$NEW_VERSION" != "$current_version" ]; then
    sed -i.bak "s/APP_VERSION = \"$current_version\"/APP_VERSION = \"$NEW_VERSION\"/" "$VERSION_FILE"
    rm -f "${VERSION_FILE}.bak"
    git add "$VERSION_FILE"
  fi
else
  echo "Current app version: $current_version"
  echo ""
  echo "Options:"
  echo "  1) Deploy current version ($current_version) as-is (no file change)"
  echo "  2) Bump minor and deploy (e.g. $current_version → next minor)"
  echo "  3) Cancel"
  read -p "Choice (1/2/3): " choice
  case "$choice" in
    1) NEW_VERSION="$current_version" ;;
    2)
      major="${current_version%%.*}"
      minor="${current_version##*.}"
      minor=$((minor + 1))
      NEW_VERSION="$major.$minor"
      echo "Bumping to $NEW_VERSION"
      sed -i.bak "s/APP_VERSION = \"$current_version\"/APP_VERSION = \"$NEW_VERSION\"/" "$VERSION_FILE"
      rm -f "${VERSION_FILE}.bak"
      git add "$VERSION_FILE"
      ;;
    3) echo "Cancelled."; exit 0 ;;
    *) echo -e "${RED}Invalid choice.${NC}"; exit 1 ;;
  esac
fi

# Working tree is already clean (enforced by check-deploy-ready --require-clean).
# Commit only if we have staged changes (e.g. version bump).
if ! git diff --cached --quiet 2>/dev/null; then
  git commit -m "Release $NEW_VERSION"
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
  echo -e "${YELLOW}Current branch is $BRANCH. Push and deploy from main? (y/n)${NC}"
  read -p "" -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Switch to main and run again: git checkout main && ./scripts/release.sh $NEW_VERSION"
    exit 0
  fi
  git checkout main
  git merge "$BRANCH" -m "Merge $BRANCH for release $NEW_VERSION"
fi

echo "Pushing to origin main..."
git push -u origin main

# Aggressive parity: ensure remote main is exactly our commit so the workflow builds this commit
echo "Verifying push (origin/main must match HEAD)..."
git fetch origin main
OUR_HEAD=$(git rev-parse HEAD)
ORIGIN_MAIN=$(git rev-parse origin/main)
if [ "$OUR_HEAD" != "$ORIGIN_MAIN" ]; then
  echo -e "${RED}ERROR: After push, origin/main ($ORIGIN_MAIN) is not our commit ($OUR_HEAD). Deploy would build the wrong code. Fix sync (e.g. pull --rebase, push) and run release again.${NC}"
  exit 1
fi
echo -e "${GREEN}Push verified: origin/main = HEAD.${NC}"

echo ""
echo -e "${GREEN}Push complete. Triggering Deploy All (Web + API)...${NC}"
PROD_WEB_URL="${PROD_WEB_URL:-https://app-lifebook-web-v1.azurewebsites.net}"
if command -v gh >/dev/null 2>&1; then
  gh workflow run deploy-all.yml
  echo ""
  echo "Workflow started. Watch: $(git remote get-url origin | sed 's/\.git$//')/actions"
  echo ""
  read -p "Wait for deploy and run verification? (y/n) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo "Waiting for workflow to complete (~5–15 min)..."
    sleep 5
    RUN_ID=$(gh run list --workflow=deploy-all.yml --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)
    if [ -n "$RUN_ID" ]; then
      gh run watch "$RUN_ID" || true
    fi
    echo ""
    echo "Step 3: Verifying production..."
    if PROD_WEB_URL="$PROD_WEB_URL" EXPECTED_VERSION="$NEW_VERSION" "$REPO_ROOT/scripts/verify-prod.sh"; then
      echo ""
      echo -e "${GREEN}Verification passed. Production is live with version $NEW_VERSION.${NC}"
    else
      echo ""
      echo -e "${YELLOW}Verification had issues. Check the output above and Azure/GitHub if needed.${NC}"
    fi
  else
    echo ""
    echo "After the workflow turns green (~5–15 min), verify production:"
    echo "  PROD_WEB_URL=$PROD_WEB_URL ./scripts/verify-prod.sh"
    echo ""
    echo "To verify deployed version matches $NEW_VERSION:"
    echo "  EXPECTED_VERSION=$NEW_VERSION PROD_WEB_URL=$PROD_WEB_URL ./scripts/verify-prod.sh"
  fi
else
  echo -e "${YELLOW}GitHub CLI (gh) not found. Trigger the workflow manually:${NC}"
  echo "  1. Open your repo on GitHub → Actions"
  echo "  2. Select 'Deploy All (Web + API)' → Run workflow → Run workflow"
  echo "  Or install gh and run: gh workflow run deploy-all.yml"
  echo ""
  echo "After deploy, verify:"
  echo "  PROD_WEB_URL=$PROD_WEB_URL ./scripts/verify-prod.sh"
fi
echo ""
echo "Done. Production will show version $NEW_VERSION after deploy completes."
