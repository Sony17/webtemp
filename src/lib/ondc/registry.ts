// ONDC registry — sender signing-key resolution for inbound callback verification.
//
// The 10 BAP callback routes (on_search / on_select / on_init / on_confirm /
// on_status / on_track / on_cancel / on_update / on_support / on_rating) each
// need the SENDER's Ed25519 signing public key to verify the inbound
// Authorization signature (see auth.ts). That key lives in the ONDC registry,
// keyed by (subscriber_id, unique_key_id). This module is the single, shared
// place that knows how a key is fetched — previously this exact function was
// duplicated inline in all 10 routes.
//
// SCOPE (intentionally minimal — a verbatim extraction, NOT a hardening pass):
// a best-effort POST /lookup with a process-wide in-memory memo and a strict
// unique_key_id match (fail-closed: a non-array response or a ukId miss returns
// null, never a positional fallback). A dedicated hardened client — signed
// /vlookup, cache TTL, subscriber/status validation, negative caching, and key
// rotation — is deliberately NOT here yet; those land as follow-up steps on this
// same seam without touching any route again.
//
// Reads ONDC config (which reads private keys) via getOndcConfig(), so it is
// server-only, mirroring config/context/auth/client/store.
import "server-only";
import { getOndcConfig } from "@/lib/ondc/config";

// Process-wide memo shared by all callback routes: subscriberId|uniqueKeyId ->
// base64 signing public key. Populated only on a successful, strict-matched
// lookup. No eviction / TTL — preserved verbatim from the original per-route
// inline behavior (hardening is a deliberate follow-up).
const keyCache = new Map<string, string>();

// Resolve the SENDER's base64 Ed25519 signing public key from the ONDC registry,
// or null when it cannot be resolved (or no record strictly matches the
// requested unique_key_id). Signature preserved exactly from the original
// per-route implementation so callers change by import only. Callers pass the
// (subscriber_id, unique_key_id) parsed from the inbound Authorization header; a
// null return drives a NACK 401 at the call site.
export async function resolveBppSigningPublicKey(
  subscriberId: string,
  uniqueKeyId: string
): Promise<string | null> {
  const cacheKey = `${subscriberId}|${uniqueKeyId}`;
  const cached = keyCache.get(cacheKey);
  if (cached) return cached;

  const { registryBaseUrl } = getOndcConfig();
  try {
    const res = await fetch(`${registryBaseUrl}/lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscriber_id: subscriberId, ukId: uniqueKeyId }),
    });
    if (!res.ok) return null;

    // /lookup returns an array of subscriber records; pick the one whose key id
    // matches (the registry can return multiple keys for one subscriber).
    const records = (await res.json()) as Array<{
      ukId?: string;
      unique_key_id?: string;
      signing_public_key?: string;
    }>;
    // Fail closed: the key MUST correspond to the EXACT unique_key_id the sender
    // named in its Authorization header. No positional fallback — a non-array
    // response or a ukId miss is an unverifiable request, not "use whatever key
    // came back first" (which would verify a forgery against an unrelated key).
    if (!Array.isArray(records)) return null;
    const match = records.find(
      (r) => (r.ukId ?? r.unique_key_id) === uniqueKeyId
    );

    const key = match?.signing_public_key;
    if (!key) return null;

    keyCache.set(cacheKey, key);
    return key;
  } catch {
    // Network/registry failure → treat as unresolvable; caller NACKs.
    return null;
  }
}
