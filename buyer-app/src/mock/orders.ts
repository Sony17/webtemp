import type { Order, OrderTimelineStep } from "@/types";
import { addresses } from "./user";

function timeline(reached: number, base: string): OrderTimelineStep[] {
  const steps: OrderTimelineStep[] = [
    { status: "placed", label: "Order Placed", description: "We've received your order" },
    { status: "confirmed", label: "Confirmed", description: "Seller accepted your order" },
    { status: "packed", label: "Packed", description: "Your items are packed" },
    { status: "shipped", label: "Shipped", description: "Out from the seller" },
    { status: "out_for_delivery", label: "Out for Delivery", description: "Arriving soon" },
    { status: "delivered", label: "Delivered", description: "Order delivered" },
  ];
  const start = new Date(base).getTime();
  return steps.map((s, i) => ({
    ...s,
    timestamp: i <= reached ? new Date(start + i * 18 * 60 * 1000).toISOString() : undefined,
  }));
}

export const orders: Order[] = [
  {
    id: "OID-2026-10241",
    transactionId: "txn-9f2a1c7e",
    createdAt: "2026-06-24T10:12:00.000Z",
    status: "out_for_delivery",
    seller: { id: "freshmart", name: "FreshMart", logo: "https://picsum.photos/seed/freshmart/80/80", rating: 4.6 },
    items: [
      { productId: "aashirvaad-atta-5kg", title: "Aashirvaad Whole Wheat Atta", image: "https://picsum.photos/seed/atta-0/200/200", unit: "5 kg", price: 249, quantity: 1 },
      { productId: "amul-butter-500g", title: "Amul Butter Pasteurised", image: "https://picsum.photos/seed/butter-0/200/200", unit: "500 g", price: 265, quantity: 2 },
    ],
    breakup: { mrpTotal: 819, itemTotal: 779, discount: 40, deliveryFee: 0, taxes: 12, total: 791 },
    address: addresses[0],
    payment: { method: "UPI", status: "paid", detail: "aarav@okhdfcbank" },
    timeline: timeline(4, "2026-06-24T10:12:00.000Z"),
    etaText: "Arriving by 4:30 PM today",
    // No live tracking URL in the mock — the UI links to the in-page status timeline.
  },
  {
    id: "OID-2026-10198",
    transactionId: "txn-4b8d2e11",
    createdAt: "2026-06-21T16:40:00.000Z",
    status: "delivered",
    seller: { id: "techhub", name: "TechHub Electronics", logo: "https://picsum.photos/seed/techhub/80/80", rating: 4.4 },
    items: [
      { productId: "boat-airdopes", title: "boAt Airdopes 141 Wireless Earbuds", image: "https://picsum.photos/seed/earbuds-0/200/200", unit: "1 unit", price: 1099, quantity: 1 },
    ],
    breakup: { itemTotal: 1099, deliveryFee: 0, taxes: 0, discount: 0, total: 1099 },
    address: addresses[0],
    payment: { method: "HDFC Credit Card", status: "paid", detail: "•••• 4242" },
    timeline: timeline(5, "2026-06-21T16:40:00.000Z"),
    etaText: "Delivered on 22 Jun",
  },
  {
    id: "OID-2026-10155",
    transactionId: "txn-77c0aa93",
    createdAt: "2026-06-18T09:05:00.000Z",
    status: "delivered",
    seller: { id: "glowbeauty", name: "Glow Beauty", logo: "https://picsum.photos/seed/glowbeauty/80/80", rating: 4.7 },
    items: [
      { productId: "cetaphil-cleanser", title: "Cetaphil Gentle Skin Cleanser", image: "https://picsum.photos/seed/cleanser-0/200/200", unit: "250 ml", price: 449, quantity: 1 },
      { productId: "dove-soap", title: "Dove Cream Beauty Bathing Bar (Pack of 4)", image: "https://picsum.photos/seed/soap-0/200/200", unit: "4 × 100 g", price: 220, quantity: 1 },
    ],
    breakup: { itemTotal: 669, deliveryFee: 25, taxes: 8, discount: 0, total: 702 },
    address: addresses[1],
    payment: { method: "UPI", status: "paid", detail: "aarav@okhdfcbank" },
    timeline: timeline(5, "2026-06-18T09:05:00.000Z"),
    etaText: "Delivered on 18 Jun",
  },
  {
    id: "OID-2026-10090",
    transactionId: "txn-1a2b3c4d",
    createdAt: "2026-06-10T13:22:00.000Z",
    status: "cancelled",
    seller: { id: "sportsworld", name: "Sports World", logo: "https://picsum.photos/seed/sportsworld/80/80", rating: 4.5 },
    items: [
      { productId: "nike-revolution", title: "Nike Revolution 7 Running Shoes", image: "https://picsum.photos/seed/shoes-0/200/200", unit: "1 pair", price: 3295, quantity: 1 },
    ],
    breakup: { itemTotal: 3295, deliveryFee: 0, taxes: 0, discount: 0, total: 3295 },
    address: addresses[0],
    payment: { method: "UPI", status: "pending", detail: "Refund initiated" },
    timeline: [
      { status: "placed", label: "Order Placed", description: "We've received your order", timestamp: "2026-06-10T13:22:00.000Z" },
      { status: "confirmed", label: "Confirmed", description: "Seller accepted your order", timestamp: "2026-06-10T13:30:00.000Z" },
      { status: "cancelled", label: "Cancelled", description: "Cancelled on request — refund initiated", timestamp: "2026-06-10T14:05:00.000Z" },
    ],
    etaText: "Cancelled",
  },
];
