# ONDC RET 1.2.5 — curl reference

All curls drive the local BAP wrappers in `src/app/api/ondc/*`. They use the
same defaults as `scripts/ondc-flow.sh` so paste-and-run works out of the box.

Copy the **Setup** block once per shell session, then run any section.

---

## Setup

```bash
export BASE_URL="http://localhost:3000"
export BPP_ID="staging-automation.ondc.org"
export BPP_URI="https://workbench.ondc.tech/api-service/ONDC:RET10/1.2.5/seller"
export PROVIDER_ID="P1"
export ITEM_ID="I1"
export LOCATION_ID="L1"
export AREA_CODE="560001"
export GPS="12.971600,77.594600"
```

ONDC contract: `/search` mints its own transaction_id; `/select`, `/init`,
`/confirm`, `/status`, `/cancel`, `/update`, `/track` share **one** fresh
transaction_id for the whole delivery session.

```bash
# Fresh delivery-session txn (reuse across select → init → confirm → status …)
export TXN=$(uuidgen | tr 'A-Z' 'a-z'); echo "txn=$TXN"
```

---

## 1. Catalog Validation & Rejection Flow

Workbench step 3 (`catalog_rejection`) clears automatically once the BAP
detects MRP violations / missing ids in the inbound `/on_search` and fires
the outbound `catalog_rejection` callback. The route handler does this
fire-and-forget after the ACK — see `src/app/api/ondc/on_search/route.ts`.

```bash
TXN=$(uuidgen | tr 'A-Z' 'a-z'); echo "txn=$TXN"
curl -sS -X POST "$BASE_URL/api/ondc/search" \
  -H 'Content-Type: application/json' \
  -d "{
    \"transactionId\":\"$TXN\",
    \"bppId\":\"$BPP_ID\",
    \"bppUri\":\"$BPP_URI\",
    \"category\":\"Atta, Flours and Sooji\",
    \"query\":\"catalog_rejection_test_invalid_item_999\",
    \"fulfillment\":{
      \"type\":\"Delivery\",
      \"gps\":\"$GPS\",
      \"areaCode\":\"$AREA_CODE\"
    }
  }"
```

Watch the server logs for:

- `ondc.on_search persisted`            — catalog landed
- `ondc.on_search catalog rejected (firing callback)` — validator found issues
- `ondc.catalog_rejection posted`       — outbound POST completed

---

## 2. Discovery — `/search`

Normal discovery flow. The SNP responds with a healthy catalog and the
validator stays silent.

```bash
curl -sS -X POST "$BASE_URL/api/ondc/search" \
  -H 'Content-Type: application/json' \
  -d "{
    \"query\":\"basmati rice\",
    \"category\":\"Rice and Rice Products\",
    \"deliveryGps\":\"$GPS\",
    \"deliveryAreaCode\":\"$AREA_CODE\"
  }"
```

---

## 3. Delivery flow — `/select` (fresh `$TXN`)

```bash
curl -sS -X POST "$BASE_URL/api/ondc/select" \
  -H 'Content-Type: application/json' \
  -d "{
    \"transactionId\":\"$TXN\",
    \"bppId\":\"$BPP_ID\",
    \"bppUri\":\"$BPP_URI\",
    \"providerId\":\"$PROVIDER_ID\",
    \"items\":[{ \"id\":\"$ITEM_ID\", \"quantity\":2, \"locationId\":\"$LOCATION_ID\" }],
    \"fulfillment\":{ \"gps\":\"$GPS\", \"areaCode\":\"$AREA_CODE\" }
  }"
```

### 3a. Self-Pickup variant

```bash
curl -sS -X POST "$BASE_URL/api/ondc/select" \
  -H 'Content-Type: application/json' \
  -d "{
    \"transactionId\":\"$TXN\",
    \"bppId\":\"$BPP_ID\",
    \"bppUri\":\"$BPP_URI\",
    \"providerId\":\"$PROVIDER_ID\",
    \"items\":[{ \"id\":\"$ITEM_ID\", \"quantity\":2, \"locationId\":\"$LOCATION_ID\" }],
    \"fulfillment\":{
      \"type\":\"Self-Pickup\",
      \"gps\":\"$GPS\",
      \"areaCode\":\"$AREA_CODE\"
    }
  }"
```

### 3b. Replacement scenario

Driven by the existing helper script:

```bash
bash scripts/ondc-select-replacement.sh
```

---

## 4. `/init` (reuse the select `$TXN`)

```bash
curl -sS -X POST "$BASE_URL/api/ondc/init" \
  -H 'Content-Type: application/json' \
  -d "{
    \"transactionId\":\"$TXN\",
    \"bppId\":\"$BPP_ID\",
    \"bppUri\":\"$BPP_URI\",
    \"providerId\":\"$PROVIDER_ID\",
    \"items\":[{ \"id\":\"$ITEM_ID\", \"quantity\":2, \"locationId\":\"$LOCATION_ID\" }],
    \"billing\":{
      \"name\":\"Asha K\",
      \"phone\":\"9876543210\",
      \"email\":\"asha@example.com\",
      \"address\":\"12 MG Road, Bengaluru\",
      \"areaCode\":\"$AREA_CODE\"
    },
    \"fulfillment\":{ \"gps\":\"$GPS\", \"areaCode\":\"$AREA_CODE\" }
  }"
```

---

## 5. `/confirm`

The handler reads the cart from the persisted state for `$TXN`.

```bash
curl -sS -X POST "$BASE_URL/api/ondc/confirm" \
  -H 'Content-Type: application/json' \
  -d "{ \"transactionId\":\"$TXN\" }"
```

After ACK, grab the order id the SNP returns on `/on_confirm` (check the
`/api/ondc/on_confirm` audit log or local store) and export it:

```bash
export ORDER_ID="O1"      # replace with the real order.id
```

---

## 6. `/status`

```bash
curl -sS -X POST "$BASE_URL/api/ondc/status" \
  -H 'Content-Type: application/json' \
  -d "{
    \"transactionId\":\"$TXN\",
    \"bppId\":\"$BPP_ID\",
    \"bppUri\":\"$BPP_URI\",
    \"orderId\":\"$ORDER_ID\"
  }"
```

---

## 7. `/track`

```bash
curl -sS -X POST "$BASE_URL/api/ondc/track" \
  -H 'Content-Type: application/json' \
  -d "{
    \"transactionId\":\"$TXN\",
    \"bppId\":\"$BPP_ID\",
    \"bppUri\":\"$BPP_URI\",
    \"orderId\":\"$ORDER_ID\"
  }"
```

---

## 8. `/cancel`

```bash
curl -sS -X POST "$BASE_URL/api/ondc/cancel" \
  -H 'Content-Type: application/json' \
  -d "{
    \"transactionId\":\"$TXN\",
    \"bppId\":\"$BPP_ID\",
    \"bppUri\":\"$BPP_URI\",
    \"orderId\":\"$ORDER_ID\",
    \"cancellationReasonId\":\"001\"
  }"
```

Reason codes: see ONDC RET 1.2.5 cancellation reason table.

---

## 9. `/update` (e.g. start a return request)

```bash
curl -sS -X POST "$BASE_URL/api/ondc/update" \
  -H 'Content-Type: application/json' \
  -d "{
    \"transactionId\":\"$TXN\",
    \"bppId\":\"$BPP_ID\",
    \"bppUri\":\"$BPP_URI\",
    \"orderId\":\"$ORDER_ID\",
    \"updateTarget\":\"item\"
  }"
```

---

## 10. `/rating`

```bash
curl -sS -X POST "$BASE_URL/api/ondc/rating" \
  -H 'Content-Type: application/json' \
  -d "{
    \"transactionId\":\"$TXN\",
    \"bppId\":\"$BPP_ID\",
    \"bppUri\":\"$BPP_URI\",
    \"orderId\":\"$ORDER_ID\",
    \"ratingCategory\":\"Order\",
    \"value\":\"5\"
  }"
```

---

## One-shot drivers

```bash
# search → wait → select → wait → init  (no confirm)
bash scripts/ondc-flow.sh

# Other prebuilt scenarios
bash scripts/ondc-select.sh
bash scripts/ondc-select-self-pickup.sh
bash scripts/ondc-select-delivery-update.sh
bash scripts/ondc-select-replacement.sh

# Local dev-only seed (skips select/init for confirm debugging)
bash scripts/ondc-seed-confirm.sh
```

---

## Notes

- `/search` is the only call that may be invoked WITHOUT `bppId`/`bppUri` —
  the gateway broadcasts it. Every other call MUST carry both.
- The catalog_rejection callback (step 1 above) is fired by the BAP
  automatically; there is no manual curl for it. To re-trigger, just rerun
  the search with the rejection-test query.
- All routes log structured `ondc.<action>` lines — `tail -f` the Next.js
  dev server output to follow the flow end to end.
