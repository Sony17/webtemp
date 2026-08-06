"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import {
  MessageSquareWarning,
  CheckCircle2,
  AlertTriangle,
  ArrowUpCircle,
  XCircle,
  Clock,
  ImagePlus,
  X,
} from "lucide-react";
import { Button, Card, Input, Label, Textarea, Badge } from "@/components/shop/ui";
import { EmptyState, Spinner } from "@/components/shop/widgets";
import { useShop } from "@/lib/shop/store";
import { useShopState } from "@/lib/shop/useShopState";
import * as api from "@/lib/shop/api";
import type { IssueRecord, ShopState } from "@/lib/shop/types";

const CATEGORIES = [
  { c: "ITEM", s: "ITM01", label: "Item not received", requiresImage: false },
  { c: "ITEM", s: "ITM02", label: "Defective / Damaged", requiresImage: true },
  { c: "ITEM", s: "ITM03", label: "Expired / Poor quality", requiresImage: true },
  { c: "ITEM", s: "ITM04", label: "Incorrect item", requiresImage: true },
  { c: "ITEM", s: "ITM05", label: "Missing item / Parts", requiresImage: true },
  { c: "FULFILLMENT", s: "FLM01", label: "Delayed delivery", requiresImage: false },
  { c: "FULFILLMENT", s: "FLM04", label: "Package damaged", requiresImage: true },
  { c: "PAYMENT", s: "PMT01", label: "Payment issue", requiresImage: false },
  { c: "ORDER", s: "ORD01", label: "Order issue", requiresImage: false },
];

function elapsed(from: string, to?: string): string {
  const a = new Date(from).getTime();
  if (!Number.isFinite(a)) return "";
  const b = to ? new Date(to).getTime() : Date.now();
  if (!Number.isFinite(b)) return "";
  const diff = Math.max(0, b - a);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export default function IssuePage() {
  const { txn, bppId } = useParams<{ txn: string; bppId: string }>();
  const transactionId = decodeURIComponent(txn);
  const bpp = decodeURIComponent(bppId);
  const router = useRouter();
  const { address, orders } = useShop();
  const orderDomain = orders.find(
    (o) => o.transactionId === transactionId && o.bppId === bpp
  )?.domain;

  const { state, refetch } = useShopState(transactionId, {
    intervalMs: 4000,
    maxMs: 120_000,
    bppId: bpp,
    stopWhen: (s) =>
      s.issues.some((i) => ["RESOLVED", "CLOSED"].includes(i.status)),
  });

  const pollUntil = async (pred: (s: ShopState) => boolean) => {
    const deadline = Date.now() + 16_000;
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      const s = await refetch();
      if (!s || pred(s) || Date.now() > deadline) break;
    }
  };
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
  const [images, setImages] = React.useState<{ url: string; size_type?: string }[]>([]);
  const [followUpImages, setFollowUpImages] = React.useState<{ url: string; size_type?: string }[]>([]);
  const [additionalInfo, setAdditionalInfo] = React.useState("");
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
    if (cat.requiresImage && images.length === 0) {
      setError(`Photo(s) are required for "${cat.label}". Please upload at least one image.`);
      return;
    }
    if (!/^\d{10}$/.test(phone.trim())) {
      setError("Contact phone must be a 10-digit number.");
      return;
    }
    setBusy("open");
    setError(null);
    try {
      const res = await api.openIssue({
        transactionId,
        bppId: bpp,
        bppUri,
        domain: orderDomain,
        orderId,
        category: cat.c,
        subCategory: cat.s,
        shortDesc: shortDesc.trim(),
        longDesc: longDesc.trim() || shortDesc.trim(),
        complainant: { name: address?.name, phone: phone.trim(), email: address?.email },
        images: images.length > 0 ? images : undefined,
      });
      if (res.status === "NACK")
        throw new Error(res.error?.message ?? "Issue rejected.");
      await pollUntil((s) => s.issues.some((i) => i.bppId === bpp));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to raise issue.");
    } finally {
      setBusy(null);
    }
  };

  const addImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      setImages((prev) => [...prev, { url, size_type: "original" }]);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const removeImage = (idx: number) => {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  };

  const addFollowUpImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      setFollowUpImages((prev) => [...prev, { url, size_type: "original" }]);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const removeFollowUpImage = (idx: number) => {
    setFollowUpImages((prev) => prev.filter((_, i) => i !== idx));
  };

  const followUp = async (
    action: "INFO_PROVIDED" | "ESCALATE" | "RESOLUTION_ACCEPT" | "RESOLUTION_REJECT" | "CLOSE"
  ) => {
    if (!issue || !bppUri) return;
    setBusy(action);
    const beforeCount = issue.actions.length;
    const beforeRev = issue.updatedAt;
    try {
      await api.issueAction({
        transactionId,
        bppId: bpp,
        bppUri,
        domain: orderDomain,
        issueId: issue.issueId,
        complainantAction: action,
        actionDesc: action === "INFO_PROVIDED" ? additionalInfo.trim() : undefined,
        images: followUpImages.length > 0 ? followUpImages : undefined,
      });
      setFollowUpImages([]);
      setAdditionalInfo("");
      await pollUntil((s) => {
        const i = s.issues.find((x) => x.bppId === bpp);
        return !!i && (i.actions.length !== beforeCount || i.updatedAt !== beforeRev);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  };

  if (issue) {
    const closed = ["CLOSED", "RESOLVED"].includes(issue.status);
    const hasRespondentAction = issue.actions.some((a) => a.actor === "respondent");
    const openAction = issue.actions.find((a) => a.action === "OPEN");
    const firstRespondent = issue.actions.find((a) => a.actor === "respondent");
    const resolutionProposed = issue.status === "RESOLUTION_PROPOSED" || !!issue.resolution;
    const res = issue.resolution as Record<string, unknown> | undefined;

    return (
      <div className="space-y-4 pb-8">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">Grievance</h1>
          <Badge variant={closed ? "success" : "secondary"} className="ml-auto">
            {issue.status}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">Issue #{issue.issueId}</p>

        <Card className="p-4 space-y-2">
          <h2 className="text-sm font-semibold">Details</h2>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <span className="text-muted-foreground">Category</span>
            <span>{issue.category ?? "—"}</span>
            <span className="text-muted-foreground">Sub-category</span>
            <span>{issue.subCategory ?? "—"}</span>
            {issue.shortDesc ? (
              <>
                <span className="text-muted-foreground">Summary</span>
                <span>{issue.shortDesc}</span>
              </>
            ) : null}
            {issue.longDesc ? (
              <>
                <span className="text-muted-foreground">Description</span>
                <span className="text-muted-foreground text-xs">{issue.longDesc}</span>
              </>
            ) : null}
          </div>
        </Card>

        <Card className="p-4 space-y-2">
          <h2 className="text-sm font-semibold flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" /> Process
          </h2>
          <div className="flex items-center gap-0">
            {["OPEN", "PROCESSING", "RESOLUTION_PROPOSED", "RESOLVED"].map(
              (step, idx) => {
                const stepIdx = ["OPEN", "PROCESSING", "RESOLUTION_PROPOSED", "RESOLVED"];
                const currentIdx = stepIdx.indexOf(issue.status);
                const done = idx < currentIdx;
                const active = idx === currentIdx;
                return (
                  <React.Fragment key={step}>
                    {idx > 0 ? (
                      <div
                        className={`h-px flex-1 ${done || active ? "bg-primary" : "bg-border"}`}
                      />
                    ) : null}
                    <div className="flex flex-col items-center gap-1 shrink-0">
                      <span
                        className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold ${
                          done
                            ? "bg-primary text-primary-foreground"
                            : active
                              ? "ring-2 ring-primary ring-offset-2 bg-primary text-primary-foreground"
                              : "bg-accent text-muted-foreground"
                        }`}
                      >
                        {done ? "✓" : idx + 1}
                      </span>
                      <span className={`text-[10px] leading-tight text-center max-w-16 ${active ? "font-semibold text-primary" : "text-muted-foreground"}`}>
                        {step === "RESOLUTION_PROPOSED" ? "RESOLUTION" : step}
                      </span>
                    </div>
                  </React.Fragment>
                );
              }
            )}
          </div>
          <div className="grid grid-cols-3 gap-3 text-xs pt-1">
            <div className="rounded-lg bg-accent/30 p-2.5 text-center">
              <p className="text-muted-foreground">Response</p>
              <p className="font-semibold">
                {openAction && firstRespondent
                  ? elapsed(openAction.updatedAt, firstRespondent.updatedAt)
                  : hasRespondentAction
                    ? "—"
                    : "Awaiting…"}
              </p>
            </div>
            <div className="rounded-lg bg-accent/30 p-2.5 text-center">
              <p className="text-muted-foreground">Processing</p>
              <p className="font-semibold">
                {openAction && issue.resolutionProposedAt
                  ? elapsed(openAction.updatedAt, new Date(issue.resolutionProposedAt).toISOString())
                  : resolutionProposed || closed
                    ? "—"
                    : "In progress…"}
              </p>
            </div>
            <div className="rounded-lg bg-accent/30 p-2.5 text-center">
              <p className="text-muted-foreground">Resolution</p>
              <p className="font-semibold">
                {openAction && issue.resolvedAt
                  ? elapsed(openAction.updatedAt, new Date(issue.resolvedAt).toISOString())
                  : closed
                    ? "—"
                    : "Pending…"}
              </p>
            </div>
          </div>
        </Card>

        {hasRespondentAction ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <p className="font-medium">Response received from seller</p>
            <p className="mt-0.5 text-xs text-emerald-600">
              {issue.actions
                .filter((a) => a.actor === "respondent")
                .slice(-1)[0]
                ?.action.replace(/_/g, " ") ?? ""}
            </p>
          </div>
        ) : null}

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Timeline</h2>
          <div className="space-y-3">
            {issue.actions.map((a, i) => {
              const prev = i > 0 ? issue.actions[i - 1] : null;
              return (
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
                  <div className="flex-1 pb-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-medium">{a.action.replace(/_/g, " ")}</p>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {formatTime(a.updatedAt)}
                        {prev ? ` (+${elapsed(prev.updatedAt, a.updatedAt)})` : ""}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {a.actor === "complainant" ? "You" : "Seller"}
                      {a.shortDesc ? ` · ${a.shortDesc}` : ""}
                    </p>
                    {a.images && a.images.length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {a.images.map((img, j) => (
                          <img
                            key={j}
                            src={img.url}
                            alt=""
                            className="h-10 w-10 rounded border object-cover"
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {resolutionProposed && res ? (
          <Card className="p-4 border-emerald-200 bg-emerald-50/50">
            <h2 className="mb-2 text-sm font-semibold flex items-center gap-1.5 text-emerald-800">
              <CheckCircle2 className="h-4 w-4" /> Resolution proposed by seller
            </h2>
            <div className="space-y-1.5 text-sm">
              {typeof res.refund_amount === "string" ? (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Refund amount</span>
                  <span className="font-semibold">
                    {String(res.refund_currency ?? "INR")} {String(res.refund_amount)}
                  </span>
                </div>
              ) : null}
              {typeof res.replacement_item_id === "string" ? (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Replacement</span>
                  <span className="font-semibold">Item {String(res.replacement_item_id)}</span>
                </div>
              ) : null}
              {typeof res.replacement_count === "number" ? (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Qty</span>
                  <span className="font-semibold">{String(res.replacement_count)}</span>
                </div>
              ) : null}
              {typeof res.resolution_type === "string" ? (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Type</span>
                  <span className="font-semibold capitalize">{String(res.resolution_type).replace(/_/g, " ")}</span>
                </div>
              ) : null}
            </div>
          </Card>
        ) : null}

        {error ? (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {!closed ? (
          <>
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">
                Attach images (optional)
              </Label>
              <div className="flex flex-wrap gap-2">
                {followUpImages.map((img, i) => (
                  <div key={i} className="relative h-14 w-14 overflow-hidden rounded-lg border">
                    <img src={img.url} alt="" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeFollowUpImage(i)}
                      className="absolute right-0.5 top-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-black/50 text-white text-[10px]"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}
                <label className="grid h-14 w-14 cursor-pointer place-items-center rounded-lg border border-dashed text-muted-foreground hover:border-primary hover:text-primary">
                  <ImagePlus className="h-4 w-4" />
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={addFollowUpImage}
                  />
                </label>
              </div>
            </div>
            {issue.status === "NEED_MORE_INFO" ? (
              <>
                <div className="space-y-2">
                  <Label className="block text-xs text-muted-foreground">
                    Additional Information Requested
                  </Label>
                  <Textarea
                    value={additionalInfo}
                    onChange={(e) => setAdditionalInfo(e.target.value)}
                    placeholder="Provide the additional information requested by the seller..."
                    disabled={busy != null}
                  />
                </div>
                <Button
                  className="w-full"
                  disabled={busy != null || !additionalInfo.trim()}
                  onClick={() => followUp("INFO_PROVIDED")}
                >
                  {busy === "INFO_PROVIDED"
                    ? "Submitting…"
                    : "Provide Information"}
                </Button>
              </>
            ) : null}
            {resolutionProposed ? (
              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant="default"
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
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
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
          </>
        ) : (
          <Button onClick={() => router.push(`/shop/order/${txn}/${bppId}`)}>
            Back to order
          </Button>
        )}
      </div>
    );
  }

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
        <div className="flex flex-wrap gap-1.5">
          {["ITEM", "FULFILLMENT", "PAYMENT", "ORDER"].map((group) => {
            const items = CATEGORIES.filter((c) => c.c === group);
            return (
              <div key={group} className="w-full">
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {group === "ITEM"
                    ? "Item Issues"
                    : group === "FULFILLMENT"
                      ? "Delivery Issues"
                      : group === "PAYMENT"
                        ? "Payment"
                        : "Order"}
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {items.map((c) => (
                    <button
                      key={c.s}
                      onClick={() => setCat(c)}
                      className={`rounded-lg border px-2.5 py-2 text-left text-sm leading-tight ${
                        cat.s === c.s
                          ? "border-primary bg-accent/40 ring-1 ring-primary"
                          : "border-border"
                      } ${c.requiresImage ? "after:ml-1 after:text-[10px] after:text-amber-500 after:content-['*']" : ""}`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
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
        <Label className="mb-1.5 block">
          Photo{cat.requiresImage ? " (required)" : ""}
        </Label>
        <div className="flex flex-wrap gap-2">
          {images.map((img, i) => (
            <div key={i} className="relative h-16 w-16 overflow-hidden rounded-lg border">
              <img
                src={img.url}
                alt=""
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() => removeImage(i)}
                className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full bg-black/50 text-white"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          <label className="grid h-16 w-16 cursor-pointer place-items-center rounded-lg border border-dashed text-muted-foreground hover:border-primary hover:text-primary">
            <ImagePlus className="h-5 w-5" />
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={addImage}
            />
          </label>
        </div>
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
