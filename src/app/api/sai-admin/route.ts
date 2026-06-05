import { NextResponse } from "next/server";
import { getSaiContent, writeSaiContent, type SaiContent } from "@/lib/saiContent";

export const runtime = "nodejs";

export async function GET() {
  try {
    const content = await getSaiContent();
    return NextResponse.json(content);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to read sai content";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (process.env.VERCEL) {
    return NextResponse.json(
      {
        error:
          "Sai admin writes directly to tenants/sai/index.html, which is read-only on Vercel. Run locally to edit, then commit.",
      },
      { status: 503 }
    );
  }

  let body: SaiContent;
  try {
    body = (await req.json()) as SaiContent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || !body.hero || !body.contact || !Array.isArray(body.products)) {
    return NextResponse.json({ error: "Malformed payload" }, { status: 400 });
  }

  try {
    await writeSaiContent(body);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to write sai content";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
