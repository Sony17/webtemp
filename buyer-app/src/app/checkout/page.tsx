"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  CreditCard,
  Smartphone,
  Banknote,
  Info,
  Store,
  Lock,
  CheckCircle2,
  ShoppingCart,
} from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Stepper } from "@/components/Stepper";
import { AddressCard } from "@/components/AddressCard";
import { PriceCard } from "@/components/PriceCard";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useCart } from "@/hooks/use-cart";
import { addresses, paymentMethods } from "@/mock/user";
import { formatINR, pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";

const STEPS = ["Address", "Payment", "Review"];
const PAY_ICONS: Record<string, typeof CreditCard> = {
  upi: Smartphone,
  card: CreditCard,
  cod: Banknote,
  netbanking: Banknote,
};

export default function CheckoutPage() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const { lines, breakup, count, clear } = useCart();

  const [step, setStep] = React.useState(0);
  const [dir, setDir] = React.useState(1);
  const [addressId, setAddressId] = React.useState(addresses.find((a) => a.isDefault)?.id ?? addresses[0]?.id);
  const [paymentId, setPaymentId] = React.useState(
    paymentMethods.find((p) => p.isDefault)?.id ?? paymentMethods[0]?.id
  );
  const [placing, setPlacing] = React.useState(false);

  const address = addresses.find((a) => a.id === addressId)!;
  const payment = paymentMethods.find((p) => p.id === paymentId)!;

  function go(next: number) {
    setDir(next > step ? 1 : -1);
    setStep(next);
  }

  if (lines.length === 0 && !placing) {
    return (
      <PageContainer size="narrow">
        <EmptyState
          icon={ShoppingCart}
          title="Nothing to check out"
          description="Your cart is empty. Add items before proceeding to checkout."
          action={
            <Button asChild>
              <Link href="/search">Browse products</Link>
            </Button>
          }
        />
      </PageContainer>
    );
  }

  function placeOrder() {
    setPlacing(true);
    const orderId = `OID-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 89999)}`;
    setTimeout(() => {
      clear();
      router.push(`/order/success?id=${orderId}&total=${breakup.total}`);
    }, 900);
  }

  const variants = {
    enter: (d: number) => (reduce ? { opacity: 0 } : { opacity: 0, x: d * 40 }),
    center: { opacity: 1, x: 0 },
    exit: (d: number) => (reduce ? { opacity: 0 } : { opacity: 0, x: d * -40 }),
  };

  return (
    <PageContainer className="space-y-6">
      <div className="flex items-center gap-3">
        {step > 0 ? (
          <button
            onClick={() => go(step - 1)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
        ) : (
          <Link href="/cart" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Cart
          </Link>
        )}
        <h1 className="text-xl font-semibold tracking-tight">Checkout</h1>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 shadow-soft sm:p-5">
        <Stepper steps={STEPS} current={step} onStepClick={(i) => go(i)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Step content (animated) */}
        <div className="relative overflow-hidden">
          <AnimatePresence mode="wait" custom={dir} initial={false}>
            <motion.div
              key={step}
              custom={dir}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            >
              {step === 0 && (
                <div className="space-y-5">
                  <section className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-semibold">Delivery address</h2>
                      <Button variant="ghost" size="sm" className="text-primary">
                        <Plus className="h-4 w-4" /> Add new
                      </Button>
                    </div>
                    <div className="space-y-3">
                      {addresses.map((a) => (
                        <AddressCard
                          key={a.id}
                          address={a}
                          selectable
                          selected={a.id === addressId}
                          onSelect={() => setAddressId(a.id)}
                        />
                      ))}
                    </div>
                  </section>

                  <section className="space-y-3">
                    <h2 className="text-sm font-semibold">Billing details</h2>
                    <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-card p-4 text-sm shadow-soft">
                      <CheckCircle2 className="h-5 w-5 text-primary" />
                      <span>Billing address same as delivery address</span>
                    </label>
                  </section>

                  <Button size="lg" className="w-full" onClick={() => go(1)}>
                    Continue to payment <ArrowRight className="h-5 w-5" />
                  </Button>
                </div>
              )}

              {step === 1 && (
                <div className="space-y-5">
                  <section className="space-y-3">
                    <h2 className="text-sm font-semibold">Select payment method</h2>
                    <RadioGroup value={paymentId} onValueChange={setPaymentId} className="gap-3">
                      {paymentMethods.map((pm) => {
                        const Icon = PAY_ICONS[pm.type] ?? CreditCard;
                        const selected = pm.id === paymentId;
                        return (
                          <Label
                            key={pm.id}
                            htmlFor={pm.id}
                            className={cn(
                              "flex cursor-pointer items-center gap-3 rounded-xl border bg-card p-4 shadow-soft transition-all",
                              selected ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/40"
                            )}
                          >
                            <RadioGroupItem value={pm.id} id={pm.id} />
                            <span className="grid h-9 w-9 place-items-center rounded-lg bg-secondary">
                              <Icon className="h-4 w-4" />
                            </span>
                            <span className="flex-1">
                              <span className="block text-sm font-medium">{pm.label}</span>
                              <span className="text-xs text-muted-foreground">{pm.detail}</span>
                            </span>
                            {pm.isDefault && <Badge variant="muted">Default</Badge>}
                          </Label>
                        );
                      })}
                    </RadioGroup>
                  </section>

                  <div className="flex items-start gap-2 rounded-xl border border-primary/20 bg-accent/40 p-3 text-xs text-accent-foreground">
                    <Info className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>
                      Final payable amount is confirmed by the seller during order placement, as per the
                      ONDC protocol. You will only be charged the confirmed amount.
                    </p>
                  </div>

                  <Button size="lg" className="w-full" onClick={() => go(2)}>
                    Review order <ArrowRight className="h-5 w-5" />
                  </Button>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-5">
                  <section className="space-y-3">
                    <h2 className="text-sm font-semibold">Review order</h2>
                    <div className="rounded-xl border border-border bg-card shadow-soft">
                      <div className="divide-y divide-border px-4">
                        {lines.map((line) => (
                          <div key={`${line.productId}-${line.sellerId}`} className="flex items-center gap-3 py-3">
                            <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
                              <Image src={line.product.images[0]} alt={line.product.title} fill sizes="48px" className="object-cover" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="line-clamp-1 text-sm font-medium">{line.product.title}</p>
                              <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                <Store className="h-3 w-3" /> {line.seller.name} · Qty {line.quantity}
                              </p>
                            </div>
                            <span className="text-sm font-semibold tabular-nums">
                              {formatINR(line.seller.price * line.quantity)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </section>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-border bg-card p-4 text-sm shadow-soft">
                      <div className="mb-1 flex items-center justify-between">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Delivering to</p>
                        <button
                          type="button"
                          onClick={() => go(0)}
                          className="text-xs font-medium text-primary hover:underline"
                        >
                          Edit
                        </button>
                      </div>
                      <p className="font-medium">{address.label}</p>
                      <p className="text-muted-foreground">{address.line1}, {address.city} — {address.pincode}</p>
                    </div>
                    <div className="rounded-xl border border-border bg-card p-4 text-sm shadow-soft">
                      <div className="mb-1 flex items-center justify-between">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Paying with</p>
                        <button
                          type="button"
                          onClick={() => go(1)}
                          className="text-xs font-medium text-primary hover:underline"
                        >
                          Edit
                        </button>
                      </div>
                      <p className="font-medium">{payment.label}</p>
                      <p className="text-muted-foreground">{payment.detail}</p>
                    </div>
                  </div>

                  <div className="lg:hidden">
                    <PriceCard breakup={breakup} title="Payment summary" showOndcNote />
                  </div>

                  <Separator />

                  <Button size="lg" className="w-full" onClick={placeOrder} disabled={placing}>
                    <Lock className="h-5 w-5" />
                    {placing ? "Placing order…" : `Place order · ${formatINR(breakup.total)}`}
                  </Button>
                  <p className="text-center text-xs text-muted-foreground">
                    {count} {pluralize(count, "item")} · By placing this order you agree to OpenIdea&apos;s terms.
                  </p>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Order summary sidebar (desktop) */}
        <aside className="hidden lg:block">
          <div className="sticky top-24 space-y-4">
            <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
              <h3 className="mb-3 text-sm font-semibold">Order summary</h3>
              <div className="max-h-64 space-y-3 overflow-y-auto pr-1 scrollbar-none">
                {lines.map((line) => (
                  <div key={`${line.productId}-${line.sellerId}`} className="flex items-center gap-3">
                    <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
                      <Image src={line.product.images[0]} alt="" fill sizes="44px" className="object-cover" />
                      <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                        {line.quantity}
                      </span>
                    </div>
                    <p className="line-clamp-1 flex-1 text-xs">{line.product.title}</p>
                    <span className="text-xs font-semibold tabular-nums">
                      {formatINR(line.seller.price * line.quantity)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <PriceCard breakup={breakup} title="Payment summary" showOndcNote />
          </div>
        </aside>
      </div>
    </PageContainer>
  );
}
