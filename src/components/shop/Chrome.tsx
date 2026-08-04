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
} from "lucide-react";
import { cn } from "@/lib/shop/cn";
import { useShop } from "@/lib/shop/store";
import { useTheme } from "@/lib/shop/theme";
import { ThemeToggle } from "@/components/shop/ThemeToggle";

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
    pathname.startsWith("/shop/orders");
  return wide ? "max-w-6xl" : "max-w-2xl";
}

function deliveryLabel(address: ReturnType<typeof useShop>["address"]) {
  return address?.areaCode
    ? `${address.locality ?? address.city ?? ""} ${address.areaCode}`.trim()
    : "Set location";
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

function Header({ widthClass }: { widthClass: string }) {
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

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
      <div
        className={cn(
          "mx-auto flex h-14 items-center gap-3 px-4 md:h-16 md:gap-4 md:px-6",
          widthClass
        )}
      >
        {/* Mobile back button (non-home) */}
        {!isHome ? (
          <button
            onClick={() => router.back()}
            aria-label="Back"
            className="-ml-2 grid h-9 w-9 place-items-center rounded-lg hover:bg-accent md:hidden"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        ) : null}

        {/* Brand */}
        <Link href="/shop" className="flex shrink-0 items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-primary to-blue-500 text-sm font-bold text-primary-foreground">
            OG
          </span>
          <span className="hidden text-base font-semibold tracking-tight sm:inline">
            Open Groceries
          </span>
        </Link>

        {/* Location selector — desktop */}
        <button
          type="button"
          className="hidden shrink-0 items-center gap-1.5 rounded-lg border border-transparent px-2.5 py-1.5 text-left transition-colors hover:bg-accent md:flex"
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
        <form onSubmit={submitSearch} className="hidden min-w-0 flex-1 md:flex">
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
        <nav className="hidden shrink-0 items-center gap-1 md:flex">
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

        {/* Mobile right cluster */}
        <div className="ml-auto flex items-center gap-2 md:hidden">
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Deliver to
            </p>
            <p className="max-w-[120px] truncate text-xs font-medium">{label}</p>
          </div>
          <ThemeToggle />
        </div>
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

  // The ONDC admin dashboard (/shop/admin) is NOT the buyer app — render it
  // full-bleed with its own styling, without the buyer header / bottom-nav /
  // shop-theme scope.
  if (pathname?.startsWith("/shop/admin")) {
    return <>{children}</>;
  }

  const widthClass = pageWidth(pathname ?? "/shop");

  return (
    <div
      className={cn(
        "shop-theme flex min-h-dvh flex-col bg-background text-foreground",
        theme === "dark" && "dark"
      )}
    >
      <Header widthClass={widthClass} />
      <main
        className={cn(
          "mx-auto w-full flex-1 px-4 pb-8 pt-4 md:px-6 md:pt-6",
          widthClass
        )}
      >
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
