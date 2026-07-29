# ONDC Network Observability (NO)

This document explains how the Buyer App forwards its transaction logs to ONDC's
**Network Observability** log collector, and how to turn it on for **pre-prod**
and, later, **prod**.

> **TL;DR** — Set `ONDC_OBSERVABILITY_URL` and `ONDC_OBSERVABILITY_TOKEN` and the
> app automatically forwards a Personal-Data-scrubbed copy of every ONDC exchange
> (inbound `on_*` callbacks **and** outbound BAP requests) to the collector.
> Nothing forwards until both are set. **No runtime code changes are required.**

---

## What Network Observability is

ONDC's *Network Observability & Open Data Framework* requires every Network
Participant to forward a copy of its **Transaction Logs** — the API calls it
sends and receives over the ONDC protocol, **with Personal Data removed** — to an
ONDC-run collector. ONDC uses these logs to monitor the health and behaviour of
the live network.

For this app (a **BAP** / buyer app) the transaction logs are:

- **inbound** — the `on_search` / `on_select` / `on_init` / `on_confirm` /
  `on_status` / `on_track` / `on_cancel` / `on_update` / `on_support` /
  `on_rating` callbacks we receive, and the ACK/NACK we replied with.
- **outbound** — the `search` / `select` / `init` / `confirm` / `status` /
  `track` / `cancel` / `update` / `support` / `rating` / `issue` requests we
  send, and the synchronous ACK/NACK we got back.

## How it is wired in

Both directions already funnel through a single seam, so forwarding is added in
exactly two places and every route inherits it for free:

| Direction | Seam | File |
|-----------|------|------|
| inbound   | `buildAck` / `buildNack` (next to `finalizeAuditTrace`) | [`src/lib/ondc/responses.ts`](../src/lib/ondc/responses.ts) |
| outbound  | `sendOndcRequest` (after the exchange completes / fails) | [`src/lib/ondc/client.ts`](../src/lib/ondc/client.ts) |

Both call into [`src/lib/ondc/network-observability.ts`](../src/lib/ondc/network-observability.ts),
which:

1. no-ops when NO is not configured (so unconfigured deployments are unaffected);
2. scrubs Personal Data (`scrubPersonalData`);
3. builds the JSON envelope (`buildObservabilityPayload`);
4. POSTs it to the collector, **fire-and-forget**, with a bounded timeout and a
   couple of retries — a NO failure can **never** delay or NACK a real ONDC call.

Only **fully-verified** inbound callbacks (those with a `transaction_id` **and**
`message_id`) are forwarded, so pre-verification fast-ACKs and pre-parse error
NACKs are not double-sent. Each callback is forwarded exactly once.

## The token (per-environment)

The token authenticates **this** participant to the collector. It is generated
from the ONDC Network Observability portal and is **different per environment**:

- **Pre-prod** — generate a token in the NO portal and use it here **while
  testing in pre-prod only**.
- **Prod** — generate a **new, different** token after you subscribe to prod
  (via the registry *update participant info* step) and use that one in prod.

Because the token is a per-deployment secret, it lives in **one** env var whose
**value differs per deployment**:

```
ONDC_OBSERVABILITY_TOKEN   # pre-prod deployment → pre-prod token
                           # prod    deployment → prod    token
```

Never put the prod token on the pre-prod deployment (or vice-versa).

## Configuration

All values are env-driven (see [`.env.example`](../.env.example)):

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `ONDC_OBSERVABILITY_URL` | yes (to enable) | — | Collector ingestion endpoint. |
| `ONDC_OBSERVABILITY_TOKEN` | yes (to enable) | — | The generated NO token for **this** environment. |
| `ONDC_OBSERVABILITY_ENABLED` | no | on | Set to `"0"` as a kill switch even when URL+token are set. |
| `ONDC_OBSERVABILITY_AUTH_HEADER` | no | `Authorization` | Header the token rides in. |
| `ONDC_OBSERVABILITY_AUTH_SCHEME` | no | `Bearer ` | Prefix before the token. Set to `""` to send the raw token. |
| `ONDC_OBSERVABILITY_TIMEOUT_MS` | no | `10000` | Per-submission timeout. |

> ⚠️ **Verify the endpoint URL and payload schema against ONDC's Network
> Observability spec.** Those two details are defined in ONDC's access-controlled
> onboarding docs, not in this repo, so they are **configurable, not hardcoded**.
> The submitted JSON shape is produced by `buildObservabilityPayload()` in
> [`src/lib/ondc/network-observability.ts`](../src/lib/ondc/network-observability.ts)
> — adjust that one function if the collector expects a different envelope, and
> set the auth header/scheme to match what the spec asks for.

## Personal-Data scrubbing

`scrubPersonalData()` recursively redacts known personal fields before a log
leaves the app (names, email, phone, precise address components, financial /
government IDs) and masks `gps` to ~1 km precision. Coarse location that the
collector keys on (`area_code`, `city`, `state`) is preserved. The redaction set
is intentionally conservative and easy to extend — review it against the current
Open Data Framework and add fields there as needed.

## Operating & verifying

A status + manual-submit surface lives at
[`/api/ondc/observability/forward`](../src/app/api/ondc/observability/forward/route.ts):

- **`GET /api/ondc/observability/forward`** — reports whether forwarding is live,
  the environment/subscriber, the collector host, and running counters
  (`attempted` / `succeeded` / `failed`, last success/failure). Leak-free (no
  token, no full URL).

  ```bash
  curl -s http://localhost:3000/api/ondc/observability/forward | jq
  ```

- **`POST /api/ondc/observability/forward`** — manually (re)submits the stored
  inbound logs for one transaction. This is the explicit "submit NO logs" action
  for proving the integration in pre-prod. Gated by `ONDC_AUDIT_TOKEN` (same
  secret as the audit reader). It **awaits** each submission so the response
  reports real success/failure.

  ```bash
  curl -s -X POST "http://localhost:3000/api/ondc/observability/forward?token=$ONDC_AUDIT_TOKEN" \
    -H 'Content-Type: application/json' \
    -d '{ "transactionId": "<txn>" }' | jq
  ```

## Go-live checklist

- [ ] Pre-prod: generate the NO token, set `ONDC_OBSERVABILITY_URL` +
      `ONDC_OBSERVABILITY_TOKEN` on the pre-prod deployment.
- [ ] Confirm the collector URL and payload schema match the ONDC NO spec;
      adjust `buildObservabilityPayload()` / auth header if needed.
- [ ] Run a transaction, then `GET /api/ondc/observability/forward` and confirm
      `succeeded` is climbing (or `POST` to replay a known `transactionId`).
- [ ] Prod: after subscribing to prod, generate the **different** prod token and
      set it (with the prod collector URL) on the **prod** deployment only.
