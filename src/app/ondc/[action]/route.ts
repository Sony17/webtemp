// ONDC callback fan-out at /ondc/<action>.
//
// Why this file exists:
//   The BAP was registered in ONDC Workbench with a callback URL of
//   `https://openidea.co.in/ondc`, so Workbench/BPPs POST callbacks to
//   `https://openidea.co.in/ondc/on_search`, `.../on_select`, etc. The actual
//   handlers (signature verification, registry lookup, freshness, idempotency,
//   persistence) live under `src/app/api/ondc/*`. Without this seam, every
//   callback hits a 404 and `on_search` is never received.
//
// This route owns:
//   1. Logging every inbound callback (method, action, headers, raw body) so
//      Workbench/preprod issues are diagnosable from Vercel runtime logs alone.
//   2. Delegating to the matching `src/app/api/ondc/<action>` POST handler so
//      signatures are still verified and the persistence pipeline still runs.
//      A simple ACK responder here would compromise the signature-verification
//      chain in `auth.ts`; do NOT remove the delegation.
//
// Dynamic route note (this Next version): `params` is a Promise — `await` it.
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Whitelist of supported callback actions. A POST to /ondc/<anything-else>
// returns 404 so typos / probes don't fall through to an unverified ACK.
const ACTIONS = [
  "on_search",
  "on_select",
  "on_init",
  "on_confirm",
  "on_cancel",
  "on_status",
  "on_track",
  "on_update",
  "on_rating",
  "on_support",
  "on_subscribe",
  "on_issue",
  "on_issue_status",
] as const;
type Action = (typeof ACTIONS)[number];

function isAction(value: string): value is Action {
  return (ACTIONS as readonly string[]).includes(value);
}

// Map each action to the existing route module. Static-string dynamic imports
// keep Next's bundler analysis intact (no variable-path import).
const LOADERS: Record<Action, () => Promise<{ POST: (req: Request) => Promise<Response> }>> = {
  on_search: () => import("@/app/api/ondc/on_search/route"),
  on_select: () => import("@/app/api/ondc/on_select/route"),
  on_init: () => import("@/app/api/ondc/on_init/route"),
  on_confirm: () => import("@/app/api/ondc/on_confirm/route"),
  on_cancel: () => import("@/app/api/ondc/on_cancel/route"),
  on_status: () => import("@/app/api/ondc/on_status/route"),
  on_track: () => import("@/app/api/ondc/on_track/route"),
  on_update: () => import("@/app/api/ondc/on_update/route"),
  on_rating: () => import("@/app/api/ondc/on_rating/route"),
  on_support: () => import("@/app/api/ondc/on_support/route"),
  on_subscribe: () => import("@/app/api/ondc/on_subscribe/route"),
  on_issue: () => import("@/app/api/ondc/on_issue/route"),
  on_issue_status: () => import("@/app/api/ondc/on_issue/route"),
};

export async function POST(
  req: Request,
  ctx: { params: Promise<{ action: string }> }
) {
  const { action } = await ctx.params;

  // Buffer the body ONCE so we can both log it and hand a fresh Request with
  // the same body to the delegated handler — `req.text()`/`json()` can only be
  // read a single time on a Request stream.
  const rawBody = await req.text();
  const headerSnapshot = Object.fromEntries(req.headers);

  console.log("ondc.callback ENTER", {
    ts: new Date().toISOString(),
    action,
    url: req.url,
    contentLength: rawBody.length,
    headers: headerSnapshot,
    body: rawBody,
  });

  if (!isAction(action)) {
    console.warn("ondc.callback unknown action", { action });
    return NextResponse.json(
      { message: { ack: { status: "NACK" } }, error: { code: "404", message: `unknown action: ${action}` } },
      { status: 404 }
    );
  }

  // Reconstruct the inbound request for the delegated handler. We preserve the
  // original headers (Authorization / Digest / Content-Type are required for
  // signature verification in auth.ts) and the EXACT raw body bytes (digest is
  // computed over them — re-stringifying would break verification).
  const forwarded = new Request(req.url, {
    method: "POST",
    headers: req.headers,
    body: rawBody,
  });

  try {
    const mod = await LOADERS[action]();
    return await mod.POST(forwarded);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "delegation failed";
    console.error("ondc.callback delegate fault", { action, msg });
    return NextResponse.json(
      { message: { ack: { status: "NACK" } }, error: { code: "500", message: msg } },
      { status: 500 }
    );
  }
}
