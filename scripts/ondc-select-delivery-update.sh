#!/usr/bin/env bash
# Drives a re-/select for the Buyer-Instructions / Delivery-Update flow against
# the ONDC workbench. Per ONDC RET 1.2.5 §3 ("Buyer creates make-to-order"…):
# if the delivery address changes after the initial select/on_select, the BNP
# MUST call /select again with the new fulfillment.end.location so the BPP can
# re-quote (serviceability, delivery charges) for the updated drop point.
#
# Reuses the ORIGINAL order's transactionId so the BPP joins this select back
# to the same lifecycle. New transactionId would be treated as a fresh session.
#
# Sequence this fits into (all reuse the same transactionId):
#   1. search → on_search → select → on_select → init → on_init
#   2. THIS SCRIPT: select(new address) → on_select  ← refresh quote for new addr
#   3. init → on_init  (against the new quote)
#   4. confirm → on_confirm
#
# Requires the dev server running and ONDC credentials configured.
#
# Usage:
#   ./scripts/ondc-select-delivery-update.sh <transactionId> <itemId> <newGps> <newAreaCode> [quantity]
#
# Example:
#   ./scripts/ondc-select-delivery-update.sh \
#     11111111-2222-3333-4444-555555555555 I1 12.935200,77.624200 560034 2
set -euo pipefail

TXN="${1:-}"
ITEM_ID="${2:-}"
NEW_GPS="${3:-}"
NEW_AREA_CODE="${4:-}"
QTY="${5:-1}"
BASE_URL="${BASE_URL:-http://localhost:3000}"
BPP_ID="${BPP_ID:-staging-automation.ondc.org}"
BPP_URI="${BPP_URI:-https://workbench.ondc.tech/api-service/ONDC:RET10/1.2.5/seller}"
PROVIDER_ID="${PROVIDER_ID:-P1}"
LOCATION_ID="${LOCATION_ID:-L1}"

if [[ -z "$TXN" || -z "$ITEM_ID" || -z "$NEW_GPS" || -z "$NEW_AREA_CODE" ]]; then
  echo "usage: $0 <transactionId> <itemId> <newGps> <newAreaCode> [quantity]" >&2
  echo "  transactionId   reuse from the ORIGINAL order (same id as the first select)" >&2
  echo "  itemId          item id to re-quote (same cart as the original select)" >&2
  echo "  newGps          updated delivery GPS as 'lat,long' (decimal degrees)" >&2
  echo "  newAreaCode     updated 6-digit PIN for delivery" >&2
  echo "  quantity        integer, defaults to 1" >&2
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
    \"fulfillment\": { \"gps\": \"$NEW_GPS\", \"areaCode\": \"$NEW_AREA_CODE\" }
  }"
echo ""
