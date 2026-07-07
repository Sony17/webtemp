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
  // Optional override of the dispatch target. Default is `${gatewayUrl}/search`
  // (broadcast to the network via the preprod/prod gateway). Override when
  // probing a specific BPP directly — e.g. ONDC Workbench's seller surface:
  //   "targetUrl": "https://workbench.ondc.tech/api-service/ONDC:RET10/1.2.5/seller/search"
  // Must be a parseable absolute https URL pointing at a `/search` endpoint.
  targetUrl?: string;
  // When true, emit an INCREMENTAL refresh search: adds the RET10 1.2.5
  // `catalog_inc` tag group carrying start_time/end_time, so BPPs return only
  // catalog deltas since the last refresh. Used by Workbench's "Discovery Flow
  // incremental catalog" test (final step). Default false = full-catalog search.
  // Optional `incrementalStart` overrides start_time; default is now-1h.
  incremental?: boolean;
  incrementalStart?: string;
  // Incremental refresh mode (QA #18): "start" begins a delta window, "stop"
  // ends it. Emitted as the `mode` entry of the catalog_inc tag group. Defaults
  // to "start" when an incremental search is requested without an explicit mode.
  incrementalMode?: "start" | "stop";
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
  // ONDC `tags` groups. RET10 1.2.5 publishes the BAP's transaction-level data
  // here via two groups: `bap_terms` (static terms) and `bap_features` (the
  // optional protocol features this BAP supports). This generic `code`/`list`
  // shape already models both groups verbatim, so no per-group typing is needed.
  tags?: { code: string; list: { code: string; value: string }[] }[];
};

type OndcSearchMessage = { intent: OndcSearchIntent };

// Default BAP finder fee. See payment note above.
const FINDER_FEE_TYPE = "percent" as const;
const FINDER_FEE_AMOUNT = "3";

// TEMPORARY: using RET10 1.2.5 contract example values until
// OpenIdea-specific static terms URL/effective date are confirmed.
const BAP_STATIC_TERMS_NEW =
  "https://github.com/ONDC-Official/NP-Static-Terms/buyerNP_BNP/1.0/tc.pdf";

const BAP_TERMS_EFFECTIVE_DATE =
  "2025-02-01T00:00:00.000Z";

// ONDC `bap_features` — the second tag group RET10 1.2.5 requires on `search`
// alongside `bap_terms`.
//
// WHAT it is: the buyer app's declaration of which optional protocol features
// it supports, expressed as a list of feature codes each flagged "yes".
//
// WHY it is here: ONDC clarified (guidance received 2026-06-16) that RET10
// 1.2.5 search requests must carry BOTH `bap_terms` AND `bap_features`; without
// this group the search is non-compliant.
//
// WHERE the values came from: taken VERBATIM from the RET10 1.2.5 contract
// snippet ONDC shared on 2026-06-16 — codes 003, 005 and 006, each value "yes".
// No feature codes are invented: these are exactly the three the snippet lists,
// and no additional bap_features codes are present in any contract/docs
// available in this repo, so only these three are advertised.
const BAP_FEATURES: { code: string; value: string }[] = [
  { code: "003", value: "yes" },
  { code: "005", value: "yes" },
  { code: "006", value: "yes" },
];

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
  incremental?: boolean;
  incrementalStart?: string;
  incrementalMode?: "start" | "stop";
}): OndcSearchMessage {
  // bap_terms is published on EVERY search. bap_features is added ONLY on a
  // NON-incremental search: the RET10 1.2.5 "Incremental catalog refresh"
  // examples carry only `catalog_inc` (+ bap_terms) and NO bap_features. Sending
  // bap_features on an incremental refresh diverges from the contract's own
  // incremental payloads, so it is omitted there. (Contract §"Incremental
  // catalog refresh", api-contract examples at pull/push/stop.)
  const tags: NonNullable<OndcSearchIntent["tags"]> = [
    {
      code: "bap_terms",
      list: [
        { code: "static_terms", value: "" },
        { code: "static_terms_new", value: BAP_STATIC_TERMS_NEW },
        { code: "effective_date", value: BAP_TERMS_EFFECTIVE_DATE },
      ],
    },
  ];
  if (!input.incremental) {
    tags.push({ code: "bap_features", list: BAP_FEATURES });
  }

  const intent: OndcSearchIntent = {
    payment: {
      "@ondc/org/buyer_app_finder_fee_type": FINDER_FEE_TYPE,
      "@ondc/org/buyer_app_finder_fee_amount": FINDER_FEE_AMOUNT,
    },
    tags,
  };

  // Incremental refresh: append a MODE-AWARE `catalog_inc` group and RETURN —
  // a delta refresh carries NO discovery intent (no item / category /
  // fulfillment) per the contract's incremental examples. Per the RET10 1.2.5
  // "Incremental catalog refresh" section:
  //   - mode "start" (push): list = [{mode:"start"}]; start_time is OPTIONAL and
  //     defaults to Context.timestamp — so it is sent only when explicitly given.
  //   - mode "stop":         list = [{mode:"stop"}].
  // start_time/end_time are NOT sent for a mode-based push/stop refresh (they
  // belong only to the separate 1-time "pull" scenario, which this BAP does not
  // drive from the Workbench incremental flow).
  if (input.incremental) {
    const mode = input.incrementalMode ?? "start";
    const list: { code: string; value: string }[] = [{ code: "mode", value: mode }];
    if (mode === "start" && input.incrementalStart) {
      list.push({ code: "start_time", value: input.incrementalStart });
    }
    intent.tags!.push({ code: "catalog_inc", list });
    return { intent };
  }

  // ONDC RET10 1.2.5 rejects an intent that carries BOTH `item` and `category`
  // (error 40000: "/message/intent cannot have both properties item and
  // category"). They are mutually exclusive: a free-text item search sets ONLY
  // `item`; a category search sets ONLY `category` — never both. When a caller
  // supplies both (e.g. the incremental Discovery flow trigger sends `query` +
  // `category`), `query` takes precedence and `category` is omitted.
  if (input.query) {
    intent.item = { descriptor: { name: input.query } };
  } else if (input.category) {
    intent.category = { id: input.category };
  }

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
  console.log("ondc.search ENTER", {
    ts: new Date().toISOString(),
    url: req.url,
  });

  // Fail fast (and clearly) when ONDC credentials aren't set up, rather than
  // deep inside signing. isOndcConfigured() returns false only for "not set up
  // yet"; a present-but-INVALID config rethrows (OndcConfigError) and surfaces
  // as the 500 below — exactly the loud failure a misconfig deserves.
  if (!isOndcConfigured()) {
    console.warn("ondc.search unconfigured → 503");
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
  const targetUrl = str(body.targetUrl);
  const incremental = body.incremental === true;
  const incrementalStart = str(body.incrementalStart);
  const incrementalMode =
    body.incrementalMode === "stop" ? "stop" : "start";

  // Require at least one discovery criterion — a broadcast with an empty intent
  // is a misuse (and would flood the network for nothing). An INCREMENTAL (delta)
  // refresh is mode/time based and carries no discovery criterion, so the
  // query/category requirement applies only to a normal search.
  if (!incremental && !query && !category) {
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

  // Validate the optional dispatch override up-front so a typo returns a clear
  // 400 instead of a confusing transport error from sendOndcRequest.
  if (targetUrl) {
    try {
      const u = new URL(targetUrl);
      if (u.protocol !== "https:") {
        return NextResponse.json(
          { error: "'targetUrl' must be an https URL." },
          { status: 400 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: "'targetUrl' must be a parseable absolute URL." },
        { status: 400 }
      );
    }
  }

  const config = getOndcConfig();

  // Build the `context` envelope. `search` is broadcast, so no bpp_id/bpp_uri.
  // transaction_id is minted fresh unless the caller is continuing a flow; we
  // return it so the caller can correlate the later on_search callback(s).
  // context.city is the configured STD-coded city (config.cityCode, e.g.
  // "std:080") for BOTH full-catalog and incremental searches. Per ONDC
  // certification guidance the search context MUST carry a specific city with an
  // STD code — NOT the wildcard "*". (A prior QA note used "*" to mean a
  // network-wide incremental delta, but the ONDC team / log validator require a
  // concrete city; "*" is rejected.)
  const context = buildContext({
    action: "search",
    ...(transactionId ? { transactionId } : {}),
  });

  const message = buildSearchMessage({
    query,
    category,
    deliveryGps,
    deliveryAreaCode,
    incremental,
    incrementalStart,
    incrementalMode,
  });

  // Search is the one action directed at the gateway's /search, not a BPP —
  // except when the caller pins `targetUrl` to probe a specific BPP/Workbench
  // seller endpoint directly.
  const url = targetUrl ?? `${config.gatewayUrl}/search`;

  // DEBUG (temporary): confirm which identity + gateway are actually in effect
  // at runtime and the exact URL we are about to POST to. Remove after debugging.
  console.log("ondc.search DEBUG config+target", {
    bapUri: config.bapUri,
    subscriberUri: config.subscriberUri,
    gatewayUrl: config.gatewayUrl,
    outboundUrl: url,
    targetUrlOverride: targetUrl ?? null,
    transactionId: context.transaction_id,
  });

  console.log("ondc.search dispatch", {
    url,
    transactionId: context.transaction_id,
    messageId: context.message_id,
    domain: context.domain,
    city: context.city,
    query,
    category,
  });

  console.log(
    "ondc.search payload",
    JSON.stringify({ context, message }, null, 2)
  );

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
    console.log("ondc.search result", {
      transactionId: context.transaction_id,
      status: result.status,
      ...(result.status === "NACK" ? { error: result.error } : {}),
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
      console.error("ondc.search client error", {
        transactionId: context.transaction_id,
        message: err.message,
        httpStatus: err.httpStatus,
        timeout: err.timeout,
      });
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
    console.error("ondc.search fault", {
      transactionId: context.transaction_id,
      message: msg,
    });
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
