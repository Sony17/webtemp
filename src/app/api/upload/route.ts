import { NextResponse } from "next/server";
import path from "node:path";
import JSZip from "jszip";
import { createDeployment, slugifySubdomain } from "@/lib/deployments";
import { putTenantFile, mimeFor } from "@/lib/tenantStorage";

export const runtime = "nodejs";
export const maxDuration = 60;

const SAFE_FILE_RE = /^[A-Za-z0-9._\-/]+$/;

function isSafePath(p: string) {
  if (!SAFE_FILE_RE.test(p)) return false;
  if (p.includes("..")) return false;
  if (p.startsWith("/")) return false;
  return true;
}

export async function POST(req: Request) {
  // On Vercel, the filesystem is read-only; we need Blob storage configured.
  // If running on Vercel without a Blob token, fail fast with an actionable message.
  if (process.env.VERCEL && !process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      {
        error:
          "Vercel Blob is not connected to this project. In the Vercel dashboard go to Storage → Blob → Connect, then redeploy.",
      },
      { status: 503 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const subdomainRaw = String(form.get("subdomain") ?? "");
  const brandName = String(form.get("brandName") ?? "");
  const file = form.get("file");

  if (!(file instanceof File))
    return NextResponse.json({ error: "Missing 'file' (zip)" }, { status: 400 });

  const subdomain = slugifySubdomain(subdomainRaw);
  if (subdomain.length < 3)
    return NextResponse.json(
      { error: "Subdomain must be at least 3 characters." },
      { status: 400 }
    );

  let zip: JSZip;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    zip = await JSZip.loadAsync(buf);
  } catch {
    return NextResponse.json({ error: "Could not read zip file." }, { status: 400 });
  }

  // Walk all files, normalising paths and skipping junk.
  const entries: { path: string; data: Uint8Array }[] = [];
  let totalBytes = 0;
  let entryFile: string | undefined;

  // Detect a single top-level dir (e.g. zips made on macOS often wrap content).
  const topDirs = new Set<string>();
  for (const name of Object.keys(zip.files)) {
    const f = zip.files[name];
    if (f.dir) continue;
    const segs = name.split("/").filter(Boolean);
    if (segs.length > 1) topDirs.add(segs[0]);
    else topDirs.add("");
  }
  const stripPrefix =
    topDirs.size === 1 && [...topDirs][0] && [...topDirs][0] !== "__MACOSX"
      ? [...topDirs][0] + "/"
      : "";

  for (const [name, f] of Object.entries(zip.files)) {
    if (f.dir) continue;
    if (name.startsWith("__MACOSX/") || name.split("/").pop()?.startsWith("._")) continue;

    let rel = stripPrefix && name.startsWith(stripPrefix) ? name.slice(stripPrefix.length) : name;
    rel = rel.replace(/\\/g, "/");

    if (!isSafePath(rel)) continue;

    const data = await f.async("uint8array");
    totalBytes += data.byteLength;
    entries.push({ path: rel, data });

    const lower = rel.toLowerCase();
    if (lower === "index.html" || lower.endsWith("/index.html")) {
      // prefer the shallowest index.html as entry
      if (!entryFile || rel.split("/").length < entryFile.split("/").length) {
        entryFile = rel;
      }
    }
  }

  if (entries.length === 0)
    return NextResponse.json({ error: "Zip contained no usable files." }, { status: 400 });
  if (!entryFile)
    return NextResponse.json(
      { error: "Could not find an index.html in the zip." },
      { status: 400 }
    );

  const MAX_TOTAL = 50 * 1024 * 1024; // 50 MB hard cap per upload
  if (totalBytes > MAX_TOTAL)
    return NextResponse.json(
      { error: `Zip is ${(totalBytes / 1024 / 1024).toFixed(1)} MB; max is 50 MB.` },
      { status: 413 }
    );

  // Create deployment record first so subdomain is reserved.
  let deployment;
  try {
    deployment = await createDeployment({
      subdomain,
      type: "uploaded",
      brandName: brandName.trim() || subdomain,
      entryFile,
      fileCount: entries.length,
      totalBytes,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to create deployment";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Upload each file.
  for (const ent of entries) {
    const ct = mimeFor(path.extname(ent.path).toLowerCase());
    await putTenantFile(subdomain, ent.path, ent.data, ct);
  }

  return NextResponse.json({ deployment }, { status: 201 });
}
