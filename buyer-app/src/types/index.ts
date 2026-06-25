/**
 * Shared domain types for the OpenIdea ONDC Buyer App.
 * Loosely aligned to ONDC Retail concepts (catalog item, provider/seller, order).
 * These are UI types — the wire format from the backend can be mapped into these
 * inside the service layer (`src/services/*`).
 */

export interface Category {
  id: string;
  name: string;
  icon: string; // lucide icon name
  image?: string;
  productCount?: number;
}

export interface Seller {
  id: string;
  name: string;
  /** ONDC provider id, kept for future wiring. */
  providerId?: string;
  logo?: string;
  rating: number;
  ratingCount: number;
  /** delivery ETA range in minutes */
  etaMinMins: number;
  etaMaxMins: number;
  /** indicative price for the product at this seller */
  price: number;
  /** optional struck-through MRP */
  mrp?: number;
  deliveryFee: number;
  freeDeliveryAbove?: number;
  distanceKm?: number;
  isFastest?: boolean;
  isCheapest?: boolean;
}

export interface Product {
  id: string;
  title: string;
  brand?: string;
  description: string;
  categoryId: string;
  images: string[];
  rating: number;
  ratingCount: number;
  /** lowest indicative price across sellers */
  startingPrice: number;
  mrp?: number;
  unit?: string; // "500 g", "1 L"
  /** sellers offering this product (multi-seller rollup) */
  sellers: Seller[];
  tags?: string[];
  inStock: boolean;
}

export interface CartLine {
  productId: string;
  product: Product;
  sellerId: string;
  seller: Seller;
  quantity: number;
}

export interface Address {
  id: string;
  label: string; // "Home", "Work"
  name: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
  isDefault?: boolean;
}

export interface PaymentMethod {
  id: string;
  type: "upi" | "card" | "cod" | "netbanking";
  label: string;
  detail: string; // masked
  isDefault?: boolean;
}

export type OrderStatus =
  | "confirmed"
  | "packed"
  | "shipped"
  | "out_for_delivery"
  | "delivered"
  | "cancelled";

export interface OrderTimelineStep {
  status: OrderStatus | "placed";
  label: string;
  /** ISO timestamp, undefined if not yet reached */
  timestamp?: string;
  description?: string;
}

export interface PriceBreakup {
  /** Sum of MRP across items (optional; derived as itemTotal + discount when absent). */
  mrpTotal?: number;
  /** Net selling subtotal (sum of selling prices × qty). */
  itemTotal: number;
  discount: number;
  deliveryFee: number;
  /** Optional platform/handling fee. */
  platformFee?: number;
  taxes: number;
  total: number;
}

export interface OrderItem {
  productId: string;
  title: string;
  image: string;
  unit?: string;
  price: number;
  quantity: number;
}

export interface Order {
  id: string;
  /** ONDC transaction id, kept for future wiring. */
  transactionId?: string;
  createdAt: string;
  status: OrderStatus;
  seller: Pick<Seller, "id" | "name" | "logo" | "rating">;
  items: OrderItem[];
  breakup: PriceBreakup;
  address: Address;
  payment: { method: string; status: "paid" | "pending"; detail?: string };
  timeline: OrderTimelineStep[];
  etaText?: string;
  trackingUrl?: string;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  avatar?: string;
  addresses: Address[];
  payments: PaymentMethod[];
  notifications: {
    orderUpdates: boolean;
    offers: boolean;
    recommendations: boolean;
  };
}

export interface SearchFilters {
  maxPrice?: number;
  maxEtaMins?: number;
  minRating?: number;
  sort?: "relevance" | "price_low" | "price_high" | "rating" | "fastest";
}
