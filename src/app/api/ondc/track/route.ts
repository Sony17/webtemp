// ONDC BAP `track` endpoint — ASKS the BPP for an order's tracking handle.
//
// By the time `track` fires, the buyer has run search → select → init →
// confirm and received an `on_confirm` callback from the chosen BPP carrying the
// PLACED order and its BPP-assigned `order_id`. `track` asks that BPP how to
// follow the order in flight: a tracking `url`, optionally a live `location`,
// and whether tracking is `active`. The buyer references the order by the
// `order_id` on_confirm introduced — that id is THIS request's entire message.
//
// How this relates to `status` (see ../status/route.ts):
//   - Same DIRECTED shape — POSTs to `${bpp_uri}/track`, not the gateway. The
//     context carries `bpp_id`/`bpp_uri` exactly as status did.
//   - `transaction_id` is REUSED (the same id select/init/confirm/status used) so
//     the BPP and our on_track handler join this back to the same order lifecycle.
//   - The message is TINY — just `{ order_id }`, byte-for-byte the same envelope
//     status sends. track reads, it does not commit.
//
// Like status, the synchronous reply is ONLY an ACK/NACK. The tracking handle
// arrives LATER, asynchronously, as an `on_track` callback POSTed to our
// `bap_uri/on_track` (see the "Callback flow" note at the bottom of this file).
//
// Layering (this route is the thin orchestration seam over the lib):
//   config.ts   → identity + network defaults
//   context.ts  → buildContext("track") → the snake_case `context` envelope
//   client.ts   → sendOndcRequest() → serialize → sign → POST → parse ACK/NACK
// This file owns only: input validation, message assembly, routing to the
// chosen BPP's /track, and shaping the HTTP response our own clients consume.
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
// track does NOT carry an order — it carries only the BPP-assigned order id to
// track (on_confirm introduced it). The frontend holds that id alongside the
// routing ids, same as status threads the chosen ids through.
//
// FUTURE: with confirm orders now persisted in the store (saveConfirmOrder + the
// orderId index, see src/lib/ondc/store.ts), this route could resolve order_id
// from (transactionId, bppId) via getOrder() instead of trusting the body. We
// keep it a required body field for now, matching the status API exactly.
//
//   POST /api/ondc/track
//   {
//     "transactionId": "uuid",              // REQUIRED — reuse from confirm/status
//     "bppId":         "seller-app.x.in",   // REQUIRED — the chosen BPP's id
//     "bppUri":        "https://seller...", // REQUIRED — the chosen BPP's base URI
//     "orderId":       "ORDER-123"          // REQUIRED — BPP-assigned id from on_confirm
//   }
type TrackRequestBody = {
  transactionId?: string;
  bppId?: string;
  bppUri?: string;
  // ONDC retail domain this order routes on (e.g. fashion "ONDC:RET12").
  // Optional: defaults to the app primary/grocery domain (config.domain).
  domain?: string;
  orderId?: string;
};

// The track message in ONDC's snake_case wire shape — just the order id to
// track. There is nothing else to send: track reads, it does not commit.
// (Beckn permits an optional callback_url; ONDC Retail omits it — the BPP uses
// our bap_uri/on_track — so we don't send it.)
type OndcTrackMessage = { order_id: string };

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

  const body = (raw ?? {}) as TrackRequestBody;
  const transactionId = str(body.transactionId);
  const bppId = str(body.bppId);
  const bppUri = str(body.bppUri);
  const domain = str(body.domain);
  const orderId = str(body.orderId);

  // transaction_id is the spine of the lifecycle: track MUST continue the same
  // order session, so it is required here exactly as in status. A track with no
  // transaction_id would be orphaned from the order it follows.
  if (!transactionId) {
    return NextResponse.json(
      { error: "'transactionId' is required (reuse the id from confirm)." },
      { status: 400 }
    );
  }

  // bpp_id/bpp_uri identify the chosen provider's BPP. Both are required: track
  // is directed, and buildContext rejects one without the other. We route the
  // request to bppUri, so validate it is an https URL up front.
  if (!bppId || !bppUri) {
    return NextResponse.json(
      { error: "'bppId' and 'bppUri' are required for track." },
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
  // point of a track call is to follow THAT order, so it is required.
  if (!orderId) {
    return NextResponse.json(
      { error: "'orderId' is required (the BPP-assigned id from on_confirm)." },
      { status: 400 }
    );
  }

  // Build the `context` envelope. Like status, track is directed: we reuse the
  // caller's transaction_id and thread bppId/bppUri through so buildContext
  // attaches bpp_id/bpp_uri (required for every non-search action). message_id
  // is minted fresh per request inside buildContext.
  const context = buildContext({
    action: "track",
    transactionId,
    bppId,
    bppUri,
    ...(domain ? { domain } : {}),
  });

  // The track message is just the order id to follow — nothing to commit, only
  // something to read (same as status).
  const message: OndcTrackMessage = { order_id: orderId };

  // Directed at the chosen BPP's /track — NOT the gateway. The transport stays
  // dumb about routing; we own the URL here (context.ts encodes the broadcast-vs-
  // directed distinction; the URL must match).
  const url = `${bppOrigin}/track`;

  try {
    const result = await sendOndcRequest<OndcTrackMessage>({
      url,
      action: "track",
      context,
      message,
    });

    // The synchronous reply is only ACK/NACK. On ACK the BPP accepted the query
    // and the tracking handle will arrive asynchronously on on_track — we hand
    // the caller the ids needed to correlate that callback. On NACK the BPP
    // rejected it (unknown order_id, tracking unavailable, …); surface its error
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
// Callback flow — how this connects to on_track (the async other half)
// ---------------------------------------------------------------------------
//
// `track` is asynchronous, like status, split across two HTTP exchanges:
//
//   1. THIS route (BAP → BPP):  POST {context, message:{order_id}} → ${bpp_uri}/track
//      Returns immediately with ACK (query accepted) or NACK (rejected). No
//      tracking handle yet — only the promise that, on ACK, one is coming.
//
//   2. on_track (BPP → BAP, later):  the BPP POSTs an `on_track` to our
//      `bap_uri/on_track` carrying a `tracking` object (url / live location /
//      active|inactive status / tags) — AND the SAME `context.transaction_id` we
//      sent here, plus the same `bpp_id`.
//
// KEY DIFFERENCE from on_status: on_track carries NO order / order_id in its
// message — only `tracking`. So the callback is correlated to its order purely
// by (transaction_id, bpp_id), the lifecycle spine. During LIVE tracking a BPP
// may also push MANY on_track callbacks unprompted (status flipping
// active/inactive, location refreshes); our store keeps the latest
// (last-write-wins). See src/app/api/ondc/on_track/route.ts.
