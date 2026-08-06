// Typed, validated ONDC (Open Network for Digital Commerce) configuration.
//
// This module reads ONDC signing/encryption PRIVATE KEYS from the environment,
// so it must never run on the client. `import "server-only"` turns an accidental
// client import into a build error (see the Next.js data-security guide).
//
// All values come from environment variables so the same build can target the
// staging / pre-prod / prod networks without code changes. Every ONDC_* var is
// resolved through readOndcScopedEnv(): an ONDC_ENV-prefixed variant (e.g.
// ONDC_PROD_SIGNING_PRIVATE_KEY) wins over the plain name, so both networks'
// credentials can live in the environment at once with ONDC_ENV as the only
// switch. Mirrors the env-
// driven switching used in src/lib/deployments.ts (the `useBlob` pattern), but
// ONDC needs every credential present (and well-formed) to sign requests, so a
// missing or malformed var is a hard error rather than a silent fallback.
//
// The config is read lazily and memoized: importing this module never throws,
// so `next build` and tooling that don't set ONDC secrets keep working. The
// validation only runs the first time `getOndcConfig()` is called.
import "server-only";

export type OndcEnvironment = "staging" | "preprod" | "prod";

// Non-secret network context, safe to surface anywhere (including, if ever
// needed, the client via an explicit copy). Deliberately holds NO key material.
export type OndcPublicContext = {
  // Which ONDC network this app talks to.
  env: OndcEnvironment;

  // Your registered network participant identity.
  subscriberId: string; // e.g. "buyer-app.openidea.co.in"
  subscriberUri: string; // public base URL ONDC calls back on (no trailing slash)

  // Buyer-app (BAP) identity. Defaults to the subscriber when unset.
  bapId: string;
  bapUri: string;

  // ukId — selects the (public) key pair in the registry. Not a secret.
  uniqueKeyId: string;

  // Network endpoints. Sensible per-environment defaults are applied when the
  // corresponding env var is not set.
  registryBaseUrl: string;
  gatewayUrl: string;

  // The ONDC registry's X25519 public key for this environment, used by the
  // /on_subscribe handler to derive the AES key that decrypts the challenge.
  // Sourced from NETWORK_DEFAULTS — not env-overridable (a network-wide ID).
  registryEncryptionPublicKey: string;

  // Catalog / search context defaults sent on ONDC actions.
  domain: string; // PRIMARY / default domain, e.g. "ONDC:RET10". Sent when a
  // caller doesn't pin a specific domain — preserves the app's grocery default.
  // The set of ONDC retail domains this BAP supports for discovery (grocery,
  // fashion, …). Used to (a) validate the outbound `domain` a search may target
  // and (b) accept inbound on_search callbacks whose context.domain is in this
  // set. ALWAYS contains `domain`. Multi-domain is what lets a fashion (RET12)
  // search surface fashion sellers instead of only grocery (RET10). Override the
  // whole set via ONDC_DOMAINS (comma-separated); set it to just "ONDC:RET10" to
  // restore strict single-domain (grocery-only) behaviour.
  domains: string[];
  countryCode: string; // ISO-3166 alpha-3, e.g. "IND"
  cityCode: string; // e.g. "std:080"
  ttl: string; // ISO-8601 duration, e.g. "PT30S"
};

// Secret key material. Kept in a separate type so it is never accidentally
// spread into a value that crosses the server→client boundary. Base64-encoded
// raw keys, as issued during ONDC registration.
export type OndcSecrets = {
  signingPublicKey: string; // Ed25519, 32 bytes
  signingPrivateKey: string; // Ed25519 seed, 32 bytes (or 64-byte expanded)
  encryptionPublicKey: string; // X25519 (DER-wrapped or raw)
  encryptionPrivateKey: string; // X25519 (DER-wrapped or raw)
};

export type OndcConfig = OndcPublicContext & {
  // Secrets are nested (not spread) so destructuring the public context can
  // never leak them, and so redaction has a single place to scrub.
  secrets: OndcSecrets;
};

const VALID_ENVS = new Set<OndcEnvironment>(["staging", "preprod", "prod"]);

// Public ONDC network endpoints per environment. Used when the operator does
// not pin an explicit URL via env. See https://github.com/ONDC-Official.
const NETWORK_DEFAULTS: Record<
  OndcEnvironment,
  {
    registryBaseUrl: string;
    gatewayUrl: string;
    // Per-environment X25519 public key the ONDC registry uses to send the
    // /on_subscribe encrypted challenge. We ECDH it with our encryption
    // private key to derive the AES-256-ECB key that decrypts the challenge.
    // These are well-known constants — see ONDC's developer-docs registration
    // section. Hardcoded here (not env-overridable) because they're a
    // network-wide identity, not a per-deployment knob.
    registryEncryptionPublicKey: string;
  }
> = {
  staging: {
    registryBaseUrl: "https://staging.registry.ondc.org",
    gatewayUrl: "https://staging.gateway.proteantech.in",
    registryEncryptionPublicKey:
      "MCowBQYDK2VuAyEAduMuZgmtpjdCuxv+Nc49K0cUtoQNiBhrjsCsBXVtgaM=",
  },
  preprod: {
    registryBaseUrl: "https://preprod.registry.ondc.org/v2.0",
    gatewayUrl: "https://preprod.gateway.ondc.org",
    registryEncryptionPublicKey:
      "MCowBQYDK2VuAyEAa9Wbpvc9HnEpKZdSXh6+UdN6sZkrz9o1u3WP7lWlYxQ=",
  },
  prod: {
    registryBaseUrl: "https://prod.registry.ondc.org",
    gatewayUrl: "https://prod.gateway.ondc.org",
    registryEncryptionPublicKey:
      "MCowBQYDK2VuAyEAvVEyZY91O2yV8w8/CAwVDAnqIZDJJUPdLUUKwLo3K0M=",
  },
};

// A missing required var. Distinct from OndcConfigError so isOndcConfigured()
// can treat "not set up yet" differently from "set up wrong".
class OndcNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(
      `Missing required ONDC environment variable(s): ${missing.join(", ")}. ` +
        `Set them in your environment (see .env.example) before making ONDC ` +
        `calls. Each also accepts an ONDC_ENV-scoped variant, e.g. ` +
        `ONDC_PROD_SIGNING_PRIVATE_KEY when ONDC_ENV=prod.`
    );
    this.name = "OndcNotConfiguredError";
  }
}

// A present-but-invalid var (bad enum, malformed key, bad URL). A real
// misconfiguration the operator must fix — never silently swallowed.
class OndcConfigError extends Error {
  constructor(message: string) {
    super(`Invalid ONDC configuration: ${message}`);
    this.name = "OndcConfigError";
  }
}

function trimmed(value: string | undefined): string | undefined {
  const t = value?.trim();
  return t ? t : undefined;
}

// Env-scoped variable resolution — the mechanism behind the ONDC_ENV switch.
//
// For ONDC_ENV=prod, readOndcScopedEnv("ONDC_SIGNING_PRIVATE_KEY") prefers
// ONDC_PROD_SIGNING_PRIVATE_KEY and falls back to the unscoped name (same for
// _PREPROD_ / _STAGING_). This lets one deployment hold BOTH the pre-prod and
// prod credential sets side by side and switch networks by flipping ONDC_ENV
// alone — no re-pasting keys per switch.
//
// Total (never throws): an unrecognized ONDC_ENV merely disables scoping here;
// parseEnvironment() still reports it as a hard error on the config path.
export function readOndcScopedEnv(name: string): string | undefined {
  const raw = (process.env.ONDC_ENV ?? "staging").trim().toLowerCase();
  if (VALID_ENVS.has(raw as OndcEnvironment)) {
    const scoped = trimmed(
      process.env[name.replace(/^ONDC_/, `ONDC_${raw.toUpperCase()}_`)]
    );
    if (scoped) return scoped;
  }
  return trimmed(process.env[name]);
}

function parseEnvironment(raw: string | undefined): OndcEnvironment {
  const value = (raw ?? "staging").trim().toLowerCase();
  if (!VALID_ENVS.has(value as OndcEnvironment)) {
    throw new OndcConfigError(
      `ONDC_ENV must be one of ${[...VALID_ENVS].join(", ")} (got "${raw}").`
    );
  }
  return value as OndcEnvironment;
}

// Require an https URL and return it without a trailing slash, so callers can
// safely template paths as `${baseUrl}/lookup` without doubling slashes.
function normalizeUrl(name: string, raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OndcConfigError(`${name} is not a valid URL ("${raw}").`);
  }
  if (url.protocol !== "https:") {
    throw new OndcConfigError(`${name} must use https (got "${url.protocol}").`);
  }
  return url.toString().replace(/\/+$/, "");
}

// ONDC keys are base64-encoded. Validate decodability (and length where the
// raw size is fixed) so a typo'd key fails here with a clear message instead of
// deep inside the signing code. Ed25519/X25519 raw keys are 32 bytes; private
// keys may also arrive DER-wrapped or as a 64-byte expanded form, so we only
// hard-check the lower bound and exact sizes we can rely on.
function decodeBase64(name: string, raw: string): Buffer {
  // Reject characters outside the base64 alphabet up front — Buffer.from is
  // lenient and would silently drop them, masking a corrupt key.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
    throw new OndcConfigError(`${name} is not valid base64.`);
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length === 0) {
    throw new OndcConfigError(`${name} decoded to zero bytes.`);
  }
  return buf;
}

function validatePublicKey(name: string, raw: string): string {
  const buf = decodeBase64(name, raw);
  // Raw Ed25519/X25519 public keys are exactly 32 bytes. Some tooling emits
  // DER-wrapped (44-byte) keys; accept those too, reject anything shorter.
  if (buf.length < 32) {
    throw new OndcConfigError(
      `${name} is ${buf.length} bytes; expected a 32-byte (or DER-wrapped) key.`
    );
  }
  return raw;
}

function validatePrivateKey(name: string, raw: string): string {
  const buf = decodeBase64(name, raw);
  // Ed25519 seed = 32 bytes, expanded = 64 bytes; X25519 raw = 32 bytes;
  // DER-wrapped private keys are larger. Anything under 32 bytes is wrong.
  if (buf.length < 32) {
    throw new OndcConfigError(
      `${name} is ${buf.length} bytes; expected at least a 32-byte key.`
    );
  }
  return raw;
}

// Collect every missing required var before throwing, so the operator can fix
// them all at once instead of one redeploy per missing key. Format/URL checks
// run after presence so we never report a value as "invalid" when it's absent.
function buildConfig(): OndcConfig {
  const missing: string[] = [];

  function required(name: string): string {
    const value = readOndcScopedEnv(name);
    if (!value) missing.push(name);
    return value ?? "";
  }

  const env = parseEnvironment(process.env.ONDC_ENV);
  const defaults = NETWORK_DEFAULTS[env];

  const subscriberId = required("ONDC_SUBSCRIBER_ID");
  const subscriberUri = required("ONDC_SUBSCRIBER_URI");
  const uniqueKeyId = required("ONDC_UNIQUE_KEY_ID");
  const signingPublicKey = required("ONDC_SIGNING_PUBLIC_KEY");
  const signingPrivateKey = required("ONDC_SIGNING_PRIVATE_KEY");
  const encryptionPublicKey = required("ONDC_ENCRYPTION_PUBLIC_KEY");
  const encryptionPrivateKey = required("ONDC_ENCRYPTION_PRIVATE_KEY");

  // Bail on missing before validating formats, so absence reads as
  // "not configured" rather than "invalid".
  if (missing.length) throw new OndcNotConfiguredError(missing);

  const bapUri = readOndcScopedEnv("ONDC_BAP_URI") ?? subscriberUri;
  const registryBaseUrl =
    readOndcScopedEnv("ONDC_REGISTRY_BASE_URL") ?? defaults.registryBaseUrl;
  const gatewayUrl =
    readOndcScopedEnv("ONDC_GATEWAY_URL") ?? defaults.gatewayUrl;

  // Primary/default domain (grocery unless overridden). Sent on any action that
  // doesn't pin its own domain, so existing single-domain behaviour is unchanged.
  const domain = readOndcScopedEnv("ONDC_DOMAIN") ?? "ONDC:RET10";

  // Supported discovery domains. When ONDC_DOMAINS is set (comma-separated) it
  // is authoritative; otherwise default to a curated ONDC RETAIL bundle so the
  // buyer app can discover across grocery + the common categories out of the box
  // (grocery RET10, fashion RET12, BPC RET13, electronics RET14). The primary
  // `domain` is always included and de-duplicated. Set ONDC_DOMAINS="ONDC:RET10"
  // to pin the app back to grocery-only (e.g. to keep on_search strictly single-
  // domain during certification of that single domain).
  const domainsRaw = readOndcScopedEnv("ONDC_DOMAINS");
  const DEFAULT_SUPPORTED_DOMAINS = [
    "ONDC:RET10", // Grocery
    "ONDC:RET12", // Fashion
    "ONDC:RET13", // Beauty & Personal Care
    "ONDC:RET14", // Electronics
  ];
  const parsedDomains = (domainsRaw ? domainsRaw.split(",") : DEFAULT_SUPPORTED_DOMAINS)
    .map((d) => d.trim())
    .filter(Boolean);
  const domains = Array.from(new Set([domain, ...parsedDomains]));

  return {
    env,
    subscriberId,
    subscriberUri: normalizeUrl("ONDC_SUBSCRIBER_URI", subscriberUri),
    bapId: readOndcScopedEnv("ONDC_BAP_ID") ?? subscriberId,
    bapUri: normalizeUrl("ONDC_BAP_URI", bapUri),
    uniqueKeyId,
    registryBaseUrl: normalizeUrl("ONDC_REGISTRY_BASE_URL", registryBaseUrl),
    gatewayUrl: normalizeUrl("ONDC_GATEWAY_URL", gatewayUrl),
    registryEncryptionPublicKey: defaults.registryEncryptionPublicKey,
    domain,
    domains,
    countryCode: readOndcScopedEnv("ONDC_COUNTRY_CODE") ?? "IND",
    cityCode: readOndcScopedEnv("ONDC_CITY_CODE") ?? "std:080",
    ttl: readOndcScopedEnv("ONDC_TTL") ?? "PT30S",
    secrets: redactable({
      signingPublicKey: validatePublicKey(
        "ONDC_SIGNING_PUBLIC_KEY",
        signingPublicKey
      ),
      signingPrivateKey: validatePrivateKey(
        "ONDC_SIGNING_PRIVATE_KEY",
        signingPrivateKey
      ),
      encryptionPublicKey: validatePublicKey(
        "ONDC_ENCRYPTION_PUBLIC_KEY",
        encryptionPublicKey
      ),
      encryptionPrivateKey: validatePrivateKey(
        "ONDC_ENCRYPTION_PRIVATE_KEY",
        encryptionPrivateKey
      ),
    }),
  };
}

// Attach a non-enumerable toJSON so the keys still work as plain strings, but
// `JSON.stringify(config)`, structured logging, and error serialization emit
// "[REDACTED]" instead of dumping private keys into logs.
function redactable(secrets: OndcSecrets): OndcSecrets {
  Object.defineProperty(secrets, "toJSON", {
    value: () => ({
      signingPublicKey: secrets.signingPublicKey, // public — safe to show
      signingPrivateKey: "[REDACTED]",
      encryptionPublicKey: secrets.encryptionPublicKey, // public — safe to show
      encryptionPrivateKey: "[REDACTED]",
    }),
    enumerable: false,
  });
  return secrets;
}

let cached: OndcConfig | null = null;

// Lazily build, validate, and memoize the config. Throws on first use if any
// required var is missing (OndcNotConfiguredError) or malformed (OndcConfigError)
// — callers in request handlers get a clear, specific error.
export function getOndcConfig(): OndcConfig {
  if (!cached) cached = buildConfig();
  return cached;
}

// Whether a domain is one this BAP supports for discovery/callbacks. Used by the
// search route (reject an outbound domain we don't support) and the on_search
// gate (accept a callback whose context.domain is one we searched). Falls back to
// the primary domain when config can't be read, so a misconfig stays strict.
export function isSupportedDomain(domain: string): boolean {
  try {
    return getOndcConfig().domains.includes(domain);
  } catch {
    return domain === "ONDC:RET10";
  }
}

// Returns only the non-secret network context — the safe object to pass around
// freely, including across the server→client boundary if a consumer ever needs
// the subscriber id / domain on the client.
export function getOndcPublicContext(): OndcPublicContext {
  const { secrets: _secrets, ...publicContext } = getOndcConfig();
  return publicContext;
}

// True only when ONDC is fully and *correctly* configured. A missing-required
// setup returns false (feature simply off); a present-but-INVALID setup
// (bad enum, malformed key, non-https URL) rethrows, because silently hiding a
// real misconfiguration as "feature off" is how broken prod deploys ship.
export function isOndcConfigured(): boolean {
  try {
    getOndcConfig();
    return true;
  } catch (err) {
    if (err instanceof OndcNotConfiguredError) return false;
    throw err;
  }
}
