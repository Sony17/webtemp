/** Standalone seller directory for the "Recommended sellers" home section (UI-only mock). */
export interface FeaturedSeller {
  id: string;
  name: string;
  logo: string;
  cover: string;
  rating: number;
  ratingCount: number;
  category: string;
  etaText: string;
  tagline: string;
}

export const featuredSellers: FeaturedSeller[] = [
  {
    id: "freshmart",
    name: "FreshMart",
    logo: "https://picsum.photos/seed/freshmart/80/80",
    cover: "https://picsum.photos/seed/freshmart-cover/600/300",
    rating: 4.6,
    ratingCount: 12400,
    category: "Grocery & Daily",
    etaText: "20–30 min",
    tagline: "Daily essentials, delivered fast",
  },
  {
    id: "techhub",
    name: "TechHub Electronics",
    logo: "https://picsum.photos/seed/techhub/80/80",
    cover: "https://picsum.photos/seed/techhub-cover/600/300",
    rating: 4.4,
    ratingCount: 8900,
    category: "Electronics",
    etaText: "1–2 hr",
    tagline: "Gadgets at the best network prices",
  },
  {
    id: "glowbeauty",
    name: "Glow Beauty",
    logo: "https://picsum.photos/seed/glowbeauty/80/80",
    cover: "https://picsum.photos/seed/glow-cover/600/300",
    rating: 4.7,
    ratingCount: 6300,
    category: "Beauty & Care",
    etaText: "40–70 min",
    tagline: "Dermatologist-loved skincare",
  },
  {
    id: "sportsworld",
    name: "Sports World",
    logo: "https://picsum.photos/seed/sportsworld/80/80",
    cover: "https://picsum.photos/seed/sports-cover/600/300",
    rating: 4.5,
    ratingCount: 4100,
    category: "Fashion & Sports",
    etaText: "2–4 hr",
    tagline: "Gear up for every move",
  },
  {
    id: "homeessentials",
    name: "Home Essentials",
    logo: "https://picsum.photos/seed/homeessentials/80/80",
    cover: "https://picsum.photos/seed/home-cover/600/300",
    rating: 4.3,
    ratingCount: 3200,
    category: "Home & Kitchen",
    etaText: "3–6 hr",
    tagline: "Everything for a better home",
  },
];

export const popularSearches: string[] = [
  "Atta",
  "Cooking oil",
  "Earbuds",
  "Face wash",
  "Running shoes",
  "Tea",
  "Smartphone",
  "Butter",
];
