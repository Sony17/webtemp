import { Home, Search, ClipboardList, ShoppingCart, User, type LucideIcon } from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** badge key resolved at render time (e.g. cart count) */
  badge?: "cart";
  /** prefixes that should mark this item active */
  match?: string[];
}

export const navItems: NavItem[] = [
  { label: "Home", href: "/", icon: Home, match: ["/"] },
  { label: "Search", href: "/search", icon: Search, match: ["/search", "/product"] },
  { label: "Orders", href: "/orders", icon: ClipboardList, match: ["/orders"] },
  { label: "Cart", href: "/cart", icon: ShoppingCart, badge: "cart", match: ["/cart", "/checkout"] },
  { label: "Profile", href: "/profile", icon: User, match: ["/profile"] },
];

export function isActive(item: NavItem, pathname: string): boolean {
  if (item.href === "/") return pathname === "/";
  return (item.match ?? [item.href]).some(
    (m) => pathname === m || pathname.startsWith(`${m}/`)
  );
}
