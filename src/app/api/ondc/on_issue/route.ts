// ONDC BAP `on_issue` callback — the asynchronous reply to `/issue`.
//
// The BPP POSTs here as the grievance progresses on their side. Across one
// IGM v2.0.0 lifecycle we expect MULTIPLE on_issue callbacks for the same
// issue.id (see Delivery_Flow_With_IGM trace from the workbench):
//
//   on_issue(PROCESSING)             — accepted, working on it
//   on_issue(NEED_MORE_INFO)         — buyer must respond via issue(INFO_PROVIDED)
//   on_issue(PROCESSING)             — re-acknowledgement after info provided
//   on_issue(RESOLUTION_PROPOSED)    — carries the proposed remedy
//   on_issue(RESOLVED)               — final state after RESOLUTION_ACCEPT
//
// Each one re-sends the FULL issue snapshot. We pull out the latest
// respondent_action (the BPP's contribution) and append it to our persisted
// history. The `status` and `resolution` (when present) are last-write-wins.
//
// Light auth: matches the workbench's `no-auth` signature convention. A
// hardening pass would call resolveBppSigningPublicKey + verifyOndcSignature
// like on_support does; intentionally skipped to avoid mismatch with the
// staging mock.
import { NextResponse } from "next/server";
import { buildAck } from "@/lib/ondc/responses";
import { saveIssue, getIssue, type IssueActionEntry } from "@/lib/ondc/store";
import { sendBuyerEmail } from "@/lib/email/send";
import { issueUpdateEmail } from "@/lib/email/templates";

export const runtime = "nodejs";

type OnIssueContext = {
  action?: string;
  transaction_id?: string;
  message_id?: string;
  bpp_id?: string;
  bpp_uri?: string;
  timestamp?: string;
  ttl?: string;
  domain?: string;
};

// IGM v2.0.0 issue object the BPP returns. Only fields we actually read are
// typed; everything else passes through to the IssueRecord opaquely.
type IncomingIssue = {
  id?: unknown;
  category?: unknown;
  sub_category?: unknown;
  status?: unknown;
  order_details?: {
    id?: unknown;
    state?: unknown;
    items?: unknown;
    fulfillments?: unknown;
    provider_id?: unknown;
  };
  resolution?: unknown;
  resolution_provider?: unknown;
  // IGM v2.0.0: the full action trail (both parties) lives here.
  actions?: unknown;
  resolutions?: unknown;
  resolver_ids?: unknown;
  // IGM v1.0.0: the split action arrays.
  issue_actions?: {
    respondent_actions?: unknown;
    complainant_actions?: unknown;
  };
};

type OnIssueCallback = {
  context?: OnIssueContext;
  message?: { issue?: IncomingIssue };
};

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

// The IGM 2.0 action.descriptor.code values that are RESPONDENT (seller-side)
// contributions. The seller's v2 `issue.actions[]` echoes BOTH parties' rows;
// we only persist the seller's, since our own complainant rows are already
// recorded by /issue. (Complainant codes — OPEN, INFO_PROVIDED, ESCALATED,
// RESOLUTION_ACCEPTED/REJECTED, CLOSED — are skipped here.)
const RESPONDENT_CODES = new Set([
  "PROCESSING",
  "INFO_REQUESTED",
  "INFO_NOT_AVAILABLE",
  "RESOLUTION_PROPOSED",
  "RESOLVED",
  "CASCADED",
  "RESOLUTION_CASCADED",
]);

// Extract the NEW respondent action rows from the seller's on_issue, across both
// wire shapes, and project them to our IssueActionEntry shape so the next /issue
// can carry the FULL action trail (QA 07-03 "sellers actions not consumed"):
//   - v1.0.0: issue.issue_actions.respondent_actions[] ({ respondent_action, … })
//   - v2.0.0: issue.actions[] filtered to respondent descriptor.code values
// The seller re-sends the cumulative list each call, so we APPEND only rows not
// already in storage, deduped by (action + updated_at).
function newRespondentActions(
  issue: IncomingIssue | undefined,
  existingActions: IssueActionEntry[]
): IssueActionEntry[] {
  const seen = new Set(
    existingActions
      .filter((a) => a.actor === "respondent")
      .map((a) => `${a.action}|${a.updatedAt}`)
  );
  const out: IssueActionEntry[] = [];
  const push = (
    action: string | undefined,
    shortDesc: string | undefined,
    updatedAt: string | undefined,
    raw: unknown
  ) => {
    if (!action || !updatedAt) return;
    const key = `${action}|${updatedAt}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ actor: "respondent", action, shortDesc, updatedAt, raw });
  };

  // v1.0.0 shape.
  const v1 = issue?.issue_actions?.respondent_actions;
  if (Array.isArray(v1)) {
    for (const r of v1) {
      if (!r || typeof r !== "object") continue;
      const obj = r as {
        respondent_action?: unknown;
        short_desc?: unknown;
        updated_at?: unknown;
      };
      push(
        str(obj.respondent_action),
        str(obj.short_desc),
        str(obj.updated_at),
        r
      );
    }
  }

  // v2.0.0 shape — the seller's contributions inside the combined actions[].
  const v2 = issue?.actions;
  if (Array.isArray(v2)) {
    for (const r of v2) {
      if (!r || typeof r !== "object") continue;
      const obj = r as {
        descriptor?: { code?: unknown; short_desc?: unknown };
        updated_at?: unknown;
      };
      const code = str(obj.descriptor?.code);
      if (!code || !RESPONDENT_CODES.has(code)) continue;
      push(code, str(obj.descriptor?.short_desc), str(obj.updated_at), r);
    }
  }

  return out;
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  let payload: OnIssueCallback | null = null;
  try {
    payload = rawBody ? (JSON.parse(rawBody) as OnIssueCallback) : null;
  } catch {
    // Malformed body — log and ACK 200 anyway so the BPP doesn't get stuck
    // retrying. A real bug here surfaces in logs, not in repeated NACKs.
    console.warn("ondc.on_issue invalid JSON", {
      bodyLength: rawBody.length,
      bodyPreview: rawBody.slice(0, 200),
    });
    return ack();
  }

  const ctx = payload?.context;
  const issue = payload?.message?.issue;

  const transactionId = str(ctx?.transaction_id);
  const messageId = str(ctx?.message_id);
  const bppId = str(ctx?.bpp_id);
  const bppUri = str(ctx?.bpp_uri) ?? "";
  const issueId = str(issue?.id);

  // Without these we can't index the persistence record, but we still ACK so
  // the network keeps moving. Whatever the BPP sent is logged for debugging.
  if (!transactionId || !messageId || !bppId || !issueId) {
    console.warn("ondc.on_issue missing routing fields", {
      transactionId,
      messageId,
      bppId,
      issueId,
    });
    return ack(ctx);
  }

  // Find the existing record: used for preserving values the BPP's callback
  // omits and for deduplicating respondent actions.
  const existing = await getIssue(transactionId, issueId);

  // Pull whatever the BPP is reporting now.  If a field is absent in the
  // callback, fall back to the previously-stored value so that subsequent
  // events never overwrite earlier data with undefined.
  const status = str(issue?.status) ?? "PROCESSING";
  const category =
    str(issue?.category) ?? existing?.category;
  const subCategory =
    str(issue?.sub_category) ?? existing?.subCategory;
  const orderId = str(issue?.order_details?.id);
  const resolution = issue?.resolution;
  // IGM 2.0: the BPP sends resolution_provider to carry GRO info and the
  // proposed resolution. Persist it so the buyer's RESOLUTION_ACCEPT/REJECT
  // /issue can carry it forward (QA: "resolution section needs to carry
  // forward in issue call").
  const resolutionProvider = issue?.resolution_provider;
  // IGM v2.0.0: the BPP sends resolutions[] (plural array) + resolver_ids[]
  // instead of the v1 singular resolution/resolution_provider. Persist them
  // so the buyer's subsequent issue calls can carry them forward verbatim
  // (QA: "Resolution attribute is missing").
  const resolutions = Array.isArray(issue?.resolutions)
    ? (issue!.resolutions as unknown[])
    : undefined;
  const resolverIds = Array.isArray(issue?.resolver_ids)
    ? (issue!.resolver_ids as string[])
    : undefined;

  const respondentActions = newRespondentActions(issue, existing?.actions ?? []);

  try {
    await saveIssue({
      transactionId,
      messageId,
      bppId,
      bppUri,
      issueId,
      category,
      subCategory,
      orderId,
      status,
      lastTouchedBy: "respondent",
      newActions: respondentActions,
      resolution,
      resolutionProvider,
      resolutions,
      resolverIds,
      issue,
    });
  } catch (err) {
    // Persistence failed — still ACK 200 (workbench shouldn't get stuck). Log
    // for follow-up; the resolution itself is in the dev-server console below.
    console.error("ondc.on_issue persist failed", {
      transactionId,
      issueId,
      err,
    });
  }

  console.log("ondc.on_issue received", {
    transactionId,
    messageId,
    bppId,
    bppUri,
    timestamp: ctx?.timestamp,
    issueId,
    status,
    newRespondentActions: respondentActions.length,
    hasResolution: resolution != null,
  });

  // Fire-and-forget email to the buyer with the latest issue update.
  const lastAction = respondentActions.length > 0
    ? respondentActions[respondentActions.length - 1]
    : undefined;
  const { subject, html } = issueUpdateEmail({
    issueId,
    orderId: orderId ?? undefined,
    status,
    action: lastAction?.action,
    shortDesc: lastAction?.shortDesc,
    orderUrl: orderId
      ? `https://openidea.co.in/shop/order/${encodeURIComponent(transactionId)}/${encodeURIComponent(bppId)}`
      : undefined,
  });
  void sendBuyerEmail(transactionId, bppId, subject, html);

  return ack(ctx);
}

// Echoes the inbound `context` (when known) per ONDC's response contract — see
// responses.ts. Completes the context-echo started in Commit 1 for the issue
// callback. `context` is omitted on the pre-parse (invalid-JSON) ACK.
function ack(context?: unknown): NextResponse {
  return buildAck({ context });
}
