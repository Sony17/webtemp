"use client";

// Buyer-app chrome: top app bar + bottom tab navigation (mobile-first, matching
// the approved buyer-app shell). Wraps page content and shows the live cart
// badge from the shop store.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Home,
  Search,
  ShoppingCart,
  Package,
  User,
  ChevronLeft,
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

function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const { address } = useShop();
  const isHome = pathname === "/shop";

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-2xl items-center gap-3 px-4">
        {!isHome ? (
          <button
            onClick={() => router.back()}
            aria-label="Back"
            className="-ml-2 grid h-9 w-9 place-items-center rounded-lg hover:bg-accent"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        ) : null}
        <Link href="/shop" className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-primary to-blue-500 text-sm font-bold text-primary-foreground">
            OI
          </span>
          <span className="text-base font-semibold tracking-tight">
            OpenIdea
          </span>
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Deliver to
            </p>
            <p className="max-w-[140px] truncate text-xs font-medium">
              {address?.areaCode
                ? `${address.locality ?? address.city ?? ""} ${address.areaCode}`.trim()
                : "Set location"}
            </p>
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
    <nav className="sticky bottom-0 z-30 border-t border-border bg-background/90 backdrop-blur-md">
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
  return (
    <div
      className={cn(
        "shop-theme flex min-h-dvh flex-col bg-background text-foreground",
        theme === "dark" && "dark"
      )}
    >
      <Header />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-6 pt-4">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
