// GET inspection endpoint for an IGM issue's full lifecycle.
//
//   GET /api/ondc/issue/<issueId>?transactionId=<txn>
//
// Returns the merged IssueRecord — every complainant + respondent action
// chronologically, the current status, the resolution payload (if any), and
// the last full issue snapshot. Used during testing to verify the lifecycle
// after each /issue and /on_issue round-trip.
//
// Why a query param for transactionId: issues are keyed by (txn, issueId) so
// the same issueId could in theory exist under multiple transactions; we don't
// want to fold them silently. transactionId is required.
import { NextResponse } from "next/server";
import { getIssue, getIssuesByTransaction } from "@/lib/ondc/store";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ issueId: string }> }
) {
  const { issueId } = await params;
  const url = new URL(req.url);
  const transactionId = url.searchParams.get("transactionId")?.trim();
  if (!transactionId) {
    return NextResponse.json(
      { error: "Missing required query param: transactionId" },
      { status: 400 }
    );
  }

  // Wildcard inspection: `<issueId>=all` lists every issue under the txn —
  // handy when you've lost track of the issueId after multiple OPENs.
  if (issueId === "all") {
    const issues = await getIssuesByTransaction(transactionId);
    return NextResponse.json({ transactionId, issues });
  }

  const issue = await getIssue(transactionId, issueId);
  if (!issue) {
    return NextResponse.json(
      { error: "issue not found", transactionId, issueId },
      { status: 404 }
    );
  }
  return NextResponse.json({ issue });
}
