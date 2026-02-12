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
  # Check if ELEVENLABS_API_KEY is configured in the Container App (clone voice for narration).
  env-check)
    echo "=== Container App env var names (no values) for $APP ==="
    ENV_NAMES=$(az containerapp show -g "$RG" -n "$APP" --query "properties.template.containers[0].env[].name" -o tsv 2>/dev/null | tr '\t' '\n' | sort)
    if [[ -z "$ENV_NAMES" ]]; then
      echo "  (no env list or container not found)"
    else
      echo "$ENV_NAMES" | sed 's/^/  /'
    fi
    echo ""
    if echo "$ENV_NAMES" | grep -qx "ELEVENLABS_API_KEY"; then
      echo "ELEVENLABS_API_KEY: present (clone voice can be used if DB has elevenlabs_voice_id)"
    else
      echo "ELEVENLABS_API_KEY: NOT SET → narration will use default OpenAI voice, not clone"
    fi
    ;;
  # Call production /voice/stories/shared and /voice/narrate to verify participant_id is returned and clone is used.
  narrate-verify)
    # Verify a participant's shared stories all use the same clone (DB + live narrate per story).
    # Uses .env.azure at repo root for DATABASE_URL (script loads it via --azure-db).
    NAME="${1:-Harry}"
    ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
    if [[ ! -f "$ROOT_DIR/.env.azure" ]]; then
      echo "Missing .env.azure at repo root. Copy .env.azure.example and set DATABASE_URL for Azure Postgres." >&2
      exit 1
    fi
    FQDN=$(az containerapp show -g "$RG" -n "$APP" --query "properties.configuration.ingress.fqdn" -o tsv)
    API_BASE="https://$FQDN"
    echo "Verifying shared stories voice for participant: $NAME (API: $API_BASE)"
    echo ""
    (cd services/api && env AZURE_ENV_PATH="$ROOT_DIR/.env.azure" uv run python scripts/verify_participant_stories_voice.py --name "$NAME" --api-base "$API_BASE" --no-verify-ssl --azure-db)
    ;;
  narrate-check)
    FQDN=$(az containerapp show -g "$RG" -n "$APP" --query "properties.configuration.ingress.fqdn" -o tsv)
    BASE="https://$FQDN"
    echo "=== Shared stories: GET /voice/stories/shared (limit=20) ==="
    SHARED=$(curl -sk "${BASE}/voice/stories/shared?limit=20")
    COUNT=$(echo "$SHARED" | jq -r 'length' 2>/dev/null || echo "0")
    if [[ -z "$COUNT" || "$COUNT" == "0" || "$COUNT" == "null" ]]; then
      echo "  No shared stories returned."
      exit 0
    fi
    echo "  Found $COUNT story/stories."
    echo ""
    echo "=== Per-story: POST /voice/narrate with story participant_id → X-Narration-Voice (clone or default) ==="
    CLONED=0
    DEFAULT=0
    for i in $(seq 0 $((COUNT - 1))); do
      STORY=$(echo "$SHARED" | jq -c ".[$i]" 2>/dev/null)
      if [[ -z "$STORY" ]]; then continue; fi
      SID=$(echo "$STORY" | jq -r '.id // empty')
      TITLE=$(echo "$STORY" | jq -r '.title // "no title"' | head -c 50)
      PID=$(echo "$STORY" | jq -r '.participant_id // empty')
      NAME=$(echo "$STORY" | jq -r '.participant_name // "?"')
      if [[ -z "$PID" ]]; then
        echo "  [$((i+1))] $TITLE  participant_id=(null)  X-Narration-Voice: (not sent → API will use default)"
        DEFAULT=$((DEFAULT + 1))
        continue
      fi
      HEADERS=$(curl -sk -D - -o /dev/null -X POST "${BASE}/voice/narrate" \
        -H "Content-Type: application/json" \
        -d "{\"text\":\"Test.\",\"participant_id\":\"$PID\"}")
      VOICE=$(echo "$HEADERS" | grep -i "x-narration-voice" | tr -d '\r' | cut -d: -f2- | tr -d ' ')
      if [[ "$VOICE" == "cloned" ]]; then CLONED=$((CLONED + 1)); fi
      if [[ "$VOICE" == "default" ]]; then DEFAULT=$((DEFAULT + 1)); fi
      echo "  [$((i+1))] $TITLE  participant_id=$PID  participant_name=$NAME  X-Narration-Voice: ${VOICE:- (not set)}"
    done
    echo ""
    echo "=== Summary (what production API returns for each story) ==="
    echo "  Cloned: $CLONED  |  Default: $DEFAULT"
    if [[ $DEFAULT -gt 0 ]]; then
      echo "  → At least one story gets default voice; clone not used for that participant_id in production."
    fi
    if [[ $CLONED -gt 0 && $DEFAULT -eq 0 ]]; then
      echo "  → All stories use cloned voice for their participant."
    fi
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
    echo "  env-check         List env var names; report if ELEVENLABS_API_KEY is set (clone voice)"
    echo "  narrate-check     Curl shared stories + POST narrate; report X-Narration-Voice (participant_id + clone)"
    echo "  narrate-verify [Name]  Per-story check: DB + live narrate for each shared story (default Name=Harry)"
    echo ""
    echo "Examples:"
    echo "  $0 summary        # One-shot: status + recent logs"
    echo "  $0 env-check      # Is ELEVENLABS_API_KEY set in Azure?"
    echo "  $0 narrate-check     # Is participant_id returned and clone voice used?"
    echo "  $0 narrate-verify Harry   # Are both of Harry's stories using the same clone?"
    echo "  $0 logs 200 --follow   # Stream live logs (Ctrl+C to stop)"
    echo "  $0 health"
    ;;
esac
