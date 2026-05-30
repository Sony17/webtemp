import { NextRequest, NextResponse } from "next/server";

// Apex/root hosts that serve the marketing site.
const ROOT_DOMAINS = [
  "openidea.co.in",
  "openidea.world",
  "localhost",
  "vercel.app",
];

// Subdomains that should NOT be treated as tenant sites.
const RESERVED_SUBDOMAINS = new Set([
  "www",
  "admin",
  "app",
  "api",
  "static",
  "cdn",
]);

// External custom domains mapped to a tenant subdomain. Apex and any www.
// variant resolve to the same tenant.
const CUSTOM_DOMAINS: Record<string, string> = {
  "saiwalldecor.com": "sai",
};

function extractSubdomain(host: string | null): string | null {
  if (!host) return null;
  const hostname = host.split(":")[0].toLowerCase();

  const stripped = hostname.startsWith("www.") ? hostname.slice(4) : hostname;
  if (CUSTOM_DOMAINS[stripped]) return CUSTOM_DOMAINS[stripped];

  for (const root of ROOT_DOMAINS) {
    if (hostname === root) return null;
    if (hostname.endsWith("." + root)) {
      const left = hostname.slice(0, -(root.length + 1));
      const sub = left.split(".")[0];
      if (!sub) return null;
      if (RESERVED_SUBDOMAINS.has(sub)) return null;
      return sub;
    }
  }

  return null;
}

export function proxy(req: NextRequest) {
  const sub = extractSubdomain(req.headers.get("host"));
  if (!sub) return NextResponse.next();

  const url = req.nextUrl.clone();
  if (url.pathname.startsWith("/s/")) return NextResponse.next();

  url.pathname = `/s/${sub}${url.pathname === "/" ? "" : url.pathname}`;
  return NextResponse.rewrite(url);
}

// Matcher intentionally includes dotted paths so tenant asset requests
// (/index.html, /style.css, /app.js, /logo.png) reach proxy and get rewritten
// to /s/<sub>/<path>. On the apex host, proxy returns next() and Next still
// serves files from public/ normally — just with one extra function call.
export const config = {
  matcher: ["/((?!_next|api|favicon.ico).*)"],
};
