# Delivery Flow with IGM — curl playbook

End-to-end curls for the ONDC Delivery Flow + IGM (Issue & Grievance Management v2.0.0) against the staging workbench, driven through the local BAP (`http://localhost:3000`). Mint a fresh `transactionId` per Delivery Flow session and thread it through every step below — `on_*` callbacks land on the registered `bap_uri`, so use the order body you receive on the workbench dashboard when our local store hasn't captured it.

## Shared env

```bash
export BASE_URL="http://localhost:3000"
export BPP_ID="staging-automation.ondc.org"
export BPP_URI="https://workbench.ondc.tech/api-service/ONDC:RET10/1.2.5/seller"
export PROVIDER_ID="P1"
export LOCATION_ID="L1"
export ITEM_ID="I1"
export GPS="12.971600,77.594600"
export AREA_CODE="560001"

export TXN=$(uuidgen | tr 'A-Z' 'a-z'); echo "txn=$TXN"
```

`$TXN` carries through select → on_select → init → on_init → confirm → on_confirm → status/track → issue (IGM). Only mint a new one when you start a brand-new Delivery Flow session.

---

## 1. select

Priced quote + serviceability for the buyer's cart. on_select returns the BPP's quote on the workbench dashboard.

```bash
curl -sS -X POST "$BASE_URL/api/ondc/select" \
  -H 'Content-Type: application/json' \
  -d "{
    \"transactionId\": \"$TXN\",
    \"bppId\":  \"$BPP_ID\",
    \"bppUri\": \"$BPP_URI\",
    \"providerId\": \"$PROVIDER_ID\",
    \"items\": [
      { \"id\": \"$ITEM_ID\", \"quantity\": 1, \"locationId\": \"$LOCATION_ID\" }
    ],
    \"fulfillment\": { \"gps\": \"$GPS\", \"areaCode\": \"$AREA_CODE\" }
  }"
```

---

## 2. init

Sends billing + delivery fulfillment so the BPP can firm up the order. on_init returns the finalized order (final quote + payment terms) on the workbench dashboard.

```bash
curl -sS -X POST "$BASE_URL/api/ondc/init" \
  -H 'Content-Type: application/json' \
  -d "{
    \"transactionId\": \"$TXN\",
    \"bppId\":  \"$BPP_ID\",
    \"bppUri\": \"$BPP_URI\",
    \"providerId\": \"$PROVIDER_ID\",
    \"items\": [
      { \"id\": \"$ITEM_ID\", \"quantity\": 1, \"locationId\": \"$LOCATION_ID\" }
    ],
    \"billing\": {
      \"name\": \"Asha K\",
      \"phone\": \"9876543210\",
      \"email\": \"asha@example.com\",
      \"address\": \"12 MG Road, Bengaluru\",
      \"areaCode\": \"$AREA_CODE\"
    },
    \"fulfillment\": { \"gps\": \"$GPS\", \"areaCode\": \"$AREA_CODE\" }
  }"
```

---

## 3. confirm

Places the order against the on_init quote. Two variants depending on whether on_init landed on our local store.

### 3a. on_init persisted locally (no `order` body — recommended)

The route loads the finalized order from the store (`getOrder(transactionId, bppId)`).

```bash
curl -sS -X POST "$BASE_URL/api/ondc/confirm" \
  -H 'Content-Type: application/json' \
  -d "{
    \"transactionId\": \"$TXN\",
    \"bppId\":  \"$BPP_ID\",
    \"bppUri\": \"$BPP_URI\"
  }"
```

If this returns `{"error":"no on_init order persisted for this transaction"}`, the workbench's on_init landed on your registered `bap_uri` (not localhost) — use 3b.

### 3b. Thread the on_init order back in the body

Paste `message.order` from the on_init payload on the workbench dashboard. The fields below mirror the [Delivery_Flow_With_IGM v2.0.0 fixture](src/lib/ondc/) — swap values for what your run actually returned.

```bash
curl -sS -X POST "$BASE_URL/api/ondc/confirm" \
  -H 'Content-Type: application/json' \
  -d "{
    \"transactionId\": \"$TXN\",
    \"bppId\":  \"$BPP_ID\",
    \"bppUri\": \"$BPP_URI\",
    \"order\": {
      \"provider\": { \"id\": \"$PROVIDER_ID\", \"locations\": [{ \"id\": \"$LOCATION_ID\" }] },
      \"items\": [
        { \"id\": \"$ITEM_ID\", \"quantity\": { \"count\": 1 }, \"location_id\": \"$LOCATION_ID\", \"fulfillment_id\": \"F1\" }
      ],
      \"billing\": {
        \"name\": \"Asha K\", \"phone\": \"9876543210\", \"email\": \"asha@example.com\",
        \"address\": { \"name\": \"12 MG Road, Bengaluru\", \"area_code\": \"$AREA_CODE\" }
      },
      \"fulfillments\": [{
        \"id\": \"F1\", \"type\": \"Delivery\", \"tracking\": true,
        \"end\": { \"location\": { \"gps\": \"$GPS\", \"address\": { \"area_code\": \"$AREA_CODE\" } } }
      }],
      \"quote\": {
        \"breakup\": [
          { \"@ondc/org/item_id\": \"F1\", \"title\": \"Delivery charges\", \"@ondc/org/title_type\": \"delivery\", \"price\": { \"currency\": \"INR\", \"value\": \"00.00\" } },
          { \"@ondc/org/item_id\": \"F1\", \"title\": \"Convenience Fee\", \"@ondc/org/title_type\": \"misc\", \"price\": { \"currency\": \"INR\", \"value\": \"00.00\" } }
        ],
        \"price\": { \"currency\": \"INR\", \"value\": \"0.00\" },
        \"ttl\": \"P1D\"
      },
      \"payment\": {
        \"@ondc/org/buyer_app_finder_fee_type\": \"percent\",
        \"@ondc/org/buyer_app_finder_fee_amount\": \"3\",
        \"@ondc/org/settlement_details\": [{
          \"settlement_counterparty\": \"seller-app\",
          \"settlement_phase\": \"sale-amount\",
          \"settlement_type\": \"neft\",
          \"beneficiary_name\": \"xxxx\",
          \"settlement_bank_account_no\": \"XXXX\",
          \"settlement_ifsc_code\": \"XXXX\",
          \"bank_name\": \"XXXX\",
          \"branch_name\": \"XXXX\"
        }]
      },
      \"tags\": [{
        \"code\": \"bpp_terms\",
        \"list\": [
          { \"code\": \"np_type\", \"value\": \"MSN\" },
          { \"code\": \"tax_number\", \"value\": \"00ABCCH7409R1ZZ\" },
          { \"code\": \"provider_tax_number\", \"value\": \"ABCDE1234F\" }
        ]
      }]
    }
  }"
```

### 3c. Local-store shortcut (dev only)

When `ONDC_ENABLE_DEBUG_ROUTES=true`, seed an OrderRecord so subsequent calls work without waiting on a workbench callback:

```bash
./scripts/ondc-seed-confirm.sh "$TXN"
```

Then re-run 3a.

---

## 4. status

Capture the placed-order `order_id` from on_confirm (workbench dashboard), then poll. The order id is also persisted at confirm time on our store.

```bash
export ORDER_ID="<paste from on_confirm>"

curl -sS -X POST "$BASE_URL/api/ondc/status" \
  -H 'Content-Type: application/json' \
  -d "{
    \"transactionId\": \"$TXN\",
    \"bppId\":  \"$BPP_ID\",
    \"bppUri\": \"$BPP_URI\",
    \"orderId\": \"$ORDER_ID\"
  }"
```

---

## 5. track

```bash
curl -sS -X POST "$BASE_URL/api/ondc/track" \
  -H 'Content-Type: application/json' \
  -d "{
    \"transactionId\": \"$TXN\",
    \"bppId\":  \"$BPP_ID\",
    \"bppUri\": \"$BPP_URI\",
    \"orderId\": \"$ORDER_ID\"
  }"
```

---

## 6. IGM — issue lifecycle

Post-order grievance flow. Domain is `ONDC:IGM` (different from RET10), `core_version` is `2.0.0`. The route handles every complainant action against the same `transactionId`. Capture the `issueId` from the OPEN response — every later step echoes it back.

### 6a. OPEN — file the issue

```bash
curl -sS -X POST "$BASE_URL/api/ondc/issue" \
  -H 'Content-Type: application/json' \
  -d "{
    \"transactionId\": \"$TXN\",
    \"bppId\":  \"$BPP_ID\",
    \"bppUri\": \"$BPP_URI\",
    \"orderId\":    \"$ORDER_ID\",
    \"orderState\": \"Completed\",
    \"providerId\": \"$PROVIDER_ID\",
    \"items\":        [{ \"id\": \"$ITEM_ID\", \"quantity\": 1 }],
    \"fulfillments\": [{ \"id\": \"F1\", \"state\": \"Order-delivered\" }],
    \"category\":    \"ITEM\",
    \"subCategory\": \"ITM02\",
    \"shortDesc\":   \"Item not as described\",
    \"longDesc\":    \"The delivered item does not match what was listed.\",
    \"complainant\": { \"name\": \"Asha K\", \"phone\": \"9876543210\", \"email\": \"asha@example.com\" },
    \"complainantAction\": \"OPEN\"
  }"
```

Grab the `issueId` from the response:

```bash
export ISSUE_ID="<paste from OPEN response>"
```

### 6b. INFO_PROVIDED — respond to seller's NEED_MORE_INFO

```bash
curl -sS -X POST "$BASE_URL/api/ondc/issue" \
  -H 'Content-Type: application/json' \
  -d "{
    \"transactionId\":     \"$TXN\",
    \"bppId\":  \"$BPP_ID\",
    \"bppUri\": \"$BPP_URI\",
    \"issueId\":           \"$ISSUE_ID\",
    \"complainantAction\": \"INFO_PROVIDED\",
    \"actionDesc\":        \"Attached photographs of the delivered item.\"
  }"
```

### 6c. RESOLUTION_ACCEPT — accept seller's proposed resolution

```bash
curl -sS -X POST "$BASE_URL/api/ondc/issue" \
  -H 'Content-Type: application/json' \
  -d "{
    \"transactionId\":     \"$TXN\",
    \"bppId\":  \"$BPP_ID\",
    \"bppUri\": \"$BPP_URI\",
    \"issueId\":           \"$ISSUE_ID\",
    \"complainantAction\": \"RESOLUTION_ACCEPT\",
    \"actionDesc\":        \"Accepted refund as proposed.\"
  }"
```

Use `RESOLUTION_REJECT` instead when the proposal is unacceptable.

### 6d. ESCALATE — push to grievance redressal

```bash
curl -sS -X POST "$BASE_URL/api/ondc/issue" \
  -H 'Content-Type: application/json' \
  -d "{
    \"transactionId\":     \"$TXN\",
    \"bppId\":  \"$BPP_ID\",
    \"bppUri\": \"$BPP_URI\",
    \"issueId\":           \"$ISSUE_ID\",
    \"complainantAction\": \"ESCALATE\",
    \"actionDesc\":        \"Resolution not received within SLA.\"
  }"
```

### 6e. CLOSE — close the issue

```bash
curl -sS -X POST "$BASE_URL/api/ondc/issue" \
  -H 'Content-Type: application/json' \
  -d "{
    \"transactionId\":     \"$TXN\",
    \"bppId\":  \"$BPP_ID\",
    \"bppUri\": \"$BPP_URI\",
    \"issueId\":           \"$ISSUE_ID\",
    \"complainantAction\": \"CLOSE\",
    \"actionDesc\":        \"Resolved to satisfaction.\"
  }"
```

---

## 7. Read a stored issue

```bash
curl -sS "$BASE_URL/api/ondc/issue/$ISSUE_ID?transactionId=$TXN"
```

---

## Callbacks (no curl — these are inbound)

| BPP → BAP    | Lands at                              |
|--------------|---------------------------------------|
| `on_select`  | `${bap_uri}/on_select`                |
| `on_init`    | `${bap_uri}/on_init`                  |
| `on_confirm` | `${bap_uri}/on_confirm`               |
| `on_status`  | `${bap_uri}/on_status`                |
| `on_track`   | `${bap_uri}/on_track`                 |
| `on_issue`   | `${bap_uri}/on_issue`                 |

Local dev tip: registered `bap_uri` is your public BAP URL (e.g. `https://openidea.co.in/ondc`), not localhost — workbench will POST callbacks there. To exercise confirm/issue locally without a tunnel, use the dev-only seed routes (`scripts/ondc-seed-confirm.sh`) or paste the order body inline (variant 3b).
