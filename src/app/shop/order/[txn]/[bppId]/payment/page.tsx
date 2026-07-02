"use client";

// Buyer-app PAYMENT experience. ONDC settles out-of-band, so this BAP tracks a
// PENDING → PAID payment record and shows the buyer how to pay:
//   - GET  /api/payments/status        — live PENDING/PAID
//   - GET  /api/payments/instructions  — UPI / bank / reference / amount / QR
//   - POST /api/payments/create        — idempotently (re)open the record (retry)
// COD vs prepaid is offered only when the seller's on_init terms advertise an
// on-fulfilment payment (parsePaymentTerms). The buyer cannot self-mark PAID —
// settlement is reconciled out-of-band; we poll status until it flips.
import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Loader2,
  CheckCircle2,
  Copy,
  RefreshCw,
  Banknote,
  Smartphone,
  Wallet,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { Button, Card, Badge, Separator } from "@/components/shop/ui";
import { EmptyState, Spinner } from "@/components/shop/widgets";
import { useShop } from "@/lib/shop/store";
import { useShopState } from "@/lib/shop/useShopState";
import { parsePaymentTerms } from "@/lib/shop/types";
import { formatINR } from "@/lib/shop/cn";
import * as api from "@/lib/shop/api";

type Method = "PREPAID" | "COD";

export default function PaymentPage() {
  const { txn, bppId } = useParams<{ txn: string; bppId: string }>();
  const transactionId = decodeURIComponent(txn);
  const bpp = decodeURIComponent(bppId);
  const router = useRouter();
  const { orders, updateOrderRef } = useShop();

  const orderRef = orders.find(
    (o) => o.transactionId === transactionId && o.bppId === bpp
  );

  // Order state → seller payment terms (COD availability).
  const { state } = useShopState(transactionId, { maxMs: 8000, bppId: bpp });
  const order = state?.bpps.find((b) => b.bppId === bpp)?.order ?? null;
  const terms = parsePaymentTerms(order);
  const codOffered = terms.some((t) => t.isCOD);

  const [method, setMethod] = React.useState<Method>(
    orderRef?.paymentMethod ?? "PREPAID"
  );
  const [status, setStatus] = React.useState<"PENDING" | "PAID" | null>(null);
  const [instr, setInstr] = React.useState<Awaited<
    ReturnType<typeof api.paymentInstructions>
  > | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Bumping this re-runs the load effect (used by retry).
  const [reloadKey, setReloadKey] = React.useState(0);

  // Load the payment record + instructions (an external system). Ensures the
  // record exists (idempotent create on 404), then reads status + how-to-pay.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let st: "PENDING" | "PAID" | null = null;
        try {
          const s = await api.paymentStatus(transactionId);
          st = s.status;
        } catch {
          await api.createPayment({
            transactionId,
            orderId: order?.orderId,
            amount: orderRef?.total,
          });
          const s = await api.paymentStatus(transactionId);
          st = s.status;
        }
        if (cancelled) return;
        setStatus(st);
        const i = await api.paymentInstructions(transactionId);
        if (cancelled) return;
        setInstr(i);
        setError(null);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Couldn't load payment.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [transactionId, order?.orderId, orderRef?.total, reloadKey]);

  // Poll status while PENDING + prepaid (settlement reconciles out-of-band).
  React.useEffect(() => {
    if (status !== "PENDING" || method !== "PREPAID") return;
    const id = setInterval(async () => {
      try {
        const s = await api.paymentStatus(transactionId);
        setStatus(s.status);
      } catch {
        /* ignore transient */
      }
    }, 5000);
    return () => clearInterval(id);
  }, [status, method, transactionId]);

  const chooseMethod = (m: Method) => {
    setMethod(m);
    updateOrderRef(transactionId, bpp, { paymentMethod: m });
  };

  const retry = async () => {
    setBusy(true);
    try {
      await api.createPayment({
        transactionId,
        orderId: order?.orderId,
        amount: orderRef?.total,
      });
      setReloadKey((k) => k + 1);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner label="Loading payment…" />;

  if (error) {
    return (
      <EmptyState
        icon={<AlertTriangle className="h-7 w-7" />}
        title="Payment unavailable"
        description={error}
        action={<Button onClick={retry}>Retry</Button>}
      />
    );
  }

  const paid = status === "PAID";
  const amount = instr?.amount ?? orderRef?.total;

  return (
    <div className="space-y-4 pb-8">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold">Payment</h1>
        <Badge variant={paid ? "success" : "warning"} className="ml-auto">
          {paid ? "Paid" : method === "COD" ? "Pay on delivery" : "Pending"}
        </Badge>
      </div>

      {/* Method chooser (only when seller offers COD) */}
      {!paid && codOffered ? (
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              { key: "PREPAID", label: "Pay now", icon: Smartphone },
              { key: "COD", label: "Cash on delivery", icon: Banknote },
            ] as const
          ).map((m) => (
            <button
              key={m.key}
              onClick={() => chooseMethod(m.key)}
              className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-sm font-medium ${
                method === m.key
                  ? "border-primary bg-accent/40 ring-1 ring-primary"
                  : "border-border"
              }`}
            >
              <m.icon className="h-4 w-4" /> {m.label}
            </button>
          ))}
        </div>
      ) : null}

      {/* PAID */}
      {paid ? (
        <EmptyState
          icon={<CheckCircle2 className="h-7 w-7" />}
          title="Payment received"
          description="Your payment has been confirmed against this order."
          action={
            <Button onClick={() => router.push(`/shop/order/${txn}/${bppId}`)}>
              Back to order
            </Button>
          }
        />
      ) : method === "COD" ? (
        /* COD */
        <Card className="p-5 text-center">
          <Banknote className="mx-auto h-8 w-8 text-primary" />
          <p className="mt-2 font-semibold">Pay {formatINR(amount)} on delivery</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Keep cash ready. You&apos;ll pay the delivery partner when your order
            arrives.
          </p>
          <Button
            className="mt-4"
            variant="outline"
            onClick={() => router.push(`/shop/order/${txn}/${bppId}`)}
          >
            Back to order
          </Button>
        </Card>
      ) : (
        /* PREPAID — instructions + pending */
        <>
          <Card className="p-4">
            <div className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-primary" />
              <p className="text-sm font-semibold">Amount to pay</p>
              <span className="ml-auto text-lg font-semibold">
                {formatINR(amount)}
              </span>
            </div>
            <Separator className="my-3" />
            {instr?.upiId || instr?.accountNumber ? (
              <div className="space-y-1">
                {instr?.qrCodeUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={instr.qrCodeUrl}
                    alt="UPI QR"
                    className="mx-auto mb-3 h-44 w-44 rounded-lg border border-border object-contain"
                  />
                ) : null}
                <Row label="Reference" value={instr!.paymentReference} copyable />
                {instr?.upiId ? <Row label="UPI ID" value={instr.upiId} copyable /> : null}
                {instr?.accountNumber ? (
                  <>
                    <Row label="A/C name" value={instr.accountName ?? "—"} />
                    <Row label="A/C number" value={instr.accountNumber} copyable />
                    <Row label="IFSC" value={instr.ifsc ?? "—"} />
                  </>
                ) : null}
              </div>
            ) : (
              <div className="rounded-md bg-amber-50 px-3 py-2.5 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                <p className="font-medium">Seller payment details not configured</p>
                <p className="mt-0.5">
                  The collection UPI/bank account isn&apos;t set up yet. Your
                  reference is{" "}
                  <span className="font-mono">{instr?.paymentReference}</span> —
                  please contact support to complete payment.
                </p>
              </div>
            )}
          </Card>

          <Card className="flex items-center gap-3 p-4">
            <Clock className="h-5 w-5 text-amber-500" />
            <div className="flex-1 text-sm">
              <p className="font-medium">Waiting for payment confirmation</p>
              <p className="text-xs text-muted-foreground">
                After you pay, this updates automatically once settlement is
                confirmed.
              </p>
            </div>
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </Card>

          <Button
            variant="outline"
            className="w-full"
            disabled={busy}
            onClick={retry}
          >
            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
            {busy ? "Refreshing…" : "I've paid — refresh status"}
          </Button>
        </>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  copyable,
}: {
  label: string;
  value: string;
  copyable?: boolean;
}) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="inline-flex items-center gap-1.5 font-medium">
        {value}
        {copyable ? (
          <button
            onClick={() => {
              navigator.clipboard?.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
            className="text-primary"
            aria-label="Copy"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {copied ? <span className="text-xs text-emerald-600">Copied</span> : null}
      </span>
    </div>
  );
}
