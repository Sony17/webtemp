// ONDC BAP `cancel` endpoint — ASKS the BPP to cancel a placed order.
//
// By the time `cancel` fires, the buyer has run search → select → init →
// confirm and received an `on_confirm` callback from the chosen BPP carrying the
// PLACED order and its BPP-assigned `order_id`. `cancel` asks that BPP to cancel
// THAT order, citing a `cancellation_reason_id` (an ONDC reason code) and,
// optionally, a free-text `descriptor`.
//
// How this DIFFERS from status/track (see ../status/route.ts, ../track/route.ts):
//   - status/track are read-only POLLS — `{ order_id }` in, a snapshot back, no
//     state change. cancel MUTATES the order: the message carries intent the BPP
//     acts on (the reason), and the callback returns a full updated order with
//     state "Cancelled".
//   - Still DIRECTED at the same chosen BPP — POSTs to `${bpp_uri}/cancel`, not
//     the gateway. The context carries `bpp_id`/`bpp_uri` exactly as status did.
//   - `transaction_id` is REUSED (the same id select/init/confirm used) so the
//     BPP and our on_cancel handler join this back to the same order lifecycle.
//
// Like status, the synchronous reply is ONLY an ACK/NACK. The cancellation
// outcome arrives LATER, asynchronously, as an `on_cancel` callback POSTed to our
// `bap_uri/on_cancel` (see the "Callback flow" note at the bottom of this file).
//
// Layering (this route is the thin orchestration seam over the lib):
//   config.ts   → identity + network defaults
//   context.ts  → buildContext("cancel") → the snake_case `context` envelope
//   client.ts   → sendOndcRequest() → serialize → sign → POST → parse ACK/NACK
// This file owns only: input validation, message assembly, routing to the
// chosen BPP's /cancel, and shaping the HTTP response our own clients consume.
//
// Mirrors the conventions of the existing routes (status, confirm, init, select):
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
// Unlike status/track, cancel carries INTENT: the order to cancel, the reason
// code, and an optional free-text descriptor. The frontend holds order_id (from
// on_confirm) alongside the routing ids.
//
//   POST /api/ondc/cancel
//   {
//     "transactionId":         "uuid",              // REQUIRED — reuse from confirm
//     "bppId":                 "seller-app.x.in",   // REQUIRED — the chosen BPP's id
//     "bppUri":                "https://seller...", // REQUIRED — the chosen BPP's base URI
//     "orderId":               "ORDER-123",         // REQUIRED — BPP-assigned id from on_confirm
//     "cancellationReasonId":  "001",               // REQUIRED — ONDC buyer-cancel reason code
//     "descriptor":            { "short_desc": "" }  // OPTIONAL — free-text / context
//   }
type CancelRequestBody = {
  transactionId?: string;
  bppId?: string;
  bppUri?: string;
  orderId?: string;
  cancellationReasonId?: string;
  // Force-cancellation flag. When true, the cancel message carries the ONDC
  // `params` tag group (force=yes + ttl_response) INSIDE message.descriptor, per
  // the RET10 1.2.5 "Force cancellation" contract. Defaults to a normal cancel.
  force?: boolean;
  // TAT for a valid cancellation response (ISO8601 Duration) — the
  // `ttl_response` entry of the force `params` group. Optional; defaults to the
  // contract's example value "PT1H".
  ttlResponse?: string;
  // Opaque pass-through: ONDC's descriptor (name / short_desc / tags / …). We
  // don't shape it here — whatever the client sends is forwarded as-is (and, for
  // a force cancel, the `params` tag group is merged into it).
  descriptor?: unknown;
};

// One ONDC tag group (code + key/value list) — used for the force-cancel tag.
type OndcTag = {
  code: string;
  list: Array<{ code: string; value: string }>;
};

// The cancel message in ONDC's snake_case wire shape: the order to cancel, the
// reason code, and an optional descriptor. For a force cancel the `params` tag
// group (force + ttl_response) is carried INSIDE `descriptor.tags` per contract
// — there is no message-level `tags`. `descriptor` is omitted from the wire body
// entirely when not applicable (rather than sent as null/empty).
type OndcCancelMessage = {
  order_id: string;
  cancellation_reason_id: string;
  descriptor?: unknown;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

// Coerce + trim a possibly-present string field; returns undefined when absent
// or blank, so downstream "is it set?" checks stay simple. (Same as status.)
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

  const body = (raw ?? {}) as CancelRequestBody;
  const transactionId = str(body.transactionId);
  const bppId = str(body.bppId);
  const bppUri = str(body.bppUri);
  const orderId = str(body.orderId);
  const cancellationReasonId = str(body.cancellationReasonId);

  // transaction_id is the spine of the lifecycle: cancel MUST continue the same
  // order session, so it is required here exactly as in status. A cancel with no
  // transaction_id would be orphaned from the order it cancels.
  if (!transactionId) {
    return NextResponse.json(
      { error: "'transactionId' is required (reuse the id from confirm)." },
      { status: 400 }
    );
  }

  // bpp_id/bpp_uri identify the chosen provider's BPP. Both are required: cancel
  // is directed, and buildContext rejects one without the other. We route the
  // request to bppUri, so validate it is an https URL up front.
  if (!bppId || !bppUri) {
    return NextResponse.json(
      { error: "'bppId' and 'bppUri' are required for cancel." },
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
  // point of a cancel call is to cancel THAT order, so it is required.
  if (!orderId) {
    return NextResponse.json(
      { error: "'orderId' is required (the BPP-assigned id from on_confirm)." },
      { status: 400 }
    );
  }

  // cancellation_reason_id carries WHY — ONDC requires it on a buyer cancel.
  // TODO(ondc-cancel-codes): once the official ONDC Retail v1.2.5 buyer-cancel
  // reason-code set is confirmed, validate membership here (reject an unknown
  // code with 400) so a network NACK is caught locally. For now we only require
  // it to be present and non-empty and let the BPP be the authority.
  if (!cancellationReasonId) {
    return NextResponse.json(
      { error: "'cancellationReasonId' is required (an ONDC cancel reason code)." },
      { status: 400 }
    );
  }

  // Build the `context` envelope. Like status, cancel is directed: we reuse the
  // caller's transaction_id and thread bppId/bppUri through so buildContext
  // attaches bpp_id/bpp_uri (required for every non-search action). message_id
  // is minted fresh per request inside buildContext.
  const context = buildContext({
    action: "cancel",
    transactionId,
    bppId,
    bppUri,
  });

  // The cancel message: the order id, the reason code, and — when applicable —
  // the descriptor.
  const message: OndcCancelMessage = {
    order_id: orderId,
    cancellation_reason_id: cancellationReasonId,
  };

  // Caller-supplied descriptor (opaque). For a fulfillment-level cancel this
  // carries { name:"fulfillment", short_desc:<fulfillment id> } (contract
  // footnotes 692/693); for an order-level cancel it may be absent.
  const callerDescriptor =
    body.descriptor !== undefined &&
    body.descriptor !== null &&
    typeof body.descriptor === "object" &&
    !Array.isArray(body.descriptor)
      ? (body.descriptor as Record<string, unknown>)
      : undefined;

  if (body.force === true) {
    // Force cancellation (contract "Force cancellation"): the `params` tag group
    // — carrying force="yes" and the ttl_response TAT — is attached INSIDE
    // message.descriptor.tags (NOT at the message level). Merge into any caller
    // descriptor, preserving its existing name/short_desc/tags.
    const base = callerDescriptor ? { ...callerDescriptor } : {};
    const existingTags = Array.isArray((base as { tags?: unknown }).tags)
      ? ((base as { tags?: unknown }).tags as OndcTag[])
      : [];
    const paramsTag: OndcTag = {
      code: "params",
      list: [
        { code: "force", value: "yes" },
        { code: "ttl_response", value: str(body.ttlResponse) ?? "PT1H" },
      ],
    };
    message.descriptor = { ...base, tags: [...existingTags, paramsTag] };
  } else if (callerDescriptor !== undefined) {
    // Non-force cancel: forward the caller's descriptor verbatim when present.
    message.descriptor = callerDescriptor;
  } else if (body.descriptor !== undefined && body.descriptor !== null) {
    // Preserve prior behaviour for a non-object descriptor passthrough.
    message.descriptor = body.descriptor;
  }

  // Directed at the chosen BPP's /cancel — NOT the gateway. The transport stays
  // dumb about routing; we own the URL here (context.ts encodes the broadcast-vs-
  // directed distinction; the URL must match).
  const url = `${bppOrigin}/cancel`;

  try {
    const result = await sendOndcRequest<OndcCancelMessage>({
      url,
      action: "cancel",
      context,
      message,
    });

    // The synchronous reply is only ACK/NACK. On ACK the BPP accepted the cancel
    // request and the cancelled order will arrive asynchronously on on_cancel — we
    // hand the caller the ids needed to correlate that callback. On NACK the BPP
    // rejected it (unknown order_id, non-cancellable state, bad reason code, …);
    // surface its error and use 422 so clients can distinguish "rejected" from a
    // transport failure.
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
// Callback flow — how this connects to on_cancel (the async other half)
// ---------------------------------------------------------------------------
//
// `cancel` is asynchronous, like status, split across two HTTP exchanges:
//
//   1. THIS route (BAP → BPP):  POST {context, message:{order_id, reason}} →
//      ${bpp_uri}/cancel. Returns immediately with ACK (request accepted) or
//      NACK (rejected). No cancelled order yet — only the promise that, on ACK,
//      one is coming.
//
//   2. on_cancel (BPP → BAP, later):  the BPP cancels the order and POSTs an
//      `on_cancel` to our `bap_uri/on_cancel` carrying the FULL updated order
//      (state "Cancelled", a `cancellation` block with cancelled_by / reason.id,
//      plus quote/payments reflecting any charges/refunds) — AND the SAME
//      `context.transaction_id` we sent here, plus the same `bpp_id` / order_id.
//
// NOTE: on_cancel may also arrive UNSOLICITED — a seller can force-cancel an
// order without a preceding buyer /cancel. Our on_cancel route handles that case
// (it does not assume a prior cancel). See src/app/api/ondc/on_cancel/route.ts.
