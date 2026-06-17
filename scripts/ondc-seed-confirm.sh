#!/usr/bin/env bash
# Seeds a confirm-stage OrderRecord into our local store, so track/status/cancel
# can be exercised without waiting on a workbench on_confirm callback.
#
# Requires the dev server running with ONDC_ENABLE_DEBUG_ROUTES=true.
#
# Usage:
#   ./scripts/ondc-seed-confirm.sh <transactionId> [orderId]
set -euo pipefail

TXN="${1:-}"
ORDER_ID="${2:-LOCAL-$(date +%s)}"
BASE_URL="${BASE_URL:-http://localhost:3000}"
BPP_ID="${BPP_ID:-staging-automation.ondc.org}"
BPP_URI="${BPP_URI:-https://workbench.ondc.tech/api-service/ONDC:RET10/1.2.5/seller}"
GPS="${GPS:-12.971600,77.594600}"
AREA_CODE="${AREA_CODE:-560001}"

if [[ -z "$TXN" ]]; then
  echo "usage: $0 <transactionId> [orderId]" >&2
  exit 1
fi

curl -sS -X POST "$BASE_URL/api/ondc/_debug/seed-confirm" \
  -H 'Content-Type: application/json' \
  -d "{
    \"transactionId\": \"$TXN\",
    \"bppId\": \"$BPP_ID\",
    \"bppUri\": \"$BPP_URI\",
    \"orderId\": \"$ORDER_ID\",
    \"state\": { \"descriptor\": { \"code\": \"Accepted\" } },
    \"order\": {
      \"id\": \"$ORDER_ID\",
      \"state\": \"Accepted\",
      \"provider\": { \"id\": \"P1\", \"locations\": [{ \"id\": \"L1\" }] },
      \"items\": [{ \"id\": \"I1\", \"quantity\": { \"count\": 2 }, \"location_id\": \"L1\", \"fulfillment_id\": \"F1\" }],
      \"billing\": {
        \"name\": \"Asha K\", \"phone\": \"9876543210\", \"email\": \"asha@example.com\",
        \"address\": { \"name\": \"12 MG Road, Bengaluru\", \"area_code\": \"$AREA_CODE\" }
      },
      \"fulfillments\": [{
        \"id\": \"F1\", \"type\": \"Delivery\", \"tracking\": true,
        \"state\": { \"descriptor\": { \"code\": \"Pending\" } },
        \"end\": { \"location\": { \"gps\": \"$GPS\", \"address\": { \"area_code\": \"$AREA_CODE\" } } }
      }],
      \"quote\": {
        \"price\": { \"currency\": \"INR\", \"value\": \"400.00\" }, \"ttl\": \"P1D\",
        \"breakup\": [{ \"@ondc/org/item_id\": \"I1\", \"title\": \"Plain Atta\", \"@ondc/org/title_type\": \"item\", \"price\": { \"currency\": \"INR\", \"value\": \"400.00\" } }]
      },
      \"payment\": {
        \"type\": \"ON-ORDER\", \"status\": \"PAID\", \"collected_by\": \"BAP\",
        \"params\": { \"amount\": \"400.00\", \"currency\": \"INR\", \"transaction_id\": \"BAP-TXN-$TXN\" }
      }
    },
    \"quote\": { \"price\": { \"currency\": \"INR\", \"value\": \"400.00\" }, \"ttl\": \"P1D\" },
    \"fulfillments\": [{ \"id\": \"F1\", \"type\": \"Delivery\", \"state\": { \"descriptor\": { \"code\": \"Pending\" } } }]
  }"
echo ""
