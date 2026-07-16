// ONDC Retail v1.2.5 — post-order `update` builders (Phase B).
//
// Three post-order mutation flows are layered on the BAP-initiated `/update`
// action: RTO / part-cancellation refund settlement, return request, and
// replacement request. Phase A kept `/update` a GENERIC opaque forwarder; this
// module adds the protocol-specific BUSINESS LOGIC for those three flows while
// keeping it framework-free (no NextResponse, no config, no I/O) so it is
// unit-testable and the route stays a thin seam.
//
// Each builder returns the `{ update_target, order }` message body that the
// route wraps in a context envelope and signs. The refund amount is ALWAYS
// derived from the `quote_trail` the BPP returns at the refund-trigger state —
// on_cancel (RTO / part-cancel) OR on_update (return / replacement liquidation) —
// via calculateRefundAmount; it is never hardcoded. The generic-passthrough path
// enforces the same rule (see update/route.ts enforceRefundAmount) so a raw
// refund payload can't ship a wrong amount either.

// One ONDC tag key/value entry, and a tag group (code + list).
export type OndcTagEntry = { code: string; value: string };

// The `{ update_target, order }` shape the BPP expects on /update. `order` is a
// loose record because each flow populates different facets (payments for a
// refund, fulfillments for return/replacement).
export type UpdateMessage = {
  update_target: string;
  order: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Refund amount — derived from quote_trail (QA #11)
// ---------------------------------------------------------------------------

// A fulfillment carrying ONDC `quote_trail` tags. Only the shape we read.
type QuoteTrailFulfillment = {
  tags?: Array<{ code?: unknown; list?: unknown }>;
};

export type RefundAmount = {
  currency: string;
  // 2-decimal, POSITIVE — the amount to refund the buyer.
  value: string;
  // The raw per-line values that were summed, for audit/observability.
  trail: OndcTagEntry[];
};

// Sum the `quote_trail` value entries across all fulfillments. On on_cancel the
// BPP returns the refund breakdown as tag groups:
//   { code:"quote_trail", list:[ {code:"type",value:"item"}, {code:"id",...},
//                                 {code:"currency",value:"INR"},
//                                 {code:"value",value:"-170.00"} ] }
// Refund deltas are NEGATIVE; the refund amount is the absolute sum. The amount
// is NEVER hardcoded — it is derived only from the trail. Returns "0.00" when no
// quote_trail is present (caller can treat that as "nothing to refund").
export function calculateRefundAmount(fulfillments: unknown): RefundAmount {
  let total = 0;
  let currency = "INR";
  const trail: OndcTagEntry[] = [];

  if (Array.isArray(fulfillments)) {
    for (const f of fulfillments as QuoteTrailFulfillment[]) {
      if (!f || typeof f !== "object" || !Array.isArray(f.tags)) continue;
      for (const tag of f.tags) {
        if (!tag || typeof tag !== "object") continue;
        if ((tag as { code?: unknown }).code !== "quote_trail") continue;
        const list = (tag as { list?: unknown }).list;
        if (!Array.isArray(list)) continue;
        let val: number | null = null;
        for (const e of list as OndcTagEntry[]) {
          if (!e || typeof e !== "object") continue;
          if (e.code === "currency" && typeof e.value === "string") {
            currency = e.value;
          }
          if (e.code === "value" && typeof e.value === "string") {
            const n = Number(e.value);
            if (Number.isFinite(n)) val = n;
          }
        }
        if (val !== null) {
          total += val;
          trail.push({ code: "value", value: val.toFixed(2) });
        }
      }
    }
  }

  return { currency, value: Math.abs(total).toFixed(2), trail };
}

// Extract the reverse fulfillment(s) being refunded — those carrying the refund
// `quote_trail` — as BARE { id, type } for the refund /update's
// order.fulfillments. The contract names only the reverse leg, e.g.
// [{id:"R1",type:"Return"}] (return-refund) or [{id:"C1",type:"Cancel"}]
// (cancel-refund), with NO tags echoed. Falls back to every id-bearing
// fulfillment when none carry a quote_trail, so the required `fulfillments`
// attribute is still present.
function extractReverseFulfillments(
  fulfillments: unknown
): Array<{ id: string; type?: string }> {
  if (!Array.isArray(fulfillments)) return [];
  const withTrail: Array<{ id: string; type?: string }> = [];
  const all: Array<{ id: string; type?: string }> = [];
  for (const f of fulfillments) {
    if (!f || typeof f !== "object") continue;
    const o = f as { id?: unknown; type?: unknown; tags?: unknown };
    const id = typeof o.id === "string" ? o.id : undefined;
    if (!id) continue;
    const type = typeof o.type === "string" ? o.type : undefined;
    const bare = type ? { id, type } : { id };
    all.push(bare);
    const hasQuoteTrail =
      Array.isArray(o.tags) &&
      o.tags.some(
        (t) =>
          t &&
          typeof t === "object" &&
          (t as { code?: unknown }).code === "quote_trail"
      );
    if (hasQuoteTrail) withTrail.push(bare);
  }
  return withTrail.length > 0 ? withTrail : all;
}

// ---------------------------------------------------------------------------
// Refund update (RTO / part-cancel / return settlement) — QA #10, #11, #13
// ---------------------------------------------------------------------------

export type RefundSettlement = {
  type?: string; // "upi" | "neft" | "rtgs" — defaults to "upi"
  reference?: string;
  upiAddress?: string;
};

// Build the refund settlement `update` posted after an on_cancel (RTO /
// part-cancel) or a return's on_update. The settlement amount is computed from
// the on_cancel `fulfillments` quote_trail; those fulfillments are echoed back
// so the BPP can reconcile against the same trail it sent.
export function buildRefundUpdate(params: {
  orderId: string;
  fulfillments: unknown; // on_cancel fulfillments (quote_trail source)
  settlement?: RefundSettlement;
  timestamp: string; // caller-injected (keeps this module side-effect free)
}): { message: UpdateMessage; refund: RefundAmount } {
  const refund = calculateRefundAmount(params.fulfillments);
  const s = params.settlement ?? {};

  const settlementDetail: Record<string, unknown> = {
    settlement_counterparty: "buyer",
    settlement_phase: "refund",
    settlement_amount: refund.value,
    settlement_timestamp: params.timestamp,
  };
  // Only include settlement_type and upi_address when explicitly provided by
  // the BPP's settlement info — never default to "upi" (QA: "Some additional
  // settlement_details are given" flagged extraneous fields).
  if (s.type) settlementDetail.settlement_type = s.type;
  if (s.upiAddress) settlementDetail.upi_address = s.upiAddress;

  // Contract "settlement trail for refund initiation": the refund /update carries
  // the payment settlement in the SINGULAR `payment` object (not `payments[]`),
  // and names the reverse fulfillment(s) being refunded in `order.fulfillments`
  // as BARE { id, type } — no tags. We derive those from the on_cancel/on_update
  // fulfillments that carry the refund `quote_trail` (the same source the amount
  // is computed from). The bare shape avoids echoing quote_trail tags (which the
  // BPP rejects with FULFILLMENTS_TAGS_VALID_TAGS) while still including the
  // required `fulfillments` attribute (QA: "fulfillment attribute is missing" —
  // always include fulfillments even when reverse is empty).
  // `settlement_status` is NOT part of the contract settlement_details object and
  // is dropped (QA: "Some additional settlement_details are given").
  const reverse = extractReverseFulfillments(params.fulfillments);
  const order: Record<string, unknown> = {
    id: params.orderId,
    fulfillments: reverse,
    payment: { "@ondc/org/settlement_details": [settlementDetail] },
  };

  return { message: { update_target: "payment", order }, refund };
}

// ---------------------------------------------------------------------------
// Return request update — QA #12
// ---------------------------------------------------------------------------

// Build the return-request `update`. Per the RET10 1.2.5 "Return with pickup"
// contract the message is:
//   update_target: "item"
//   order.fulfillments: [ { type:"Return", tags:[{ code:"return_request", list:[
//     id, item_id, item_quantity, reason_id, reason_desc, images(CSV),
//     ttl_approval, ttl_reverseqc ] }] } ]
// The request fulfillment carries NO `id` and NO `state` — the BPP creates the
// return fulfillment (same id as the return-request id) and owns its state on
// on_update. `reason_desc`/`ttl_approval`/`ttl_reverseqc` are contract-mandatory;
// the two TTLs default to the contract example values when not supplied.
export function buildReturnUpdate(params: {
  orderId: string;
  fulfillmentId: string; // = the return-request id (contract "id" = R1)
  itemId?: string;
  quantity?: number;
  reasonId?: string;
  reasonDesc?: string;
  images?: string[];
  ttlApproval?: string;
  ttlReverseqc?: string;
  // Internal: when true, append the replace="yes" entry — a replacement request
  // is a return_request + replace=yes (see buildReplacementUpdate).
  replace?: boolean;
}): UpdateMessage {
  const list: OndcTagEntry[] = [{ code: "id", value: params.fulfillmentId }];
  if (params.itemId) list.push({ code: "item_id", value: params.itemId });
  if (params.quantity != null) {
    list.push({ code: "item_quantity", value: String(params.quantity) });
  }
  if (params.reasonId) list.push({ code: "reason_id", value: params.reasonId });
  // Contract-mandatory buyer comment; threaded from the buyer when available.
  list.push({
    code: "reason_desc",
    value: params.reasonDesc ?? "Return requested",
  });
  if (params.images && params.images.length > 0) {
    // Contract shows `images` as a comma-separated string ("url1,url2").
    list.push({ code: "images", value: params.images.join(",") });
  }
  // Protocol TTLs — approve/reject window and reverse-QC window (contract-mandatory).
  list.push({ code: "ttl_approval", value: params.ttlApproval ?? "PT24H" });
  list.push({ code: "ttl_reverseqc", value: params.ttlReverseqc ?? "P3D" });
  if (params.replace) list.push({ code: "replace", value: "yes" });

  return {
    update_target: "item",
    order: {
      id: params.orderId,
      // NO `items`; the request fulfillment carries only `type` + the
      // return_request tag (no id/state — the BPP owns those on on_update).
      fulfillments: [
        {
          type: "Return",
          tags: [{ code: "return_request", list }],
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Replacement request update — QA #14, #15
// ---------------------------------------------------------------------------

// A replacement is raised as a RETURN request carrying an extra replace="yes"
// entry (contract "Replacement flow" 00B — "/update - add 'replace' in
// return_request"): SAME update_target "item", SAME fulfillment type "Return",
// SAME return_request tag list as a return, plus { code:"replace", value:"yes" }
// (contract footnotes 1110/1111). The seller resolves it as a replacement (a new
// item is delivered after pickup) instead of a refund — so NO settlement/refund
// is emitted at initiation. There is no "Replacement" fulfillment type and no
// replacement `state` on the request (the BPP owns fulfillment state on
// on_update), so this builder is exactly the return builder + replace=yes.
export function buildReplacementUpdate(params: {
  orderId: string;
  fulfillmentId: string;
  itemId?: string;
  quantity?: number;
  reasonId?: string;
  reasonDesc?: string;
  images?: string[];
  ttlApproval?: string;
  ttlReverseqc?: string;
}): UpdateMessage {
  return buildReturnUpdate({ ...params, replace: true });
}

// ---------------------------------------------------------------------------
// Buyer instructions update — contract "Buyer instructions" (011)
// ---------------------------------------------------------------------------

// Build the buyer-instructions `update`. Per contract the buyer communicates
// delivery instructions via update_target "fulfillment", at
// order.fulfillments[].end.instructions.{ long_desc, additional_desc:{
// content_type, url } }. content_type is an enum ("text/html" | "text/plain");
// the url should remain accessible to the SNP until the fulfillment state is
// "Order-delivered" (contract footnotes 1145/1146).
export function buildInstructionsUpdate(params: {
  orderId: string;
  fulfillmentId: string;
  longDesc?: string;
  additionalDescUrl?: string;
  additionalDescContentType?: "text/html" | "text/plain";
}): UpdateMessage {
  const instructions: Record<string, unknown> = {};
  if (params.longDesc) instructions.long_desc = params.longDesc;
  if (params.additionalDescUrl) {
    instructions.additional_desc = {
      content_type: params.additionalDescContentType ?? "text/plain",
      url: params.additionalDescUrl,
    };
  }
  return {
    update_target: "fulfillment",
    order: {
      id: params.orderId,
      fulfillments: [
        {
          id: params.fulfillmentId,
          end: { instructions },
        },
      ],
    },
  };
}
