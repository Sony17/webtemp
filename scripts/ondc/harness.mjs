// Test harness for the ONDC suite.
//
// - HTTP helpers that target the local Next.js server (default http://localhost:3000).
// - An ed25519 mock signer that mirrors the ONDC HTTP Signature profile (auth.ts):
//     digest  = BLAKE-512 over the exact body bytes
//     signing string  = "(created): N\n(expires): N\ndigest: BLAKE-512=…"
//     Authorization   = Signature keyId="<sub>|<ukId>|ed25519",algorithm="ed25519",
//                       created="N",expires="N",headers="(created) (expires) digest",
//                       signature="<base64>"
// - A tiny assertion DSL: scenario({ name, expect: { status, bodyContains, ... } }).
//
// Zero npm deps — runs on Node 18+ with the built-in fetch and node:crypto.
import {
  createHash,
  generateKeyPairSync,
  sign as edSign,
  randomBytes,
  randomUUID,
} from "node:crypto";

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

export const DEFAULT_BASE_URL =
  process.env.ONDC_TEST_BASE_URL?.replace(/\/+$/, "") ??
  "http://localhost:3000";

export async function httpRequest({
  baseUrl = DEFAULT_BASE_URL,
  method = "GET",
  path,
  headers = {},
  body, // string | undefined — already serialized so digests align with what's sent
  timeoutMs = 15_000,
}) {
  const url = `${baseUrl}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
    });
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return {
      ok: res.ok,
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      text,
      json,
      ms: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      headers: {},
      text: "",
      json: null,
      error: err instanceof Error ? err.message : String(err),
      ms: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// ONDC mock signer (mirrors src/lib/ondc/auth.ts)
// ---------------------------------------------------------------------------

export function generateEd25519KeyPair() {
  // node:crypto returns KeyObject; we expose raw 32-byte buffers so tests can
  // inspect / log them without ceremony.
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    keyObject: { publicKey, privateKey },
    publicKeyBase64: publicKey
      .export({ format: "der", type: "spki" })
      .subarray(-32)
      .toString("base64"),
    privateKeyBase64: privateKey
      .export({ format: "der", type: "pkcs8" })
      .subarray(-32)
      .toString("base64"),
  };
}

export function blake512Digest(rawBody) {
  return `BLAKE-512=${createHash("blake2b512")
    .update(rawBody, "utf8")
    .digest("base64")}`;
}

export function buildSigningString({ created, expires, digest }) {
  return `(created): ${created}\n(expires): ${expires}\ndigest: ${digest}`;
}

export function signBody({
  rawBody,
  subscriberId,
  uniqueKeyId,
  privateKey, // KeyObject (Ed25519)
  created,
  expires,
}) {
  const c = created ?? Math.floor(Date.now() / 1000);
  const e = expires ?? c + 30;
  const digest = blake512Digest(rawBody);
  const signingString = buildSigningString({ created: c, expires: e, digest });
  const signature = edSign(null, Buffer.from(signingString, "utf8"), privateKey)
    .toString("base64");
  const auth =
    `Signature keyId="${subscriberId}|${uniqueKeyId}|ed25519",` +
    `algorithm="ed25519",created="${c}",expires="${e}",` +
    `headers="(created) (expires) digest",signature="${signature}"`;
  return { authorization: auth, digest, created: c, expires: e };
}

// Convenience: synthesize an "unsigned" but well-formed-looking Authorization
// header — for tests that want to confirm the route REJECTS a header whose
// signature doesn't verify (since we don't hold any registry-resolvable key).
export function fakeAuthorization({ subscriberId, uniqueKeyId }) {
  const c = Math.floor(Date.now() / 1000);
  const e = c + 30;
  const sig = randomBytes(64).toString("base64");
  return (
    `Signature keyId="${subscriberId}|${uniqueKeyId}|ed25519",` +
    `algorithm="ed25519",created="${c}",expires="${e}",` +
    `headers="(created) (expires) digest",signature="${sig}"`
  );
}

// ---------------------------------------------------------------------------
// Assertion DSL
// ---------------------------------------------------------------------------

// A scenario captures: name, the actual response we got, and what we expected.
// `expect` supports:
//   status:        a number, or [200, 503] for "any of"
//   bodyContains:  string or array — substring(s) the response text must include
//   bodyMissing:   string or array — substring(s) that MUST NOT appear
//   jsonHas:       object — every key/value must exist in the response json
//   jsonHasKey:    string or array — key(s) the response json must define
//   custom:        (res) => string | null — return an error message, or null to pass
export function evaluate({ name, res, expect: ex = {}, category, route, ref }) {
  const errors = [];

  if (ex.status !== undefined) {
    const wanted = Array.isArray(ex.status) ? ex.status : [ex.status];
    if (!wanted.includes(res.status)) {
      errors.push(
        `status: expected ${wanted.join("|")} got ${res.status}` +
          (res.error ? ` (network: ${res.error})` : "")
      );
    }
  }

  if (ex.bodyContains) {
    const list = Array.isArray(ex.bodyContains)
      ? ex.bodyContains
      : [ex.bodyContains];
    for (const needle of list) {
      if (!res.text.includes(needle)) {
        errors.push(`bodyContains: missing "${needle}"`);
      }
    }
  }

  if (ex.bodyMissing) {
    const list = Array.isArray(ex.bodyMissing)
      ? ex.bodyMissing
      : [ex.bodyMissing];
    for (const needle of list) {
      if (res.text.includes(needle)) {
        errors.push(`bodyMissing: unwanted "${needle}" present`);
      }
    }
  }

  if (ex.jsonHasKey) {
    const list = Array.isArray(ex.jsonHasKey)
      ? ex.jsonHasKey
      : [ex.jsonHasKey];
    for (const key of list) {
      if (!res.json || !(key in res.json)) {
        errors.push(`jsonHasKey: missing "${key}"`);
      }
    }
  }

  if (ex.jsonHas) {
    for (const [k, v] of Object.entries(ex.jsonHas)) {
      if (!res.json || res.json[k] !== v) {
        errors.push(
          `jsonHas: expected ${k}=${JSON.stringify(v)} got ${
            res.json ? JSON.stringify(res.json[k]) : "<no json>"
          }`
        );
      }
    }
  }

  if (typeof ex.custom === "function") {
    const reason = ex.custom(res);
    if (reason) errors.push(`custom: ${reason}`);
  }

  return {
    name,
    category: category ?? "general",
    route: route ?? "—",
    ref: ref ?? null,
    pass: errors.length === 0,
    errors,
    status: res.status,
    ms: res.ms,
    network: res.error ?? null,
  };
}

// ---------------------------------------------------------------------------
// Small builders shared across scenarios
// ---------------------------------------------------------------------------

export const ids = {
  txn: () => randomUUID(),
  msg: () => randomUUID(),
};

export const minimalContext = ({
  action,
  bppId = "buyer-side-test.bpp.example",
  bppUri = "https://bpp.example",
  transactionId,
  messageId,
  domain = "ONDC:RET10",
  countryCode = "IND",
  cityCode = "std:080",
  ttl = "PT30S",
} = {}) => ({
  domain,
  country: countryCode,
  city: cityCode,
  action,
  core_version: "1.2.0",
  bap_id: "test-bap.example",
  bap_uri: "https://test-bap.example",
  bpp_id: bppId,
  bpp_uri: bppUri,
  transaction_id: transactionId ?? ids.txn(),
  message_id: messageId ?? ids.msg(),
  timestamp: new Date(0).toISOString(),
  ttl,
});
