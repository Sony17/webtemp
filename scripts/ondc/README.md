# ONDC test suite

A no-dependency black-box test suite for the ONDC BAP surface exposed under
`src/app/api/ondc/*`. Runs against a live Next.js server.

## Quick start

```bash
# In one terminal, run the app:
npm run dev

# In another:
npm run test:ondc
# or, with filters:
node scripts/ondc-test-suite.mjs --only=on_search
node scripts/ondc-test-suite.mjs --category=auth
node scripts/ondc-test-suite.mjs --base-url=https://stage.example
node scripts/ondc-test-suite.mjs --tap
node scripts/ondc-test-suite.mjs --format=json
```

## What it covers

21 routes × multiple coverage axes per route:

| Axis              | What it checks                                                      |
| ----------------- | ------------------------------------------------------------------- |
| `method`          | Only `POST` is accepted (`GET` registry-status is the one exception)|
| `parsing`         | Malformed JSON → 400                                                 |
| `config-or-validation` | Empty body → 400 missing-field or 503 unconfigured             |
| `required-field`  | Each documented REQUIRED field rejects when omitted                  |
| `format`          | HTTPS-only `bppUri`, GPS regex, positive-integer quantity, billing  |
| `happy-path-probe`| Valid body progresses past validation to a network/ACK/NACK response|
| `auth`            | Missing / malformed / unverifiable `Authorization` → 401 NACK       |
| `structural`      | Missing context / wrong action / missing `transaction_id`, `bpp_id` |
| `ack-shape`       | Callback errors return a NACK envelope with an error block          |
| `registry`        | `/registry-status` GET self + with `?subscriberId=` query           |

Total ~140 scenarios; ~7–10 per route. Designed so that adding more scenarios is
mechanical — edit `scripts/ondc/scenarios/*.mjs`.

## Why the suite passes on an unconfigured server

ONDC needs signing keys + subscriber identity (see `src/lib/ondc/config.ts`).
Without them, every route returns 503 from the `isOndcConfigured()` guard. The
suite accepts `[400, 503]` on validation scenarios so it stays green on a clean
dev box, and surfaces real regressions once ONDC env vars are present.

To force the configured-path branches, set the ONDC env vars before running:

```
ONDC_ENV=staging
ONDC_SUBSCRIBER_ID=…
ONDC_SUBSCRIBER_URI=https://your.bap
ONDC_UNIQUE_KEY_ID=…
ONDC_SIGNING_PUBLIC_KEY=…
ONDC_SIGNING_PRIVATE_KEY=…
ONDC_ENCRYPTION_PUBLIC_KEY=…
ONDC_ENCRYPTION_PRIVATE_KEY=…
```

## Limitations (black-box scope)

- **Positive callback paths** require the test's mock public key to resolve via
  the real ONDC registry, which is out of scope here. The suite exercises every
  NEGATIVE branch (auth gate, signature validation, structural validation) and
  documents the positive path as a manual integration step.
- **Real ACKs from a BPP/gateway** require a reachable ONDC peer. The
  happy-path-probe scenarios assert the route progressed past validation —
  not that a real ACK came back.

## Reference scenarios

Routes were authored against:

- ONDC Beckn HTTP signature profile — `src/lib/ondc/auth.ts`
- Per-route contracts — `src/app/api/ondc/*/route.ts` (each top-of-file comment
  documents the wire shape, required fields, and ACK/NACK rules)
- ONDC Protocol Specs — https://github.com/ONDC-Official
- ONDC reference implementations — https://github.com/ONDC-Official/reference-implementations

Extending the suite toward the full ONDC certification matrix means dropping
more `scenario({...})` entries into the relevant `scripts/ondc/scenarios/*.mjs`
file — they follow the same `{ name, route, category, ref, run, expect }` shape.
