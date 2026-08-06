// Buyer-app category tiles + departments for the home + search filters.
//
// The app is a MULTI-CATEGORY ONDC storefront (like ONDC Mystore): grocery is the
// primary department, with fashion / beauty / electronics alongside. Each category
// carries the ONDC retail `domain` it discovers in — tapping a fashion tile fires
// a search on ONDC:RET12 so fashion sellers respond, not grocery (ONDC:RET10).
// `query` is the free-text seed we fire as the ONDC search (BPP catalogs vary, so a
// text intent is more reliable than a category id).
//
// Tiles use lucide SVG icons on a soft tinted chip — never emoji (see the no-emoji
// product rule). `tint` carries the Tailwind classes for the icon chip (a low-
// opacity brand-neutral wash + icon colour that reads in light + dark).
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
  Shirt,
  ShoppingBag,
  Baby,
  Footprints,
  Watch,
  Gem,
  Sparkles,
  Palette,
  Scissors,
  Droplet,
  Smartphone,
  Headphones,
  Laptop,
  Plug,
  ShoppingBasket,
} from "lucide-react";

// ONDC retail domain ids used across the app.
export const DOMAIN = {
  grocery: "ONDC:RET10",
  fashion: "ONDC:RET12",
  beauty: "ONDC:RET13",
  electronics: "ONDC:RET14",
} as const;

export type ShopCategory = {
  id: string;
  label: string;
  query: string;
  // The ONDC retail domain this category discovers in. Threaded into the search
  // as `?domain=` so the right sellers answer. Grocery categories omit special
  // handling by using the app's primary domain (ONDC:RET10).
  domain: string;
  Icon: LucideIcon;
  tint: string;
  // Real category photo (Unsplash CDN — hotlink-supported). Rendered on the tile
  // with the lucide `Icon` as the graceful fallback if the image fails to load.
  image: string;
};

// Unsplash sizing params kept small for fast tile loads.
const IMG = "?w=200&q=70&auto=format&fit=crop";

// -- Grocery (ONDC:RET10) — the app's primary department --------------------
export const GROCERY_CATEGORIES: ShopCategory[] = [
  { id: "foodgrains", label: "Foodgrains", query: "rice", domain: DOMAIN.grocery, Icon: Wheat, tint: "bg-amber-500/10 text-amber-600 dark:text-amber-400", image: `https://images.unsplash.com/photo-1586201375761-83865001e31c${IMG}` },
  { id: "vegetables", label: "Fruits & Veg", query: "vegetables", domain: DOMAIN.grocery, Icon: Carrot, tint: "bg-green-500/10 text-green-600 dark:text-green-400", image: `https://images.unsplash.com/photo-1540420773420-3366772f4999${IMG}` },
  { id: "dairy", label: "Dairy & Eggs", query: "milk", domain: DOMAIN.grocery, Icon: Milk, tint: "bg-sky-500/10 text-sky-600 dark:text-sky-400", image: `https://images.unsplash.com/photo-1550583724-b2692b85b150${IMG}` },
  { id: "snacks", label: "Snacks", query: "biscuits", domain: DOMAIN.grocery, Icon: Cookie, tint: "bg-orange-500/10 text-orange-600 dark:text-orange-400", image: `https://images.unsplash.com/photo-1558961363-fa8fdf82db35${IMG}` },
  { id: "beverages", label: "Beverages", query: "juice", domain: DOMAIN.grocery, Icon: CupSoda, tint: "bg-rose-500/10 text-rose-600 dark:text-rose-400", image: `https://images.unsplash.com/photo-1622597467836-f3285f2131b8${IMG}` },
  { id: "masala", label: "Masala", query: "spices", domain: DOMAIN.grocery, Icon: Flame, tint: "bg-red-500/10 text-red-600 dark:text-red-400", image: `https://images.unsplash.com/photo-1596040033229-a9821ebd058d${IMG}` },
  { id: "bakery", label: "Bakery", query: "bread", domain: DOMAIN.grocery, Icon: Croissant, tint: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400", image: `https://images.unsplash.com/photo-1509440159596-0249088772ff${IMG}` },
  { id: "instant", label: "Instant Food", query: "noodles", domain: DOMAIN.grocery, Icon: Soup, tint: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", image: `https://images.unsplash.com/photo-1612929633738-8fe44f7ec841${IMG}` },
  { id: "meat", label: "Meat & Fish", query: "chicken", domain: DOMAIN.grocery, Icon: Drumstick, tint: "bg-pink-500/10 text-pink-600 dark:text-pink-400", image: `https://images.unsplash.com/photo-1604503468506-a8da13d82791${IMG}` },
  { id: "personal", label: "Personal Care", query: "soap", domain: DOMAIN.grocery, Icon: Bath, tint: "bg-violet-500/10 text-violet-600 dark:text-violet-400", image: `https://images.unsplash.com/photo-1556228578-0d85b1a4d571${IMG}` },
  { id: "household", label: "Home & Cleaning", query: "cleaning", domain: DOMAIN.grocery, Icon: SprayCan, tint: "bg-teal-500/10 text-teal-600 dark:text-teal-400", image: `https://images.unsplash.com/photo-1583947215259-38e31be8751f${IMG}` },
  { id: "chocolates", label: "Chocolates", query: "chocolate", domain: DOMAIN.grocery, Icon: Candy, tint: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400", image: `https://images.unsplash.com/photo-1548907040-4baa42d10919${IMG}` },
];

// -- Fashion (ONDC:RET12) ---------------------------------------------------
export const FASHION_CATEGORIES: ShopCategory[] = [
  { id: "mens-wear", label: "Men's Wear", query: "shirt", domain: DOMAIN.fashion, Icon: Shirt, tint: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400", image: `https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf${IMG}` },
  { id: "womens-wear", label: "Women's Wear", query: "dress", domain: DOMAIN.fashion, Icon: ShoppingBag, tint: "bg-rose-500/10 text-rose-600 dark:text-rose-400", image: `https://images.unsplash.com/photo-1490481651871-ab68de25d43d${IMG}` },
  { id: "ethnic", label: "Ethnic Wear", query: "kurta", domain: DOMAIN.fashion, Icon: Gem, tint: "bg-amber-500/10 text-amber-600 dark:text-amber-400", image: `https://images.unsplash.com/photo-1610030469983-98e550d6193c${IMG}` },
  { id: "footwear", label: "Footwear", query: "shoes", domain: DOMAIN.fashion, Icon: Footprints, tint: "bg-slate-500/10 text-slate-600 dark:text-slate-300", image: `https://images.unsplash.com/photo-1542291026-7eec264c27ff${IMG}` },
  { id: "kids-wear", label: "Kids", query: "kids clothing", domain: DOMAIN.fashion, Icon: Baby, tint: "bg-sky-500/10 text-sky-600 dark:text-sky-400", image: `https://images.unsplash.com/photo-1519238263530-99bdd11df2ea${IMG}` },
  { id: "watches", label: "Watches", query: "watch", domain: DOMAIN.fashion, Icon: Watch, tint: "bg-neutral-500/10 text-neutral-700 dark:text-neutral-300", image: `https://images.unsplash.com/photo-1524592094714-0f0654e20314${IMG}` },
];

// -- Beauty & Personal Care (ONDC:RET13) ------------------------------------
export const BEAUTY_CATEGORIES: ShopCategory[] = [
  { id: "skincare", label: "Skincare", query: "moisturiser", domain: DOMAIN.beauty, Icon: Droplet, tint: "bg-pink-500/10 text-pink-600 dark:text-pink-400", image: `https://images.unsplash.com/photo-1556228720-195a672e8a03${IMG}` },
  { id: "makeup", label: "Makeup", query: "lipstick", domain: DOMAIN.beauty, Icon: Palette, tint: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400", image: `https://images.unsplash.com/photo-1596462502278-27bfdc403348${IMG}` },
  { id: "haircare", label: "Hair Care", query: "shampoo", domain: DOMAIN.beauty, Icon: Scissors, tint: "bg-violet-500/10 text-violet-600 dark:text-violet-400", image: `https://images.unsplash.com/photo-1522338242992-e1a54906a8da${IMG}` },
  { id: "fragrance", label: "Fragrance", query: "perfume", domain: DOMAIN.beauty, Icon: Sparkles, tint: "bg-amber-500/10 text-amber-600 dark:text-amber-400", image: `https://images.unsplash.com/photo-1541643600914-78b084683601${IMG}` },
];

// -- Electronics (ONDC:RET14) -----------------------------------------------
export const ELECTRONICS_CATEGORIES: ShopCategory[] = [
  { id: "mobiles", label: "Mobiles", query: "smartphone", domain: DOMAIN.electronics, Icon: Smartphone, tint: "bg-blue-500/10 text-blue-600 dark:text-blue-400", image: `https://images.unsplash.com/photo-1511707171634-5f897ff02aa9${IMG}` },
  { id: "audio", label: "Audio", query: "headphones", domain: DOMAIN.electronics, Icon: Headphones, tint: "bg-purple-500/10 text-purple-600 dark:text-purple-400", image: `https://images.unsplash.com/photo-1505740420928-5e560c06d30e${IMG}` },
  { id: "laptops", label: "Laptops", query: "laptop", domain: DOMAIN.electronics, Icon: Laptop, tint: "bg-slate-500/10 text-slate-600 dark:text-slate-300", image: `https://images.unsplash.com/photo-1496181133206-80ce9b88a853${IMG}` },
  { id: "accessories", label: "Accessories", query: "charger", domain: DOMAIN.electronics, Icon: Plug, tint: "bg-teal-500/10 text-teal-600 dark:text-teal-400", image: `https://images.unsplash.com/photo-1585790050230-5dd28404ccb9${IMG}` },
];

// Backwards-compatible default export used by the home category grid: the primary
// (grocery) department. Other departments render from their own arrays / DEPARTMENTS.
export const CATEGORIES: ShopCategory[] = GROCERY_CATEGORIES;

// A shoppable department — a top-level ONDC retail domain the storefront offers.
// Drives the "Shop by department" switcher on the home screen and the domain a
// department's landing search fires on.
export type Department = {
  id: string;
  label: string;
  domain: string;
  // The seed search a department card fires (a broad, representative query).
  query: string;
  Icon: LucideIcon;
  tint: string;
  categories: ShopCategory[];
};

export const DEPARTMENTS: Department[] = [
  { id: "grocery", label: "Grocery", domain: DOMAIN.grocery, query: "rice", Icon: ShoppingBasket, tint: "bg-green-500/10 text-green-600 dark:text-green-400", categories: GROCERY_CATEGORIES },
  { id: "fashion", label: "Fashion", domain: DOMAIN.fashion, query: "shirt", Icon: Shirt, tint: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400", categories: FASHION_CATEGORIES },
  { id: "beauty", label: "Beauty", domain: DOMAIN.beauty, query: "skincare", Icon: Sparkles, tint: "bg-pink-500/10 text-pink-600 dark:text-pink-400", categories: BEAUTY_CATEGORIES },
  { id: "electronics", label: "Electronics", domain: DOMAIN.electronics, query: "headphones", Icon: Smartphone, tint: "bg-blue-500/10 text-blue-600 dark:text-blue-400", categories: ELECTRONICS_CATEGORIES },
];

// Human label for a domain id (for the search screen's active-department chip).
export function departmentLabel(domain?: string): string | undefined {
  if (!domain) return undefined;
  return DEPARTMENTS.find((d) => d.domain === domain)?.label;
}

// Domains that are actually LIVE on the ONDC network for this subscriber — i.e.
// the subscriber is registered for them AND the gateway accepts their searches.
// A domain the subscriber isn't registered for NACKs at the gateway ("Invalid
// bap_id ... for domain ONDC:RETxx"), so we mark its department "coming soon"
// rather than firing a search that can't succeed. Grocery (RET10) is the
// verified-registered default; as you complete each domain's ONDC registration,
// add it to NEXT_PUBLIC_ONDC_LIVE_DOMAINS (comma-separated), e.g.
// "ONDC:RET10,ONDC:RET12" — no code change or redeploy of logic needed.
const LIVE_DOMAINS: string[] = (
  process.env.NEXT_PUBLIC_ONDC_LIVE_DOMAINS ?? "ONDC:RET10"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Whether a department's domain is live (registered + searchable) right now.
export function isDomainLive(domain: string): boolean {
  return LIVE_DOMAINS.includes(domain);
}
