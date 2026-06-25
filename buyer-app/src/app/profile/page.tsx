"use client";

import * as React from "react";
import Link from "next/link";
import {
  ChevronRight,
  MapPin,
  CreditCard,
  Bell,
  LogOut,
  Plus,
  Pencil,
  Smartphone,
  Banknote,
  ClipboardList,
  Headset,
  ShieldCheck,
} from "lucide-react";
import { PageContainer, SectionHeader } from "@/components/layout/PageContainer";
import { AddressCard } from "@/components/AddressCard";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { userProfile } from "@/mock/user";
import { orders } from "@/mock/orders";
import { useFavourites } from "@/hooks/use-favourites";
import { cn } from "@/lib/utils";

const PAY_ICONS = { upi: Smartphone, card: CreditCard, cod: Banknote, netbanking: Banknote } as const;

export default function ProfilePage() {
  const [notif, setNotif] = React.useState(userProfile.notifications);
  const favourites = useFavourites();

  const stats = [
    { label: "Orders", value: orders.length },
    { label: "Addresses", value: userProfile.addresses.length },
    { label: "Favourites", value: favourites.length },
    { label: "Cards saved", value: userProfile.payments.length },
  ];

  const quickLinks = [
    { icon: ClipboardList, label: "My Orders", href: "/orders", enabled: true },
    { icon: MapPin, label: "Addresses", href: "#addresses", enabled: true },
    { icon: Headset, label: "Help & Support", href: "#", enabled: false },
  ];

  return (
    <PageContainer className="lg:grid lg:grid-cols-[360px_1fr] lg:items-start lg:gap-8">
      {/* ── Left rail (sticky on desktop) ── */}
      <div className="space-y-6 lg:sticky lg:top-24">
        {/* Header card */}
        <section className="flex items-center gap-4 rounded-2xl border border-border bg-gradient-to-br from-accent/50 to-card p-5 shadow-soft">
          <Avatar className="h-16 w-16 border-2 border-background shadow-soft">
            <AvatarImage src={userProfile.avatar} alt={userProfile.name} />
            <AvatarFallback className="text-lg">{userProfile.name.charAt(0)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold">{userProfile.name}</h1>
            <p className="truncate text-sm text-muted-foreground">{userProfile.email}</p>
            <p className="text-sm text-muted-foreground">{userProfile.phone}</p>
          </div>
          <Button variant="outline" size="sm">
            <Pencil className="h-4 w-4" /> Edit
          </Button>
        </section>

        {/* Statistics */}
        <section className="grid grid-cols-4 gap-3">
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-2xl border border-border bg-card p-4 text-center shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-soft-lg"
            >
              <div className="text-xl font-semibold tabular-nums sm:text-2xl">{s.value}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground sm:text-xs">{s.label}</div>
            </div>
          ))}
        </section>

        {/* Quick links */}
        <section className="grid grid-cols-3 gap-3">
          {quickLinks.map(({ icon: Icon, label, href, enabled }) => {
            const inner = (
              <>
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent/60 text-primary">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="flex items-center gap-1">
                  {label}
                  {!enabled && (
                    <Badge variant="muted" className="px-1 py-0 text-[9px]">
                      Soon
                    </Badge>
                  )}
                </span>
              </>
            );
            const base =
              "flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-4 text-center text-xs font-medium shadow-soft transition-all";
            return enabled ? (
              <Link
                key={label}
                href={href}
                className={cn(base, "hover:-translate-y-0.5 hover:shadow-soft-lg")}
              >
                {inner}
              </Link>
            ) : (
              <button
                key={label}
                type="button"
                disabled
                aria-disabled="true"
                title="Coming soon"
                className={cn(base, "cursor-not-allowed opacity-60")}
              >
                {inner}
              </button>
            );
          })}
        </section>

        {/* Footer (desktop) */}
        <section className="hidden space-y-3 lg:block">
          <div className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" />
            OpenIdea is an ONDC Network Participant (Buyer App)
          </div>
          <Button
            variant="outline"
            size="lg"
            className="w-full text-destructive hover:bg-destructive/5 hover:text-destructive"
          >
            <LogOut className="h-5 w-5" /> Log out
          </Button>
        </section>
      </div>

      {/* ── Right content column ── */}
      <div className="mt-6 space-y-8 lg:mt-0">
        {/* Saved addresses */}
        <section id="addresses" className="scroll-mt-24">
          <SectionHeader
            title="Saved addresses"
            action={
              <Button variant="ghost" size="sm" className="text-primary">
                <Plus className="h-4 w-4" /> Add
              </Button>
            }
          />
          <div className="grid gap-3 sm:grid-cols-2">
            {userProfile.addresses.map((a) => (
              <AddressCard
                key={a.id}
                address={a}
                action={
                  <button className="text-xs font-medium text-primary hover:underline">Edit</button>
                }
              />
            ))}
          </div>
        </section>

        {/* Saved payments */}
        <section>
          <SectionHeader
            title="Saved payments"
            action={
              <Button variant="ghost" size="sm" className="text-primary">
                <Plus className="h-4 w-4" /> Add
              </Button>
            }
          />
          <div className="space-y-2.5">
            {userProfile.payments.map((pm) => {
              const Icon = PAY_ICONS[pm.type];
              return (
                <div
                  key={pm.id}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-soft transition-colors hover:border-primary/30"
                >
                  <span className="grid h-10 w-10 place-items-center rounded-lg bg-secondary text-primary">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{pm.label}</p>
                    <p className="text-xs text-muted-foreground">{pm.detail}</p>
                  </div>
                  {pm.isDefault && <Badge variant="muted">Default</Badge>}
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              );
            })}
          </div>
        </section>

        {/* Notifications */}
        <section>
          <SectionHeader title="Notifications" />
          <div className="divide-y divide-border rounded-xl border border-border bg-card shadow-soft">
            {[
              { key: "orderUpdates", label: "Order updates", desc: "Status, delivery and tracking alerts" },
              { key: "offers", label: "Offers & deals", desc: "Discounts from sellers near you" },
              { key: "recommendations", label: "Recommendations", desc: "Personalised product picks" },
            ].map(({ key, label, desc }) => (
              <label key={key} className="flex cursor-pointer items-center gap-3 p-4">
                <Bell className="h-4 w-4 text-muted-foreground" />
                <div className="flex-1">
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
                <Switch
                  aria-label={label}
                  checked={notif[key as keyof typeof notif]}
                  onCheckedChange={(v) => setNotif((n) => ({ ...n, [key]: v }))}
                />
              </label>
            ))}
          </div>
        </section>

        {/* Footer (mobile) */}
        <section className="space-y-3 lg:hidden">
          <div className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" />
            OpenIdea is an ONDC Network Participant (Buyer App)
          </div>
          <Button
            variant="outline"
            size="lg"
            className="w-full text-destructive hover:bg-destructive/5 hover:text-destructive"
          >
            <LogOut className="h-5 w-5" /> Log out
          </Button>
        </section>
      </div>
    </PageContainer>
  );
}
