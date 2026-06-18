#!/usr/bin/env bash
# Walks the Slotted Delivery flow against the ONDC workbench:
#   select -> on_select (BPP returns N slot options)
#   init   -> on_init   (BPP firms up quote + payment terms)
#   confirm -> on_confirm (order placed against the chosen slot)
#
# Reuses one transactionId across all three calls so the BPP can join them
# back to the same lifecycle. Pass a transactionId as $1 or let the script
# mint a fresh UUID (the BPP won't have any prior search/on_search context
# for a fresh id, so on_select may NACK in that case — for a real run,
# capture the id from a preceding /search).
#
# Gap to know: the local /api/ondc/select and /init routes don't yet wire
# a delivery slot ({start,end}) onto the wire. The BPP returns slot options
# on on_select; this script's /init implicitly takes whichever slot the BPP
# defaults to for the chosen fulfillment id (F1 here). Pick a different slot
# id via FULFILLMENT_ID below if on_select offered one you prefer.
#
# Usage:
#   ./scripts/ondc-slotted-delivery-flow.sh [transactionId]
set -euo pipefail

TXN="${1:-$(uuidgen | tr 'A-Z' 'a-z')}"
BASE_URL="${BASE_URL:-http://localhost:3000}"
BPP_ID="${BPP_ID:-staging-automation.ondc.org}"
BPP_URI="${BPP_URI:-https://workbench.ondc.tech/api-service/ONDC:RET10/1.2.5/seller}"
PROVIDER_ID="${PROVIDER_ID:-P1}"
LOCATION_ID="${LOCATION_ID:-L1}"
ITEM_ID="${ITEM_ID:-I1}"
FULFILLMENT_ID="${FULFILLMENT_ID:-F1}"
QTY="${QTY:-1}"
GPS="${GPS:-12.971600,77.594600}"
AREA_CODE="${AREA_CODE:-560001}"
ORDER_ID="${ORDER_ID:-O-${TXN:0:8}}"

BUYER_NAME="${BUYER_NAME:-Asha K}"
BUYER_PHONE="${BUYER_PHONE:-9876543210}"
BUYER_EMAIL="${BUYER_EMAIL:-asha@example.com}"
BUYER_ADDRESS="${BUYER_ADDRESS:-12 MG Road, Bengaluru}"

echo "==> transactionId: $TXN"
echo "==> orderId:       $ORDER_ID"
echo ""

# -----------------------------------------------------------------------------
# 1. /select  --  ask the BPP to quote the item with a delivery destination.
#                 For a slotted flow the BPP responds with multiple Delivery
#                 fulfillments (F1..Fn), each with its own end.time.range slot.
# -----------------------------------------------------------------------------
echo "==> POST /api/ondc/select"
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
      \"type\": \"Delivery\",
      \"gps\": \"$GPS\",
      \"areaCode\": \"$AREA_CODE\"
    }
  }"
echo ""

# -----------------------------------------------------------------------------
# 2. /init  --  commit buyer billing + chosen fulfillment so the BPP can return
#               a firm quote with payment terms (on_init). The chosen slot is
#               implicit in the fulfillment_id we keep using through the flow.
# -----------------------------------------------------------------------------
echo "==> POST /api/ondc/init"
curl -sS -X POST "$BASE_URL/api/ondc/init" \
  -H 'Content-Type: application/json' \
  -d "{
    \"transactionId\": \"$TXN\",
    \"bppId\": \"$BPP_ID\",
    \"bppUri\": \"$BPP_URI\",
    \"providerId\": \"$PROVIDER_ID\",
    \"items\": [
      { \"id\": \"$ITEM_ID\", \"quantity\": $QTY, \"locationId\": \"$LOCATION_ID\" }
    ],
    \"billing\": {
      \"name\": \"$BUYER_NAME\",
      \"phone\": \"$BUYER_PHONE\",
      \"email\": \"$BUYER_EMAIL\",
      \"address\": \"$BUYER_ADDRESS\",
      \"areaCode\": \"$AREA_CODE\"
    },
    \"fulfillment\": {
      \"type\": \"Delivery\",
      \"gps\": \"$GPS\",
      \"areaCode\": \"$AREA_CODE\"
    }
  }"
echo ""

# -----------------------------------------------------------------------------
# 3. /confirm  --  place the order against the on_init quote. The order body is
#                  the finalized snapshot: items, billing, quote echoed from
#                  on_init, payment marked PAID (or NOT-PAID for COD/deferred),
#                  bap_terms.accept_bpp_terms=Y so the BPP doesn't NACK 50006.
#                  Quote here mirrors the on_init breakup; if on_init changed
#                  prices, copy that breakup in verbatim or this will NACK.
# -----------------------------------------------------------------------------
echo "==> POST /api/ondc/confirm"
curl -sS -X POST "$BASE_URL/api/ondc/confirm" \
  -H 'Content-Type: application/json' \
  -d "{
    \"transactionId\": \"$TXN\",
    \"bppId\": \"$BPP_ID\",
    \"bppUri\": \"$BPP_URI\",
    \"order\": {
      \"id\": \"$ORDER_ID\",
      \"state\": \"Created\",
      \"provider\": {
        \"id\": \"$PROVIDER_ID\",
        \"locations\": [{ \"id\": \"$LOCATION_ID\" }]
      },
      \"items\": [
        {
          \"id\": \"$ITEM_ID\",
          \"fulfillment_id\": \"$FULFILLMENT_ID\",
          \"quantity\": { \"count\": $QTY },
          \"location_id\": \"$LOCATION_ID\"
        }
      ],
      \"billing\": {
        \"name\": \"$BUYER_NAME\",
        \"phone\": \"$BUYER_PHONE\",
        \"email\": \"$BUYER_EMAIL\",
        \"address\": { \"name\": \"$BUYER_ADDRESS\", \"area_code\": \"$AREA_CODE\" }
      },
      \"fulfillments\": [
        {
          \"id\": \"$FULFILLMENT_ID\",
          \"type\": \"Delivery\",
          \"@ondc/org/TAT\": \"PT60M\",
          \"tracking\": true,
          \"end\": {
            \"location\": {
              \"gps\": \"$GPS\",
              \"address\": { \"area_code\": \"$AREA_CODE\" }
            },
            \"contact\": { \"phone\": \"$BUYER_PHONE\", \"email\": \"$BUYER_EMAIL\" }
          }
        }
      ],
      \"quote\": {
        \"price\": { \"currency\": \"INR\", \"value\": \"200.00\" },
        \"breakup\": [
          {
            \"@ondc/org/item_id\": \"$ITEM_ID\",
            \"@ondc/org/item_quantity\": { \"count\": $QTY },
            \"title\": \"Plain Atta\",
            \"@ondc/org/title_type\": \"item\",
            \"price\": { \"currency\": \"INR\", \"value\": \"200.00\" },
            \"item\": { \"price\": { \"currency\": \"INR\", \"value\": \"200.00\" } }
          },
          {
            \"@ondc/org/item_id\": \"$FULFILLMENT_ID\",
            \"title\": \"Delivery charges\",
            \"@ondc/org/title_type\": \"delivery\",
            \"price\": { \"currency\": \"INR\", \"value\": \"0.00\" }
          },
          {
            \"@ondc/org/item_id\": \"$FULFILLMENT_ID\",
            \"title\": \"Convenience Fee\",
            \"@ondc/org/title_type\": \"misc\",
            \"price\": { \"currency\": \"INR\", \"value\": \"0.00\" }
          }
        ],
        \"ttl\": \"P1D\"
      },
      \"payment\": {
        \"uri\": \"https://openidea.co.in/pay\",
        \"tl_method\": \"http/get\",
        \"params\": {
          \"currency\": \"INR\",
          \"transaction_id\": \"TXN-${TXN:0:8}\",
          \"amount\": \"200.00\"
        },
        \"status\": \"PAID\",
        \"type\": \"ON-ORDER\",
        \"collected_by\": \"BAP\",
        \"@ondc/org/buyer_app_finder_fee_type\": \"percent\",
        \"@ondc/org/buyer_app_finder_fee_amount\": \"3\",
        \"@ondc/org/settlement_basis\": \"delivery\",
        \"@ondc/org/settlement_window\": \"P1D\",
        \"@ondc/org/withholding_amount\": \"10.00\",
        \"@ondc/org/settlement_details\": [
          {
            \"settlement_counterparty\": \"seller-app\",
            \"settlement_phase\": \"sale-amount\",
            \"settlement_type\": \"neft\",
            \"beneficiary_name\": \"xxxx\",
            \"settlement_bank_account_no\": \"XXXX\",
            \"settlement_ifsc_code\": \"XXXX\",
            \"bank_name\": \"XXXX\",
            \"branch_name\": \"XXXX\"
          }
        ]
      },
      \"tags\": [
        {
          \"code\": \"bpp_terms\",
          \"list\": [
            { \"code\": \"tax_number\", \"value\": \"00ABCCH7409R1ZZ\" },
            { \"code\": \"provider_tax_number\", \"value\": \"ABCDE1234F\" }
          ]
        },
        {
          \"code\": \"bap_terms\",
          \"list\": [
            { \"code\": \"accept_bpp_terms\", \"value\": \"Y\" },
            { \"code\": \"static_terms\", \"value\": \"https://github.com/ONDC-Official/NP-Static-Terms/buyerNP_BNP/1.0/tc.pdf\" },
            { \"code\": \"tax_number\", \"value\": \"gst_number_of_buyerNP\" }
          ]
        }
      ]
    }
  }"
echo ""
