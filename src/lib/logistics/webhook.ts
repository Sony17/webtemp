// Tocxi inbound webhook — signature verification.
//
// Tocxi POSTs to our registered URL on every status change, signing the RAW
// request body with HMAC-SHA256 keyed by our shared webhook secret and sending
// the hex digest in the `X-Tocxi-Signature` header (guide §05). This is the trust
// boundary: before we let an inbound body mutate our shipment ledger we must
// prove it came from Tocxi and wasn't tampered with in flight.
//
// The verification MUST run over the exact bytes Tocxi signed, so the route reads
// `await req.text()` and passes that string here untouched — never a re-serialized
// JSON.parse()→stringify() round-trip, which would reorder keys and break the
// digest. Same discipline as the ONDC callbacks (they verify the raw body before
// JSON.parse).
//
// node:crypto is server-only; `import "server-only"` turns an accidental client
// import into a build error.
import "server-only";
import crypto from "node:crypto";
import { getTocxiConfig } from "@/lib/logistics/config";

// Compute the expected signature for a raw body under a given secret: the lower-
// case hex HMAC-SHA256 digest. Exposed so tests (and a future outbound signer)
// can assert against a known value.
export function computeTocxiSignature(
  rawBody: string,
  secret: string
): string {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

// Verify the X-Tocxi-Signature header against the raw request body using the
// configured TOCXI_WEBHOOK_SECRET. Returns false (never throws) on any failure
// mode — missing secret, missing/blank header, malformed hex, or a genuine
// mismatch — so the route can answer a flat 401 without leaking WHICH check
// failed. The comparison is TIMING-SAFE (crypto.timingSafeEqual) so an attacker
// can't recover the correct signature byte-by-byte from response timing.
export function verifyTocxiSignature(
  rawBody: string,
  signatureHeader: string | null | undefined
): boolean {
  const secret = getTocxiConfig().webhookSecret;
  if (!secret) return false; // unconfigured — cannot authenticate, so reject
  if (!signatureHeader) return false;

  const provided = signatureHeader.trim().toLowerCase();
  if (!provided) return false;

  const expected = computeTocxiSignature(rawBody, secret);

  // timingSafeEqual requires equal-length buffers, and it throws otherwise — so
  // length-check first (a length mismatch is already a non-match). Compare as hex
  // bytes; a non-hex header yields a different-length or different-value buffer
  // and fails safely.
  let providedBuf: Buffer;
  let expectedBuf: Buffer;
  try {
    providedBuf = Buffer.from(provided, "hex");
    expectedBuf = Buffer.from(expected, "hex");
  } catch {
    return false;
  }
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}
