// Dev-only synthesizer for an on_confirm-stage OrderRecord.
//
// Why this exists: the ONDC workbench's BPP simulator sometimes never dispatches
// on_confirm even after a clean confirm ACK, blocking downstream BAP code that
// needs an orderId (track / status / cancel). This route writes the order record
// straight into the store so the rest of the lifecycle can be exercised locally
// without depending on the workbench bot.
//
// Refuses to run unless explicitly enabled via ONDC_ENABLE_DEBUG_ROUTES=true.
// Never enable that flag in any non-dev environment.
import { NextResponse } from "next/server";
import { saveConfirmOrder } from "@/lib/ondc/store";

export const runtime = "nodejs";

type SeedBody = {
  transactionId?: string;
  bppId?: string;
  bppUri?: string;
  orderId?: string;
  state?: unknown;
  order?: unknown;
  quote?: unknown;
  fulfillments?: unknown;
  messageId?: string;
};

export async function POST(req: Request) {
  if (process.env.ONDC_ENABLE_DEBUG_ROUTES !== "true") {
    return NextResponse.json(
      { error: "debug routes disabled (set ONDC_ENABLE_DEBUG_ROUTES=true to enable)" },
      { status: 404 }
    );
  }

  let body: SeedBody;
  try {
    body = (await req.json()) as SeedBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const {
    transactionId,
    bppId,
    bppUri,
    orderId,
    state = { descriptor: { code: "Accepted" } },
    order,
    quote,
    fulfillments,
    messageId = `seed-${Date.now()}`,
  } = body;

  if (!transactionId || !bppId || !bppUri || !orderId || !order || !fulfillments) {
    return NextResponse.json(
      {
        error:
          "transactionId, bppId, bppUri, orderId, order and fulfillments are required",
      },
      { status: 400 }
    );
  }

  await saveConfirmOrder({
    transactionId,
    messageId,
    bppId,
    bppUri,
    orderId,
    state,
    order,
    quote,
    fulfillments,
  });

  return NextResponse.json({
    seeded: true,
    transactionId,
    bppId,
    orderId,
    stage: "confirm",
  });
}
