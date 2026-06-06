// ONDC BAP `update` endpoint — ASKS the BPP to MODIFY a placed order.
//
// By the time `update` fires, the buyer has run search → select → init →
// confirm and received an `on_confirm` callback from the chosen BPP carrying the
// PLACED order and its BPP-assigned `order_id`. `update` asks that BPP to change
// some facet of THAT order — most commonly payment settlement, fulfillment
// details (e.g. a rescheduled slot or changed address), or a line item — naming
// WHAT is changing via `update_target` and carrying the changed order facets in
// `order`.
//
// GENERIC by design: this route is NOT a returns engine or a replacement engine.
// ONDC layers return/replacement/part-cancel flows on top of `update` with
// specific `update_target` values and fulfillment sub-states, but we do not model
// any of those specially — we forward whatever `update_target` and `order` the
// caller supplies, opaquely. The BPP is the authority on what each target means.
//
// How this DIFFERS from cancel/status (see ../cancel/route.ts, ../status/route.ts):
//   - status/track are read-only POLLS; cancel mutates toward a single terminal
//     state. `update` is the GENERAL mutation: the message carries both WHAT to
//     change (`update_target`) and the changed order facets, and the BPP applies
//     them and returns the full updated order on on_update.
//   - Still DIRECTED at the same chosen BPP — POSTs to `${bpp_uri}/update`, not
//     the gateway. The context carries `bpp_id`/`bpp_uri` exactly as cancel did.
//   - `transaction_id` is REUSED (the same id select/init/confirm used) so the
//     BPP and our on_update handler join this back to the same order lifecycle.
//
// Like cancel, the synchronous reply is ONLY an ACK/NACK. The updated order
// arrives LATER, asynchronously, as an `on_update` callback POSTed to our
// `bap_uri/on_update` (see the "Callback flow" note at the bottom of this file).
//
// Layering (this route is the thin orchestration seam over the lib):
//   config.ts   → identity + network defaults
//   context.ts  → buildContext("update") → the snake_case `context` envelope
//   client.ts   → sendOndcRequest() → serialize → sign → POST → parse ACK/NACK
// This file owns only: input validation, message assembly, routing to the
// chosen BPP's /update, and shaping the HTTP response our own clients consume.
//
// Mirrors the conventions of the existing routes (cancel, confirm, init, select):
// `NextResponse`, `runtime = "nodejs"`, JSON-body parsing with a 400 guard.
import { NextResponse } from "next/server";
import { isOndcConfigured } from "@/lib/ondc/config";
import { buildContext } from "@/lib/ondc/context";
import { sendOndcRequest, OndcClientError } from "@/lib/ondc/client";

// ONDC signing uses node:crypto (via auth.ts), and the whole ondc/* stack is
// `import "server-only"` — so this handler must run on the Node runtime, not
// the Edge runtime. Same choice as the other API routes in this app.
export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Request shape (what our own frontend/clients POST to this route)
// ---------------------------------------------------------------------------
//
// `update` carries TWO things: `updateTarget` (WHAT facet is changing) and the
// changed `order` (which must at least carry the BPP-assigned `id`, plus the
// facets being updated — payments/fulfillments/items/…). The frontend holds the
// order from on_confirm/on_status and threads the changed version back, same as
// confirm threads the finalized order. The order is forwarded OPAQUELY; we only
// require it to identify itself (order.id) — its contents are the BPP's concern.
//
//   POST /api/ondc/update
//   {
//     "transactionId": "uuid",              // REQUIRED — reuse from confirm
//     "bppId":         "seller-app.x.in",   // REQUIRED — the chosen BPP's id
//     "bppUri":        "https://seller...", // REQUIRED — the chosen BPP's base URI
//     "updateTarget":  "payment",           // REQUIRED — ONDC update_target (csv allowed)
//     "order": {                             // REQUIRED — the changed order (opaque)
//       "id":       "ORDER-123",             // REQUIRED — BPP-assigned id from on_confirm
//       "payments": [ { ... } ],             // the facet(s) being updated
//       ...
//     }
//   }
type UpdateRequestBody = {
  transactionId?: string;
  bppId?: string;
  bppUri?: string;
  updateTarget?: string;
  order?: unknown;
};

// The update message in ONDC's snake_case wire shape: `update_target` (the facet
// selector) and the changed `order` (passed through opaquely). `order.id` is the
// only field we assert; everything else is forwarded verbatim.
type OndcUpdateOrder = {
  id?: unknown;
};

type OndcUpdateMessage = {
  update_target: string;
  order: OndcUpdateOrder;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

// Coerce + trim a possibly-present string field; returns undefined when absent
// or blank, so downstream "is it set?" checks stay simple. (Same as cancel.)
function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t ? t : undefined;
}

// Validate the changed `order` from the request body. `update` forwards the order
// opaquely, so the ONLY structural requirement is that it carries the BPP-assigned
// `id` (so the BPP knows which order to apply the change to). Returns the order or
// an error message naming the first problem, keeping the handler linear.
function validateOrder(
  raw: unknown
): { ok: true; order: OndcUpdateOrder } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "'order' (the changed order) is required." };
  }
  const order = raw as OndcUpdateOrder;
  if (!str(order.id)) {
    return {
      ok: false,
      reason: "'order.id' is required (the BPP-assigned id from on_confirm).",
    };
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

  const body = (raw ?? {}) as UpdateRequestBody;
  const transactionId = str(body.transactionId);
  const bppId = str(body.bppId);
  const bppUri = str(body.bppUri);
  const updateTarget = str(body.updateTarget);

  // transaction_id is the spine of the lifecycle: update MUST continue the same
  // order session, so it is required here exactly as in cancel. An update with no
  // transaction_id would be orphaned from the order it changes.
  if (!transactionId) {
    return NextResponse.json(
      { error: "'transactionId' is required (reuse the id from confirm)." },
      { status: 400 }
    );
  }

  // bpp_id/bpp_uri identify the chosen provider's BPP. Both are required: update
  // is directed, and buildContext rejects one without the other. We route the
  // request to bppUri, so validate it is an https URL up front.
  if (!bppId || !bppUri) {
    return NextResponse.json(
      { error: "'bppId' and 'bppUri' are required for update." },
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

  // update_target names WHICH facet is changing — ONDC requires it on an update.
  // It is a comma-separated list of targets (e.g. "payment", "fulfillment",
  // "item", "billing"). We require it to be present and non-empty and let the BPP
  // be the authority on which targets/values it accepts (generic pass-through).
  if (!updateTarget) {
    return NextResponse.json(
      {
        error:
          "'updateTarget' is required (the ONDC update_target, e.g. 'payment').",
      },
      { status: 400 }
    );
  }

  const orderResult = validateOrder(body.order);
  if (!orderResult.ok) {
    return NextResponse.json({ error: orderResult.reason }, { status: 400 });
  }

  // Build the `context` envelope. Like cancel, update is directed: we reuse the
  // caller's transaction_id and thread bppId/bppUri through so buildContext
  // attaches bpp_id/bpp_uri (required for every non-search action). message_id
  // is minted fresh per request inside buildContext.
  const context = buildContext({
    action: "update",
    transactionId,
    bppId,
    bppUri,
  });

  // The update message: the target selector and the changed order (opaque).
  const message: OndcUpdateMessage = {
    update_target: updateTarget,
    order: orderResult.order,
  };

  // Directed at the chosen BPP's /update — NOT the gateway. The transport stays
  // dumb about routing; we own the URL here (context.ts encodes the broadcast-vs-
  // directed distinction; the URL must match).
  const url = `${bppOrigin}/update`;

  try {
    const result = await sendOndcRequest<OndcUpdateMessage>({
      url,
      action: "update",
      context,
      message,
    });

    // The synchronous reply is only ACK/NACK. On ACK the BPP accepted the update
    // request and the updated order will arrive asynchronously on on_update — we
    // hand the caller the ids needed to correlate that callback. On NACK the BPP
    // rejected it (unknown order_id, non-updatable state, unsupported target, …);
    // surface its error and use 422 so clients can distinguish "rejected" from a
    // transport failure.
    const payload = {
      status: result.status,
      transactionId: context.transaction_id,
      messageId: context.message_id,
      bppId,
      orderId: orderResult.order.id,
      updateTarget,
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
// Callback flow — how this connects to on_update (the async other half)
// ---------------------------------------------------------------------------
//
// `update` is asynchronous, like cancel, split across two HTTP exchanges:
//
//   1. THIS route (BAP → BPP):  POST {context, message:{update_target, order}} →
//      ${bpp_uri}/update. Returns immediately with ACK (request accepted) or
//      NACK (rejected). No updated order yet — only the promise that, on ACK,
//      one is coming.
//
//   2. on_update (BPP → BAP, later):  the BPP applies the change and POSTs an
//      `on_update` to our `bap_uri/on_update` carrying the FULL updated order
//      (the new `state`, and the updated `payments` / `fulfillments` reflecting
//      the change) — AND the SAME `context.transaction_id` we sent here, plus the
//      same `bpp_id` / order id.
//
// NOTE: on_update may also arrive UNSOLICITED — a BPP can push an order update
// (e.g. a settlement or fulfillment change) without a preceding buyer /update.
// Our on_update route handles that case (it does not assume a prior update). See
// src/app/api/ondc/on_update/route.ts.
