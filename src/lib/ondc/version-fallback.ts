// Core-version VALUE fallback for directed BAP actions (select/init/confirm).
//
// WHY THIS EXISTS. We send every directed action with `core_version: "1.2.5"`
// (the network default). Most sellers accept it. But at least one PRODUCTION
// seller (seller.easypay.co.in) is still on ONDC RET 1.2.0 and rejects a
// directed `select` at 1.2.5 with error 50004 "Core version not supported.
// Required 1.2.0 or more". Empirically verified against the live seller
// (2026-08-04): the field NAME is right — sending the version under `version`
// instead makes it worse (30000 "$.context.core_version is missing but
// required") — the seller simply wants the older VALUE, 1.2.0. Retrying the
// exact same select at `core_version: "1.2.0"` gets an ACK; a control seller on
// 1.2.5 (seller.udyamwell.in) ACKs the first 1.2.5 attempt and never triggers
// the retry.
//
// THE FIX (contained, no persistence, no schema change). Send the default 1.2.5
// envelope first. ONLY if the seller NACKs it as an unsupported core version do
// we rebuild the SAME message at 1.2.0 and resend once. Sellers that already
// work never see a second request; a 1.2.0 seller gets the version it wants. If
// the 1.2.0 retry also fails, we surface the failure and the buyer-facing copy
// handles it — no regression either way. (A 1.2.0 seller needs this on init and
// confirm too, so those routes wrap the same helper; without per-seller
// persistence each step independently pays one extra request for such sellers.)
import "server-only";
import {
  buildContext,
  type BuildContextParams,
  type OndcContext,
} from "@/lib/ondc/context";
import {
  sendOndcRequest,
  type OndcError,
  type OndcResponse,
} from "@/lib/ondc/client";

// The older core version we retry at when a seller rejects our 1.2.5 default.
const FALLBACK_CORE_VERSION = "1.2.0";

// Detect a NACK that specifically rejects our context's core-version VALUE (not
// a business rejection). Deliberately narrow so a normal NACK — item
// unavailable, not serviceable, minimum order value — never triggers a retry.
// Matches the observed ONDC code (50004) and, defensively, version-phrased
// messages from sellers that use a different/absent code.
export function isVersionFieldNack(error?: OndcError): boolean {
  if (!error) return false;
  const code = (error.code ?? "").trim();
  if (code === "50004") return true; // ONDC "core version not supported"
  const msg = (error.message ?? "").toLowerCase();
  return (
    msg.includes("version") &&
    (msg.includes("not supported") ||
      msg.includes("required") ||
      msg.includes("unsupported"))
  );
}

export type VersionFallbackResult = {
  // The response to surface to the caller (ACK on success; the more specific
  // NACK when both attempts were rejected).
  result: OndcResponse;
  // The context actually used for `result`, so the route echoes the matching
  // transaction_id / message_id and can log the core version that won.
  context: OndcContext;
  // True when the 1.2.0 retry was what produced `result` (ACK or NACK). Lets the
  // route log that this seller needed the non-default core version.
  usedVersionFallback: boolean;
};

// Send a directed action with automatic core-version fallback. `contextParams`
// is everything buildContext needs EXCEPT coreVersion (this helper owns that).
export async function sendDirectedWithVersionFallback<TMessage>(args: {
  url: string;
  action: BuildContextParams["action"];
  contextParams: Omit<BuildContextParams, "coreVersion">;
  message: TMessage;
  sendDigestHeader?: boolean;
}): Promise<VersionFallbackResult> {
  const send = (context: OndcContext) =>
    sendOndcRequest<TMessage>({
      url: args.url,
      action: args.action,
      context,
      message: args.message,
      sendDigestHeader: args.sendDigestHeader,
    });

  // Attempt 1: the default core version (1.2.5).
  const primaryContext = buildContext(args.contextParams);
  const primary = await send(primaryContext);
  if (primary.status !== "NACK" || !isVersionFieldNack(primary.error)) {
    return { result: primary, context: primaryContext, usedVersionFallback: false };
  }

  // Attempt 2: identical message + transaction, but declare core version 1.2.0.
  // A fresh message_id is minted inside buildContext.
  const altContext = buildContext({
    ...args.contextParams,
    coreVersion: FALLBACK_CORE_VERSION,
  });
  let alt: OndcResponse;
  try {
    alt = await send(altContext);
  } catch {
    // The retry transport-failed (timeout/network). Surface the original,
    // well-formed version NACK rather than a transport error — the caller gets
    // a clean 422 and the buyer sees the friendly "try another seller" copy.
    return { result: primary, context: primaryContext, usedVersionFallback: false };
  }
  return { result: alt, context: altContext, usedVersionFallback: true };
}
