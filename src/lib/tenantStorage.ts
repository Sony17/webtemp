import fs from "node:fs/promises";
import path from "node:path";
import { put, list, del, head } from "@vercel/blob";

// Multi-tenant file storage abstraction.
// - Vercel Blob when BLOB_READ_WRITE_TOKEN is set (prod)
// - Local filesystem under data/tenants/ otherwise (dev)

const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
const LOCAL_ROOT = path.join(process.cwd(), "data", "tenants");

// Committed-tenant roots: drop an `index.html` (plus assets) into
// `tenants/<sub>/` or `public/<sub>/` and the site goes live at
// `<sub>.openidea.co.in`. Read-only — the admin upload flow still writes to
// blob (prod) or `data/tenants/<sub>/` (dev).
const COMMITTED_ROOTS = [
  path.join(process.cwd(), "tenants"),
  path.join(process.cwd(), "public"),
];

function tenantKey(subdomain: string, filePath: string) {
  const clean = filePath.replace(/^\/+/, "");
  return `tenants/${subdomain}/${clean}`;
}

function cleanRelPath(filePath: string) {
  return filePath.replace(/^\/+/, "").replace(/\.\./g, "");
}

function localFilePath(subdomain: string, filePath: string) {
  return path.join(LOCAL_ROOT, subdomain, cleanRelPath(filePath));
}

async function readCommittedFile(subdomain: string, filePath: string) {
  const rel = cleanRelPath(filePath);
  for (const root of COMMITTED_ROOTS) {
    try {
      const buf = await fs.readFile(path.join(root, subdomain, rel));
      return new Uint8Array(buf);
    } catch {
      // try next root
    }
  }
  return null;
}

export async function putTenantFile(
  subdomain: string,
  filePath: string,
  body: ArrayBuffer | Uint8Array | Buffer | Blob,
  contentType?: string
): Promise<void> {
  const buf =
    body instanceof Blob
      ? Buffer.from(await body.arrayBuffer())
      : body instanceof ArrayBuffer
        ? Buffer.from(body)
        : body instanceof Uint8Array
          ? Buffer.from(body)
          : body;

  if (useBlob) {
    await put(tenantKey(subdomain, filePath), buf, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType,
    });
    return;
  }

  const target = localFilePath(subdomain, filePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buf);
}

export async function getTenantFile(
  subdomain: string,
  filePath: string
): Promise<{ body: Uint8Array; contentType: string } | null> {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeFor(ext);

  if (useBlob) {
    const key = tenantKey(subdomain, filePath);
    try {
      const meta = await head(key);
      if (meta?.url) {
        const res = await fetch(meta.url);
        if (res.ok) {
          const ab = await res.arrayBuffer();
          return { body: new Uint8Array(ab), contentType: meta.contentType ?? contentType };
        }
      }
    } catch {
      // fall through to committed roots
    }
  } else {
    try {
      const buf = await fs.readFile(localFilePath(subdomain, filePath));
      return { body: new Uint8Array(buf), contentType };
    } catch {
      // fall through to committed roots
    }
  }

  const committed = await readCommittedFile(subdomain, filePath);
  if (committed) return { body: committed, contentType };
  return null;
}

export async function deleteTenantFiles(subdomain: string): Promise<void> {
  if (useBlob) {
    const prefix = `tenants/${subdomain}/`;
    let cursor: string | undefined = undefined;
    // Page through and delete in batches.
    while (true) {
      const page: Awaited<ReturnType<typeof list>> = await list({ prefix, cursor });
      if (page.blobs.length) await del(page.blobs.map((b) => b.url));
      if (!page.cursor) break;
      cursor = page.cursor;
    }
    return;
  }

  try {
    await fs.rm(path.join(LOCAL_ROOT, subdomain), { recursive: true, force: true });
  } catch {
    // ignore
  }
}

export function mimeFor(ext: string): string {
  const map: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".pdf": "application/pdf",
    ".txt": "text/plain; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
    ".map": "application/json; charset=utf-8",
  };
  return map[ext] ?? "application/octet-stream";
}
