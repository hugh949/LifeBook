#!/usr/bin/env bash
# Pre-release check: ensures deploy config is correct and (with --require-clean) no uncommitted changes.
# Run from repo root: ./scripts/check-deploy-ready.sh [--require-clean]
#   --require-clean: fail if there are uncommitted changes (ensures everything is committed before deploy).

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

REQUIRE_CLEAN=0
for arg in "$@"; do
  if [ "$arg" = "--require-clean" ]; then REQUIRE_CLEAN=1; fi
done

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok=0

echo "Pre-release check (deploy config + repo state)..."
echo ""

# 1. Workflow: checkout must pin ref
if grep -q 'ref: \${{ github.sha }}' .github/workflows/deploy-api.yml 2>/dev/null; then
  echo -e "${GREEN}✓${NC} deploy-api.yml: Checkout pins ref to github.sha"
else
  echo -e "${RED}✗${NC} deploy-api.yml: Missing 'ref: \${{ github.sha }}' in Checkout step"
  ok=1
fi

# 2. Workflow: verify step must exist (delete route + BGM)
if grep -q 'Verify API source' .github/workflows/deploy-api.yml 2>/dev/null; then
  echo -e "${GREEN}✓${NC} deploy-api.yml: Verify API source step present"
else
  echo -e "${RED}✗${NC} deploy-api.yml: Missing verify step for delete route / BGM"
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

# 5. Uncommitted changes
if ! git diff-index --quiet HEAD -- 2>/dev/null; then
  if [ "$REQUIRE_CLEAN" -eq 1 ]; then
    echo -e "${RED}✗${NC} Uncommitted changes — commit everything first so it is deployed"
    echo "  git add -A && git commit -m 'Your message'"
    ok=1
  else
    echo -e "${YELLOW}!${NC} Uncommitted changes (commit before release so they are deployed)"
  fi
else
  echo -e "${GREEN}✓${NC} No uncommitted changes"
fi

# 6. Verify script exists
if [ ! -f "$REPO_ROOT/scripts/verify-prod.sh" ]; then
  echo -e "${RED}✗${NC} scripts/verify-prod.sh not found"
  ok=1
else
  echo -e "${GREEN}✓${NC} scripts/verify-prod.sh present"
fi

# 7. Deploy workflows exist
if [ ! -f "$REPO_ROOT/.github/workflows/deploy-all.yml" ]; then
  echo -e "${RED}✗${NC} .github/workflows/deploy-all.yml not found"
  ok=1
else
  echo -e "${GREEN}✓${NC} Deploy workflows present"
fi

echo ""
if [ "$ok" -eq 0 ]; then
  echo -e "${GREEN}Pre-release check passed.${NC} Safe to run ./scripts/release.sh"
else
  echo -e "${RED}Pre-release check failed. Fix the items above before deploying.${NC}"
  exit 1
fi
