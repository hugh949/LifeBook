#!/usr/bin/env bash
# Release LifeBook to production: set version, commit, push, trigger Deploy All.
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

# If we bumped and have other uncommitted changes, add everything for one release commit
if ! git diff-index --quiet HEAD -- 2>/dev/null; then
  echo ""
  git status --short
  read -p "Commit all changes and deploy as Release $NEW_VERSION? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Commit cancelled. Version file may have been updated; restore if needed."
    exit 0
  fi
  git add -A
  git commit -m "Release $NEW_VERSION"
else
  # No other changes: commit if we bumped (version file already staged in choice 2)
  if ! git diff --cached --quiet 2>/dev/null; then
    git commit -m "Release $NEW_VERSION"
  fi
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

echo ""
echo -e "${GREEN}Push complete. Triggering Deploy All (Web + API)...${NC}"
if command -v gh >/dev/null 2>&1; then
  gh workflow run deploy-all.yml
  echo ""
  echo "Workflow started. Watch: $(git remote get-url origin | sed 's/\.git$//')/actions"
  echo ""
  echo "After the workflow turns green (~5–15 min), verify production:"
  echo "  PROD_WEB_URL=https://app-lifebook-web-v1.azurewebsites.net ./scripts/verify-prod.sh"
  echo ""
  echo "Optional: verify deployed version matches $NEW_VERSION:"
  echo "  EXPECTED_VERSION=$NEW_VERSION PROD_WEB_URL=https://app-lifebook-web-v1.azurewebsites.net ./scripts/verify-prod.sh"
else
  echo -e "${YELLOW}GitHub CLI (gh) not found. Trigger the workflow manually:${NC}"
  echo "  1. Open your repo on GitHub → Actions"
  echo "  2. Select 'Deploy All (Web + API)' → Run workflow → Run workflow"
  echo "  Or install gh and run: gh workflow run deploy-all.yml"
  echo ""
  echo "After deploy, verify:"
  echo "  PROD_WEB_URL=https://app-lifebook-web-v1.azurewebsites.net ./scripts/verify-prod.sh"
fi
echo ""
echo "Done. Production will show version $NEW_VERSION after deploy completes."
