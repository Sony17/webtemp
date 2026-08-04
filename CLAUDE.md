@AGENTS.md

## Safety rules

- Never modify or delete production data.
- Never commit or push changes unless I explicitly approve.
- Never access or upload session, credential, or secret files.
- Only work in the current branch.
- Ask for confirmation before any destructive operation.

## Buyer Delivery Flow — /select curl

Mints a fresh UUID for `transactionId` on every invocation (Delivery Flow is a new session per ONDC contract); reuse the printed id through `on_select` → `init` → `on_init` → `confirm` → `on_confirm`.

```bash
TXN=$(uuidgen | tr 'A-Z' 'a-z'); echo "txn=$TXN"; \
curl -sS -X POST "http://localhost:3000/api/ondc/select" \
  -H 'Content-Type: application/json' \
  -d "{
    \"transactionId\": \"$TXN\",
    \"bppId\":  \"staging-automation.ondc.org\",
    \"bppUri\": \"https://workbench.ondc.tech/api-service/ONDC:RET10/1.2.5/seller\",
    \"providerId\": \"P1\",
    \"items\": [
      { \"id\": \"I1\", \"quantity\": 2, \"locationId\": \"L1\" }
    ],
    \"fulfillment\": {
      \"gps\": \"12.971600,77.594600\",
      \"areaCode\": \"560001\"
    }
  }"
```
