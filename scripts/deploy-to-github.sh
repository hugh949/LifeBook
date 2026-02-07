#!/usr/bin/env bash
# Push LifeBook to GitHub (commit if needed, then push to main).
# Run this first; Azure deploy runs automatically on push via GitHub Actions.
set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "LifeBook → GitHub"
echo "-----------------"

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo -e "${RED}Not a git repository. Run from LifeBook root.${NC}"
  exit 1
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo -e "${RED}No remote 'origin'. Add it:${NC}"
  echo "  git remote add origin https://github.com/YOUR_USERNAME/LifeBook.git"
  exit 1
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
  echo -e "${YELLOW}On branch '$BRANCH'. Push target is 'main'.${NC}"
  read -p "Continue? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Switch to main: git checkout main"
    exit 0
  fi
fi

if ! git diff-index --quiet HEAD -- 2>/dev/null; then
  echo -e "${YELLOW}Uncommitted changes.${NC}"
  read -p "Commit before push? (y/n) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    read -p "Commit message (Enter = 'Updates'): " MSG
    [ -z "$MSG" ] && MSG="Updates"
    git add -A
    git commit -m "$MSG"
  else
    echo "No commit. Push skipped. Run again after committing."
    exit 0
  fi
fi

echo "Pushing to origin main..."
git push -u origin main

echo ""
echo -e "${GREEN}Done. Code is on GitHub.${NC}"
echo "  $(git remote get-url origin | sed 's/\.git$//')"
echo ""
echo "Azure deploy will run automatically (see Actions tab)."
echo ""
