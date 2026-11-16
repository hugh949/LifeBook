#!/usr/bin/env bash
# Core LifeBook checks against a web origin (local or production).
# Usage:
#   ./scripts/qa-core.sh http://localhost:3000
#   EXPECTED_BUILD_SHA=<git sha> ./scripts/qa-core.sh https://app-lifebook-web-v1.azurewebsites.net
# Exits 0 only when every check passes.
set -euo pipefail

BASE="${1:-http://localhost:3000}"
BASE="${BASE%/}"
TIMEOUT="${VERIFY_TIMEOUT:-90}"
TMP="${TMPDIR:-/tmp}/lifebook-qa-$$"
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT

pass=0
fail=0

ok() { echo "  OK $*"; pass=$((pass + 1)); }
bad() { echo "  FAIL $*"; fail=$((fail + 1)); }

http() {
  # http METHOD URL OUTFILE [JSON]
  # One retry: Azure Web Apps often drop the first request after a restart.
  local method="$1" url="$2" out="$3" body="${4:-}" attempt code
  for attempt in 1 2; do
    if [[ -n "$body" ]]; then
      code=$(curl -sS --max-time "$TIMEOUT" -c "$TMP/cj" -b "$TMP/cj" \
        -X "$method" -H "Content-Type: application/json" -d "$body" \
        -o "$out" -w "%{http_code}" "$url" || true)
    else
      code=$(curl -sS --max-time "$TIMEOUT" -c "$TMP/cj" -b "$TMP/cj" \
        -X "$method" -o "$out" -w "%{http_code}" "$url" || true)
    fi
    code="${code:-000}"
    if [[ "$code" != "000" && "$code" != "000000" ]]; then
      echo "$code"
      return 0
    fi
    sleep 5
  done
  echo "000"
}

echo "=== Core QA: $BASE ==="

echo "→ sign-in page"
code=$(http GET "$BASE/signin" "$TMP/signin.html")
if [[ "$code" == "200" ]] && grep -qi "LifeBook\|Welcome back\|app-version\|app-shell" "$TMP/signin.html"; then
  ok "signin page"
else
  bad "signin page (HTTP $code)"
fi

echo "→ health"
code=$(http GET "$BASE/api/health" "$TMP/health.json")
if [[ "$code" == "200" ]] && grep -q "build_sha" "$TMP/health.json"; then
  ok "health"
else
  bad "health (HTTP $code)"
fi
if [[ -n "${EXPECTED_BUILD_SHA:-}" ]]; then
  if grep -q "\"build_sha\"[[:space:]]*:[[:space:]]*\"${EXPECTED_BUILD_SHA}" "$TMP/health.json"; then
    ok "build_sha ${EXPECTED_BUILD_SHA:0:12}"
  else
    bad "build_sha is not ${EXPECTED_BUILD_SHA:0:12}"
  fi
fi

echo "→ background music"
for track in neutral warm reflective nostalgic; do
  code=$(curl -sS --max-time "$TIMEOUT" -o /dev/null -w "%{http_code}" "$BASE/bgm/${track}.mp3" || echo "000")
  if [[ "$code" == "200" ]]; then
    ok "bgm/$track"
  else
    bad "bgm/$track (HTTP $code)"
  fi
done

echo "→ signed-out routes stay closed"
code=$(http GET "$BASE/api/library" "$TMP/library-anon.json")
if [[ "$code" == "401" ]]; then ok "library requires sign-in"; else bad "library unsigned HTTP $code"; fi
code=$(http GET "$BASE/api/me/voice" "$TMP/voice-anon.json")
if [[ "$code" == "401" ]]; then ok "voice requires sign-in"; else bad "voice unsigned HTTP $code"; fi

echo "→ forgot password does not leak a reset link"
code=$(http POST "$BASE/api/auth/forgot-password" "$TMP/forgot.json" '{"email":"nobody-qa@lifebook.local"}')
if [[ "$code" == "200" ]] && ! grep -q "reset-password?token=" "$TMP/forgot.json"; then
  ok "forgot password"
else
  bad "forgot password (HTTP $code)"
fi

echo "→ sign up, sign in, library"
EMAIL="qa.$(date +%s)@lifebook.local"
PASS="QaTest-$(date +%s)!"
code=$(http POST "$BASE/api/auth/signup" "$TMP/signup.json" "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"display_name\":\"QA\"}")
if [[ "$code" == "200" ]]; then ok "signup"; else bad "signup HTTP $code"; fi
code=$(http GET "$BASE/api/auth/me" "$TMP/me.json")
if [[ "$code" == "200" ]] && grep -q "$EMAIL" "$TMP/me.json"; then ok "session"; else bad "session HTTP $code"; fi
code=$(http GET "$BASE/api/library" "$TMP/library.json")
if [[ "$code" == "200" ]]; then ok "library"; else bad "library HTTP $code"; fi

echo ""
echo "Core QA: $pass passed, $fail failed"
[[ "$fail" -eq 0 ]]
