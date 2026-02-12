#!/usr/bin/env bash
# Measure TTFB and latency for key endpoints (home, proxy, health, voice/shared, voice/context).
# Usage: PROD_WEB_URL=https://app-lifebook-web-v1.azurewebsites.net ./scripts/performance-benchmark.sh
#   OUTPUT_JSON=/path/file.json  optional output path (default: logs/performance-benchmark-YYYYMMDD_HHMM.json)
#   COLD_START=1  sleep 5 min then measure /api/health once as cold_start_health_ms
# Output: JSON file + human-readable summary to stdout and logs/performance-benchmark-*.log

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="${PROD_WEB_URL:-https://app-lifebook-web-v1.azurewebsites.net}"
TIMEOUT=60
RUNS=3
TS=$(date +%Y%m%d_%H%M)
LOG_DIR="$REPO_ROOT/logs"
mkdir -p "$LOG_DIR"
JSON_FILE="${OUTPUT_JSON:-$LOG_DIR/performance-benchmark-$TS.json}"
LOG_FILE="$LOG_DIR/performance-benchmark-$TS.log"

# Run one curl, output: status_code time_starttransfer time_total (space-separated)
run_one() {
  local url="$1"
  curl -s -o /dev/null -w "%{http_code} %{time_starttransfer} %{time_total}" --max-time "$TIMEOUT" "$url"
}

# Median of 3 numbers (we run 3 times)
median3() {
  echo "$1 $2 $3" | tr ' ' '\n' | sort -n | sed -n '2p'
}

# Endpoints: path (relative to BASE) and label for JSON
# Format: "path|label"
ENDPOINTS="
/|ttfb_home
/api/proxy-ping|ttfb_proxy
/api/health|latency_health
/api/voice/stories/shared|latency_voice_shared
/api/voice/context|latency_voice_context
"

exec > >(tee "$LOG_FILE") 2>&1

echo "=== Performance benchmark at $TS ==="
echo "BASE=$BASE"
echo ""

# Optional cold-start: sleep 5 min then one health request
if [[ -n "${COLD_START:-}" ]]; then
  echo "COLD_START=1: waiting 5 minutes before cold request..."
  sleep 300
  cold_out=$(run_one "$BASE/api/health")
  cold_code=$(echo "$cold_out" | cut -d' ' -f1)
  cold_total=$(echo "$cold_out" | cut -d' ' -f3)
  cold_ms=$(echo "$cold_total * 1000" | bc 2>/dev/null || echo "0")
  echo "cold_start_health: ${cold_total}s (${cold_ms}ms) status=$cold_code"
  echo ""
  COLD_MS="$cold_ms"
else
  COLD_MS=""
fi

# Build JSON into a temp file
JSON_TMP=$(mktemp)
trap "rm -f $JSON_TMP" EXIT
echo "{" >> "$JSON_TMP"
echo "  \"timestamp\": \"$(date -Iseconds 2>/dev/null || date)\"," >> "$JSON_TMP"
echo "  \"PROD_WEB_URL\": \"$BASE\"," >> "$JSON_TMP"
echo "  \"endpoints\": {" >> "$JSON_TMP"

first=1
for line in $ENDPOINTS; do
  [[ -z "$line" ]] && continue
  path="${line%%|*}"
  label="${line##*|}"
  url="$BASE$path"
  echo "  $label: $url"

  ttfb_1="" ttfb_2="" ttfb_3="" total_1="" total_2="" total_3="" code_1="" code_2="" code_3=""
  for i in 1 2 3; do
    out=$(run_one "$url")
    code=$(echo "$out" | cut -d' ' -f1)
    ttfb=$(echo "$out" | cut -d' ' -f2)
    total=$(echo "$out" | cut -d' ' -f3)
    eval "code_$i=$code"
    eval "ttfb_$i=$ttfb"
    eval "total_$i=$total"
  done
  med_ttfb=$(median3 "$ttfb_1" "$ttfb_2" "$ttfb_3")
  med_total=$(median3 "$total_1" "$total_2" "$total_3")
  ok=$(echo "$code_1 $code_2 $code_3" | tr ' ' '\n' | grep -c 200 || true)
  echo "    median_total=${med_total}s, status=200 ($ok/$RUNS)"

  [[ $first -eq 0 ]] && echo "," >> "$JSON_TMP"
  first=0
  echo -n "    \"$label\": {\"median_ttfb_seconds\": $med_ttfb, \"median_total_seconds\": $med_total, \"success_count\": $ok}" >> "$JSON_TMP"
done

echo "" >> "$JSON_TMP"
echo "  }" >> "$JSON_TMP"
if [[ -n "${COLD_MS:-}" ]]; then
  echo "  , \"cold_start_health_ms\": $COLD_MS" >> "$JSON_TMP"
fi
echo "}" >> "$JSON_TMP"
cp "$JSON_TMP" "$JSON_FILE"

echo ""
echo "Results written to $JSON_FILE and $LOG_FILE"
