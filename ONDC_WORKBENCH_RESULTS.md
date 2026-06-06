# ONDC Workbench Validation — Results

Tracks Workbench (and Workbench-equivalent black-box) validation for the OpenIdea
BAP. Updated whenever the scenario suite is re-run or an external Workbench run
is completed.

- Scenario harness: [scripts/ondc-test-suite.mjs](scripts/ondc-test-suite.mjs)
- Per-route contracts: [src/app/api/ondc/*/route.ts](src/app/api/ondc/)
- Gap doc: [ONDC_GAP_ANALYSIS.md](ONDC_GAP_ANALYSIS.md)

---

## Registry status

| Check | Value |
| --- | --- |
| Subscriber ID | `openidea.co.in` |
| ukId | `37defd68-aa55-482f-8aa4-cc40d2a45cf2` |
| Network | preprod / `ONDC:RET10` / `IND` / `std:080` |
| Status | `SUBSCRIBED` |
| Valid window | `2026-06-02 → 2027-06-02` |
| Verified against | `https://preprod.registry.ondc.org/v2.0/lookup` |
| Last checked | 2026-06-06 |

How to re-check: `curl -s http://localhost:3000/api/ondc/registry-status | jq`
(source: [src/app/api/ondc/registry-status/route.ts](src/app/api/ondc/registry-status/route.ts)).

---

## Callback URL (BAP) — fix applied 2026-06-06

The registry's `subscriber_url` (`https://openidea.co.in/ondc`) has two defects
that would break every BPP callback:

1. **Path mismatch** — `/ondc/*` returns the site's HTML 404 page; the real
   handlers live under `/api/ondc/*`.
2. **Apex → www 307 redirect** — Vercel redirects the apex; signed ONDC POSTs
   do not follow redirects.

Fix: pin `ONDC_BAP_URI` so every action's `context.bap_uri` advertises the
correct, redirect-free callback prefix.

```
ONDC_BAP_URI=https://www.openidea.co.in/api/ondc
```

- Local: applied to [.env.local](.env.local).
- Prod (Vercel) — **still pending**. Run one of:
  ```bash
  # Option A: CLI (requires `vercel login` first; npm i -g vercel)
  vercel env add ONDC_BAP_URI production
  # paste: https://www.openidea.co.in/api/ondc
  vercel --prod   # redeploy so the env takes effect
  ```
  ```bash
  # Option B: Dashboard
  # Vercel → project "webtemp-bjcd" → Settings → Environment Variables
  # add ONDC_BAP_URI = https://www.openidea.co.in/api/ondc (Production)
  # then trigger a redeploy
  ```

Until the prod env var lands, every Workbench run hitting the deployed BAP
will continue to advertise the broken `bap_uri` and BPP callbacks will 404.

---

## Workbench-equivalent suite results

The harness exercises the same surfaces ONDC Workbench probes (method gate,
JSON parsing, required-field validation, value-format checks, structural
validation, signature/auth gate, ACK/NACK envelope shape) across all 21
BAP routes. Full coverage axes are documented in
[scripts/ondc/README.md](scripts/ondc/README.md).

### Summary

| Target | Configured | Total | Pass | Fail |
| --- | --- | ---: | ---: | ---: |
| Local (`http://localhost:3000`) | yes | 259 | 259 | 0 |
| Prod (`https://www.openidea.co.in`) | yes | 259 | 259 | 0 |

Both runs at 2026-06-06T13:12Z.

### By coverage axis (identical on local + prod)

| Axis | Pass / Total |
| --- | ---: |
| registry | 3 / 3 |
| method | 20 / 20 |
| parsing | 10 / 10 |
| config-or-validation | 10 / 10 |
| required-field | 41 / 41 |
| format | 25 / 25 |
| happy-path-probe | 10 / 10 |
| auth | 60 / 60 |
| structural | 70 / 70 |
| ack-shape | 10 / 10 |

### By Workbench action — outbound (`/api/ondc/<action>`) and callback (`/api/ondc/on_<action>`)

| Action | Outbound | Callback | Outbound notes | Callback notes |
| --- | ---: | ---: | --- | --- |
| Search   | 5 / 5  | 15 / 15 | method, parsing, required-field, format, happy-path-probe | auth, structural, ack-shape |
| Select   | 13 / 13 | 15 / 15 | adds required-field + format coverage for `order.items[]` | auth, structural, ack-shape |
| Init     | 16 / 16 | 15 / 15 | adds billing/fulfillment field coverage | auth, structural, ack-shape |
| Confirm  | 12 / 12 | 15 / 15 | adds `order.id` + payment status checks | auth, structural, ack-shape |
| Status   | 9 / 9  | 15 / 15 | order_id required, happy-path | auth, structural, ack-shape |
| Track    | 9 / 9  | 15 / 15 | order_id + optional callback_url format | auth, structural, ack-shape |
| Cancel   | 10 / 10 | 15 / 15 | order_id + cancellation_reason_id | auth, structural, ack-shape |
| Update   | 10 / 10 | 15 / 15 | update_target + order field checks | auth, structural, ack-shape |
| Support  | 9 / 9  | 15 / 15 | ref_id/phone/email + happy-path | auth, structural, ack-shape |
| Rating   | 13 / 13 | 15 / 15 | id/rating_category/rating_value range checks | auth, structural, ack-shape |

(Outbound + callback together = all 10 transaction actions from
[ONDC_GAP_ANALYSIS.md#133](ONDC_GAP_ANALYSIS.md#L133).)

### What is NOT covered by this suite

These are the boundaries the [scripts/ondc/README.md](scripts/ondc/README.md)
calls out explicitly — they require a live BPP/gateway round-trip and are out
of scope for a black-box harness:

- **Positive `/on_*` callback paths** — would require a BPP-signed payload
  whose public key resolves through the real ONDC registry under a TEST
  subscriber. Suite exercises every NEGATIVE branch (missing/malformed
  signature, mismatched signer, unknown ukId).
- **Real gateway ACKs** — `happy-path-probe` only asserts that a valid body
  progressed past validation and hit the gateway dial; it does not assert a
  particular ACK came back from a real BPP.
- **End-to-end transaction stitching** — search → on_search(s) → select →
  on_select → init → on_init → confirm → on_confirm as one stateful flow.
  Each leg is validated in isolation here.

These three gaps are exactly what the ONDC pre-prod Workbench is designed to
fill. See "Pending — external runs" below.

---

## Pending — external runs

These need the deployed BAP with `ONDC_BAP_URI` set (per the fix above), then a
run against a Workbench / live BPP. Re-running this section requires no code
changes — only that callbacks reach the production BAP and we capture the
results.

| Action | Status | Transaction ID | Notes |
| --- | --- | --- | --- |
| search   | not yet run | — | requires deployed bap_uri fix |
| select   | not yet run | — | |
| init     | not yet run | — | |
| confirm  | not yet run | — | |
| status   | not yet run | — | |
| track    | not yet run | — | |
| cancel   | not yet run | — | |
| update   | not yet run | — | |
| support  | not yet run | — | |
| rating   | not yet run | — | |

---

## How to re-run the suite

```bash
# Make sure ONDC env vars are loaded (so we exercise the configured branches).
npm run dev                                                  # terminal 1
npm run test:ondc                                            # terminal 2
# Or against prod directly:
node scripts/ondc-test-suite.mjs --base-url=https://www.openidea.co.in
# Machine-readable:
node scripts/ondc-test-suite.mjs --format=json > results.json
```

Latest raw JSON kept at `/tmp/ondc_local.json` and `/tmp/ondc_prod.json` from
this run; re-running overwrites them.
