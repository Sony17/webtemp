import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import Footer from "@/components/Footer";
import { templates } from "@/data/templates";
import { templateMeta } from "@/data/templateMeta";

export function generateStaticParams() {
  return templates.map((t) => ({ slug: t.slug }));
}

export default async function PreviewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const template = templates.find((t) => t.slug === slug);
  if (!template) notFound();

  const meta = templateMeta[slug] ?? {
    brandName: template.name,
    category: "STORE",
    description: template.tagline,
  };

  return (
    <main className="min-h-screen bg-white">
      {/* Open Idea preview bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-zinc-200 bg-white/90 px-4 py-2.5 backdrop-blur sm:px-6">
        <div className="flex items-center gap-3">
          <Link
            href="/templates"
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back to templates
          </Link>
          <span className="hidden text-xs text-zinc-400 sm:inline">
            Previewing &mdash; <span className="font-semibold text-zinc-700">{meta.brandName}</span>
          </span>
        </div>
        <Link
          href={`/login?redirect=/console?template=${slug}`}
          className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-zinc-700"
        >
          Customise this template
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 12h14M13 5l7 7-7 7" />
          </svg>
        </Link>
      </div>

      {/* Demo website rendered inside */}
      <DemoSite meta={meta} template={template} />
    </main>
  );
}

function DemoSite({
  meta,
  template,
}: {
  meta: { brandName: string; category: string; description: string };
  template: (typeof templates)[number];
}) {
  return (
    <>
      {/* Site navigation */}
      <nav className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="text-xl font-bold tracking-tight text-zinc-900">
            {meta.brandName}
          </div>
          <div className="hidden items-center gap-7 text-sm font-medium text-zinc-700 md:flex">
            <a href="#" className="hover:text-zinc-900">Home</a>
            <a href="#features" className="hover:text-zinc-900">Services</a>
            <a href="#gallery" className="hover:text-zinc-900">Gallery</a>
            <a href="#contact" className="hover:text-zinc-900">Contact</a>
          </div>
          <button
            className="rounded-full px-5 py-2 text-sm font-semibold text-white shadow-sm"
            style={{ background: template.gradient }}
          >
            Book Now
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative isolate">
        <div className="relative h-[420px] w-full overflow-hidden sm:h-[520px]">
          <Image
            src={template.image}
            alt={meta.brandName}
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
          <div
            aria-hidden
            className="absolute inset-0 opacity-80"
            style={{ background: template.gradient }}
          />
          <div className="relative z-10 mx-auto flex h-full max-w-6xl flex-col justify-center px-6 text-white">
            <span className="inline-block w-fit rounded-full bg-white/20 px-3 py-1 text-xs font-bold uppercase tracking-wider backdrop-blur">
              {meta.category}
            </span>
            <h1 className="mt-4 max-w-3xl text-4xl font-bold leading-tight drop-shadow-md sm:text-6xl">
              {meta.brandName}
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/90 drop-shadow sm:text-lg">
              {meta.description}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-zinc-900 shadow-md transition hover:scale-[1.02]">
                Get Started
              </button>
              <button className="rounded-full border border-white/60 bg-white/10 px-6 py-3 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/20">
                Learn More
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <section className="border-b border-zinc-200 bg-zinc-50">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-6 py-10 sm:grid-cols-4">
          {[
            { label: "Happy Customers", value: "10,000+" },
            { label: "Years of Trust", value: "15+" },
            { label: "Google Rating", value: "4.9/5" },
            { label: "Cities Served", value: "50+" },
          ].map((s) => (
            <div key={s.label}>
              <div className="text-2xl font-bold text-zinc-900 sm:text-3xl">{s.value}</div>
              <div className="mt-1 text-xs font-medium uppercase tracking-wider text-zinc-500">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-6 py-16">
        <div className="mb-10 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
            Everything your customers expect
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-zinc-600">
            Built-in features that ship with this template — no plugins, no extra work.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {template.commonFeatures.slice(0, 6).map((f) => (
            <div
              key={f}
              className="rounded-2xl border border-zinc-200 bg-white p-5 transition hover:shadow-md"
            >
              <div
                className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg text-white"
                style={{ background: template.gradient }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
              <div className="text-sm font-semibold text-zinc-900">{f}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Unique ideas */}
      <section className="bg-zinc-50">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="mb-10">
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber-800">
              What makes you different
            </span>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
              Ideas borrowed from the category leaders
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {template.uniqueIdeas.map((idea, i) => (
              <div
                key={idea}
                className="flex items-start gap-4 rounded-2xl border border-zinc-200 bg-white p-5"
              >
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-zinc-100 text-sm font-bold text-zinc-700">
                  {String(i + 1).padStart(2, "0")}
                </div>
                <div className="text-sm leading-relaxed text-zinc-700">{idea}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section
        id="contact"
        className="relative overflow-hidden"
        style={{ background: template.gradient }}
      >
        <div className="mx-auto max-w-4xl px-6 py-16 text-center text-white">
          <h2 className="text-3xl font-bold sm:text-4xl">
            Ready to launch your own?
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-white/90">
            Customise this template with your business name, photos, colours and content. Live in minutes.
          </p>
          <Link
            href={`/login?redirect=/console?template=${template.slug}`}
            className="mt-8 inline-flex items-center gap-2 rounded-full bg-white px-7 py-3 text-sm font-semibold text-zinc-900 shadow-lg transition hover:scale-[1.02]"
          >
            Customise this template
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12h14M13 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </section>

      <Footer />
    </>
  );
}
