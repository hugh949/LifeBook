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
    for a in "$@"; do
      [[ "$a" == "--follow" ]] && FOLLOW="--follow"
      [[ "$a" != "--follow" ]] && [[ -n "$a" ]] && REV="$a"
    done
    az containerapp logs show -g "$RG" -n "$APP" --tail 50 $FOLLOW ${REV:+--revision "$REV"}
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
  *)
    echo "LifeBook API Container App - CLI status and management"
    echo ""
    echo "Usage: $0 <command> [args]"
    echo ""
    echo "Commands:"
    echo "  list              List revisions with status"
    echo "  traffic [REV=100] Show traffic split, or set 100% to REV"
    echo "  logs [revision]   Show logs (add --follow to stream)"
    echo "  health            Curl /health"
    echo "  url               Print API base URL"
    echo ""
    echo "Examples:"
    echo "  $0 list"
    echo "  $0 traffic aca-lifebook-api-v1--rx9fam5=100"
    echo "  $0 logs --follow"
    echo "  $0 health"
    ;;
esac
