// ONDC registry /on_subscribe — the encrypted-challenge proof of liveness.
//
// During /subscribe (initial registration OR rotation), the ONDC registry
// proves we hold the encryption private key paired with the public key we
// just registered. It does this by POSTing here with an AES-encrypted
// challenge string; we decrypt it and echo the plaintext as `answer`. The
// registry compares its expected plaintext to our `answer` — if they match,
// the subscription is approved.
//
// Crypto details (per ONDC's developer-docs registration section):
//   1. Both sides have X25519 key pairs. We registered our X25519 public key
//      via ONDC_ENCRYPTION_PUBLIC_KEY; the registry's public key per network
//      is hardcoded in src/lib/ondc/config.ts (NETWORK_DEFAULTS).
//   2. The shared secret is computed via Diffie-Hellman on the two X25519
//      keys (Node's crypto.diffieHellman). Result is a 32-byte secret.
//   3. The registry AES-256-ECB encrypts the challenge string with that 32-
//      byte shared secret as the key (no IV; ECB mode is what ONDC
//      specifies, idiosyncratic but documented). PKCS#7 padding.
//   4. We do the inverse: decrypt the base64 ciphertext with the same shared
//      secret and return the plaintext as `answer`.
//
// Without this endpoint live + correct, any /subscribe attempt (including
// key rotation) silently fails — the registry retries, times out, marks the
// subscription failed.
import { NextResponse } from "next/server";
import {
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
} from "node:crypto";
import { getOndcConfig, isOndcConfigured } from "@/lib/ondc/config";

export const runtime = "nodejs";

type OnSubscribeBody = {
  challenge?: string;
};

// Decrypt the registry's AES-256-ECB-encrypted challenge with the X25519
// shared secret as the key. Throws on any crypto failure (the caller maps
// it to a 400 — the registry will see we couldn't fulfill the challenge).
function decryptChallenge(challengeBase64: string): string {
  const config = getOndcConfig();

  // X25519 keys in this codebase are stored either as bare 32-byte raw or as
  // DER-wrapped SPKI/PKCS#8 — the `MC...` base64 prefix in .env.local is the
  // DER form. Node's createPublicKey/PrivateKey on `format: "der"` handles
  // the DER case; for raw 32 bytes we'd need to wrap. The existing config
  // ships DER form, so we take that path.
  const ourPrivateKey = createPrivateKey({
    key: Buffer.from(config.secrets.encryptionPrivateKey, "base64"),
    format: "der",
    type: "pkcs8",
  });
  const registryPublicKey = createPublicKey({
    key: Buffer.from(config.registryEncryptionPublicKey, "base64"),
    format: "der",
    type: "spki",
  });

  // X25519 ECDH → 32-byte shared secret. This is the AES key per ONDC's spec.
  const sharedSecret = diffieHellman({
    privateKey: ourPrivateKey,
    publicKey: registryPublicKey,
  });

  // AES-256-ECB, no IV. Auto PKCS#7 padding so we strip it on `final()`.
  const decipher = createDecipheriv("aes-256-ecb", sharedSecret, null);
  decipher.setAutoPadding(true);

  const ciphertext = Buffer.from(challengeBase64, "base64");
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8"
  );
}

export async function POST(req: Request) {
  if (!isOndcConfigured()) {
    return NextResponse.json(
      { error: "ONDC is not configured on this server." },
      { status: 503 }
    );
  }

  let body: OnSubscribeBody;
  try {
    body = (await req.json()) as OnSubscribeBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const challenge = body?.challenge?.trim();
  if (!challenge) {
    return NextResponse.json(
      { error: "missing challenge" },
      { status: 400 }
    );
  }

  let answer: string;
  try {
    answer = decryptChallenge(challenge);
  } catch (err) {
    console.warn("ondc.on_subscribe decrypt failed", {
      msg: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "could not decrypt challenge" },
      { status: 400 }
    );
  }

  console.log("ondc.on_subscribe answered", {
    challengeLen: challenge.length,
    answerLen: answer.length,
  });

  return NextResponse.json({ answer }, { status: 200 });
}
