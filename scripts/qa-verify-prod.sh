#!/usr/bin/env bash
# Comprehensive QA: verify proxy, health, voice (participants, context, stories, shared, delete, narrate, narrate/bgm), moments.
# Usage: PROD_WEB_URL=https://app-lifebook-web-v1.azurewebsites.net ./scripts/qa-verify-prod.sh
#   QA_LOG=1  tee output to logs/qa-verify-prod-YYYYMMDD_HHMM.log
# Exits 0 if all checks pass, 1 otherwise. Prints "QA checks: X passed, Y failed" at end.

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TIMEOUT="${VERIFY_TIMEOUT:-60}"
BASE="${PROD_WEB_URL:-https://app-lifebook-web-v1.azurewebsites.net}"
TMP_PREFIX="/tmp/qa-verify-$$"
passed=0
failed=0

maybe_log() {
  echo "$@"
  if [[ -n "${QA_LOG:-}" && -n "$QA_LOG_FILE" ]]; then
    echo "$@" >> "$QA_LOG_FILE"
  fi
}

if [[ -n "${QA_LOG:-}" ]]; then
  TS=$(date +%Y%m%d_%H%M)
  LOG_DIR="$REPO_ROOT/logs"
  mkdir -p "$LOG_DIR"
  QA_LOG_FILE="$LOG_DIR/qa-verify-prod-$TS.log"
  exec > >(tee "$QA_LOG_FILE") 2>&1
fi

maybe_log "=== QA verify prod: $BASE ==="
maybe_log ""

check() {
  local method="$1"
  local path="$2"
  local expect_code="${3:-200}"
  local extra="${4:-}"
  local url="$BASE$path"
  maybe_log "→ $method $path"
  local code bodyfile
  bodyfile="${TMP_PREFIX}-body"
  if [[ "$method" == "GET" ]]; then
    code=$(curl -s --max-time "$TIMEOUT" -o "$bodyfile" -w "%{http_code}" "$url") || code="000"
  else
    code=$(curl -s --max-time "$TIMEOUT" -X "$method" -H "Content-Type: application/json" -d "$extra" -o "$bodyfile" -w "%{http_code}" "$url") || code="000"
  fi
  if [[ "$code" == "$expect_code" ]] || { [[ "$expect_code" == "2xx" ]] && [[ "$code" =~ ^2 ]]; }; then
    maybe_log "  OK ($code)"
    ((passed++)) || true
    return 0
  else
    maybe_log "  FAIL: expected $expect_code, got $code"
    ((failed++)) || true
    return 1
  fi
}

# 1. Proxy
check GET "/api/proxy-ping" 200
grep -q '"proxy"[[:space:]]*:[[:space:]]*true' "${TMP_PREFIX}-body" 2>/dev/null || { maybe_log "  FAIL: proxy response missing proxy:true"; ((passed--)); ((failed++)); }

# 2. Health
check GET "/api/health" 200
grep -q "build_sha" "${TMP_PREFIX}-body" 2>/dev/null || { maybe_log "  FAIL: /health missing build_sha"; ((passed--)); ((failed++)); }

# 3. Version (optional)
if [[ -n "${EXPECTED_VERSION:-}" ]]; then
  maybe_log "→ GET $BASE (app-version meta)"
  code=$(curl -sL --max-time "$TIMEOUT" -o "${TMP_PREFIX}-page.html" -w "%{http_code}" "$BASE") || code="000"
  if [[ "$code" == "200" ]]; then
    deployed=$(grep -oE 'name="app-version"[^>]*content="[^"]*"' "${TMP_PREFIX}-page.html" 2>/dev/null | sed 's/.*content="\([^"]*\)".*/\1/' || true)
    if [[ "$deployed" == "$EXPECTED_VERSION" ]]; then
      maybe_log "  OK (version $deployed)"
      ((passed++)) || true
    else
      maybe_log "  FAIL: expected version $EXPECTED_VERSION, got $deployed"
      ((failed++)) || true
    fi
  else
    maybe_log "  FAIL: got $code"
    ((failed++)) || true
  fi
fi

# 4. Voice participants
check GET "/api/voice/participants" 200

# 5. Voice context (422 acceptable when no participant context)
maybe_log "→ GET /api/voice/context"
code=$(curl -s --max-time "$TIMEOUT" -o "${TMP_PREFIX}-body" -w "%{http_code}" "$BASE/api/voice/context") || code="000"
if [[ "$code" == "200" || "$code" == "422" ]]; then
  maybe_log "  OK ($code)"
  ((passed++)) || true
else
  maybe_log "  FAIL: expected 200 or 422, got $code"
  ((failed++)) || true
fi

# 6. Voice stories (own) - empty participant_id may return 200 + []
check GET "/api/voice/stories?participant_id=" 200

# 7. Voice stories shared
check GET "/api/voice/stories/shared" 200

# 8. Delete endpoint exists
check GET "/api/voice/stories/shared/delete" 200
grep -q '"delete_endpoint"[[:space:]]*:[[:space:]]*true' "${TMP_PREFIX}-body" 2>/dev/null || { maybe_log "  FAIL: delete response missing delete_endpoint:true"; ((passed--)); ((failed++)); }

# 9. Narrate route (POST; expect 200 with audio or 4xx for validation - not 5xx)
maybe_log "→ POST /api/voice/narrate"
code=$(curl -s --max-time 90 -X POST -H "Content-Type: application/json" -d '{"text":"test"}' -o "${TMP_PREFIX}-narrate" -w "%{http_code}" "$BASE/api/voice/narrate") || code="000"
if [[ "$code" =~ ^5 ]]; then
  maybe_log "  FAIL: got $code (5xx)"
  ((failed++)) || true
else
  maybe_log "  OK ($code)"
  ((passed++)) || true
fi

# 10. Narrate BGM route
check POST "/api/voice/narrate/bgm" 200 '{"moment_id":"00000000-0000-0000-0000-000000000000","text":"test"}'

# 11. Moments
check GET "/api/moments" 200

# Cleanup
rm -f "${TMP_PREFIX}"-*

maybe_log ""
maybe_log "QA checks: $passed passed, $failed failed"
[[ $failed -eq 0 ]]
exit $?
