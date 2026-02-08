#!/usr/bin/env bash
# Verify production (web proxy + API health).
# Usage: PROD_WEB_URL=https://app-lifebook-web-v1.azurewebsites.net ./scripts/verify-prod.sh
# Exits 0 if both checks pass, 1 otherwise.

set -e

BASE="${PROD_WEB_URL:-https://app-lifebook-web-v1.azurewebsites.net}"
PROXY_PING="$BASE/api/proxy-ping"
API_HEALTH="$BASE/api/health"

ok=0

echo "→ GET $PROXY_PING"
code=$(curl -s -o /tmp/verify-prod-proxy.json -w "%{http_code}" "$PROXY_PING")
if [[ "$code" != "200" ]]; then
  echo "  FAIL: expected 200, got $code"
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
code=$(curl -s -o /tmp/verify-prod-health.json -w "%{http_code}" "$API_HEALTH")
if [[ "$code" != "200" ]]; then
  echo "  FAIL: expected 200, got $code"
  ok=1
else
  echo "  OK (200)"
fi

rm -f /tmp/verify-prod-proxy.json /tmp/verify-prod-health.json
exit "$ok"
