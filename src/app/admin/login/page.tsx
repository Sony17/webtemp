"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import Brand from "@/components/Brand";

// Only allow `next` redirects to known internal admin paths, so a malicious
// link can't bounce the user to an external URL after login.
const ALLOWED_NEXT = new Set(["/admin", "/sai-admin", "/shop/admin"]);

export default function AdminLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    // Server-side login: POST the admin token; the server sets an httpOnly
    // session cookie that the gated data APIs (requireAdmin) accept. The
    // localStorage flag remains ONLY as a client-side UX hint for the
    // console's route guard — it grants nothing server-side.
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        try {
          localStorage.setItem("oi_admin", "1");
        } catch {
          // ignore storage errors
        }
        const nextParam = searchParams?.get("next");
        const target = nextParam && ALLOWED_NEXT.has(nextParam) ? nextParam : "/admin";
        router.push(target);
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Invalid admin credentials.");
    } catch {
      setError("Login failed — network error.");
    }
    setSubmitting(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900 px-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <Brand size="md" variant="light" />
          <p className="mt-3 text-sm text-zinc-400">Admin Console</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl border border-zinc-700 bg-zinc-900/80 p-8 shadow-2xl backdrop-blur"
        >
          <div>
            <label htmlFor="admin-password" className="block text-sm font-medium text-zinc-200">
              Admin token
            </label>
            <input
              id="admin-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="mt-1 block w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-full bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Signing in…" : "Sign in to Admin"}
          </button>

          <p className="rounded-md bg-zinc-800/60 px-3 py-2 text-center text-xs text-zinc-400">
            The deployment&apos;s <span className="font-mono text-zinc-200">ADMIN_TOKEN</span>.
            In local development without one set, any value signs in.
          </p>
        </form>

        <p className="mt-6 text-center text-xs text-zinc-500">
          <Link href="/" className="hover:text-zinc-300">
            ← Back to site
          </Link>
        </p>
      </div>
    </main>
  );
}
