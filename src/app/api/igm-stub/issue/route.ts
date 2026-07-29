// LOCAL IGM v2.0.0 BPP STUB — simulates the workbench's IGM resolver so the
// full lifecycle (issue → on_issue → issue → … → resolved → closed) can be
// driven end-to-end without depending on staging-automation.ondc.org.
//
// Why this exists: the workbench at `staging-automation.ondc.org` does not
// host an IGM v2.0.0 resolver under the retail RET10 path. Posting /issue
// there ACKs but never fires on_issue. This stub fills that gap so the BAP
// pipeline (persistence + parsing + state machine) can be validated locally.
//
// How to use:
//   curl -sS -X POST http://localhost:3000/api/ondc/issue \
//     -H 'Content-Type: application/json' \
//     -d '{ "bppId":"local-igm-stub",
//           "bppUri":"http://localhost:3000/api/igm-stub",   ← point here
//           "transactionId":"<txn>",
//           "complainant":{"name":"Asha","phone":"9876543210"},
//           "orderId":"O-1","category":"ITEM","subCategory":"ITM02",
//           "shortDesc":"Damaged","longDesc":"Atta torn",
//           "items":[{"id":"I1","quantity":2}],
//           "fulfillments":[{"id":"F1","state":"Order-delivered"}],
//           "providerId":"P1" }'
//
// The stub will ACK immediately and then POST on_issue callbacks back to the
// BAP's /on_issue endpoint (resolved from the same Next dev server). Lifecycle:
//
//   complainant: OPEN              → respondent: PROCESSING → NEED_MORE_INFO
//   complainant: INFO_PROVIDED     → respondent: PROCESSING → RESOLUTION_PROPOSED
//   complainant: RESOLUTION_ACCEPT → respondent: RESOLVED
//   complainant: RESOLUTION_REJECT → respondent: ESCALATED (then re-PROPOSED)
//   complainant: ESCALATE          → respondent: PROCESSING
//   complainant: CLOSE             → terminal, no callback
//
// State (last respondent action per issueId) is kept in memory only — process
// restart clears it, which is fine for local testing.
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";

type Ctx = {
  domain?: string;
  action?: string;
  country?: string;
  city?: string;
  core_version?: string;
  bap_id?: string;
  bap_uri?: string;
  bpp_id?: string;
  bpp_uri?: string;
  transaction_id?: string;
  message_id?: string;
  timestamp?: string;
  ttl?: string;
};

type ComplainantAction = {
  complainant_action?: string;
  short_desc?: string;
  updated_at?: string;
};

type IncomingIssue = {
  id?: string;
  category?: string;
  sub_category?: string;
  order_details?: { id?: string; state?: string; provider_id?: string };
  description?: { short_desc?: string; long_desc?: string };
  issue_type?: string;
  status?: string;
  issue_actions?: { complainant_actions?: ComplainantAction[] };
  created_at?: string;
};

type IncomingPayload = {
  context?: Ctx;
  message?: { issue?: IncomingIssue };
};

// In-memory state per issueId (process-scoped, restart-safe-NOT). Used to
// drive the next respondent action in the lifecycle.
type StubState = {
  lastRespondentAction: string | null;
  history: Array<{ action: string; at: string }>;
};
const stubState = new Map<string, StubState>();

function nowIso(): string {
  return new Date().toISOString();
}

function latestComplainantAction(issue: IncomingIssue | undefined): string {
  const list = issue?.issue_actions?.complainant_actions;
  if (!Array.isArray(list) || list.length === 0) return "OPEN";
  const last = list[list.length - 1];
  return last.complainant_action ?? "OPEN";
}

// Decide the sequence of respondent_actions the stub will fire back after a
// given complainant_action. Each element fires as a separate /on_issue POST
// with a small delay between them, so the BAP sees the workbench-style
// PROCESSING-then-RESOLUTION cadence.
function plannedRespondentSequence(complainantAction: string): Array<{
  action: string;
  status: string;
  shortDesc: string;
  includeResolution?: boolean;
  delayMs: number;
}> {
  switch (complainantAction) {
    case "OPEN":
      return [
        {
          action: "PROCESSING",
          status: "PROCESSING",
          shortDesc: "Issue received, processing",
          delayMs: 1500,
        },
        {
          action: "NEED_MORE_INFO",
          status: "NEED_MORE_INFO",
          shortDesc: "Please share photos of the damaged item",
          delayMs: 3000,
        },
      ];
    case "INFO_PROVIDED":
      return [
        {
          action: "PROCESSING",
          status: "PROCESSING",
          shortDesc: "Info received, reviewing",
          delayMs: 1500,
        },
        {
          action: "RESOLUTION_PROPOSED",
          status: "RESOLUTION_PROPOSED",
          shortDesc: "Proposing full refund",
          includeResolution: true,
          delayMs: 3000,
        },
      ];
    case "ESCALATE":
      return [
        {
          action: "PROCESSING",
          status: "PROCESSING",
          shortDesc: "Escalated, senior agent reviewing",
          delayMs: 1500,
        },
        {
          action: "RESOLUTION_PROPOSED",
          status: "RESOLUTION_PROPOSED",
          shortDesc: "Proposing replacement + ₹50 credit",
          includeResolution: true,
          delayMs: 3000,
        },
      ];
    case "RESOLUTION_ACCEPT":
      return [
        {
          action: "RESOLVED",
          status: "RESOLVED",
          shortDesc: "Resolution applied, refund initiated",
          includeResolution: true,
          delayMs: 1500,
        },
      ];
    case "RESOLUTION_REJECT":
      return [
        {
          action: "PROCESSING",
          status: "PROCESSING",
          shortDesc: "Reviewing alternative resolution",
          delayMs: 1500,
        },
        {
          action: "RESOLUTION_PROPOSED",
          status: "RESOLUTION_PROPOSED",
          shortDesc: "Proposing 50% refund + retention discount",
          includeResolution: true,
          delayMs: 3000,
        },
      ];
    case "CLOSE":
    default:
      return [];
  }
}
// Resolve where to POST the /on_issue callback
function resolveCallbackTarget(ctx: Ctx | undefined): string {

  const bapUri = ctx?.bap_uri?.trim();


  /**
   * LOCAL IGM STUB TESTING
   *
   * Your Next routes are under:
   * app/api/ondc/on_issue/route.ts
   *
   * NOT:
   * app/ondc/on_issue
   */
  if (
    ctx?.bpp_id === "local-igm-stub" ||
    ctx?.bpp_uri?.includes("localhost")
  ) {
    return "http://localhost:3000/api/ondc/on_issue";
  }


  /**
   * Workbench / real network callback
   *
   * bap_uri:
   * https://openidea.co.in/ondc
   *
   * becomes:
   * https://openidea.co.in/ondc/on_issue
   */
  if (bapUri && bapUri.length > 0) {
    return `${bapUri.replace(/\/+$/, "")}/on_issue`;
  }


  return "http://localhost:3000/api/ondc/on_issue";
}

// Build the on_issue payload to ship back.
function buildOnIssue(opts: {
  incomingCtx: Ctx;
  incomingIssue: IncomingIssue;
  respondent: {
    action: string;
    status: string;
    shortDesc: string;
    includeResolution?: boolean;
  };
  priorComplainantActions: ComplainantAction[];
  priorRespondentActions: Array<{
    respondent_action: string;
    short_desc: string;
    updated_at: string;
  }>;
}): unknown {
  const ts = nowIso();
  const newRespondentRow = {
    respondent_action: opts.respondent.action,
    short_desc: opts.respondent.shortDesc,
    updated_at: ts,
    updated_by: {
      org: { name: "local-igm-stub" },
      contact: { phone: "9999999999" },
      person: { name: "Stub Agent" },
    },
  };
  const message = {
    issue: {
      id: opts.incomingIssue.id,
      category: opts.incomingIssue.category ?? "ITEM",
      sub_category: opts.incomingIssue.sub_category ?? "",
      status: opts.respondent.status,
      issue_type: opts.incomingIssue.issue_type ?? "ISSUE",
      order_details: opts.incomingIssue.order_details ?? {},
      description: opts.incomingIssue.description ?? {},
      created_at: opts.incomingIssue.created_at ?? ts,
      updated_at: ts,
      issue_actions: {
        complainant_actions: opts.priorComplainantActions,
        respondent_actions: [...opts.priorRespondentActions, newRespondentRow],
      },
      ...(opts.respondent.includeResolution
        ? {
            resolution: {
              short_desc: opts.respondent.shortDesc,
              long_desc: opts.respondent.shortDesc,
              action_triggered: opts.respondent.action,
            },
            resolution_provider: {
              respondent_info: {
                type: "INTERFACING-NP",
                organization: { name: "local-igm-stub" },
              },
            },
          }
        : {}),
    },
  };
  return {
    context: {
      domain: opts.incomingCtx.domain ?? "ONDC:IGM",
      country: opts.incomingCtx.country ?? "IND",
      city: opts.incomingCtx.city ?? "std:080",
      action: "on_issue",
      core_version: opts.incomingCtx.core_version ?? "2.0.0",
      bap_id: opts.incomingCtx.bap_id,
      bap_uri: opts.incomingCtx.bap_uri,
      bpp_id: opts.incomingCtx.bpp_id ?? "local-igm-stub",
      bpp_uri:
        opts.incomingCtx.bpp_uri ?? "http://localhost:3000/api/igm-stub",
      transaction_id: opts.incomingCtx.transaction_id,
      // New message_id for each on_issue, threaded back via transaction_id.
      message_id: randomUUID(),
      timestamp: ts,
      ttl: "PT30S",
    },
    message,
  };
}

// Fire one on_issue POST. Best-effort: errors only log, don't throw — the
// stub is meant to be observed via dev-server console.
async function fireOnIssue(target: string, body: unknown): Promise<void> {
  const action = ((body as any)?.context?.action) ?? "unknown";
  const issueId = ((body as any)?.message?.issue?.id) ?? "unknown";
  const respondentAction = ((body as any)?.message?.issue?.issue_actions?.respondent_actions?.slice?.(-1)?.[0]?.respondent_action) ?? "unknown";
  console.log(`[fireOnIssue] START action=${action} issueId=${issueId} respondent=${respondentAction} target=${target}`);
  try {
    const jsonStr = JSON.stringify(body);
    console.log(`[fireOnIssue] FETCH ${target} bodyLength=${jsonStr.length}`);
    const start = Date.now();
    const res = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: jsonStr,
    });
    const elapsed = Date.now() - start;
    const text = await res.text();
    console.log(`[fireOnIssue] DONE target=${target} status=${res.status} elapsed=${elapsed}ms response=${text.slice(0, 300)}`);
  } catch (err) {
    console.error(`[fireOnIssue] ERROR target=${target}`, err);
  }
}

export async function POST(req: Request) {
  let payload: IncomingPayload | null = null;
  try {
    payload = (await req.json()) as IncomingPayload;
  } catch {
    return NextResponse.json(
      {
        message: { ack: { status: "NACK" } },
        error: { type: "JSON-PARSE-ERROR", code: "10001" },
      },
      { status: 400 }
    );
  }

  const ctx = payload?.context ?? {};
  const issue = payload?.message?.issue;
  if (!issue?.id) {
    return NextResponse.json(
      {
        message: { ack: { status: "NACK" } },
        error: { type: "DOMAIN-ERROR", code: "10002", message: "missing issue.id" },
      },
      { status: 400 }
    );
  }

  const complainantAction = latestComplainantAction(issue);
  const sequence = plannedRespondentSequence(complainantAction);
  console.log("=== IGM-STUB DEBUG ===");
  console.log("complainantAction:", complainantAction);
  console.log("issue keys:", Object.keys(issue));
  console.log("issue_actions:", JSON.stringify(issue.issue_actions));
  console.log("complainant_actions:", JSON.stringify(issue.issue_actions?.complainant_actions));
  console.log("sequence:", sequence.map(s => `${s.action}@${s.delayMs}ms`));
  console.log("target:", resolveCallbackTarget(ctx));
  console.log("======================");

  // Pull or seed stub state for this issue.
  const state = stubState.get(issue.id) ?? {
    lastRespondentAction: null,
    history: [],
  };

  // Reconstruct prior respondent_actions list so each callback we fire
  // includes the cumulative respondent history (matches workbench behavior).
  const priorRespondentActions = state.history.map((h) => ({
    respondent_action: h.action,
    short_desc: "",
    updated_at: h.at,
  }));

  // Schedule callbacks. Each runs after its planned delay, and updates state
  // before sending so the next one's "prior" list is correct.
  const target = resolveCallbackTarget(ctx);
  const priorComplainantActions = issue.issue_actions?.complainant_actions ?? [];

  console.log("=== IGM-STUB SCHEDULING ===");
  for (const step of sequence) {
    const stepRespondentSnapshot = [...priorRespondentActions];
    console.log(`Scheduling ${step.action} in ${step.delayMs}ms (at ${new Date(Date.now() + step.delayMs).toISOString()})`);
    // Mutate the rolling snapshot so the NEXT scheduled step sees this one
    // in its prior list. (Captured at schedule time, not at fire time.)
    priorRespondentActions.push({
      respondent_action: step.action,
      short_desc: step.shortDesc,
      updated_at: nowIso(),
    });

    const stepAction = step.action;
    const stepDelay = step.delayMs;
    setTimeout(() => {
      console.log(`=== IGM-STUB TIMER FIRED: ${stepAction} ===`);
      const body = buildOnIssue({
        incomingCtx: ctx,
        incomingIssue: issue,
        respondent: step,
        priorComplainantActions,
        priorRespondentActions: stepRespondentSnapshot,
      });
      console.log(`POST /api/ondc/on_issue (${stepAction}) to ${target}`);
      fireOnIssue(target, body)
        .then(() => console.log(`=== IGM-STUB ${stepAction} DONE ===`))
        .catch((e) => console.error(`=== IGM-STUB ${stepAction} FAILED ===`, e));
      state.lastRespondentAction = stepAction;
      state.history.push({ action: stepAction, at: nowIso() });
      stubState.set(issue.id!, state);
    }, stepDelay);
  }
  console.log("=== IGM-STUB SCHEDULING DONE ===");

  stubState.set(issue.id, state);

  console.log("igm-stub /issue received", {
    transactionId: ctx.transaction_id,
    issueId: issue.id,
    complainantAction,
    callbacksScheduled: sequence.length,
    target,
  });

  // ACK synchronously.
  return NextResponse.json(
    {
      context: { ...ctx, action: "issue" },
      message: { ack: { status: "ACK" } },
    },
    { status: 200 }
  );
}
