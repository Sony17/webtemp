"use client";

// Buyer-app chrome. Responsive by design:
//   • Mobile  — compact top app bar + bottom tab navigation (the app shell).
//   • Desktop — a full grocery-web top bar (logo, location, inline search, and
//     Orders/Account/Cart actions) like Blinkit/Zepto/Zomato on the web; the
//     bottom tab bar is hidden and listing pages widen to a real desktop grid.
// Wraps page content and shows the live cart badge from the shop store.
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Home,
  Search,
  ShoppingCart,
  Package,
  User,
  ChevronLeft,
  ChevronDown,
  MapPin,
  Store,
} from "lucide-react";
import { cn } from "@/lib/shop/cn";
import { useShop } from "@/lib/shop/store";
import { useTheme } from "@/lib/shop/theme";
import { ThemeToggle } from "@/components/shop/ThemeToggle";
import { LocationSheet } from "@/components/shop/LocationSheet";
import { CartBar } from "@/components/shop/CartBar";

const TABS = [
  { href: "/shop", label: "Home", icon: Home, exact: true },
  { href: "/shop/search", label: "Search", icon: Search },
  { href: "/shop/cart", label: "Cart", icon: ShoppingCart, badge: true },
  { href: "/shop/orders", label: "Orders", icon: Package },
  { href: "/shop/account", label: "Account", icon: User },
];

// Listing-style pages breathe on wide screens; the flow-tuned pages (cart,
// checkout, product, account, order detail) stay in a comfortable reading
// column so their layouts are untouched.
function pageWidth(pathname: string) {
  const wide =
    pathname === "/shop" ||
    pathname.startsWith("/shop/search") ||
    pathname.startsWith("/shop/seller") ||
    pathname.startsWith("/shop/orders");
  return wide ? "max-w-6xl" : "max-w-2xl";
}

function deliveryLabel(address: ReturnType<typeof useShop>["address"]) {
  return address?.areaCode
    ? `${address.locality ?? address.city ?? ""} ${address.areaCode}`.trim()
    : "Set location";
}

// First-visit location prompt. We read localStorage directly (rather than the
// store's `address`, which hydrates a tick after mount) so returning users who
// already set a location are never re-prompted. `LS_ADDRESS` mirrors the key in
// the shop store.
const LS_ADDRESS = "shop.address.v1";
const LS_LOCATION_PROMPTED = "shop.location.prompted.v1";

function savedHasLocation(): boolean {
  if (typeof window === "undefined") return true; // SSR: never auto-open
  try {
    const raw = window.localStorage.getItem(LS_ADDRESS);
    if (!raw) return false;
    const a = JSON.parse(raw) as { areaCode?: string; gps?: string } | null;
    return !!(a && (a.areaCode || a.gps));
  } catch {
    return true; // on any read error, don't nag
  }
}

function alreadyPrompted(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return !!window.localStorage.getItem(LS_LOCATION_PROMPTED);
  } catch {
    return true;
  }
}

function markPrompted() {
  try {
    window.localStorage.setItem(LS_LOCATION_PROMPTED, "1");
  } catch {
    /* ignore quota / private-mode */
  }
}

function HeaderNavLink({
  href,
  icon: Icon,
  label,
  active,
}: {
  href: string;
  icon: typeof Home;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-accent",
        active ? "text-primary" : "text-foreground"
      )}
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </Link>
  );
}

// Cycling search hints for the mobile search bar (Blinkit/Zepto pattern —
// "Search 'milk'", "Search 'bread'", …). Purely a text swap.
const SEARCH_HINTS = [
  "milk",
  "bread",
  "eggs",
  "rice",
  "atta",
  "bananas",
  "curd",
  "paneer",
];

function RotatingSearchHint() {
  const [i, setI] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(
      () => setI((n) => (n + 1) % SEARCH_HINTS.length),
      2200
    );
    return () => clearInterval(id);
  }, []);
  return (
    <span className="min-w-0 flex-1 truncate">
      Search{" "}
      <span className="font-medium text-foreground">
        &ldquo;{SEARCH_HINTS[i]}&rdquo;
      </span>
    </span>
  );
}

// Short screen title for the mobile app bar on non-home pages.
function mobileTitle(pathname: string): string {
  if (pathname.startsWith("/shop/cart")) return "Cart";
  if (pathname.startsWith("/shop/checkout")) return "Checkout";
  if (pathname.startsWith("/shop/orders")) return "Your orders";
  if (pathname.startsWith("/shop/account")) return "My account";
  if (pathname.startsWith("/shop/search")) return "Search";
  if (pathname.startsWith("/shop/sellers")) return "Stores";
  if (pathname.startsWith("/shop/seller")) return "Store";
  if (pathname.startsWith("/shop/product")) return "Product details";
  if (pathname.startsWith("/shop/order")) return "Order details";
  return "Open Groceries";
}

function Header({
  widthClass,
  onOpenLocation,
}: {
  widthClass: string;
  onOpenLocation: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { address, cartCount } = useShop();
  const isHome = pathname === "/shop";
  const [q, setQ] = React.useState("");

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const query = q.trim();
    router.push(`/shop/search${query ? `?q=${encodeURIComponent(query)}` : ""}`);
  };

  const label = deliveryLabel(address);
  const hasAddr = !!address?.areaCode;

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-md">
      {/* ===================== Desktop header (unchanged) ===================== */}
      <div
        className={cn(
          "mx-auto hidden h-16 items-center gap-4 px-6 md:flex",
          widthClass
        )}
      >
        {/* Brand */}
        <Link href="/shop" className="flex shrink-0 items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-primary to-blue-500 text-sm font-bold text-primary-foreground">
            OG
          </span>
          <span className="text-base font-semibold tracking-tight">
            Open Groceries
          </span>
        </Link>

        {/* Location selector — desktop */}
        <button
          type="button"
          onClick={onOpenLocation}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-transparent px-2.5 py-1.5 text-left transition-colors hover:bg-accent"
        >
          <MapPin className="h-4 w-4 text-primary" />
          <span className="flex flex-col leading-tight">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Deliver to
            </span>
            <span className="max-w-[160px] truncate text-xs font-semibold">
              {label}
            </span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>

        {/* Inline search — desktop */}
        <form onSubmit={submitSearch} className="flex min-w-0 flex-1">
          <div className="flex w-full items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 transition-colors focus-within:border-primary/40 focus-within:bg-background focus-within:ring-2 focus-within:ring-ring">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search for groceries, brands and more…"
              aria-label="Search products"
              className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        </form>

        {/* Desktop actions */}
        <nav className="flex shrink-0 items-center gap-1">
          <HeaderNavLink
            href="/shop/sellers"
            icon={Store}
            label="Stores"
            active={pathname.startsWith("/shop/sellers")}
          />
          <HeaderNavLink
            href="/shop/orders"
            icon={Package}
            label="Orders"
            active={pathname.startsWith("/shop/orders")}
          />
          <HeaderNavLink
            href="/shop/account"
            icon={User}
            label="Account"
            active={pathname.startsWith("/shop/account")}
          />
          <Link
            href="/shop/cart"
            className="relative ml-1 flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <ShoppingCart className="h-4 w-4" />
            <span>Cart</span>
            {cartCount > 0 ? (
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-background px-1 text-[10px] font-bold text-primary">
                {cartCount}
              </span>
            ) : null}
          </Link>
          <div className="ml-1">
            <ThemeToggle />
          </div>
        </nav>
      </div>

      {/* ============ Mobile header (Blinkit/Zepto app-bar) ============ */}
      <div className={cn("mx-auto flex flex-col md:hidden", widthClass)}>
        <div className="flex h-14 items-center gap-2 px-4">
          {isHome ? (
            // Home: the location selector is the hero of the bar.
            <button
              type="button"
              onClick={onOpenLocation}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                <MapPin className="h-5 w-5" />
              </span>
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="text-[11px] font-medium text-muted-foreground">
                  Delivering to
                </span>
                <span className="flex items-center gap-1 text-sm font-bold">
                  <span className="truncate">
                    {hasAddr ? label : "Select your location"}
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                </span>
              </span>
            </button>
          ) : (
            // Inner pages: back button + contextual title.
            <>
              <button
                onClick={() => router.back()}
                aria-label="Back"
                className="-ml-2 grid h-9 w-9 shrink-0 place-items-center rounded-lg hover:bg-accent"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <span className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">
                {mobileTitle(pathname)}
              </span>
            </>
          )}

          {/* Right cluster: theme + profile */}
          <div className="flex shrink-0 items-center gap-0.5">
            <ThemeToggle />
            <Link
              href="/shop/account"
              aria-label="My account"
              className="grid h-9 w-9 place-items-center rounded-full text-foreground transition-colors hover:bg-accent"
            >
              <User className="h-5 w-5" />
            </Link>
          </div>
        </div>

        {/* Persistent tap-through search (home only — other browse screens
            carry their own input). */}
        {isHome ? (
          <div className="px-4 pb-2.5">
            <Link
              href="/shop/search"
              aria-label="Search products"
              className="flex h-11 items-center gap-2 rounded-xl border border-border bg-muted/50 px-3 text-sm text-muted-foreground transition-colors active:bg-muted"
            >
              <Search className="h-5 w-5 shrink-0 text-primary" />
              <RotatingSearchHint />
            </Link>
          </div>
        ) : null}
      </div>
    </header>
  );
}

function BottomNav() {
  const pathname = usePathname();
  const { cartCount } = useShop();

  return (
    <nav className="sticky bottom-0 z-30 border-t border-border bg-background/90 backdrop-blur-md md:hidden">
      <div className="mx-auto flex max-w-2xl items-stretch justify-around px-2">
        {TABS.map((t) => {
          const active = t.exact
            ? pathname === t.href
            : pathname.startsWith(t.href);
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                "relative flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium transition-colors",
                active ? "text-primary" : "text-muted-foreground"
              )}
            >
              <span className="relative">
                <Icon className="h-5 w-5" />
                {t.badge && cartCount > 0 ? (
                  <span className="absolute -right-2 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                    {cartCount}
                  </span>
                ) : null}
              </span>
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export default function Chrome({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const pathname = usePathname();
  const [locationOpen, setLocationOpen] = React.useState(false);
  const [locationAutoDetect, setLocationAutoDetect] = React.useState(false);

  // Manual opens (header controls) never auto-detect.
  const openLocation = React.useCallback(() => {
    setLocationAutoDetect(false);
    setLocationOpen(true);
  }, []);

  // First-visit prompt: the first time a buyer reaches a discovery surface with
  // no saved location, open the picker once and let it auto-detect (Blinkit
  // style). The localStorage flag makes it strictly once — dismissing doesn't
  // re-nag, and it's still reachable from the header afterwards.
  /* eslint-disable react-hooks/set-state-in-effect */
  React.useEffect(() => {
    const onDiscoveryRoute =
      pathname === "/shop" || (pathname?.startsWith("/shop/search") ?? false);
    if (!onDiscoveryRoute) return;
    if (alreadyPrompted() || savedHasLocation()) return;
    markPrompted();
    setLocationAutoDetect(true);
    setLocationOpen(true);
  }, [pathname]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // The ONDC admin dashboard (/shop/admin) is NOT the buyer app — render it
  // full-bleed with its own styling, without the buyer header / bottom-nav /
  // shop-theme scope.
  if (pathname?.startsWith("/shop/admin")) {
    return <>{children}</>;
  }

  const widthClass = pageWidth(pathname ?? "/shop");
  // Discovery surfaces (home + search + seller storefront) show the floating
  // CartBar; reserve extra bottom room there so the last product row never hides
  // behind it.
  const onDiscovery =
    pathname === "/shop" ||
    (pathname?.startsWith("/shop/search") ?? false) ||
    (pathname?.startsWith("/shop/seller") ?? false);

  return (
    <div
      className={cn(
        "shop-theme flex min-h-dvh flex-col bg-background text-foreground",
        theme === "dark" && "dark"
      )}
    >
      <Header widthClass={widthClass} onOpenLocation={openLocation} />
      <main
        className={cn(
          "mx-auto w-full flex-1 px-4 pt-4 md:px-6 md:pt-6",
          onDiscovery ? "pb-28 md:pb-10" : "pb-8",
          widthClass
        )}
      >
        {children}
      </main>
      <CartBar />
      <BottomNav />
      <LocationSheet
        open={locationOpen}
        autoDetect={locationAutoDetect}
        onOpenChange={(o) => {
          setLocationOpen(o);
          if (!o) setLocationAutoDetect(false);
        }}
      />
    </div>
  );
}
