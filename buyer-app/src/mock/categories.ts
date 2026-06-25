import type { Category } from "@/types";

export const categories: Category[] = [
  { id: "grocery", name: "Grocery", icon: "ShoppingBasket", productCount: 1240 },
  { id: "fresh", name: "Fruits & Veg", icon: "Apple", productCount: 320 },
  { id: "electronics", name: "Electronics", icon: "Smartphone", productCount: 540 },
  { id: "fashion", name: "Fashion", icon: "Shirt", productCount: 890 },
  { id: "beauty", name: "Beauty", icon: "Sparkles", productCount: 430 },
  { id: "home", name: "Home & Kitchen", icon: "Lamp", productCount: 670 },
  { id: "pharmacy", name: "Pharmacy", icon: "Pill", productCount: 210 },
  { id: "food", name: "Food", icon: "UtensilsCrossed", productCount: 1500 },
];

export const featuredCategories: Category[] = [
  { id: "grocery", name: "Daily Grocery", icon: "ShoppingBasket", image: "https://picsum.photos/seed/grocery/400/300" },
  { id: "fresh", name: "Fresh Produce", icon: "Apple", image: "https://picsum.photos/seed/fresh/400/300" },
  { id: "electronics", name: "Electronics", icon: "Smartphone", image: "https://picsum.photos/seed/electronics/400/300" },
  { id: "fashion", name: "Fashion", icon: "Shirt", image: "https://picsum.photos/seed/fashion/400/300" },
  { id: "beauty", name: "Beauty & Care", icon: "Sparkles", image: "https://picsum.photos/seed/beauty/400/300" },
  { id: "home", name: "Home Essentials", icon: "Lamp", image: "https://picsum.photos/seed/home/400/300" },
];

export const recentSearches: string[] = [
  "Atta 5kg",
  "Wireless earbuds",
  "Olive oil",
  "Running shoes",
  "Face wash",
];
