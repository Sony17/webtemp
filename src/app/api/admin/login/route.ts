// Admin console login — exchanges the ADMIN_TOKEN password for the httpOnly
// session cookie the admin data APIs accept (see src/lib/admin/auth.ts).
//
//   POST   { "password": "<ADMIN_TOKEN>" } → 200 + Set-Cookie oi_admin_session
//   DELETE                                  → 200 + cookie cleared (logout)
//
// The cookie is httpOnly (JS can't read it — nothing for XSS to steal),
// sameSite=lax, secure outside development, 7-day expiry. Rotating ADMIN_TOKEN
// invalidates every outstanding session at once.
import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  adminSessionValue,
  getAdminToken,
  safeEqual,
} from "@/lib/admin/auth";

export const runtime = "nodejs";

const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export async function POST(req: Request) {
  let password = "";
  try {
    const body = (await req.json()) as { password?: unknown };
    if (typeof body.password === "string") password = body.password;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const token = getAdminToken();

  if (!token) {
    // Mirror requireAdmin's posture: development works without setup (loud
    // warn); production fails closed until ADMIN_TOKEN is configured.
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "admin.login: ADMIN_TOKEN not set — issuing dev session. " +
          "Production returns 503 until it is configured."
      );
      const res = NextResponse.json({ ok: true, dev: true });
      res.cookies.set(ADMIN_SESSION_COOKIE, "dev", sessionCookieOptions());
      return res;
    }
    return NextResponse.json(
      { error: "Admin login not configured (set ADMIN_TOKEN)." },
      { status: 503 }
    );
  }

  if (!password || !safeEqual(password, token)) {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_SESSION_COOKIE, adminSessionValue(), sessionCookieOptions());
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_SESSION_COOKIE, "", {
    ...sessionCookieOptions(),
    maxAge: 0,
  });
  return res;
}
