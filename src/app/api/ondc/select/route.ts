// ONDC BAP `select` endpoint — the first BPP-directed action of the lifecycle.
//
// By the time `select` fires, the buyer has run `search` (broadcast to the
// gateway) and received one or more `on_search` catalogs (each from a specific
// BPP). They have now CHOSEN a provider + items from ONE of those catalogs.
// `select` commits to that provider to get a firm quote: pricing, taxes,
// delivery charges, and serviceability for the chosen items.
//
// How this differs from `search` (see search/route.ts):
//   - DIRECTED, not broadcast. It POSTs to the chosen BPP's `${bpp_uri}/select`,
//     NOT the gateway's /search. Exactly one BPP receives it.
//   - The context carries `bpp_id`/`bpp_uri` (required for every non-search
//     action; see context.ts GATEWAY_BROADCAST_ACTIONS).
//   - `transaction_id` is REUSED, not minted — it must be the same id the
//     search/on_search used, so the BPP (and our future on_select handler) can
//     join this back to the discovery session. Here it is REQUIRED in the body.
//   - The message is a Beckn `order` (provider + items + fulfillment), not an
//     `intent`.
//
// Like `search`, the synchronous reply is ONLY an ACK/NACK. The actual quote
// arrives LATER, asynchronously, as an `on_select` callback POSTed to our
// `bap_uri/on_select` (see the "Callback flow" note at the bottom of this file).
//
// Layering (this route is the thin orchestration seam over the lib):
//   config.ts   → identity + network defaults
//   context.ts  → buildContext("select") → the snake_case `context` envelope
//   client.ts   → sendOndcRequest() → serialize → sign → POST → parse ACK/NACK
// This file owns only: input validation, message assembly, routing to the
// chosen BPP's /select, and shaping the HTTP response our own clients consume.
//
// Mirrors the conventions of the existing routes (search, deployments, upload):
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
// This is OUR ergonomic input — NOT the ONDC wire format. We translate it into
// an ONDC `order` below so callers never have to know the protocol's shape.
//
//   POST /api/ondc/select
//   {
//     "transactionId": "uuid",              // REQUIRED — reuse from search/on_search
//     "bppId":         "seller-app.x.in",   // REQUIRED — the chosen BPP's id
//     "bppUri":        "https://seller...", // REQUIRED — the chosen BPP's base URI
//     "providerId":    "P1",                // REQUIRED — provider within that BPP
//     "items": [                             // REQUIRED — at least one chosen item
//       { "id": "I1", "quantity": 2, "locationId": "L1" }
//     ],
//     "fulfillment": {                       // optional — buyer's delivery target
//       "type": "Delivery",                  // optional — "Delivery" (default) or "Self-Pickup"
//       "gps": "12.9716,77.5946",
//       "areaCode": "560001"
//     }
//   }
//
// Why the client supplies bppId/bppUri/providerId rather than this route looking
// them up by transactionId:  `on_search` catalogs are not persisted yet (see
// on_search/route.ts persistOnSearchCatalog — "catalogs are NOT retained"). The
// frontend holds the on_search results, so it passes the chosen ids through.
// FUTURE: once a catalog store exists, this route could resolve the BPP + verify
// the chosen items against the stored catalog instead of trusting the body.
type SelectRequestBody = {
  transactionId?: string;
  bppId?: string;
  bppUri?: string;
  providerId?: string;
  items?: unknown;
  fulfillment?: { id?: string; type?: string; gps?: string; areaCode?: string };
};

// ONDC RET10 fulfillment types we support driving from the BAP. "Delivery" is
// the default; "Self-Pickup" lets the buyer collect the items from the seller's
// store (same GPS as the provider's location, no last-mile delivery charges).
const SUPPORTED_FULFILLMENT_TYPES = ["Delivery", "Self-Pickup", "Buyer-Delivery"] as const;
type FulfillmentType = (typeof SUPPORTED_FULFILLMENT_TYPES)[number];

// One chosen line item, after validation.
type SelectItem = {
  id: string;
  quantity: number;
  locationId?: string;
  // Optional item-level tags (commercial model / attributes) forwarded opaquely
  // when the caller threads them from the on_search catalog.
  tags?: unknown[];
};

// The ONDC `select` message payload: a Beckn `order`. Only the sub-objects we
// actually populate are typed here (the spec allows many more facets).
// snake_case keys are the wire format the network expects verbatim.
type OndcSelectOrder = {
  provider: { id: string; locations?: Array<{ id: string }> };
  items: Array<{
    id: string;
    quantity: { count: number };
    location_id?: string;
    // ONDC RET 1.2.5: items do NOT carry fulfillment_id at the `select` stage —
    // the fulfillment is declared once under order.fulfillments[].id, and the BPP
    // binds items to it. (QA flagged item-level fulfillment_id as "not required".)
    // `tags` are passed through opaquely when the caller supplies them (commercial
    // model / item attributes the SNP needs to quote correctly).
    tags?: unknown[];
  }>;
  fulfillments?: Array<{
    id: string;
    type: FulfillmentType;
    end?: { location: { gps?: string; address?: { area_code: string } } };
  }>;
};

type OndcSelectMessage = { order: OndcSelectOrder };

// "lat,long" with decimal degrees — ONDC expects GPS as a comma-joined pair.
// Same rule as search/route.ts.
const GPS_RE = /^-?\d{1,3}(\.\d+)?,\s*-?\d{1,3}(\.\d+)?$/;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

// Coerce + trim a possibly-present string field; returns undefined when absent
// or blank, so downstream "is it set?" checks stay simple. (Same as search.)
function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t ? t : undefined;
}

// Validate the `items` array from the request body. Returns the cleaned items
// or an error message naming the first problem, so the handler stays linear and
// the rules live in one auditable place. Requires at least one item, each with
// a non-empty id and a positive integer quantity.
function validateItems(
  raw: unknown
): { ok: true; items: SelectItem[] } | { ok: false; reason: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, reason: "'items' must be a non-empty array." };
  }

  const items: SelectItem[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i] as {
      id?: unknown;
      quantity?: unknown;
      locationId?: unknown;
      tags?: unknown;
    };
    const id = str(entry?.id);
    if (!id) {
      return { ok: false, reason: `items[${i}].id is required.` };
    }
    const quantity = Number(entry?.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return {
        ok: false,
        reason: `items[${i}].quantity must be a positive integer.`,
      };
    }
    const locationId = str(entry?.locationId);
    // Pass item tags through opaquely when present (commercial model / BNP-SNP
    // attributes). We never synthesise them — only forward what the caller sends.
    const tags = Array.isArray(entry?.tags) ? entry.tags : undefined;
    items.push({
      id,
      quantity,
      ...(locationId ? { locationId } : {}),
      ...(tags ? { tags } : {}),
    });
  }

  return { ok: true, items };
}

// Assemble the ONDC select `order` from validated inputs. Kept separate from the
// handler so the wire-shape construction is unit-testable and the request flow
// reads top-to-bottom. Assumes inputs are already validated. Mirrors search's
// buildSearchMessage.
function buildSelectMessage(input: {
  providerId: string;
  items: SelectItem[];
  fulfillmentType: FulfillmentType;
  fulfillmentId?: string;
  deliveryGps?: string;
  deliveryAreaCode?: string;
}): OndcSelectMessage {
  // Collect the distinct provider location ids referenced by the chosen items
  // so the order's provider.locations mirrors them (ONDC expects the provider's
  // serving locations alongside the items that ship from them).
  const locationIds = [
    ...new Set(input.items.map((it) => it.locationId).filter((id): id is string => Boolean(id))),
  ];

  // Default to "F1", but allow the caller to pin a specific fulfillment id — some
  // seller flows (e.g. Buyer-Delivery) expect a fixed fulfillment id and reject
  // a mismatched one (NACK 20006).
  const FULFILLMENT_ID = input.fulfillmentId ?? "F1";

  const order: OndcSelectOrder = {
    provider: {
      id: input.providerId,
      ...(locationIds.length
        ? { locations: locationIds.map((id) => ({ id })) }
        : {}),
    },
    items: input.items.map((it) => ({
      id: it.id,
      quantity: { count: it.quantity },
      ...(it.locationId ? { location_id: it.locationId } : {}),
      // No item-level fulfillment_id at select (QA #2): the fulfillment is
      // declared once under order.fulfillments[] below. Item tags forwarded when
      // present (commercial model).
      ...(it.tags ? { tags: it.tags } : {}),
    })),
  };

  // Attach a fulfillment when we have a destination OR when the buyer chose
  // Self-Pickup (the BPP needs to see the type to skip last-mile pricing and
  // emit pickup-store details on the quote).
  if (input.deliveryGps || input.deliveryAreaCode || input.fulfillmentType !== "Delivery") {
    order.fulfillments = [
      {
        id: FULFILLMENT_ID,
        type: input.fulfillmentType,
        end: {
          location: {
            ...(input.deliveryGps ? { gps: input.deliveryGps } : {}),
            ...(input.deliveryAreaCode
              ? { address: { area_code: input.deliveryAreaCode } }
              : {}),
          },
        },
      },
    ];
  }

  return { order };
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

  const body = (raw ?? {}) as SelectRequestBody;
  const transactionId = str(body.transactionId);
  const bppId = str(body.bppId);
  const bppUri = str(body.bppUri);
  const providerId = str(body.providerId);
  const deliveryGps = str(body.fulfillment?.gps);
  const deliveryAreaCode = str(body.fulfillment?.areaCode);
  const fulfillmentTypeRaw = str(body.fulfillment?.type);
  const fulfillmentId = str(body.fulfillment?.id);
  const fulfillmentType: FulfillmentType =
    (fulfillmentTypeRaw as FulfillmentType | undefined) ?? "Delivery";

  // transaction_id is the spine of the lifecycle: select MUST continue the same
  // discovery session, so unlike search (where it's optional / minted fresh) it
  // is required here. A select with no transaction_id would be orphaned.
  if (!transactionId) {
    return NextResponse.json(
      { error: "'transactionId' is required (reuse the id from search)." },
      { status: 400 }
    );
  }

  // bpp_id/bpp_uri identify the chosen provider's BPP. Both are required: select
  // is directed, and buildContext rejects one without the other. We route the
  // request to bppUri, so validate it is an https URL up front.
  if (!bppId || !bppUri) {
    return NextResponse.json(
      { error: "'bppId' and 'bppUri' are required for select." },
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

  if (!providerId) {
    return NextResponse.json(
      { error: "'providerId' is required." },
      { status: 400 }
    );
  }

  const itemsResult = validateItems(body.items);
  if (!itemsResult.ok) {
    return NextResponse.json({ error: itemsResult.reason }, { status: 400 });
  }

  if (deliveryGps && !GPS_RE.test(deliveryGps)) {
    return NextResponse.json(
      { error: "'fulfillment.gps' must be 'lat,long' (decimal degrees)." },
      { status: 400 }
    );
  }

  if (
    fulfillmentTypeRaw &&
    !SUPPORTED_FULFILLMENT_TYPES.includes(fulfillmentTypeRaw as FulfillmentType)
  ) {
    return NextResponse.json(
      {
        error: `'fulfillment.type' must be one of ${SUPPORTED_FULFILLMENT_TYPES.join(", ")}.`,
      },
      { status: 400 }
    );
  }

  // Build the `context` envelope. Unlike search, select is directed: we reuse
  // the caller's transaction_id and thread bppId/bppUri through so buildContext
  // attaches bpp_id/bpp_uri (required for every non-search action). message_id
  // is minted fresh per request inside buildContext.
  const context = buildContext({
    action: "select",
    transactionId,
    bppId,
    bppUri,
  });

  const message = buildSelectMessage({
    providerId,
    items: itemsResult.items,
    fulfillmentType,
    fulfillmentId,
    deliveryGps,
    deliveryAreaCode,
  });

  // Directed at the chosen BPP's /select — NOT the gateway. The transport stays
  // dumb about routing; we own the URL here (context.ts encodes the broadcast-vs-
  // directed distinction; the URL must match).
  const url = `${bppOrigin}/select`;

  try {
    const result = await sendOndcRequest<OndcSelectMessage>({
      url,
      action: "select",
      context,
      message,
      // Workbench/seller requires the Digest header as a precondition (returns
      // HTTP 428 without it). Same as search/route.ts.
      sendDigestHeader: true,
    });

    // The synchronous reply is only ACK/NACK. On ACK the BPP accepted the select
    // and the quote will arrive asynchronously on on_select — we hand the caller
    // the ids needed to correlate that callback. On NACK the BPP rejected it
    // (item unavailable, not serviceable, …); surface its error and use 422 so
    // clients can distinguish "rejected" from a transport failure.
    const payload = {
      status: result.status,
      transactionId: context.transaction_id,
      messageId: context.message_id,
      bppId,
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
      console.error("ondc.select client error", {
        transactionId: context.transaction_id,
        message: err.message,
        httpStatus: err.httpStatus,
        responseHeaders: err.responseHeaders,
        responseBody: err.responseBody,
      });
      return NextResponse.json(
        {
          error: err.message,
          transactionId: context.transaction_id,
          messageId: context.message_id,
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
// Callback flow — how this connects to on_select (the async other half)
// ---------------------------------------------------------------------------
//
// `select` is asynchronous, like `search`, split across two HTTP exchanges:
//
//   1. THIS route (BAP → BPP):  POST {context, message:{order}} → ${bpp_uri}/select
//      Returns immediately with ACK (accepted) or NACK (rejected). No quote yet —
//      only the promise that, on ACK, a quote is coming.
//
//   2. on_select (BPP → BAP, later, once):  the chosen BPP prices the order and
//      POSTs an `on_select` to our `bap_uri/on_select` carrying a
//      `message.order.quote` (item prices, taxes, delivery/packing charges) and
//      fulfillment serviceability — AND the SAME `context.transaction_id` we sent
//      here, plus the same `bpp_id`.
//
// Unlike on_search (N callbacks from N BPPs for one broadcast), on_select is a
// SINGLE callback from the ONE BPP we directed this select at. A future
// `src/app/api/ondc/on_select/route.ts` — the symmetric twin of on_search — will
// verify the inbound BPP signature (auth.ts), match `transaction_id` (+ bpp_id)
// back to this select, and read the quote.
//
// Continuing the lifecycle (init → confirm → status) reuses this SAME
// transaction_id AND the same bpp_id/bpp_uri (init firms up billing/fulfillment
// against the quote; confirm places the order), so every directed action after
// search threads the same routing through buildContext exactly as this route does.
