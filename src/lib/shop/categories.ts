// ONDC RET10 (Grocery) category tiles for the buyer-app home + search filters.
// `query` is the free-text seed we fire as an ONDC search when a tile is tapped
// (BPP catalogs vary, so a text intent is more reliable than a category id).
export type ShopCategory = {
  id: string;
  label: string;
  emoji: string;
  query: string;
};

export const CATEGORIES: ShopCategory[] = [
  { id: "foodgrains", label: "Foodgrains", emoji: "🌾", query: "rice" },
  { id: "vegetables", label: "Fruits & Veg", emoji: "🥦", query: "vegetables" },
  { id: "dairy", label: "Dairy", emoji: "🥛", query: "milk" },
  { id: "snacks", label: "Snacks", emoji: "🍪", query: "biscuits" },
  { id: "beverages", label: "Beverages", emoji: "🧃", query: "juice" },
  { id: "masala", label: "Masala", emoji: "🌶️", query: "spices" },
  { id: "personal", label: "Personal Care", emoji: "🧴", query: "soap" },
  { id: "household", label: "Household", emoji: "🧹", query: "cleaning" },
];
