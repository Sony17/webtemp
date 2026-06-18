#!/usr/bin/env bash
# Drives a /select call for the Buyer Delivery Flow against the ONDC workbench.
# Delivery Flow is a new session per ONDC contract, so by default this mints a
# fresh transactionId — reuse the printed id through on_select → init → on_init
# → confirm → on_confirm. Pass an id explicitly to continue an existing session.
#
# Sequence this fits into (all reuse the same transactionId):
#   1. search → on_search
#   2. THIS SCRIPT: select(Delivery) → on_select   ← priced quote w/ delivery
#   3. init → on_init   (billing + delivery fulfillment)
#   4. confirm → on_confirm   (order placed)
#   5. status / track until fulfillment state = "Order-delivered"
#
# Requires the dev server running and ONDC credentials configured.
#
# Usage:
#   ./scripts/ondc-select.sh                       # mint fresh txn, default item
#   ./scripts/ondc-select.sh <itemId>              # mint fresh txn, override item
#   ./scripts/ondc-select.sh <itemId> <quantity>   # mint fresh txn, override qty
#   TXN=<uuid> ./scripts/ondc-select.sh ...        # reuse a specific txn
set -euo pipefail

ITEM_ID="${1:-${ITEM_ID:-I1}}"
QTY="${2:-1}"
TXN="${TXN:-$(uuidgen | tr 'A-Z' 'a-z')}"
BASE_URL="${BASE_URL:-http://localhost:3000}"
BPP_ID="${BPP_ID:-staging-automation.ondc.org}"
BPP_URI="${BPP_URI:-https://workbench.ondc.tech/api-service/ONDC:RET10/1.2.5/seller}"
PROVIDER_ID="${PROVIDER_ID:-P1}"
LOCATION_ID="${LOCATION_ID:-L1}"
GPS="${GPS:-12.971600,77.594600}"
AREA_CODE="${AREA_CODE:-560001}"

echo "txn=$TXN"

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
