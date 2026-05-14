import Link from "next/link";
import Brand from "@/components/Brand";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <>
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-teal-50 px-6 text-center">
      <div className="max-w-2xl">
        <div className="mb-8 flex justify-center">
          <Brand size="lg" />
        </div>
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/70 px-4 py-1.5 text-xs font-medium text-emerald-700 backdrop-blur">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          DPIIT Registered · AIC-GBU Incubated
        </div>
        <h1 className="text-5xl font-bold tracking-tight text-zinc-900 sm:text-6xl">
          Reserved for{" "}
          <span className="bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">
            openidea.world
          </span>
        </h1>
        <p className="mt-6 text-lg text-zinc-600">
          The AI innovation platform that gives every Indian business its own website. 50+ categories. 500+ competitor templates analyzed. Pick yours.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/templates"
            className="inline-flex h-12 items-center justify-center rounded-full bg-emerald-600 px-8 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
          >
            Browse Templates
          </Link>
          <Link
            href="/login"
            className="inline-flex h-12 items-center justify-center rounded-full border border-zinc-300 bg-white px-8 text-sm font-semibold text-zinc-800 transition hover:border-zinc-400"
          >
            Sign in to Console
          </Link>
        </div>
        <p className="mt-12 text-xs text-zinc-400">
          Open Idea EcoSyz — AI Innovation Platform · openidea.world
        </p>
      </div>
    </main>
    <Footer />
    </>
  );
}
