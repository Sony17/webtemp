"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Brand from "@/components/Brand";
import { templates } from "@/data/templates";

type Deployment = {
  id: string;
  subdomain: string;
  templateSlug: string;
  brandName?: string;
  tagline?: string;
  primaryColor?: string;
  phone?: string;
  city?: string;
  deployedAt: number;
  type?: "template" | "uploaded";
  entryFile?: string;
  fileCount?: number;
  totalBytes?: number;
};

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

function formatTime(ts: number) {
  if (!ts) return "Seed";
  const d = new Date(ts);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminDashboard() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [subdomain, setSubdomain] = useState("");
  const [templateSlug, setTemplateSlug] = useState(templates[0].slug);
  const [brandName, setBrandName] = useState("");
  const [mode, setMode] = useState<"template" | "upload">("template");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [justDeployed, setJustDeployed] = useState<Deployment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function refresh() {
    try {
      const res = await fetch("/api/deployments", { cache: "no-store" });
      const json = await res.json();
      setDeployments(json.items ?? []);
    } catch {
      // ignore — keep previous list
    }
  }

  // Auth gate + initial load
  useEffect(() => {
    let authed = false;
    try {
      authed = localStorage.getItem("oi_admin") === "1";
    } catch {
      // ignore
    }
    if (!authed) {
      router.replace("/admin/login");
      return;
    }
    refresh().then(() => setReady(true));
  }, [router]);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.slug === templateSlug) ?? templates[0],
    [templateSlug]
  );

  async function handleDeploy(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const slug = slugify(subdomain);
    if (slug.length < 3) {
      setError("Subdomain must be at least 3 characters (a-z, 0-9, hyphen).");
      return;
    }

    if (mode === "upload" && !uploadFile) {
      setError("Pick a .zip with at least an index.html.");
      return;
    }

    setSubmitting(true);
    try {
      let res: Response;
      if (mode === "upload") {
        const fd = new FormData();
        fd.set("subdomain", slug);
        fd.set("brandName", brandName);
        fd.set("file", uploadFile!);
        res = await fetch("/api/upload", { method: "POST", body: fd });
      } else {
        res = await fetch("/api/deployments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            subdomain: slug,
            templateSlug,
            brandName: brandName || undefined,
          }),
        });
      }
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to deploy");
        return;
      }
      const next = json.deployment as Deployment;
      setSubdomain("");
      setBrandName("");
      setUploadFile(null);
      setJustDeployed(next);
      setTimeout(() => setJustDeployed(null), 4000);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    if (id.startsWith("seed-")) {
      setError("Seed tenants are read-only. Edit src/data/deployments.ts to remove.");
      return;
    }
    try {
      const res = await fetch(`/api/deployments/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "Failed to delete");
        return;
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    }
  }

  function handleLogout() {
    try {
      localStorage.removeItem("oi_admin");
    } catch {
      // ignore
    }
    router.push("/admin/login");
  }

  if (!ready) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-50 text-sm text-zinc-500">
        Loading admin…
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Brand size="sm" />
            <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
              Admin
            </span>
          </div>
          <button
            onClick={handleLogout}
            className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
          >
            Logout
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">
            Multi-Tenant Deployments
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            Deploy a template or upload a .zip to a subdomain on{" "}
            <span className="font-mono text-zinc-900">openidea.co.in</span>.
          </p>
        </div>

        <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Templates" value={templates.length} />
          <Stat label="Live sites" value={deployments.length} />
          <Stat
            label="Last deploy"
            value={
              deployments[0]
                ? new Date(deployments[0].deployedAt).toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "short",
                  })
                : "—"
            }
          />
          <Stat label="Admin" value="admin" />
        </div>

        <section className="mb-10 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
          <form
            onSubmit={handleDeploy}
            className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
                New Multi-Tenant Deployment
              </h2>
              <div className="flex rounded-full bg-zinc-100 p-1 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setMode("template")}
                  className={`rounded-full px-3 py-1 transition ${
                    mode === "template" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500"
                  }`}
                >
                  Template
                </button>
                <button
                  type="button"
                  onClick={() => setMode("upload")}
                  className={`rounded-full px-3 py-1 transition ${
                    mode === "upload" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500"
                  }`}
                >
                  Upload .zip
                </button>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="subdomain" className="block text-sm font-medium text-zinc-700">
                  Subdomain
                </label>
                <div className="mt-1 flex">
                  <input
                    id="subdomain"
                    type="text"
                    required
                    value={subdomain}
                    onChange={(e) => setSubdomain(e.target.value)}
                    placeholder="sony"
                    className="block w-full rounded-l-lg border border-r-0 border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                  />
                  <span className="inline-flex items-center rounded-r-lg border border-l-0 border-zinc-300 bg-zinc-50 px-3 text-sm text-zinc-600">
                    .openidea.co.in
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  Preview: {" "}
                  <span className="font-mono text-zinc-700">
                    {slugify(subdomain) || "<your-subdomain>"}.openidea.co.in
                  </span>
                </p>
              </div>

              {mode === "template" ? (
                <div>
                  <label htmlFor="template" className="block text-sm font-medium text-zinc-700">
                    Template
                  </label>
                  <select
                    id="template"
                    value={templateSlug}
                    onChange={(e) => setTemplateSlug(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                  >
                    {templates.map((t) => (
                      <option key={t.slug} value={t.slug}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label htmlFor="upload" className="block text-sm font-medium text-zinc-700">
                    Project .zip (HTML / built React)
                  </label>
                  <input
                    id="upload"
                    type="file"
                    accept=".zip,application/zip,application/x-zip-compressed"
                    onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                    className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-zinc-700 hover:file:bg-zinc-200"
                  />
                  <p className="mt-1 text-xs text-zinc-500">
                    Must contain an <code className="font-mono">index.html</code>. Max 50 MB.
                  </p>
                </div>
              )}

              <div className="sm:col-span-2">
                <label htmlFor="brand" className="block text-sm font-medium text-zinc-700">
                  Brand name <span className="text-zinc-400">(optional — defaults to subdomain)</span>
                </label>
                <input
                  id="brand"
                  type="text"
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  placeholder="Sony's Mobile Care"
                  className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                />
              </div>
            </div>

            {error && (
              <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </div>
            )}

            {justDeployed && (
              <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                Deployed{" "}
                <span className="font-mono font-semibold">
                  {justDeployed.subdomain}.openidea.co.in
                </span>
                .
              </div>
            )}

            <div className="mt-6 flex justify-end">
              <button
                type="submit"
                disabled={submitting}
                className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "Deploying…" : "Deploy"}
              </button>
            </div>
          </form>

          <aside className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <div className="relative h-32 w-full">
              <Image
                src={selectedTemplate.image}
                alt={selectedTemplate.name}
                fill
                sizes="360px"
                className="object-cover"
              />
              <div
                className="absolute inset-0"
                style={{
                  background: `linear-gradient(180deg, rgba(0,0,0,0.1), rgba(0,0,0,0.55))`,
                }}
              />
              <div className="absolute bottom-3 left-4 text-white">
                <div className="text-[10px] font-bold uppercase tracking-wider opacity-90">
                  Selected
                </div>
                <div className="text-base font-bold">{selectedTemplate.name}</div>
              </div>
            </div>
            <div className="p-4">
              <p className="text-xs text-zinc-600">{selectedTemplate.tagline}</p>
              <ul className="mt-3 space-y-1 text-xs text-zinc-700">
                {selectedTemplate.commonFeatures.slice(0, 4).map((f) => (
                  <li key={f} className="flex items-start gap-1.5">
                    <CheckIcon className="mt-0.5 h-3 w-3 flex-shrink-0 text-emerald-600" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
              Live Sites
            </h2>
            <span className="text-xs text-zinc-400">
              {deployments.length} deployment{deployments.length === 1 ? "" : "s"}
            </span>
          </div>

          {deployments.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-zinc-500">
              No sites deployed yet. Use the form above to deploy your first site.
            </div>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {deployments.map((d) => {
                const isUploaded = d.type === "uploaded";
                const tmpl =
                  templates.find((t) => t.slug === d.templateSlug) ?? templates[0];
                return (
                  <li
                    key={d.id}
                    className="flex flex-col gap-4 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-center gap-4">
                      <div className="relative h-14 w-20 flex-shrink-0 overflow-hidden rounded-lg border border-zinc-200">
                        {isUploaded ? (
                          <div className="flex h-full w-full items-center justify-center bg-zinc-900 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                            Uploaded
                          </div>
                        ) : (
                          <Image
                            src={tmpl.image}
                            alt={tmpl.name}
                            fill
                            sizes="80px"
                            className="object-cover"
                          />
                        )}
                      </div>
                      <div>
                        <a
                          href={`https://${d.subdomain}.openidea.co.in`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-sm font-semibold text-emerald-700 hover:underline"
                        >
                          {d.subdomain}.openidea.co.in
                        </a>
                        <div className="mt-0.5 text-xs text-zinc-500">
                          <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700">
                            {isUploaded
                              ? `${d.fileCount ?? 0} files · ${(((d.totalBytes ?? 0) / 1024)).toFixed(0)} KB`
                              : tmpl.name}
                          </span>{" "}
                          · Deployed {formatTime(d.deployedAt)}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        Live
                      </span>
                      <Link
                        href={`/console?template=${d.templateSlug}`}
                        className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                      >
                        Edit
                      </Link>
                      <button
                        onClick={() => handleDelete(d.id)}
                        className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100"
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold text-zinc-900">{value}</div>
    </div>
  );
}

function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}
