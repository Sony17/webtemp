// ONDC BAP `support` endpoint — ASKS the BPP for support contact channels.
//
// `support` is a lightweight, post-order ancillary action: the buyer needs help
// with something (an order, a fulfillment, or general assistance) and asks the
// chosen BPP for how to reach support. The message is a single `ref_id` naming
// the subject of the request — typically the BPP-assigned `order_id` from
// on_confirm, or the `transaction_id` for a session-level query.
//
// SCOPE: this is contact-channel DISCOVERY only — the BPP replies (on on_support)
// with a phone / email / uri. It is deliberately NOT ONDC's IGM (Issue &
// Grievance Management: /issue, /on_issue, /issue_status) flow, which is a
// separate, heavier spec. We do not model grievances here.
//
// How this DIFFERS from cancel/update (see ../cancel/route.ts, ../update/route.ts):
//   - cancel/update MUTATE the order and their callbacks carry the full updated
//     order. support changes nothing and its callback carries NO order — only
//     contact channels. So support data is persisted STANDALONE, never attached
//     to the order (see ../on_support/route.ts + store.ts SupportRecord).
//   - Still DIRECTED at the chosen BPP — POSTs to `${bpp_uri}/support`, not the
//     gateway. The context carries `bpp_id`/`bpp_uri` exactly as cancel did.
//   - `transaction_id` is REUSED (the lifecycle spine) so the BPP and our
//     on_support handler join this back to the same session.
//
// Like cancel, the synchronous reply is ONLY an ACK/NACK. The contact channels
// arrive LATER, asynchronously, as an `on_support` callback POSTed to our
// `bap_uri/on_support` (see the "Callback flow" note at the bottom of this file).
//
// Layering (this route is the thin orchestration seam over the lib):
//   config.ts   → identity + network defaults
//   context.ts  → buildContext("support") → the snake_case `context` envelope
//   client.ts   → sendOndcRequest() → serialize → sign → POST → parse ACK/NACK
// This file owns only: input validation, message assembly, routing to the
// chosen BPP's /support, and shaping the HTTP response our own clients consume.
//
// Mirrors the conventions of the existing routes (cancel, update, status, confirm):
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
// support carries a single `refId` — the subject the buyer wants support for
// (the order_id from on_confirm, or the transaction_id for a session query). The
// frontend holds it alongside the routing ids, same as cancel threads order_id.
//
//   POST /api/ondc/support
//   {
//     "transactionId": "uuid",              // REQUIRED — reuse from confirm
//     "bppId":         "seller-app.x.in",   // REQUIRED — the chosen BPP's id
//     "bppUri":        "https://seller...", // REQUIRED — the chosen BPP's base URI
//     "refId":         "ORDER-123"          // REQUIRED — subject id (order_id / transaction_id)
//   }
type SupportRequestBody = {
  transactionId?: string;
  bppId?: string;
  bppUri?: string;
  refId?: string;
};

// The support message in ONDC's snake_case wire shape: just the subject id.
type OndcSupportMessage = {
  ref_id: string;
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

  const body = (raw ?? {}) as SupportRequestBody;
  const transactionId = str(body.transactionId);
  const bppId = str(body.bppId);
  const bppUri = str(body.bppUri);
  const refId = str(body.refId);

  // transaction_id is the spine of the lifecycle: support MUST continue the same
  // session, so it is required here exactly as in cancel. A support call with no
  // transaction_id would be orphaned from the session it queries.
  if (!transactionId) {
    return NextResponse.json(
      { error: "'transactionId' is required (reuse the id from confirm)." },
      { status: 400 }
    );
  }

  // bpp_id/bpp_uri identify the chosen provider's BPP. Both are required: support
  // is directed, and buildContext rejects one without the other. We route the
  // request to bppUri, so validate it is an https URL up front.
  if (!bppId || !bppUri) {
    return NextResponse.json(
      { error: "'bppId' and 'bppUri' are required for support." },
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

  // ref_id names WHAT the buyer needs support for — ONDC requires it on a support
  // request. It is the order_id (post-confirm) or the transaction_id (session
  // query); we require it to be present and non-empty and let the BPP resolve it.
  if (!refId) {
    return NextResponse.json(
      {
        error:
          "'refId' is required (the subject id — an order_id or transaction_id).",
      },
      { status: 400 }
    );
  }

  // Build the `context` envelope. Like cancel, support is directed: we reuse the
  // caller's transaction_id and thread bppId/bppUri through so buildContext
  // attaches bpp_id/bpp_uri (required for every non-search action). message_id
  // is minted fresh per request inside buildContext.
  const context = buildContext({
    action: "support",
    transactionId,
    bppId,
    bppUri,
  });

  // The support message: just the subject id.
  const message: OndcSupportMessage = { ref_id: refId };

  // Directed at the chosen BPP's /support — NOT the gateway. The transport stays
  // dumb about routing; we own the URL here (context.ts encodes the broadcast-vs-
  // directed distinction; the URL must match).
  const url = `${bppOrigin}/support`;

  try {
    const result = await sendOndcRequest<OndcSupportMessage>({
      url,
      action: "support",
      context,
      message,
    });

    // The synchronous reply is only ACK/NACK. On ACK the BPP accepted the request
    // and the contact channels will arrive asynchronously on on_support — we hand
    // the caller the ids needed to correlate that callback. On NACK the BPP
    // rejected it (unknown ref_id, …); surface its error and use 422 so clients
    // can distinguish "rejected" from a transport failure.
    const payload = {
      status: result.status,
      transactionId: context.transaction_id,
      messageId: context.message_id,
      bppId,
      refId,
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
// Callback flow — how this connects to on_support (the async other half)
// ---------------------------------------------------------------------------
//
// `support` is asynchronous, like cancel, split across two HTTP exchanges:
//
//   1. THIS route (BAP → BPP):  POST {context, message:{ref_id}} →
//      ${bpp_uri}/support. Returns immediately with ACK (request accepted) or
//      NACK (rejected). No contact channels yet — only the promise that, on ACK,
//      they are coming.
//
//   2. on_support (BPP → BAP, later):  the BPP POSTs an `on_support` to our
//      `bap_uri/on_support` carrying the contact channels (`phone` / `email` /
//      `uri`) — AND the SAME `context.transaction_id` we sent here, plus the same
//      `bpp_id`. There is NO order in the callback, so it is persisted standalone
//      keyed by (transaction_id, bpp_id). See src/app/api/ondc/on_support/route.ts.
