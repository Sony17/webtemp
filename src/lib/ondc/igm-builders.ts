// ONDC IGM (Issue & Grievance Management) message builders.
//
// Protocol logic for the BAP-initiated `issue` action, extracted out of the
// route handler so the wire-shape construction is centralized, unit-testable,
// and shared across the lifecycle steps (OPEN → INFO_PROVIDED → ESCALATE →
// RESOLUTION_ACCEPT/REJECT → CLOSE) and across IGM versions (2.0.0 today, with a
// 1.0.0 compatibility builder layered on the same inputs).
//
// The builders are framework-free (no NextResponse, no config, no I/O). The
// route resolves the effective inputs (merging request body + persisted record)
// and hands them here.
//
// QA remediation (Ecosyz audit) addressed by these builders:
//   #1 actors[] must include INTERFACING_NP (BAP) and COUNTERPARTY_NP (BPP),
//      and source_id/complainant_id must reference the right actors.
//   #2 refs[] ITEM entries must carry item quantity.
//   #3 actions[] must consume the FULL history (complainant + respondent).
//   #4 INFO_PROVIDED / RESOLUTION_ACCEPTED action rows must carry ref_id (and
//      INFO_PROVIDED also images).

// ---------------------------------------------------------------------------
// IGM v2.0.0 wire types
// ---------------------------------------------------------------------------

export type IssueStatus = "OPEN" | "PROCESSING" | "RESOLVED" | "CLOSED";
// NOTE: the ONDC IGM schema enum is the (misspelled) "GREVIENCE", not
// "GRIEVANCE" — the wire MUST use the schema's spelling or REQUIRED_MESSAGE_LEVEL
// NACKs.
export type IssueLevel = "ISSUE" | "GREVIENCE" | "DISPUTE";

export type ActionCode =
  | "OPEN"
  | "PROCESSING"
  | "RESOLVED"
  | "CLOSED"
  | "INFO_REQUESTED"
  | "INFO_PROVIDED"
  | "INFO_NOT_AVAILABLE"
  | "RESOLUTION_PROPOSED"
  | "RESOLUTION_ACCEPTED"
  | "RESOLUTION_REJECTED"
  | "RESOLUTION_CASCADED"
  | "ESCALATED";

export type RefType =
  | "ORDER"
  | "PROVIDER"
  | "FULFILLMENT"
  | "ITEM"
  | "AGENT"
  | "TRANSACTION_ID"
  | "MESSAGE_ID"
  | "COMPLAINT"
  | "CUSTOMER"
  | "PAYMENT"
  | "ACTION"
  // Action-row ref pointing at a proposed resolution (e.g. RESOLUTION_ACCEPTED
  // -> the accepted resolution id). Mirrors the seller's own RESOLVED action,
  // which carries { ref_id, ref_type: "RESOLUTIONS" }.
  | "RESOLUTIONS";

export type ActorType =
  | "CUSTOMER"
  | "CONSUMER"
  | "INTERFACING_NP"
  | "COUNTERPARTY_NP"
  | "PROVIDER"
  | "AGENT"
  | "INTERFACING_NP_GRO"
  | "COUNTERPARTY_NP_GRO"
  | "CASCADED_NP_GRO"
  | "CASCADED_NP"
  | "SELLER";

export type IssueImage = { url: string; size_type?: string };

export type IssueActor = {
  id: string;
  type: ActorType;
  info: {
    org: { name: string };
    person?: { name: string };
    contact: { phone: string; email: string };
  };
};

export type IssueTag = {
  descriptor: { code: string };
  list: Array<{ descriptor: { code: string }; value: string }>;
};

export type IssueRef = {
  ref_id: string;
  ref_type: RefType;
  tags?: IssueTag[];
};

// The IGM 2.0 action object carries id, descriptor, updated_at, action_by,
// actor_details, and (per QA "info provided action> ref_id missing, images
// missing") an optional ref_id (e.g. INFO_PROVIDED -> the seller's
// INFO_REQUESTED) and supporting images inline on the action. A rejection reason
// is still carried as a REASON ref in issue.refs[], not on the action.
export type IssueActionRow = {
  id: string;
  descriptor: { code: ActionCode; short_desc: string };
  updated_at: string;
  action_by: string;
  actor_details: { name: string };
  // QA: an INFO_PROVIDED action references the seller's INFO_REQUESTED via
  // ref_id and carries the supporting images inline on the action itself. A
  // RESOLUTION_ACCEPTED/REJECTED action references the proposed resolution via
  // ref_id + ref_type "RESOLUTIONS" (mirrors the seller's RESOLVED action).
  ref_id?: string;
  ref_type?: RefType;
  images?: IssueImage[];
};

export type IssueV2Message = {
  update_target?: Array<{ path: string; action: "APPENDED" }>;
  issue: {
    id: string;
    status: IssueStatus;
    level: IssueLevel;
    created_at: string;
    updated_at: string;
    expected_response_time: { duration: string };
    expected_resolution_time: { duration: string };
    refs: IssueRef[];
    actors: IssueActor[];
    source_id: string;
    complainant_id: string;
    respondent_ids?: string[];
    descriptor: {
      code: string;
      short_desc: string;
      long_desc: string;
      additional_desc?: { url: string; content_type: string };
      images?: IssueImage[];
    };
    last_action_id: string;
    actions: IssueActionRow[];
    // IGM 2.0: resolution section carried forward from the BPP's on_issue
    // so the outbound /issue (RESOLUTION_ACCEPT/REJECT) echoes the proposed
    // resolution back (QA: "resolution section needs to carry forward in
    // issue call").
    resolution?: {
      short_desc?: string;
      long_desc?: string;
      action_triggered?: string;
      refund_amount?: string;
    };
    // IGM v2.0.0: the full array of resolution options from the BPP (plural),
    // carried forward from on_issue so the outbound /issue echoes them back
    // (QA: "Resolution attribute is missing").
    resolutions?: unknown[];
    resolver_ids?: string[];
  };
};

// The buyer-side lifecycle action selected on each /issue call.
export type ComplainantAction =
  | "OPEN"
  | "INFO_PROVIDED"
  | "ESCALATE"
  | "RESOLUTION_ACCEPT"
  | "RESOLUTION_REJECT"
  | "CLOSE";

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

// IGM 2.0 constrains issue.status to a 4-value enum. Interim complainant moves
// collapse to PROCESSING; OPEN/CLOSE keep their names. Terminal RESOLVED is
// owned by the seller's on_issue.
export function statusForAction(action: ComplainantAction): IssueStatus {
  switch (action) {
    case "OPEN":
      return "OPEN";
    case "INFO_PROVIDED":
    case "ESCALATE":
    case "RESOLUTION_ACCEPT":
    case "RESOLUTION_REJECT":
      return "PROCESSING";
    case "CLOSE":
      return "CLOSED";
  }
}

// No-action / timeout handling: when the seller does not respond (no on_issue)
// or takes no action, the buyer ESCALATEs, which bumps the grievance tier. An
// un-actioned issue otherwise stays OPEN (pending) — there is no separate
// "pending" status in the IGM 2.0 enum; OPEN with no respondent action IS
// pending. DISPUTE is terminal for escalation.
export function escalateLevel(level: IssueLevel): IssueLevel {
  if (level === "ISSUE") return "GREVIENCE";
  if (level === "GREVIENCE") return "DISPUTE";
  return "DISPUTE";
}

// The action.descriptor.code IGM 2.0 expects per complainant move.
export function actionCodeFor(action: ComplainantAction): ActionCode {
  switch (action) {
    case "OPEN":
      return "OPEN";
    case "INFO_PROVIDED":
      return "INFO_PROVIDED";
    case "ESCALATE":
      return "ESCALATED";
    case "RESOLUTION_ACCEPT":
      return "RESOLUTION_ACCEPTED";
    case "RESOLUTION_REJECT":
      return "RESOLUTION_REJECTED";
    case "CLOSE":
      return "CLOSED";
  }
}

// ---------------------------------------------------------------------------
// Actors (QA #1)
// ---------------------------------------------------------------------------

// Build the parties IGM 2.0 expects on a buyer-initiated OPEN:
//   CONSUMER         — the buyer (person raising the complaint)
//   INTERFACING_NP   — the BAP (buyer app), the source of the issue
// COUNTERPARTY_NP is NOT included here — the seller (BPP) adds it in its
// on_issue callback (QA: "COUNTERPARTY_NP actor is not required from buyer").
// After on_issue, the snapshot carries the BPP's full actor set (including
// COUNTERPARTY_NP) so follow-up issue calls pick it up from the snap.
// The CONSUMER id is kept distinct from the INTERFACING_NP id so source_id
// (interfacing NP) and complainant_id (consumer) differ — the audit flagged
// both pointing at the BAP because the interfacing-NP actor was missing.
export type ConsumerInfo = { name: string; phone: string; email?: string };

export type ActorIds = {
  consumerId: string;
  interfacingNpId: string;
  counterpartyNpId: string;
  // The complainant NP's Grievance Redressal Officer — only added to the wire
  // once the issue is escalated to GREVIENCE/DISPUTE (see buildInterfacingNpGro).
  interfacingNpGroId: string;
};

export function actorIds(bapId: string, bppId: string): ActorIds {
  return {
    consumerId: `${bapId}_consumer`,
    interfacingNpId: bapId,
    counterpartyNpId: bppId,
    interfacingNpGroId: `${bapId}_gro`,
  };
}

// Build the complainant NP's Grievance Redressal Officer actor. Per the IGM 2.0
// grievance model, when an issue is escalated to GREVIENCE (or DISPUTE) the
// complainant NP MUST surface its GRO as an INTERFACING_NP_GRO actor (mirroring
// the respondent's COUNTERPARTY_NP_GRO), and the escalation action is attributed
// to that GRO. org.name follows the `subscriber_id::domain` convention.
export function buildInterfacingNpGro(params: {
  bapId: string;
  domain: string;
  name: string;
  phone?: string;
  email?: string;
}): IssueActor {
  return {
    id: `${params.bapId}_gro`,
    type: "INTERFACING_NP_GRO",
    info: {
      org: { name: `${params.bapId}::${params.domain}` },
      person: { name: params.name },
      contact: { phone: params.phone ?? "", email: params.email ?? "" },
    },
  };
}

export function buildActors(params: {
  bapId: string;
  bppId: string;
  consumer: ConsumerInfo;
  interfacingPersonName?: string;
}): IssueActor[] {
  const ids = actorIds(params.bapId, params.bppId);
  const c = params.consumer;
  return [
    {
      id: ids.consumerId,
      type: "CONSUMER",
      info: {
        org: { name: params.bapId },
        person: { name: c.name },
        contact: { phone: c.phone, email: c.email ?? "" },
      },
    },
    {
      id: ids.interfacingNpId,
      type: "INTERFACING_NP",
      info: {
        org: { name: params.bapId },
        person: { name: params.interfacingPersonName ?? c.name },
        contact: { phone: c.phone, email: c.email ?? "" },
      },
    },
  ];
}

// QA (iter 7, both IGM flows): "interfacing NP person details missing in actors
// section." Follow-up issue calls (RESOLUTION_ACCEPT / CLOSE / …) reuse the
// actor set persisted from the seller's on_issue snapshot, and the seller can
// echo our INTERFACING_NP actor WITHOUT `person` (it is optional on the wire).
// Only OPEN — which builds actors fresh via buildActors — carried person, which
// is why local single-shot testing looked fine. This re-asserts full
// org/person/contact on OUR INTERFACING_NP actor, preserving any existing
// person name, so the interfacing NP's person is present on every issue call.
// Other actor types (CONSUMER, COUNTERPARTY_NP, GRO) pass through untouched.
export function ensureInterfacingNpPerson(
  actors: IssueActor[],
  fill: { bapId: string; personName: string; phone: string; email?: string }
): IssueActor[] {
  // `||` (not `??`) so an empty string the seller echoed is treated as absent —
  // an empty person.name is exactly the "person details missing" failure.
  return actors.map((a) =>
    a.type === "INTERFACING_NP"
      ? {
          ...a,
          info: {
            org: { name: fill.bapId },
            person: { name: a.info?.person?.name || fill.personName },
            contact: {
              phone: a.info?.contact?.phone || fill.phone,
              email: a.info?.contact?.email || fill.email || "",
            },
          },
        }
      : a
  );
}

// ---------------------------------------------------------------------------
// Refs (QA #2 — item quantity)
// ---------------------------------------------------------------------------

export type IssueItem = { id: string; quantity: number };
export type IssueFulfillment = { id: string; state: string };

export function buildRefs(params: {
  orderId: string;
  providerId: string;
  transactionId: string;
  items: IssueItem[];
  fulfillments: IssueFulfillment[];
}): IssueRef[] {
  return [
    { ref_id: params.orderId, ref_type: "ORDER" },
    { ref_id: params.providerId, ref_type: "PROVIDER" },
    // QA: the TRANSACTION_ID ref is NOT required (it is already carried in
    // context.transaction_id) — omitted.
    ...params.items.map(
      (it): IssueRef => ({
        ref_id: it.id,
        ref_type: "ITEM",
        // QA #2: item quantity must be present in the refs section.
        tags: [
          {
            descriptor: { code: "ITEM_QUANTITY" },
            list: [
              { descriptor: { code: "count" }, value: String(it.quantity) },
            ],
          },
        ],
      })
    ),
    ...params.fulfillments.map(
      // QA: tags on the FULFILLMENT ref are NOT required — emit the bare ref
      // (the FULFILLMENT_STATE tag is dropped). `f.state` is retained on the
      // param for the caller's snapshot hydration but no longer serialized.
      (f): IssueRef => ({
        ref_id: f.id,
        ref_type: "FULFILLMENT",
      })
    ),
  ];
}

// ---------------------------------------------------------------------------
// Action rows (QA #3 consume-all, QA #4 ref_id/images)
// ---------------------------------------------------------------------------

export function buildActionRow(params: {
  id: string;
  code: ActionCode;
  shortDesc: string;
  updatedAt: string;
  actionBy: string;
  actorName: string;
  // QA: carried on INFO_PROVIDED (ref_id -> the seller's INFO_REQUESTED, plus
  // the supporting images). Omitted for actions that don't need them. A
  // resolution response also sets refType "RESOLUTIONS" so the ref_id names the
  // proposed resolution (QA 07-03 "resolution accepted action> ref_id missing").
  refId?: string;
  refType?: RefType;
  images?: IssueImage[];
}): IssueActionRow {
  return {
    id: params.id,
    descriptor: { code: params.code, short_desc: params.shortDesc },
    updated_at: params.updatedAt,
    action_by: params.actionBy,
    actor_details: { name: params.actorName },
    ...(params.refId ? { ref_id: params.refId } : {}),
    ...(params.refId && params.refType ? { ref_type: params.refType } : {}),
    ...(params.images && params.images.length > 0
      ? { images: params.images }
      : {}),
  };
}

// QA #4 references and the rejection reason are carried in issue.refs[] (an
// ACTION ref points at the answered action; a REASON ref carries the reason
// code) — keeping the strict action object clean. Returns the refs to append.
export function buildActionRefs(params: {
  refId?: string;
  reasonCode?: string;
}): IssueRef[] {
  const out: IssueRef[] = [];
  if (params.refId) out.push({ ref_id: params.refId, ref_type: "ACTION" });
  if (params.reasonCode) {
    out.push({
      ref_id: params.reasonCode,
      ref_type: "COMPLAINT",
      tags: [
        {
          descriptor: { code: "REASON" },
          list: [
            { descriptor: { code: "reason_id" }, value: params.reasonCode },
          ],
        },
      ],
    });
  }
  return out;
}

// Project a persisted action history entry (from IssueRecord.actions, which is
// append-only across BOTH complainant and respondent actions) into a wire
// IssueActionRow, so the outbound issue can carry the COMPLETE action history
// (QA #3 — "all actions need to be consumed"). Complainant entries already
// stored their full wire row in `raw`; respondent entries stored the seller's
// raw on_issue action, which we normalize here.
export function projectStoredAction(
  entry: {
    actor: "complainant" | "respondent";
    action: string;
    shortDesc?: string;
    updatedAt: string;
    raw: unknown;
  },
  ctx: { counterpartyNpId: string }
): IssueActionRow | null {
  const raw = (entry.raw ?? {}) as Record<string, unknown>;

    if (entry.actor === "complainant") {
    if (
      raw &&
      typeof raw === "object" &&
      typeof raw.id === "string" &&
      raw.descriptor &&
      typeof raw.descriptor === "object"
    ) {
      const d = raw.descriptor as { code?: ActionCode; short_desc?: string };
      const actorName =
        (raw.actor_details as { name?: string } | undefined)?.name ?? "";
      return buildActionRow({
        id: raw.id,
        code: (d.code ?? (entry.action as ActionCode)) as ActionCode,
        shortDesc: d.short_desc ?? entry.shortDesc ?? "",
        updatedAt:
          typeof raw.updated_at === "string" ? raw.updated_at : entry.updatedAt,
        actionBy: typeof raw.action_by === "string" ? raw.action_by : "",
        actorName,
        refId: typeof raw.ref_id === "string" ? raw.ref_id : undefined,
        refType: typeof raw.ref_type === "string"
          ? (raw.ref_type as RefType)
          : undefined,
        images: Array.isArray(raw.images) && raw.images.length > 0
          ? (raw.images as IssueImage[])
          : undefined,
      });
    }
    return null;
  }

  // Respondent — two on-wire shapes:
  //   v2.0.0: the seller's `issue.actions[]` row, carrying a descriptor{code,
  //     short_desc}, its own action_by/actor_details, and (for resolution rows)
  //     ref_id + ref_type. We echo it VERBATIM so the outbound issue carries the
  //     FULL, faithful action trail (QA 07-03 "sellers actions not consumed").
  //   v1.0.0: the flat respondent_actions[] row { respondent_action, short_desc,
  //     updated_at }, projected into the strict shape.
  const v2Desc = raw.descriptor as
    | { code?: ActionCode; short_desc?: string }
    | undefined;
  if (v2Desc && typeof v2Desc === "object" && typeof v2Desc.code === "string") {
    const actorName =
      (raw.actor_details as { name?: string } | undefined)?.name ??
      ctx.counterpartyNpId;
    const row: IssueActionRow = {
      id:
        typeof raw.id === "string" && raw.id.trim()
          ? raw.id
          : `resp-${entry.updatedAt}-${v2Desc.code}`,
      descriptor: {
        code: v2Desc.code,
        short_desc: v2Desc.short_desc ?? entry.shortDesc ?? "",
      },
      updated_at:
        typeof raw.updated_at === "string" ? raw.updated_at : entry.updatedAt,
      action_by:
        typeof raw.action_by === "string"
          ? raw.action_by
          : ctx.counterpartyNpId,
      actor_details: { name: actorName },
      ...(typeof raw.ref_id === "string" ? { ref_id: raw.ref_id } : {}),
      ...(typeof raw.ref_type === "string"
        ? { ref_type: raw.ref_type as RefType }
        : {}),
    };
    return row;
  }

  const code = (raw.respondent_action ?? entry.action) as ActionCode;
  const id =
    typeof raw.id === "string" && raw.id.trim()
      ? raw.id
      : `resp-${entry.updatedAt}-${code}`;
  return buildActionRow({
    id,
    code,
    shortDesc:
      (typeof raw.short_desc === "string" ? raw.short_desc : entry.shortDesc) ??
      "",
    updatedAt: entry.updatedAt,
    actionBy: ctx.counterpartyNpId,
    actorName: ctx.counterpartyNpId,
    refId: typeof raw.ref_id === "string" ? raw.ref_id : undefined,
    refType: typeof raw.ref_type === "string"
      ? (raw.ref_type as RefType)
      : undefined,
    images: Array.isArray(raw.images) && raw.images.length > 0
      ? (raw.images as IssueImage[])
      : undefined,
  });
}

// ---------------------------------------------------------------------------
// Full v2 issue message
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// IGM v1.0.0 compatibility
// ---------------------------------------------------------------------------
//
// The legacy (pre-2.0) IGM shape: a flat issue with category/sub_category,
// complainant_info, order_details, description, and issue_actions split into
// complainant_actions[] / respondent_actions[]. Used when a BPP only speaks IGM
// 1.0.0 (domain ONDC:IGM, core_version 1.0.0). Business inputs (items,
// fulfillments, consumer, descriptor, action history) are SHARED with v2 — only
// the wire projection differs.

export type IssueV1ActionRow = {
  complainant_action?: string;
  respondent_action?: string;
  short_desc: string;
  updated_at: string;
  updated_by: {
    org: { name: string };
    contact: { phone: string; email: string };
    person?: { name: string };
  };
};

export type IssueV1Message = {
  issue: {
    id: string;
    category: string;
    sub_category: string;
    complainant_info: {
      person: { name: string };
      contact: { phone: string; email: string };
    };
    order_details: {
      id: string;
      state: string;
      items: Array<{ id: string; quantity: number }>;
      fulfillments: Array<{ id: string; state: string }>;
      provider_id: string;
    };
    description: {
      short_desc: string;
      long_desc: string;
      additional_desc?: { url: string; content_type: string };
      images?: string[];
    };
    source: {
      network_participant_id: string;
      type: "CONSUMER" | "INTERFACING_NP";
    };
    expected_response_time: { duration: string };
    expected_resolution_time: { duration: string };
    status: "OPEN" | "CLOSED";
    issue_type: IssueLevel;
    issue_actions: {
      complainant_actions: IssueV1ActionRow[];
      respondent_actions: IssueV1ActionRow[];
    };
    created_at: string;
    updated_at: string;
  };
};

// v1 complainant_action codes differ slightly from v2's action descriptor codes
// (CLOSE not CLOSED, ESCALATE not ESCALATED).
export function v1ActionCode(action: ComplainantAction): string {
  switch (action) {
    case "OPEN":
      return "OPEN";
    case "INFO_PROVIDED":
      return "INFO_PROVIDED";
    case "ESCALATE":
      return "ESCALATE";
    case "RESOLUTION_ACCEPT":
      return "RESOLUTION_ACCEPTED";
    case "RESOLUTION_REJECT":
      return "RESOLUTION_REJECTED";
    case "CLOSE":
      return "CLOSE";
  }
}

// v1 status is a 2-value enum: an issue is OPEN until it is CLOSEd.
export function v1Status(action: ComplainantAction): "OPEN" | "CLOSED" {
  return action === "CLOSE" ? "CLOSED" : "OPEN";
}

// Project a persisted history entry into a v1 action row (complainant_actions or
// respondent_actions). Shares IssueRecord.actions with the v2 path.
export function projectStoredActionV1(
  entry: {
    actor: "complainant" | "respondent";
    action: string;
    shortDesc?: string;
    updatedAt: string;
    raw: unknown;
  },
  ctx: { bapId: string; bppId: string; domain: string; consumer: ConsumerInfo }
): IssueV1ActionRow {
  const raw = (entry.raw ?? {}) as Record<string, unknown>;
  if (entry.actor === "complainant") {
    return {
      complainant_action: v1ActionCode(entry.action as ComplainantAction),
      short_desc: entry.shortDesc ?? "",
      updated_at: entry.updatedAt,
      updated_by: {
        // IGM v1.0.0 footnote 23: org.name = subscriber_id::domain.
        org: { name: `${ctx.bapId}::${ctx.domain}` },
        contact: {
          phone: ctx.consumer.phone,
          email: ctx.consumer.email ?? "",
        },
        person: { name: ctx.consumer.name },
      },
    };
  }
  return {
    respondent_action:
      (typeof raw.respondent_action === "string"
        ? raw.respondent_action
        : entry.action) || entry.action,
    short_desc:
      (typeof raw.short_desc === "string" ? raw.short_desc : entry.shortDesc) ??
      "",
    updated_at: entry.updatedAt,
    updated_by: {
      org: { name: `${ctx.bppId}::${ctx.domain}` },
      contact: { phone: "", email: "" },
    },
  };
}

export function buildIssueV1(params: {
  issueId: string;
  action: ComplainantAction;
  createdAt: string;
  now: string;
  category: string;
  subCategory: string;
  bapId: string;
  bppId: string;
  domain: string;
  consumer: ConsumerInfo;
  orderId: string;
  orderState: string;
  providerId: string;
  items: IssueItem[];
  fulfillments: IssueFulfillment[];
  shortDesc: string;
  longDesc: string;
  additionalDescUrl?: string;
  images?: string[];
  level: IssueLevel;
  // The full persisted history (complainant + respondent) and the new row.
  priorEntries: Array<{
    actor: "complainant" | "respondent";
    action: string;
    shortDesc?: string;
    updatedAt: string;
    raw: unknown;
  }>;
  newActionShortDesc: string;
  responseDuration?: string;
  resolutionDuration?: string;
}): IssueV1Message {
  const ctx = {
    bapId: params.bapId,
    bppId: params.bppId,
    domain: params.domain,
    consumer: params.consumer,
  };
  const priorRows = params.priorEntries.map((e) =>
    projectStoredActionV1(e, ctx)
  );
  const newRow: IssueV1ActionRow = {
    complainant_action: v1ActionCode(params.action),
    short_desc: params.newActionShortDesc,
    updated_at: params.now,
    updated_by: {
      // IGM v1.0.0 footnote 23: org.name = subscriber_id::domain.
      org: { name: `${params.bapId}::${params.domain}` },
      contact: {
        phone: params.consumer.phone,
        email: params.consumer.email ?? "",
      },
      person: { name: params.consumer.name },
    },
  };

  return {
    issue: {
      id: params.issueId,
      category: params.category,
      sub_category: params.subCategory,
      complainant_info: {
        person: { name: params.consumer.name },
        contact: {
          phone: params.consumer.phone,
          email: params.consumer.email ?? "",
        },
      },
      order_details: {
        id: params.orderId,
        state: params.orderState,
        items: params.items,
        fulfillments: params.fulfillments,
        provider_id: params.providerId,
      },
      description: {
        short_desc: params.shortDesc,
        long_desc: params.longDesc,
        // IGM v1.0.0: additional_desc { url, content_type } is present in every
        // spec /issue example (footnote 15, optional but shown throughout).
        ...(params.additionalDescUrl
          ? {
              additional_desc: {
                url: params.additionalDescUrl,
                content_type: "text/plain",
              },
            }
          : {}),
        ...(params.images && params.images.length > 0
          ? { images: params.images }
          : {}),
      },
      source: {
        network_participant_id: params.bapId,
        // IGM v1.0.0: when the buyer raises the complaint, source.type is
        // "CONSUMER" (spec enum CONSUMER/SELLER/INTERFACING NP; every buyer-raised
        // example uses CONSUMER). The BAP is the interfacing NP but the SOURCE of
        // the complaint is the consumer.
        type: "CONSUMER",
      },
      expected_response_time: { duration: params.responseDuration ?? "PT1H" },
      expected_resolution_time: {
        duration: params.resolutionDuration ?? "P1D",
      },
      status: v1Status(params.action),
      issue_type: params.level,
      issue_actions: {
        complainant_actions: [
          ...priorRows.filter((r) => r.complainant_action),
          newRow,
        ],
        respondent_actions: priorRows.filter((r) => r.respondent_action),
      },
      created_at: params.createdAt,
      updated_at: params.now,
    },
  };
}

export function buildIssueV2(params: {
  issueId: string;
  action: ComplainantAction;
  status: IssueStatus;
  level: IssueLevel;
  createdAt: string;
  now: string;
  actors: IssueActor[];
  actorIds: ActorIds;
  refs: IssueRef[];
  descriptor: IssueV2Message["issue"]["descriptor"];
  // The complete prior history (projected from IssueRecord.actions) and the new
  // row being appended this call.
  priorActions: IssueActionRow[];
  newAction: IssueActionRow;
  responseDuration?: string;
  resolutionDuration?: string;
  // IGM 2.0: resolution block carried forward from BPP's on_issue when the
  // buyer is responding to a proposed resolution (RESOLUTION_ACCEPT/REJECT).
  // Must be included in the outbound /issue so the BPP can match the response
  // to the proposed resolution (QA: "resolution section needs to carry forward
  // in issue call").
  resolution?: IssueV2Message["issue"]["resolution"];
  // IGM v2.0.0: the full array of resolution options + resolver ids from the
  // BPP's on_issue snapshot. Carried forward verbatim for RESOLUTION_ACCEPT,
  // RESOLUTION_REJECT, and CLOSE (QA: "Resolution attribute is missing").
  resolutions?: unknown[];
  resolverIds?: string[];
}): IssueV2Message {
  return {
    ...(params.action !== "OPEN"
      ? {
          update_target: [
            { path: "message.issue.actions", action: "APPENDED" as const },
          ],
        }
      : {}),
    issue: {
      id: params.issueId,
      status: params.status,
      level: params.level,
      created_at: params.createdAt,
      updated_at: params.now,
      expected_response_time: { duration: params.responseDuration ?? "PT1H" },
      expected_resolution_time: {
        duration: params.resolutionDuration ?? "P1D",
      },
      refs: params.refs,
      actors: params.actors,
      // source_id = the CONSUMER (the source/origin of the complaint),
      // complainant_id = the INTERFACING NP (the BAP raising it on the
      // consumer's behalf); respondent = the counterparty NP (BPP). QA flagged
      // the previous inversion ("source type should be CONSUMER in this case").
      source_id: params.actorIds.consumerId,
      complainant_id: params.actorIds.interfacingNpId,
      respondent_ids: [params.actorIds.counterpartyNpId],
      descriptor: params.descriptor,
      last_action_id: params.newAction.id,
      actions: [...params.priorActions, params.newAction],
      ...(params.resolution ? { resolution: params.resolution } : {}),
      ...(params.resolutions !== undefined
        ? { resolutions: params.resolutions }
        : {}),
      ...(params.resolverIds !== undefined
        ? { resolver_ids: params.resolverIds }
        : {}),
    },
  };
}
