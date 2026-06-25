/**
 * Orders service — data access layer (mock today, API tomorrow).
 * Maps to ONDC confirm/on_confirm, status/on_status, track/on_track.
 */
import type { Order } from "@/types";
import { orders } from "@/mock/orders";

const delay = (ms = 250) => new Promise((r) => setTimeout(r, ms));

export async function getOrders(): Promise<Order[]> {
  await delay();
  return [...orders].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export async function getCurrentOrders(): Promise<Order[]> {
  const all = await getOrders();
  return all.filter((o) => o.status !== "delivered" && o.status !== "cancelled");
}

export async function getPastOrders(): Promise<Order[]> {
  const all = await getOrders();
  return all.filter((o) => o.status === "delivered" || o.status === "cancelled");
}

export async function getOrderById(id: string): Promise<Order | null> {
  await delay();
  return orders.find((o) => o.id === id) ?? null;
}
