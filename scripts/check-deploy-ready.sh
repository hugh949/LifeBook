#!/usr/bin/env bash
# Check that the repo is ready for a correct API deploy (delete route + workflow fix).
# Run from repo root: ./scripts/check-deploy-ready.sh
# This does NOT check GitHub Actions (we can't see that). It only checks local/committed files.

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok=0

echo "Checking repo state for API deploy (delete route)..."
echo ""

# 1. Workflow: checkout must pin ref
if grep -q 'ref: \${{ github.sha }}' .github/workflows/deploy-api.yml 2>/dev/null; then
  echo -e "${GREEN}✓${NC} deploy-api.yml: Checkout pins ref to github.sha"
else
  echo -e "${RED}✗${NC} deploy-api.yml: Missing 'ref: \${{ github.sha }}' in Checkout step"
  ok=1
fi

# 2. Workflow: verify step must exist
if grep -q 'Verify API source (delete route)' .github/workflows/deploy-api.yml 2>/dev/null; then
  echo -e "${GREEN}✓${NC} deploy-api.yml: 'Verify API source (delete route)' step present"
else
  echo -e "${RED}✗${NC} deploy-api.yml: Missing verify step for delete route"
  ok=1
fi

# 3. Dockerfile: BUILD_SHA
if grep -q 'ARG BUILD_SHA' services/api/Dockerfile 2>/dev/null && grep -q 'BUILD_SHA' services/api/Dockerfile 2>/dev/null; then
  echo -e "${GREEN}✓${NC} Dockerfile: BUILD_SHA arg present"
else
  echo -e "${RED}✗${NC} Dockerfile: Missing BUILD_SHA (cache-bust per commit)"
  ok=1
fi

# 4. API: delete route in voice.py
if grep -q '"/stories/shared/delete"' services/api/app/routers/voice.py 2>/dev/null; then
  echo -e "${GREEN}✓${NC} voice.py: Delete route present"
else
  echo -e "${RED}✗${NC} voice.py: Delete route not found"
  ok=1
fi

# 5. Uncommitted changes? (warning only; deploy will use last committed state)
if ! git diff-index --quiet HEAD -- 2>/dev/null; then
  echo -e "${YELLOW}!${NC} Uncommitted changes (commit and push before release if you want them in the next deploy)"
else
  echo -e "${GREEN}✓${NC} No uncommitted changes"
fi

echo ""
if [ "$ok" -eq 0 ]; then
  echo -e "${GREEN}Repo is ready.${NC} When you run ./scripts/release.sh (or trigger Deploy All), the API job will:"
  echo "  - Check out the commit that triggered the run"
  echo "  - Verify the delete route is in source, then build and deploy"
  echo ""
  echo "If production still returns 404 for the delete route after a deploy:"
  echo "  1. Open GitHub → your repo → Actions"
  echo "  2. Open the latest 'Deploy All (Web + API)' run"
  echo "  3. Open the 'Deploy API' job"
  echo "  4. Check: did 'Verify API source (delete route)' pass? Did 'Deploy to Container Apps' succeed?"
  echo "  5. If the API job failed or was cancelled, fix the error and run release (or Deploy All) again."
else
  echo -e "${RED}Some checks failed. Fix the items above before deploying.${NC}"
  exit 1
fi
