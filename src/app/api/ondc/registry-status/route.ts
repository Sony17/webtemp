// ONDC registry self-status — diagnostic endpoint (Phase 1: raw read only).
//
// A manual, read-only probe: GET this route and it asks the ONDC registry what
// it holds for OUR configured subscriber_id on the currently-configured network
// (ONDC_ENV → staging / preprod / prod). It returns the registry's RAW response
// plus basic call metadata. It does NOT yet derive a SUBSCRIBED verdict or
// compare keys — those are deliberate follow-ups (see registry-diagnostics.ts).
//
// This route touches NO transaction flow: it neither signs nor sends an ONDC
// action, and it reuses only getOndcConfig() + the standalone lookupSubscriber()
// diagnostic helper.
//
// Mirrors the conventions of the existing ONDC routes: `NextResponse`,
// `runtime = "nodejs"`, and the isOndcConfigured() 503 guard.
import { NextResponse } from "next/server";
import { isOndcConfigured } from "@/lib/ondc/config";
import { lookupSubscriber } from "@/lib/ondc/registry-diagnostics";

// The ondc/* stack is `import "server-only"` and signs/hashes via node:crypto —
// so, like every other ONDC route here, this must run on the Node runtime.
export const runtime = "nodejs";

// GET /api/ondc/registry-status[?subscriberId=<other-id>]
//
// Optional `subscriberId` query param inspects another participant; omit it to
// probe ourselves (the default and primary use).
export async function GET(req: Request) {
  // Fail fast and clearly when ONDC credentials aren't set up, rather than deep
  // inside config validation. isOndcConfigured() returns false only for "not set
  // up yet"; a present-but-INVALID config rethrows and surfaces as the 500 below.
  if (!isOndcConfigured()) {
    return NextResponse.json(
      { error: "ONDC is not configured on this server." },
      { status: 503 }
    );
  }

  const url = new URL(req.url);
  const subscriberId = url.searchParams.get("subscriberId") ?? undefined;

  try {
    const result = await lookupSubscriber(subscriberId);

    // This is a diagnostic: a non-2xx registry reply (or "no record") is a valid
    // ANSWER, not an HTTP error of OUR endpoint. So we return 200 and let the
    // body carry the registry's httpStatus / raw payload. Only a fetch that
    // never reached the registry (no HTTP response) maps to 502 — a genuine
    // transport failure the operator must investigate.
    if (result.httpStatus === null) {
      return NextResponse.json(result, { status: 502 });
    }

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    // An unexpected fault (e.g. OndcConfigError from a present-but-invalid
    // config) — a real server-side problem the operator must fix.
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
