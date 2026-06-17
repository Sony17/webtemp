#!/usr/bin/env bash
# Drives a /select call for the Self-Pickup flow against the ONDC workbench.
# Self-Pickup means the buyer collects the items from the seller's store, so
# there is no last-mile delivery leg — the BPP's quote should skip delivery
# charges and emit pickup-store contact details instead.
#
# Sequence this fits into (all reuse the same transactionId):
#   1. search → on_search
#   2. THIS SCRIPT: select(Self-Pickup) → on_select   ← pickup-priced quote
#   3. init → on_init   (billing + pickup-store fulfillment)
#   4. confirm → on_confirm   (order placed; buyer goes to store to collect)
#   5. status / track until fulfillment state = "Order-picked-up"
#
# Requires the dev server running and ONDC credentials configured.
#
# Usage:
#   ./scripts/ondc-select-self-pickup.sh <transactionId> <itemId> [quantity]
#
# Notes:
#   - GPS/AREA_CODE default to the provider's store (12.9716,77.5946 / 560001).
#     For Self-Pickup the buyer's "end" location is the pickup store, so reusing
#     the provider's coordinates is the right default. Override via env if your
#     workbench provider is configured at a different location.
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
  echo "usage: $0 <transactionId> <itemId> [quantity]" >&2
  echo "  transactionId   reuse from the preceding search/on_search" >&2
  echo "  itemId          item id the buyer chose from on_search" >&2
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
    \"fulfillment\": {
      \"type\": \"Self-Pickup\",
      \"gps\": \"$GPS\",
      \"areaCode\": \"$AREA_CODE\"
    }
  }"
echo ""
