#!/usr/bin/env bash
# Trigger Deploy All (Web + API) on GitHub Actions. Use after pushing to main.
# Prefer ./scripts/release.sh for full flow: verify → commit → deploy → verify.
set -e
cd "$(dirname "$0")/.."
if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) required. Install: https://cli.github.com/"
  echo "Or trigger manually: Actions → Deploy All (Web + API) → Run workflow"
  exit 1
fi
gh workflow run deploy-all.yml
echo "Deploy All started. Watch: $(git remote get-url origin | sed 's/\.git$//')/actions"
echo "After it completes: PROD_WEB_URL=https://app-lifebook-web-v1.azurewebsites.net ./scripts/verify-prod.sh"
