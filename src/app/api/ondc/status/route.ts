// ONDC BAP `status` endpoint — ASKS the BPP for an order's current state.
//
// By the time `status` fires, the buyer has run search → select → init →
// confirm and received an `on_confirm` callback from the chosen BPP (see
// on_confirm/route.ts) carrying the PLACED order and its BPP-assigned `order_id`.
// `status` polls that BPP for where the order is now: its `state`, the
// `fulfillments` (assigned agent / tracking / delivery progress), and the
// `payments` status. The buyer references the order by the `order_id` on_confirm
// introduced — that id is THIS request's entire message.
//
// How this differs from `confirm` (see confirm/route.ts):
//   - Still DIRECTED at the same chosen BPP — POSTs to `${bpp_uri}/status`, not
//     the gateway. The context carries `bpp_id`/`bpp_uri` exactly as confirm did.
//   - `transaction_id` is REUSED (the same id select/init/confirm used) so the
//     BPP and our future on_status handler join this back to the same order
//     lifecycle. REQUIRED in the body, like confirm.
//   - The message is TINY: just `{ order_id }`. confirm threaded a whole
//     finalized order; status only needs the BPP-assigned id of the order to
//     look up — there is nothing to commit, only something to read.
//
// Like confirm, the synchronous reply is ONLY an ACK/NACK. The order's current
// state arrives LATER, asynchronously, as an `on_status` callback POSTed to our
// `bap_uri/on_status` (see the "Callback flow" note at the bottom of this file).
//
// Layering (this route is the thin orchestration seam over the lib):
//   config.ts   → identity + network defaults
//   context.ts  → buildContext("status") → the snake_case `context` envelope
//   client.ts   → sendOndcRequest() → serialize → sign → POST → parse ACK/NACK
// This file owns only: input validation, message assembly, routing to the
// chosen BPP's /status, and shaping the HTTP response our own clients consume.
//
// Mirrors the conventions of the existing routes (confirm, init, select):
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
// status does NOT carry an order — it carries only the BPP-assigned order id to
// look up (on_confirm introduced it; see on_confirm/route.ts). The frontend
// holds that id alongside the routing ids, same as confirm threads the chosen
// ids through. (Why the client supplies it rather than this route resolving it
// by transactionId: on_confirm orders are not persisted yet — see
// on_confirm/route.ts persistOnConfirmOrder, "orders are NOT retained". FUTURE:
// with an order store, this route could load the order_id by transaction_id +
// bpp_id instead of trusting the body.)
//
//   POST /api/ondc/status
//   {
//     "transactionId": "uuid",              // REQUIRED — reuse from confirm
//     "bppId":         "seller-app.x.in",   // REQUIRED — the chosen BPP's id
//     "bppUri":        "https://seller...", // REQUIRED — the chosen BPP's base URI
//     "orderId":       "ORDER-123"          // REQUIRED — BPP-assigned id from on_confirm
//   }
type StatusRequestBody = {
  transactionId?: string;
  bppId?: string;
  bppUri?: string;
  // ONDC retail domain this order routes on (e.g. fashion "ONDC:RET12").
  // Optional: defaults to the app primary/grocery domain (config.domain).
  domain?: string;
  orderId?: string;
};

// The status message in ONDC's snake_case wire shape — just the order id to
// look up. There is nothing else to send: status reads, it does not commit.
type OndcStatusMessage = { order_id: string };

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

// Coerce + trim a possibly-present string field; returns undefined when absent
// or blank, so downstream "is it set?" checks stay simple. (Same as confirm.)
function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t ? t : undefined;
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

  const body = (raw ?? {}) as StatusRequestBody;
  const transactionId = str(body.transactionId);
  const bppId = str(body.bppId);
  const bppUri = str(body.bppUri);
  const domain = str(body.domain);
  const orderId = str(body.orderId);

  // transaction_id is the spine of the lifecycle: status MUST continue the same
  // order session, so it is required here exactly as in confirm. A status with no
  // transaction_id would be orphaned from the order it polls.
  if (!transactionId) {
    return NextResponse.json(
      { error: "'transactionId' is required (reuse the id from confirm)." },
      { status: 400 }
    );
  }

  // bpp_id/bpp_uri identify the chosen provider's BPP. Both are required: status
  // is directed, and buildContext rejects one without the other. We route the
  // request to bppUri, so validate it is an https URL up front.
  if (!bppId || !bppUri) {
    return NextResponse.json(
      { error: "'bppId' and 'bppUri' are required for status." },
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

  // order_id is the BPP-assigned identifier on_confirm introduced — the whole
  // point of a status call is to look THAT order up, so it is required.
  if (!orderId) {
    return NextResponse.json(
      { error: "'orderId' is required (the BPP-assigned id from on_confirm)." },
      { status: 400 }
    );
  }

  // Build the `context` envelope. Like confirm, status is directed: we reuse the
  // caller's transaction_id and thread bppId/bppUri through so buildContext
  // attaches bpp_id/bpp_uri (required for every non-search action). message_id
  // is minted fresh per request inside buildContext.
  const context = buildContext({
    action: "status",
    transactionId,
    bppId,
    bppUri,
    ...(domain ? { domain } : {}),
  });

  // The status message is just the order id to look up — nothing to commit, only
  // something to read (the key difference from confirm).
  const message: OndcStatusMessage = { order_id: orderId };

  // Directed at the chosen BPP's /status — NOT the gateway. The transport stays
  // dumb about routing; we own the URL here (context.ts encodes the broadcast-vs-
  // directed distinction; the URL must match).
  const url = `${bppOrigin}/status`;

  try {
    const result = await sendOndcRequest<OndcStatusMessage>({
      url,
      action: "status",
      context,
      message,
    });

    // The synchronous reply is only ACK/NACK. On ACK the BPP accepted the query
    // and the order's current state will arrive asynchronously on on_status — we
    // hand the caller the ids needed to correlate that callback. On NACK the BPP
    // rejected it (unknown order_id, expired transaction, …); surface its error
    // and use 422 so clients can distinguish "rejected" from a transport failure.
    const payload = {
      status: result.status,
      transactionId: context.transaction_id,
      messageId: context.message_id,
      bppId,
      orderId,
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
// Callback flow — how this connects to on_status (the async other half)
// ---------------------------------------------------------------------------
//
// `status` is asynchronous, like confirm, split across two HTTP exchanges:
//
//   1. THIS route (BAP → BPP):  POST {context, message:{order_id}} → ${bpp_uri}/status
//      Returns immediately with ACK (query accepted) or NACK (rejected). No order
//      state yet — only the promise that, on ACK, one is coming.
//
//   2. on_status (BPP → BAP, later):  the BPP looks up the order and POSTs an
//      `on_status` to our `bap_uri/on_status` carrying the order's current
//      `state`, `fulfillments`, and `payments` status — AND the SAME
//      `context.transaction_id` we sent here, plus the same `bpp_id` and order_id.
//
// Like on_confirm, on_status is a SINGLE callback from the ONE BPP we directed
// this status at (not the N-callbacks fan-out of on_search). A future
// `src/app/api/ondc/on_status/route.ts` will verify the inbound BPP signature
// (auth.ts), match `transaction_id` (+ bpp_id / order_id) back to this status,
// and record the order's latest state.
//
// Continuing the lifecycle (track → cancel → update) reuses this SAME
// transaction_id AND the same bpp_id/bpp_uri AND the same order_id, so every
// directed action threads the same routing through buildContext exactly as this
// route does.
