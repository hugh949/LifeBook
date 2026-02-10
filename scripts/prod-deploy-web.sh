#!/usr/bin/env bash
# Trigger Deploy Web only on GitHub Actions. Use when only apps/web (or web config) changed.
set -e
cd "$(dirname "$0")/.."
if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) required. Install: https://cli.github.com/"
  echo "Or trigger manually: Actions → Deploy Web → Run workflow"
  exit 1
fi
gh workflow run deploy-web.yml
echo "Deploy Web started. Watch: $(git remote get-url origin | sed 's/\.git$//')/actions"
echo "After it completes: PROD_WEB_URL=https://app-lifebook-web-v1.azurewebsites.net ./scripts/verify-prod.sh"
