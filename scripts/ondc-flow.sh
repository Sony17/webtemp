#!/usr/bin/env bash
# Drive the ONDC Delivery Flow end-to-end against a running local BAP:
#   search → (wait for on_search) → select → (wait for on_select) → init → (wait for on_init)
#
# Confirm/status are intentionally omitted — they need the actual `order`/`order_id`
# from on_init/on_confirm callbacks, which aren't surfaced in-process. Add them
# once you wire those up.
#
# Usage:
#   chmod +x scripts/ondc-flow.sh
#   ./scripts/ondc-flow.sh
#
# Override defaults via env vars:
#   BASE_URL, BPP_ID, BPP_URI, PROVIDER_ID, ITEM_ID, LOCATION_ID, AREA_CODE, GPS, WAIT
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
BPP_ID="${BPP_ID:-staging-automation.ondc.org}"
BPP_URI="${BPP_URI:-https://workbench.ondc.tech/api-service/ONDC:RET10/1.2.5/seller}"
PROVIDER_ID="${PROVIDER_ID:-P1}"
ITEM_ID="${ITEM_ID:-I1}"
LOCATION_ID="${LOCATION_ID:-L1}"
AREA_CODE="${AREA_CODE:-560001}"
GPS="${GPS:-12.9716,77.5946}"
WAIT="${WAIT:-3}"

uuid() { uuidgen | tr 'A-Z' 'a-z'; }

extract_txn() {
  # Pull "transactionId":"..." from a JSON body using POSIX tools.
  sed -n 's/.*"transactionId":"\([^"]*\)".*/\1/p' <<<"$1" | head -n1
}

step() {
  printf '\n\033[1;34m▶ %s\033[0m\n' "$1"
}

ok() {
  printf '\033[1;32m✓ %s\033[0m\n' "$1"
}

fail() {
  printf '\033[1;31m✗ %s\033[0m\n' "$1"
  exit 1
}

# ---------------------------------------------------------------------------
# 1. search
# ---------------------------------------------------------------------------
step "search → $BASE_URL/api/ondc/search"
SEARCH_RES=$(curl -sS -X POST "$BASE_URL/api/ondc/search" \
  -H 'Content-Type: application/json' \
  -d "{
    \"query\": \"basmati rice\",
    \"category\": \"Rice and Rice Products\",
    \"deliveryGps\": \"$GPS\",
    \"deliveryAreaCode\": \"$AREA_CODE\"
  }")
echo "$SEARCH_RES"
[[ "$SEARCH_RES" == *'"status":"ACK"'* ]] || fail "search did not ACK"
SEARCH_TXN=$(extract_txn "$SEARCH_RES")
ok "search ACK (txn=$SEARCH_TXN)"

printf '\n⏳ waiting %ss for on_search callback...\n' "$WAIT"
sleep "$WAIT"

# ---------------------------------------------------------------------------
# 2. select (FRESH txn — Delivery Flow is a new session per ONDC contract)
# ---------------------------------------------------------------------------
SELECT_TXN=$(uuid)
step "select (txn=$SELECT_TXN) → $BASE_URL/api/ondc/select"
SELECT_RES=$(curl -sS -X POST "$BASE_URL/api/ondc/select" \
  -H 'Content-Type: application/json' \
  -d "{
    \"transactionId\": \"$SELECT_TXN\",
    \"bppId\": \"$BPP_ID\",
    \"bppUri\": \"$BPP_URI\",
    \"providerId\": \"$PROVIDER_ID\",
    \"items\": [{ \"id\": \"$ITEM_ID\", \"quantity\": 2, \"locationId\": \"$LOCATION_ID\" }],
    \"fulfillment\": { \"gps\": \"$GPS\", \"areaCode\": \"$AREA_CODE\" }
  }")
echo "$SELECT_RES"
[[ "$SELECT_RES" == *'"status":"ACK"'* ]] || fail "select did not ACK"
ok "select ACK"

printf '\n⏳ waiting %ss for on_select callback...\n' "$WAIT"
sleep "$WAIT"

# ---------------------------------------------------------------------------
# 3. init (reuse select's txn)
# ---------------------------------------------------------------------------
step "init (txn=$SELECT_TXN) → $BASE_URL/api/ondc/init"
INIT_RES=$(curl -sS -X POST "$BASE_URL/api/ondc/init" \
  -H 'Content-Type: application/json' \
  -d "{
    \"transactionId\": \"$SELECT_TXN\",
    \"bppId\": \"$BPP_ID\",
    \"bppUri\": \"$BPP_URI\",
    \"providerId\": \"$PROVIDER_ID\",
    \"items\": [{ \"id\": \"$ITEM_ID\", \"quantity\": 2, \"locationId\": \"$LOCATION_ID\" }],
    \"billing\": {
      \"name\": \"Asha K\",
      \"phone\": \"9876543210\",
      \"email\": \"asha@example.com\",
      \"address\": \"12 MG Road, Bengaluru\",
      \"areaCode\": \"$AREA_CODE\"
    },
    \"fulfillment\": { \"gps\": \"$GPS\", \"areaCode\": \"$AREA_CODE\" }
  }")
echo "$INIT_RES"
[[ "$INIT_RES" == *'"status":"ACK"'* ]] || fail "init did not ACK"
ok "init ACK"

printf '\n⏳ waiting %ss for on_init callback...\n' "$WAIT"
sleep "$WAIT"

printf '\n\033[1;32mDone.\033[0m search/select/init dispatched. Watch the Workbench dashboard for on_* callbacks.\n'
printf 'Discovery Flow txn: %s\n' "$SEARCH_TXN"
printf 'Delivery Flow txn:  %s\n' "$SELECT_TXN"
