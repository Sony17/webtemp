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
import type { OndcAckResponse } from "@/lib/ondc/client";
import { saveIssue, getIssue, type IssueActionEntry } from "@/lib/ondc/store";

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

// Pull out the action history rows the BPP sent us in respondent_actions and
// project them to our IssueActionEntry shape. The respondent_actions array
// is cumulative on the wire (the BPP always sends the full list), but we
// only want to APPEND the rows we haven't seen yet — so we compare against
// what's already in storage by (action + updated_at).
function newRespondentActionsSince(
  raw: unknown,
  existingActions: IssueActionEntry[]
): IssueActionEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set(
    existingActions
      .filter((a) => a.actor === "respondent")
      .map((a) => `${a.action}|${a.updatedAt}`)
  );
  const out: IssueActionEntry[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const obj = r as {
      respondent_action?: unknown;
      short_desc?: unknown;
      updated_at?: unknown;
    };
    const action = str(obj.respondent_action);
    const updatedAt = str(obj.updated_at);
    if (!action || !updatedAt) continue;
    const key = `${action}|${updatedAt}`;
    if (seen.has(key)) continue;
    out.push({
      actor: "respondent",
      action,
      shortDesc: str(obj.short_desc),
      updatedAt,
      raw: r,
    });
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
    return ack();
  }

  // Pull whatever the BPP is reporting now.
  const status = str(issue?.status) ?? "PROCESSING";
  const category = str(issue?.category);
  const subCategory = str(issue?.sub_category);
  const orderId = str(issue?.order_details?.id);
  const resolution = issue?.resolution;

  // Find the existing record to know which respondent actions are new.
  const existing = await getIssue(transactionId, issueId);
  const respondentActions = newRespondentActionsSince(
    issue?.issue_actions?.respondent_actions,
    existing?.actions ?? []
  );

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

  return ack();
}

function ack(): NextResponse {
  const body: OndcAckResponse = { message: { ack: { status: "ACK" } } };
  return NextResponse.json(body, { status: 200 });
}
