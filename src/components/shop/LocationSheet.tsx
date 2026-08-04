"use client";

// Delivery-location picker. Opened from the header "Deliver to" control on both
// mobile and desktop. Lets the buyer:
//   • detect their current location (browser geolocation → GPS), then best-effort
//     reverse-geocode it (OpenStreetMap Nominatim) to auto-fill area / city /
//     pincode, and
//   • enter / correct a pincode + area manually.
// The result is saved to the shop store (persisted to localStorage) as the
// delivery address so search + checkout carry it. GPS matters because RET10
// serviceability is usually hyperlocal.
//
// Radix portals to <body>, which is OUTSIDE the `.shop-theme` token scope, so we
// re-apply `shop-theme` (+ `dark`) on the dialog surface to keep the blue theme.
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { MapPin, Navigation, Loader2, X, Check } from "lucide-react";
import { Button, Input, Label } from "@/components/shop/ui";
import { useShop, type Address } from "@/lib/shop/store";
import { useTheme } from "@/lib/shop/theme";
import { cn } from "@/lib/shop/cn";

type LocForm = {
  areaCode: string;
  locality: string;
  city: string;
  state: string;
  gps: string;
};

function fromAddress(a: Address | null): LocForm {
  return {
    areaCode: a?.areaCode ?? "",
    locality: a?.locality ?? "",
    city: a?.city ?? "",
    state: a?.state ?? "",
    gps: a?.gps ?? "",
  };
}

type NominatimAddress = Record<string, string | undefined>;

export function LocationSheet({
  open,
  onOpenChange,
  autoDetect = false,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  // When true, kick off geolocation automatically as the sheet opens (used for
  // the first-visit prompt). A denied permission just leaves the form for
  // manual entry.
  autoDetect?: boolean;
}) {
  const { address, setAddress } = useShop();
  const { theme } = useTheme();
  const [form, setForm] = React.useState<LocForm>(() => fromAddress(address));
  const [locating, setLocating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);

  // Sync the form from the saved address each time the sheet opens (the sheet is
  // opened externally via the `open` prop, so Radix's onOpenChange doesn't fire
  // for it — reading the store here is the documented external-sync exception).
  /* eslint-disable react-hooks/set-state-in-effect */
  React.useEffect(() => {
    if (open) {
      setForm(fromAddress(address));
      setError(null);
      setNote(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const detect = React.useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("Location isn't available in this browser — enter a pincode below.");
      return;
    }
    setLocating(true);
    setError(null);
    setNote(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const gps = `${lat.toFixed(6)},${lon.toFixed(6)}`;
        setForm((f) => ({ ...f, gps }));
        setNote("Location detected — finding your area…");
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=16&addressdetails=1`,
            { headers: { Accept: "application/json" } }
          );
          if (res.ok) {
            const json = (await res.json()) as { address?: NominatimAddress };
            const a = json.address ?? {};
            setForm((f) => ({
              ...f,
              areaCode: a.postcode ?? f.areaCode,
              locality:
                a.suburb ??
                a.neighbourhood ??
                a.residential ??
                a.village ??
                a.town ??
                f.locality,
              city: a.city ?? a.town ?? a.county ?? a.state_district ?? f.city,
              state: a.state ?? f.state,
            }));
            setNote("Found your area — confirm the details and save.");
          } else {
            setNote("Location set — add your pincode to finish.");
          }
        } catch {
          setNote("Location set — add your pincode to finish.");
        } finally {
          setLocating(false);
        }
      },
      () => {
        setLocating(false);
        setError(
          "Couldn't get your location. Allow location access, or enter a pincode below."
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 300_000 }
    );
  }, []);

  const set = (k: keyof LocForm, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = () => {
    const areaCode = form.areaCode.trim();
    const gps = form.gps.trim();
    if (!areaCode && !gps) {
      setError("Enter a pincode or use your current location.");
      return;
    }
    if (areaCode && !/^\d{6}$/.test(areaCode)) {
      setError("Pincode must be a 6-digit number.");
      return;
    }
    // Preserve any existing contact fields (name/phone/email) captured at
    // checkout; only replace the location-related parts.
    setAddress({
      ...(address ?? { name: "", phone: "" }),
      areaCode: areaCode || undefined,
      locality: form.locality.trim() || undefined,
      city: form.city.trim() || undefined,
      state: form.state.trim() || undefined,
      gps: gps || undefined,
    });
    onOpenChange(false);
  };

  // First-visit auto-detect: fire geolocation once as the sheet opens with
  // `autoDetect`. Guarded by a ref so it runs a single time per open.
  const autoRan = React.useRef(false);
   
  React.useEffect(() => {
    if (open && autoDetect && !autoRan.current) {
      autoRan.current = true;
      detect();
    }
    if (!open) autoRan.current = false;
  }, [open, autoDetect, detect]);
   

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm transition-opacity data-[state=closed]:opacity-0 data-[state=open]:opacity-100" />
        <Dialog.Content
          className={cn(
            "shop-theme fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-background p-5 text-foreground shadow-soft-lg",
            theme === "dark" && "dark"
          )}
        >
          <div className="mb-1 flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold tracking-tight">
              Choose your delivery location
            </Dialog.Title>
            <Dialog.Close className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent">
              <X className="h-5 w-5" />
              <span className="sr-only">Close</span>
            </Dialog.Close>
          </div>
          <Dialog.Description className="text-sm text-muted-foreground">
            We use it to show items that deliver to you and to price your order.
          </Dialog.Description>

          <button
            type="button"
            onClick={detect}
            disabled={locating}
            className="mt-4 flex w-full items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 px-4 py-3 text-left transition-colors hover:bg-primary/10 disabled:opacity-60"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
              {locating ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Navigation className="h-5 w-5" />
              )}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-primary">
                {locating ? "Detecting…" : "Use my current location"}
              </span>
              <span className="block text-xs text-muted-foreground">
                Detect via GPS and auto-fill your area
              </span>
            </span>
          </button>

          <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or enter manually
            <span className="h-px flex-1 bg-border" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label className="mb-1.5 block">Pincode</Label>
              <Input
                value={form.areaCode}
                onChange={(e) => set("areaCode", e.target.value)}
                placeholder="560001"
                inputMode="numeric"
                maxLength={6}
              />
            </div>
            <div className="col-span-2">
              <Label className="mb-1.5 block">Area / Locality</Label>
              <Input
                value={form.locality}
                onChange={(e) => set("locality", e.target.value)}
                placeholder="Indiranagar"
              />
            </div>
            <div>
              <Label className="mb-1.5 block">City</Label>
              <Input
                value={form.city}
                onChange={(e) => set("city", e.target.value)}
                placeholder="Bengaluru"
              />
            </div>
            <div>
              <Label className="mb-1.5 block">State</Label>
              <Input
                value={form.state}
                onChange={(e) => set("state", e.target.value)}
                placeholder="Karnataka"
              />
            </div>
          </div>

          {form.gps ? (
            <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 text-primary" />
              GPS captured: {form.gps}
            </p>
          ) : null}

          {error ? (
            <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {note && !error ? (
            <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
              <Check className="h-4 w-4" />
              {note}
            </p>
          ) : null}

          <Button className="mt-5 w-full" size="lg" onClick={save}>
            Save location
          </Button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
