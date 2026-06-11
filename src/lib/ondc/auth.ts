// ONDC request signing AND inbound-signature verification (Beckn/ONDC HTTP
// Signature profile).
//
// Every BAP-initiated ONDC call (search/select/init/confirm/status/…) POSTs a
// JSON body and must carry an `Authorization` header proving (a) which network
// participant produced the body and (b) that the request is fresh. ONDC's
// profile of the IETF "Signing HTTP Messages" draft signs a 3-line string of
//   (created) / (expires) / digest
// where `digest` is the BLAKE2b-512 hash of the *exact* request body bytes and
// the signature is Ed25519.
//
// This module owns BOTH directions of that scheme, since they share the exact
// same surface (digest + signing string):
//   - OUTBOUND: signRequest()        — we sign bodies we send (search/select/…).
//   - INBOUND:  verifyOndcSignature() — we verify callbacks we receive
//     (on_search/on_select/…), against the sender's registry public key.
// Keeping verification here (not in a route) means digest/signing-string logic
// can never drift between the two directions.
//
// This module is action-agnostic: it only ever sees a serialized body string
// and a freshness window, so search/select/init/confirm/status all reuse
// `signRequest` unchanged (they differ only in the body they hand in). It sits
// below the context-versioning seam (see ./VERSIONING.md) — flat 1.2.x vs
// nested 2.0.x contexts are invisible here because we sign the serialized body.
//
// Reads ONDC signing key material from getOndcConfig(), so it is server-only.
import "server-only";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from "node:crypto";
import { getOndcConfig } from "@/lib/ondc/config";

// A failure while signing (bad key material, bad ttl, bad inputs). Mirrors the
// named-error pattern in config.ts so callers can distinguish signing faults
// from transport/network faults.
export class OndcAuthError extends Error {
  constructor(message: string) {
    super(`ONDC signing error: ${message}`);
    this.name = "OndcAuthError";
  }
}

// ONDC labels the body digest with this algorithm tag on the wire, e.g.
// `BLAKE-512=<base64>`. Kept as a constant so the digest header and the signing
// string can never drift apart.
const DIGEST_PREFIX = "BLAKE-512=";

// The signed surface, in ONDC's required order. `(created)`/`(expires)` are
// signature pseudo-headers (not real HTTP headers); `digest` binds the body.
const SIGNED_HEADERS = "(created) (expires) digest";

// PKCS#8 DER prefix for a raw 32-byte Ed25519 seed. Node's createPrivateKey
// won't accept a bare 32-byte key, so we wrap the seed in the standard PKCS#8
// envelope (SEQUENCE / version 0 / AlgorithmIdentifier{1.3.101.112} / OCTET
// STRING-wrapped seed). 16 header bytes + 32 seed = 48-byte DER.
const PKCS8_ED25519_PREFIX = Buffer.from(
  "302e020100300506032b657004220420",
  "hex"
);

// SPKI DER prefix for a raw 32-byte Ed25519 PUBLIC key — the verification-side
// counterpart of PKCS8_ED25519_PREFIX. ONDC registry public keys arrive base64
// and are usually the bare 32-byte point; Node's createPublicKey needs them
// wrapped in this standard SubjectPublicKeyInfo envelope. 12 header bytes + 32
// key = 44-byte DER.
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

// ---------------------------------------------------------------------------
// Pure helpers — no config, no clock, no key material. Unit-testable in
// isolation; signRequest() composes them with config + the current time.
// ---------------------------------------------------------------------------

// BLAKE2b-512 digest of the raw body, tagged the way ONDC expects. The input
// MUST be the exact byte string that will be sent on the wire — sign and send
// the same string, never re-serialize, or the receiver's recomputed digest
// won't match. Returns `BLAKE-512=<base64>`.
export function computeDigest(rawBody: string): string {
  const hash = createHash("blake2b512").update(rawBody, "utf8").digest("base64");
  return `${DIGEST_PREFIX}${hash}`;
}

// The exact string that gets Ed25519-signed. Order and the `(created)/(expires)
// /digest` labels are fixed by the ONDC profile; the receiver reconstructs this
// verbatim from the Authorization header's `headers` list, so it must not vary.
export function buildSigningString(params: {
  created: number;
  expires: number;
  digest: string;
}): string {
  return (
    `(created): ${params.created}\n` +
    `(expires): ${params.expires}\n` +
    `digest: ${params.digest}`
  );
}

// Parse the seconds out of an ISO-8601 duration (config.ttl, e.g. "PT30S").
// Supports the day/hour/minute/second forms ONDC ttls use; rejects week/month/
// year and malformed input so a bad ttl fails loudly here, not as a silently
// wrong `expires`. Fractional seconds are floored (epoch seconds are integers).
export function parseTtlSeconds(iso: string): number {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
    iso.trim()
  );
  if (!match || (!match[1] && !match[2] && !match[3] && !match[4])) {
    throw new OndcAuthError(
      `ttl "${iso}" is not a supported ISO-8601 duration (e.g. "PT30S").`
    );
  }
  const [, d, h, m, s] = match;
  const seconds =
    Number(d ?? 0) * 86400 +
    Number(h ?? 0) * 3600 +
    Number(m ?? 0) * 60 +
    Number(s ?? 0);
  return Math.floor(seconds);
}

// Normalize an ONDC-issued, base64 Ed25519 PRIVATE key into a Node KeyObject,
// accepting the three forms config.ts deliberately allows:
//   - 32-byte raw seed            → wrap in PKCS#8
//   - 64-byte expanded (seed‖pub) → take the leading 32-byte seed, wrap
//   - DER-wrapped PKCS#8          → load directly
// Anything else is a real key error and is rejected with a clear message.
export function normalizeEd25519PrivateKey(base64Key: string): KeyObject {
  let raw: Buffer;
  try {
    raw = Buffer.from(base64Key, "base64");
  } catch {
    throw new OndcAuthError("signing private key is not valid base64.");
  }

  if (raw.length === 32 || raw.length === 64) {
    const seed = raw.subarray(0, 32);
    const der = Buffer.concat([PKCS8_ED25519_PREFIX, seed]);
    try {
      return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
    } catch (err) {
      throw new OndcAuthError(
        `could not load 32-byte Ed25519 seed: ${(err as Error).message}`
      );
    }
  }

  // Larger payloads are assumed to be DER-wrapped PKCS#8 (config.ts allows them).
  try {
    return createPrivateKey({ key: raw, format: "der", type: "pkcs8" });
  } catch (err) {
    throw new OndcAuthError(
      `signing private key is ${raw.length} bytes and not loadable as a raw ` +
        `seed or PKCS#8 DER key: ${(err as Error).message}`
    );
  }
}

// Assemble the ONDC `Authorization` header value. keyId is the pipe-delimited
// `subscriber_id|unique_key_id|algorithm` triple the receiver uses to fetch the
// matching public key from the registry. `headers` must list exactly the
// entries that were signed, in order.
export function createAuthorizationHeader(params: {
  subscriberId: string;
  uniqueKeyId: string;
  created: number;
  expires: number;
  signature: string; // base64 Ed25519 signature over the signing string
}): string {
  const keyId = `${params.subscriberId}|${params.uniqueKeyId}|ed25519`;
  return (
    `Signature keyId="${keyId}",algorithm="ed25519",` +
    `created="${params.created}",expires="${params.expires}",` +
    `headers="${SIGNED_HEADERS}",signature="${params.signature}"`
  );
}

// ---------------------------------------------------------------------------
// High-level entry point — composes the helpers with config + current time.
// ---------------------------------------------------------------------------

export type SignedRequest = {
  // Drop straight onto the outgoing request.
  authorization: string;
  // ONDC verifiers recompute the digest from the body, so sending the `Digest`
  // header is optional; exposed for callers that want belt-and-suspenders.
  digest: string;
  // The signature freshness window, for logging / tests.
  created: number;
  expires: number;
};

export type SignRequestOptions = {
  // Override the freshness window (epoch seconds) — for deterministic tests or
  // idempotent retries. Defaults to now / now + ttl.
  created?: number;
  expires?: number;
  // ttl as ISO-8601 duration; defaults to config.ttl (e.g. "PT30S").
  ttl?: string;
};

// Sign one ONDC request body. `rawBody` MUST be the exact string POSTed on the
// wire (serialize once, sign and send the same bytes). Identity + signing key
// come from getOndcConfig(); the body's action/shape are irrelevant here, which
// is why search/select/init/confirm/status all funnel through this one call.
export function signRequest(
  rawBody: string,
  options: SignRequestOptions = {}
): SignedRequest {
  const config = getOndcConfig();

  const created = options.created ?? Math.floor(Date.now() / 1000);
  const expires =
    options.expires ?? created + parseTtlSeconds(options.ttl ?? config.ttl);

  if (expires <= created) {
    throw new OndcAuthError(
      `expires (${expires}) must be after created (${created}).`
    );
  }

  const digest = computeDigest(rawBody);
  const signingString = buildSigningString({ created, expires, digest });

  const privateKey = normalizeEd25519PrivateKey(config.secrets.signingPrivateKey);
  // Ed25519 is a single-shot, hash-internal scheme — algorithm MUST be null.
  const signature = edSign(null, Buffer.from(signingString, "utf8"), privateKey)
    .toString("base64");

  const authorization = createAuthorizationHeader({
    subscriberId: config.subscriberId,
    uniqueKeyId: config.uniqueKeyId,
    created,
    expires,
    signature,
  });

  return { authorization, digest, created, expires };
}

// Ed25519-sign an opaque string with the BAP's configured signing private key
// and return the base64 signature. Used for the registry's domain-ownership
// proof at /ondc-site-verification.html: the registry returns a `request_id`
// during /subscribe, you sign it with this helper, and the registry
// re-verifies against your subscribed public key.
//
// This is NOT the same as signRequest above — there's no digest or
// created/expires envelope, just raw ed25519 over the UTF-8 bytes of the
// request_id. The registry's site-verification check expects exactly that.
export function signRequestId(requestId: string): string {
  const config = getOndcConfig();
  const privateKey = normalizeEd25519PrivateKey(config.secrets.signingPrivateKey);
  return edSign(null, Buffer.from(requestId, "utf8"), privateKey).toString(
    "base64"
  );
}

// ---------------------------------------------------------------------------
// Inbound verification — the symmetric counterpart of the signing path above.
// Used by callback routes (on_search/on_select/…) to prove an inbound request
// really came from the network participant named in its Authorization header.
// ---------------------------------------------------------------------------

// Normalize an ONDC-issued, base64 Ed25519 PUBLIC key (e.g. a BPP's
// `signing_public_key` from the registry) into a Node KeyObject. Mirrors
// normalizeEd25519PrivateKey: accepts the bare 32-byte point (wrapped in SPKI)
// or an already-DER-wrapped SubjectPublicKeyInfo key.
export function normalizeEd25519PublicKey(base64Key: string): KeyObject {
  let raw: Buffer;
  try {
    raw = Buffer.from(base64Key, "base64");
  } catch {
    throw new OndcAuthError("signing public key is not valid base64.");
  }

  if (raw.length === 32) {
    const der = Buffer.concat([SPKI_ED25519_PREFIX, raw]);
    try {
      return createPublicKey({ key: der, format: "der", type: "spki" });
    } catch (err) {
      throw new OndcAuthError(
        `could not load 32-byte Ed25519 public key: ${(err as Error).message}`
      );
    }
  }

  // Larger payloads are assumed to be DER-wrapped SPKI (the registry sometimes
  // serves keys this way).
  try {
    return createPublicKey({ key: raw, format: "der", type: "spki" });
  } catch (err) {
    throw new OndcAuthError(
      `signing public key is ${raw.length} bytes and not loadable as a raw ` +
        `point or SPKI DER key: ${(err as Error).message}`
    );
  }
}

// The fields parsed out of an inbound `Authorization: Signature ...` header.
// `keyId` is the `subscriber_id|unique_key_id|algorithm` triple; we pre-split
// the first two because callers need them to fetch the right registry key.
export type ParsedAuthorization = {
  keyId: string;
  subscriberId: string;
  uniqueKeyId: string;
  algorithm: string;
  created: number;
  expires: number;
  headers: string;
  signature: string; // base64 Ed25519 signature
};

// Parse an inbound ONDC Authorization header. Returns null (never throws) on
// any structural problem, so a malformed header becomes a clean 401/NACK at the
// call site rather than a crash. Tolerant of whitespace and parameter order,
// which intermediaries vary.
export function parseAuthorizationHeader(
  header: string
): ParsedAuthorization | null {
  const stripped = /^signature\s+([\s\S]*)$/i.exec(header.trim());
  if (!stripped) return null;

  const params: Record<string, string> = {};
  const pair = /(\w+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = pair.exec(stripped[1]))) params[m[1]] = m[2];

  const { keyId, created, expires, signature } = params;
  if (!keyId || !created || !expires || !signature) return null;

  const [subscriberId, uniqueKeyId, alg] = keyId.split("|");
  if (!subscriberId || !uniqueKeyId) return null;

  const createdN = Number(created);
  const expiresN = Number(expires);
  if (!Number.isFinite(createdN) || !Number.isFinite(expiresN)) return null;

  return {
    keyId,
    subscriberId,
    uniqueKeyId,
    algorithm: params.algorithm ?? alg ?? "ed25519",
    created: createdN,
    expires: expiresN,
    headers: params.headers ?? SIGNED_HEADERS,
    signature,
  };
}

// The outcome of a verification attempt. `valid:false` always carries a
// `reason` for logging — never surfaced to the caller (don't help a forger).
export type VerifyResult = { valid: true } | { valid: false; reason: string };

// Verify an inbound request's signature. Recomputes the digest over the EXACT
// raw body bytes (the caller MUST pass the unparsed body string — re-serialized
// JSON would change the bytes and fail), rebuilds the canonical signing string,
// checks the freshness window, then Ed25519-verifies against `publicKey`.
//
// Pure: no I/O, no config — the caller resolves `publicKey` (from the registry)
// and may inject `now` for deterministic tests. A small clock skew is allowed
// in both directions to tolerate honest clock drift between participants.
export function verifyOndcSignature(params: {
  rawBody: string;
  parsed: ParsedAuthorization;
  publicKey: KeyObject;
  now?: number;
  clockSkewSeconds?: number;
}): VerifyResult {
  const { rawBody, parsed, publicKey } = params;
  const now = params.now ?? Math.floor(Date.now() / 1000);
  const skew = params.clockSkewSeconds ?? 5;

  if (parsed.expires + skew < now) return { valid: false, reason: "expired" };
  if (parsed.created - skew > now) {
    return { valid: false, reason: "created in the future" };
  }

  const digest = computeDigest(rawBody);
  const signingString = buildSigningString({
    created: parsed.created,
    expires: parsed.expires,
    digest,
  });

  let sig: Buffer;
  try {
    sig = Buffer.from(parsed.signature, "base64");
  } catch {
    return { valid: false, reason: "signature is not base64" };
  }

  try {
    const ok = edVerify(null, Buffer.from(signingString, "utf8"), publicKey, sig);
    return ok ? { valid: true } : { valid: false, reason: "signature mismatch" };
  } catch (err) {
    return { valid: false, reason: `verify error: ${(err as Error).message}` };
  }
}
