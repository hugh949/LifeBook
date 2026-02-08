#!/usr/bin/env bash
# LifeBook API Container App - status and management via Azure CLI.
# Usage: ./scripts/azure-api-status.sh <command> [args]
#
# Commands:
#   list       - List revisions with status
#   traffic    - Show or set traffic split (set: REVISION=100)
#   logs       - Show recent logs (optionally --follow)
#   health     - Curl /health on the API
#   url        - Print the API base URL

set -e

RG="${AZURE_RESOURCE_GROUP:-rg-lifebook-v1}"
APP="${AZURE_CONTAINER_APP:-aca-lifebook-api-v1}"

cmd="${1:-}"
shift || true

case "$cmd" in
  list)
    echo "=== Revisions for $APP ==="
    az containerapp revision list -g "$RG" -n "$APP" --all -o table
    ;;
  traffic)
    if [[ -n "$1" ]]; then
      # Set: ./azure-api-status.sh traffic aca-lifebook-api-v1--rx9fam5=100
      echo "Setting traffic: $1"
      az containerapp ingress traffic set -g "$RG" -n "$APP" --revision-weight "$1"
      echo "Done."
    else
      echo "=== Traffic split ==="
      az containerapp ingress traffic show -g "$RG" -n "$APP" -o table
      echo ""
      echo "To set 100%% to a revision: ./scripts/azure-api-status.sh traffic REVISION=100"
      echo "  e.g. ./scripts/azure-api-status.sh traffic aca-lifebook-api-v1--rx9fam5=100"
    fi
    ;;
  logs)
    REV=""
    FOLLOW=""
    TAIL="100"
    TYPE="console"
    for a in "$@"; do
      [[ "$a" == "--follow" ]] && FOLLOW="--follow"
      [[ "$a" == "--system" ]] && TYPE="system"
      [[ "$a" =~ ^[0-9]+$ ]] && TAIL="$a"
      [[ "$a" != "--follow" ]] && [[ "$a" != "--system" ]] && [[ -z "$TYPE" || "$a" != "$TYPE" ]] && [[ ! "$a" =~ ^[0-9]+$ ]] && [[ -n "$a" ]] && REV="$a"
    done
    echo "=== Container App logs (type=$TYPE, tail=$TAIL) ==="
    REV_ARG=""; [ -n "$REV" ] && REV_ARG="--revision $REV"; az containerapp logs show -g "$RG" -n "$APP" --type "$TYPE" --tail "$TAIL" $FOLLOW $REV_ARG
    ;;
  health)
    FQDN=$(az containerapp show -g "$RG" -n "$APP" --query "properties.configuration.ingress.fqdn" -o tsv)
    URL="https://$FQDN/health"
    echo "GET $URL"
    curl -s -w "\nHTTP %{http_code}\n" "$URL" || true
    ;;
  url)
    FQDN=$(az containerapp show -g "$RG" -n "$APP" --query "properties.configuration.ingress.fqdn" -o tsv)
    echo "https://$FQDN"
    ;;
  moments)
    FQDN=$(az containerapp show -g "$RG" -n "$APP" --query "properties.configuration.ingress.fqdn" -o tsv)
    URL="https://$FQDN/moments"
    echo "GET $URL"
    echo "---"
    curl -s -w "\n---\nHTTP %{http_code}\n" "$URL" | head -c 2000
    echo ""
    ;;
  summary)
    echo "=== Revisions (active) ==="
    az containerapp revision list -g "$RG" -n "$APP" --active-only -o table 2>/dev/null || az containerapp revision list -g "$RG" -n "$APP" --all -o table
    echo ""
    echo "=== Traffic ==="
    az containerapp ingress traffic show -g "$RG" -n "$APP" -o table
    echo ""
    FQDN=$(az containerapp show -g "$RG" -n "$APP" --query "properties.configuration.ingress.fqdn" -o tsv)
    echo "=== Health check ==="
    curl -s -o /dev/null -w "GET https://$FQDN/health -> %{http_code}\n" "https://$FQDN/health"
    echo ""
    echo "=== Recent logs (last 30) ==="
    az containerapp logs show -g "$RG" -n "$APP" --type console --tail 30 2>/dev/null || echo "(no logs or not ready)"
    ;;
  *)
    echo "LifeBook API Container App - CLI status and management"
    echo ""
    echo "Usage: $0 <command> [args]"
    echo ""
    echo "Commands:"
    echo "  list              List revisions with status"
    echo "  traffic [REV=100] Show traffic split, or set 100% to REV"
    echo "  logs [N] [--follow] [--system]  Show last N console logs (default 100); --follow streams"
    echo "  health            Curl GET /health"
    echo "  moments           Curl GET /moments (see 500 response body)"
    echo "  url               Print API base URL"
    echo "  summary           Revisions + traffic + health + last 30 log lines"
    echo ""
    echo "Examples:"
    echo "  $0 summary        # One-shot: status + recent logs"
    echo "  $0 logs 200 --follow   # Stream live logs (Ctrl+C to stop)"
    echo "  $0 moments        # Reproduce 500 and show API error body"
    echo "  $0 health"
    ;;
esac
