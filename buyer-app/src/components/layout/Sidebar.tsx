"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Logo } from "./Logo";
import { navItems, isActive } from "./nav-items";
import { useCart } from "@/hooks/use-cart";
import { cn } from "@/lib/utils";

/** Desktop sidebar navigation. Hidden below lg. */
export function Sidebar() {
  const pathname = usePathname();
  const { count } = useCart();

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-card/40 px-4 py-6 lg:flex">
      <div className="px-2">
        <Logo />
      </div>

      <nav className="mt-8 flex flex-1 flex-col gap-1">
        {navItems.map((item) => {
          const active = isActive(item, pathname);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              {active && (
                <motion.span
                  layoutId="sidebar-active"
                  className="absolute inset-0 -z-10 rounded-xl bg-primary shadow-soft"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
              <Icon className="h-5 w-5" />
              <span className="flex-1">{item.label}</span>
              {item.badge === "cart" && count > 0 && (
                <span
                  className={cn(
                    "grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-semibold",
                    active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-primary text-primary-foreground"
                  )}
                >
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="rounded-xl border border-border bg-accent/30 p-4 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Powered by ONDC</p>
        <p className="mt-1">Shop across thousands of sellers on the open network.</p>
      </div>
    </aside>
  );
}
