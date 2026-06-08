import { NextResponse } from "next/server";
import { getCatalogs } from "@/lib/ondc/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const transactionId = new URL(req.url).searchParams
    .get("transactionId")
    ?.trim();

  if (!transactionId) {
    return NextResponse.json(
      { error: "transactionId is required" },
      { status: 400 }
    );
  }

  try {
    const catalogs = await getCatalogs(transactionId);
    const latest = catalogs.reduce(
      (newest, catalog) =>
        !newest || catalog.receivedAt > newest.receivedAt ? catalog : newest,
      undefined as (typeof catalogs)[number] | undefined
    );

    return NextResponse.json(
      {
        transactionId,
        callbackObserved: catalogs.length > 0,
        catalogCount: catalogs.length,
        latestReceivedAt: latest
          ? new Date(latest.receivedAt).toISOString()
          : null,
      },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
