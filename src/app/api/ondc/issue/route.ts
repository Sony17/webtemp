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
import {
  type ComplainantAction,
  type IssueLevel,
  type IssueActionRow,
  type IssueActor,
  type IssueImage,
  type IssueV2Message,
  type IssueV1Message,
  type RefType,
  actorIds as buildActorIds,
  buildActors,
  buildRefs,
  buildActionRow,
  projectStoredAction,
  buildIssueV2,
  buildIssueV1,
  statusForAction,
  actionCodeFor,
  escalateLevel,
} from "@/lib/ondc/igm-builders";

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
// ComplainantAction and the IGM wire types now live in @/lib/ondc/igm-builders.
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
  // QA #4: action-level reference + supporting images. ref_id ties an
  // INFO_PROVIDED to the seller's INFO_REQUESTED, or a RESOLUTION_ACCEPT to the
  // proposed resolution; images back an INFO_PROVIDED. Optional; when omitted on
  // a follow-up we derive ref_id from the last relevant respondent action.
  refId?: string;
  images?: Array<{ url: string; size_type?: string }>;
  // Rejection flow: ONDC reason code required when rejecting a proposed
  // resolution (complainantAction = "RESOLUTION_REJECT").
  reasonCode?: string;
  // IGM 2.0 descriptor.additional_desc — the schema requires a url. Optional
  // override; defaults to a BAP issue-reference URL.
  additionalDescUrl?: string;
};

// IGM v2.0.0 wire types and the state machine (statusForAction/actionCodeFor)
// now live in @/lib/ondc/igm-builders. IGM 2.0 is EMBEDDED in the parent retail
// domain (ONDC:RET10/…): context.domain is the retail domain, core_version is
// the retail 1.2.5 line, and /issue routes through the same seller endpoint as
// select/init/confirm. `OndcIssueMessage` is aliased to the lib's IssueV2Message
// to keep the wire-call generic below unchanged.
type OndcIssueMessage = IssueV2Message;

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
            (t) => t.descriptor?.code === "FULFILLMENT_STATE"
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

  // Build the issue via the shared IGM builders (@/lib/ondc/igm-builders).
  //
  // - actors[]: CONSUMER + INTERFACING_NP (BAP) + COUNTERPARTY_NP (BPP), with
  //   source_id = interfacing NP and complainant_id = consumer (QA #1).
  // - refs[]: order/provider/transaction + items (with quantity, QA #2) +
  //   fulfillments (with state).
  // - actions[]: the COMPLETE history projected from the persisted record —
  //   complainant AND respondent (QA #3) — plus the new row, which carries
  //   ref_id/images where the protocol expects them (QA #4).
  //
  // The wire is regenerated per call (IGM expects a full snapshot, not deltas).
  const ids = buildActorIds(config.bapId, bppId);

  // Reuse a persisted actor set (so identity stays stable across the lifecycle)
  // only when it already has the full set; otherwise build the three actors.
  const actors: IssueActor[] =
    isV2Snap &&
    Array.isArray(v2Snap!.actors) &&
    (v2Snap!.actors as IssueActor[]).length >= 3
      ? (v2Snap!.actors as IssueActor[])
      : buildActors({
          bapId: config.bapId,
          bppId,
          consumer: { name: personName, phone, email },
        });

  const refs = buildRefs({
    orderId,
    providerId,
    transactionId,
    items: itemsResolved,
    fulfillments: fulfillmentsResolved,
  });

  // Consume the FULL action history (QA #3): project every persisted action
  // (complainant AND respondent) into a wire row.
  const priorActions: IssueActionRow[] = (existing?.actions ?? [])
    .map((e) => projectStoredAction(e, { counterpartyNpId: ids.counterpartyNpId }))
    .filter((r): r is IssueActionRow => r !== null);

  // QA #4: resolve the action-level ref_id (and images for INFO_PROVIDED).
  // ref_id ties INFO_PROVIDED -> the seller's INFO_REQUESTED, and a resolution
  // response -> the proposed resolution. Prefer an explicit body value; else
  // derive from the last matching respondent action in the history.
  const lastActionIdWithCode = (want: string): string | undefined => {
    for (let i = priorActions.length - 1; i >= 0; i--) {
      if (priorActions[i].descriptor.code === want) return priorActions[i].id;
    }
    return undefined;
  };
  const actionRefId =
    str(body.refId) ??
    (action === "INFO_PROVIDED"
      ? lastActionIdWithCode("INFO_REQUESTED")
      : action === "RESOLUTION_ACCEPT" || action === "RESOLUTION_REJECT"
        ? lastActionIdWithCode("RESOLUTION_PROPOSED")
        : undefined);
  const actionImages: IssueImage[] | undefined =
    action === "INFO_PROVIDED" && Array.isArray(body.images)
      ? body.images.filter(
          (i): i is IssueImage => typeof i?.url === "string"
        )
      : undefined;

  // Rejection flow: a resolution rejection must carry an ONDC reason code.
  const reasonCode = str(body.reasonCode);
  if (action === "RESOLUTION_REJECT" && !reasonCode) {
    return NextResponse.json(
      {
        error:
          "'reasonCode' is required when complainantAction is RESOLUTION_REJECT.",
      },
      { status: 400 }
    );
  }

  const newActionId = randomUUID();
  const newAction: IssueActionRow = buildActionRow({
    id: newActionId,
    code: actionCodeFor(action),
    shortDesc: actionDescOverride ?? shortDesc,
    updatedAt: now,
    actionBy: ids.interfacingNpId,
    actorName: personName,
    refId: actionRefId,
    images: actionImages,
    // Reason code on rejection (required) and on escalation/no-action (optional,
    // e.g. "no_response" / "timeout").
    reasonCode:
      action === "RESOLUTION_REJECT" || action === "ESCALATE"
        ? reasonCode
        : undefined,
  });

  // wrapper input `issueType` maps to schema's `level` (ISSUE/GRIEVANCE/DISPUTE).
  const baseLevel: IssueLevel =
    issueType?.toUpperCase() === "GRIEVANCE" ||
    issueType?.toUpperCase() === "DISPUTE"
      ? (issueType.toUpperCase() as IssueLevel)
      : "ISSUE";
  // No-action / timeout: ESCALATE bumps the grievance tier (ISSUE -> GRIEVANCE
  // -> DISPUTE). Other actions keep the resolved level.
  const level: IssueLevel =
    action === "ESCALATE" ? escalateLevel(baseLevel) : baseLevel;

  // descriptor.code carries the buyer's grievance taxonomy (e.g. ITM02).
  // additional_desc.url is REQUIRED by the IGM 2.0 schema (REQUIRED_MESSAGE_URL);
  // default to a BAP issue-reference URL when the caller doesn't supply one.
  const additionalDescUrl =
    str(body.additionalDescUrl) ??
    `https://${config.bapId}/ondc/issue/${issueId}`;
  const issueDescriptor: OndcIssueMessage["issue"]["descriptor"] = {
    code: subCategory || category || "ITEM",
    short_desc: shortDesc,
    long_desc: longDesc,
    additional_desc: { url: additionalDescUrl, content_type: "text/plain" },
  };

  const createdAt = (isV2Snap && (v2Snap!.created_at as string)) || now;

  // Version select: IGM 1.0.0 (legacy, domain ONDC:IGM) uses the flat v1 shape;
  // everything else builds the v2 snapshot. Both share the resolved business
  // inputs above — only the wire projection differs.
  const isV1 = coreVersion === "1.0.0";
  const orderState = str(body.orderState) ?? "Completed";
  const message: OndcIssueMessage | IssueV1Message = isV1
    ? buildIssueV1({
        issueId,
        action,
        createdAt,
        now,
        category,
        subCategory,
        bapId: config.bapId,
        bppId,
        consumer: { name: personName, phone, email },
        orderId,
        orderState,
        providerId,
        items: itemsResolved,
        fulfillments: fulfillmentsResolved,
        shortDesc,
        longDesc,
        images: Array.isArray(body.images)
          ? body.images
              .map((i) => i?.url)
              .filter((u): u is string => typeof u === "string")
          : undefined,
        level,
        priorEntries: existing?.actions ?? [],
        newActionShortDesc: actionDescOverride ?? shortDesc,
      })
    : buildIssueV2({
        issueId,
        action,
        status: statusForAction(action),
        level,
        createdAt,
        now,
        actors,
        actorIds: ids,
        refs,
        descriptor: issueDescriptor,
        priorActions,
        newAction,
      });

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
    const result = await sendOndcRequest<OndcIssueMessage | IssueV1Message>({
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
