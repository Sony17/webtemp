#!/usr/bin/env bash
# Drives a /select call for the replacement leg of the return-with-replacement
# flow against the ONDC workbench. Reuses the ORIGINAL order's transaction_id so
# the BPP joins this select back to the same lifecycle; sends the replacement
# item id (typically a different variant/SKU than what the buyer received).
#
# Sequence this fits into (all reuse the same transactionId):
#   1. search → on_search → select → on_select → init → on_init → confirm → on_confirm
#   2. update (update_target=item, return/replacement) → on_update
#   3. THIS SCRIPT: select(replacementItemId) → on_select  ← refresh quote for replacement
#   4. init → confirm against the new quote
#
# Requires the dev server running and ONDC credentials configured.
#
# Usage:
#   ./scripts/ondc-select-replacement.sh <transactionId> <replacementItemId> [quantity]
set -euo pipefail

TXN="${1:-}"
ITEM_ID="${2:-}"
QTY="${3:-1}"
BASE_URL="${BASE_URL:-http://localhost:3000}"
BPP_ID="${BPP_ID:-staging-automation.ondc.org}"
BPP_URI="${BPP_URI:-https://workbench.ondc.tech/api-service/ONDC:RET10/1.2.5/seller}"
PROVIDER_ID="${PROVIDER_ID:-P1}"
LOCATION_ID="${LOCATION_ID:-L1}"
GPS="${GPS:-12.971600,77.594600}"
AREA_CODE="${AREA_CODE:-560001}"

if [[ -z "$TXN" || -z "$ITEM_ID" ]]; then
  echo "usage: $0 <transactionId> <replacementItemId> [quantity]" >&2
  echo "  transactionId       reuse from the ORIGINAL order (same id as confirm)" >&2
  echo "  replacementItemId   item id to quote as the replacement" >&2
  echo "  quantity            integer, defaults to 1" >&2
  exit 1
fi

curl -sS -X POST "$BASE_URL/api/ondc/select" \
  -H 'Content-Type: application/json' \
  -d "{
    \"transactionId\": \"$TXN\",
    \"bppId\": \"$BPP_ID\",
    \"bppUri\": \"$BPP_URI\",
    \"providerId\": \"$PROVIDER_ID\",
    \"items\": [
      { \"id\": \"$ITEM_ID\", \"quantity\": $QTY, \"locationId\": \"$LOCATION_ID\" }
    ],
    \"fulfillment\": { \"gps\": \"$GPS\", \"areaCode\": \"$AREA_CODE\" }
  }"
echo ""
