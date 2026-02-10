#!/usr/bin/env bash
# Trigger Deploy API only on GitHub Actions. Use when only services/api (or API config) changed.
set -e
cd "$(dirname "$0")/.."
if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) required. Install: https://cli.github.com/"
  echo "Or trigger manually: Actions → Deploy API → Run workflow"
  exit 1
fi
gh workflow run deploy-api.yml
echo "Deploy API started. Watch: $(git remote get-url origin | sed 's/\.git$//')/actions"
echo "After it completes: PROD_WEB_URL=https://app-lifebook-web-v1.azurewebsites.net ./scripts/verify-prod.sh"
