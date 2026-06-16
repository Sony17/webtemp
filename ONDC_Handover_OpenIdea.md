# ONDC Handover — OpenIdea BAP

> **Audience:** A developer joining the OpenIdea ONDC project with **little or no prior ONDC knowledge**.
> By the end of this document you should understand *what* ONDC is, *how* OpenIdea plugs into it, *where* the code lives, *what* is done vs. pending, and *how* to run, test, and debug it.
>
> **Codebase root for everything below:** `webtemp/` (a Next.js app). All ONDC code lives under `webtemp/src/`.
> **Last updated:** 2026-06-16

---

## Table of Contents

- [Latest Progress Update (16 June 2026)](#latest-progress-update-16-june-2026)
- [ONDC Workbench Debugging Investigation (In Progress)](#ondc-workbench-debugging-investigation-in-progress)
- [Known Blockers](#known-blockers)
- [Next Actions](#next-actions)

1. [Executive Summary](#1-executive-summary)
2. [ONDC Fundamentals](#2-ondc-fundamentals)
3. [OpenIdea ONDC Architecture](#3-openidea-ondc-architecture)
4. [Codebase Structure](#4-codebase-structure)
   - [Most Important Files For New Developers](#most-important-files-for-new-developers)
   - [Environment Variables & Configuration](#environment-variables--configuration)
5. [Persistence Layer](#5-persistence-layer)
6. [Callback Processing](#6-callback-processing)
7. [Audit System](#7-audit-system)
8. [Reconciliation System](#8-reconciliation-system)
9. [Network Observability](#9-network-observability)
10. [Payment System](#10-payment-system)
11. [Workbench & Testing](#11-workbench--testing)
   - [End-to-End Search Debugging Playbook](#end-to-end-search-debugging-playbook)
   - [Current Development Timeline](#current-development-timeline)
12. [Current Project Status](#12-current-project-status)
13. [Known Issues](#13-known-issues)
14. [Pending Work](#14-pending-work)
   - [Project Ownership & Responsibility](#project-ownership--responsibility)
15. [Danish Quick Start Guide (30 minutes)](#15-danish-quick-start-guide-30-minutes)

**Appendices**

- [Repository & File Map](#repository--file-map)
- [How a Complete ONDC Transaction Flows Through Our Code](#how-a-complete-ondc-transaction-flows-through-our-code)
- [Current Technical Debt](#current-technical-debt)
- [If You Join This Project Tomorrow](#if-you-join-this-project-tomorrow)
- [Project Status Snapshot](#project-status-snapshot)

---

# Latest Progress Update (16 June 2026)

> This section is the **current-state snapshot** for anyone picking up the project today. It records what was completed/changed on 16 June 2026. The detailed per-section documentation below (§1–§15) remains the reference; this is the "what's new" digest. For the granular status grid, see [§12 Current Project Status](#12-current-project-status).

## Completed / implemented today

- **Network Observability API** — `GET /api/ondc/observability?transactionId=<id>` is implemented and returns a single-screen view per transaction: **summary** (total events, ACK/NACK counts, last action, last-seen), **timeline** (audited callbacks oldest→newest), and **reconciliation** (per-BPP data presence). Pure read/projection over the audit log + store; no writes. See [§9 Network Observability](#9-network-observability).
- **Payment Integration (JSON-based payment tracking)** — a **ledger**, not a PSP integration. In-memory `Map<transactionId, PaymentRecord>` with write-through JSON/Blob snapshot (`src/lib/payments/store-json.ts`). Tracks one PENDING/PAID record per transaction. No Razorpay/PSP calls; settlement is recorded out-of-band. See [§10 Payment System](#10-payment-system).
- **Payment Instructions API** — `GET /api/payments/instructions?transactionId=<id>` joins the per-payment data (reference + amount) with the static Ecosysz bank-account config and returns the buyer's pay-in instructions. Resolves correctly today; bank/UPI fields are **empty placeholders** until Ecosysz values are supplied.
- **Payment Reconciliation API** — `POST /api/payments/reconcile` settles a payment **keyed by `paymentReference`** (what a bank-statement line carries), as opposed to `/verify` which is keyed by `transactionId`. Both share the same write-once settlement logic. **404** if no payment matches the reference.
- **Payment verification flow** — `POST /api/payments/verify` flips a tracked payment PENDING→PAID (or back) and records the `bankReference` (UTR/RRN). **404** if the payment was never created via `/create`. Out-of-band: invoked by an ops console / bank-statement job / webhook; there is no automatic bank polling.
- **`verifiedAt` timestamp behavior** — **write-once**: stamped only on the **first** transition to PAID and never overwritten on subsequent re-verifies. Distinct from `updatedAt` (which moves on every mutation). Provides an audit-integrity anchor ("when exactly did this settle?").
- **`paymentReference` generation logic** — **deterministic**: `PAY-` + the first 16 hex chars of `SHA-256(transactionId)`, uppercase (`paymentReferenceFor()`). Same transaction → same reference, which is what makes `/create` idempotent and lets `/reconcile` resolve a bank line back to its payment.
- **ONDC tags on `search`** — both **`bap_terms`** and **`bap_features`** tag groups are now emitted on every outbound `search` (per ONDC's RET10 1.2.5 guidance received today). `bap_features` advertises codes **003, 005, 006** (each `"yes"`), taken verbatim from the RET10 1.2.5 contract snippet ONDC provided. See [§13.3](#133-bap-terms-use-contract-example-values) for the placeholder finder-fee/static-terms caveat.

## Infrastructure & research status

- **AWS setup status** — **Complete.** AWS credentials / setup are in place and available for use.
- **MCP research status** — **In Progress.** Exploratory evaluation of a Model Context Protocol server surface for the platform; no implementation committed yet.
- **WhatsApp integration research status** — **In Progress.** Exploring a WhatsApp ordering/notification channel; research-only at this stage.
- **ONDC handover documentation effort** — this comprehensive handover document (`ONDC_Handover_OpenIdea.md`) was authored and is being kept current. It covers ONDC fundamentals, architecture, codebase map, persistence, callbacks, audit/observability/reconciliation, payments, testing, status, known issues, ownership, and a 30-minute quick-start — intended as the primary onboarding artifact for a new engineer.

---

# ONDC Workbench Debugging Investigation (In Progress)

> **Status: In Progress.** This documents the active investigation into why ONDC Workbench still reports a `bap_id` mismatch on `on_search`, even after a code fix. Treat the conclusions as a **working hypothesis**, not a settled root cause.

## What is confirmed working

- **Search requests are being sent successfully.** Outbound `/api/ondc/search` builds and signs the request and the gateway/Workbench returns an **ACK**.
- **`bap_terms` tags implemented.** The transaction-level static-terms group is published on every search.
- **`bap_features` tags implemented.** Codes **003, 005, 006** (each `"yes"`) are advertised alongside `bap_terms`, per the RET10 1.2.5 contract snippet ONDC shared.

## The symptom

- The Workbench `on_search` callback arrives with:
  ```json
  { "bap_id": "staging-automation.ondc.org", "bap_uri": "https://openidea.co.in/ondc" }
  ```
- Our **outbound** `bap_id` is `openidea.co.in` (resolved from `ONDC_BAP_ID` → falls back to `ONDC_SUBSCRIBER_ID`).
- The only failing gate is the `bap_id` echo check in `src/app/api/ondc/on_search/route.ts`, producing:
  ```json
  { "message": "bap_id mismatch (got \"staging-automation.ondc.org\")" }
  ```

## What the investigation proved

- The value `staging-automation.ondc.org` **originates entirely from the incoming callback payload**. It is read via `JSON.parse(rawBody).context.bap_id` and is **not generated, mapped, or substituted anywhere in our codebase** — the only occurrence of that string in `src/` is in explanatory comments. Our outbound identity and signing are unaffected (`config.bapId` = `openidea.co.in`).
- The signed callback is authentic: the signature verifies against the sender's registry key, and the `signer.subscriberId === ctx.bpp_id` gate confirms the same `staging-automation.ondc.org` identity that *signed* the callback. So we would be allowlisting the **same identity that cryptographically signed it**.

## Action taken

- Added a **temporary staging-automation allowlist** in `on_search` validation: a single-literal, exact-match exception (`STAGING_AUTOMATION_BAP_ID = "staging-automation.ondc.org"`) that **logs a warning and continues** instead of NACKing — **without** modifying signature verification, registry lookup, `signer == bpp_id`, `bap_uri`, or `domain` checks. Every other non-echoed `bap_id` still NACKs.

## Current status & hypothesis

- **Despite the change, Workbench still returns the original `bap_id mismatch` response**, and the local console shows **none** of the expected `on_search` logs (no `ENTER`, no `rejected`, no `allowlisted`).
- **Current hypothesis:** the callback to `https://openidea.co.in/ondc/on_search` is **reaching a stale / different deployment** (the public Vercel build) rather than the locally modified build — i.e. our patched code never ran for that request. A temporary `debug_build` marker was added to the `on_search` ACK/NACK response envelope to confirm which build answers the callback (observe whether `"debug_build":"local-20260616"` appears in the Workbench response).
- **This investigation is marked _In Progress_** pending: (a) deploying the patched build and (b) confirming via the `debug_build` marker whether the public host serves the new code.

---

# Known Blockers

These are the items currently preventing forward progress or awaiting external input. (For the broader internal-vs-external split, see [§14 Pending Work](#14-pending-work).)

| # | Blocker | Type | Notes |
| --- | --- | --- | --- |
| 1 | **ONDC has requested `bap_features` tags** | External (now addressed in code) | RET10 1.2.5 requires both `bap_terms` and `bap_features` on search. Implemented today (003/005/006). Awaiting ONDC confirmation that the structure/values are accepted. |
| 2 | **Ecosysz bank account details are still pending** | External dependency | `src/lib/payments/config.ts` fields (accountName, accountNumber, ifsc, upiId, qrCodeUrl) are empty. Payment instructions return blanks until provided. This is the **only** remaining payment work. |
| 3 | **Workbench `on_search` callback identity mismatch investigation is ongoing** | Internal (in progress) | `bap_id = staging-automation.ondc.org` vs our `openidea.co.in`. Allowlist added; suspected stale/other deployment serving the callback. See the [Workbench investigation section](#ondc-workbench-debugging-investigation-in-progress). |
| 4 | **Waiting for clarification on BAP percentage / finder fee** | External dependency | Outbound search currently uses placeholder finder-fee values (`percent`, `3`) pending OpenIdea's confirmed commercial terms. |
| 5 | **Waiting for ONDC response on tags & participant group access** | External dependency | Confirmation of the exact `bap_terms`/`bap_features` tag contract and the relevant ONDC participant-group/access for certification. |

---

# Next Actions

Ordered by priority. Ownership: **Technical Owner = Aaqib Abdullah**; **Business/External liaison = OpenIdea Founder** (for ONDC- and Ecosysz-facing items). See [§ Project Ownership & Responsibility](#project-ownership--responsibility).

| Priority | Action | Owner | Depends on |
| --- | --- | --- | --- |
| **P0** | Confirm which deployment serves `openidea.co.in/ondc/on_search` (deploy patched build; check for `debug_build` marker in the Workbench response). Resolve the `bap_id` mismatch end-to-end. | Aaqib Abdullah | Vercel deploy access |
| **P0** | Obtain **Ecosysz bank account details** and populate `payments/config.ts`; smoke-test `/payments/instructions`. | OpenIdea Founder → Aaqib Abdullah | Ecosysz |
| **P1** | Get ONDC confirmation on **`bap_features` tag structure** and the **finder-fee / BAP percentage** values; replace the placeholder search-tag constants with confirmed values. | OpenIdea Founder (liaison) → Aaqib Abdullah | ONDC response |
| **P1** | Run the **Prisma migration** against Supabase and smoke-test the Postgres backend (JSON store remains the fallback until then). | Aaqib Abdullah | `DATABASE_URL` |
| **P1** | Confirm **`ONDC_BAP_URI`** is set in Vercel production and redeploy so callbacks advertise the correct, redirect-free URI. | Aaqib Abdullah | Vercel env access |
| **P2** | Once the callback path is fixed, run ONDC **Workbench end-to-end** (search → on_search → … → on_confirm) and capture results; begin **certification**. | Aaqib Abdullah | P0 items cleared |
| **P2** | Remove temporary debug instrumentation (`debug_build` marker, `bap_id mismatch DEBUG` log) and re-evaluate whether the staging-automation allowlist should remain. | Aaqib Abdullah | Certification scope |
| **P3** | Advance **MCP** and **WhatsApp** research to a go/no-go decision; document findings. | Aaqib Abdullah | Founder direction |

---

# 1. Executive Summary

## What is ONDC?

**ONDC** = **Open Network for Digital Commerce**. It is a government-backed initiative in India to "unbundle" e-commerce. Instead of a closed platform like Amazon or Flipkart where the buyer app and the seller catalog belong to one company, ONDC is an **open network** where:

- **Buyer apps** (where customers search and shop) and
- **Seller apps** (where merchants list products)

are built and run by **different companies**, yet can transact with each other over a shared protocol. A buyer on *any* buyer app can purchase from a seller on *any* seller app — the way email lets Gmail talk to Outlook.

The protocol underneath ONDC is **Beckn**. You'll see "Beckn" terms (intent, catalog, fulfillment, quote) in the payloads.

## What is OpenIdea building?

OpenIdea is building a **Buyer App** on ONDC for the **Retail** domain (`ONDC:RET10`). In ONDC terms, OpenIdea is a **BAP — Buyer App Participant** (also called a Buyer Network Participant / Buyer NP).

Concretely, the code in `webtemp/` implements the BAP side of the full ONDC retail order lifecycle:

```
search → select → init → confirm → status → track → cancel → update → support → rating
```

plus the matching asynchronous callbacks (`on_search`, `on_select`, …) that seller apps send back.

## OpenIdea's role as a BAP

A BAP is responsible for:

1. **Originating** buyer requests (search for items, place orders) — signing each request with the BAP's private key.
2. **Receiving callbacks** from seller apps (catalogs, quotes, order confirmations) — verifying each callback's signature against the sender's public key (resolved from the ONDC registry).
3. **Persisting** the transaction state (catalogs, quotes, orders) so the buyer can be shown what's happening.
4. **Collecting payment** from the buyer (OpenIdea's model is **prepaid collection** into an Ecosysz bank account, reconciled out-of-band).

OpenIdea is **registered as a Buyer NP in ONDC Pre-Production** with subscriber id `openidea.co.in`.

## Current project status (one-paragraph version)

The **entire transaction protocol is implemented** — all 10 outbound actions, all 10 callbacks, request signing, callback signature verification, persistence (JSON + Postgres backends), audit logging, reconciliation, and observability. A **payment ledger** (PENDING/PAID tracking with deterministic references) is also implemented. The project is **blocked on external ONDC integration**: outbound search ACK works and Workbench accepts our requests, but **inbound `on_search` callbacks are not currently being observed**. The **leading suspected cause is a pre-prod registry key-resolution failure** (observed as HTTP 403/404), which — if confirmed — would cause callbacks to be rejected before processing. This still needs confirmation via fresh production logs and `registry-status` diagnostics, so **end-to-end Workbench certification has not yet begun**. The only remaining payment config is filling in the **real Ecosysz bank account values** (currently empty placeholders). See [§12](#12-current-project-status), [§13](#13-known-issues), [§14](#14-pending-work).

---

# 2. ONDC Fundamentals

This section defines every term you need. Read it once; refer back as needed.

## The participants

```
        ┌─────────────────────────────────────────────────────────────┐
        │                       ONDC NETWORK                           │
        │                                                              │
        │   ┌──────────┐        ┌──────────┐        ┌──────────┐       │
        │   │  REGISTRY│        │ GATEWAY  │        │  BPP #1  │       │
        │   │ (phone   │        │ (broad-  │        │ (seller) │       │
        │   │  book of │        │  caster) │        ├──────────┤       │
        │   │  keys)   │        │          │        │  BPP #2  │       │
        │   └──────────┘        └──────────┘        ├──────────┤       │
        │        ▲                   ▲              │  BPP #N  │       │
        │        │                   │              └──────────┘       │
        └────────┼───────────────────┼──────────────────▲─────────────┘
                 │                   │                   │
                 │ (look up keys)    │ (broadcast search)│ (direct calls)
                 │                   │                   │
            ┌────┴───────────────────┴───────────────────┴────┐
            │                  BAP  (OpenIdea)                 │
            │           "the buyer app" — this codebase        │
            └──────────────────────────────────────────────────┘
```

- **BAP — Buyer App Participant.** The buyer-facing app. **This is OpenIdea.** It *originates* requests (search/select/init/confirm…) and *receives* the matching callbacks. Think "the shopping app."

- **BPP — Buyer-side… no: Seller Platform Participant** (the "P" is for Platform/Provider). The **seller app**. It holds the catalog, accepts orders, ships goods, and *sends callbacks back to the BAP*. Think "the merchant's backend." A single search can reach **many** BPPs.

- **Gateway.** A network router. When a BAP **searches**, it does *not* know which sellers exist — so it sends the search to the **gateway**, which **broadcasts** it to every relevant BPP. Search is the *only* action that goes through the gateway. Every other action (select, init, confirm…) is sent **directly** to the one specific BPP the buyer chose.

- **Registry.** The network's **phone book of public keys**. Every participant registers its `subscriber_id` and its **signing public key** + **encryption public key**. When OpenIdea receives a callback signed by some BPP, it asks the registry "what is this BPP's public key?" so it can verify the signature. (This lookup is the leading suspect for the current callback blocker — see [§13](#13-known-issues).)

## Identifiers that tie a flow together

- **Transaction ID (`transaction_id`).** A **UUID that stays constant across one entire order journey.** `search → select → init → confirm → status…` for the same shopping session all share **one** transaction_id. It is the join key that lets us correlate a later `on_search` callback back to the search that triggered it.

- **Message ID (`message_id`).** A **fresh UUID for each individual request/response pair.** Every single API call within a transaction gets its own message_id. Used for idempotency (detecting duplicate callbacks).

```
transaction_id = T1 ───────────────────────────────────────────► (whole journey)
   ├─ search    message_id = M1   → on_search   message_id = M1'
   ├─ select    message_id = M2   → on_select   message_id = M2'
   ├─ init      message_id = M3   → on_init     message_id = M3'
   └─ confirm   message_id = M4   → on_confirm  message_id = M4'
```

## The actions (what the BAP sends)

Each action is a request the BAP sends. Each returns **only a synchronous ACK or NACK** ("did you accept my request?") — the *actual data* arrives later as a **callback** (the `on_` version).

| Action | Plain meaning | Sent to |
| --- | --- | --- |
| **Search** | "Find me items matching X." Broadcast discovery. | Gateway |
| **Select** | "From seller S, I want these items — give me a firm quote (price + delivery)." | The chosen BPP |
| **Init** | "Here is my name/phone/address — draft the order." | The chosen BPP |
| **Confirm** | "Place the order." (Commits the finalized order.) | The chosen BPP |
| **Status** | "What's the current state of order O?" (read-only poll) | The chosen BPP |
| **Track** | "Give me a live tracking link/location for order O." | The chosen BPP |
| **Support** | "Give me a contact channel (phone/email) for this order." | The chosen BPP |
| **Rating** | "Here's my 1–5 rating for this seller/order." | The chosen BPP |
| **Update** | "Change something on order O (payment/fulfillment/item…)." | The chosen BPP |
| **Cancel** | "Cancel order O for reason R." | The chosen BPP |

## The callbacks (what the BAP receives)

For every action there is a matching **callback** the BPP POSTs back to OpenIdea's `bap_uri`:

| Callback | Carries | Stored as |
| --- | --- | --- |
| **on_search** | a `catalog` (providers + items) — arrives **N times**, once per responding seller | CatalogRecord |
| **on_select** | a firm `quote` | QuoteRecord |
| **on_init** | the draft order (firmed price) | OrderRecord (stage `init`) |
| **on_confirm** | the placed order + **BPP-assigned `order_id`** | OrderRecord (stage `confirm`) |
| **on_status** | current order state (appended to history) | OrderRecord (stage `status`) |
| **on_track** | a `tracking` object (URL / live location) | OrderRecord (`tracking` field) |
| **on_support** | contact channels (phone/email/uri) | SupportRecord (standalone) |
| **on_rating** | optional `feedback_form` + ack flags | RatingRecord (standalone) |
| **on_update** | the updated order | OrderRecord (stage `update`) |
| **on_cancel** | the cancelled order + `cancellation` block | OrderRecord (stage `cancel`) |

> **Key mental model:** every ONDC interaction is **two HTTP exchanges**. (1) BAP→network: "here's my request" → instant ACK/NACK. (2) network→BAP, later: "here's the actual answer" (the callback). The callback is a *separate inbound HTTP POST* that we must verify and persist.

## Settlement

**Settlement** = the money movement between participants after an order completes (who pays whom, how much, minus fees). In OpenIdea's current model, payment is **prepaid collection** into an Ecosysz bank account and reconciled **out-of-band** (a human or a bank-statement job marks payments PAID). There is **no live PSP/Razorpay integration** — see [§10](#10-payment-system).

## Callbacks — why "asynchronous"?

A buyer's search may reach hundreds of sellers. They don't all reply at once, and some never reply. So ONDC is **asynchronous**: the BAP fires a request, gets an instant ACK, and then **collects callbacks over a time window** (governed by `context.ttl`, e.g. `PT30S` = 30 seconds). There is no single "done" signal for search — the client aggregates whatever `on_search` callbacks arrive within the window.

---

# 3. OpenIdea ONDC Architecture

## End-to-end flow

```
  USER (browser)
     │  1. "search basmati rice"
     ▼
┌──────────────────────────────────────────────────────────┐
│  OpenIdea BAP  (Next.js app, webtemp/)                    │
│                                                            │
│  POST /api/ondc/search                                     │
│   ├─ buildContext("search")     → context envelope        │
│   ├─ buildSearchMessage()       → Beckn intent            │
│   └─ sendOndcRequest()          → sign (Ed25519) + POST    │
└───────────────┬────────────────────────────▲──────────────┘
                │ 2. signed /search           │ 6. ACK/NACK (instant)
                ▼                              │
        ┌──────────────┐                       │
        │ ONDC GATEWAY │  3. broadcast         │
        └───────┬──────┘                       │
                │                              │
     ┌──────────┼──────────┐                   │
     ▼          ▼          ▼                   │
 ┌───────┐ ┌───────┐ ┌───────┐                 │
 │ BPP 1 │ │ BPP 2 │ │ BPP N │  (seller apps)  │
 └───┬───┘ └───┬───┘ └───┬───┘                 │
     │         │         │                     │
     │ 4. each BPP POSTs on_search back to our bap_uri (async, N times)
     │         │         │                     │
     ▼         ▼         ▼                     │
┌──────────────────────────────────────────────┴───────────┐
│  OpenIdea BAP                                              │
│  POST /api/ondc/on_search   (one per seller)              │
│   ├─ verify signature (registry lookup of BPP key)        │
│   ├─ validate payload + context freshness                 │
│   ├─ saveCatalog()  → persistence                         │
│   └─ return ACK                                           │
└───────────────────────────────────────────────────────────┘
                │ 5. catalogs now stored, shown to USER
                ▼
  USER sees results → select → init → confirm → … (repeat the pattern)
```

## Sequence diagram — a single search

```
USER        BAP (OpenIdea)        GATEWAY        BPP(s)
 │   search     │                    │              │
 │─────────────►│                    │              │
 │              │  signed /search    │              │
 │              │───────────────────►│              │
 │              │     ACK            │              │
 │              │◄───────────────────│              │
 │  ACK+txnId   │                    │  broadcast   │
 │◄─────────────│                    │─────────────►│
 │              │                    │              │ (process)
 │              │   on_search (POST, signed)        │
 │              │◄──────────────────────────────────│
 │              │  verify+store+ACK                 │
 │              │──────────────────────────────────►│
 │              │   on_search (another seller)      │
 │              │◄──────────────────────────────────│
 │  poll/show   │                    │              │
 │◄─────────────│ (reconcile shows catalogs)        │
```

## Sequence diagram — placing an order (select → confirm)

```
USER        BAP (OpenIdea)                 BPP (chosen seller)
 │  select     │                              │
 │────────────►│  signed /select ────────────►│
 │             │◄──────────── ACK             │
 │             │◄──── on_select (quote) ──────│   saveQuote()
 │  init       │                              │
 │────────────►│  signed /init ──────────────►│
 │             │◄──────────── ACK             │
 │             │◄──── on_init (draft order) ──│   saveInitOrder()
 │  confirm    │                              │
 │────────────►│  signed /confirm ───────────►│
 │             │◄──────────── ACK             │
 │             │◄── on_confirm (order_id) ────│   saveConfirmOrder()
 │  order id   │                              │
 │◄────────────│                              │
```

## Key architectural rule

- **Search** is the *only* action sent to the **gateway** (broadcast). It carries **no** `bpp_id`/`bpp_uri`.
- **Every other action** is sent **directly to one BPP** and **must** carry `bpp_id`/`bpp_uri` (the frontend holds the on_search results and supplies the chosen seller's coordinates).
- **All** outbound actions reuse the **same `transaction_id`** the search minted.

---

# 4. Codebase Structure

All ONDC HTTP routes live under **`webtemp/src/app/api/ondc/`**. This is a Next.js App-Router project, so each folder with a `route.ts` is one HTTP endpoint. All routes set `runtime = "nodejs"` (ONDC signing needs `node:crypto`).

```
webtemp/src/app/api/ondc/
├── search/route.ts          # outbound actions (BAP → network)
├── select/route.ts
├── init/route.ts
├── confirm/route.ts
├── status/route.ts
├── track/route.ts
├── support/route.ts
├── rating/route.ts
├── update/route.ts
├── cancel/route.ts
│
├── on_search/route.ts       # callbacks (BPP → BAP)
├── on_select/route.ts
├── on_init/route.ts
├── on_confirm/route.ts
├── on_status/route.ts
├── on_track/route.ts
├── on_support/route.ts
├── on_rating/route.ts
├── on_update/route.ts
├── on_cancel/route.ts
├── on_subscribe/route.ts    # registry liveness challenge (encryption-key proof)
│
├── audit/route.ts           # GET — read the inbound-callback audit log
├── reconcile/route.ts       # GET — what data we hold for a transaction
├── observability/route.ts   # GET — summary + timeline + reconciliation
└── registry-status/route.ts # GET — raw registry lookup of our subscriber

webtemp/src/lib/ondc/        # shared library (signing, context, persistence, audit)
webtemp/src/lib/payments/    # payment ledger + bank-account config
webtemp/src/app/api/payments/# payment HTTP routes
```

## 4.1 Outbound action routes (BAP → network)

Every outbound route follows the **same shape**:

1. `isOndcConfigured()` guard → **503** if ONDC env vars not set.
2. Parse JSON body → **400** on malformed input or missing required field.
3. `buildContext(action, …)` → the `context` envelope (transaction_id, message_id, etc.).
4. Build the action-specific `message`.
5. `sendOndcRequest()` → serialize → **sign (Ed25519)** → POST → parse the ACK/NACK.
6. Return `{ status: "ACK"|"NACK", transactionId, messageId, … }`. **ACK → HTTP 200; NACK → HTTP 422.** Transport failure → **504** (timeout) / **502** (network).

| Route | Sends to | Message it builds | Required input | Notes |
| --- | --- | --- | --- | --- |
| **search** | `${gatewayUrl}/search` (or `targetUrl` override) | `buildSearchMessage()` → Beckn `intent` (item/category/delivery + **BAP finder fee** + **bap_terms** tags) | at least one of `query`/`category` | Broadcast; sends `Digest` header (Workbench requires it, else HTTP 428). `targetUrl` lets you probe one BPP/Workbench seller directly. |
| **select** | `${bppUri}/select` | `buildSelectMessage()` → `order` with provider + items | `transactionId`, `bppId`, `bppUri`, `providerId`, `items` | Returns firm quote via on_select. |
| **init** | `${bppUri}/init` | `buildInitMessage()` → `order` + **billing** (name+phone required) | + billing name & phone | Builds provider.locations from item locationIds. |
| **confirm** | `${bppUri}/confirm` | *no builder* — forwards the finalized on_init `order` opaquely | `order.provider.id`, non-empty `order.items`, `order.quote`, and `order.payments`/`payment` | Commits the order. BPP assigns `order_id` (arrives in on_confirm). |
| **status** | `${bppUri}/status` | `{ order_id }` | `orderId` | Read-only poll. |
| **track** | `${bppUri}/track` | `{ order_id }` | `orderId` | on_track carries tracking, **no order_id**. |
| **support** | `${bppUri}/support` | `{ ref_id }` | `refId` | Contact channels only. **Not** ONDC IGM (grievances). |
| **rating** | `${bppUri}/rating` | `parseRatings()` → `ratings[]` (`value` 1–5) | `ratings` | `rating_category` has no fixed enum; BPP may reject with error 50003. |
| **update** | `${bppUri}/update` | opaque `order` + `update_target` | `order.id`, `updateTarget` | `updateTarget` is BPP-specific. on_update may be unsolicited. |
| **cancel** | `${bppUri}/cancel` | `{ order_id, cancellation_reason_id, descriptor? }` | `orderId`, `cancellationReasonId` | on_cancel may be unsolicited (seller force-cancel). |

> **Important:** outbound routes do **not** persist anything themselves. They return ids; the data is persisted later when the matching **callback** arrives. (Exceptions: support/rating/update/cancel data lands via their callbacks too — no route writes synchronously.)

## 4.2 Callback routes (BPP → BAP)

Every `on_*` route follows the **same 6-phase lifecycle**:

1. **Read raw body bytes** (exact wire bytes — needed for signature verification).
2. **Verify signature**: `parseAuthorizationHeader()` → resolve the sender's public key from the registry (`resolveBppSigningPublicKey()`) → `verifyOndcSignature()` (Ed25519 over a BLAKE-512 body digest). Failure → **NACK 401 `INVALID_SIGNATURE`**.
3. **Parse + structurally validate** the JSON payload (`extractAndValidate()`): correct `action`, non-empty `transaction_id`/`message_id`/`bpp_id`/`bpp_uri`, the action-specific required field, and **signer's subscriber_id must equal `context.bpp_id`** (defense in depth on top of the signature). Also `validateContextFreshness()` (timestamp within ±5 min, TTL not expired).
4. **Idempotency check** (`peekMessageId()`): if this `(action, transaction_id, message_id)` was already seen, return ACK without re-persisting.
5. **Persist** via the matching `save*()` store function.
6. **Return ACK** (`{ message: { ack: { status: "ACK" } } }`, HTTP 200) — or **NACK** with an error envelope (400 bad payload / 401 auth / 500 store / 503 not configured).

Throughout, the route writes an **audit trace** (`beginAuditTrace` → `annotateTrace` → `finalizeAuditTrace`).

| Callback | Required payload field | Store function | Record |
| --- | --- | --- | --- |
| on_search | `message.catalog` (object); `context.city` present | `saveCatalog()` | CatalogRecord (key `txn|bpp|messageId`, accumulates) |
| on_select | `message.order.quote` | `saveQuote()` | QuoteRecord (key `txn|bpp`, last-write-wins) |
| on_init | `message.order.quote` | `saveInitOrder()` | OrderRecord stage `init` |
| on_confirm | `message.order.id` | `saveConfirmOrder()` | OrderRecord stage `confirm` (+ orderId index) |
| on_status | `message.order.id` | `saveStatusUpdate()` | OrderRecord stage `status` (+ statusHistory) |
| on_track | `message.tracking` | `saveTrackingUpdate()` | OrderRecord `tracking` (last-write-wins) |
| on_support | ≥1 of phone/email/uri | `saveSupport()` | SupportRecord (standalone) |
| on_rating | ≥1 of feedback_form/feedback_ack/rating_ack | `saveRating()` | RatingRecord (standalone) |
| on_update | `message.order.id` | `saveUpdateOrder()` | OrderRecord stage `update` |
| on_cancel | `message.order.id` | `saveCancelUpdate()` | OrderRecord stage `cancel` |

### on_subscribe (special)

`on_subscribe/route.ts` is **not** a transaction callback. It is the ONDC **registry liveness challenge**: the registry POSTs an AES-256-ECB-encrypted challenge string; we compute an X25519 ECDH shared secret (our encryption private key × the registry's encryption public key), decrypt the challenge, and return `{ answer: "<plaintext>" }`. This proves we hold the encryption private key paired with our registered public key.

## 4.3 Read-only diagnostic routes

| Route | Method | Purpose |
| --- | --- | --- |
| **audit** | GET | Returns recent inbound-callback wire traces (token-protected). See [§7](#7-audit-system). |
| **reconcile** | GET | "What do we hold for transaction X?" — per-BPP presence of catalog/quote/order/support/rating. See [§8](#8-reconciliation-system). |
| **observability** | GET | summary + timeline + reconciliation for a transaction. See [§9](#9-network-observability). |
| **registry-status** | GET | Raw ONDC registry lookup for our subscriber (or another). Used to diagnose the registry blocker. |

---

# Most Important Files For New Developers

If you only learn a handful of files first, learn these. They are the **primary debugging path** for almost every ONDC issue you'll hit — an outbound request that won't sign, a callback that NACKs, data that doesn't persist, or a transaction you need to inspect. Read them top-to-bottom in roughly this order.

| File | Purpose |
| --- | --- |
| `src/app/api/ondc/search/route.ts` | Search payload construction and gateway dispatch |
| `src/app/api/ondc/on_search/route.ts` | Callback validation and catalog persistence |
| `src/lib/ondc/auth.ts` | Signature parsing and verification (Ed25519 + BLAKE-512 digest) |
| `src/lib/ondc/registry.ts` | Registry key lookup (resolve a sender's signing public key) |
| `src/lib/ondc/context.ts` | Context generation (transaction_id, message_id, timestamps, TTL) |
| `src/lib/ondc/client.ts` | Signed outbound requests (serialize → sign → POST → parse ACK/NACK) |
| `src/lib/ondc/store.ts` | Persistence abstraction layer (dispatcher: JSON vs Postgres) |
| `src/lib/ondc/store-json.ts` | JSON persistence implementation |
| `src/lib/ondc/store-db.ts` | Postgres persistence implementation (Prisma) |
| `src/lib/ondc/audit.ts` | Audit logging (wire trace of every inbound callback) |
| `src/app/api/ondc/reconcile/route.ts` | Transaction state inspection (per-BPP data presence) |
| `src/app/api/ondc/observability/route.ts` | Transaction observability (summary + timeline + reconciliation) |
| `src/lib/payments/store-json.ts` | Payment ledger (PENDING/PAID records, deterministic references) |
| `src/lib/payments/config.ts` | Bank account configuration (Ecosysz collection account) |

Most ONDC bugs are diagnosed by walking this list: start at the relevant `route.ts`, follow it into the `src/lib/ondc/` helper it calls (`context.ts`/`client.ts`/`auth.ts`/`registry.ts`), and confirm what actually persisted via `store*.ts`, `reconcile`, and `observability`. If you can navigate these files confidently, you can debug the whole system.

---

# Environment Variables & Configuration

ONDC behavior is driven almost entirely by environment variables (loaded from `.env.local` in dev, and the Vercel project settings in prod). They are validated and memoized by `src/lib/ondc/config.ts` (`getOndcConfig()`); a route returns **503** when required vars are missing (`isOndcConfigured()` is false) and **500** when they're present but malformed.

> **Read this carefully:** **configuration errors are one of the most common causes of ONDC failures.** A single wrong key, a stale URL, or an apex-vs-www mismatch will produce signature failures, registry 404s, or 404'd callbacks that *look* like protocol bugs. When something breaks, check config **first**.

## Core identity & network

| Variable | What it does | Used by | What breaks if wrong |
| --- | --- | --- | --- |
| `ONDC_SUBSCRIBER_ID` | Our network identity (e.g. `openidea.co.in`). Must match what's registered in the ONDC registry. | `config.ts`, signing (`auth.ts` keyId), callback identity checks | Registry lookups of *us* fail; signatures we send carry a keyId no one can resolve → BPPs reject our requests. |
| `ONDC_SUBSCRIBER_URI` | Our public base URL the network is told to call back on. | `config.ts`, registry record | Callbacks routed to the wrong host. |
| `ONDC_BAP_ID` | The `context.bap_id` we stamp on every outbound action. Defaults to `ONDC_SUBSCRIBER_ID` if unset. | `context.ts` (every action) | BPPs/gateway reject our context; callbacks can't be matched back to us. |
| `ONDC_BAP_URI` | The `context.bap_uri` — the exact callback prefix BPPs POST `on_*` to. **Must be redirect-free and point at `/api/ondc`.** Defaults to subscriber URI if unset. | `context.ts` (every action) | **Every inbound callback 404s.** The known apex→www 307 redirect + `/ondc` vs `/api/ondc` path mismatch live here — see [§13.5](#135-production-ondc_bap_uri-env-var). |
| `ONDC_REGISTRY_BASE_URL` | Overrides the registry base URL (otherwise a per-environment default, e.g. `https://preprod.registry.ondc.org/v2.0`). | `registry.ts`, `registry-diagnostics.ts` | Registry key-resolution fails (404/connection error) → inbound callbacks NACK 401 before processing. A **stale override is a prime suspect** for the registry blocker. |
| `ONDC_GATEWAY_URL` | Overrides the gateway URL (otherwise a per-environment default). Search is POSTed to `${gatewayUrl}/search`. | `search/route.ts`, `client.ts` | Searches don't reach the network (ACK failures / transport errors). |

## Keys & signing

| Variable | What it does | Used by | What breaks if wrong |
| --- | --- | --- | --- |
| `ONDC_PRIVATE_KEY` | Our **Ed25519 signing private key** (seed, base64). Signs every outbound request. *(In `config.ts` this is `ONDC_SIGNING_PRIVATE_KEY`, plus a separate `ONDC_ENCRYPTION_PRIVATE_KEY` for the on_subscribe challenge.)* | `auth.ts` (`signRequest`), `on_subscribe` (encryption key) | Every outbound request fails to sign or is rejected as an invalid signature; the on_subscribe challenge can't be decrypted. |
| `ONDC_PUBLIC_KEY` | Our **Ed25519 signing public key** (base64), the one registered with ONDC. *(In `config.ts`: `ONDC_SIGNING_PUBLIC_KEY` + `ONDC_ENCRYPTION_PUBLIC_KEY`.)* | `config.ts`, registry record | If it doesn't match the registered key, BPPs verify our signature against the wrong key and reject everything. |
| `ONDC_UNIQUE_KEY_ID` | The `unique_key_id` (ukId) that tells the registry **which** of our key pairs is in use (e.g. `37defd68-…`). Embedded in the signature keyId. | `auth.ts` (keyId), registry lookups | Signature keyId points at a non-existent key → counterparties can't resolve it → rejected. |

## Persistence, audit & storage

| Variable | What it does | Used by | What breaks if wrong |
| --- | --- | --- | --- |
| `DATABASE_URL` | Postgres connection string. **Its presence at module load decides the backend:** set → Postgres (`store-db.ts`); unset → JSON (`store-json.ts`). | `store.ts` dispatcher, Prisma | A wrong/unreachable URL → store writes throw `OndcStoreError` → callbacks NACK 500. Unset is *valid* (JSON fallback). Changing it requires a restart. |
| `ONDC_AUDIT_TOKEN` | Bearer/`?token=` secret guarding `GET /api/ondc/audit`. | `audit/route.ts` | Unset → audit endpoint returns **503**; wrong value supplied by caller → **401**. Does not affect transactions, only your ability to read the wire log. |
| `BLOB_READ_WRITE_TOKEN` | Enables Vercel Blob durability for the JSON store + audit log (persistent snapshots instead of ephemeral `/tmp`). | `store-json.ts`, `audit.ts`, payments `store-json.ts` | Unset on Vercel → snapshots live in `/tmp` and are **lost between invocations** (data appears to vanish). Locally, irrelevant (file on disk). |

> **Tip:** `GET /api/ondc/registry-status` is the fastest way to confirm identity/registry config is consistent with what ONDC holds. Run it before assuming a code bug.

---

# 5. Persistence Layer

The persistence layer lives in **`webtemp/src/lib/ondc/`** and is **dual-backend**: a JSON-snapshot store (default / fallback) and a Postgres store (when `DATABASE_URL` is set).

```
store-types.ts   →  the record + input type definitions (shared by both backends)
store.ts         →  dispatcher: picks JSON or DB backend at module load
store-json.ts    →  JSON-snapshot backend (in-memory Maps + write-through file/Blob)
store-db.ts      →  Postgres backend via Prisma
```

## 5.1 `store.ts` — the dispatcher

`store.ts` exports the public API (`saveCatalog`, `saveQuote`, `saveInitOrder`, `getCatalogs`, `getOrder`, …). At module load it checks `isDatabaseConfigured()`:

- **`DATABASE_URL` set** → all calls route to `store-db.ts` (Postgres/Prisma).
- **otherwise** → all calls route to `store-json.ts` (JSON snapshot).

Both backends implement **identical signatures**, so the rest of the app never knows which is active.

```
Writes: saveCatalog, saveQuote, saveInitOrder, saveConfirmOrder, saveStatusUpdate,
        saveTrackingUpdate, saveCancelUpdate, saveUpdateOrder, saveSupport, saveRating
Reads:  getCatalogs(txn), getQuote(txn,bpp), getOrder(txn,bpp), getOrderById(orderId),
        getSupport(txn,bpp), getRating(txn,bpp)
```

## 5.2 `store-types.ts` — the records

```ts
type CatalogRecord = {
  transactionId: string; bppId: string; bppUri: string; messageId: string;
  catalog: unknown;          // opaque ONDC catalog
  receivedAt: number;        // Date.now() on receipt
};

type QuoteRecord = {
  transactionId; bppId; bppUri; messageId;
  quote: unknown; fulfillments: unknown; receivedAt: number;
};

type OrderRecord = {
  transactionId; bppId; bppUri;
  orderId?: string;          // BPP-assigned, set on confirm
  state?: unknown;
  order: unknown; quote: unknown; payments?: unknown; fulfillments: unknown;
  tracking?: unknown; cancellation?: unknown;
  stage: "init"|"confirm"|"status"|"track"|"cancel"|"update";  // last callback that touched it
  messageId: string;
  statusHistory: { state: unknown; messageId: string; at: number }[];  // append-only
  createdAt: number; updatedAt: number;
};

type SupportRecord = {
  transactionId; bppId; bppUri; messageId;
  phone?; email?; uri?; refId?; support: unknown; receivedAt: number;
};

type RatingRecord = {
  transactionId; bppId; bppUri; messageId;
  feedbackForm?; feedbackFormUrl?; feedbackFormMimeType?;
  feedbackRequired?; feedbackAck?; ratingAck?;
  feedback: unknown; receivedAt: number;
};
```

> All ONDC payloads are stored as **opaque `unknown`** (Json columns in Postgres). This means protocol changes rarely require a schema migration.

`OndcStoreError` is thrown on any persistence failure; callback routes catch it and **NACK 500** — a callback is never silently dropped.

## 5.3 `store-json.ts` — the JSON backend

In-memory `Map`s with **write-through** durability to a JSON snapshot:

| Environment | Snapshot location |
| --- | --- |
| Local dev | `data/ondc/store.json` (persists across restarts) |
| Vercel (no Blob) | `/tmp/ondc/store.json` (ephemeral per invocation) |
| Prod + Blob (`BLOB_READ_WRITE_TOKEN` set) | `system/ondc/store.json` via Vercel Blob (persistent) |

Snapshot shape: `{ version: 3, catalogs[], quotes[], orders[], supports[], ratings[] }`. Concurrent writes are serialized via a `writeQueue` promise (last-write-wins).

## 5.4 `store-db.ts` — the Postgres backend (Prisma)

Four tables (`prisma/schema.prisma`):

| Table | Holds |
| --- | --- |
| `ondc_search` | one row per transaction (FK parent for everything else) |
| `ondc_search_result` | catalog slices (append-only; unique `txn+bpp+messageId`) |
| `ondc_order` | the order lifecycle (unique `txn+bpp`; `orderId` unique; `statusHistory` Json) |
| `ondc_event` | flex bucket for quotes/supports/ratings, distinguished by `kind` |

Every Prisma call is wrapped in a `run(label, fn)` helper that converts SQL errors to `OndcStoreError`.

## 5.5 How data moves through the lifecycle (worked example)

```
1. search        → (nothing persisted; transaction_id minted)
2. on_search ×3  → saveCatalog() ×3   → 3 CatalogRecords (one per BPP)
3. select        → (nothing)
4. on_select     → saveQuote()        → QuoteRecord for the chosen BPP
5. init          → (nothing)
6. on_init       → saveInitOrder()    → OrderRecord stage="init"
7. confirm       → (nothing)
8. on_confirm    → saveConfirmOrder() → OrderRecord stage="confirm", orderId set,
                                         registered in orderIndex (orderId → txn|bpp)
9. status        → (nothing)
10. on_status    → saveStatusUpdate() → same OrderRecord, stage="status",
                                         snapshot appended to statusHistory[]
11. on_track     → saveTrackingUpdate→ same OrderRecord, tracking field refreshed
12. on_cancel    → saveCancelUpdate() → cancellation block set, terminal "Cancelled"
                                         milestone appended to statusHistory[]
```

**Merge-forward rule:** an OrderRecord is *progressively enriched*. If a later callback doesn't restate a field (e.g. on_track doesn't carry the quote), the prior value is **preserved**. This makes the store resilient to **out-of-order** callbacks (e.g. on_status arriving before on_confirm).

---

# 6. Callback Processing

This is the security-critical inbound path. Every `on_*` route runs the same pipeline. The shared helpers live in `webtemp/src/lib/ondc/`.

## 6.1 How signatures are verified

ONDC uses the **IETF "Signing HTTP Messages"** profile with Ed25519. The sender signs a 3-line string:

```
(created): <epoch-seconds>
(expires): <epoch-seconds>
digest: BLAKE-512=<base64 of BLAKE2b-512(raw body)>
```

and packs the signature into an `Authorization` header:

```
Signature keyId="<subscriber_id>|<unique_key_id>|ed25519",algorithm="ed25519",
  created="…",expires="…",headers="(created) (expires) digest",signature="<base64>"
```

Verification (`auth.ts`):

1. **`parseAuthorizationHeader(header)`** → extract `subscriberId`, `uniqueKeyId`, `created`, `expires`, `signature`. Tolerant parser → `null` on any structural problem.
2. **`resolveBppSigningPublicKey(subscriberId, uniqueKeyId, city?)`** (`registry.ts`) → look up the sender's **signing public key** in the ONDC registry. *(This lookup is the leading suspect for the current callback blocker — see [§13](#13-known-issues).)*
3. **`verifyOndcSignature({ rawBody, parsed, publicKey, now, clockSkewSeconds })`** → checks the freshness window (`created ≤ now ≤ expires + 5s skew`), **recomputes the BLAKE-512 digest from the exact raw bytes**, rebuilds the signing string, and Ed25519-verifies. Returns `{ valid: true }` or `{ valid: false, reason }`.

> **Why raw bytes matter:** the digest is computed over the *exact* bytes received. If you `JSON.parse` then `JSON.stringify`, key ordering/whitespace changes and the digest will mismatch. The routes deliberately read `await req.text()` first.

## 6.2 How payloads are validated

After the signature passes, `extractAndValidate()` enforces:

- `context.action` matches the route (e.g. `"on_search"`).
- `transaction_id`, `message_id`, `bpp_id`, `bpp_uri` are non-empty.
- The **action-specific required field** is present and object-shaped (see the table in [§4.2](#42-callback-routes-bpp--bap)).
- **`signer.subscriberId === context.bpp_id`** — the entity that signed must be the entity claiming to be the BPP. (Defense in depth: even a valid signature from the *wrong* party is rejected.)
- For on_search, `context.bap_id`/`bap_uri`/`domain` match **our** configured identity.
- `validateContextFreshness()` — timestamp within ±5 minutes; TTL not expired.

## 6.3 How records are stored

On success, the matching `save*()` function persists the record (see [§5](#5-persistence-layer)). An **idempotency guard** (`peekMessageId` / `commitMessageId` in `idempotency.ts`) skips re-persisting a callback we've already processed (same `action+txn+messageId`).

## 6.4 How ACK / NACK responses work

Both are the same envelope shape; only `status` and the optional `error` differ:

```jsonc
// ACK (HTTP 200)
{ "message": { "ack": { "status": "ACK" } } }

// NACK (HTTP 400/401/500/503)
{ "message": { "ack": { "status": "NACK" } },
  "error": { "code": "INVALID_SIGNATURE", "message": "…" } }
```

Status-code mapping: **400** bad payload, **401** auth failure, **500** config/store error, **503** ONDC not configured. There is also a **negative cache**: a rejected request (by Authorization header) replays its NACK for ~5 minutes without re-verifying — so a misbehaving sender can't hammer the registry.

---

# 7. Audit System

**File:** `webtemp/src/lib/ondc/audit.ts`. **Route:** `GET /api/ondc/audit`.

The audit system records a **wire trace of every inbound callback** — the raw body, the request headers (including `Authorization`), the response, latency, and ACK/NACK outcome. It is the **first place you look** when a callback misbehaves.

## 7.1 Types

```ts
type AuditEvent = {
  ts: string;                 // ISO-8601 receive time
  action: string;             // "on_search", "on_confirm", …
  durationMs: number;         // receive-to-respond latency
  requestHeaders: Record<string,string>;  // includes Authorization
  rawBody: string;            // exact wire bytes received
  transactionId?: string; messageId?: string; bppId?: string;
  responseStatus: number;     // HTTP status we returned
  responseBody: unknown;      // the ACK/NACK envelope
  ackStatus?: "ACK" | "NACK";
  errorCode?: string;
};

type AuditTrace = {           // the in-flight handle while a handler runs
  action: string; startedAt: number;
  requestHeaders; rawBody; transactionId?; messageId?; bppId?;
};
```

## 7.2 Lifecycle (called inside each on_* route)

```
beginAuditTrace({ action, requestHeaders })     // at handler entry
   → annotateTrace(trace, { rawBody, transactionId, messageId, bppId })  // as IDs resolve
   → finalizeAuditTrace(trace, { status, body })  // when responding (fire-and-forget;
                                                   //  a write failure never NACKs)
```

Storage: an **in-memory ring of the 2000 most-recent events**, backed by a JSONL file (dev) or Vercel Blob (prod). Reads via `readAuditEvents({ transactionId?, action?, limit? })` — most-recent-first.

## 7.3 What gets logged / how to debug

- **What:** every inbound callback's full request + response.
- **Debugging a failed callback:** call `GET /api/ondc/audit?token=…&txn=<id>` and read the `ackStatus`/`errorCode`/`responseBody` of the failing event. The `rawBody` and `requestHeaders` let you reproduce the exact signature input.
- **Auth required:** `?token=<X>` or `Authorization: Bearer <X>`, compared (timing-safe) to `process.env.ONDC_AUDIT_TOKEN`. **401** if missing/wrong, **503** if the env var isn't set.

### Example call

```powershell
curl "http://localhost:3000/api/ondc/audit?token=$env:ONDC_AUDIT_TOKEN&txn=<transactionId>&limit=20" | ConvertFrom-Json
```

Response (abridged):

```json
{
  "count": 2,
  "filter": { "transactionId": "txn-abc", "action": null, "limit": 20 },
  "events": [
    {
      "ts": "2026-06-16T14:05:30Z",
      "action": "on_confirm",
      "durationMs": 38,
      "ackStatus": "ACK",
      "responseStatus": 200,
      "bppId": "seller-1.example.com",
      "errorCode": null,
      "requestHeaders": { "authorization": "Signature keyId=\"…\"" },
      "rawBody": "{\"context\":{…},\"message\":{…}}",
      "responseBody": { "message": { "ack": { "status": "ACK" } } }
    }
  ]
}
```

---

# 8. Reconciliation System

**Route:** `GET /api/ondc/reconcile?transactionId=<id>` (`reconcile/route.ts`).

Reconciliation answers a single question: **"For this transaction, what data do we actually hold, per seller?"** It is a pure **read/projection** over the store — no writes.

For the transaction it: fetches all catalogs, collapses them by `bppId`, and for each unique BPP reads `getQuote`, `getOrder`, `getSupport`, `getRating` in parallel — reporting **presence (boolean)** of each, plus the order's current `stage`.

## Example response

```json
{
  "transactionId": "txn-abc123",
  "catalogCount": 3,
  "bpps": [
    {
      "bppId": "seller-1.example.com",
      "bppUri": "https://seller1.example/ondc",
      "catalog": true,
      "quote": true,
      "order": true,
      "orderStage": "confirm",
      "support": false,
      "rating": false
    },
    {
      "bppId": "seller-2.example.com",
      "bppUri": "https://seller2.example/ondc",
      "catalog": true,
      "quote": false,
      "order": false,
      "orderStage": null,
      "support": false,
      "rating": false
    }
  ]
}
```

## How it helps debugging

- **"My select got an ACK but I see no quote"** → reconcile shows `quote: false` for that BPP → the `on_select` callback never arrived (or got NACK'd — confirm via the audit log).
- **"Where is my order stuck?"** → `orderStage` tells you the last callback that touched it (`init` means on_confirm hasn't landed yet).
- **"Did anyone even respond to my search?"** → `catalogCount` and the `bpps[]` list.

---

# 9. Network Observability

**Route:** `GET /api/ondc/observability?transactionId=<id>` (`observability/route.ts`).

Observability is the **one-stop dashboard for a transaction**. It combines three things:

1. **Summary** — total events, ACK count, NACK count, last action, last-seen time.
2. **Timeline** — every audited callback for the transaction, sorted **oldest → newest** (a lossy view of the audit log: ts, action, durationMs, ackStatus, responseStatus, bppId, errorCode).
3. **Reconciliation** — the exact same projection as `/reconcile` (what data we hold per BPP).

It reads the audit log (`readAuditEvents`) + the store; pure projection, no writes.

## Example response

```json
{
  "transactionId": "txn-abc123",
  "summary": {
    "totalEvents": 5,
    "acks": 4,
    "nacks": 1,
    "lastAction": "on_confirm",
    "lastSeenAt": "2026-06-16T14:05:30Z"
  },
  "timeline": [
    { "ts": "2026-06-16T14:01:15Z", "action": "on_search",  "durationMs": 45, "ackStatus": "ACK",  "responseStatus": 200, "bppId": "seller-1" },
    { "ts": "2026-06-16T14:02:50Z", "action": "on_select",  "durationMs": 30, "ackStatus": "NACK", "responseStatus": 400, "bppId": "seller-1", "errorCode": "CONTEXT_GENERIC" },
    { "ts": "2026-06-16T14:03:40Z", "action": "on_init",    "durationMs": 28, "ackStatus": "ACK",  "responseStatus": 200, "bppId": "seller-1" },
    { "ts": "2026-06-16T14:05:30Z", "action": "on_confirm", "durationMs": 38, "ackStatus": "ACK",  "responseStatus": 200, "bppId": "seller-1" }
  ],
  "reconciliation": {
    "transactionId": "txn-abc123",
    "catalogCount": 3,
    "bpps": [ /* same shape as /reconcile */ ]
  }
}
```

## How to investigate a transaction issue

```
1. GET /api/ondc/observability?transactionId=<id>
2. Read summary.nacks — any NACKs?  → look in timeline for the red entry + errorCode.
3. Read the timeline order — did the expected callbacks arrive, and in order?
4. Read reconciliation — is the data actually persisted per BPP?
5. Need the raw bytes / headers of a failing entry?
   → GET /api/ondc/audit?token=…&txn=<id>  (full wire trace)
```

---

# 10. Payment System

**Code:** `webtemp/src/lib/payments/` (config + store) and `webtemp/src/app/api/payments/` (routes).

## 10.1 What this is (and is NOT)

OpenIdea's payment model is **prepaid collection into an Ecosysz bank account**, reconciled **out-of-band**. This system is a **ledger**, not a payment gateway:

- It **creates** a PENDING payment record per transaction.
- It assigns each a **deterministic `paymentReference`** the buyer quotes when paying.
- It serves **bank-account instructions** for manual payment.
- It **records settlement** when someone (ops console / bank-statement job / webhook) marks it PAID.

> **There is no Razorpay / PSP integration and no automatic bank polling in this codebase.** Settlement is entered manually via the `/verify` or `/reconcile` endpoints.

## 10.2 `config.ts` — Ecosysz bank account (the only remaining config)

**File:** `webtemp/src/lib/payments/config.ts`

```ts
export const PAYMENT_CONFIG = {
  accountName: "",   // registered name on the Ecosysz collection account
  accountNumber: "", // Ecosysz bank account number
  ifsc: "",          // branch IFSC for NEFT/IMPS/RTGS
  upiId: "",         // Ecosysz UPI VPA (e.g. ecosysz@bank)
  qrCodeUrl: "",     // URL of a pre-made UPI QR image
};
```

> ⚠️ **All five fields are currently empty strings.** The system is otherwise complete — the **only** remaining payment work is filling in the **real Ecosysz bank account values**. Until then, `/api/payments/instructions` returns blanks and a buyer has no destination account.

## 10.3 `store-json.ts` — the payment ledger

**File:** `webtemp/src/lib/payments/store-json.ts`. Same pattern as the ONDC JSON store (in-memory `Map<transactionId, PaymentRecord>` + write-through snapshot at `data/payments/store.json` / `/tmp/payments/store.json` / `system/payments/store.json`).

```ts
type PaymentRecord = {
  transactionId: string;
  orderId?: string;            // BPP order id, enriched after confirm
  amount?: number;
  paymentReference: string;    // "PAY-<16-hex>", deterministic from transactionId
  status: "PENDING" | "PAID";
  bankReference?: string;      // settlement ref (UTR/RRN), set on verify
  createdAt: number; updatedAt: number;
  verifiedAt?: number;         // WRITE-ONCE: stamped on first → PAID
};
```

Key functions:

- `paymentReferenceFor(txn)` → `PAY-` + first 16 hex of SHA-256(txn), uppercase. **Deterministic** → makes create idempotent.
- `createPayment({ transactionId, orderId?, amount? })` → creates PENDING **or returns existing unchanged**; never resets a PAID record; enriches missing orderId/amount only.
- `updatePaymentStatus({ transactionId, status, bankReference? })` → flips status + records bankReference; **`null`** if the payment was never created; stamps `verifiedAt` **only on the first** PAID transition.
- `getPayment(txn)` / `getPaymentByReference(ref)` (linear scan, since the reference is a one-way hash).

## 10.4 The five payment routes

| Route | Method | Input | Does | Output |
| --- | --- | --- | --- | --- |
| **/api/payments/create** | POST | `{ transactionId, orderId?, amount? }` | Create/return a PENDING payment; mint deterministic `paymentReference`. **Idempotent.** | `{ transactionId, paymentReference, status }` |
| **/api/payments/status** | GET | `?transactionId=` | Read the full record. **404** if never created. | full `PaymentRecord` |
| **/api/payments/instructions** | GET | `?transactionId=` | Join the record (reference+amount) with `PAYMENT_CONFIG` bank details. **404** if never created. | `{ transactionId, paymentReference, amount?, accountName, accountNumber, ifsc, upiId, qrCodeUrl }` |
| **/api/payments/verify** | POST | `{ transactionId, status, bankReference? }` | Out-of-band settlement **by transactionId**. **404** if unknown. Write-once `verifiedAt`. | updated `PaymentRecord` |
| **/api/payments/reconcile** | POST | `{ paymentReference, status, bankReference? }` | Same settlement logic but keyed **by paymentReference** (what a bank statement line carries). **404** if no match. | updated `PaymentRecord` |

## 10.5 Key concepts

- **`paymentReference`** — `PAY-<16-hex>`, deterministic hash of the transaction id. The buyer quotes it to the bank; `/reconcile` resolves a bank-statement line back to the payment via this reference.
- **`verifiedAt`** — write-once timestamp pinning the **first** moment a payment became PAID (audit integrity — distinct from `updatedAt`, which moves on every mutation).
- **Transaction mapping** — two settlement entry points: `/verify` when you know the internal `transactionId`; `/reconcile` when you only have the `paymentReference` from a bank statement.

---

# 11. Workbench & Testing

> **Workbench** = ONDC's official test harness that pretends to be a seller/gateway and probes your BAP for protocol compliance (method gating, required fields, signature handling, ACK/NACK shape). Passing it is a prerequisite for certification.

## 11.1 Run locally

```powershell
# from webtemp/
npm install          # first time (see §13 re: Prisma)
npm run dev          # starts Next.js on http://localhost:3000
```

Make sure ONDC env vars are loaded (`.env.local`) so the configured code paths run (otherwise routes return 503).

## 11.2 Trigger a Search (PowerShell)

```powershell
$body = @{
  query            = "basmati rice"
  deliveryAreaCode = "560001"
} | ConvertTo-Json

Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/api/ondc/search" `
  -ContentType "application/json" `
  -Body $body
# → { status = "ACK"; transactionId = "…"; messageId = "…" }
```

Probe a **specific** BPP/Workbench seller directly (bypass the gateway):

```powershell
$body = @{
  query     = "rice"
  targetUrl = "https://workbench.ondc.tech/api-service/ONDC:RET10/1.2.5/seller/search"
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/ondc/search" -ContentType "application/json" -Body $body
```

Save the returned `transactionId` — you'll use it for every downstream call and for reconcile/observability.

## 11.3 Inspect logs

The routes log richly to the dev server console (`ondc.search ENTER`, `ondc.search dispatch`, `ondc.search payload`, `ondc.on_search persisted`, etc.). Watch the terminal running `npm run dev`. Note: the search route currently prints a temporary `DEBUG` block exposing the outbound URL and any Workbench rejection body (handy for the 428/404 debugging).

## 11.4 Test callbacks

You cannot easily forge a *valid* signed callback locally (you'd need a key that resolves through the real registry). Two practical paths:

- **Negative paths** are covered by the suite (`npm run test:ondc`) — missing/malformed signature, wrong signer, unknown ukId all return the right NACK.
- **Positive paths** require a real BPP/Workbench run against the **deployed** BAP with `ONDC_BAP_URI` set. That's the pending external work.

## 11.5 Use reconciliation & observability

```powershell
# After a flow, see what landed:
Invoke-RestMethod "http://localhost:3000/api/ondc/reconcile?transactionId=<id>"
Invoke-RestMethod "http://localhost:3000/api/ondc/observability?transactionId=<id>"

# Full wire trace of inbound callbacks (token required):
Invoke-RestMethod "http://localhost:3000/api/ondc/audit?token=$env:ONDC_AUDIT_TOKEN&txn=<id>"

# Is our registry record healthy? (diagnoses the suspected registry blocker)
Invoke-RestMethod "http://localhost:3000/api/ondc/registry-status" | ConvertTo-Json -Depth 6
```

## 11.6 Compliance suite

A black-box harness (`scripts/ondc-test-suite.mjs`, run via `npm run test:ondc`) exercises the same surfaces Workbench probes across all 21 routes. As of the last run (2026-06-06) it was **259/259 pass on both local and prod**. It covers every **negative** branch; it does **not** cover positive `on_*` callback paths, real gateway ACKs, or end-to-end stitching — those need the live network.

```powershell
npm run test:ondc                                   # against localhost
node scripts/ondc-test-suite.mjs --base-url=https://www.openidea.co.in
node scripts/ondc-test-suite.mjs --format=json > results.json
```

---

# End-to-End Search Debugging Playbook

This is the **runbook** to follow whenever "search isn't working" or "catalogs aren't showing up." Work the steps **in order** — each one narrows the problem. For every step: what *success* looks like, what *failure* looks like, and where to look next.

### 1. Trigger search

```powershell
$body = @{ query = "basmati rice"; deliveryAreaCode = "560001" } | ConvertTo-Json
$r = Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/ondc/search" -ContentType "application/json" -Body $body
```

- **Success:** the call returns a JSON object (not an exception).
- **Failure:** connection refused → dev server isn't running (`npm run dev`). HTTP 503 → ONDC env vars not loaded.
- **Next:** if 503, fix `.env.local` (see [Environment Variables](#environment-variables--configuration)); otherwise go to step 2.

### 2. Capture transaction_id

```powershell
$txn = $r.transactionId; $txn
```

- **Success:** a UUID is printed. **This is your join key for every later step.**
- **Failure:** `transactionId` is null/empty → the route errored before minting context (check the response `error` field and server logs).
- **Next:** step 3.

### 3. Confirm ACK

- **Success:** `$r.status -eq "ACK"` → the gateway/Workbench **accepted** the search. Catalogs will arrive *later* via `on_search`.
- **Failure:** `status = "NACK"` (HTTP 422) → the gateway rejected the request itself; read `$r.error`. HTTP 504 = timeout, 502 = network/transport, 500 = signing/config fault.
- **Next:** NACK/4xx/5xx → step 4 (read logs) and inspect `src/app/api/ondc/search/route.ts` + `src/lib/ondc/client.ts`. ACK → step 4 to watch for callbacks.

### 4. Inspect server logs

Watch the `npm run dev` terminal.

- **Success:** you see `ondc.search ENTER` → `ondc.search dispatch` → `ondc.search payload` → `ondc.search result {status: ACK}`. Later, when a callback lands: `ondc.on_search persisted`.
- **Failure:** `ondc.search client error` (transport) or a thrown fault (signing/config). **Absence** of `ondc.on_search persisted` means no callback was successfully processed.
- **Next:** signing/transport errors → `src/lib/ondc/auth.ts` / `client.ts`. No callback → steps 5–9.

### 5. Check observability endpoint

```powershell
Invoke-RestMethod "http://localhost:3000/api/ondc/observability?transactionId=$txn" | ConvertTo-Json -Depth 6
```

- **Success:** `summary.totalEvents > 0` and a `timeline` with `on_search` entries showing `ackStatus: ACK`.
- **Failure:** `totalEvents: 0` → no callback ever reached us. Any `nacks > 0` → a callback arrived but was rejected (note the `errorCode`).
- **Next:** NACKs → step 7 (audit) for the full wire trace. Zero events → steps 8–9 (did the callback ever arrive?).

### 6. Check reconciliation endpoint

```powershell
Invoke-RestMethod "http://localhost:3000/api/ondc/reconcile?transactionId=$txn" | ConvertTo-Json -Depth 6
```

- **Success:** `catalogCount > 0` and `bpps[]` list sellers with `catalog: true`.
- **Failure:** `catalogCount: 0` with empty `bpps` → nothing persisted (consistent with "no callback processed").
- **Next:** if observability showed ACKed events but reconcile shows nothing, suspect a **persistence** problem → step 10. Otherwise step 7.

### 7. Check audit endpoint

```powershell
Invoke-RestMethod "http://localhost:3000/api/ondc/audit?token=$env:ONDC_AUDIT_TOKEN&txn=$txn" | ConvertTo-Json -Depth 6
```

- **Success:** events appear with `requestHeaders`, `rawBody`, `ackStatus`, `errorCode`. This is the **exact wire trace** — the ground truth for any signature/validation failure.
- **Failure:** empty list → no callback reached the handler at all (it's an arrival problem, not a processing one). HTTP 503 → `ONDC_AUDIT_TOKEN` not set; 401 → wrong token.
- **Next:** a NACK with `INVALID_KEY`/`INVALID_SIGNATURE` → step 8 (registry). Empty → step 8/9 (arrival/`bap_uri`).

### 8. Check registry-status endpoint

```powershell
Invoke-RestMethod "http://localhost:3000/api/ondc/registry-status" | ConvertTo-Json -Depth 6
```

- **Success:** `httpStatus: 200` with our subscriber record (`SUBSCRIBED`, valid key window) returned.
- **Failure:** `httpStatus: 404/403` or a transport error → registry key-resolution is the **leading suspect** (see [§13.1](#131-no-on_search-callback-currently-observed-from-workbench)). Capture the raw body/headers.
- **Next:** confirm `ONDC_REGISTRY_BASE_URL` isn't a stale override; if the registry genuinely 404s for senders, this is the external blocker — escalate to ONDC.

### 9. Verify callback arrival

Confirm a callback physically reached the deployed BAP at the advertised `bap_uri`.

- **Success:** the audit log (step 7) or Vercel runtime logs show an inbound `POST /api/ondc/on_search`.
- **Failure:** nothing inbound → BPPs are POSTing to the wrong URL. Check `context.bap_uri` on your outbound search and the registry's `subscriber_url`. The classic causes: apex→www 307 redirect and `/ondc` vs `/api/ondc` path ([§13.5](#135-production-ondc_bap_uri-env-var)).
- **Next:** fix `ONDC_BAP_URI` (and the registry record) → re-run from step 1.

### 10. Verify persistence

If callbacks ACK but data isn't queryable, isolate the store.

- **Success:** `reconcile`/`observability` reflect the catalogs; `data/ondc/store.json` (dev) or the Postgres tables contain the records.
- **Failure:** ACKed callbacks but empty store → on Vercel, `BLOB_READ_WRITE_TOKEN` unset means `/tmp` snapshots vanish between invocations; or `DATABASE_URL` points at an unreachable DB (writes throw `OndcStoreError` → NACK 500).
- **Next:** inspect `src/lib/ondc/store.ts` (which backend is active?), then `store-json.ts` / `store-db.ts`. Confirm the storage env vars.

> **Rule of thumb:** ACK proves *we sent it*; `observability`/`reconcile` prove *we received and stored the answer*; `audit` proves *what exactly came in*; `registry-status` proves *whether we can verify who sent it*. Walk them in that order and the failure localizes itself.

---

# Current Development Timeline

A snapshot of where the project stands, grouped by state. (For the granular per-module table, see [§12](#12-current-project-status).)

## Completed

- **Subscriber registration** — OpenIdea is registered as a Buyer NP in ONDC pre-prod (`openidea.co.in`, `SUBSCRIBED`).
- **Search implementation** — outbound `/search` builds the intent (+ finder fee + bap_terms) and dispatches to the gateway; synchronous ACK works.
- **Transaction APIs** — all 10 outbound actions (search/select/init/confirm/status/track/support/rating/update/cancel) implemented.
- **Callback APIs** — all 10 `on_*` callbacks + `on_subscribe` implemented (validation, persistence, ACK/NACK).
- **Signature verification** — Ed25519 + BLAKE-512 signing on outbound; full inbound verification with registry key resolution.
- **Persistence layer** — dual-backend (JSON snapshot + Postgres/Prisma) behind one dispatcher.
- **Audit logging** — wire trace of every inbound callback (in-memory ring + JSONL/Blob).
- **Reconciliation** — per-transaction, per-BPP data-presence projection.
- **Network observability (implementation)** — summary + timeline + reconciliation endpoint.
- **Payment ledger (implementation)** — PENDING/PAID records, deterministic references, write-once settlement, five routes.

## In Progress

- **Network observability validation** — the endpoint is built; exercising it against real multi-BPP traffic still needs live callbacks.
- **Payment configuration** — ledger is complete; the Ecosysz bank account values still need to be filled into `config.ts`.
- **Workbench callback validation** — black-box negative suite is green; positive/live callback validation is outstanding.
- **ONDC tag clarification** — confirming the exact `bap_terms` tag structure/values with ONDC.

## Blocked / External Dependencies

- **Registry callback validation** — positive callback processing appears blocked by registry key-resolution; needs ONDC-side confirmation (see [§13.1](#131-no-on_search-callback-currently-observed-from-workbench)).
- **ONDC confirmation on BAP terms tags** — awaiting ONDC guidance on the required tag contract.
- **Workbench end-to-end callback testing** — needs the registry path cleared and the deployed `bap_uri` correct.

## Upcoming

- **MCP server research** — evaluating a Model Context Protocol server surface for the platform (exploratory).
- **WhatsApp integration research** — exploring a WhatsApp ordering/notification channel (exploratory).
- **Production payment automation** — replacing manual settlement entry with webhook/scheduled reconciliation once the bank feed is available.
- **ONDC certification** — formal certification testing, after registry validation and successful callback processing are in place.

---

# 12. Current Project Status

| Module | Status | Notes |
| --- | --- | --- |
| **Registration** | ✅ Done (pre-prod) | Subscriber `openidea.co.in`, ukId `37defd68-…`, status `SUBSCRIBED`, valid `2026-06-02 → 2027-06-02`, network preprod/`ONDC:RET10`/`IND`/`std:080`. |
| **Search** | ✅ Implemented | Outbound `/search` builds intent + finder fee + bap_terms; broadcasts to gateway. Synchronous ACK works; live `on_search` blocked (see Known Issues). |
| **Transaction APIs** | ✅ Implemented | All 10 outbound actions (search/select/init/confirm/status/track/support/rating/update/cancel). |
| **Callback APIs** | ✅ Implemented | All 10 `on_*` callbacks + on_subscribe. Signature verify, validation, persistence, ACK/NACK. |
| **Persistence** | ✅ Implemented (dual-backend) | JSON/Blob store works today; Prisma/Postgres schema written. **Remaining:** run `prisma migrate dev` against Supabase + live read/write smoke test. |
| **Audit** | ✅ Implemented | In-memory ring (2000) + JSONL/Blob; token-protected `GET /audit`. |
| **Network Observability** | ✅ Complete | `GET /observability` — summary + timeline + reconciliation (implemented 16 Jun 2026). |
| **Reconciliation** | ✅ Implemented | `GET /reconcile` — per-BPP data presence. |
| **Payment Integration** | ✅ Complete *(except Ecosysz bank details)* | Ledger + 5 routes (`create`/`status`/`instructions`/`verify`/`reconcile`) + deterministic `paymentReference` + write-once `verifiedAt` complete. **Only** the Ecosysz bank account values remain (empty in `config.ts`). No PSP/Razorpay. |
| **IGM / Support Flow Validation** | ✅ Complete | Support outbound + `on_support` callback validated (contact-channel retrieval; persisted standalone by `txn|bpp`). *Note:* ONDC's separate IGM grievance spec (`issue`/`on_issue`) is out of current MVP scope. |
| **AWS Credentials / Setup** | ✅ Complete | AWS credentials/setup in place and available. |
| **MCP Research** | 🟡 In Progress | Exploratory evaluation of a Model Context Protocol server surface; no implementation committed. |
| **WhatsApp Research** | 🟡 In Progress | Exploring a WhatsApp ordering/notification channel; research-only. |
| **Workbench Validation** | 🟡 Suite green, live runs pending | Black-box suite 259/259 (local+prod). Live Workbench/BPP runs **not yet executed** end-to-end. |
| **Callback Validation** | 🟡 Negative covered, positive pending | Every negative branch verified; positive (real BPP-signed) callbacks need the suspected registry/deployment blocker cleared + the deployed `bap_uri` confirmed. See the [Workbench investigation](#ondc-workbench-debugging-investigation-in-progress). |
| **ONDC Workbench Certification** | 🟡 In Progress | Search ACK works; live `on_search` ingestion is being debugged (identity-mismatch / suspected stale-deployment). Registry validation + successful callback processing are prerequisites before certification testing completes — passing is not guaranteed by a single fix. |

Legend: ✅ done/complete · 🟡 in progress / partially blocked · ❌ not started

---

# 13. Known Issues

## 13.1 No `on_search` callback currently observed from Workbench

**What we can confirm today:**

- **Outbound search ACK is working** — `/search` builds and signs the request and the gateway/Workbench returns an ACK.
- **Workbench accepts our requests** — the request side passes validation.
- **`on_search` is not currently being observed** — we are not seeing inbound callbacks land as persisted catalogs.

**Current working hypothesis:** callback processing may be blocked by **registry key-resolution failures**. `on_search/route.ts` resolves the sender's signing key (`resolveBppSigningPublicKey`) **before** it checks signature/domain/bap_id/bap_uri; if that lookup fails (the resolver POSTs `/v2.0/lookup` against `registryBaseUrl`, historically returning 403, more recently observed as **HTTP 404** for some senders), `resolveBppSigningPublicKey` returns `null` and the handler would NACK 401 (`INVALID_KEY`) before reaching `bap_uri` or persistence. That mechanism is consistent with the symptom — but **this requires confirmation through fresh production logs and `registry-status` diagnostics** before it is treated as the proven root cause.

**Registry lookup remains the leading suspected cause, but it is not yet proven.** Other contributors (a stale `ONDC_REGISTRY_BASE_URL` override, an incorrect deployed `bap_uri` so callbacks never arrive — see [§13.5](#135-production-ondc_bap_uri-env-var), or a network/access gate on ONDC's side) have not been fully ruled out. Treat the registry theory as the first thing to validate, not the final answer.

**How to validate (do this first):**

1. `GET /api/ondc/registry-status` — returns the registry URL + httpStatus + raw body. A non-200 here strongly supports the registry hypothesis. Capture the raw body/headers (HTML + edge headers ⇒ likely WAF/IP block; JSON ⇒ ONDC app-level denial).
2. Pull **fresh production logs** and look for `ondc.on_search persisted` (present ⇒ callbacks *are* processing) vs. a NACK 401 `INVALID_KEY` (supports the registry theory).
3. Confirm `ONDC_REGISTRY_BASE_URL` in prod isn't a stale override, and that the deployed `bap_uri` is correct so callbacks can physically arrive.

Until these checks are done, keep "registry lookup is failing" as a **hypothesis under investigation**, not a settled fact.

## 13.2 Tags discussion with ONDC

The search intent publishes a `bap_terms` **tags** group (`static_terms`, `static_terms_new`, `effective_date`). The exact required tag structure/values for RET10 1.2.5 is an **open discussion with ONDC** — the current values are contract-example values (see next item) pending confirmation of OpenIdea's own terms.

## 13.3 BAP terms use contract example values

In `search/route.ts` these are **temporary placeholders** until OpenIdea's real values are confirmed:

```ts
// TEMPORARY: RET10 1.2.5 contract example values
const BAP_STATIC_TERMS_NEW   = "https://github.com/ONDC-Official/NP-Static-Terms/buyerNP_BNP/1.0/tc.pdf";
const BAP_TERMS_EFFECTIVE_DATE = "2025-02-01T00:00:00.000Z";
const FINDER_FEE_TYPE = "percent";  const FINDER_FEE_AMOUNT = "3";
```

These need to be replaced with OpenIdea's actual static-terms URL, effective date, and finder fee.

## 13.4 Prisma dependency setup differs in local dev

Persistence uses **Prisma 7 + `@prisma/adapter-pg`**. The Postgres tables don't exist until you run `prisma migrate dev` against the Supabase DB, and local setups may differ (whether `DATABASE_URL` is set decides JSON-vs-Postgres backend at module load). Until the migration is run and smoke-tested, the **JSON/Blob store is the working fallback**. Expect first-run friction around Prisma client generation / the `DATABASE_URL` env var.

## 13.5 Production `ONDC_BAP_URI` env var

The registry's stored `subscriber_url` (`https://openidea.co.in/ondc`) is wrong twice over: `/ondc/*` 404s (real handlers are `/api/ondc/*`), and the apex → www 307 redirect breaks signed POSTs (which don't follow redirects). Fix: pin `ONDC_BAP_URI=https://www.openidea.co.in/api/ondc`. Applied locally in `.env.local`; **verify it's set in Vercel production** or every deployed callback advertises the broken URL and BPP callbacks 404.

---

# 14. Pending Work

## Internal work remaining (we control this)

1. **Run the Prisma migration** (`prisma migrate dev`) against Supabase + smoke-test live DB reads/writes. (Until then, JSON store is the fallback.)
2. **Fill `PAYMENT_CONFIG`** with real Ecosysz bank account values (`accountName`, `accountNumber`, `ifsc`, `upiId`, `qrCodeUrl`).
3. **Replace BAP terms placeholders** in `search/route.ts` (static-terms URL, effective date, finder fee) with OpenIdea's confirmed values.
4. **Confirm `ONDC_BAP_URI` is set in Vercel production** and redeploy.
5. **Remove temporary DEBUG logging** in `search/route.ts` once the 428/404 debugging is done.
6. **Wire settlement ingestion** (optional): a webhook or scheduled job that calls `/verify` or `/reconcile` when a payment settles, instead of manual entry.

## External dependencies (blocked on ONDC / third parties)

1. **Resolve the registry key-resolution failure** (observed as 403/404 on `/v2.0/lookup`) — the primary *suspected* blocker, pending confirmation via fresh logs + `registry-status`. Likely an environment-access / whitelisting gate on ONDC's side (capture the raw response, raise with ONDC). If confirmed, **no positive `on_search` (or any positive callback) can be processed until it clears**.
2. **Confirm the `bap_terms` tag structure/values** with ONDC.
3. **Run ONDC pre-prod Workbench** end-to-end (search → on_search → … → on_confirm) against the deployed BAP — needs #1 cleared and `bap_uri` correct in prod.
4. **Certification** — registry validation and successful callback processing are prerequisites before certification testing can begin. Additional issues may still be discovered during certification, so it should not be assumed to complete after a single fix.
5. **Real Ecosysz bank account details** — needed to populate `PAYMENT_CONFIG` (#2 internal depends on this input).

---

# Project Ownership & Responsibility

This section exists so a new engineer knows **who owns what** and **where to escalate** when blocked.

| Role | Owner |
| --- | --- |
| **Business Owner** | OpenIdea Founder |
| **Technical Owner** | Aaqib Abdullah |

**Current Focus**

- ONDC completion (clearing the callback/registry blocker, finishing Workbench validation)
- Observability (validating the timeline/reconciliation surfaces against real traffic)
- Payments (finishing configuration and moving toward automated settlement)

**External Dependencies** (things we do *not* control — escalate here when blocked)

- **ONDC Team** — registry access/whitelisting, protocol/contract clarifications, certification.
- **Workbench** — the official test harness; required for end-to-end and certification runs.
- **Registry** — key resolution and subscriber records; the current leading suspect for the callback blocker.
- **Ecosysz Banking Information** — the real bank account / UPI values needed to complete payment configuration.

**Why this matters:** most remaining work is gated on external parties, not on code. When you hit a wall, first decide whether it's an *internal* fix (you own it) or an *external* dependency (route it through the Technical Owner to the relevant party above). This avoids spending days debugging code for what is actually an access or contract issue on ONDC's side.

---

# 15. Danish Quick Start Guide (30 minutes)

> A hands-on path for a brand-new engineer ("Danish") to go from zero to productively debugging. Every acronym is expanded. Follow in order.

## Step 1 — Understand ONDC (5 min)

ONDC (**Open Network for Digital Commerce**) lets a **buyer app** and a **seller app** built by *different* companies transact over a shared protocol (Beckn). OpenIdea is the **BAP** (**Buyer App Participant** — the shopping app). Sellers are **BPPs** (**Seller Platform Participants**). The **Gateway** broadcasts searches; the **Registry** is the public-key phone book used to verify who sent each message.

Re-read [§2](#2-ondc-fundamentals) once. The single most important idea:

```
Every ONDC interaction = TWO HTTP exchanges:
  (1) BAP → network: "here's my request"  → instant ACK/NACK
  (2) network → BAP, LATER: the real answer (a signed "on_*" callback we verify + store)
```

## Step 2 — Understand the architecture (5 min)

Trace this in your head (and re-read [§3](#3-openidea-ondc-architecture)):

```
USER → OpenIdea(BAP) → GATEWAY → BPPs → (each) on_search back to OpenIdea → stored → shown to USER
```

- **search** = the only broadcast action (→ gateway, no bpp_id).
- **everything else** (select/init/confirm/status/track/support/rating/update/cancel) = directed to one BPP, carrying its `bpp_id`/`bpp_uri`.
- One **`transaction_id`** ties the whole journey; each call gets a fresh **`message_id`**.

## Step 3 — Run locally (5 min)

```powershell
cd webtemp
npm install        # if Prisma complains, see §13.4 — JSON store is the fallback
npm run dev        # http://localhost:3000
```

- Routes return **503** if ONDC env vars aren't loaded → make sure `.env.local` exists.
- **Troubleshooting:** port busy → stop the other process or set `PORT`. Prisma client errors → you can still run; the store falls back to JSON when `DATABASE_URL` is unset.

## Step 4 — Test search (5 min)

```powershell
$body = @{ query = "basmati rice"; deliveryAreaCode = "560001" } | ConvertTo-Json
$r = Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/ondc/search" -ContentType "application/json" -Body $body
$r          # note $r.transactionId  → you'll reuse it everywhere
```

- Watch the `npm run dev` terminal: `ondc.search ENTER` → `dispatch` → `payload` → `result`.
- **ACK** = the gateway accepted it. Catalogs arrive **later** as `on_search` callbacks (currently blocked — Step 5/§13 explains why).
- **NACK / 502 / 504** → read the error; 504 = timeout, 502 = network, 422 = gateway rejected the request.

## Step 5 — Check audit (3 min)

```powershell
Invoke-RestMethod "http://localhost:3000/api/ondc/audit?token=$env:ONDC_AUDIT_TOKEN&txn=$($r.transactionId)"
```

- This is the **wire trace of inbound callbacks**. If empty, no callback reached us (expected today — see the suspected registry blocker, [§13.1](#131-no-on_search-callback-currently-observed-from-workbench)).
- Each event has `ackStatus`, `errorCode`, `rawBody`, `requestHeaders` — everything to diagnose a signature failure.
- **401** = wrong/missing token; **503** = `ONDC_AUDIT_TOKEN` not set in env.

## Step 6 — Check reconciliation (2 min)

```powershell
Invoke-RestMethod "http://localhost:3000/api/ondc/reconcile?transactionId=$($r.transactionId)"
```

Tells you, **per seller**, whether we hold a catalog / quote / order / support / rating, plus the order `stage`. `catalogCount: 0` today is expected (callbacks blocked).

## Step 7 — Check observability (2 min)

```powershell
Invoke-RestMethod "http://localhost:3000/api/ondc/observability?transactionId=$($r.transactionId)" | ConvertTo-Json -Depth 6
```

One screen: **summary** (acks/nacks/last action) + **timeline** (ordered callbacks) + **reconciliation** (what's stored). This is your **first stop** when debugging any transaction.

## Step 8 — Continue development (3 min)

Your most likely first tasks (all in [§14](#14-pending-work)):

1. **Investigate the suspected registry blocker** — run `GET /api/ondc/registry-status`, capture the raw body, compare to [§13.1](#131-no-on_search-callback-currently-observed-from-workbench). This is the leading candidate for unblocking callbacks.
2. **Fill `PAYMENT_CONFIG`** (`src/lib/payments/config.ts`) once Ecosysz values arrive.
3. **Run the Prisma migration** and smoke-test the Postgres backend.

### Practical debugging tips

- **Always start from a `transaction_id`.** It's the join key for audit, reconcile, and observability.
- **Signature mismatch?** The digest is over the **exact raw bytes**. Never re-serialize a body before verifying. Compare the `rawBody` in the audit event against what the sender sent.
- **Callback NACKs 401 before anything else** → the **registry key lookup** is the leading suspect (not your payload). Confirm with `registry-status` before assuming a payload bug.
- **Route returns 503** → ONDC env vars not loaded.
- **JSON vs Postgres confusion** → the backend is chosen *once at module load* by whether `DATABASE_URL` is set. Restart `npm run dev` after changing it.
- **Reading the code:** start at the route's `route.ts`, then follow into `src/lib/ondc/` (`context.ts` → `auth.ts` → `client.ts` for outbound; `auth.ts` → `registry.ts` → `store.ts` for inbound).

### Acronym cheat-sheet

| Term | Expansion / meaning |
| --- | --- |
| ONDC | Open Network for Digital Commerce |
| BAP | Buyer App Participant (OpenIdea) |
| BPP | Seller Platform Participant (the seller app) |
| Gateway | Broadcasts search to all BPPs |
| Registry | Public-key phone book; used to verify callback signatures |
| Beckn | The underlying open commerce protocol |
| txn / transaction_id | UUID constant across one whole order journey |
| message_id | UUID unique per single request/response |
| ACK / NACK | Acknowledged / Negative-acknowledged (accepted / rejected) |
| on_* | A callback (the async "real answer" to an action) |
| ukId / unique_key_id | Identifies which registered key pair to use |
| IGM | Issue & Grievance Management (a separate ONDC spec — not implemented) |
| PSP | Payment Service Provider (e.g. Razorpay — not integrated) |
| UTR / RRN | Bank settlement reference numbers (stored as `bankReference`) |

---

# Repository & File Map

This is the file-by-file reference for the ONDC surface. For each file: **what it does**, **who calls it**, **which routes depend on it**, and **when you'd modify it**. (The Postgres backend file is named `store-db.ts`; the request's `store-postgres.ts` refers to this same file.)

## Outbound action routes (`src/app/api/ondc/*/route.ts`)

All outbound routes share the same dependency spine: `config.ts` (identity), `context.ts` (envelope), `client.ts` (sign + POST), and they each return a synchronous ACK/NACK. They do **not** persist — data lands later via the matching `on_*` callback.

| File | What it does | Calls (lib) | Routes/clients that depend on it | When to modify |
| --- | --- | --- | --- | --- |
| `search/route.ts` | Builds the Beckn `intent` (item/category/delivery + finder fee + `bap_terms` + `bap_features`) and broadcasts to `${gatewayUrl}/search`. Only broadcast action. | `config`, `context`, `client` | The buyer UI / `scripts/ondc-test-suite.mjs`; correlates to `on_search`. | Changing search fields, finder fee, or the `bap_terms`/`bap_features` tags. |
| `select/route.ts` | Builds `order` (provider + items) and POSTs to `${bppUri}/select` to get a firm quote. | `config`, `context`, `client` | Buyer UI after picking a seller; correlates to `on_select`. | Changing how a cart/line-items request is shaped. |
| `init/route.ts` | Builds `order` + **billing** (name+phone required) and POSTs to `${bppUri}/init`. | `config`, `context`, `client` | Buyer UI after quote; correlates to `on_init`. | Changing billing fields or init order assembly. |
| `confirm/route.ts` | Forwards the finalized on_init `order` opaquely to `${bppUri}/confirm`; validates `order.provider.id`, items, quote, payment(s). | `config`, `context`, `client` | Buyer UI after payment intent; correlates to `on_confirm`. | Changing confirm-time validation or payment-block requirements. |
| `status/route.ts` | Sends `{ order_id }` to `${bppUri}/status` (read-only poll). | `config`, `context`, `client` | Order-status polling UI; correlates to `on_status`. | Rare — only if the status request shape changes. |
| `cancel/route.ts` | Sends `{ order_id, cancellation_reason_id, descriptor? }` to `${bppUri}/cancel`. | `config`, `context`, `client` | Cancel UI; correlates to `on_cancel`. | Changing cancel reasons or descriptor pass-through. |
| `support/route.ts` | Sends `{ ref_id }` to `${bppUri}/support` to retrieve contact channels (not IGM). | `config`, `context`, `client` | Support UI; correlates to `on_support`. | Changing the support subject (ref_id) logic. |
| `rating/route.ts` | Builds `ratings[]` (value 1–5) and POSTs to `${bppUri}/rating`. | `config`, `context`, `client` | Post-delivery rating UI; correlates to `on_rating`. | Changing rating categories or value validation. |

> Also present but not in the minimum list: `track/route.ts` (`{order_id}` → on_track) and `update/route.ts` (opaque order + `update_target` → on_update). Same spine.

## Callback routes (`src/app/api/ondc/on_*/route.ts`)

All `on_*` routes share the inbound spine: read raw body → `auth.ts` (parse + verify signature) → `registry.ts` (resolve sender key) → `context.ts` (`validateContextFreshness`) → `extractAndValidate` (in-file) → idempotency → `store.ts` (`save*`) → `audit.ts` (trace) → ACK/NACK.

| File | What it does | Calls (lib) | Depends on / produces | When to modify |
| --- | --- | --- | --- | --- |
| `on_search/route.ts` | Verifies sig, validates context echoes (incl. the **`bap_id` allowlist** for staging), persists catalog. | `auth`, `registry`, `context`, `store.saveCatalog`, `audit` | Triggered by BPPs after `search`. **This is where the Workbench `bap_id` debugging lives.** | Catalog ingestion rules, the staging allowlist, debug markers. |
| `on_select/route.ts` | Validates `message.order.quote`, persists quote. | `auth`, `registry`, `context`, `store.saveQuote`, `audit` | Triggered after `select`. | Quote persistence shape. |
| `on_init/route.ts` | Validates `message.order.quote`, persists draft order (stage `init`). | `auth`, `registry`, `context`, `store.saveInitOrder`, `audit` | Triggered after `init`. | Init order fields persisted. |
| `on_confirm/route.ts` | Validates `message.order.id`, persists order (stage `confirm`, sets `orderId` + index). | `auth`, `registry`, `context`, `store.saveConfirmOrder`, `audit` | Triggered after `confirm`. **Introduces `order_id`.** | Confirm persistence / orderId indexing. |
| `on_status/route.ts` | Validates `order.id`, appends status snapshot (stage `status`). | `auth`, `registry`, `context`, `store.saveStatusUpdate`, `audit` | Triggered after `status` (and unsolicited). | Status-history handling. |
| `on_cancel/route.ts` | Validates `order.id`, records cancellation (stage `cancel`, terminal milestone). | `auth`, `registry`, `context`, `store.saveCancelUpdate`, `audit` | Triggered after `cancel` (and unsolicited). | Cancellation persistence. |
| `on_support/route.ts` | Requires ≥1 of phone/email/uri, persists standalone `SupportRecord`. | `auth`, `registry`, `context`, `store.saveSupport`, `audit` | Triggered after `support`. | Support channel validation. |
| `on_rating/route.ts` | Requires ≥1 of feedback_form/ack flags, persists standalone `RatingRecord`. | `auth`, `registry`, `context`, `store.saveRating`, `audit` | Triggered after `rating`. | Rating/feedback persistence. |

> Also present: `on_track/route.ts`, `on_update/route.ts`, `on_subscribe/route.ts` (registry liveness challenge — decrypts an AES challenge, no transaction persistence).

## Shared library (`src/lib/ondc/`)

| File | What it does | Called by | Routes that depend on it | When to modify |
| --- | --- | --- | --- | --- |
| `config.ts` | Validates + memoizes ONDC config from env (`getOndcConfig`, `isOndcConfigured`); holds `subscriberId`, `bapId`, `bapUri`, keys, registry/gateway URLs. | Every route, `context`, `auth`, `registry` | **All** ONDC routes. | Adding a config field, changing env handling, network defaults. |
| `context.ts` | `buildContext()` (outbound envelope: transaction_id/message_id/timestamps/ttl, `bap_id: config.bapId`); `validateContextFreshness()` (inbound). | All outbound routes (build); all `on_*` (freshness). | All ONDC routes. | Context fields, core_version pin, freshness window. |
| `auth.ts` | Ed25519 + BLAKE-512 signing (`signRequest`) and verification (`parseAuthorizationHeader`, `verifyOndcSignature`); X25519 for on_subscribe. | `client.ts` (sign), all `on_*` (verify) | All signed in/outbound. | Signing/verification logic — **high-risk, change rarely**. |
| `registry.ts` | `resolveBppSigningPublicKey()` — looks up a sender's signing key in the ONDC registry (cached). | All `on_*` routes; `registry-diagnostics` | All callbacks. **Suspected blocker site (404).** | Registry lookup behaviour, caching, the `/v2.0/lookup` path. |
| `store.ts` | Dispatcher — picks JSON vs Postgres backend at module load by `DATABASE_URL`; exports all `save*`/`get*`. | All `on_*` routes; `reconcile`, `observability` | All persistence consumers. | Adding a store operation, changing backend selection. |
| `store-json.ts` | JSON-snapshot backend: in-memory Maps + write-through file/Blob. **Active fallback today.** | `store.ts` (when no `DATABASE_URL`) | Indirectly all `on_*`. | JSON persistence semantics, snapshot schema (`version`). |
| `store-db.ts` *(= the request's `store-postgres.ts`)* | Postgres backend via Prisma (4 tables); `run()` wraps SQL errors as `OndcStoreError`. | `store.ts` (when `DATABASE_URL` set) | Indirectly all `on_*`. | Postgres schema/queries; **pending migration**. |
| `audit.ts` | Wire-trace ring (2000) + JSONL/Blob; `beginAuditTrace`/`annotateTrace`/`finalizeAuditTrace`/`readAuditEvents`. | All `on_*` routes; `audit`, `observability` routes | All callbacks + diagnostics. | Audit fields, retention, read filters. |

> Supporting files: `store-types.ts` (record/input types), `client.ts` (`sendOndcRequest`), `errors.ts` (ONDC error codes), `idempotency.ts` (`peekMessageId`/`commitMessageId`), `registry-diagnostics.ts` (`lookupSubscriber`).

## Payment library (`src/lib/payments/`)

| File | What it does | Called by | Routes that depend on it | When to modify |
| --- | --- | --- | --- | --- |
| `store-json.ts` | Payment ledger: `Map<transactionId, PaymentRecord>` + JSON/Blob snapshot. `createPayment`, `updatePaymentStatus` (write-once `verifiedAt`), `getPayment`, `getPaymentByReference`, `paymentReferenceFor`. | All `payments/*` routes | `/payments/create|status|instructions|verify|reconcile`. | Payment record shape, reference logic, settlement rules. |
| `config.ts` | Static `PAYMENT_CONFIG` (Ecosysz `accountName`/`accountNumber`/`ifsc`/`upiId`/`qrCodeUrl`). **All empty placeholders today.** | `payments/instructions/route.ts` | `/payments/instructions`. | **Fill in real Ecosysz bank values** (the only remaining payment task). |

---

# How a Complete ONDC Transaction Flows Through Our Code

One **`transaction_id` (T1)** spans the entire journey; every call mints a fresh **`message_id`**. Outbound routes return only ACK/NACK; the *data* arrives on the matching `on_*` callback and is persisted there.

```
Search(T1) → on_search(T1)×N → Select(T1) → on_select(T1) → Init(T1) → on_init(T1)
           → Confirm(T1) → on_confirm(T1, +order_id) → Status(T1) → on_status(T1)
```

| Step | Route called | Payload generated | Persistence | transaction_id usage | Files involved |
| --- | --- | --- | --- | --- | --- |
| **Search** | `POST /api/ondc/search` → gateway | Beckn `intent` (query/category/delivery + finder fee + `bap_terms` + `bap_features`) | None (returns ids only) | **Minted here** (or reused if continuing); returned to caller as join key | `search/route.ts`, `context.ts`, `client.ts`, `config.ts` |
| **on_search** | `POST /api/ondc/on_search` (BPP→us, N times) | — (we receive `message.catalog`) | `saveCatalog()` → CatalogRecord, keyed `txn\|bpp\|messageId` (accumulates) | Echoed by each BPP; matches catalogs back to the search | `on_search/route.ts`, `auth.ts`, `registry.ts`, `store.ts`/`store-json.ts`, `audit.ts` |
| **Select** | `POST /api/ondc/select` → `${bppUri}/select` | `order` (provider + chosen items) | None | **Reused** from search; carries chosen `bppId`/`bppUri` | `select/route.ts`, `context.ts`, `client.ts` |
| **on_select** | `POST /api/ondc/on_select` | — (`message.order.quote`) | `saveQuote()` → QuoteRecord, keyed `txn\|bpp` (last-write-wins) | Same T1; ties quote to the BPP | `on_select/route.ts`, `auth.ts`, `registry.ts`, `store.ts`, `audit.ts` |
| **Init** | `POST /api/ondc/init` → `${bppUri}/init` | `order` + **billing** (name/phone) | None | **Reused** | `init/route.ts`, `context.ts`, `client.ts` |
| **on_init** | `POST /api/ondc/on_init` | — (`message.order.quote`) | `saveInitOrder()` → OrderRecord stage `init` | Same T1; draft order created | `on_init/route.ts`, `auth.ts`, `registry.ts`, `store.ts`, `audit.ts` |
| **Confirm** | `POST /api/ondc/confirm` → `${bppUri}/confirm` | Finalized on_init `order` (opaque) + payment block | None | **Reused** | `confirm/route.ts`, `context.ts`, `client.ts` |
| **on_confirm** | `POST /api/ondc/on_confirm` | — (`message.order.id`) | `saveConfirmOrder()` → OrderRecord stage `confirm`, **sets `orderId`** + secondary index | Same T1; **`order_id` introduced** and indexed | `on_confirm/route.ts`, `auth.ts`, `registry.ts`, `store.ts`, `audit.ts` |
| **Status** | `POST /api/ondc/status` → `${bppUri}/status` | `{ order_id }` | None | **Reused** + `orderId` | `status/route.ts`, `context.ts`, `client.ts` |
| **on_status** | `POST /api/ondc/on_status` | — (`message.order.id` + state) | `saveStatusUpdate()` → appends to `statusHistory[]` (stage `status`) | Same T1; milestone appended | `on_status/route.ts`, `auth.ts`, `registry.ts`, `store.ts`, `audit.ts` |

**Merge-forward rule:** an OrderRecord is progressively enriched across `on_init → on_confirm → on_status`; fields not restated in a later callback keep their prior value, making the store resilient to out-of-order callbacks. To inspect any point: `GET /api/ondc/observability?transactionId=T1`.

---

# Current Technical Debt

Things that are intentional-but-temporary, or implemented-but-not-final. Each should be revisited before/after certification.

| Item | Where | Why it exists | Action to clear it |
| --- | --- | --- | --- |
| **Temporary staging-automation allowlist** | `on_search/route.ts` (`STAGING_AUTOMATION_BAP_ID`) | Workbench harness sends `bap_id = staging-automation.ondc.org` instead of echoing ours; gate would NACK. | Remove after ONDC fixes the harness / after certification; re-evaluate necessity. |
| **Debug instrumentation for Workbench** | `on_search/route.ts` (`debug_build` marker in ACK/NACK; `bap_id mismatch DEBUG`, gate-number warns) | To identify which deployment serves the callback and which gate fails. | Remove once the callback path is confirmed and the mismatch is resolved. |
| **JSON persistence still in use** | `store-json.ts` (active when `DATABASE_URL` unset) | Postgres migration not yet run; JSON is the working fallback. | Run `prisma migrate dev`, set `DATABASE_URL`, smoke-test, switch to `store-db.ts`. |
| **Finder-fee placeholders** | `search/route.ts` (`FINDER_FEE_TYPE`/`AMOUNT` = `percent`/`3`) | OpenIdea's commercial terms not yet confirmed by ONDC. | Replace with confirmed BAP finder-fee values. |
| **BAP terms placeholders** | `search/route.ts` (`BAP_STATIC_TERMS_NEW`, `BAP_TERMS_EFFECTIVE_DATE`) | RET10 1.2.5 contract-example values used until OpenIdea's are confirmed. | Replace with OpenIdea's real static-terms URL + effective date. |
| **Pending Prisma/Postgres migration** | `prisma/schema.prisma`, `store-db.ts` | Schema written; migration not executed against Supabase. | `prisma migrate dev`; live read/write smoke test. |
| **Pending payment bank details** | `payments/config.ts` (all fields empty) | Awaiting Ecosysz account values. | Populate `accountName`/`accountNumber`/`ifsc`/`upiId`/`qrCodeUrl`. |

---

# If You Join This Project Tomorrow

A practical first-day-to-first-fix onboarding path. (Complements [§15 Danish Quick Start](#15-danish-quick-start-guide-30-minutes) with a contributor-oriented flow.)

### 1. What to read first (≈30 min)
1. [Latest Progress Update (16 June 2026)](#latest-progress-update-16-june-2026) — current state.
2. [§2 ONDC Fundamentals](#2-ondc-fundamentals) — BAP/BPP/gateway/registry + the "two HTTP exchanges" mental model.
3. [§3 Architecture](#3-openidea-ondc-architecture) and [How a Complete ONDC Transaction Flows](#how-a-complete-ondc-transaction-flows-through-our-code).
4. [ONDC Workbench Debugging Investigation](#ondc-workbench-debugging-investigation-in-progress) — the active problem.

### 2. Which files to open first
- `src/app/api/ondc/search/route.ts` — outbound entry point.
- `src/app/api/ondc/on_search/route.ts` — inbound entry point (and the current debugging hotspot).
- `src/lib/ondc/config.ts`, `context.ts`, `auth.ts`, `registry.ts`, `store.ts` — the spine every route uses.
- `src/lib/payments/store-json.ts`, `config.ts` — the payment ledger.

### 3. How to run locally
```powershell
cd webtemp
npm install        # if Prisma complains, you can still run — JSON store is the fallback
npm run dev        # http://localhost:3000
```
Routes return **503** if ONDC env vars aren't loaded → ensure `.env.local` exists.

### 4. How to trigger a search
```powershell
$body = @{ query = "basmati rice"; deliveryAreaCode = "560001" } | ConvertTo-Json
$r = Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/ondc/search" -ContentType "application/json" -Body $body
$r          # note $r.transactionId — reuse it everywhere
```

### 5. How to inspect audit logs
```powershell
Invoke-RestMethod "http://localhost:3000/api/ondc/audit?token=$env:ONDC_AUDIT_TOKEN&txn=$($r.transactionId)"
```
Each event has `ackStatus`, `errorCode`, `rawBody`, `requestHeaders` — the ground truth for any callback.

### 6. How to inspect observability
```powershell
Invoke-RestMethod "http://localhost:3000/api/ondc/observability?transactionId=$($r.transactionId)" | ConvertTo-Json -Depth 6
```
Summary + timeline + reconciliation in one call — your **first stop** for any transaction.

### 7. How to debug callback failures
Follow the [End-to-End Search Debugging Playbook](#end-to-end-search-debugging-playbook): trigger → confirm ACK → read server logs → observability → reconcile → audit → `registry-status`. For `on_search` specifically, watch for `ondc.on_search ENTER` (proves the callback reached *this* process), `bap_id allowlisted (staging automation)`, or a NACK with `INVALID_KEY` (registry blocker).

### 8. How to run Workbench tests
```powershell
npm run test:ondc                                          # black-box suite vs localhost
node scripts/ondc-test-suite.mjs --base-url=https://www.openidea.co.in
```
The suite covers negative branches (259/259 last run). Positive `on_*` paths require a live BPP/Workbench run against the **deployed** build.

### 9. Common mistakes & troubleshooting
- **Route returns 503** → ONDC env vars not loaded (`.env.local`).
- **No callback logs at all** → the callback is hitting a **different/deployed** build, not your local one (the current Workbench symptom — check the `debug_build` marker).
- **Callback NACKs 401 before validation** → registry key lookup failing (the suspected 404 blocker), not your payload — confirm with `GET /api/ondc/registry-status`.
- **Signature mismatch** → never re-serialize the body before verifying; the digest is over the exact raw bytes.
- **JSON vs Postgres confusion** → backend is chosen once at module load by `DATABASE_URL`; restart `npm run dev` after changing it.
- **Don't "fix" `bap_id` by editing `ONDC_BAP_ID`** → it's dual-use (outbound identity + inbound expectation) and would break outbound signing.

---

# Project Status Snapshot

A one-screen executive snapshot. (For the detailed grid, see [§12 Current Project Status](#12-current-project-status).)

### ✅ What is complete
- Transaction APIs (all 10 outbound) and callback APIs (all 10 `on_*` + on_subscribe).
- Request signing + callback signature verification; `signer == bpp_id`, `bap_uri`, domain, freshness checks.
- Persistence layer (JSON/Blob backend live; Postgres schema written).
- Audit logging, **Network Observability**, Reconciliation.
- **Payment ledger** (create/status/instructions/verify/reconcile, deterministic `paymentReference`, write-once `verifiedAt`).
- Support / `on_support` flow validation.
- **AWS setup**; this handover documentation.
- `bap_terms` + `bap_features` (003/005/006) tags on search.

### 🟡 What is partially complete
- **Payment Integration** — complete **except** the Ecosysz bank account values.
- **Persistence** — JSON works; Prisma/Postgres migration not yet run.
- **Workbench validation** — black-box suite green; live end-to-end pending.
- **MCP** and **WhatsApp** research — exploratory/in-progress.

### 🚧 What is blocked
- Live `on_search` ingestion via Workbench (identity-mismatch / suspected stale-deployment — under investigation).
- ONDC certification (depends on the callback path + registry validation).

### 🧑‍💼 What needs founder input
- **Ecosysz bank account details** (to finish payments).
- Liaison with ONDC on the finder-fee/BAP-percentage and tag/participant-group questions.
- Direction on MCP / WhatsApp priorities.

### 🏛️ What needs ONDC input
- Confirmation of `bap_features`/`bap_terms` tag contract.
- Resolution/guidance on the registry key-resolution (404) and Workbench callback identity behaviour.
- Participant-group / environment access for certification.

### 🛠️ What can be worked on independently (no external dependency)
- Run the Prisma migration + Postgres smoke test.
- Deploy the patched build and confirm the `debug_build` marker (resolve which deployment serves callbacks).
- Confirm `ONDC_BAP_URI` in production and redeploy.
- Remove temporary debug instrumentation once the path is confirmed.
- Replace placeholder finder-fee / static-terms constants (mechanically, pending values).

---

*End of handover. Keep this document next to `ONDC_GAP_ANALYSIS.md` and `ONDC_WORKBENCH_RESULTS.md`, which track the live status and test results in more granular form.*
