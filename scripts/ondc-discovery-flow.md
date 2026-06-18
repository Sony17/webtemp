# ONDC Discovery Flow — Incremental Catalog (curl runbook)

Drives the ONDC Workbench **Discovery Flow → Incremental Catalog Refresh** test
against the local BAP at `http://localhost:3000`.

The flow has two `/search` calls on the **same** `transactionId`:

1. **Full catalog search** — mints the txn, fetches the full catalog.
2. **Incremental catalog search** — reuses the txn, adds `incremental: true` so
   the route appends the RET10 1.2.5 `catalog_inc` tag group (start/end window).
   BPPs return only catalog deltas since the last refresh.

Both calls return only the synchronous ACK/NACK. The actual catalog payloads
arrive async as `on_search` callbacks to `/api/ondc/on_search`.

> **Workbench session gate:** start the Discovery Flow → Incremental Catalog
> session on the Workbench UI **before** firing the curls. Without an active
> session for your BAP URI, Workbench returns `HTTP 428 — no session or active
> flow found`.

---

## 1. Full-catalog search (first search — mints the txn)

```bash
SEARCH_RES=$(curl -sS -X POST "http://localhost:3000/api/ondc/search" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "basmati rice",
    "category": "Rice and Rice Products",
    "deliveryGps": "12.9716,77.5946",
    "deliveryAreaCode": "560001"
  }')
echo "$SEARCH_RES"
TXN=$(sed -n 's/.*"transactionId":"\([^"]*\)".*/\1/p' <<<"$SEARCH_RES" | head -n1)
echo "txn=$TXN"
```

Expected response:

```json
{"status":"ACK","transactionId":"<uuid>","messageId":"<uuid>"}
```

---

## 2. Incremental catalog search (second search — same txn, delta window)

```bash
TXN=<paste-txn-from-step-1>
START=$(node -e "console.log(new Date(Date.now()-3600*1000).toISOString())")
echo "txn=$TXN  start=$START"

curl -sS -X POST "http://localhost:3000/api/ondc/search" \
  -H 'Content-Type: application/json' \
  -d "{
    \"transactionId\": \"$TXN\",
    \"query\": \"basmati rice\",
    \"category\": \"Rice and Rice Products\",
    \"deliveryGps\": \"12.9716,77.5946\",
    \"deliveryAreaCode\": \"560001\",
    \"incremental\": true,
    \"incrementalStart\": \"$START\"
  }"
```

- `incremental: true` → route appends the `catalog_inc` tag group with
  `start_time` and `end_time` ([route.ts:183-195](../src/app/api/ondc/search/route.ts#L183-L195)).
- `incrementalStart` is optional. Defaults to `now - 1h`.
- **Must satisfy `start_time < end_time`** — a future `incrementalStart` produces
  an inverted window; strict BPPs will NACK.

---

## 3. Inspect the async `on_search` callbacks

The delta catalog arrives async. Read the audit log to see what landed for the
transaction (requires `ONDC_AUDIT_TOKEN`):

```bash
TXN=<your-txn>
TOKEN="$ONDC_AUDIT_TOKEN"

curl -sS "http://localhost:3000/api/ondc/audit?txn=$TXN&action=on_search" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

Returns `{ count, filter, events: [...] }`. For the incremental flow you
typically see multiple callbacks: one carrying the delta catalog (items), plus
location open/close transitions on the provider's locations.

---

## Reference

- Route: [src/app/api/ondc/search/route.ts](../src/app/api/ondc/search/route.ts)
- Callback handler: [src/app/api/ondc/on_search/](../src/app/api/ondc/on_search/)
- Audit reader: [src/app/api/ondc/audit/route.ts](../src/app/api/ondc/audit/route.ts)
- Full delivery-flow driver script: [scripts/ondc-flow.sh](./ondc-flow.sh)
