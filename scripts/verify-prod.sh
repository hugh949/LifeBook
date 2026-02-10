#!/usr/bin/env bash
# Verify production (web proxy + API health + optional version).
# Usage:
#   PROD_WEB_URL=https://app-lifebook-web-v1.azurewebsites.net ./scripts/verify-prod.sh
#   EXPECTED_VERSION=1.1 PROD_WEB_URL=... ./scripts/verify-prod.sh   # also check deployed version
# Exits 0 if all checks pass, 1 otherwise.

set -e

BASE="${PROD_WEB_URL:-https://app-lifebook-web-v1.azurewebsites.net}"
PROXY_PING="$BASE/api/proxy-ping"
API_HEALTH="$BASE/api/health"

ok=0

echo "→ GET $PROXY_PING"
code=$(curl -s --max-time 30 -o /tmp/verify-prod-proxy.json -w "%{http_code}" "$PROXY_PING") || code="000"
if [[ "$code" != "200" ]]; then
  echo "  FAIL: expected 200, got $code (timeout or connection error if 000)"
  ok=1
else
  if grep -q '"proxy"[[:space:]]*:[[:space:]]*true' /tmp/verify-prod-proxy.json 2>/dev/null; then
    echo "  OK (200, proxy: true)"
  else
    echo "  FAIL: 200 but JSON does not contain \"proxy\": true"
    ok=1
  fi
fi

echo "→ GET $API_HEALTH"
code=$(curl -s --max-time 30 -o /tmp/verify-prod-health.json -w "%{http_code}" "$API_HEALTH") || code="000"
if [[ "$code" != "200" ]]; then
  echo "  FAIL: expected 200, got $code (timeout or connection error if 000)"
  ok=1
else
  echo "  OK (200)"
fi

# Optional: check deployed app version (meta tag in HTML)
if [[ -n "${EXPECTED_VERSION:-}" ]]; then
  echo "→ GET $BASE (app-version meta)"
  code=$(curl -sL --max-time 30 -o /tmp/verify-prod-page.html -w "%{http_code}" "$BASE") || code="000"
  if [[ "$code" != "200" ]]; then
    echo "  FAIL: expected 200, got $code"
    ok=1
  else
    deployed=$(grep -oE 'name="app-version"[^>]*content="[^"]*"' /tmp/verify-prod-page.html 2>/dev/null | sed 's/.*content="\([^"]*\)".*/\1/' || true)
    if [[ -z "$deployed" ]]; then
      echo "  FAIL: no app-version meta tag in page"
      ok=1
    elif [[ "$deployed" != "$EXPECTED_VERSION" ]]; then
      echo "  FAIL: expected version $EXPECTED_VERSION, got $deployed"
      ok=1
    else
      echo "  OK (version $deployed)"
    fi
  fi
  rm -f /tmp/verify-prod-page.html
fi

rm -f /tmp/verify-prod-proxy.json /tmp/verify-prod-health.json
exit "$ok"
