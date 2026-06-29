"use client";

// Buyer-app ACCOUNT — profile + saved delivery address (the same Address the
// checkout reuses) and quick links. There is no server-side buyer account in
// this ONDC BAP, so this is device-local profile data persisted via the store.
import * as React from "react";
import Link from "next/link";
import {
  User,
  MapPin,
  Package,
  CreditCard,
  Info,
  Save,
  Trash2,
} from "lucide-react";
import { Button, Card, Input, Label } from "@/components/shop/ui";
import { useShop, type Address } from "@/lib/shop/store";

export default function AccountPage() {
  const { address, setAddress, orders } = useShop();
  const [form, setForm] = React.useState<Address>(
    address ?? { name: "", phone: "", email: "" }
  );
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    if (address) setForm(address);
  }, [address]);

  const update = (k: keyof Address, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = () => {
    setAddress(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="space-y-5 pb-8">
      <div className="flex items-center gap-3">
        <div className="grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-primary to-blue-500 text-lg font-bold text-primary-foreground">
          {(form.name || "OI").slice(0, 2).toUpperCase()}
        </div>
        <div>
          <p className="text-lg font-semibold">{form.name || "Guest"}</p>
          <p className="text-sm text-muted-foreground">
            {form.phone || "Add your details below"}
          </p>
        </div>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 gap-3">
        <Link href="/shop/orders">
          <Card className="flex items-center gap-3 p-4">
            <Package className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-medium">Orders</p>
              <p className="text-xs text-muted-foreground">{orders.length} placed</p>
            </div>
          </Card>
        </Link>
        <Link href="/shop/search">
          <Card className="flex items-center gap-3 p-4">
            <CreditCard className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-medium">Payments</p>
              <p className="text-xs text-muted-foreground">Per-order</p>
            </div>
          </Card>
        </Link>
      </div>

      {/* Profile + address */}
      <Card className="space-y-4 p-4">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <User className="h-4 w-4" /> Profile
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="mb-1.5 block">Name</Label>
            <Input value={form.name} onChange={(e) => update("name", e.target.value)} />
          </div>
          <div>
            <Label className="mb-1.5 block">Phone</Label>
            <Input
              value={form.phone}
              onChange={(e) => update("phone", e.target.value)}
              inputMode="tel"
            />
          </div>
          <div className="col-span-2">
            <Label className="mb-1.5 block">Email</Label>
            <Input
              value={form.email ?? ""}
              onChange={(e) => update("email", e.target.value)}
              type="email"
            />
          </div>
        </div>

        <h2 className="flex items-center gap-1.5 pt-2 text-sm font-semibold">
          <MapPin className="h-4 w-4" /> Delivery address
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label className="mb-1.5 block">Building</Label>
            <Input
              value={form.building ?? ""}
              onChange={(e) => update("building", e.target.value)}
            />
          </div>
          <div className="col-span-2">
            <Label className="mb-1.5 block">Locality</Label>
            <Input
              value={form.locality ?? ""}
              onChange={(e) => update("locality", e.target.value)}
            />
          </div>
          <div>
            <Label className="mb-1.5 block">City</Label>
            <Input value={form.city ?? ""} onChange={(e) => update("city", e.target.value)} />
          </div>
          <div>
            <Label className="mb-1.5 block">Pincode</Label>
            <Input
              value={form.areaCode ?? ""}
              onChange={(e) => update("areaCode", e.target.value)}
              inputMode="numeric"
            />
          </div>
        </div>

        <Button className="w-full" onClick={save}>
          <Save className="h-4 w-4" /> {saved ? "Saved!" : "Save details"}
        </Button>
      </Card>

      {/* About */}
      <Card className="p-4">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Info className="h-4 w-4" /> About
        </h2>
        <p className="mt-1.5 text-xs text-muted-foreground">
          OpenIdea is a Buyer App on the ONDC network (RET10). You shop across
          many independent sellers through one open protocol — discovery,
          ordering, fulfilment and grievances all run on ONDC.
        </p>
      </Card>

      <button
        onClick={() => {
          if (typeof window !== "undefined") {
            window.localStorage.removeItem("shop.cart.v1");
            window.localStorage.removeItem("shop.txn.v1");
            window.location.reload();
          }
        }}
        className="flex w-full items-center justify-center gap-1.5 py-2 text-xs text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="h-3.5 w-3.5" /> Clear cart &amp; session
      </button>
    </div>
  );
}
