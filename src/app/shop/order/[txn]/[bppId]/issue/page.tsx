"use client";

// Buyer-app IGM (Issue & Grievance Management) — opens a grievance via
// POST /api/ondc/issue, then shows the issue's action timeline (complainant +
// respondent) from /api/shop/state and offers the follow-up complainant
// actions (escalate, accept/reject resolution, close).
import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import {
  MessageSquareWarning,
  CheckCircle2,
  AlertTriangle,
  ArrowUpCircle,
  XCircle,
} from "lucide-react";
import { Button, Card, Input, Label, Textarea, Badge } from "@/components/shop/ui";
import { EmptyState, Spinner } from "@/components/shop/widgets";
import { useShop } from "@/lib/shop/store";
import { useShopState } from "@/lib/shop/useShopState";
import * as api from "@/lib/shop/api";
import type { IssueRecord } from "@/lib/shop/types";

const CATEGORIES = [
  { c: "ITEM", s: "ITM01", label: "Item issue" },
  { c: "FULFILLMENT", s: "FLM01", label: "Delivery issue" },
  { c: "PAYMENT", s: "PMT01", label: "Payment issue" },
  { c: "ORDER", s: "ORD01", label: "Order issue" },
];

export default function IssuePage() {
  const { txn, bppId } = useParams<{ txn: string; bppId: string }>();
  const transactionId = decodeURIComponent(txn);
  const bpp = decodeURIComponent(bppId);
  const router = useRouter();
  const { address } = useShop();

  const { state, refetch } = useShopState(transactionId, {
    intervalMs: 4000,
    maxMs: 120_000,
    stopWhen: (s) =>
      s.issues.some((i) => ["RESOLVED", "CLOSED"].includes(i.status)),
  });
  const bppState = state?.bpps.find((b) => b.bppId === bpp);
  const orderId = bppState?.order?.orderId;
  const bppUri = bppState?.bppUri;

  const issue: IssueRecord | undefined = state?.issues.find(
    (i) => i.bppId === bpp
  );

  const [cat, setCat] = React.useState(CATEGORIES[0]);
  const [shortDesc, setShortDesc] = React.useState("");
  const [longDesc, setLongDesc] = React.useState("");
  const [phone, setPhone] = React.useState(address?.phone ?? "");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  if (!state) return <Spinner label="Loading…" />;

  const open = async () => {
    if (!orderId || !bppUri) {
      setError("Order id not available yet.");
      return;
    }
    if (!shortDesc.trim() || !phone.trim()) {
      setError("A short description and contact phone are required.");
      return;
    }
    setBusy("open");
    setError(null);
    try {
      const res = await api.openIssue({
        transactionId,
        bppId: bpp,
        bppUri,
        orderId,
        category: cat.c,
        subCategory: cat.s,
        shortDesc: shortDesc.trim(),
        longDesc: longDesc.trim() || shortDesc.trim(),
        complainant: { name: address?.name, phone: phone.trim(), email: address?.email },
      });
      if (res.status === "NACK")
        throw new Error(res.error?.message ?? "Issue rejected.");
      await new Promise((r) => setTimeout(r, 1500));
      await refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to raise issue.");
    } finally {
      setBusy(null);
    }
  };

  const followUp = async (
    action: "ESCALATE" | "RESOLUTION_ACCEPT" | "RESOLUTION_REJECT" | "CLOSE"
  ) => {
    if (!issue || !bppUri) return;
    setBusy(action);
    try {
      await api.issueAction({
        transactionId,
        bppId: bpp,
        bppUri,
        issueId: issue.issueId,
        complainantAction: action,
      });
      await new Promise((r) => setTimeout(r, 1500));
      await refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  };

  // Issue exists → timeline + actions
  if (issue) {
    const closed = ["CLOSED", "RESOLVED"].includes(issue.status);
    return (
      <div className="space-y-4 pb-8">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">Grievance</h1>
          <Badge variant={closed ? "success" : "secondary"} className="ml-auto">
            {issue.status}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">Issue #{issue.issueId}</p>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Timeline</h2>
          <div className="space-y-3">
            {issue.actions.map((a, i) => (
              <div key={i} className="flex gap-3">
                <div className="mt-1 flex flex-col items-center">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      a.actor === "complainant" ? "bg-primary" : "bg-emerald-500"
                    }`}
                  />
                  {i < issue.actions.length - 1 ? (
                    <span className="my-0.5 w-px flex-1 bg-border" />
                  ) : null}
                </div>
                <div className="pb-1">
                  <p className="text-sm font-medium">{a.action}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.actor === "complainant" ? "You" : "Seller"}
                    {a.shortDesc ? ` · ${a.shortDesc}` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {issue.resolution ? (
          <Card className="p-4">
            <h2 className="mb-1 text-sm font-semibold">Proposed resolution</h2>
            <pre className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
              {JSON.stringify(issue.resolution, null, 2)}
            </pre>
          </Card>
        ) : null}

        {error ? (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {!closed ? (
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="outline"
              disabled={busy != null}
              onClick={() => followUp("RESOLUTION_ACCEPT")}
            >
              <CheckCircle2 className="h-4 w-4" /> Accept resolution
            </Button>
            <Button
              variant="outline"
              disabled={busy != null}
              onClick={() => followUp("RESOLUTION_REJECT")}
            >
              <XCircle className="h-4 w-4" /> Reject
            </Button>
            <Button
              variant="outline"
              disabled={busy != null}
              onClick={() => followUp("ESCALATE")}
            >
              <ArrowUpCircle className="h-4 w-4" /> Escalate
            </Button>
            <Button
              variant="destructive"
              disabled={busy != null}
              onClick={() => followUp("CLOSE")}
            >
              Close issue
            </Button>
          </div>
        ) : (
          <Button onClick={() => router.push(`/shop/order/${txn}/${bppId}`)}>
            Back to order
          </Button>
        )}
      </div>
    );
  }

  // No issue yet → open form
  if (!orderId) {
    return (
      <EmptyState
        icon={<AlertTriangle className="h-7 w-7" />}
        title="Order not ready"
        description="A grievance can be raised once the order is confirmed."
      />
    );
  }

  return (
    <div className="space-y-5 pb-8">
      <div className="flex items-center gap-2">
        <MessageSquareWarning className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-semibold">Raise an issue</h1>
      </div>

      <div>
        <Label className="mb-1.5 block">Category</Label>
        <div className="grid grid-cols-2 gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c.c}
              onClick={() => setCat(c)}
              className={`rounded-lg border p-2.5 text-sm font-medium ${
                cat.c === c.c
                  ? "border-primary bg-accent/40 ring-1 ring-primary"
                  : "border-border"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <Label className="mb-1.5 block">Summary</Label>
        <Input
          value={shortDesc}
          onChange={(e) => setShortDesc(e.target.value)}
          placeholder="Briefly, what went wrong?"
        />
      </div>
      <div>
        <Label className="mb-1.5 block">Details</Label>
        <Textarea
          value={longDesc}
          onChange={(e) => setLongDesc(e.target.value)}
          placeholder="Describe the issue…"
        />
      </div>
      <div>
        <Label className="mb-1.5 block">Contact phone</Label>
        <Input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="tel"
          placeholder="9876543210"
        />
      </div>

      {error ? (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Button className="w-full" size="lg" disabled={busy === "open"} onClick={open}>
        {busy === "open" ? "Submitting…" : "Submit grievance"}
      </Button>
    </div>
  );
}
