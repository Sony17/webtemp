import { NextResponse } from "next/server";
import { verifyConnection } from "@/lib/tocxi/service";

export async function GET() {
  try {
    const result = await verifyConnection();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[Tocxi Verify Connection]", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
