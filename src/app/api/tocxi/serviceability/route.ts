import { NextRequest, NextResponse } from "next/server";
import { checkServiceability } from "@/lib/tocxi/service";
import { validateServiceabilityQuote } from "@/lib/tocxi/validation";

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    const validation = validateServiceabilityQuote(body as Parameters<typeof validateServiceabilityQuote>[0]);
    if (!validation.valid) {
      return NextResponse.json(
        { error: "Validation failed", details: validation.errors },
        { status: 400 }
      );
    }

    const result = await checkServiceability(body as Parameters<typeof checkServiceability>[0]);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[Tocxi Serviceability]", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
