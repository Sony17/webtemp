// ONDC BAP `init` endpoint — the step that firms up an order against a quote.
//
// By the time `init` fires, the buyer has run `search` → `select` and received
// an `on_select` quote (pricing, taxes, delivery charges) from ONE chosen BPP.
// `init` commits the buyer's billing details and confirmed fulfillment to that
// BPP so it can return a FINAL order: a firm quote plus payment terms, ready to
// be placed with `confirm`.
//
// How this differs from `select` (see select/route.ts):
//   - Still DIRECTED at the chosen BPP — POSTs to `${bpp_uri}/init`, not the
//     gateway. The context carries `bpp_id`/`bpp_uri` exactly as select did.
//   - `transaction_id` is REUSED (same id select/on_select used) so the BPP and
//     our future on_init handler can join this back to the same order lifecycle.
//     REQUIRED in the body, like select.
//   - The message is still a Beckn `order`, but now it ALSO carries `billing`
//     (who/where to invoice) — the new, init-specific piece select didn't send.
//
// Like select, the synchronous reply is ONLY an ACK/NACK. The firmed-up order
// arrives LATER, asynchronously, as an `on_init` callback POSTed to our
// `bap_uri/on_init` (see the "Callback flow" note at the bottom of this file).
//
// Layering (this route is the thin orchestration seam over the lib):
//   config.ts   → identity + network defaults
//   context.ts  → buildContext("init") → the snake_case `context` envelope
//   client.ts   → sendOndcRequest() → serialize → sign → POST → parse ACK/NACK
// This file owns only: input validation, message assembly, routing to the
// chosen BPP's /init, and shaping the HTTP response our own clients consume.
//
// Mirrors the conventions of the existing routes (search, select, deployments):
// `NextResponse`, `runtime = "nodejs"`, JSON-body parsing with a 400 guard.
import { NextResponse } from "next/server";
import { isOndcConfigured } from "@/lib/ondc/config";
import type { OndcContext } from "@/lib/ondc/context";
import { OndcClientError } from "@/lib/ondc/client";
import { getQuote } from "@/lib/ondc/store";
import { sendDirectedWithVersionFallback } from "@/lib/ondc/version-fallback";
import { recordOutboundNack } from "@/lib/ondc/audit";

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
//   POST /api/ondc/init
//   {
//     "transactionId": "uuid",              // REQUIRED — reuse from select
//     "bppId":         "seller-app.x.in",   // REQUIRED — the chosen BPP's id
//     "bppUri":        "https://seller...", // REQUIRED — the chosen BPP's base URI
//     "providerId":    "P1",                // REQUIRED — provider within that BPP
//     "items": [                             // REQUIRED — the items being ordered
//       { "id": "I1", "quantity": 2, "locationId": "L1" }
//     ],
//     "billing": {                           // REQUIRED — who/where to invoice
//       "name":     "Asha K",
//       "phone":    "9876543210",
//       "email":    "asha@example.com",      // optional
//       "address":  "12 MG Road, Bengaluru", // optional
//       "areaCode": "560001"                 // optional
//     },
//     "fulfillment": {                       // optional — buyer's delivery target
//       "gps": "12.9716,77.5946",
//       "areaCode": "560001"
//     }
//   }
//
// Why the client supplies bppId/bppUri/providerId/items rather than this route
// resolving them by transactionId: on_search/on_select results are not persisted
// yet (see on_search/route.ts persistOnSearchCatalog — "catalogs are NOT
// retained"). The frontend holds them and threads the chosen ids through, same
// as select does. FUTURE: with a quote store, this route could resolve the order
// and verify the items/quote instead of trusting the body.
type InitRequestBody = {
  transactionId?: string;
  bppId?: string;
  bppUri?: string;
  providerId?: string;
  items?: unknown;
  billing?: {
    name?: string;
    phone?: string;
    email?: string;
    address?: string;
    building?: string;
    locality?: string;
    city?: string;
    state?: string;
    country?: string;
    areaCode?: string;
  };
  // `id` is the fulfillment chosen from the on_select quote — reused here so the
  // BPP binds the order to the option the buyer actually picked (Self-Pickup /
  // Buyer-Delivery / Delivery). Optional: when omitted we resolve it from the
  // persisted on_select quote (see resolveFulfillmentId).
  fulfillment?: { id?: string; type?: string; gps?: string; areaCode?: string };
};

// ONDC RET10 fulfillment types we support driving from the BAP. "Delivery" is
// the default (Slotted Delivery is a Delivery with a time-slot tag);
// "Self-Pickup" lets the buyer collect from the seller's store; "Buyer-Delivery"
// lets the buyer arrange their own logistics. Must mirror select/route.ts.
const SUPPORTED_FULFILLMENT_TYPES = ["Delivery", "Self-Pickup", "Buyer-Delivery"] as const;
type FulfillmentType = (typeof SUPPORTED_FULFILLMENT_TYPES)[number];

// One ordered line item, after validation.
type InitItem = {
  id: string;
  quantity: number;
  locationId?: string;
  // Optional item-level tags forwarded opaquely — the Commercial Model (00A)
  // requires the BNP to send the selected SNP-commercial option in /init as
  // items[].tags:[{code:"np_fees",list:[{code:"id",value:<optionId>}]}]. Mirrors
  // select's item tags passthrough.
  tags?: unknown[];
};

// Validated billing details (init-specific). name + phone are the minimum a BPP
// needs to invoice; the rest are passed through when present.
type InitBilling = {
  name: string;
  phone: string;
  email?: string;
  address?: string;
  building?: string;
  locality?: string;
  city?: string;
  state?: string;
  country?: string;
  areaCode?: string;
};

// The ONDC `init` message payload: a Beckn `order`. Only the sub-objects we
// actually populate are typed here (the spec allows many more facets).
// snake_case keys are the wire format the network expects verbatim.
type OndcInitOrder = {
  provider: { id: string; locations?: Array<{ id: string }> };
  items: Array<{
    id: string;
    quantity: { count: number };
    location_id?: string;
    fulfillment_id?: string;
    // Item tags forwarded opaquely (Commercial Model np_fees selection, etc.).
    tags?: unknown[];
  }>;
  billing: {
    name: string;
    phone: string;
    email?: string;
    address?: {
      name?: string;
      building?: string;
      locality?: string;
      city?: string;
      state?: string;
      country?: string;
      area_code?: string;
    };
    created_at?: string;
    updated_at?: string;
  };
  fulfillments?: Array<{
    id: string;
    type: FulfillmentType;
    end?: {
      // Optional: Self-Pickup references the seller's store (the BPP knows it
      // from the selected fulfillment id), so no buyer destination is sent.
      location?: {
        gps?: string;
        address?: {
          name?: string;
          building?: string;
          locality?: string;
          city?: string;
          state?: string;
          country?: string;
          area_code?: string;
        };
      };
      contact?: { phone: string; email?: string };
    };
  }>;
};

type OndcInitMessage = { order: OndcInitOrder };

// "lat,long" with decimal degrees — ONDC expects GPS as a comma-joined pair.
// Same rule as search/select.
const GPS_RE = /^-?\d{1,3}(\.\d+)?,\s*-?\d{1,3}(\.\d+)?$/;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

// Coerce + trim a possibly-present string field; returns undefined when absent
// or blank, so downstream "is it set?" checks stay simple. (Same as select.)
function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t ? t : undefined;
}

// Validate the `items` array from the request body. Returns the cleaned items
// or an error message naming the first problem, so the handler stays linear and
// the rules live in one auditable place. Requires at least one item, each with
// a non-empty id and a positive integer quantity. (Same rules as select.)
function validateItems(
  raw: unknown
): { ok: true; items: InitItem[] } | { ok: false; reason: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, reason: "'items' must be a non-empty array." };
  }

  const items: InitItem[] = [];
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
    // Pass item tags through opaquely when present (Commercial Model np_fees,
    // etc.). We never synthesise them — only forward what the caller sends.
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

// Validate the `billing` block. Unlike select, init MUST carry billing — it's
// the new piece this action contributes to the order. name + phone are required
// (a BPP cannot invoice without them); email/address/areaCode are optional.
function validateBilling(
  raw: unknown
): { ok: true; billing: InitBilling } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "'billing' is required." };
  }
  const b = raw as InitRequestBody["billing"];
  const name = str(b?.name);
  if (!name) {
    return { ok: false, reason: "'billing.name' is required." };
  }
  const phone = str(b?.phone);
  if (!phone) {
    return { ok: false, reason: "'billing.phone' is required." };
  }
  const email = str(b?.email);
  const address = str(b?.address);
  const building = str(b?.building);
  const locality = str(b?.locality);
  const city = str(b?.city);
  const state = str(b?.state);
  const country = str(b?.country);
  const areaCode = str(b?.areaCode);
  return {
    ok: true,
    billing: {
      name,
      phone,
      ...(email ? { email } : {}),
      ...(address ? { address } : {}),
      ...(building ? { building } : {}),
      ...(locality ? { locality } : {}),
      ...(city ? { city } : {}),
      ...(state ? { state } : {}),
      ...(country ? { country } : {}),
      ...(areaCode ? { areaCode } : {}),
    },
  };
}

// ONDC L1 address contract: the address `name`, `building` and `locality` must
// be coherent — `name` distinct from `locality`, and `name + building + locality`
// under 190 chars. We use the recipient name (billing.name) as the address
// `name` (see buildInitMessage), so validate that trio here and fail fast with a
// clear 400 instead of eating a downstream network NACK. Only the inequality is
// gated on `locality` being present; the length check is always safe.
function validateAddressConstraints(
  billing: InitBilling
): { ok: true } | { ok: false; reason: string } {
  const name = billing.name;
  const building = billing.building ?? "";
  const locality = billing.locality ?? "";
  if (locality && name === locality) {
    return {
      ok: false,
      reason:
        "'billing.name' (used as the delivery address name) must differ from 'billing.locality'.",
    };
  }
  if ((name + building + locality).length >= 190) {
    return {
      ok: false,
      reason:
        "'billing.name' + 'billing.building' + 'billing.locality' must be under 190 characters.",
    };
  }
  return { ok: true };
}

// Pick the fulfillment id to reference in init from the PERSISTED on_select quote
// (saved by on_select/route.ts). We prefer the option whose type matches the
// buyer's chosen fulfillment type, else the first option. This is what lets
// Self-Pickup / Buyer-Delivery bind to the exact option the buyer selected
// (QA #9/#21) instead of a hard-coded "F1". Returns undefined when the quote
// carries no usable fulfillment id.
function pickFulfillmentIdFromQuote(
  fulfillments: unknown,
  preferredType: FulfillmentType
): string | undefined {
  if (!Array.isArray(fulfillments)) return undefined;
  const opts = fulfillments.filter(
    (f): f is { id?: unknown; type?: unknown } =>
      Boolean(f) && typeof f === "object"
  );
  const byType = opts.find(
    (f) => typeof f.type === "string" && f.type === preferredType
  );
  const chosen = byType ?? opts[0];
  return chosen && typeof chosen.id === "string" ? chosen.id : undefined;
}

// Fallback serving-location id used when the caller omits items[].locationId.
// Mirrors select's constant: ONDC RET10 makes order.provider.locations[].id and
// each item's location_id mandatory, so we never ship an order without them.
// Override via ONDC_DEFAULT_LOCATION_ID; multi-location providers must send
// explicit locationIds rather than rely on this default.
const DEFAULT_PROVIDER_LOCATION_ID =
  process.env.ONDC_DEFAULT_LOCATION_ID?.trim() || "L1";

// Assemble the ONDC init `order` from validated inputs. Kept separate from the
// handler so the wire-shape construction is unit-testable and the request flow
// reads top-to-bottom. Assumes inputs are already validated. Mirrors select's
// buildSelectMessage, adding the init-specific `billing` block.
function buildInitMessage(input: {
  providerId: string;
  items: InitItem[];
  billing: InitBilling;
  timestamp: string;
  fulfillmentId: string;
  fulfillmentType: FulfillmentType;
  deliveryGps?: string;
  deliveryAreaCode?: string;
}): OndcInitMessage {
  // Resolve every item's serving location (falling back to the default) so the
  // order's provider.locations and each item.location_id are ALWAYS present.
  // ONDC requires the provider's serving locations alongside the items; omitting
  // either NACKs ORDER_PROVIDER_LOCATIONS_ID. Same as select.
  const locationIdFor = (it: InitItem): string =>
    it.locationId ?? DEFAULT_PROVIDER_LOCATION_ID;
  const locationIds = [...new Set(input.items.map(locationIdFor))];

  // Compose the billing address sub-object only from the parts we have, so we
  // never emit an empty `address` object when the caller gave neither field.
  const billingAddress =
    input.billing.address ||
    input.billing.building ||
    input.billing.locality ||
    input.billing.city ||
    input.billing.state ||
    input.billing.country ||
    input.billing.areaCode
      ? {
          // ONDC address requires a `name` line. Prefer the free-form address
          // line the buyer typed; fall back to the recipient name so billing
          // never ships an address without a name (ONDC L1 flags that).
          name: input.billing.address ?? input.billing.name,
          ...(input.billing.building ? { building: input.billing.building } : {}),
          ...(input.billing.locality ? { locality: input.billing.locality } : {}),
          ...(input.billing.city ? { city: input.billing.city } : {}),
          ...(input.billing.state ? { state: input.billing.state } : {}),
          // ONDC is India-only; strict 1.2.0 sellers (e.g. seller.easypay.co.in)
          // require address.country. Default to IND when the buyer didn't type one.
          country: input.billing.country ?? "IND",
          ...(input.billing.areaCode ? { area_code: input.billing.areaCode } : {}),
        }
      : undefined;

  // The fulfillment id chosen from the on_select quote (no longer hard-coded —
  // QA #9/#21). Items bind to it via item.fulfillment_id (expected at init,
  // unlike select).
  const fulfillmentId = input.fulfillmentId;
  const isSelfPickup = input.fulfillmentType === "Self-Pickup";

  const order: OndcInitOrder = {
    provider: {
      id: input.providerId,
      locations: locationIds.map((id) => ({ id })),
    },
    items: input.items.map((it) => ({
      id: it.id,
      quantity: { count: it.quantity },
      location_id: locationIdFor(it),
      fulfillment_id: fulfillmentId,
      // Commercial Model (00A): forward the selected np_fees option tag when the
      // caller threads it from the on_select/on_init quote.
      ...(it.tags ? { tags: it.tags } : {}),
    })),
    billing: {
      name: input.billing.name,
      phone: input.billing.phone,
      ...(input.billing.email ? { email: input.billing.email } : {}),
      ...(billingAddress ? { address: billingAddress } : {}),
      created_at: input.timestamp,
      updated_at: input.timestamp,
    },
  };

  // Always emit ONE fulfillment that references the SELECTED id + type from
  // on_select (QA #9/#21 — previously a fulfillment was only built when a
  // delivery target was present, so Self-Pickup / Buyer-Delivery selections were
  // dropped). Buyer contact travels on every type. Self-Pickup references the
  // seller's store (the BPP resolves it from the selected id), so we send no
  // buyer destination; delivery-style types carry the buyer's gps + address.
  const contact = {
    phone: input.billing.phone,
    ...(input.billing.email ? { email: input.billing.email } : {}),
  };

  order.fulfillments = [
    {
      id: fulfillmentId,
      type: input.fulfillmentType,
      end: isSelfPickup
        ? {
            // Self-Pickup still requires end.location.gps
            // (FULFILLMENTS_END_LOCATION_GPS) — the buyer collects at the pickup
            // point, so we send the gps (the buyer's selected pickup location)
            // and the buyer contact, but NOT a buyer delivery address.
            ...(input.deliveryGps
              ? { location: { gps: input.deliveryGps } }
              : {}),
            contact,
          }
        : {
            location: {
              ...(input.deliveryGps ? { gps: input.deliveryGps } : {}),
              address: {
                // Recipient name — NOT the free-form street string (QA #3).
                // ONDC's L1 address check wants name + building + locality
                // present, name distinct from locality; the handler validates
                // those constraints before we get here.
                name: input.billing.name,
                ...(input.billing.building ? { building: input.billing.building } : {}),
                ...(input.billing.locality ? { locality: input.billing.locality } : {}),
                ...(input.billing.city ? { city: input.billing.city } : {}),
                ...(input.billing.state ? { state: input.billing.state } : {}),
                // ONDC is India-only; strict 1.2.0 sellers require
                // fulfillments[].end.location.address.country (easypay NACKs 30000
                // without it). Default to IND when the buyer didn't type one.
                country: input.billing.country ?? "IND",
                ...(input.deliveryAreaCode ?? input.billing.areaCode
                  ? { area_code: input.deliveryAreaCode ?? input.billing.areaCode }
                  : {}),
              },
            },
            // Fulfillment contact (QA #4): phone required; email when supplied.
            contact,
          },
    },
  ];

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

  const body = (raw ?? {}) as InitRequestBody;
  const transactionId = str(body.transactionId);
  const bppId = str(body.bppId);
  const bppUri = str(body.bppUri);
  const providerId = str(body.providerId);
  const deliveryGps = str(body.fulfillment?.gps);
  const deliveryAreaCode = str(body.fulfillment?.areaCode);
  const fulfillmentTypeRaw = str(body.fulfillment?.type);

  // transaction_id is the spine of the lifecycle: init MUST continue the same
  // order session, so it is required here exactly as in select. An init with no
  // transaction_id would be orphaned from the quote it firms up.
  if (!transactionId) {
    return NextResponse.json(
      { error: "'transactionId' is required (reuse the id from select)." },
      { status: 400 }
    );
  }

  // bpp_id/bpp_uri identify the chosen provider's BPP. Both are required: init
  // is directed, and buildContext rejects one without the other. We route the
  // request to bppUri, so validate it is an https URL up front.
  if (!bppId || !bppUri) {
    return NextResponse.json(
      { error: "'bppId' and 'bppUri' are required for init." },
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

  const billingResult = validateBilling(body.billing);
  if (!billingResult.ok) {
    return NextResponse.json({ error: billingResult.reason }, { status: 400 });
  }

  // Enforce the ONDC L1 address contract (name != locality, combined < 190) up
  // front so a malformed checkout address is rejected here, not by the BPP.
  const addressResult = validateAddressConstraints(billingResult.billing);
  if (!addressResult.ok) {
    return NextResponse.json({ error: addressResult.reason }, { status: 400 });
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
  const fulfillmentType: FulfillmentType =
    (fulfillmentTypeRaw as FulfillmentType | undefined) ?? "Delivery";

  // Resolve which fulfillment id to reference (QA #9/#21). Prefer the id the
  // caller threaded from on_select; otherwise read it from the persisted
  // on_select quote so Self-Pickup / Buyer-Delivery bind to the option the buyer
  // actually chose. Falls back to "F1" only when no quote is available (e.g. a
  // dev flow that skipped on_select).
  let fulfillmentId = str(body.fulfillment?.id);
  if (!fulfillmentId) {
    const quote = await getQuote(transactionId, bppId);
    fulfillmentId = pickFulfillmentIdFromQuote(quote?.fulfillments, fulfillmentType);
  }
  if (!fulfillmentId) fulfillmentId = "F1";

  // Timestamp for the billing block. Independent of the context timestamp (which
  // buildContext mints per attempt inside the fallback); a few ms apart is fine.
  const billingTimestamp = new Date().toISOString();

  const message = buildInitMessage({
    providerId,
    items: itemsResult.items,
    billing: billingResult.billing,
    timestamp: billingTimestamp,
    fulfillmentId,
    fulfillmentType,
    deliveryGps,
    deliveryAreaCode,
  });

  // Directed at the chosen BPP's /init — NOT the gateway. The transport stays
  // dumb about routing; we own the URL here (context.ts encodes the broadcast-vs-
  // directed distinction; the URL must match).
  const url = `${bppOrigin}/init`;

  // Context is built inside the version-fallback helper (it owns the core-version
  // choice: 1.2.5 first, retrying at 1.2.0 only if the seller NACKs the version —
  // some sellers are still on 1.2.0). Keep the winning context for the catch.
  let usedContext: OndcContext | null = null;
  try {
    const { result, context, usedVersionFallback } =
      await sendDirectedWithVersionFallback<OndcInitMessage>({
        url,
        action: "init",
        contextParams: { action: "init", transactionId, bppId, bppUri },
        message,
      });
    usedContext = context;

    if (usedVersionFallback) {
      console.log("ondc.init version-field fallback used", {
        transactionId: context.transaction_id,
        bppId,
        finalStatus: result.status,
      });
    }

    // The synchronous reply is only ACK/NACK. On ACK the BPP accepted the init
    // and the firmed-up order will arrive asynchronously on on_init — we hand the
    // caller the ids needed to correlate that callback. On NACK the BPP rejected
    // it (item now unavailable, not serviceable, …); surface its error and use
    // 422 so clients can distinguish "rejected" from a transport failure.
    if (result.status === "NACK") {
      // Durable, seller-keyed record for the admin "seller health" view (same as
      // select). A seller that NACKs init after ACK-ing select is its own signal.
      recordOutboundNack({
        action: "init",
        bppId,
        providerId,
        transactionId: context.transaction_id,
        messageId: context.message_id,
        errorCode: result.error?.code,
        responseBody: result.error,
      });
    }

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
      return NextResponse.json(
        {
          error: err.message,
          transactionId: usedContext?.transaction_id ?? transactionId,
          messageId: usedContext?.message_id,
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
// Callback flow — how this connects to on_init (the async other half)
// ---------------------------------------------------------------------------
//
// `init` is asynchronous, like select, split across two HTTP exchanges:
//
//   1. THIS route (BAP → BPP):  POST {context, message:{order}} → ${bpp_uri}/init
//      Returns immediately with ACK (accepted) or NACK (rejected). No firm order
//      yet — only the promise that, on ACK, one is coming.
//
//   2. on_init (BPP → BAP, later, once):  the chosen BPP finalizes the order and
//      POSTs an `on_init` to our `bap_uri/on_init` carrying the firmed-up
//      `message.order` (final quote, billing echoed back, payment terms) — AND
//      the SAME `context.transaction_id` we sent here, plus the same `bpp_id`.
//
// Like on_select, on_init is a SINGLE callback from the ONE BPP we directed this
// init at (not the N-callbacks fan-out of on_search). A future
// `src/app/api/ondc/on_init/route.ts` will verify the inbound BPP signature
// (auth.ts), match `transaction_id` (+ bpp_id) back to this init, and read the
// payment terms.
//
// Continuing the lifecycle (confirm → status) reuses this SAME transaction_id
// AND the same bpp_id/bpp_uri (confirm places the order against these init
// terms), so every directed action threads the same routing through
// buildContext exactly as this route does.
