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

// The IGM 2.0 action object is STRICT (additionalProperties:false): only id,
// descriptor, updated_at, action_by, actor_details are allowed. Supporting
// images live on the ISSUE descriptor (issue.descriptor.images), the action
// reference (ref_id) is carried as an ACTION entry in issue.refs[], and a
// rejection reason is carried as a REASON ref — NOT as extra action properties.
export type IssueActionRow = {
  id: string;
  descriptor: { code: ActionCode; short_desc: string };
  updated_at: string;
  action_by: string;
  actor_details: { name: string };
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
    { ref_id: params.transactionId, ref_type: "TRANSACTION_ID" },
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
}): IssueActionRow {
  return {
    id: params.id,
    descriptor: { code: params.code, short_desc: params.shortDesc },
    updated_at: params.updatedAt,
    action_by: params.actionBy,
    actor_details: { name: params.actorName },
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
    // Rebuild a CLEAN strict row from the stored fields. Never return the stored
    // object verbatim — a legacy/pre-fix record may carry now-disallowed props
    // (images/ref_id/tags) that would re-pollute the strict action object.
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
      });
    }
    return null;
  }

  // Respondent: the seller's on_issue respondent_actions[] row, e.g.
  // { id?, respondent_action, short_desc, updated_at }. Projected to the strict
  // action shape (ref_id/images, if any, are the seller's concern).
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
  ctx: { bapId: string; bppId: string; consumer: ConsumerInfo }
): IssueV1ActionRow {
  const raw = (entry.raw ?? {}) as Record<string, unknown>;
  if (entry.actor === "complainant") {
    return {
      complainant_action: v1ActionCode(entry.action as ComplainantAction),
      short_desc: entry.shortDesc ?? "",
      updated_at: entry.updatedAt,
      updated_by: {
        org: { name: ctx.bapId },
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
      org: { name: ctx.bppId },
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
  consumer: ConsumerInfo;
  orderId: string;
  orderState: string;
  providerId: string;
  items: IssueItem[];
  fulfillments: IssueFulfillment[];
  shortDesc: string;
  longDesc: string;
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
      org: { name: params.bapId },
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
        ...(params.images && params.images.length > 0
          ? { images: params.images }
          : {}),
      },
      source: {
        network_participant_id: params.bapId,
        type: "INTERFACING_NP",
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
