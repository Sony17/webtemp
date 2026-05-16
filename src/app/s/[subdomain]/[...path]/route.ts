import { NextResponse } from "next/server";
import { getDeployment } from "@/lib/deployments";
import { getTenantFile } from "@/lib/tenantStorage";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ subdomain: string; path: string[] }> }
) {
  const { subdomain, path: parts } = await params;
  const deployment = await getDeployment(subdomain);
  if (!deployment) return new NextResponse("Not found", { status: 404 });
  if (deployment.type !== "uploaded")
    return new NextResponse("Not an uploaded site", { status: 404 });

  const requested = (parts ?? []).join("/") || deployment.entryFile || "index.html";
  const file = await getTenantFile(subdomain, requested);

  // SPA fallback: if the file doesn't exist and there's no extension,
  // serve the entry HTML so client-side routers can take over.
  if (!file && !/\.[a-zA-Z0-9]+$/.test(requested)) {
    const entry = deployment.entryFile || "index.html";
    const fallback = await getTenantFile(subdomain, entry);
    if (fallback) {
      return new NextResponse(fallback.body as BodyInit, {
        status: 200,
        headers: {
          "Content-Type": fallback.contentType,
          "Cache-Control": "public, max-age=60, s-maxage=60",
        },
      });
    }
  }

  if (!file) return new NextResponse("File not found", { status: 404 });

  return new NextResponse(file.body as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
