// Outbound BAP → SNP `catalog_rejection` callback.
//
// Per RET 1.2.5 Catalog Validation & Rejection Flow (workbench tooltip:
// "Buyer rejects catalog partially/fully with item/store-level rejection
// details & reason codes"), after the BAP ACKs an /on_search it MUST post a
// follow-up `catalog_rejection` envelope to the SNP listing the rejected
// providers / locations / items with reason codes.
//
// Wire shape — same envelope as /on_search NACK in the contract:
//   { context: { action: "catalog_rejection", ... },
//     message: { ack: { status: "NACK" } },
//     error:   { type, code, message } }
//
// The poster is fire-and-forget from the /on_search handler's perspective:
// it must NEVER block the sync ACK to the SNP. Failures are logged, not
// thrown, so a flaky callback channel doesn't poison legitimate catalog
// ingestion.
import { buildContext } from "@/lib/ondc/context";
import { sendOndcRequest, type OndcError } from "@/lib/ondc/client";

export type PostCatalogRejectionParams = {
  // Identifies the SNP we're calling back. Echoed into context.bpp_id /
  // context.bpp_uri so the SNP can join this rejection to its on_search.
  bppId: string;
  bppUri: string;

  // The discovery session — must match the original /search and /on_search
  // so the workbench can pair the rejection with the catalog it rejected.
  transactionId: string;

  // City the BPP served in /on_search; passes through to keep registry-aware
  // routing consistent with the inbound callback.
  city?: string;

  // The error block to mirror back. Built by validateCatalog().
  error: OndcError;
};

// Resolve the URL to POST to. The contract pattern across actions is
// {bpp_uri}/{action}, e.g. /search → bpp_uri + "/search", /on_search →
// bap_uri + "/on_search". Same for catalog_rejection.
function rejectionUrl(bppUri: string): string {
  const trimmed = bppUri.replace(/\/+$/, "");
  return `${trimmed}/catalog_rejection`;
}

// Fire the outbound. Never throws — surface failures via logs only so the
// /on_search ACK is unaffected by a flaky SNP endpoint.
export async function postCatalogRejection(
  params: PostCatalogRejectionParams
): Promise<void> {
  const { bppId, bppUri, transactionId, city, error } = params;
  const url = rejectionUrl(bppUri);

  try {
    const context = buildContext({
      action: "catalog_rejection",
      transactionId,
      // A fresh message_id for the outbound (it's a NEW message, not a reply).
      bppId,
      bppUri,
      // city only when we have one — buildContext falls back to config city.
      ...(city ? { city } : {}),
    });

    // The "message" body for a NACK envelope is just the ack envelope; the
    // error block lives at the top level of the body alongside { context,
    // message }. sendOndcRequest signs over the full body it builds, so we
    // pass the ack envelope as `message` and rely on the contract's
    // top-level error being inside the JSON the client serializes.
    //
    // sendOndcRequest hardcodes `JSON.stringify({ context, message })`, which
    // means a top-level `error` sibling won't be included. We work around
    // that by stuffing the error INSIDE the message envelope — every ONDC
    // verifier we've tested accepts message.error as a synonym for top-level
    // error on async callbacks. If a stricter verifier needs the top-level
    // location, we can switch to a custom POST here; keeping it within the
    // shared signer for now avoids a parallel signing path.
    const message = {
      ack: { status: "NACK" as const },
      error,
    };

    const response = await sendOndcRequest({
      url,
      action: "catalog_rejection",
      context,
      message,
    });

    console.log("ondc.catalog_rejection posted", {
      url,
      transactionId,
      bppId,
      errorCode: error.code,
      errorType: error.type,
      // The SNP usually ACKs the rejection callback. NACK is fine too — it
      // just means the SNP refused to record our rejection, not that we
      // failed to send it.
      remoteStatus: response.status,
    });
  } catch (err) {
    const e = err instanceof Error ? err : null;
    console.error("ondc.catalog_rejection post failed", {
      url,
      transactionId,
      bppId,
      errorCode: error.code,
      message: e?.message ?? String(err),
    });
  }
}
