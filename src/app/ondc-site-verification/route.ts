// ONDC site-verification page — proves domain ownership during /subscribe.
//
// When you register (or re-key) at the ONDC registry, the registry returns a
// `request_id`. You must sign it with your BAP ed25519 private key and embed
// the base64 signature in a meta tag at /ondc-site-verification.html. The
// registry GETs that page, reads the meta tag, ed25519-verifies the signature
// against your subscribed public key — if it matches, your domain is
// whitelisted and the subscription succeeds.
//
// We serve this DYNAMICALLY rather than as a static file so the signature is
// always fresh (no risk of an old, wrong sig sitting in `public/`). The
// request_id is supplied via env var ONDC_SITE_VERIFICATION_REQUEST_ID — set
// it after you get the value from the registry, redeploy, and the meta tag
// signs it on the next GET.
//
// If the env var is unset we return a clearly-labeled placeholder so registry
// readers see "not configured yet" instead of a confusing empty-signature
// page that would silently fail verification.
import { NextResponse } from "next/server";
import { isOndcConfigured } from "@/lib/ondc/config";
import { signRequestId } from "@/lib/ondc/auth";

export const runtime = "nodejs";
// Always serve fresh — the env var can change between deploys.
export const dynamic = "force-dynamic";

function htmlPage(metaContent: string, note?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="ondc-site-verification" content="${metaContent}" />
    <title>ONDC Site Verification</title>
  </head>
  <body>
    <p>ONDC Site Verification Page</p>
    ${note ? `<!-- ${note} -->` : ""}
  </body>
</html>
`;
}

export function GET() {
  if (!isOndcConfigured()) {
    return new NextResponse(
      htmlPage("UNCONFIGURED", "ONDC env not configured"),
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
    );
  }

  const requestId = process.env.ONDC_SITE_VERIFICATION_REQUEST_ID?.trim();
  if (!requestId) {
    return new NextResponse(
      htmlPage(
        "REQUEST_ID_NOT_SET",
        "Set ONDC_SITE_VERIFICATION_REQUEST_ID to the request_id returned by /subscribe."
      ),
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
    );
  }

  let signed: string;
  try {
    signed = signRequestId(requestId);
  } catch (err) {
    return new NextResponse(
      htmlPage(
        "SIGN_ERROR",
        `Could not sign request_id: ${err instanceof Error ? err.message : "unknown"}`
      ),
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
    );
  }

  return new NextResponse(htmlPage(signed), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
