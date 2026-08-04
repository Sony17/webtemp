# Tocxi Logistics Integration — Atomic Roadmap (Intern Build Plan)

**Goal:** add last-mile courier delivery to Open Idea by integrating the
[Tocxi Partner API](https://www.tocxi.com/partner-api.html). A shop order gets a
real courier booked (pickup from store → drop to buyer), we track it, and the
buyer sees live status.

**Design principle:** build a self-contained `src/lib/logistics/` module that is
a near-exact twin of the existing `src/lib/payments/` module. Payments is your
reference implementation for **every** pattern below (env-getter config, DB/JSON
dual store, idempotency, HMAC webhook). When in doubt, open the matching payments
file and copy its shape.

This roadmap is **atomic**: each task (`T-xx`) is small, independent where
possible, ordered by dependency, and has a concrete **Done when** you can verify
before moving on. Do them top to bottom. Open one PR per phase.

---

## Implementation status (2026-08-04)

The **self-contained module, API routes, webhook, and tests are built** (Phases
1–5, 8) plus an **admin ops console** (Phase 7, list + cancel). What's done:

- `src/lib/logistics/` — `config.ts`, `types.ts`, `client.ts` (auth + 429/5xx
  retry honoring `Retry-After` + all endpoints), `webhook.ts` (timing-safe HMAC
  verify), `store-json.ts` / `store-db.ts` / `store.ts` (DB-vs-JSON dual store,
  idempotent create + out-of-order-safe status advance).
- `prisma/schema.prisma` — `model Shipment @@map("logistics_shipment")` +
  migration `20260804120000_add_logistics_shipment_table`.
- `src/app/api/logistics/` — `quote`, `shipments` (POST create / GET list),
  `shipments/[id]` (GET one, `?refresh=1`), `shipments/[id]/cancel`, `webhook`.
- `.env.example` — `TOCXI_API_KEY` / `TOCXI_WEBHOOK_SECRET` / `TOCXI_BASE_URL`.
- Tests — `client.test.ts`, `webhook.test.ts`, `store.idempotency.test.ts`
  (25 tests; wired into `vitest.config.ts`). Full suite green (`npm test`).
- Admin — a **Logistics** tab in `src/app/shop/admin/page.tsx`: a **manual
  booking form** (order id + pickup/drop + COD, with a "Check price"
  serviceability probe via `/quote`) plus the shipment list, status, tracking
  link, and cancel-before-pickup (Phase 7, T-22/T-23).

- Buyer tracking (T-21) — a **Courier delivery** card on the order page
  (`src/components/shop/CourierTracking.tsx`) reads our own row via
  `GET /api/logistics/shipments/{id}` (resolves by order id, shipment id, OR the
  txn in the URL), renders a live status stepper + tracking link, and stays
  invisible when no courier shipment exists.

**Booking trigger — DECIDED: manual-from-admin.** The auto-book-on-order-paid
option (T-20) is intentionally NOT wired; an admin books each COD delivery by
hand from the Logistics tab, so the live ONDC order + payment flow (mid-overhaul)
stays untouched. The seam remains `POST /api/logistics/shipments` with the order
id as `partnerReference` if auto-book is ever revisited.

**External only (Phases 0, 9):** onboarding (real `X-API-Key` + webhook secret)
and deploy (Vercel env + registering the production `…/api/logistics/webhook`
URL with Tocxi). Everything in code is done.

---

## Tocxi API — the facts you'll build against

| Thing | Value |
|---|---|
| Base URL | `https://api.tocxi.com` |
| Auth | header `X-API-Key: pk_live_...` (issued once at onboarding) |
| Health check | `GET /api/v1/partner/me` |
| Serviceability | `POST /api/v1/partner/serviceability` |
| Quote (price) | `POST /api/v1/partner/quote` |
| Create shipment | `POST /api/v1/partner/shipments` (needs `Idempotency-Key` header) |
| Get shipment | `GET /api/v1/partner/shipments/{shipmentId}` |
| List shipments | `GET /api/v1/partner/shipments?page=0&size=20` |
| Cancel shipment | `POST /api/v1/partner/shipments/{shipmentId}/cancel` (before pickup only) |
| Webhook headers | `X-Tocxi-Event: shipment.status`, `X-Tocxi-Signature: <hex HMAC-SHA256 of raw body, keyed with webhook secret>` |
| Statuses | `PENDING → CONFIRMED → PICKED_UP → IN_TRANSIT → OUT_FOR_DELIVERY → DELIVERED` |
| Terminal | `CANCELLED`, `FAILED` |
| Retries | 429/5xx are retryable; honor `Retry-After`; always send `Idempotency-Key` on create |
| Pilot scope | Delhi NCR only, COD orders only, ~100 orders/day |

Auth error codes: `MISSING_API_KEY`, `INVALID_API_KEY`, `PARTNER_SUSPENDED` (401),
`RATE_LIMITED` (429).

---

## Guardrails (read once, apply to every task)

These are house rules from the existing codebase — breaking them fails review:

1. **This is a modified Next.js.** Before writing any route handler, read
   `node_modules/next/dist/docs/01-app/` for the current route-handler + `after()`
   API. Do not trust older Next.js knowledge (see `AGENTS.md`).
2. **Secrets never live in the repo.** Read them from `process.env` via a
   **runtime getter function** (not a module-load `const`) so serverless picks up
   the value per request. Copy `src/lib/payments/config.ts` exactly.
3. **Dual store.** Persistence goes through a `store.ts` dispatcher that picks
   Postgres (`store-db.ts`) when `DATABASE_URL` is set, else a `/tmp` JSON
   fallback (`store-json.ts`). Copy `src/lib/payments/store*.ts`.
4. **Idempotency everywhere.** Create-shipment uses the order id as
   `Idempotency-Key`. The webhook handler must be safe to receive the same event
   twice (Tocxi delivers at-least-once).
5. **No emojis anywhere in UI.** Use SVG icons + text. (Project rule.)
6. **`.env.example` documents names only** — placeholder values, never real keys.
7. Routes return `NextResponse`, set `export const runtime = "nodejs"`, and use
   `after()` for fire-and-forget work (mirror `src/app/api/ondc/on_confirm/route.ts`).

---

## Architecture (what you're building)

```
                         src/lib/logistics/
  config.ts     env getters + isTocxiConfigured()      ← copy payments/config.ts
  types.ts      request/response/status TS types
  client.ts     outbound HTTP to api.tocxi.com          ← the Tocxi SDK
  webhook.ts    HMAC-SHA256 verify of X-Tocxi-Signature ← copy ONDC auth verify idea
  store.ts      DB-vs-JSON dispatcher                    ← copy payments/store.ts
  store-db.ts   Prisma backend (logistics_shipment)      ← copy payments/store-db.ts
  store-json.ts /tmp fallback                            ← copy payments/store-json.ts
  store-types.ts ShipmentRecord shape

                     src/app/api/logistics/
  quote/route.ts             POST  → serviceability + price for checkout
  shipments/route.ts         POST create (book) · GET list
  shipments/[id]/route.ts    GET one · (cancel via ?action or sub-route)
  webhook/route.ts           POST inbound status from Tocxi (verify + upsert)

  prisma/schema.prisma → model Shipment @@map("logistics_shipment")

  UI: shop checkout (delivery fee), shop order page (tracking), shop admin (ops)
```

Order-id is the spine that joins a shop order → its Tocxi shipment (via
`partnerReference`) → webhook updates. Same idea as `transactionId` in ONDC.

---

## Phase 0 — Onboarding & groundwork (no code)

- **T-00 · Get sandbox credentials.** Contact Tocxi, obtain the `X-API-Key` and
  the **webhook secret**. Confirm whether there's a sandbox base URL distinct
  from `https://api.tocxi.com`. Put nothing in git.
  **Done when:** `curl -H "X-API-Key: <key>" https://api.tocxi.com/api/v1/partner/me`
  returns 200.

- **T-01 · Study the reference module.** Read all of `src/lib/payments/`
  (`config.ts`, `store.ts`, `store-db.ts`, `store-json.ts`) and one ONDC callback
  route end-to-end (`src/app/api/ondc/on_confirm/route.ts`). Write yourself a
  3-bullet summary of the config-getter, dual-store, and `after()` patterns.
  **Done when:** you can point to the exact lines that read env and that pick the
  store backend.

- **T-02 · Read the Next.js route-handler docs** in
  `node_modules/next/dist/docs/01-app/` (route handlers + `after`).
  **Done when:** you know how this repo's Next expects a POST handler + how to
  read the raw request body (needed for webhook signature verification).

---

## Phase 1 — Config & types (foundation, no network)

- **T-03 · `src/lib/logistics/config.ts`.** Copy `payments/config.ts`. Export
  `getTocxiConfig()` returning `{ apiKey, baseUrl, webhookSecret }` (all via
  `process.env[...]?.trim() ?? ""`) and `isTocxiConfigured()` (true when apiKey
  is non-empty). Base URL defaults to `https://api.tocxi.com` when unset.
  **Done when:** `isTocxiConfigured()` flips based on `TOCXI_API_KEY` presence.

- **T-04 · `src/lib/logistics/types.ts`.** Define TS types for the wire contract:
  `ParcelSize = "SMALL" | "MEDIUM" | "LARGE"`, `ShipmentStatus` union (all 8
  states), `QuoteRequest`/`QuoteResponse`, `Address` (`contactName`,
  `contactPhone`, `addressLine`, `pincode`, `latitude`, `longitude`),
  `CreateShipmentRequest`, `ShipmentResponse`, `WebhookEvent`.
  **Done when:** field names match the API table above exactly; `tsc` is clean.

- **T-05 · Add env to `.env.example`.** Names only, with comments (mirror the
  payments block): `TOCXI_API_KEY`, `TOCXI_BASE_URL`, `TOCXI_WEBHOOK_SECRET`.
  **Done when:** no real key present; each var has a one-line comment.

---

## Phase 2 — Tocxi client (outbound HTTP)

Build in `src/lib/logistics/client.ts`. One private `tocxiFetch(path, init)`
helper that injects `X-API-Key`, sets JSON headers, and centralizes error/retry
handling; each public function calls it.

- **T-06 · `tocxiFetch` core + auth.** Injects `X-API-Key` from `getTocxiConfig()`,
  throws a typed `TocxiError` (carrying status + Tocxi error code) on non-2xx.
  **Done when:** a 401 surfaces `INVALID_API_KEY` as a typed error, not a raw throw.

- **T-07 · Retry on 429/5xx.** In `tocxiFetch`, retry idempotent calls up to N
  times, honoring `Retry-After`. Do **not** retry 4xx (except 429).
  **Done when:** a simulated 429 with `Retry-After: 1` retries once then succeeds
  (unit test in Phase 8).

- **T-08 · `quote(input)` + `serviceability(input)`.** POST to `/quote` and
  `/serviceability`. Returns `serviceable`, `totalPrice`, `codFee`,
  `estimatedDistanceKm`, `estimatedDurationMin`.
  **Done when:** a manual call for two Delhi NCR points returns `serviceable:true`.

- **T-09 · `createShipment(input, idempotencyKey)`.** POST `/shipments` with the
  `Idempotency-Key` header set to the caller-supplied key (the order id). Returns
  `{ shipmentId, status, estimatedPrice, trackingUrl }`.
  **Done when:** calling twice with the same key returns the **same** `shipmentId`
  (no double booking).

- **T-10 · `getShipment(id)` + `listShipments(page,size)` + `cancelShipment(id, reason)`.**
  Thin wrappers over the GET/GET-list/POST-cancel endpoints.
  **Done when:** you can book → get → cancel one shipment end-to-end via a scratch
  script against sandbox.

---

## Phase 3 — Persistence (own record of every shipment)

We keep our own row per shipment so the shop/admin never has to hit Tocxi to
render status, and so webhook updates have somewhere to land.

- **T-11 · Prisma model.** Add to `prisma/schema.prisma`:
  `model Shipment { id, shipmentId @unique, partnerReference (order id) @unique,
  transactionId?, status, pickup Json, drop Json, quote Json?, trackingUrl?,
  awbNo?, estimatedPrice?, cod, codAmount?, statusHistory Json @default("[]"),
  lastEventAt?, createdAt, updatedAt }` with `@@map("logistics_shipment")` and
  indexes on `status` and `partnerReference`. Follow the `Payment` model's style.
  **Done when:** `npx prisma migrate dev --name logistics_shipment` applies
  cleanly and `npx prisma generate` runs.

- **T-12 · `store-types.ts` + `store-json.ts`.** Copy `payments/store-json.ts`.
  Define `ShipmentRecord`, `createShipment`, `updateShipmentStatus` (append to
  `statusHistory`, last-write-wins on `status`), `getShipmentByReference`,
  `getShipment`, `listShipments`. Idempotent create keyed on `partnerReference`.
  **Done when:** creating twice for one order id yields one record.

- **T-13 · `store-db.ts` + `store.ts` dispatcher.** Copy `payments/store-db.ts`
  and `payments/store.ts`. Same function surface as T-12, Prisma-backed, picked
  when `DATABASE_URL` is set.
  **Done when:** with `DATABASE_URL` set, a create shows up as a
  `logistics_shipment` row; unset, it lands in the `/tmp` JSON snapshot.

---

## Phase 4 — API routes (server surface for UI)

All under `src/app/api/logistics/`. Each: `runtime = "nodejs"`, `NextResponse`,
guard with `isTocxiConfigured()` (return a clean 503 if not configured, like the
ONDC routes do when unconfigured).

- **T-14 · `quote/route.ts` (POST).** Body = pickup/drop + parcel + cod. Calls
  `client.quote()`, returns price + serviceable. No persistence.
  **Done when:** `curl` with a Delhi NCR pickup/drop returns a price JSON.

- **T-15 · `shipments/route.ts` (POST create, GET list).** POST validates body,
  calls `client.createShipment(body, idempotencyKey=partnerReference)`, then
  `store.createShipment(...)`, returns the record. GET returns `listShipments`.
  **Done when:** POST persists a row and echoes `shipmentId`; GET lists it.

- **T-16 · `shipments/[id]/route.ts` (GET one, cancel).** GET returns the stored
  record (optionally refreshed from `client.getShipment`). Cancel path calls
  `client.cancelShipment` then `store.updateShipmentStatus(..., "CANCELLED")`.
  **Done when:** cancelling a `PENDING` shipment flips its stored status.

---

## Phase 5 — Inbound webhook (Tocxi → us)

This is the critical trust boundary. Mirror how ONDC verifies inbound signatures
(`src/lib/ondc/auth.ts`) — read the **raw body bytes first**, then verify.

- **T-17 · `src/lib/logistics/webhook.ts`.** `verifyTocxiSignature(rawBody, header)`
  = `hmac-sha256(webhookSecret, rawBody)` compared to `X-Tocxi-Signature` with a
  **timing-safe** compare (`crypto.timingSafeEqual`). Returns boolean.
  **Done when:** a unit test with a known secret/body/signature passes, and a
  tampered body fails.

- **T-18 · `webhook/route.ts` (POST).** Order of operations, no shortcuts:
  (a) read exact raw body; (b) `verifyTocxiSignature` → 401 on mismatch;
  (c) parse event; (d) `store.updateShipmentStatus(partnerReference, status)`
  **idempotently** (ignore out-of-order/duplicate events — compare timestamps);
  (e) return `2xx` fast, defer any extra work to `after()`.
  **Done when:** replaying the same event twice leaves exactly one status-history
  entry and returns 200 both times; a bad signature returns 401.

---

## Phase 6 — Shop integration (wire it into the real flow)

Now connect the module to orders. **Decision to confirm with the team before
starting:** book the shipment **automatically when an order is marked PAID/
confirmed**, or **manually from the admin console**. Default below = auto-on-paid
with a manual admin override. Keep the trigger in one place.

- **T-19 · Checkout delivery fee.** In `src/app/shop/checkout/page.tsx`, call
  `POST /api/logistics/quote` with store pickup + buyer drop; show
  serviceability + delivery fee before the buyer confirms. Block/flag if
  `serviceable:false`.
  **Done when:** an out-of-NCR pincode shows "not serviceable"; an NCR one shows a fee.

- **T-20 · Book on order paid.** At the point an order becomes PAID (find the
  payment reconcile/confirm seam — see `src/lib/payments/` writers and the shop
  order flow), call `POST /api/logistics/shipments` with the order id as
  `partnerReference`/idempotency key. Because it's idempotent, a retry/double-fire
  is safe.
  **Done when:** paying for a test order creates exactly one shipment row tied to
  that order id.

- **T-21 · Buyer-facing tracking.** In `src/app/shop/order/[txn]/[bppId]/page.tsx`,
  fetch the stored shipment for that order and render current status + a
  `trackingUrl` link. Status text updates as webhooks land (no Tocxi call on
  render — read our own row).
  **Done when:** the order page shows `OUT_FOR_DELIVERY` after you POST a test
  webhook for that order.

---

## Phase 7 — Admin console (ops surface)

- **T-22 · Shipments admin list.** Under `src/app/shop/admin/` (mirror the
  existing admin summary), list shipments with status, order ref, tracking link.
  **Done when:** the pilot's shipments render in a table with live status.

- **T-23 · Manual book / cancel from admin.** Buttons that hit the create and
  cancel routes for edge cases (auto-book failed, or cancel-before-pickup).
  **Done when:** an admin can cancel a `PENDING` shipment and see it flip.

---

## Phase 8 — Tests (mirror the existing `*.test.ts` + vitest setup)

Vitest is already wired (`vitest.config.ts`). Alias `server-only` as the existing
tests do. One test file per concern, colocated in `src/lib/logistics/`.

- **T-24 · `client.test.ts`** — mock `fetch`: auth header present; 429 honors
  `Retry-After` then succeeds; `createShipment` sends `Idempotency-Key`.
- **T-25 · `webhook.test.ts`** — valid signature passes, tampered body fails.
- **T-26 · `store.idempotency.test.ts`** — double create → one record; duplicate
  webhook event → one status-history entry; out-of-order event ignored.
  **Done when (all):** `npm test` (`vitest run`) is green.

---

## Phase 9 — Deploy & pilot cutover

- **T-27 · Vercel env.** Set `TOCXI_API_KEY`, `TOCXI_WEBHOOK_SECRET`,
  `TOCXI_BASE_URL` in Vercel → Settings → Environment Variables (Production),
  then redeploy. (See `project_vercel_deploy` runbook.)
  **Done when:** `/api/logistics/quote` works on the deployed URL.
- **T-28 · Register webhook URL with Tocxi.** Give Tocxi the production
  `https://<domain>/api/logistics/webhook` URL and confirm the secret matches.
  **Done when:** a Tocxi test event reaches the endpoint and returns 200.
- **T-29 · Pilot smoke test.** One real COD order in Delhi NCR: book → track →
  deliver, watching status flow through all states.
  **Done when:** the order shows `DELIVERED` end-to-end with no manual DB edits.

---

## Definition of done (whole project)

- A shop order in Delhi NCR gets a Tocxi shipment booked automatically, is
  trackable by the buyer, updates live from webhooks, and is cancellable before
  pickup — with our own `logistics_shipment` ledger as the source of truth.
- No secrets in git; module is DB/JSON dual-backed; create + webhook are
  idempotent; all tests green.

## Suggested PR / branch cadence

Work on `main` (project convention — no feature branches unless asked). Land one
reviewable chunk per phase: `feat(logistics): config + types` → `client` →
`store + prisma` → `api routes` → `webhook` → `shop wiring` → `admin` → `tests`.
Each phase's **Done when** items are your PR checklist.
