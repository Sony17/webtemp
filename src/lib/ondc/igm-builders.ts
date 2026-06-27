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
export type IssueLevel = "ISSUE" | "GRIEVANCE" | "DISPUTE";

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
  | "TRANSACTION"
  | "MESSAGE_ID"
  | "COMPLAINT"
  | "CUSTOMER"
  | "PAYMENT"
  | "ACTION";

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

export type IssueActionRow = {
  id: string;
  descriptor: { code: ActionCode; short_desc: string };
  updated_at: string;
  action_by: string;
  actor_details: { name: string };
  // QA #4: certain actions must reference the action/resolution they answer
  // (INFO_PROVIDED -> the INFO_REQUESTED, RESOLUTION_ACCEPTED -> the
  // RESOLUTION_PROPOSED) and INFO_PROVIDED must carry supporting images.
  ref_id?: string;
  images?: IssueImage[];
  // Rejection flow: a RESOLUTION_REJECTED action carries the reason code (and
  // any other structured detail) in tags.
  tags?: IssueTag[];
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
  if (level === "ISSUE") return "GRIEVANCE";
  if (level === "GRIEVANCE") return "DISPUTE";
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

// Build the three parties IGM 2.0 expects on a buyer-initiated issue:
//   CONSUMER         — the buyer (person raising the complaint)
//   INTERFACING_NP   — the BAP (buyer app), the source of the issue
//   COUNTERPARTY_NP  — the BPP (seller app), the respondent
// The CONSUMER id is kept distinct from the INTERFACING_NP id so source_id
// (interfacing NP) and complainant_id (consumer) differ — the audit flagged
// both pointing at the BAP because the interfacing-NP actor was missing.
export type ConsumerInfo = { name: string; phone: string; email?: string };

export type ActorIds = {
  consumerId: string;
  interfacingNpId: string;
  counterpartyNpId: string;
};

export function actorIds(bapId: string, bppId: string): ActorIds {
  return {
    consumerId: `${bapId}_consumer`,
    interfacingNpId: bapId,
    counterpartyNpId: bppId,
  };
}

export function buildActors(params: {
  bapId: string;
  bppId: string;
  consumer: ConsumerInfo;
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
        contact: { phone: c.phone, email: c.email ?? "" },
      },
    },
    {
      id: ids.counterpartyNpId,
      type: "COUNTERPARTY_NP",
      info: {
        org: { name: params.bppId },
        contact: { phone: "", email: "" },
      },
    },
  ];
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
    { ref_id: params.transactionId, ref_type: "TRANSACTION" },
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
      (f): IssueRef => ({
        ref_id: f.id,
        ref_type: "FULFILLMENT",
        tags: [
          {
            descriptor: { code: "FULFILLMENT_STATE" },
            list: [{ descriptor: { code: "state" }, value: f.state }],
          },
        ],
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
  refId?: string;
  images?: IssueImage[];
  // Rejection: when present, attaches a REASON tag carrying the reason code.
  reasonCode?: string;
  tags?: IssueTag[];
}): IssueActionRow {
  const tags: IssueTag[] = params.tags ? [...params.tags] : [];
  if (params.reasonCode) {
    tags.push({
      descriptor: { code: "REASON" },
      list: [{ descriptor: { code: "reason_id" }, value: params.reasonCode }],
    });
  }
  return {
    id: params.id,
    descriptor: { code: params.code, short_desc: params.shortDesc },
    updated_at: params.updatedAt,
    action_by: params.actionBy,
    actor_details: { name: params.actorName },
    ...(params.refId ? { ref_id: params.refId } : {}),
    ...(params.images && params.images.length > 0
      ? { images: params.images }
      : {}),
    ...(tags.length > 0 ? { tags } : {}),
  };
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
    // Stored as a full IssueActionRow when we sent it; trust it, but guard the
    // essentials so a legacy/partial record still yields a valid row.
    if (
      raw &&
      typeof raw === "object" &&
      typeof raw.id === "string" &&
      raw.descriptor &&
      typeof raw.descriptor === "object"
    ) {
      return raw as unknown as IssueActionRow;
    }
    return null;
  }

  // Respondent: the seller's on_issue respondent_actions[] row, e.g.
  // { id?, respondent_action, short_desc, updated_at, ref_id?, images? }.
  const code = (raw.respondent_action ?? entry.action) as ActionCode;
  const id =
    typeof raw.id === "string" && raw.id.trim()
      ? raw.id
      : `resp-${entry.updatedAt}-${code}`;
  const refId = typeof raw.ref_id === "string" ? raw.ref_id : undefined;
  const images = Array.isArray(raw.images)
    ? (raw.images as IssueImage[])
    : undefined;
  return buildActionRow({
    id,
    code,
    shortDesc:
      (typeof raw.short_desc === "string" ? raw.short_desc : entry.shortDesc) ??
      "",
    updatedAt: entry.updatedAt,
    actionBy: ctx.counterpartyNpId,
    actorName: ctx.counterpartyNpId,
    refId,
    images,
  });
}

// ---------------------------------------------------------------------------
// Full v2 issue message
// ---------------------------------------------------------------------------

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
      // QA #1: source_id = the interfacing NP (BAP), complainant_id = the
      // consumer; respondent = the counterparty NP (BPP).
      source_id: params.actorIds.interfacingNpId,
      complainant_id: params.actorIds.consumerId,
      respondent_ids: [params.actorIds.counterpartyNpId],
      descriptor: params.descriptor,
      last_action_id: params.newAction.id,
      actions: [...params.priorActions, params.newAction],
    },
  };
}
