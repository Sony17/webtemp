// ONDC BAP `rating` endpoint — SUBMITS the buyer's rating(s) to the BPP.
//
// `rating` is a lightweight, post-order ancillary action: after fulfilment the
// buyer rates one or more entities of the order — the order itself, a
// fulfilment, the provider, an item, the delivery agent. The message carries a
// `ratings` array; each entry names WHAT is rated (`id`), the KIND of thing it
// is (`rating_category`), and the SCORE (`value`, 1–5).
//
// How this DIFFERS from cancel/update (see ../cancel/route.ts, ../update/route.ts):
//   - cancel/update MUTATE the order and their callbacks carry the full updated
//     order. rating changes nothing about the order and its callback (on_rating)
//     carries NO order — only an optional `feedback_form` (a follow-up form the
//     buyer MAY fill in) and/or ack flags. So rating's callback data is persisted
//     STANDALONE, never attached to the order (see ../on_rating/route.ts +
//     store.ts RatingRecord). This is the SAME shape as support/on_support.
//   - Still DIRECTED at the chosen BPP — POSTs to `${bpp_uri}/rating`, not the
//     gateway. The context carries `bpp_id`/`bpp_uri` exactly as cancel did.
//   - `transaction_id` is REUSED (the lifecycle spine) so the BPP and our
//     on_rating handler join this back to the same order session.
//
// Like cancel/support, the synchronous reply is ONLY an ACK/NACK. The feedback
// form arrives LATER, asynchronously, as an `on_rating` callback POSTed to our
// `bap_uri/on_rating` (see the "Callback flow" note at the bottom of this file).
//
// CONTRACT NOTES (ONDC Retail 1.2.5 — see the architectural review):
//   - `rating_category` is NOT a fixed enum in the 1.2.5 spec. A seller declares
//     which entities it accepts ratings for; an unsupported one is rejected with
//     ONDC error 50003 "Unsupported rating category". So we require it to be a
//     non-empty string and let the BPP be the authority — exactly how cancel
//     treats `cancellation_reason_id` (see ../cancel/route.ts).
//   - `value` is a number in [1,5] per the spec's `Rating` schema
//     (build.yaml: `value: number, minimum 1, maximum 5`). We accept a number or
//     a numeric string from our own clients, validate it is an integer 1–5, and
//     send it on the wire as a NUMBER. (Some networks have historically sent it
//     as a string; if a BPP NACKs with 30015 "Invalid rating value", flipping the
//     wire type is a one-line change — see the OUTSTANDING RISKS note below.)
//
// Layering (this route is the thin orchestration seam over the lib):
//   config.ts   → identity + network defaults
//   context.ts  → buildContext("rating") → the snake_case `context` envelope
//   client.ts   → sendOndcRequest() → serialize → sign → POST → parse ACK/NACK
// This file owns only: input validation, message assembly, routing to the
// chosen BPP's /rating, and shaping the HTTP response our own clients consume.
//
// Mirrors the conventions of the existing routes (support, cancel, update):
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
// rating carries a `ratings` array — one entry per entity the buyer scored. The
// frontend holds the entity ids (order_id from on_confirm, fulfilment/provider/
// item ids from the catalog/order) alongside the routing ids.
//
//   POST /api/ondc/rating
//   {
//     "transactionId": "uuid",              // REQUIRED — reuse from confirm
//     "bppId":         "seller-app.x.in",   // REQUIRED — the chosen BPP's id
//     "bppUri":        "https://seller...", // REQUIRED — the chosen BPP's base URI
//     "ratings": [                          // REQUIRED — at least one entry
//       {
//         "id":             "ORDER-123",    // REQUIRED — id of the rated entity
//         "ratingCategory": "Order",        // REQUIRED — kind of entity (seller-defined)
//         "value":          5               // REQUIRED — integer 1..5 (number or numeric string)
//       }
//     ]
//   }
type RatingInputItem = {
  id?: unknown;
  ratingCategory?: unknown;
  value?: unknown;
};

type RatingRequestBody = {
  transactionId?: string;
  bppId?: string;
  bppUri?: string;
  // ONDC retail domain this order routes on (e.g. fashion "ONDC:RET12").
  // Optional: defaults to the app primary/grocery domain (config.domain).
  domain?: string;
  ratings?: unknown;
};

// One rating in ONDC's snake_case wire shape.
type OndcRatingItem = {
  id: string;
  rating_category: string;
  value: number;
};

// The rating message in ONDC's snake_case wire shape: the ratings array.
type OndcRatingMessage = {
  ratings: OndcRatingItem[];
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

// Coerce + trim a possibly-present string field; returns undefined when absent
// or blank, so downstream "is it set?" checks stay simple. (Same as support.)
function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t ? t : undefined;
}

// Coerce a rating value (number OR numeric string) to an integer in [1,5], or
// null when it is missing / non-numeric / out of range / fractional. ONDC's
// scale is the five integers 1–5, so we reject anything else up front rather
// than let the BPP NACK it (error 30015).
function ratingValue(value: unknown): number | null {
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string" && value.trim() !== "") {
    n = Number(value);
  } else {
    return null;
  }
  if (!Number.isInteger(n) || n < 1 || n > 5) return null;
  return n;
}

// Validate the ratings array into wire-shaped items, or return an error string
// naming the first problem (with its index) so the caller gets an actionable 400.
function parseRatings(
  raw: unknown
): { ok: true; ratings: OndcRatingItem[] } | { ok: false; reason: string } {
  if (!Array.isArray(raw)) {
    return { ok: false, reason: "'ratings' must be a non-empty array." };
  }
  if (raw.length === 0) {
    return { ok: false, reason: "'ratings' must contain at least one rating." };
  }

  const ratings: OndcRatingItem[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = (raw[i] ?? {}) as RatingInputItem;
    const id = str(item.id);
    if (!id) {
      return { ok: false, reason: `ratings[${i}].id is required (the rated entity's id).` };
    }
    // rating_category is seller-defined (no fixed 1.2.5 enum); require presence
    // only and let the BPP reject unsupported categories (error 50003).
    const ratingCategory = str(item.ratingCategory);
    if (!ratingCategory) {
      return {
        ok: false,
        reason: `ratings[${i}].ratingCategory is required (e.g. Order, Fulfillment, Provider, Item, Agent).`,
      };
    }
    const value = ratingValue(item.value);
    if (value === null) {
      return {
        ok: false,
        reason: `ratings[${i}].value must be an integer from 1 to 5.`,
      };
    }
    ratings.push({ id, rating_category: ratingCategory, value });
  }
  return { ok: true, ratings };
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

  const body = (raw ?? {}) as RatingRequestBody;
  const transactionId = str(body.transactionId);
  const bppId = str(body.bppId);
  const bppUri = str(body.bppUri);
  const domain = str(body.domain);

  // transaction_id is the spine of the lifecycle: rating MUST continue the same
  // order session, so it is required here exactly as in support/cancel. A rating
  // with no transaction_id would be orphaned from the order it scores.
  if (!transactionId) {
    return NextResponse.json(
      { error: "'transactionId' is required (reuse the id from confirm)." },
      { status: 400 }
    );
  }

  // bpp_id/bpp_uri identify the chosen provider's BPP. Both are required: rating
  // is directed, and buildContext rejects one without the other. We route the
  // request to bppUri, so validate it is an https URL up front.
  if (!bppId || !bppUri) {
    return NextResponse.json(
      { error: "'bppId' and 'bppUri' are required for rating." },
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

  // The ratings array names WHAT the buyer scored — ONDC requires at least one.
  // We validate each entry's id / category / value up front so a malformed
  // submission fails locally with a precise message instead of a network NACK.
  const parsedRatings = parseRatings(body.ratings);
  if (!parsedRatings.ok) {
    return NextResponse.json({ error: parsedRatings.reason }, { status: 400 });
  }

  // Build the `context` envelope. Like support, rating is directed: we reuse the
  // caller's transaction_id and thread bppId/bppUri through so buildContext
  // attaches bpp_id/bpp_uri (required for every non-search action). message_id
  // is minted fresh per request inside buildContext.
  const context = buildContext({
    action: "rating",
    transactionId,
    bppId,
    bppUri,
    ...(domain ? { domain } : {}),
  });

  // The rating message: the validated ratings array.
  const message: OndcRatingMessage = { ratings: parsedRatings.ratings };

  // Directed at the chosen BPP's /rating — NOT the gateway. The transport stays
  // dumb about routing; we own the URL here (context.ts encodes the broadcast-vs-
  // directed distinction; the URL must match).
  const url = `${bppOrigin}/rating`;

  try {
    const result = await sendOndcRequest<OndcRatingMessage>({
      url,
      action: "rating",
      context,
      message,
    });

    // The synchronous reply is only ACK/NACK. On ACK the BPP accepted the rating
    // and an optional feedback form will arrive asynchronously on on_rating — we
    // hand the caller the ids needed to correlate that callback. On NACK the BPP
    // rejected it (unsupported category 50003, invalid value 30015, …); surface
    // its error and use 422 so clients can distinguish "rejected" from a
    // transport failure.
    const payload = {
      status: result.status,
      transactionId: context.transaction_id,
      messageId: context.message_id,
      bppId,
      ratings: parsedRatings.ratings,
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
// Callback flow — how this connects to on_rating (the async other half)
// ---------------------------------------------------------------------------
//
// `rating` is asynchronous, like support, split across two HTTP exchanges:
//
//   1. THIS route (BAP → BPP):  POST {context, message:{ratings:[…]}} →
//      ${bpp_uri}/rating. Returns immediately with ACK (rating accepted) or
//      NACK (rejected). No feedback form yet — only the promise that, on ACK,
//      one MAY be coming.
//
//   2. on_rating (BPP → BAP, later):  the BPP POSTs an `on_rating` to our
//      `bap_uri/on_rating` carrying an optional `feedback_form` (a follow-up form
//      the buyer may fill in) and/or ack flags (`feedback_ack` / `rating_ack`) —
//      AND the SAME `context.transaction_id` we sent here, plus the same
//      `bpp_id`. There is NO order in the callback, so it is persisted standalone
//      keyed by (transaction_id, bpp_id). See src/app/api/ondc/on_rating/route.ts.
//
// ---------------------------------------------------------------------------
// OUTSTANDING RISKS / spec ambiguities (carried from the architectural review)
// ---------------------------------------------------------------------------
//   - value WIRE TYPE: the 1.2.5 `Rating` schema declares `value` as a number,
//     so we send a number. Historically some networks accepted/expected a string
//     ("5"). If a BPP NACKs with 30015, change the wire type in OndcRatingItem +
//     the message assembly to a string — the validation already guarantees an
//     integer 1–5, so it is a one-line, safe flip.
//   - rating_category VOCAB: not enumerated in 1.2.5; we forward whatever the
//     client sends and rely on the BPP (error 50003) as the authority. A future
//     hardening could validate against a configured per-BPP supported set.
