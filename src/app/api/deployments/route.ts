import { NextResponse } from "next/server";
import { createDeployment, listDeployments } from "@/lib/deployments";

export const runtime = "nodejs";

export async function GET() {
  const items = await listDeployments();
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { subdomain, templateSlug, brandName, primaryColor } =
    (body ?? {}) as Record<string, string | undefined>;

  if (!subdomain || !templateSlug) {
    return NextResponse.json(
      { error: "subdomain and templateSlug are required" },
      { status: 400 }
    );
  }

  try {
    const deployment = await createDeployment({
      subdomain,
      templateSlug,
      brandName,
      primaryColor,
    });
    return NextResponse.json({ deployment }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
