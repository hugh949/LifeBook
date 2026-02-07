#!/usr/bin/env bash
# Deploy LifeBook to Azure via GitHub Actions.
# Pushes to main (triggers Deploy All workflow) or runs the workflow manually with GitHub CLI.
set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "LifeBook → GitHub → Azure deploy"
echo "--------------------------------"

# Ensure we're in a git repo
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo -e "${RED}Not a git repository. Run from LifeBook root.${NC}"
  exit 1
fi

# Ensure we have origin
if ! git remote get-url origin >/dev/null 2>&1; then
  echo -e "${RED}No remote 'origin'. Add it first:${NC}"
  echo "  git remote add origin https://github.com/YOUR_USERNAME/LifeBook.git"
  exit 1
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
  echo -e "${YELLOW}Current branch is '$BRANCH'. Push will go to 'main'.${NC}"
  read -p "Continue? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Switch to main first: git checkout main"
    exit 0
  fi
fi

# Uncommitted changes?
if ! git diff-index --quiet HEAD -- 2>/dev/null; then
  echo -e "${YELLOW}You have uncommitted changes.${NC}"
  read -p "Commit them before push? (y/n) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    read -p "Commit message (or press Enter for default): " MSG
    if [ -z "$MSG" ]; then
      MSG="Deploy: updates for Azure"
    fi
    git add -A
    git commit -m "$MSG"
  else
    echo "Push skipped. Commit first, then run this script again."
    exit 0
  fi
fi

echo "Pushing to origin main..."
git push -u origin main

echo ""
echo -e "${GREEN}Push done. GitHub Actions will run 'Deploy All (Web + API)'.${NC}"
echo ""
echo "Watch the workflow:"
echo "  $(git remote get-url origin | sed 's/\.git$//')/actions"
echo ""

# If GitHub CLI is installed, show latest run
if command -v gh >/dev/null 2>&1; then
  echo "Latest run:"
  gh run list --workflow=deploy-all.yml --limit 1 2>/dev/null || true
  echo ""
  echo "To run deploy without pushing (manual trigger):"
  echo "  gh workflow run deploy-all.yml"
fi

echo "Done."
