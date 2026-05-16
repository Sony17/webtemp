import fs from "node:fs/promises";
import path from "node:path";
import { deployments as seedDeployments, type Deployment as SeedDeployment } from "@/data/deployments";

// File-backed runtime store for tenant sites.
// - Local dev / any single-server host: full read/write works.
// - Vercel serverless: file writes won't persist; only seeded tenants stay
//   live. Swap the read/write below for Vercel KV / Postgres / Supabase
//   for production write-through.

export type Deployment = SeedDeployment & {
  id: string;
  deployedAt: number;
};

const DATA_FILE = path.join(process.cwd(), "data", "deployments.json");

const RESERVED = new Set([
  "www", "admin", "api", "app", "preview", "console", "login", "s",
]);

export function slugifySubdomain(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

// Seeds get deterministic ids so the admin UI can delete/edit them too.
function seedAsDeployments(): Deployment[] {
  return seedDeployments.map((s) => ({
    ...s,
    id: `seed-${s.subdomain}`,
    deployedAt: 0,
  }));
}

async function readFileStore(): Promise<Deployment[]> {
  try {
    const buf = await fs.readFile(DATA_FILE, "utf-8");
    const parsed = JSON.parse(buf);
    return Array.isArray(parsed) ? (parsed as Deployment[]) : [];
  } catch {
    return [];
  }
}

async function writeFileStore(list: Deployment[]) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(list, null, 2));
}

export async function listDeployments(): Promise<Deployment[]> {
  // File store wins on subdomain collisions (admin overrides seed).
  const fileList = await readFileStore();
  const subs = new Set(fileList.map((d) => d.subdomain));
  const merged = [
    ...fileList,
    ...seedAsDeployments().filter((s) => !subs.has(s.subdomain)),
  ];
  return merged.sort((a, b) => b.deployedAt - a.deployedAt);
}

export async function getDeployment(subdomain: string): Promise<Deployment | null> {
  const sub = slugifySubdomain(subdomain);
  const all = await listDeployments();
  return all.find((d) => d.subdomain === sub) ?? null;
}

export async function createDeployment(input: {
  subdomain: string;
  templateSlug: string;
  brandName?: string;
  tagline?: string;
  primaryColor?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  hours?: string;
}): Promise<Deployment> {
  const sub = slugifySubdomain(input.subdomain);
  if (sub.length < 3) throw new Error("Subdomain must be at least 3 characters.");
  if (RESERVED.has(sub)) throw new Error(`'${sub}' is reserved and cannot be used.`);

  const all = await listDeployments();
  if (all.some((d) => d.subdomain === sub))
    throw new Error(`${sub}.openidea.co.in is already deployed.`);

  const d: Deployment = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    subdomain: sub,
    templateSlug: input.templateSlug,
    brandName: input.brandName?.trim() || sub,
    tagline: input.tagline?.trim() || undefined,
    primaryColor: input.primaryColor || undefined,
    phone: input.phone?.trim() || undefined,
    email: input.email?.trim() || undefined,
    address: input.address?.trim() || undefined,
    city: input.city?.trim() || undefined,
    hours: input.hours?.trim() || undefined,
    deployedAt: Date.now(),
  };

  const fileList = await readFileStore();
  await writeFileStore([d, ...fileList]);
  return d;
}

export async function deleteDeployment(id: string): Promise<boolean> {
  if (id.startsWith("seed-")) {
    throw new Error("Seed tenants are read-only. Edit src/data/deployments.ts to remove.");
  }
  const fileList = await readFileStore();
  const next = fileList.filter((d) => d.id !== id);
  if (next.length === fileList.length) return false;
  await writeFileStore(next);
  return true;
}
