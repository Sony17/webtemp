/**
 * Catalog service — data access layer.
 *
 * Today: returns mock data with a small artificial delay to emulate the async,
 * multi-seller ONDC `on_search` behaviour. Tomorrow: replace each body with a
 * `fetch()` to the OpenIdea ONDC backend. The component layer never changes.
 */
import type { Category, Product, SearchFilters } from "@/types";
import { products, trendingProductIds } from "@/mock/products";
import { categories, featuredCategories, recentSearches } from "@/mock/categories";

const delay = (ms = 250) => new Promise((r) => setTimeout(r, ms));

export async function getCategories(): Promise<Category[]> {
  await delay();
  return categories;
}

export async function getFeaturedCategories(): Promise<Category[]> {
  await delay();
  return featuredCategories;
}

export async function getRecentSearches(): Promise<string[]> {
  return recentSearches;
}

export async function getTrendingProducts(): Promise<Product[]> {
  await delay();
  return trendingProductIds
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is Product => Boolean(p));
}

export async function getProductById(id: string): Promise<Product | null> {
  await delay();
  return products.find((p) => p.id === id) ?? null;
}

export async function getRelatedProducts(product: Product): Promise<Product[]> {
  await delay();
  return products.filter((p) => p.categoryId === product.categoryId && p.id !== product.id).slice(0, 6);
}

/** Emulates ONDC search → on_search with client-side filtering & sorting. */
export async function searchProducts(
  query: string,
  filters: SearchFilters = {}
): Promise<Product[]> {
  await delay(400);
  const q = query.trim().toLowerCase();

  let results = products.filter((p) => {
    if (!q) return true;
    return (
      p.title.toLowerCase().includes(q) ||
      p.brand?.toLowerCase().includes(q) ||
      p.categoryId.toLowerCase().includes(q) ||
      p.tags?.some((t) => t.toLowerCase().includes(q))
    );
  });

  if (filters.maxPrice != null) {
    results = results.filter((p) => p.startingPrice <= filters.maxPrice!);
  }
  if (filters.minRating != null) {
    results = results.filter((p) => p.rating >= filters.minRating!);
  }
  if (filters.maxEtaMins != null) {
    results = results.filter((p) =>
      p.sellers.some((s) => s.etaMinMins <= filters.maxEtaMins!)
    );
  }

  switch (filters.sort) {
    case "price_low":
      results = [...results].sort((a, b) => a.startingPrice - b.startingPrice);
      break;
    case "price_high":
      results = [...results].sort((a, b) => b.startingPrice - a.startingPrice);
      break;
    case "rating":
      results = [...results].sort((a, b) => b.rating - a.rating);
      break;
    case "fastest":
      results = [...results].sort(
        (a, b) =>
          Math.min(...a.sellers.map((s) => s.etaMinMins)) -
          Math.min(...b.sellers.map((s) => s.etaMinMins))
      );
      break;
  }

  return results;
}

export async function getProductsByCategory(categoryId: string): Promise<Product[]> {
  await delay();
  return products.filter((p) => p.categoryId === categoryId);
}
