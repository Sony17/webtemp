// ONDC RET10 (Grocery) category tiles for the buyer-app home + search filters.
// `query` is the free-text seed we fire as an ONDC search when a tile is tapped
// (BPP catalogs vary, so a text intent is more reliable than a category id).
//
// Tiles use lucide SVG icons on a soft tinted chip — never emoji (see the
// no-emoji product rule). `tint` carries the Tailwind classes for the icon chip
// (a low-opacity brand-neutral wash + icon colour that reads in light + dark).
import type { LucideIcon } from "lucide-react";
import {
  Wheat,
  Carrot,
  Milk,
  Cookie,
  CupSoda,
  Flame,
  Croissant,
  Soup,
  Drumstick,
  Bath,
  SprayCan,
  Candy,
} from "lucide-react";

export type ShopCategory = {
  id: string;
  label: string;
  query: string;
  Icon: LucideIcon;
  tint: string;
};

export const CATEGORIES: ShopCategory[] = [
  { id: "foodgrains", label: "Foodgrains", query: "rice", Icon: Wheat, tint: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  { id: "vegetables", label: "Fruits & Veg", query: "vegetables", Icon: Carrot, tint: "bg-green-500/10 text-green-600 dark:text-green-400" },
  { id: "dairy", label: "Dairy & Eggs", query: "milk", Icon: Milk, tint: "bg-sky-500/10 text-sky-600 dark:text-sky-400" },
  { id: "snacks", label: "Snacks", query: "biscuits", Icon: Cookie, tint: "bg-orange-500/10 text-orange-600 dark:text-orange-400" },
  { id: "beverages", label: "Beverages", query: "juice", Icon: CupSoda, tint: "bg-rose-500/10 text-rose-600 dark:text-rose-400" },
  { id: "masala", label: "Masala", query: "spices", Icon: Flame, tint: "bg-red-500/10 text-red-600 dark:text-red-400" },
  { id: "bakery", label: "Bakery", query: "bread", Icon: Croissant, tint: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400" },
  { id: "instant", label: "Instant Food", query: "noodles", Icon: Soup, tint: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  { id: "meat", label: "Meat & Fish", query: "chicken", Icon: Drumstick, tint: "bg-pink-500/10 text-pink-600 dark:text-pink-400" },
  { id: "personal", label: "Personal Care", query: "soap", Icon: Bath, tint: "bg-violet-500/10 text-violet-600 dark:text-violet-400" },
  { id: "household", label: "Home & Cleaning", query: "cleaning", Icon: SprayCan, tint: "bg-teal-500/10 text-teal-600 dark:text-teal-400" },
  { id: "chocolates", label: "Chocolates", query: "chocolate", Icon: Candy, tint: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400" },
];
