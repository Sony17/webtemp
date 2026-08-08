// ONDC discovery SWEEP — scheduled full-catalog bootstrap across cities.
//
// WHY. Live search is roulette: only the BPPs that answer within the buyer's
// wait window contribute results, most sellers ignore the keyword and dump
// whole catalogs, and the biggest BPP may simply not respond that minute (a
// Noida "rice" search returned 2 false-positive snacks from Ahmedabad). The
// durable fix is to ACCUMULATE catalogs ahead of time: broadcast an
// unqualified full-catalog search (`fullCatalog: true` — ONDC "search by
// city") per city on a schedule, and let the on_search callbacks fill the
// store. The seller directory and seller storefront pages read the
// accumulated store, so coverage compounds with every sweep.
//
//   GET  /api/ondc/discovery-sweep            — cron entry (vercel.json)
//   POST /api/ondc/discovery-sweep            — manual { "cities": ["std:011"] }
//
// AUTH. Not public — each sweep call broadcasts real searches to the live
// network. Accepted callers:
//   * Authorization: Bearer <ADMIN_TOKEN>  (admin / manual)
//   * Authorization: Bearer <CRON_SECRET>  (Vercel cron sends this header
//     automatically when the CRON_SECRET env var is set)
//   * the admin console session cookie
//
// CITIES. Default list = ONDC STD codes where this BAP has seen or expects
// sellers; override per-call (POST body) or via ONDC_SWEEP_CITIES env
// (comma-separated). Capped to avoid flooding the gateway; requests go out
// sequentially with a courtesy gap.
//
// Each city fires through our own /api/ondc/search route (self-fetch) so the
// sweep shares ONE code path with every other search: validation, context
// build, signing, audit trail, negative caching.
import { NextResponse } from "next/server";
import { requireAdmin, safeEqual } from "@/lib/admin/auth";
import { isOndcConfigured } from "@/lib/ondc/config";

export const runtime = "nodejs";
// Sequential broadcasts with gaps can exceed the default budget.
export const maxDuration = 60;

const DEFAULT_CITIES = [
  "std:011", // Delhi
  "std:0120", // Noida / Ghaziabad belt
  "std:080", // Bengaluru
  "std:022", // Mumbai
  "std:020", // Pune
  "std:044", // Chennai
  "std:079", // Ahmedabad
  "std:040", // Hyderabad
];

// Hard cap per invocation — a sweep is a broadcast storm if unbounded.
const MAX_CITIES = 12;
const GAP_MS = 1200;

function sweepCities(): string[] {
  const env = process.env.ONDC_SWEEP_CITIES?.trim();
  if (!env) return DEFAULT_CITIES;
  return env
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

// Vercel cron authenticates with `Authorization: Bearer ${CRON_SECRET}` when
// that env var is set. Manual/admin callers pass the ADMIN_TOKEN gate.
function authorize(req: Request): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authHeader = req.headers.get("authorization");
  if (cronSecret && authHeader?.startsWith("Bearer ")) {
    if (safeEqual(authHeader.slice(7).trim(), cronSecret)) return null;
  }
  return requireAdmin(req);
}

async function runSweep(req: Request, cities: string[]) {
  if (!isOndcConfigured()) {
    return NextResponse.json({ error: "BAP not configured." }, { status: 503 });
  }

  const capped = cities.slice(0, MAX_CITIES);
  const origin = new URL(req.url).origin;
  const results: Array<{ city: string; status: string; transactionId?: string; error?: string }> = [];

  for (const city of capped) {
    try {
      const res = await fetch(`${origin}/api/ondc/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullCatalog: true, city }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        status?: string;
        transactionId?: string;
        error?: string;
      };
      results.push({
        city,
        status: body.status ?? `http ${res.status}`,
        transactionId: body.transactionId,
        error: body.error,
      });
    } catch (err) {
      results.push({
        city,
        status: "transport-error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
    // Courtesy gap between broadcasts — the gateway fans each one out to the
    // whole network; do not machine-gun it.
    await new Promise((r) => setTimeout(r, GAP_MS));
  }

  const acked = results.filter((r) => r.status === "ACK").length;
  console.log("ondc.discovery-sweep done", {
    cities: capped.length,
    acked,
    dropped: cities.length - capped.length,
  });

  return NextResponse.json({
    swept: capped.length,
    acked,
    // Cities beyond MAX_CITIES are dropped loudly, not silently.
    dropped: cities.length > MAX_CITIES ? cities.slice(MAX_CITIES) : [],
    results,
  });
}

export async function GET(req: Request) {
  const denied = authorize(req);
  if (denied) return denied;
  return runSweep(req, sweepCities());
}

export async function POST(req: Request) {
  const denied = authorize(req);
  if (denied) return denied;

  let cities = sweepCities();
  try {
    const body = (await req.json()) as { cities?: unknown };
    if (Array.isArray(body.cities) && body.cities.length > 0) {
      cities = body.cities.filter((c): c is string => typeof c === "string");
    }
  } catch {
    // empty body → default cities
  }
  return runSweep(req, cities);
}
