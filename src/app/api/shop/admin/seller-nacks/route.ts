// ONDC admin — sellers that have REJECTED orders (NACKed select / init / confirm).
//
//   GET /api/shop/admin/seller-nacks
//     → { sellers: [{ bppId, providerId?, name?, total, byAction, lastAt,
//                     lastCode, lastMessage, lastAction }], count }
//
// A NACK is a valid protocol outcome — the seller synchronously refused the
// order (not serviceable, item gone, mis-versioned, bad location id, …). It's
// also the exact reason a checkout dead-ends, so the outbound routes record each
// one to the durable audit log (recordOutboundNack). This rolls those events up
// by (bppId, providerId) so an operator can see WHICH sellers fail, HOW OFTEN,
// and with WHAT error — the input to a fix or a denylist decision.
//
// Reads the audit ring (most-recent-first, capped at RING_CAPACITY); enriches
// each seller with its display name from the stored catalogs (parseProviders).
// Ungated server-side, matching the app's admin posture — /shop/admin guards
// client-side via the admin login.
import { NextResponse } from "next/server";
import { readAuditEvents } from "@/lib/ondc/audit";
import * as store from "@/lib/ondc/store";
import { parseProviders } from "@/lib/shop/types";

export const runtime = "nodejs";

// The BAP-initiated actions whose NACKs mean "this seller refused an order".
// Inbound on_* callbacks are excluded — a NACK we *send* isn't a seller fault.
const OUTBOUND_ACTIONS = new Set(["select", "init", "confirm"]);

type SellerNackRow = {
  bppId: string;
  providerId?: string;
  name?: string;
  total: number;
  byAction: Record<string, number>;
  lastAt: string;
  lastAction: string;
  lastCode?: string;
  lastMessage?: string;
};

// Pull a human-readable error message out of the recorded NACK envelope. We
// stored `result.error` verbatim as responseBody, so its `.message` is the
// seller's own wording when it sent one.
function errMessage(responseBody: unknown): string | undefined {
  const e = responseBody as { message?: unknown } | null | undefined;
  return typeof e?.message === "string" ? e.message : undefined;
}

export async function GET() {
  // Ring is capped (RING_CAPACITY); pull the max so a busy day of callbacks
  // doesn't crowd out older NACKs before we aggregate.
  const events = await readAuditEvents({ limit: 2000 });

  // Name lookup by bppId — a BPP's providers share the bpp_id, so index the most
  // recent display name we've seen per (bppId, providerId).
  const catalogs = await store.listCatalogs();
  const nameByKey = new Map<string, string>();
  for (const s of parseProviders(catalogs)) {
    nameByKey.set(`${s.bppId}|${s.providerId}`, s.name);
  }

  // Aggregate NACKs by seller. `events` is newest-first, so the FIRST event we
  // see for a key is its most recent — captured as last* fields.
  const byKey = new Map<string, SellerNackRow>();
  for (const ev of events) {
    if (ev.ackStatus !== "NACK") continue;
    if (!OUTBOUND_ACTIONS.has(ev.action)) continue;
    const bppId = ev.bppId;
    if (!bppId) continue;
    const providerId = ev.providerId;
    const key = `${bppId}|${providerId ?? ""}`;

    const existing = byKey.get(key);
    if (existing) {
      existing.total += 1;
      existing.byAction[ev.action] = (existing.byAction[ev.action] ?? 0) + 1;
    } else {
      byKey.set(key, {
        bppId,
        providerId,
        name: providerId ? nameByKey.get(`${bppId}|${providerId}`) : undefined,
        total: 1,
        byAction: { [ev.action]: 1 },
        // Newest-first iteration → these come from the most recent NACK.
        lastAt: ev.ts,
        lastAction: ev.action,
        lastCode: ev.errorCode,
        lastMessage: errMessage(ev.responseBody),
      });
    }
  }

  const sellers = [...byKey.values()].sort((a, b) => b.total - a.total);
  return NextResponse.json(
    { sellers, count: sellers.length },
    { headers: { "Cache-Control": "no-store" } }
  );
}
