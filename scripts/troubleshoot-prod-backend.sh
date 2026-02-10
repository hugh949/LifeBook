#!/usr/bin/env bash
# Deep troubleshooting: why the backend (Container App) and/or database might not be responding.
# Run from repo root. Requires: curl, Azure CLI (az). Optional: DATABASE_URL and psql for DB check.
#
# Usage:
#   PROD_WEB_URL=https://app-lifebook-web-v1.azurewebsites.net ./scripts/troubleshoot-prod-backend.sh
#   DATABASE_URL='postgresql://...' ./scripts/troubleshoot-prod-backend.sh   # optional, for DB connectivity
#
# Overrides: AZURE_RESOURCE_GROUP, AZURE_CONTAINER_APP, AZURE_WEBAPP_NAME, PG_SERVER_NAME

set -e

BASE="${PROD_WEB_URL:-https://app-lifebook-web-v1.azurewebsites.net}"
RG="${AZURE_RESOURCE_GROUP:-rg-lifebook-v1}"
APP="${AZURE_CONTAINER_APP:-aca-lifebook-api-v1}"
WEBAPP="${AZURE_WEBAPP_NAME:-app-lifebook-web-v1}"
TIMEOUT=15
PASS=0
FAIL=0

echo "=============================================="
echo "  LifeBook production backend troubleshooting"
echo "=============================================="
echo "  Web App URL:  $BASE"
echo "  Container App: $APP (RG: $RG)"
echo "  Timeout:      ${TIMEOUT}s for HTTP checks"
echo "=============================================="
echo ""

# --- 1. Web App proxy and API_UPSTREAM ---
echo "[1/7] Web App: proxy and API_UPSTREAM"
PROXY_JSON=$(curl -s --max-time "$TIMEOUT" "$BASE/api/proxy-ping" 2>/dev/null) || PROXY_JSON=""
if echo "$PROXY_JSON" | grep -q '"proxy"[[:space:]]*:[[:space:]]*true'; then
  echo "  PASS  proxy is running"
  PASS=$((PASS + 1))
else
  echo "  FAIL  proxy-ping did not return proxy:true (or request failed)"
  FAIL=$((FAIL + 1))
fi
if echo "$PROXY_JSON" | grep -q '"upstreamSet"[[:space:]]*:[[:space:]]*true'; then
  echo "  PASS  API_UPSTREAM is set on the Web App"
  PASS=$((PASS + 1))
else
  echo "  FAIL  API_UPSTREAM not set or not visible. Restart Web App and set API_UPSTREAM in Azure."
  FAIL=$((FAIL + 1))
fi
echo ""

# --- 2. Web App -> Container App: /api/health ---
echo "[2/7] Web App proxy -> API /health"
HEALTH_CODE=$(curl -s -o /tmp/troubleshoot-health.json -w "%{http_code}" --max-time "$TIMEOUT" "$BASE/api/health" 2>/dev/null) || HEALTH_CODE="000"
if [[ "$HEALTH_CODE" == "200" ]]; then
  echo "  PASS  GET /api/health returned 200"
  PASS=$((PASS + 1))
else
  echo "  FAIL  GET /api/health returned $HEALTH_CODE (000 = timeout or connection error)"
  FAIL=$((FAIL + 1))
  echo "        -> Proxy works but Container App is not responding. See steps 4–6."
fi
echo ""

# --- 3. Container App URL and direct /health ---
echo "[3/7] Container App: direct /health (bypass Web App)"
FQDN=""
if command -v az &>/dev/null; then
  FQDN=$(az containerapp show -g "$RG" -n "$APP" --query "properties.configuration.ingress.fqdn" -o tsv 2>/dev/null) || true
fi
if [[ -z "$FQDN" ]]; then
  echo "  SKIP  Azure CLI not logged in or Container App not found. Run: az login"
  echo "        Then re-run this script."
else
  DIRECT_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$TIMEOUT" "https://$FQDN/health" 2>/dev/null) || DIRECT_CODE="000"
  if [[ "$DIRECT_CODE" == "200" ]]; then
    echo "  PASS  GET https://$FQDN/health -> $DIRECT_CODE"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  GET https://$FQDN/health -> $DIRECT_CODE (000 = timeout)"
    FAIL=$((FAIL + 1))
    echo "        -> Container is not responding. Likely: process exits before uvicorn (DB unreachable)."
  fi
fi
echo ""

# --- 4. Container App revisions and traffic ---
echo "[4/7] Container App: revisions and traffic"
if command -v az &>/dev/null && [[ -n "$FQDN" ]]; then
  echo "  Revisions (active):"
  az containerapp revision list -g "$RG" -n "$APP" --active-only -o table 2>/dev/null | head -20 || echo "  (could not list)"
  echo "  Traffic:"
  az containerapp ingress traffic show -g "$RG" -n "$APP" -o table 2>/dev/null || echo "  (could not show)"
  echo "  -> Ensure 100% traffic is on the latest revision (Revisions and replicas in Portal)."
else
  echo "  SKIP  Azure CLI or Container App FQDN not available"
fi
echo ""

# --- 5. Container App system log (exit 255, probe failed) ---
echo "[5/7] Container App: recent system log (exits, probe)"
if command -v az &>/dev/null; then
  SYSLOG=$(az containerapp logs show -g "$RG" -n "$APP" --type system --tail 25 2>/dev/null) || SYSLOG=""
  if echo "$SYSLOG" | grep -q "exit code.*255\|ProcessExited\|Probe.*failed"; then
    echo "  FAIL  System log shows container exit or probe failure:"
    echo "$SYSLOG" | grep -E "exit code|ProcessExited|Probe|Terminated" | tail -5 | sed 's/^/        /'
    FAIL=$((FAIL + 1))
    echo "        -> Usually means wait_for_db or migrations failed (DB unreachable). Fix Postgres firewall."
  else
    echo "  INFO  No recent exit/probe errors in system log (or log empty)."
  fi
else
  echo "  SKIP  Azure CLI not available"
fi
echo ""

# --- 6. Database connectivity (from this machine) ---
echo "[6/7] Database: connectivity from this machine"
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "  SKIP  DATABASE_URL not set. Set it to test DB from this machine (optional)."
else
  # Try psql first (common on dev machines)
  if command -v psql &>/dev/null; then
    if psql "$DATABASE_URL" -c "SELECT 1" -t 2>/dev/null | grep -q 1; then
      echo "  PASS  Database reachable from this machine (psql)"
      PASS=$((PASS + 1))
    else
      echo "  FAIL  Database not reachable from this machine. Check: Postgres firewall, DATABASE_URL, VPN."
      FAIL=$((FAIL + 1))
    fi
  else
    # Try Python + psycopg if we're in the repo and have the API env
    API_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../services/api" 2>/dev/null && pwd)"
    if [[ -n "$API_DIR" ]] && [[ -d "$API_DIR" ]] && (cd "$API_DIR" && uv run python -c "
import os, sys
u = os.environ.get('DATABASE_URL','')
if not u: sys.exit(2)
try:
    import psycopg
    with psycopg.connect(u, connect_timeout=5) as c:
        c.execute('SELECT 1')
    sys.exit(0)
except Exception as e:
    print(e, file=sys.stderr)
    sys.exit(1)
" 2>/dev/null); then
      echo "  PASS  Database reachable from this machine (Python/psycopg)"
      PASS=$((PASS + 1))
    else
      echo "  FAIL  Database not reachable from this machine (or psql/uv not available)."
      FAIL=$((FAIL + 1))
      echo "        Note: Container App uses a different network. If this machine can't reach DB,"
      echo "        ensure Postgres firewall allows your IP. For the container, allow Azure services."
    fi
  fi
fi
echo ""

# --- 7. Postgres firewall rules (if we have server name) ---
echo "[7/7] PostgreSQL: firewall rules (Azure)"
PG_SERVER="${PG_SERVER_NAME:-}"
if [[ -z "$PG_SERVER" ]] && [[ -n "${DATABASE_URL:-}" ]]; then
  # Parse host from DATABASE_URL (simple: postgresql://user:pass@host:5432/db)
  if [[ "$DATABASE_URL" =~ @([^:/]+): ]]; then
    PG_SERVER="${BASH_REMATCH[1]}"
    # Remove .postgres.database.azure.com for az CLI (server name is the prefix)
    PG_SERVER="${PG_SERVER%%.postgres.database.azure.com}"
  fi
fi
if command -v az &>/dev/null && [[ -n "$PG_SERVER" ]]; then
  echo "  Server: $PG_SERVER (from PG_SERVER_NAME or DATABASE_URL)"
  RULES=$(az postgres flexible-server firewall-rule list -g "$RG" -s "$PG_SERVER" -o table 2>/dev/null) || RULES=""
  if [[ -n "$RULES" ]]; then
    echo "$RULES" | head -15
    if echo "$RULES" | grep -qi "allow.*azure\|0.0.0.0"; then
      echo "  INFO  At least one rule allows Azure or 0.0.0.0. Container App may still need 'Allow Azure services'."
    else
      echo "  WARN  No rule found that clearly allows Azure services. Add 'Allow Azure services' in Portal."
    fi
  else
    echo "  WARN  Could not list firewall rules (wrong server name or no access)."
    echo "        In Portal: Postgres server -> Networking -> allow Azure services."
  fi
else
  echo "  SKIP  Set PG_SERVER_NAME or DATABASE_URL (with host) and ensure 'az login' for firewall list."
fi
echo ""

# --- Summary and next steps ---
echo "=============================================="
echo "  Summary: $PASS passed, $FAIL failed"
echo "=============================================="
if [[ $FAIL -eq 0 ]]; then
  echo "  All checks passed. If the app still misbehaves, check Container App console logs and Web App logs."
  exit 0
fi
echo ""
echo "  What to do next:"
echo "  - If [2] or [3] failed: Container App is not responding. Check [5] and [6]/[7]."
echo "  - If [5] shows exit 255 / ProcessExited: the API process exits before uvicorn (usually DB unreachable)."
echo "  - Fix: Postgres -> Networking -> allow 'Azure services' (or add rule 0.0.0.0). Then redeploy API."
echo "  - If [6] failed from this machine: fix Postgres firewall for your IP; for the container, allow Azure."
echo "  - Doc: docs/Troubleshooting_Secrets_and_500s.md (section 7a)"
echo ""
exit 1
