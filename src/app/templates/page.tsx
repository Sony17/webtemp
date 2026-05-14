import Image from "next/image";
import Link from "next/link";
import Footer from "@/components/Footer";
import { templates } from "@/data/templates";
import { templateMeta } from "@/data/templateMeta";

function parseGradientColors(gradient: string): [string, string] {
  const matches = gradient.match(/#[0-9a-fA-F]{6}/g);
  if (matches && matches.length >= 2) {
    return [matches[0], matches[1]];
  }
  return ["#10b981", "#0ea5e9"];
}

const categoryStyles: Record<string, string> = {
  FOOD: "bg-orange-600",
  BEAUTY: "bg-pink-600",
  FITNESS: "bg-zinc-900",
  EDUCATION: "bg-blue-600",
  HEALTH: "bg-teal-600",
  HOSPITALITY: "bg-indigo-700",
  STORE: "bg-violet-600",
  SERVICE: "bg-cyan-700",
  AUTOMOTIVE: "bg-blue-700",
  CREATIVE: "bg-zinc-800",
  EVENTS: "bg-rose-600",
  TRAVEL: "bg-sky-600",
  LOGISTICS: "bg-amber-600",
  GROCERY: "bg-emerald-600",
};

export default function TemplatesPage() {
  return (
    <main className="min-h-screen bg-zinc-50">
      <section className="relative w-full">
        <Link
          href="/login"
          aria-label="Sign up — Get your website now"
          className="block w-full focus:outline-none focus-visible:ring-4 focus-visible:ring-emerald-300/60"
        >
          <Image
            src="/hero.png"
            alt="Open Idea — Professional Website Sirf ₹1,999 se"
            width={2814}
            height={1590}
            priority
            className="h-auto w-full"
          />
        </Link>
        <Link
          href="/login"
          className="absolute right-4 top-4 z-10 rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-lg transition hover:bg-emerald-700 sm:right-8 sm:top-6 sm:px-6 sm:py-2.5 sm:text-base"
        >
          Sign up
        </Link>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-20">
        <div className="mb-14 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-zinc-900 sm:text-6xl">
            Pick a design,{" "}
            <span className="bg-gradient-to-r from-fuchsia-500 to-pink-500 bg-clip-text text-transparent">
              see it live
            </span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-zinc-600">
            Online stores, business websites, financial services, car dealerships — fully customizable, mobile-responsive, and live in minutes.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => {
            const meta = templateMeta[t.slug] ?? {
              brandName: t.name,
              category: "STORE",
              description: t.tagline,
            };
            const [c1, c2] = parseGradientColors(t.gradient);
            const badgeClass = categoryStyles[meta.category] ?? "bg-zinc-900";

            return (
              <article
                key={t.slug}
                className="group relative flex flex-col overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-xl"
              >
                <Link
                  href={`/preview/${t.slug}`}
                  aria-label={`Preview ${meta.brandName} live`}
                  className="relative block aspect-[16/10] w-full overflow-hidden"
                  style={{ background: t.gradient }}
                >
                  <Image
                    src={t.image}
                    alt={meta.brandName}
                    fill
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    className="object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <div
                    aria-hidden
                    className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent"
                  />
                  <span
                    className={`absolute left-4 top-4 rounded-md px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white shadow-md ${badgeClass}`}
                  >
                    {meta.category}
                  </span>
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 flex translate-y-2 items-center justify-center gap-1.5 pb-4 text-xs font-semibold text-white opacity-0 transition duration-300 group-hover:translate-y-0 group-hover:opacity-100">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                    View live preview
                  </span>
                </Link>

                <div className="flex flex-1 flex-col p-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-bold text-zinc-900">
                      {meta.brandName}
                    </h3>
                    <div className="flex gap-1.5">
                      <span
                        className="h-3 w-3 rounded-full ring-1 ring-zinc-200"
                        style={{ backgroundColor: c1 }}
                        title={c1}
                      />
                      <span
                        className="h-3 w-3 rounded-full ring-1 ring-zinc-200"
                        style={{ backgroundColor: c2 }}
                        title={c2}
                      />
                    </div>
                  </div>

                  <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-zinc-600">
                    {meta.description}
                  </p>

                  <div className="mt-4 flex items-center justify-between border-t border-zinc-100 pt-4">
                    <span className="text-xs font-medium text-zinc-400">
                      {t.name}
                    </span>
                    <Link
                      href={`/login?redirect=/console?template=${t.slug}`}
                      className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-zinc-700"
                    >
                      Customise
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <path d="M5 12h14M13 5l7 7-7 7" />
                      </svg>
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <Footer />
    </main>
  );
}
