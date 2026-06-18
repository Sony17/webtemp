// ONDC BAP `issue` endpoint — opens AND extends an IGM (v2.0.0) grievance.
//
// IGM (Issue & Grievance Management) is post-order; a buyer files a complaint
// against a confirmed order and the seller responds asynchronously through
// /on_issue. The lifecycle the workbench drives is:
//
//   issue(OPEN)  → on_issue(PROCESSING)
//                → on_issue(NEED_MORE_INFO)
//   issue(INFO_PROVIDED) → on_issue(PROCESSING)
//                → on_issue(RESOLUTION_PROPOSED)
//   issue(RESOLUTION_ACCEPT or RESOLUTION_REJECT) → on_issue(RESOLVED)
//   issue(CLOSE)
//
// All of these reuse THIS route. The complainant_action in the body selects
// which lifecycle step is being driven; the issueId (omitted on OPEN, present
// on every later step) keeps successive calls threaded to the same grievance.
//
// Persistence: every send writes to the store BEFORE the wire call goes out, so
// even a transport failure leaves a record of what the buyer attempted. The
// store backend is picked by the dispatcher (file-JSON in dev, Postgres-Event
// in prod) — see ../../../../lib/ondc/store.ts.
//
// IGM v2.0.0 is a separate domain (`ONDC:IGM`) and core_version line. Defaults
// below match what the staging workbench expects; both are overridable.
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { isOndcConfigured, getOndcConfig } from "@/lib/ondc/config";
import { buildContext } from "@/lib/ondc/context";
import { sendOndcRequest, OndcClientError } from "@/lib/ondc/client";
import { saveIssue, getIssue, type IssueActionEntry } from "@/lib/ondc/store";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Request shape
// ---------------------------------------------------------------------------
//
//   POST /api/ondc/issue
//   {
//     // routing
//     "transactionId": "...",
//     "bppId":  "staging-automation.ondc.org",
//     "bppUri": "https://workbench.ondc.tech/api-service/ONDC:RET10/1.2.5/seller",
//     "domain":      "ONDC:IGM",        // optional, defaults to "ONDC:IGM"
//     "coreVersion": "2.0.0",           // optional, defaults to "2.0.0"
//
//     // OPEN-only fields (ignored on every other action)
//     "category":    "ITEM",
//     "subCategory": "ITM02",
//     "shortDesc":   "...",
//     "longDesc":    "...",
//     "issueType":   "ISSUE",           // optional, defaults to "ISSUE"
//     "complainant": { name, phone, email },
//     "orderId":     "O-1781727199",    // required on OPEN
//     "orderState":  "Completed",       // optional, default "Completed"
//     "providerId":  "P1",
//     "items":        [{id, quantity}],
//     "fulfillments": [{id, state}],
//
//     // Threading (required for every action AFTER open)
//     "issueId":           "<uuid from the original OPEN response>",
//     "complainantAction": "OPEN" | "INFO_PROVIDED" | "ESCALATE"
//                        | "RESOLUTION_ACCEPT" | "RESOLUTION_REJECT" | "CLOSE",
//     "actionDesc":        "Free-text describing this action"  // optional
//   }
//
// The route returns ACK + the issueId so the client can thread the next call.
type ComplainantAction =
  | "OPEN"
  | "INFO_PROVIDED"
  | "ESCALATE"
  | "RESOLUTION_ACCEPT"
  | "RESOLUTION_REJECT"
  | "CLOSE";

const VALID_ACTIONS = new Set<ComplainantAction>([
  "OPEN",
  "INFO_PROVIDED",
  "ESCALATE",
  "RESOLUTION_ACCEPT",
  "RESOLUTION_REJECT",
  "CLOSE",
]);

type IssueRequestBody = {
  transactionId?: string;
  bppId?: string;
  bppUri?: string;
  orderId?: string;
  category?: string;
  subCategory?: string;
  shortDesc?: string;
  longDesc?: string;
  issueType?: string;
  coreVersion?: string;
  domain?: string;
  complainant?: { name?: string; phone?: string; email?: string };
  orderState?: string;
  providerId?: string;
  items?: Array<{ id: string; quantity: number }>;
  fulfillments?: Array<{ id: string; state: string }>;
  issueId?: string;
  complainantAction?: string;
  actionDesc?: string;
};

// IGM v2.0.0 wire message — schema-matches
// log-validation-utility/schema/Igm/2.0.0/issue.ts. IGM 2.0 is EMBEDDED in the
// parent retail domain (ONDC:RET10/RET11/…) — context.domain is the retail
// domain, context.core_version is the retail 1.2.5, and BPP routes /issue
// through the same seller endpoint that handles select/init/confirm. The OLD
// pre-2.0 shape (category, sub_category, complainant_info, order_details,
// description, issue_actions.complainant_actions[]) is dropped; the workbench
// silently NACKs anything not matching the schema below, which is why on_issue
// never fired against the RET10 BPP — see also project memory note 3.
type IssueStatus = "OPEN" | "PROCESSING" | "RESOLVED" | "CLOSED";
type IssueLevel = "ISSUE" | "GRIEVANCE" | "DISPUTE";
type ActionCode =
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
type RefType =
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
type ActorType =
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

type IssueActionRow = {
  id: string;
  descriptor: { code: ActionCode; short_desc: string };
  updated_at: string;
  action_by: string;
  actor_details: { name: string };
};

type IssueActor = {
  id: string;
  type: ActorType;
  info: {
    org: { name: string };
    person?: { name: string };
    contact: { phone: string; email: string };
  };
};

type OndcIssueMessage = {
  // APPENDED hint helps the BPP's resolver know we're extending, not replacing.
  // Schema marks `update_target` optional — included on every non-OPEN action.
  update_target?: Array<{ path: string; action: "APPENDED" }>;
  issue: {
    id: string;
    status: IssueStatus;
    level: IssueLevel;
    created_at: string;
    updated_at: string;
    expected_response_time: { duration: string };
    expected_resolution_time: { duration: string };
    refs: Array<{
      ref_id: string;
      ref_type: RefType;
      tags?: Array<unknown>;
    }>;
    actors: IssueActor[];
    source_id: string;
    complainant_id: string;
    respondent_ids?: string[];
    descriptor: {
      code: string;
      short_desc: string;
      long_desc: string;
      additional_desc?: { url: string; content_type: string };
      images?: Array<{ url: string; size_type?: string }>;
    };
    last_action_id: string;
    actions: IssueActionRow[];
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t ? t : undefined;
}

function isValidAction(value: string): value is ComplainantAction {
  return VALID_ACTIONS.has(value as ComplainantAction);
}

// IGM 2.0 schema constrains issue.status to a 4-value enum. Every interim
// complainant action collapses to PROCESSING (the buyer signals movement; the
// terminal RESOLVED/CLOSED are owned by the seller's on_issue or our CLOSE).
function statusForAction(action: ComplainantAction): IssueStatus {
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

// The action.descriptor.code IGM 2.0 expects per complainant move. CLOSE/OPEN
// reuse their names; the rest map to the schema's enum (RESOLUTION_ACCEPTED,
// not RESOLUTION_ACCEPT, etc.).
function actionCodeFor(action: ComplainantAction): ActionCode {
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
// Handler
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
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

  const body = (raw ?? {}) as IssueRequestBody;
  const transactionId = str(body.transactionId);
  const bppId = str(body.bppId);
  const bppUri = str(body.bppUri);
  const complainantName = str(body.complainant?.name);
  const complainantPhone = str(body.complainant?.phone);
  const complainantEmail = str(body.complainant?.email);
  // IGM 2.0 is embedded in the parent retail domain — context.domain is the
  // retail flow's domain (ONDC:RET10/11/…), and core_version is the retail
  // 1.2.5 line. ONDC:IGM / 2.0.0 are NOT in the log-validation schema's enum;
  // BPPs silently NACK them. Override via body when running a non-RET10 flow.
  const coreVersion = str(body.coreVersion) ?? "1.2.5";
  const domain = str(body.domain) ?? "ONDC:RET10";
  const actionDescOverride = str(body.actionDesc);

  // Action selection — default OPEN preserves the historical single-shot API.
  const rawAction = str(body.complainantAction) ?? "OPEN";
  if (!isValidAction(rawAction)) {
    return NextResponse.json(
      {
        error: `'complainantAction' must be one of: ${Array.from(VALID_ACTIONS).join(", ")}`,
      },
      { status: 400 }
    );
  }
  const action: ComplainantAction = rawAction;
  const issueIdInput = str(body.issueId);

  if (!transactionId) {
    return NextResponse.json(
      { error: "'transactionId' is required (reuse the id from confirm)." },
      { status: 400 }
    );
  }
  if (!bppId || !bppUri) {
    return NextResponse.json(
      { error: "'bppId' and 'bppUri' are required for issue." },
      { status: 400 }
    );
  }

  let bppOrigin: string;
  try {
    const url = new URL(bppUri);
    // Allow http only for localhost (local IGM stub at /api/igm-stub). Every
    // real BPP on the network must be https.
    const isLocalhost =
      url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalhost)) {
      throw new Error("not https");
    }
    bppOrigin = url.toString().replace(/\/+$/, "");
  } catch {
    return NextResponse.json(
      { error: "'bppUri' must be a valid https URL (or http://localhost for local stub)." },
      { status: 400 }
    );
  }

  // Resolve the existing issue (if any) — every action except OPEN needs it.
  // We pull the existing record first so non-OPEN actions can inherit the
  // order_details / category / sub_category the original OPEN set, and so we
  // can fail fast when the client forgets to pass issueId on a follow-up.
  const existing = issueIdInput
    ? await getIssue(transactionId, issueIdInput)
    : null;

  if (action !== "OPEN" && !existing) {
    return NextResponse.json(
      {
        error:
          `'issueId' must be provided for action "${action}" and must reference an existing OPEN issue.`,
      },
      { status: 400 }
    );
  }

  // OPEN-only required fields (validated only on OPEN; on follow-ups we
  // inherit from the persisted record).
  if (action === "OPEN") {
    if (!complainantPhone) {
      return NextResponse.json(
        { error: "'complainant.phone' is required on OPEN." },
        { status: 400 }
      );
    }
    if (!str(body.orderId)) {
      return NextResponse.json(
        { error: "'orderId' is required on OPEN." },
        { status: 400 }
      );
    }
    if (!str(body.category)) {
      return NextResponse.json(
        { error: "'category' is required on OPEN (e.g. 'ITEM')." },
        { status: 400 }
      );
    }
    if (!str(body.subCategory)) {
      return NextResponse.json(
        { error: "'subCategory' is required on OPEN (e.g. 'ITM02')." },
        { status: 400 }
      );
    }
    if (!str(body.shortDesc) || !str(body.longDesc)) {
      return NextResponse.json(
        { error: "'shortDesc' and 'longDesc' are required on OPEN." },
        { status: 400 }
      );
    }
  }

  // Decide every effective field by merging "body wins, then existing
  // wins, then sane default". The shape this populates is the one IGM v2.0.0
  // requires on the wire — and that we also persist locally.
  const existingIssue = existing?.issue as
    | OndcIssueMessage["issue"]
    | undefined;
  const issueId = action === "OPEN" ? randomUUID() : issueIdInput!;
  // Pull v2 facts out of the persisted wire snapshot. The IssueRecord's
  // structured fields (category/subCategory/orderId) cover what the new shape
  // doesn't expose at the top level.
  const snapForRefLookup = existing?.issue as
    | Partial<OndcIssueMessage["issue"]>
    | undefined;
  const snapOrderId = Array.isArray(snapForRefLookup?.refs)
    ? snapForRefLookup!.refs.find((r) => r.ref_type === "ORDER")?.ref_id
    : undefined;
  const orderId = str(body.orderId) ?? existing?.orderId ?? snapOrderId;
  const category =
    str(body.category) ?? existing?.category ?? "ITEM";
  const subCategory =
    str(body.subCategory) ?? existing?.subCategory ?? "";
  // For follow-up actions, hydrate from the persisted v2 wire snapshot.
  // IGM 2.0 puts items/fulfillments inside refs[]; the IssueRecord's structured
  // fields (category/subCategory/orderId) cover the buyer-side taxonomy.
  type V2Issue = OndcIssueMessage["issue"];
  const v2Snap = existingIssue as Partial<V2Issue> | undefined;
  const isV2Snap = Array.isArray(v2Snap?.actions) && Array.isArray(v2Snap?.actors);

  // Find a prior actor/ref of the given type from the persisted snapshot.
  const findRef = (rt: RefType): string | undefined =>
    isV2Snap
      ? (v2Snap!.refs as OndcIssueMessage["issue"]["refs"])?.find(
          (r) => r.ref_type === rt
        )?.ref_id
      : undefined;
  const findConsumer = (): IssueActor | undefined =>
    isV2Snap
      ? (v2Snap!.actors as IssueActor[])?.find((a) => a.type === "CONSUMER")
      : undefined;

  const providerId = str(body.providerId) ?? findRef("PROVIDER") ?? "P1";

  const itemsResolved: Array<{ id: string; quantity: number }> = (() => {
    if (Array.isArray(body.items) && body.items.length > 0) {
      return body.items.filter(
        (i): i is { id: string; quantity: number } =>
          typeof i?.id === "string" && typeof i?.quantity === "number"
      );
    }
    if (isV2Snap) {
      const itemRefs = (v2Snap!.refs as OndcIssueMessage["issue"]["refs"]).filter(
        (r) => r.ref_type === "ITEM"
      );
      if (itemRefs.length > 0) {
        return itemRefs.map((r) => ({ id: r.ref_id, quantity: 1 }));
      }
    }
    return [{ id: "I1", quantity: 1 }];
  })();

  const fulfillmentsResolved: Array<{ id: string; state: string }> = (() => {
    if (Array.isArray(body.fulfillments) && body.fulfillments.length > 0) {
      return body.fulfillments.filter(
        (f): f is { id: string; state: string } =>
          typeof f?.id === "string" && typeof f?.state === "string"
      );
    }
    if (isV2Snap) {
      const fulfRefs = (v2Snap!.refs as OndcIssueMessage["issue"]["refs"]).filter(
        (r) => r.ref_type === "FULFILLMENT"
      );
      if (fulfRefs.length > 0) {
        return fulfRefs.map((r) => {
          // Pull the state we stuffed into the FULFILLMENT_STATE tag.
          const stateTag = (r.tags ?? []).find(
            (t): t is { descriptor: { code: string }; list?: Array<{ descriptor: { code: string }; value: string }> } =>
              typeof t === "object" &&
              t !== null &&
              (t as { descriptor?: { code?: unknown } }).descriptor?.code === "FULFILLMENT_STATE"
          );
          const state =
            stateTag?.list?.find((l) => l.descriptor.code === "state")?.value ??
            "Order-delivered";
          return { id: r.ref_id, state };
        });
      }
    }
    return [{ id: "F1", state: "Order-delivered" }];
  })();

  const consumerFromSnap = findConsumer();
  const personName =
    complainantName ?? consumerFromSnap?.info?.person?.name ?? "ONDC buyer";
  const phone =
    complainantPhone ?? consumerFromSnap?.info?.contact?.phone ?? "";
  const email =
    complainantEmail ?? consumerFromSnap?.info?.contact?.email;
  const shortDesc = str(body.shortDesc) ?? v2Snap?.descriptor?.short_desc ?? "";
  const longDesc = str(body.longDesc) ?? v2Snap?.descriptor?.long_desc ?? "";
  const issueType = str(body.issueType) ?? v2Snap?.level ?? "ISSUE";

  if (!orderId) {
    return NextResponse.json(
      { error: "Could not resolve orderId; pass it explicitly or seed from OPEN." },
      { status: 400 }
    );
  }
  if (!phone) {
    return NextResponse.json(
      { error: "Could not resolve complainant.phone." },
      { status: 400 }
    );
  }

  const context = buildContext({
    action: "issue",
    transactionId,
    bppId,
    bppUri,
    coreVersion,
    domain,
  });
  const config = getOndcConfig();
  const now = new Date().toISOString();

  // Build the issue per IGM 2.0 schema. Everything below maps 1:1 against
  // log-validation-utility/schema/Igm/2.0.0/issue.ts.
  //
  // - actors[]: the parties involved. We always include the consumer (the
  //   buyer). source_id/complainant_id both reference the consumer for a
  //   buyer-initiated issue.
  // - refs[]: pointers from the issue to the underlying order/items/etc. The
  //   seller's IGM resolver uses these to look up the order on their side —
  //   the #1 cause of "ACK with no on_issue" is missing or wrong refs.
  // - actions[]: append-only chronological history. We carry forward what we
  //   persisted and add the new action; last_action_id points at the newest.
  //
  // The wire is regenerated per call (IGM expects a full snapshot every time,
  // not deltas).

  // Stable actor id for the consumer — bap_id keeps cross-call identity simple.
  const consumerActorId = config.bapId;

  // Existing wire issue may be the legacy v1 shape (pre-2.0) if this issue was
  // OPENed before the patch; in that case we treat it as having no v2 data.
  const v2Existing = existingIssue as Partial<OndcIssueMessage["issue"]> | undefined;
  const isV2Existing = Array.isArray(v2Existing?.actions) && Array.isArray(v2Existing?.actors);

  const actors: IssueActor[] = isV2Existing
    ? (v2Existing!.actors as IssueActor[])
    : [
        {
          id: consumerActorId,
          type: "CONSUMER",
          info: {
            org: { name: config.bapId },
            person: { name: personName },
            contact: { phone, email: email ?? "" },
          },
        },
      ];

  // Build refs from the resolved order facets. dedupe ref_ids per ref_type.
  const refs: OndcIssueMessage["issue"]["refs"] = [
    { ref_id: orderId, ref_type: "ORDER" },
    { ref_id: providerId, ref_type: "PROVIDER" },
    { ref_id: transactionId, ref_type: "TRANSACTION" },
    ...itemsResolved.map((it) => ({ ref_id: it.id, ref_type: "ITEM" as const })),
    ...fulfillmentsResolved.map((f) => ({
      ref_id: f.id,
      ref_type: "FULFILLMENT" as const,
      tags: [
        {
          descriptor: { code: "FULFILLMENT_STATE" },
          list: [
            {
              descriptor: { code: "state" },
              value: f.state,
            },
          ],
        },
      ],
    })),
  ];

  // Action history: prior v2 actions (if any) + the new row.
  const priorActions: IssueActionRow[] = isV2Existing
    ? (v2Existing!.actions as IssueActionRow[])
    : [];
  const newActionId = randomUUID();
  const newAction: IssueActionRow = {
    id: newActionId,
    descriptor: {
      code: actionCodeFor(action),
      short_desc: actionDescOverride ?? shortDesc,
    },
    updated_at: now,
    action_by: consumerActorId,
    actor_details: { name: personName },
  };

  // descriptor.code carries the buyer's grievance taxonomy. We map our wrapper
  // input `subCategory` (e.g. ITM02) into descriptor.code so the seller's IGM
  // resolver can route on the same taxonomy it used to use.
  const issueDescriptor: OndcIssueMessage["issue"]["descriptor"] = {
    code: subCategory || category || "ITEM",
    short_desc: shortDesc,
    long_desc: longDesc,
  };

  const message: OndcIssueMessage = {
    ...(action !== "OPEN"
      ? {
          update_target: [
            { path: "message.issue.actions", action: "APPENDED" as const },
          ],
        }
      : {}),
    issue: {
      id: issueId,
      status: statusForAction(action),
      // wrapper input `issueType` maps to schema's `level`. ISSUE/GRIEVANCE/
      // DISPUTE are the three escalation tiers IGM 2.0 tracks.
      level:
        (issueType?.toUpperCase() as IssueLevel) === "GRIEVANCE" ||
        (issueType?.toUpperCase() as IssueLevel) === "DISPUTE"
          ? (issueType.toUpperCase() as IssueLevel)
          : "ISSUE",
      created_at: (isV2Existing && (v2Existing!.created_at as string)) || now,
      updated_at: now,
      expected_response_time: { duration: "PT1H" },
      expected_resolution_time: { duration: "P1D" },
      refs,
      actors,
      source_id: consumerActorId,
      complainant_id: consumerActorId,
      descriptor: issueDescriptor,
      last_action_id: newActionId,
      actions: [...priorActions, newAction],
    },
  };

  // Persist FIRST. A transport failure shouldn't leave us forgetful — we need
  // the action in the history so a retry can resend the same snapshot.
  const newActionEntry: IssueActionEntry = {
    actor: "complainant",
    action,
    shortDesc: actionDescOverride ?? shortDesc,
    updatedAt: now,
    raw: newAction,
  };
  try {
    await saveIssue({
      transactionId,
      messageId: context.message_id,
      bppId,
      bppUri,
      issueId,
      category,
      subCategory,
      orderId,
      status: statusForAction(action),
      lastTouchedBy: "complainant",
      newActions: [newActionEntry],
      issue: message.issue,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "store failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const url = `${bppOrigin}/issue`;
  // Dump the exact wire payload so a workbench ACK without on_issue can be
  // diagnosed: an ACK only proves signature/schema, not that the seller's
  // IGM resolver accepted the business data inside `issue`.
  console.log(
    "ondc.issue outbound payload",
    JSON.stringify({ url, context, message }, null, 2)
  );
  try {
    const result = await sendOndcRequest<OndcIssueMessage>({
      url,
      action: "issue",
      context,
      message,
    });
    return NextResponse.json(
      {
        status: result.status,
        transactionId: context.transaction_id,
        messageId: context.message_id,
        bppId,
        issueId,
        complainantAction: action,
        ...(result.status === "NACK" ? { error: result.error } : {}),
      },
      { status: result.status === "ACK" ? 200 : 422 }
    );
  } catch (err) {
    if (err instanceof OndcClientError) {
      return NextResponse.json(
        {
          error: err.message,
          transactionId: context.transaction_id,
          messageId: context.message_id,
          issueId,
        },
        { status: err.timeout ? 504 : 502 }
      );
    }
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg, issueId }, { status: 500 });
  }
}
