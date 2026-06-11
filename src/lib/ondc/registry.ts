// ONDC registry — sender signing-key resolution for inbound callback verification.
//
// The 10 BAP callback routes (on_search / on_select / on_init / on_confirm /
// on_status / on_track / on_cancel / on_update / on_support / on_rating) each
// need the SENDER's Ed25519 signing public key to verify the inbound
// Authorization signature (see auth.ts). That key lives in the ONDC registry,
// keyed by (subscriber_id, unique_key_id). This module is the single, shared
// seam that all 10 routes import — the routes never speak to the registry
// directly, so hardening (and any future change to lookup strategy) happens
// here, in ONE place, without re-auditing every callback handler.
//
// The actual lookup — signed /vlookup, TTL + negative cache, subscriber /
// SUBSCRIBED / validity-window checks, key-rotation handling — lives in
// registry-client.ts. This file is the thin adapter that preserves the
// historic `Promise<string | null>` contract: null means "do not trust the
// inbound signature, NACK 401" regardless of WHY the lookup failed. That
// detail-hiding is intentional at this seam: callback routes have no business
// branching on registry internals, and we don't help a forger triangulate
// which check tripped by surfacing the reason on the wire.
//
// For diagnostic surfaces (e.g. /api/ondc/registry-status) that DO want the
// structured failure reason, import resolveBppSigningKey directly from
// registry-client.ts.
//
// Reads ONDC config (which reads private keys) via getOndcConfig() through the
// client, so it is server-only, mirroring config/context/auth/client/store.
import "server-only";
import { resolveBppSigningKey } from "@/lib/ondc/registry-client";

// Resolve the SENDER's base64 Ed25519 signing public key from the ONDC registry,
// or null when it cannot be resolved / does not pass hardening checks. A null
// return drives a NACK 401 at the call site — the callback route should NEVER
// differentiate failure reasons to the remote side.
//
// `city` should be the inbound callback's `context.city`: /lookup is city-scoped
// on preprod, so a BPP that serves a different city than ours will return empty
// records if we filter by our configured city. Falling back to config.cityCode
// is fine for tests / diagnostic callers that have nothing better.
export async function resolveBppSigningPublicKey(
  subscriberId: string,
  uniqueKeyId: string,
  city?: string
): Promise<string | null> {
  const result = await resolveBppSigningKey(subscriberId, uniqueKeyId, { city });

  if (!result.ok) {
    console.warn("ondc.registry resolve failed", {
      subscriberId,
      uniqueKeyId,
      reason: result.reason,
      detail: result.detail,
    });
  }

  return result.ok ? result.signingPublicKey : null;
}
