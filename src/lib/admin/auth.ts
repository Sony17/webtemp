// Server-side admin-API auth.
//
// WHY THIS EXISTS. The admin console (/shop/admin, /admin) used to guard
// CLIENT-SIDE only (localStorage "oi_admin"); every data API behind it —
// order book, payment references, seller directory, logistics booking — was
// publicly readable/writable by anyone who guessed the path. This module is
// the server-side gate those routes call first.
//
// MODEL. One shared secret, ADMIN_TOKEN (env, runtime getter — same pattern as
// payments/config.ts). Two ways to present it:
//
//   * Authorization: Bearer <ADMIN_TOKEN>       — scripts / curl / cron
//   * Cookie oi_admin_session=<HMAC>            — the browser console
//
// The cookie value is HMAC-SHA256("oi-admin-session-v1", key=ADMIN_TOKEN), set
// by POST /api/admin/login. Deterministic + stateless: verifiable on any
// serverless instance without a session store, and a leaked cookie never
// reveals the token itself. Rotating ADMIN_TOKEN invalidates every session.
//
// FAIL-CLOSED. When ADMIN_TOKEN is unset in production the gate returns 503 —
// admin APIs are DOWN, not open, until the operator sets the env. Development
// (NODE_ENV !== "production") allows with a loud console.warn so local work
// needs no setup.
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const ADMIN_SESSION_COOKIE = "oi_admin_session";
const SESSION_PAYLOAD = "oi-admin-session-v1";

// Runtime getter (NOT a module-load const) so serverless picks up the env per
// request. Empty string = unconfigured.
export function getAdminToken(): string {
  return process.env.ADMIN_TOKEN?.trim() ?? "";
}

export function isAdminConfigured(): boolean {
  return getAdminToken().length > 0;
}

// The value POST /api/admin/login sets as the session cookie.
export function adminSessionValue(): string {
  return createHmac("sha256", getAdminToken())
    .update(SESSION_PAYLOAD)
    .digest("hex");
}

// Constant-time string compare; length mismatch handled without early-exit
// leaking anything useful (lengths of our secrets are not sensitive).
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim();
    }
  }
  return undefined;
}

// Gate. Returns null when the caller is authorized; otherwise the NextResponse
// to return verbatim. Usage, first line of every admin handler:
//
//   const denied = requireAdmin(req);
//   if (denied) return denied;
export function requireAdmin(req: Request): NextResponse | null {
  const token = getAdminToken();

  if (!token) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "admin.auth: ADMIN_TOKEN not set — allowing in development. " +
          "Production fails closed (503) until it is configured."
      );
      return null;
    }
    return NextResponse.json(
      { error: "Admin API not configured (set ADMIN_TOKEN)." },
      { status: 503 }
    );
  }

  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    if (safeEqual(authHeader.slice(7).trim(), token)) return null;
  }

  const cookie = readCookie(req, ADMIN_SESSION_COOKIE);
  if (cookie && safeEqual(cookie, adminSessionValue())) return null;

  return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
}
