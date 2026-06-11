// ONDC BAP `search` endpoint — the entry point of every Retail order lifecycle.
//
// This is the first ONDC action a buyer app fires: it broadcasts a discovery
// intent to the gateway, which fans it out to every BPP on the network. The
// HTTP call here returns ONLY a synchronous ACK/NACK (did the gateway accept
// the search?) — the actual catalogs arrive LATER, asynchronously, as one or
// more `on_search` callbacks POSTed to our `bap_uri/on_search` (see the
// "Callback flow" note at the bottom of this file).
//
// Layering (this route is the thin orchestration seam over the lib):
//   config.ts   → identity + gatewayUrl + network defaults
//   context.ts  → buildContext("search") → the snake_case `context` envelope
//   client.ts   → sendOndcRequest() → serialize → sign → POST → parse ACK/NACK
// This file owns only: input validation, message assembly, routing to the
// gateway's /search, and shaping the HTTP response our own clients consume.
//
// Mirrors the conventions of the existing routes (deployments, upload):
// `NextResponse`, `runtime = "nodejs"`, JSON-body parsing with a 400 guard.
import { NextResponse } from "next/server";
import { getOndcConfig, isOndcConfigured } from "@/lib/ondc/config";
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
// This is OUR ergonomic input — NOT the ONDC wire format. We translate it into
// an ONDC `intent` below so callers never have to know the protocol's shape.
//
//   POST /api/ondc/search
//   {
//     "query":            "basmati rice",   // free-text item search (optional*)
//     "category":         "Foodgrains",     // ONDC category id        (optional*)
//     "deliveryGps":      "12.9716,77.5946",// "lat,long"              (optional)
//     "deliveryAreaCode": "560001",         // delivery pincode        (optional)
//     "transactionId":    "uuid"            // reuse an existing flow  (optional)
//   }
//
//   *At least one of `query` / `category` is required — a search with no
//    discovery criterion is rejected (full-catalog pulls are a separate flow).
type SearchRequestBody = {
  query?: string;
  category?: string;
  deliveryGps?: string;
  deliveryAreaCode?: string;
  transactionId?: string;
};

// The ONDC `search` message payload: a Beckn `intent`. Only the sub-objects we
// actually populate are typed here (the spec allows many more facets). Snake_case
// / `@ondc/org/*` keys are the wire format the network expects verbatim.
type OndcSearchIntent = {
  item?: { descriptor: { name: string } };
  category?: { id: string };
  fulfillment?: {
    type: "Delivery";
    end?: { location: { gps?: string; address?: { area_code: string } } };
  };
  payment: {
    // BAP finder fee — REQUIRED by ONDC on search so BPPs know the buyer-app's
    // take. Pinned here (a code/commercial concern, like ONDC_CORE_VERSION),
    // not an env var, until a config field is introduced.
    "@ondc/org/buyer_app_finder_fee_type": "percent" | "amount";
    "@ondc/org/buyer_app_finder_fee_amount": string;
  };
};

type OndcSearchMessage = { intent: OndcSearchIntent };

// Default BAP finder fee. See payment note above.
const FINDER_FEE_TYPE = "percent" as const;
const FINDER_FEE_AMOUNT = "3";

// "lat,long" with decimal degrees — ONDC expects GPS as a comma-joined pair.
const GPS_RE = /^-?\d{1,3}(\.\d+)?,\s*-?\d{1,3}(\.\d+)?$/;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

// Coerce + trim a possibly-present string field; returns undefined when absent
// or blank, so downstream "is it set?" checks stay simple.
function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t ? t : undefined;
}

// Assemble the ONDC search `intent` from validated inputs. Kept separate from
// the handler so the wire-shape construction is unit-testable and the request
// flow reads top-to-bottom. Assumes inputs are already validated.
function buildSearchMessage(input: {
  query?: string;
  category?: string;
  deliveryGps?: string;
  deliveryAreaCode?: string;
}): OndcSearchMessage {
  const intent: OndcSearchIntent = {
    payment: {
      "@ondc/org/buyer_app_finder_fee_type": FINDER_FEE_TYPE,
      "@ondc/org/buyer_app_finder_fee_amount": FINDER_FEE_AMOUNT,
    },
  };

  if (input.query) intent.item = { descriptor: { name: input.query } };
  if (input.category) intent.category = { id: input.category };

  // Attach a delivery fulfillment only when we have a destination; some BPPs
  // narrow their catalog by serviceability, so passing the buyer's location
  // yields more relevant on_search results.
  if (input.deliveryGps || input.deliveryAreaCode) {
    intent.fulfillment = {
      type: "Delivery",
      end: {
        location: {
          ...(input.deliveryGps ? { gps: input.deliveryGps } : {}),
          ...(input.deliveryAreaCode
            ? { address: { area_code: input.deliveryAreaCode } }
            : {}),
        },
      },
    };
  }

  return { intent };
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

  const body = (raw ?? {}) as SearchRequestBody;
  const query = str(body.query);
  const category = str(body.category);
  const deliveryGps = str(body.deliveryGps);
  const deliveryAreaCode = str(body.deliveryAreaCode);
  const transactionId = str(body.transactionId);

  // Require at least one discovery criterion — a broadcast with an empty intent
  // is a misuse (and would flood the network for nothing).
  if (!query && !category) {
    return NextResponse.json(
      { error: "At least one of 'query' or 'category' is required." },
      { status: 400 }
    );
  }

  if (deliveryGps && !GPS_RE.test(deliveryGps)) {
    return NextResponse.json(
      { error: "'deliveryGps' must be 'lat,long' (decimal degrees)." },
      { status: 400 }
    );
  }

  const config = getOndcConfig();

  // Build the `context` envelope. `search` is broadcast, so no bpp_id/bpp_uri.
  // transaction_id is minted fresh unless the caller is continuing a flow; we
  // return it so the caller can correlate the later on_search callback(s).
  const context = buildContext({
    action: "search",
    ...(transactionId ? { transactionId } : {}),
  });

  const message = buildSearchMessage({
    query,
    category,
    deliveryGps,
    deliveryAreaCode,
  });

  // Search is the one action directed at the gateway's /search, not a BPP.
  const url = `${config.gatewayUrl}/search`;

  try {
    const result = await sendOndcRequest<OndcSearchMessage>({
      url,
      action: "search",
      context,
      message,
      // Workbench/gateway requires the Digest header as a precondition (returns
      // HTTP 428 without it); the registry path already sends it. See auth.ts
      // SIGNED_HEADERS, which lists `digest`.
      sendDigestHeader: true,
    });

    // The synchronous reply is only ACK/NACK. On ACK the search is accepted and
    // catalogs will arrive asynchronously on on_search — we hand the caller the
    // ids needed to correlate those callbacks. On NACK the gateway rejected the
    // request outright (bad context, unknown domain, …); surface its error and
    // use 422 so clients can distinguish "rejected" from a transport failure.
    const payload = {
      status: result.status,
      transactionId: context.transaction_id,
      messageId: context.message_id,
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
          // DEBUG (temporary): expose the raw Workbench rejection so we can read
          // why it returned 428. Remove after debugging.
          debug: {
            httpStatus: err.httpStatus,
            responseHeaders: err.responseHeaders,
            responseBody: err.responseBody,
          },
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
// Callback flow — how this connects to on_search (the async other half)
// ---------------------------------------------------------------------------
//
// ONDC discovery is asynchronous and split across two HTTP exchanges:
//
//   1. THIS route (BAP → gateway):  POST {context, message:{intent}} → /search
//      Returns immediately with ACK (accepted) or NACK (rejected). No catalog
//      data yet — only the promise that, on ACK, results are coming.
//
//   2. on_search (BPPs → BAP, later, N times):  the gateway broadcasts our
//      intent to BPPs; each replying BPP POSTs an `on_search` to our
//      `bap_uri/on_search` carrying a `message.catalog` of providers/items —
//      AND the SAME `context.transaction_id` we sent here, plus that BPP's
//      `bpp_id`/`bpp_uri`.
//
// The transaction_id this route returns is the join key: a future
// `src/app/api/ondc/on_search/route.ts` handler will verify the inbound BPP
// signature (auth.ts), match `transaction_id` back to this search, and collect
// the streamed catalogs (there is no single "done" — clients aggregate over a
// short window / the context.ttl).
//
// Continuing the order lifecycle (select → init → confirm → status) reuses this
// same transaction_id (pass it back in as `transactionId`) and, now knowing the
// chosen provider, supplies its `bpp_id`/`bpp_uri` to buildContext so those
// directed actions route to the BPP instead of broadcasting to the gateway.
