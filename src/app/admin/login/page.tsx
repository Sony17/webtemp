"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Brand from "@/components/Brand";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin";

export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    if (username.trim() === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      try {
        localStorage.setItem("oi_admin", "1");
      } catch {
        // ignore storage errors
      }
      router.push("/admin");
      return;
    }

    setSubmitting(false);
    setError("Invalid admin credentials.");
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
            <label htmlFor="admin-username" className="block text-sm font-medium text-zinc-200">
              Username
            </label>
            <input
              id="admin-username"
              type="text"
              required
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              className="mt-1 block w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
          </div>

          <div>
            <label htmlFor="admin-password" className="block text-sm font-medium text-zinc-200">
              Password
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
            Default credentials — <span className="font-mono text-zinc-200">admin</span> /{" "}
            <span className="font-mono text-zinc-200">admin</span>
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
