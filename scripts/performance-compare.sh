#!/usr/bin/env bash
# Compare baseline and after-performance JSON from performance-benchmark.sh.
# Usage: ./scripts/performance-compare.sh logs/performance-baseline-pre-perf-YYYYMMDD.json logs/performance-after-perf-YYYYMMDD.json
# Or:   BASELINE_JSON=path1 AFTER_JSON=path2 ./scripts/performance-compare.sh
# Prints before/after table (median_total_seconds and median_ttfb_seconds per endpoint).

set -e

BASELINE="${1:-${BASELINE_JSON:-}}"
AFTER="${2:-${AFTER_JSON:-}}"
if [[ -z "$BASELINE" || -z "$AFTER" ]]; then
  echo "Usage: $0 <baseline.json> <after.json>"
  echo "  Or: BASELINE_JSON=path AFTER_JSON=path $0"
  exit 1
fi
if [[ ! -f "$BASELINE" ]]; then
  echo "Baseline file not found: $BASELINE"
  exit 1
fi
if [[ ! -f "$AFTER" ]]; then
  echo "After file not found: $AFTER"
  exit 1
fi

# Use jq if available for reliable JSON parsing
if command -v jq >/dev/null 2>&1; then
  echo "=== Performance comparison ==="
  echo "Baseline: $BASELINE"
  echo "After:    $AFTER"
  echo ""
  printf "%-25s %12s %12s %10s\n" "Endpoint" "Before (s)" "After (s)" "Change"
  echo "--------------------------------------------------------------------------------"
  for key in ttfb_home ttfb_proxy latency_health latency_voice_shared latency_voice_context; do
    b_total=$(jq -r ".endpoints.\"$key\".median_total_seconds // empty" "$BASELINE")
    a_total=$(jq -r ".endpoints.\"$key\".median_total_seconds // empty" "$AFTER")
    if [[ -z "$b_total" ]]; then b_total="—"; fi
    if [[ -z "$a_total" ]]; then a_total="—"; fi
    if [[ "$b_total" != "—" && "$a_total" != "—" && "$b_total" =~ ^[0-9.]*$ ]]; then
      change=$(echo "scale=2; (${a_total} - ${b_total}) / ${b_total} * 100" 2>/dev/null | bc 2>/dev/null || echo "—")
      [[ -n "$change" && "$change" != "—" ]] && change="${change}%"
    else
      change="—"
    fi
    printf "%-25s %12s %12s %10s\n" "$key" "$b_total" "$a_total" "${change:-—}"
  done
  b_cold=$(jq -r '.cold_start_health_ms // empty' "$BASELINE")
  a_cold=$(jq -r '.cold_start_health_ms // empty' "$AFTER")
  if [[ -n "$b_cold" || -n "$a_cold" ]]; then
    echo ""
    printf "%-25s %12s %12s\n" "cold_start_health_ms" "${b_cold:-—}" "${a_cold:-—}"
  fi
else
  echo "Install 'jq' for JSON comparison. Showing file paths only:"
  echo "Baseline: $BASELINE"
  echo "After:    $AFTER"
  echo "Extract with: jq '.endpoints' $BASELINE and $AFTER"
  exit 0
fi
