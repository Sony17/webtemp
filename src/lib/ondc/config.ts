// Typed, validated ONDC (Open Network for Digital Commerce) configuration.
//
// This module reads ONDC signing/encryption PRIVATE KEYS from the environment,
// so it must never run on the client. `import "server-only"` turns an accidental
// client import into a build error (see the Next.js data-security guide).
//
// All values come from environment variables so the same build can target the
// staging / pre-prod / prod networks without code changes. Mirrors the env-
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

  // Catalog / search context defaults sent on ONDC actions.
  domain: string; // e.g. "ONDC:RET10"
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
  { registryBaseUrl: string; gatewayUrl: string }
> = {
  staging: {
    registryBaseUrl: "https://staging.registry.ondc.org",
    gatewayUrl: "https://staging.gateway.proteantech.in",
  },
  preprod: {
    registryBaseUrl: "https://preprod.registry.ondc.org/ondc",
    gatewayUrl: "https://preprod.gateway.ondc.org",
  },
  prod: {
    registryBaseUrl: "https://prod.registry.ondc.org",
    gatewayUrl: "https://prod.gateway.ondc.org",
  },
};

// A missing required var. Distinct from OndcConfigError so isOndcConfigured()
// can treat "not set up yet" differently from "set up wrong".
class OndcNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(
      `Missing required ONDC environment variable(s): ${missing.join(", ")}. ` +
        `Set them in your environment (see .env.example) before making ONDC calls.`
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
    const value = trimmed(process.env[name]);
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

  const bapUri = trimmed(process.env.ONDC_BAP_URI) ?? subscriberUri;
  const registryBaseUrl =
    trimmed(process.env.ONDC_REGISTRY_BASE_URL) ?? defaults.registryBaseUrl;
  const gatewayUrl = trimmed(process.env.ONDC_GATEWAY_URL) ?? defaults.gatewayUrl;

  return {
    env,
    subscriberId,
    subscriberUri: normalizeUrl("ONDC_SUBSCRIBER_URI", subscriberUri),
    bapId: trimmed(process.env.ONDC_BAP_ID) ?? subscriberId,
    bapUri: normalizeUrl("ONDC_BAP_URI", bapUri),
    uniqueKeyId,
    registryBaseUrl: normalizeUrl("ONDC_REGISTRY_BASE_URL", registryBaseUrl),
    gatewayUrl: normalizeUrl("ONDC_GATEWAY_URL", gatewayUrl),
    domain: trimmed(process.env.ONDC_DOMAIN) ?? "ONDC:RET10",
    countryCode: trimmed(process.env.ONDC_COUNTRY_CODE) ?? "IND",
    cityCode: trimmed(process.env.ONDC_CITY_CODE) ?? "std:080",
    ttl: trimmed(process.env.ONDC_TTL) ?? "PT30S",
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
