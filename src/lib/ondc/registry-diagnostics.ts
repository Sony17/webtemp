// ONDC registry — self-diagnostic lookup (Phase 1: raw read only).
//
// PURPOSE: a manual, read-only probe answering "what does the ONDC registry
// hold for OUR subscriber id on the currently-configured network?". It exists so
// we can confirm whether OpenIdea is registered / SUBSCRIBED in preprod WITHOUT
// touching any transaction flow.
//
// SCOPE (Phase 1 — intentionally minimal):
//   - POST /lookup with OUR configured subscriber_id.
//   - Return the registry's RAW response plus basic call metadata.
//   - NO status verdict, NO key comparison — those are deliberate follow-ups so
//     the comparison logic can be written against a CONFIRMED response shape
//     (the registry record field names are not yet verified against live data).
//
// This is a SEPARATE module from registry.ts on purpose: registry.ts is on the
// inbound callback-verification path (all 10 on_* routes call
// resolveBppSigningPublicKey). Keeping the diagnostic here leaves that audited
// file — and every transaction flow — untouched.
//
// Reads ONDC config (which reads private keys) via getOndcConfig(), so it is
// server-only, mirroring config/context/auth/client/store/registry.
import "server-only";
import { signRequest } from "@/lib/ondc/auth";
import { getOndcConfig, type OndcEnvironment } from "@/lib/ondc/config";

// ONDC registry participant role for the lookup `type` filter. OpenIdea is a
// Buyer NP, but the registry's `type` VOCABULARY differs by environment, and the
// filter is an EXACT match — the wrong token yields NACK 15045 "No matching
// network participant found" even though the record is present and SUBSCRIBED.
//
// Verified live against prod.registry.ondc.org (2026-08): a /lookup with
// type="buyerApp" NACKs 15045, while type="BAP" returns the record — whose own
// stored `type` is "BAP". So prod uses the Beckn role tokens (BAP / BPP / BG),
// whereas the pre-prod/staging v2.0 registry uses the portal vocabulary
// (buyerApp / sellerApp / gateway / LSP) — consistent with registry-client.ts
// sending "sellerApp" to preprod. Hence the filter is chosen by env, not fixed.
function lookupParticipantType(env: OndcEnvironment): string {
  return env === "prod" ? "BAP" : "buyerApp";
}

// Result of a single diagnostic /lookup call. `raw` is whatever the registry
// returned: parsed JSON when the body is JSON, otherwise the raw text (so a
// non-JSON error page / gateway message is still surfaced, not swallowed).
export type RegistryLookupResult = {
  // The exact registry endpoint we POSTed to (env-driven via config).
  registryUrl: string;
  // The subscriber_id we queried (ours by default).
  subscriberId: string;
  // The request body we sent, echoed for transparency. Mirrors the v1.2.5
  // /lookup filter set (subscriber_id, domain, country, city, type, ukId).
  requestBody: {
    subscriber_id: string;
    domain: string;
    country: string;
    city: string;
    type: string;
    ukId: string;
  };
  // HTTP status from the registry, or null if the request never completed
  // (network failure / DNS / timeout — see `error`).
  httpStatus: number | null;
  // res.ok — true for a 2xx registry response.
  ok: boolean;
  // Parsed JSON body when parseable; otherwise the raw response text.
  raw: unknown;
  // Set only when the fetch itself failed (no HTTP response received).
  error?: string;
};

// Probe the ONDC registry for a subscriber's record(s). Defaults to OUR own
// configured subscriber_id. Never throws for a registry-level failure (non-2xx,
// non-JSON, network error) — those are returned as data so the caller (a
// diagnostic route) can report them verbatim. The registry endpoint is selected
// purely by ONDC_ENV via getOndcConfig(), so this targets staging/preprod/prod
// with no code change.
export async function lookupSubscriber(
  subscriberId?: string
): Promise<RegistryLookupResult> {
  const config = getOndcConfig();
  const subject = subscriberId?.trim() || config.subscriberId;
  const registryUrl = `${config.registryBaseUrl}/lookup`;
  // Full v1.2.5 /lookup filter set, pulled from config so the probe matches our
  // registered identity. All six are optional filters in the spec; sending them
  // scopes the result to OUR exact record (this subscriber, this role, this
  // domain/country/city, this key id) instead of a broad match.
  const requestBody = {
    subscriber_id: subject,
    domain: config.domain,
    country: config.countryCode,
    city: config.cityCode,
    type: lookupParticipantType(config.env),
    ukId: config.uniqueKeyId,
  };

  // Serialize EXACTLY ONCE. This same string is signed (digest) AND sent on the
  // wire — re-serializing would change the bytes and break the registry's
  // recomputed digest check. Mirrors client.ts's serialize-once discipline.
  const rawBody = JSON.stringify(requestBody);

  try {
    // Sign the body using the existing outbound-signing path (auth.ts), the same
    // call every transaction action funnels through. Kept INSIDE the try so a
    // signing fault (bad key material → OndcAuthError) is reported as data,
    // preserving this module's fail-soft contract instead of throwing.
    const signed = signRequest(rawBody);

    const res = await fetch(registryUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: signed.authorization,
        // signRequest already computed the digest over `rawBody`; ONDC verifiers
        // recompute it, so this is informational, but harmless to include and
        // useful for intermediaries that log/inspect it.
        Digest: signed.digest,
      },
      body: rawBody,
    });

    // Read as text first so a non-JSON body (HTML error page, plain-text gateway
    // message) is preserved instead of throwing inside res.json().
    const text = await res.text();
    let raw: unknown = text;
    try {
      raw = text ? JSON.parse(text) : null;
    } catch {
      // Leave `raw` as the original text — surfacing the real body matters more
      // than forcing it into JSON.
    }

    return {
      registryUrl,
      subscriberId: subject,
      requestBody,
      httpStatus: res.status,
      ok: res.ok,
      raw,
    };
  } catch (err) {
    // The fetch never produced an HTTP response (DNS, connection refused,
    // network timeout). Report it as data, not an exception.
    return {
      registryUrl,
      subscriberId: subject,
      requestBody,
      httpStatus: null,
      ok: false,
      raw: null,
      error: err instanceof Error ? err.message : "Unknown registry error",
    };
  }
}
