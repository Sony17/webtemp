"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShoppingCart } from "lucide-react";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { SearchBar } from "@/components/SearchBar";
import { DeliveryLocation } from "@/components/DeliveryLocation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useCart } from "@/hooks/use-cart";
import { userProfile } from "@/mock/user";

/** Top navigation bar — shown on all breakpoints, adapts content responsively. */
export function Navbar() {
  const { count } = useCart();
  const pathname = usePathname();
  const hideSearch = pathname === "/" || pathname.startsWith("/search");

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-lg">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
        <div className="lg:hidden">
          <Logo compact />
        </div>

        {/* Desktop: delivery location + search inline */}
        <div className="hidden items-center gap-4 lg:flex">
          <DeliveryLocation />
        </div>

        {!hideSearch && (
          <div className="hidden max-w-xl flex-1 lg:block">
            <SearchBar />
          </div>
        )}

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <ThemeToggle />
          <Link
            href="/cart"
            aria-label="Cart"
            className="relative grid h-10 w-10 place-items-center rounded-lg text-foreground transition-colors hover:bg-secondary"
          >
            <ShoppingCart className="h-5 w-5" />
            {count > 0 && (
              <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground">
                {count}
              </span>
            )}
          </Link>
          <Link href="/profile" aria-label="Profile" className="ml-1">
            <Avatar className="h-9 w-9 border border-border">
              <AvatarImage src={userProfile.avatar} alt={userProfile.name} />
              <AvatarFallback>{userProfile.name.charAt(0)}</AvatarFallback>
            </Avatar>
          </Link>
        </div>
      </div>

      {/* Mobile delivery location row */}
      <div className="flex items-center gap-2 px-4 pb-3 lg:hidden">
        <DeliveryLocation variant="inline" />
      </div>
    </header>
  );
}
