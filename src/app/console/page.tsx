"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import Brand from "@/components/Brand";
import { templates } from "@/data/templates";

function ConsoleInner() {
  const searchParams = useSearchParams();
  const initialSlug = searchParams.get("template") ?? templates[0].slug;
  const [selectedSlug, setSelectedSlug] = useState(initialSlug);

  const selected = templates.find((t) => t.slug === selectedSlug) ?? templates[0];

  const [businessName, setBusinessName] = useState(`My ${selected.name}`);
  const [tagline, setTagline] = useState(selected.tagline);
  const [phone, setPhone] = useState("+91 98765 43210");
  const [address, setAddress] = useState("Shop 12, Main Market, Your City");
  const [primaryColor, setPrimaryColor] = useState("#059669");

  function handleSelect(slug: string) {
    const t = templates.find((tt) => tt.slug === slug);
    if (!t) return;
    setSelectedSlug(slug);
    setBusinessName(`My ${t.name}`);
    setTagline(t.tagline);
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50">
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Brand size="sm" />
            <span className="hidden text-sm text-zinc-400 sm:inline">/ Console</span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/templates"
              className="hidden rounded-full border border-zinc-300 px-4 py-1.5 text-sm font-medium text-zinc-700 hover:border-zinc-400 sm:inline-flex"
            >
              Browse templates
            </Link>
            <button className="rounded-full bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">
              Publish
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-7xl flex-1 grid-cols-1 gap-6 px-6 py-6 lg:grid-cols-[280px_1fr_1fr]">
        <aside className="rounded-2xl border border-zinc-200 bg-white p-4">
          <h2 className="mb-3 px-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Your Website
          </h2>
          <label className="mb-1 block px-2 text-sm text-zinc-600">Template</label>
          <select
            value={selectedSlug}
            onChange={(e) => handleSelect(e.target.value)}
            className="mb-4 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
          >
            {templates.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.name}
              </option>
            ))}
          </select>

          <div className="mb-4 overflow-hidden rounded-lg border border-zinc-200">
            <div className="relative h-24 w-full">
              <Image
                src={selected.image}
                alt={selected.name}
                fill
                sizes="280px"
                className="object-cover"
              />
            </div>
          </div>

          <div className="space-y-2 border-t border-zinc-100 pt-4">
            <div className="px-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Pages
            </div>
            {["Home", "Services", "Gallery", "About", "Contact"].map((p) => (
              <button
                key={p}
                className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-100"
              >
                {p}
                <span className="text-xs text-zinc-400">edit</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="rounded-2xl border border-zinc-200 bg-white p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
              Edit Details
            </h2>
            <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600">
              {selected.name}
            </span>
          </div>

          <div className="space-y-4">
            <Field label="Business name" value={businessName} onChange={setBusinessName} />
            <Field label="Tagline" value={tagline} onChange={setTagline} />
            <Field label="Phone" value={phone} onChange={setPhone} />
            <Field label="Address" value={address} onChange={setAddress} multiline />

            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700">
                Primary color
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="h-10 w-14 cursor-pointer rounded border border-zinc-300"
                />
                <input
                  type="text"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                />
              </div>
            </div>

            <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-800">
                Built-in features
              </h3>
              <ul className="space-y-1 text-sm text-emerald-900">
                {selected.commonFeatures.slice(0, 6).map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <CheckIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-800">
                Unique ideas you can add
              </h3>
              <ul className="space-y-1 text-sm text-amber-900">
                {selected.uniqueIdeas.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <SparkleIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
              Live Preview
            </h2>
            <span className="text-xs text-zinc-400">{selected.name} template</span>
          </div>

          <div className="overflow-hidden rounded-xl border border-zinc-200">
            <div className="border-b border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-500">
              {businessName.toLowerCase().replace(/\s+/g, "")}.openidea.world
            </div>
            <div className="bg-white">
              <div className="relative h-44 w-full overflow-hidden">
                <Image
                  src={selected.image}
                  alt={selected.name}
                  fill
                  sizes="(max-width: 1024px) 100vw, 33vw"
                  className="object-cover"
                />
                <div
                  className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center text-white"
                  style={{ backgroundColor: `${primaryColor}cc` }}
                >
                  <h1 className="text-2xl font-bold drop-shadow-md">
                    {businessName || "Your Business"}
                  </h1>
                  <p className="mt-1 text-sm opacity-95 drop-shadow">{tagline}</p>
                  <button
                    className="mt-4 rounded-full bg-white px-5 py-2 text-sm font-semibold shadow-md"
                    style={{ color: primaryColor }}
                  >
                    Book Now
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 p-5">
                {selected.commonFeatures.slice(0, 4).map((f) => (
                  <div key={f} className="rounded-lg border border-zinc-200 p-3 text-xs text-zinc-700">
                    {f}
                  </div>
                ))}
              </div>
              <div className="space-y-1 border-t border-zinc-200 px-5 py-4 text-xs text-zinc-600">
                <div className="flex items-center gap-2">
                  <PhoneIcon className="h-3.5 w-3.5 text-zinc-400" />
                  {phone}
                </div>
                <div className="flex items-start gap-2">
                  <MapPinIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-zinc-400" />
                  {address}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-zinc-700">{label}</label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          className="block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
        />
      )}
    </div>
  );
}

function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function SparkleIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2l1.8 5.6L19 9.4l-5.2 1.8L12 16.6l-1.8-5.4L5 9.4l5.2-1.8L12 2zM19 14l1 2.5 2.5 1-2.5 1L19 21l-1-2.5-2.5-1 2.5-1L19 14zM5 14l1 2.5L8.5 17.5l-2.5 1L5 21l-1-2.5L1.5 17.5l2.5-1L5 14z" />
    </svg>
  );
}

function PhoneIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.37 1.9.71 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.34 1.85.58 2.81.71A2 2 0 0122 16.92z" />
    </svg>
  );
}

function MapPinIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

export default function ConsolePage() {
  return (
    <Suspense fallback={<div className="p-8 text-zinc-500">Loading console…</div>}>
      <ConsoleInner />
    </Suspense>
  );
}
