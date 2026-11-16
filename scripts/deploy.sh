#!/usr/bin/env bash
# One-step LifeBook release. Hugh says "deploy"; the agent runs this.
# Sync main, typecheck, local core QA, commit, push, Azure deploy, production QA.
# Stops before push if any check fails. Never commits .env.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"
PROD_WEB_URL="${PROD_WEB_URL:-https://app-lifebook-web-v1.azurewebsites.net}"

log() { echo ""; echo "== $* =="; }

if [[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ]]; then
  echo "Refusing to deploy from $(git rev-parse --abbrev-ref HEAD). Checkout main first."
  exit 1
fi

log "Latest code"
git fetch origin
if git merge-base --is-ancestor HEAD origin/main; then
  git pull --ff-only origin main
elif git merge-base --is-ancestor origin/main HEAD; then
  echo "Local main is ahead of origin. QA runs on this tree, then it is pushed."
else
  echo "main has diverged from origin/main. Resolve that, then say deploy again."
  exit 1
fi

log "Typecheck"
./apps/web/node_modules/.bin/tsc --noEmit -p apps/web/tsconfig.json

log "Local app"
if ! curl -sf --max-time 5 http://localhost:8000/health >/dev/null; then
  docker compose up -d
fi
ready=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if curl -sf --max-time 5 http://localhost:3000/signin | grep -qi "LifeBook\|Welcome back"; then
    ready=1
    break
  fi
  sleep 5
done
if [[ "$ready" != "1" ]]; then
  echo "Local LifeBook is not answering on http://localhost:3000. Fix that before deploy."
  exit 1
fi

log "Local core QA"
./scripts/qa-core.sh http://localhost:3000

log "Commit"
git add -A
git reset -- .env .env.local .env.azure >/dev/null 2>&1 || true
if ! git diff --cached --quiet; then
  msg="${DEPLOY_MESSAGE:-Ship checked LifeBook changes}"
  git commit -m "$(cat <<EOF
$msg

EOF
)"
else
  echo "Nothing new to commit."
fi

log "Push"
git push origin main

log "Azure deploy"
gh workflow run deploy-all.yml --ref main
sleep 4
run_id="$(gh run list --workflow deploy-all.yml --branch main --limit 1 --json databaseId --jq '.[0].databaseId')"
echo "Watching GitHub Actions run $run_id"
gh run watch "$run_id" --exit-status

log "Production QA"
sha="$(git rev-parse HEAD)"
EXPECTED_BUILD_SHA="$sha" PROD_WEB_URL="$PROD_WEB_URL" ./scripts/qa-core.sh "$PROD_WEB_URL"

echo ""
echo "Deployed $sha"
echo "$PROD_WEB_URL"
