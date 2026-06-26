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
// derived from the on_cancel `quote_trail` (see calculateRefundAmount) — never
// hardcoded.

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
    settlement_counterparty: "buyer-app",
    settlement_phase: "refund",
    settlement_type: s.type ?? "upi",
    settlement_amount: refund.value,
    settlement_status: "PAID",
    settlement_timestamp: params.timestamp,
    ...(s.reference ? { settlement_reference: s.reference } : {}),
    ...(s.upiAddress ? { upi_address: s.upiAddress } : {}),
  };

  // The refund settlement update carries ONLY the payment settlement. The
  // fulfillments are NOT echoed back: the BPP's /update schema restricts
  // fulfillments[].tags[].code to a fixed set (return_request, cancel_request,
  // update_state, update_fulfillment_time, …) that EXCLUDES `quote_trail`, so
  // echoing the on_cancel/on_update fulfillments is rejected with
  // FULFILLMENTS_TAGS_VALID_TAGS. We read `quote_trail` only to COMPUTE the
  // refund amount (above) — the trail itself stays on the BPP's side.
  const order: Record<string, unknown> = {
    id: params.orderId,
    payments: [{ "@ondc/org/settlement_details": [settlementDetail] }],
  };

  return { message: { update_target: "payment", order }, refund };
}

// ---------------------------------------------------------------------------
// Return request update — QA #12
// ---------------------------------------------------------------------------

// Build the return-request `update`. Per the contract a return update carries
// ONLY the return fulfillment (state + return_request tag) — NOT `order.items`
// (QA #12). State defaults to "Return_Initiated"; later transitions
// (Return_Approved / Return_Picked / Liquidated / Return_Delivered) are driven
// by passing `state`.
export function buildReturnUpdate(params: {
  orderId: string;
  fulfillmentId: string;
  itemId?: string;
  quantity?: number;
  reasonId?: string;
  state?: string;
  images?: string[];
}): UpdateMessage {
  const list: OndcTagEntry[] = [{ code: "id", value: params.fulfillmentId }];
  if (params.itemId) list.push({ code: "item_id", value: params.itemId });
  if (params.quantity != null) {
    list.push({ code: "item_quantity", value: String(params.quantity) });
  }
  if (params.reasonId) list.push({ code: "reason_id", value: params.reasonId });
  if (params.images && params.images.length > 0) {
    list.push({ code: "images", value: params.images.join(",") });
  }

  return {
    update_target: "fulfillment",
    order: {
      id: params.orderId,
      // NO `items` — a return update carries only the return fulfillment.
      fulfillments: [
        {
          id: params.fulfillmentId,
          type: "Return",
          state: { descriptor: { code: params.state ?? "Return_Initiated" } },
          tags: [{ code: "return_request", list }],
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Replacement request update — QA #14, #15
// ---------------------------------------------------------------------------

// The replacement lifecycle states, in protocol order. A refund is NOT emitted
// as part of a replacement — replacement substitutes the item; a refund only
// follows later IF the replacement is rejected/cancelled (a separate refund
// update), so this builder never carries settlement details (QA #14).
//
// A replacement is INITIATED with a `return_request` tag, not a
// "replacement_request" tag: the BPP's /update schema restricts
// fulfillments[].tags[].code to a fixed set (return_request, cancel_request,
// update_state, …) that has no replacement-specific code, and QA #15 specifies
// replacement is raised via an "update with return request". The seller then
// resolves that request as a replacement (the substitute item is delivered),
// which is why no refund is sent.
export type ReplacementState =
  | "Replacement_Requested"
  | "Replacement_Approved"
  | "Replacement_Completed"
  | "Replacement_Rejected";

export function buildReplacementUpdate(params: {
  orderId: string;
  fulfillmentId: string;
  itemId?: string;
  quantity?: number;
  reasonId?: string;
  state?: ReplacementState;
}): UpdateMessage {
  const list: OndcTagEntry[] = [{ code: "id", value: params.fulfillmentId }];
  if (params.itemId) list.push({ code: "item_id", value: params.itemId });
  if (params.quantity != null) {
    list.push({ code: "item_quantity", value: String(params.quantity) });
  }
  if (params.reasonId) list.push({ code: "reason_id", value: params.reasonId });

  return {
    update_target: "fulfillment",
    order: {
      id: params.orderId,
      // NO payments/settlement — replacement does not refund immediately.
      fulfillments: [
        {
          id: params.fulfillmentId,
          type: "Replacement",
          state: {
            descriptor: { code: params.state ?? "Replacement_Requested" },
          },
          // `return_request` is the allowed reverse-logistics request tag; the
          // seller resolves it as a replacement (see type note above).
          tags: [{ code: "return_request", list }],
        },
      ],
    },
  };
}
