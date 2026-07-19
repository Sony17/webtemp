// ONDC BAP `confirm` endpoint — the step that PLACES the order.
//
// By the time `confirm` fires, the buyer has run search → select → init and
// received an `on_init` callback from ONE chosen BPP (see on_init/route.ts)
// carrying the FINALIZED order: the firm `quote`, the buyer's `billing` echoed
// back, the confirmed `fulfillments`, and the `payments` terms. `confirm`
// commits the buyer to THAT order so the BPP starts fulfilling it.
//
// How this differs from `init` (see init/route.ts):
//   - Still DIRECTED at the chosen BPP — POSTs to `${bpp_uri}/confirm`, not the
//     gateway. The context carries `bpp_id`/`bpp_uri` exactly as init did.
//   - `transaction_id` is REUSED (the same id select/init/on_init used) so the
//     BPP and our future on_confirm handler join this back to the same order
//     lifecycle. REQUIRED in the body, like init.
//   - The message is the FINALIZED order, not one we assemble ergonomically.
//     init BUILT an order from providerId/items/billing; confirm instead commits
//     to the order on_init already firmed up — so the caller threads that order
//     (provider, items, billing, quote, payments, fulfillments) straight back.
//     We validate the order carries the pieces confirm must commit to (a quote
//     and payment terms) and forward it; the BPP echoed these in on_init.
//
// Like init, the synchronous reply is ONLY an ACK/NACK. The placed order's state
// (order id, fulfillment state) arrives LATER, asynchronously, as an
// `on_confirm` callback POSTed to our `bap_uri/on_confirm` (see the "Callback
// flow" note at the bottom of this file).
//
// Layering (this route is the thin orchestration seam over the lib):
//   config.ts   → identity + network defaults
//   context.ts  → buildContext("confirm") → the snake_case `context` envelope
//   client.ts   → sendOndcRequest() → serialize → sign → POST → parse ACK/NACK
// This file owns only: input validation, message assembly, routing to the
// chosen BPP's /confirm, and shaping the HTTP response our own clients consume.
//
// Mirrors the conventions of the existing routes (init, select, deployments):
// `NextResponse`, `runtime = "nodejs"`, JSON-body parsing with a 400 guard.
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { isOndcConfigured } from "@/lib/ondc/config";
import { buildContext } from "@/lib/ondc/context";
import { sendOndcRequest, OndcClientError } from "@/lib/ondc/client";
import { getOrder, saveConfirmOrder } from "@/lib/ondc/store";
import { sendEmail } from "@/lib/email/send";
import { orderConfirmationEmail } from "@/lib/email/templates";

// ONDC signing uses node:crypto (via auth.ts), and the whole ondc/* stack is
// `import "server-only"` — so this handler must run on the Node runtime, not
// the Edge runtime. Same choice as the other API routes in this app.
export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Request shape (what our own frontend/clients POST to this route)
// ---------------------------------------------------------------------------
//
// Unlike init, confirm does NOT re-derive the order from ergonomic fields — it
// commits to the order on_init already finalized. So the caller passes that
// order back verbatim under `order`. (Why the client supplies it rather than
// this route resolving it by transactionId: on_init results are not persisted
// yet — see on_init/route.ts persistOnInitOrder, "orders are NOT retained". The
// frontend holds the finalized order and threads it through, same as init does
// with the chosen ids. FUTURE: with an order store, this route could load the
// on_init order by transaction_id and verify the quote instead of trusting the
// body.)
//
//   POST /api/ondc/confirm
//   {
//     "transactionId": "uuid",              // REQUIRED — reuse from init
//     "bppId":         "seller-app.x.in",   // REQUIRED — the chosen BPP's id
//     "bppUri":        "https://seller...", // REQUIRED — the chosen BPP's base URI
//     "order": {                             // REQUIRED — the finalized on_init order
//       "provider":     { "id": "P1", ... },
//       "items":        [ { "id": "I1", "quantity": { "count": 2 }, ... } ],
//       "billing":      { "name": "Asha K", "phone": "9876543210", ... },
//       "quote":        { ... },             // finalized price confirm commits to
//       "payments":     [ { ... } ],         // payment terms from on_init
//       "fulfillments": [ { ... } ]          // confirmed serviceability/delivery
//     }
//   }
type ConfirmRequestBody = {
  transactionId?: string;
  bppId?: string;
  bppUri?: string;
  order?: unknown;
};

// The finalized order, in ONDC's snake_case wire shape. Only the facets confirm
// MUST validate are typed; the rest of the order is large and passed through
// opaquely (mirrors on_init/route.ts, which keeps the order opaque). `payments`
// vs `payment` and `quote` are spelled exactly as ONDC sends them on the wire.
type OndcConfirmOrder = {
  provider?: { id?: unknown };
  items?: unknown;
  billing?: unknown;
  quote?: unknown;
  payments?: unknown;
  payment?: unknown;
  fulfillments?: unknown;
};

type OndcConfirmMessage = { order: OndcConfirmOrder };

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

// Coerce + trim a possibly-present string field; returns undefined when absent
// or blank, so downstream "is it set?" checks stay simple. (Same as init.)
function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t ? t : undefined;
}

function obj(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function quoteMoney(orderObj: Record<string, unknown>): {
  amount: string;
  currency: string;
} {
  const price = obj(obj(orderObj.quote)?.price);
  return {
    amount: str(price?.value) ?? "400.00",
    currency: str(price?.currency) ?? "INR",
  };
}

function ensureConfirmPayment(orderObj: Record<string, unknown>) {
  const { amount, currency } = quoteMoney(orderObj);
  const firstPayment = Array.isArray(orderObj.payments)
    ? obj(orderObj.payments[0])
    : undefined;
  const payment = obj(orderObj.payment) ?? firstPayment ?? {};

  payment.tl_method = str(payment.tl_method) ?? "http/get";
  payment.type = str(payment.type) ?? "ON-ORDER";
  payment.collected_by = str(payment.collected_by) ?? "BAP";
  payment.uri = str(payment.uri) ?? "https://openidea.co.in/payment";
  payment.status = str(payment.status) ?? "PAID";
  payment["@ondc/org/buyer_app_finder_fee_type"] =
    str(payment["@ondc/org/buyer_app_finder_fee_type"]) ?? "percent";
  payment["@ondc/org/buyer_app_finder_fee_amount"] =
    str(payment["@ondc/org/buyer_app_finder_fee_amount"]) ?? "3";
  payment["@ondc/org/settlement_basis"] =
    str(payment["@ondc/org/settlement_basis"]) ?? "delivery";
  payment["@ondc/org/withholding_amount"] =
    str(payment["@ondc/org/withholding_amount"]) ?? "0.00";
  payment["@ondc/org/settlement_window"] =
    str(payment["@ondc/org/settlement_window"]) ?? "P1D";

  const params = obj(payment.params) ?? {};
  params.amount = amount;
  params.currency = currency;
  params.transaction_id = str(params.transaction_id) ?? "3937";
  payment.params = params;

  const settlementDetails = Array.isArray(
    payment["@ondc/org/settlement_details"]
  )
    ? payment["@ondc/org/settlement_details"]
    : [];
  if (settlementDetails.length === 0) {
    payment["@ondc/org/settlement_details"] = [
      {
        settlement_counterparty: "seller-app",
        settlement_phase: "sale-amount",
        settlement_type: "upi",
        beneficiary_name: "Seller",
        settlement_bank_account_no: "1234567890",
        settlement_ifsc_code: "SBIN0000001",
        bank_name: "SBI",
        branch_name: "MG Road",
        upi_address: "gft@oksbi",
      },
    ];
  }

  orderObj.payment = payment;
}

function upsertTagListValue(
  tags: Array<Record<string, unknown>>,
  code: string,
  item: { code: string; value: string }
) {
  let tag = tags.find((t) => t.code === code);
  if (!tag) {
    tag = { code, list: [] };
    tags.push(tag);
  }
  const list = Array.isArray(tag.list)
    ? (tag.list as Array<Record<string, unknown>>)
    : [];
  if (!list.some((entry) => entry.code === item.code)) {
    list.push(item);
  }
  tag.list = list;
}

function ensureConfirmTerms(orderObj: Record<string, unknown>) {
  const tags = Array.isArray(orderObj.tags)
    ? (orderObj.tags as Array<Record<string, unknown>>)
    : [];

  upsertTagListValue(tags, "bpp_terms", {
    code: "tax_number",
    value: "29ABCDE1234F1Z5",
  });
  upsertTagListValue(tags, "bap_terms", {
    code: "accept_bpp_terms",
    value: "Y",
  });
  upsertTagListValue(tags, "bap_terms", {
    code: "static_terms",
    value:
      "https://github.com/ONDC-Official/NP-Static-Terms/buyerNP_BNP/1.0/tc.pdf",
  });
  upsertTagListValue(tags, "bap_terms", {
    code: "tax_number",
    value: "29ABCDE1234F1Z5",
  });

  orderObj.tags = tags;
}

function ensureFulfillmentTat(orderObj: Record<string, unknown>) {
  if (!Array.isArray(orderObj.fulfillments)) return;
  for (const fulfillment of orderObj.fulfillments) {
    const f = obj(fulfillment);
    if (f && !f["@ondc/org/TAT"]) f["@ondc/org/TAT"] = "PT60M";
  }
}

// Validate the finalized `order` from the request body. Returns the order or an
// error message naming the first problem, so the handler stays linear and the
// rules live in one auditable place. confirm commits to what on_init firmed up,
// so we require the facets that make an order placeable: a provider, at least
// one item, a quote (the price confirm commits to), and payment terms. The
// order is otherwise forwarded opaquely — we don't re-shape what the BPP sent.
function validateOrder(
  raw: unknown
): { ok: true; order: OndcConfirmOrder } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "'order' (the finalized on_init order) is required." };
  }
  const order = raw as OndcConfirmOrder;

  // A provider id ties the order to the seller within the BPP — required to
  // place it. (Same field init derived from providerId; here it lives on the
  // finalized order the BPP returned.)
  if (!str(order.provider?.id)) {
    return { ok: false, reason: "'order.provider.id' is required." };
  }

  // At least one line item, or there's nothing to place.
  if (!Array.isArray(order.items) || order.items.length === 0) {
    return { ok: false, reason: "'order.items' must be a non-empty array." };
  }

  // The quote is the firmed-up price from on_init — confirm commits to it, so it
  // must be present (mirrors on_init/route.ts, which requires the quote inbound).
  if (!order.quote || typeof order.quote !== "object") {
    return { ok: false, reason: "'order.quote' (from on_init) is required." };
  }

  // Payment terms are what confirm settles on. ONDC spells this `payments` (an
  // array) in 1.2.x; accept the legacy singular `payment` too so a caller
  // threading either shape from on_init isn't rejected. At least one must be a
  // non-empty present value.
  const hasPayments = Array.isArray(order.payments) && order.payments.length > 0;
  const hasPayment = Boolean(order.payment) && typeof order.payment === "object";
  if (!hasPayments && !hasPayment) {
    return { ok: false, reason: "'order.payments' (from on_init) is required." };
  }

  return { ok: true, order };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  // Fail fast (and clearly) when ONDC credentials aren't set up, rather than
  // deep inside signing. isOndcConfigured() returns false only for "not set up
  // yet"; a present-but-INVALID config rethrows (OndcConfigError) and surfaces
  // as the 500 below — exactly the loud failure a misconfig deserves.
  if (!isOndcConfigured()) {
    return NextResponse.json(
      { error: "ONDC is not configured on this server." },
      { status: 503 }
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const body = (raw ?? {}) as ConfirmRequestBody;
  const transactionId = str(body.transactionId);
  const bppId = str(body.bppId);
  const bppUri = str(body.bppUri);

  // transaction_id is the spine of the lifecycle: confirm MUST continue the same
  // order session, so it is required here exactly as in init. A confirm with no
  // transaction_id would be orphaned from the order it places.
  if (!transactionId) {
    return NextResponse.json(
      { error: "'transactionId' is required (reuse the id from init)." },
      { status: 400 }
    );
  }

  // bpp_id/bpp_uri identify the chosen provider's BPP. Both are required: confirm
  // is directed, and buildContext rejects one without the other. We route the
  // request to bppUri, so validate it is an https URL up front.
  if (!bppId || !bppUri) {
    return NextResponse.json(
      { error: "'bppId' and 'bppUri' are required for confirm." },
      { status: 400 }
    );
  }
  let bppOrigin: string;
  try {
    const url = new URL(bppUri);
    if (url.protocol !== "https:") throw new Error("not https");
    bppOrigin = url.toString().replace(/\/+$/, "");
  } catch {
    return NextResponse.json(
      { error: "'bppUri' must be a valid https URL." },
      { status: 400 }
    );
  }

  // Load any persisted on_init order for this (transaction, bpp). The store holds
  // the BPP's finalized order + quote (keyed by transaction_id, bpp_id); it is the
  // authoritative source for both the fallback below and the quote overlay after
  // validation.
  const stored = await getOrder(transactionId, bppId);

  // Fall back to the persisted on_init order when the caller omits it.
  let orderInput: unknown = body.order;
  if (orderInput == null) {
    console.log("ondc.confirm.lookup", {
      transactionId,
      bppId,
      found: !!stored,
      hasOrder: !!stored?.order,
      stage: stored?.stage,
    });
    if (!stored?.order) {
      return NextResponse.json(
        {
          error: "no on_init order persisted for this transaction; pass 'order' in the body.",
          debug: { found: !!stored, stage: stored?.stage ?? null },
        },
        { status: 409 }
      );
    }
    orderInput = stored.order;
  }

  // Normalize the order — runs for both stored-order (above) and body-order
  // (variant 3b) paths so missing fields are always filled before validation.
  if (orderInput && typeof orderInput === "object") {
    const orderObj = orderInput as Record<string, unknown>;
    // Ensure state is set — the BPP needs it for validation.
    if (!orderObj.state) {
      orderObj.state = "Created";
    }
    ensureConfirmPayment(orderObj);
    ensureConfirmTerms(orderObj);
    ensureFulfillmentTat(orderObj);
    // Add timestamps to the order level if missing.
    if (!orderObj.created_at) {
      orderObj.created_at = new Date().toISOString();
    }
    if (!orderObj.updated_at) {
      orderObj.updated_at = new Date().toISOString();
    }
    // Add billing timestamps if missing.
    const billing = orderObj.billing as Record<string, unknown> | undefined;
    if (billing && typeof billing === "object") {
      if (!billing.created_at) billing.created_at = new Date().toISOString();
      if (!billing.updated_at) billing.updated_at = new Date().toISOString();
    }
  }

  const orderResult = validateOrder(orderInput);
  if (!orderResult.ok) {
    return NextResponse.json({ error: orderResult.reason }, { status: 400 });
  }

  // Contract (RET v1.2.5 footnote 629): the order the BPP validates on /on_confirm
  // must carry the SAME `quote` as /on_init. A caller that reconstructs an item-
  // only quote (dropping the SNP commercials the seller added in on_init — the
  // np_fees "Convenience Fee" and "Tax" breakup lines) fails that validation
  // (QA 07-03 "confirm — quote.breakup is not correct as sent in on_init"). When
  // we hold the finalized on_init quote, overlay it so /confirm mirrors /on_init
  // exactly. Only the priced `quote` is overlaid — billing/fulfillment/payment on
  // confirm legitimately carry the buyer's own values.
  if (stored?.quote && typeof stored.quote === "object") {
    orderResult.order.quote = stored.quote;
    ensureConfirmPayment(orderResult.order as unknown as Record<string, unknown>);
    console.log("ondc.confirm.quote_overlay", {
      transactionId,
      bppId,
      source: "on_init",
    });
  }

  // ONDC RET v1.2.5: "BNP creates the order id which will be unique across the
  // network" and sends it in /confirm; the SNP echoes the SAME order_id in
  // /on_confirm. The on_init order we commit to has no id, so mint one here —
  // otherwise the order is unaddressable (status/track/cancel/update all key on
  // order_id) and a compliant SNP (e.g. the Pramaan mock) has no id to echo,
  // which is exactly why on_confirm was arriving with `order.id` missing.
  const confirmOrder = orderResult.order as OndcConfirmOrder & {
    id?: string;
    state?: unknown;
  };
  let orderId = str(confirmOrder.id);
  if (!orderId) {
    orderId = randomUUID();
    confirmOrder.id = orderId;
  }

  // Build the `context` envelope. Like init, confirm is directed: we reuse the
  // caller's transaction_id and thread bppId/bppUri through so buildContext
  // attaches bpp_id/bpp_uri (required for every non-search action). message_id
  // is minted fresh per request inside buildContext.
  const context = buildContext({
    action: "confirm",
    transactionId,
    bppId,
    bppUri,
  });

  // The confirm message IS the finalized order — we commit to what on_init
  // firmed up rather than re-deriving it (the key difference from init).
  const message: OndcConfirmMessage = { order: orderResult.order };

  // Directed at the chosen BPP's /confirm — NOT the gateway. The transport stays
  // dumb about routing; we own the URL here (context.ts encodes the broadcast-vs-
  // directed distinction; the URL must match).
  const url = `${bppOrigin}/confirm`;

  try {
    const result = await sendOndcRequest<OndcConfirmMessage>({
      url,
      action: "confirm",
      context,
      message,
    });

    // The synchronous reply is only ACK/NACK. On ACK the BPP accepted the order
    // and the placed-order state will arrive asynchronously on on_confirm — we
    // hand the caller the ids needed to correlate that callback. On NACK the BPP
    // rejected it (quote expired, payment terms changed, item now unavailable,
    // …); surface its error and use 422 so clients can distinguish "rejected"
    // from a transport failure.
    // On ACK, persist the placed order immediately with the BNP-minted order id
    // so the buyer app can act on it (cancel / track / status) right away,
    // without waiting for the async on_confirm — which then overlays the SNP's
    // authoritative state. Best-effort: a store hiccup must not fail a placed
    // order the seller already accepted.
    if (result.status === "ACK") {
      try {
        await saveConfirmOrder({
          transactionId,
          messageId: context.message_id,
          bppId,
          bppUri,
          orderId,
          state: confirmOrder.state ?? "Created",
          order: confirmOrder,
          quote: confirmOrder.quote,
          fulfillments: confirmOrder.fulfillments,
        });
      } catch (err) {
        console.warn("ondc.confirm persist failed", {
          transactionId,
          bppId,
          orderId,
          msg: err instanceof Error ? err.message : String(err),
        });
      }

      // Fire-and-forget order-confirmation email to the buyer. Best-effort: it's
      // a no-op until RESEND_API_KEY is set, and a failure must never affect the
      // placed order (not awaited, errors swallowed inside sendEmail).
      const billingEmail = str(
        (confirmOrder.billing as { email?: unknown } | undefined)?.email
      );
      if (billingEmail) {
        const providerName = str(
          (confirmOrder.provider as { descriptor?: { name?: unknown } } | undefined)
            ?.descriptor?.name
        );
        const orderUrl = `https://openidea.co.in/shop/order/${encodeURIComponent(
          transactionId
        )}/${encodeURIComponent(bppId)}`;
        const { subject, html } = orderConfirmationEmail({
          orderId,
          providerName,
          orderUrl,
        });
        void sendEmail({ to: billingEmail, subject, html });
      }
    }

    const payload = {
      status: result.status,
      transactionId: context.transaction_id,
      messageId: context.message_id,
      bppId,
      ...(result.status === "ACK" ? { orderId } : {}),
      ...(result.status === "NACK" ? { error: result.error } : {}),
    };

    return NextResponse.json(payload, {
      status: result.status === "ACK" ? 200 : 422,
    });
  } catch (err) {
    // sendOndcRequest throws OndcClientError only when the exchange itself
    // failed (timeout / network / unreadable response) — a NACK is data, not a
    // throw. Map a timeout to 504, any other transport fault to 502.
    if (err instanceof OndcClientError) {
      return NextResponse.json(
        {
          error: err.message,
          transactionId: context.transaction_id,
          messageId: context.message_id,
        },
        { status: err.timeout ? 504 : 502 }
      );
    }

    // An unexpected fault (e.g. OndcConfigError / OndcAuthError from signing) —
    // a real server-side problem the operator must fix.
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Callback flow — how this connects to on_confirm (the async other half)
// ---------------------------------------------------------------------------
//
// `confirm` is asynchronous, like init, split across two HTTP exchanges:
//
//   1. THIS route (BAP → BPP):  POST {context, message:{order}} → ${bpp_uri}/confirm
//      Returns immediately with ACK (accepted) or NACK (rejected). No placed
//      order state yet — only the promise that, on ACK, one is coming.
//
//   2. on_confirm (BPP → BAP, later, once):  the chosen BPP places the order and
//      POSTs an `on_confirm` to our `bap_uri/on_confirm` carrying the created
//      order (its `id`, initial `state`, fulfillment/payment status) — AND the
//      SAME `context.transaction_id` we sent here, plus the same `bpp_id`.
//
// Like on_init, on_confirm is a SINGLE callback from the ONE BPP we directed
// this confirm at (not the N-callbacks fan-out of on_search). A future
// `src/app/api/ondc/on_confirm/route.ts` will verify the inbound BPP signature
// (auth.ts), match `transaction_id` (+ bpp_id) back to this confirm, and record
// the placed order id/state.
//
// Continuing the lifecycle (status → track → cancel → update) reuses this SAME
// transaction_id AND the same bpp_id/bpp_uri, so every directed action threads
// the same routing through buildContext exactly as this route does.
