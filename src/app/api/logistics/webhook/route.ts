// Tocxi inbound status webhook — the critical trust boundary.
//
//   POST /api/logistics/webhook
//   Headers: X-Tocxi-Event: shipment.status
//            X-Tocxi-Signature: <hex HMAC-SHA256 of the RAW body, webhook secret>
//   Body:    { event, shipmentId, partnerReference, status, awbNo?, timestamp? }
//
// Tocxi POSTs here on EVERY status change. Order of operations, no shortcuts:
//   (a) read the EXACT raw body bytes (the signature is over these bytes — a
//       JSON.parse→stringify round-trip would reorder keys and break the digest);
//   (b) verify X-Tocxi-Signature (timing-safe HMAC) → 401 on mismatch, BEFORE
//       trusting anything in the body;
//   (c) parse + validate the event;
//   (d) advance our ledger IDEMPOTENTLY (store.updateShipmentStatus ignores
//       duplicate / out-of-order events — see shouldAdvanceStatus);
//   (e) return 2xx fast; defer nothing heavy (the update is already cheap).
//
// Delivery is AT-LEAST-ONCE and retried, so this handler must be safe to receive
// the same event twice: replaying an event leaves exactly one status-history
// entry and still returns 200. A 2xx acknowledges; any non-2xx makes Tocxi retry.
import { NextResponse } from "next/server";
import { isTocxiWebhookConfigured } from "@/lib/logistics/config";
import { verifyTocxiSignature } from "@/lib/logistics/webhook";
import { updateShipmentStatus } from "@/lib/logistics/store";
import { isShipmentStatus } from "@/lib/logistics/types";
import type { WebhookEvent } from "@/lib/logistics/types";

// node:crypto (signature verify) + the server-only store → Node runtime.
export const runtime = "nodejs";

export async function POST(req: Request) {
  // Without a webhook secret we cannot authenticate Tocxi — refuse rather than
  // trust an unsigned body. 503 (not 401) signals "our side isn't configured".
  if (!isTocxiWebhookConfigured()) {
    return NextResponse.json(
      { error: "Webhook not configured." },
      { status: 503 }
    );
  }

  // (a) Read the exact raw bytes — this is what Tocxi signed.
  const rawBody = await req.text();

  // (b) Verify BEFORE parsing/trusting. A flat 401 on any failure (missing
  //     header, bad hex, genuine mismatch) — never leak which check failed.
  const signature = req.headers.get("x-tocxi-signature");
  if (!verifyTocxiSignature(rawBody, signature)) {
    console.warn("logistics.webhook signature rejected");
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  // (c) Now that the body is trusted, parse + validate it.
  let payload: WebhookEvent;
  try {
    payload = JSON.parse(rawBody) as WebhookEvent;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const shipmentId =
    typeof payload.shipmentId === "string" ? payload.shipmentId.trim() : "";
  const partnerReference =
    typeof payload.partnerReference === "string"
      ? payload.partnerReference.trim()
      : "";
  if (!shipmentId && !partnerReference) {
    return NextResponse.json(
      { error: "missing shipmentId / partnerReference" },
      { status: 400 }
    );
  }
  if (!isShipmentStatus(payload.status)) {
    return NextResponse.json({ error: "unknown status" }, { status: 400 });
  }

  // (d) Advance the ledger idempotently. Resolve by EITHER key Tocxi sent.
  //     A duplicate / out-of-order event is a no-op inside the store. A miss
  //     (no such shipment) still returns 200 so Tocxi stops retrying an event we
  //     genuinely don't recognize — we log it for investigation instead.
  try {
    const updated = await updateShipmentStatus({
      partnerReference: partnerReference || undefined,
      shipmentId: shipmentId || undefined,
      status: payload.status,
      awbNo: typeof payload.awbNo === "string" ? payload.awbNo : undefined,
      eventTimestamp:
        typeof payload.timestamp === "string" ? payload.timestamp : undefined,
    });
    if (!updated) {
      console.warn("logistics.webhook no matching shipment", {
        shipmentId,
        partnerReference,
        status: payload.status,
      });
    } else {
      console.log("logistics.webhook applied", {
        shipmentId: updated.shipmentId,
        partnerReference: updated.partnerReference,
        status: updated.status,
      });
    }
  } catch (err) {
    // A store fault is OUR problem — return 500 so Tocxi retries (at-least-once
    // + idempotent update means a retry is safe and eventually lands).
    console.error("logistics.webhook persist fault", {
      shipmentId,
      partnerReference,
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "persist failed" }, { status: 500 });
  }

  // (e) Acknowledge.
  return NextResponse.json({ ok: true }, { status: 200 });
}
