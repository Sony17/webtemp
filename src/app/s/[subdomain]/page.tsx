import Image from "next/image";
import { notFound } from "next/navigation";
import { getDeployment, type Deployment } from "@/lib/deployments";
import { templates, type Template } from "@/data/templates";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain } = await params;
  const deployment = await getDeployment(subdomain);
  if (!deployment) return { title: "Not found" };
  return {
    title: deployment.brandName,
    description:
      deployment.tagline ??
      `${deployment.brandName} — a website powered by Open Idea EcoSyz.`,
  };
}

export default async function TenantPage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain } = await params;
  const deployment = await getDeployment(subdomain);
  if (!deployment) notFound();

  const template = templates.find((t) => t.slug === deployment.templateSlug);
  if (!template) notFound();

  return <TenantSite deployment={deployment} template={template} />;
}

function TenantSite({
  deployment,
  template,
}: {
  deployment: Deployment;
  template: Template;
}) {
  const [gradientStart, gradientEnd] = (template.gradient.match(/#[0-9a-fA-F]{6}/g) ?? [
    "#10b981",
    "#0ea5e9",
  ]) as [string, string];
  const primary = deployment.primaryColor ?? gradientStart;
  const tagline = deployment.tagline ?? template.tagline;

  return (
    <main className="min-h-screen bg-white">
      {/* Tenant top nav */}
      <header className="border-b border-zinc-100 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-sm font-bold text-white shadow-sm"
              style={{ background: template.gradient }}
            >
              {deployment.brandName.charAt(0)}
            </span>
            <span className="text-base font-bold text-zinc-900">
              {deployment.brandName}
            </span>
          </div>
          <nav className="hidden gap-6 text-sm text-zinc-700 sm:flex">
            <a href="#services" className="hover:text-zinc-900">Services</a>
            <a href="#about" className="hover:text-zinc-900">About</a>
            <a href="#contact" className="hover:text-zinc-900">Contact</a>
          </nav>
          {deployment.phone && (
            <a
              href={`tel:${deployment.phone.replace(/\s+/g, "")}`}
              className="rounded-full px-4 py-1.5 text-sm font-semibold text-white"
              style={{ backgroundColor: primary }}
            >
              Call now
            </a>
          )}
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden" style={{ background: template.gradient }}>
        <Image
          src={template.image}
          alt={deployment.brandName}
          width={1600}
          height={900}
          priority
          className="absolute inset-0 h-full w-full object-cover opacity-30"
        />
        <div className="relative mx-auto max-w-6xl px-6 py-24 text-white">
          {deployment.city && (
            <span className="inline-block rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider backdrop-blur">
              {deployment.city}
            </span>
          )}
          <h1 className="mt-4 max-w-3xl text-4xl font-bold leading-tight drop-shadow-md sm:text-5xl">
            {deployment.brandName}
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-white/90 drop-shadow">
            {tagline}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {deployment.phone && (
              <a
                href={`tel:${deployment.phone.replace(/\s+/g, "")}`}
                className="rounded-full bg-white px-6 py-2.5 text-sm font-semibold shadow-lg"
                style={{ color: primary }}
              >
                Book now
              </a>
            )}
            <a
              href="#services"
              className="rounded-full border-2 border-white/80 bg-transparent px-6 py-2.5 text-sm font-semibold text-white hover:bg-white/10"
            >
              See what we offer
            </a>
          </div>
        </div>
      </section>

      {/* Services / features */}
      <section id="services" className="mx-auto max-w-6xl px-6 py-16">
        <div className="mb-10 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-zinc-900">
            What we do
          </h2>
          <p className="mt-2 text-zinc-600">{template.tagline}</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {template.commonFeatures.map((f) => (
            <div
              key={f}
              className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"
            >
              <div
                className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-lg text-white"
                style={{ backgroundColor: primary }}
              >
                <svg
                  width="14"
                  height="14"
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
              </div>
              <div className="text-sm font-semibold text-zinc-900">{f}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Highlights / unique ideas */}
      <section
        id="about"
        className="px-6 py-16"
        style={{
          background: `linear-gradient(180deg, ${gradientEnd}11, ${gradientStart}11)`,
        }}
      >
        <div className="mx-auto max-w-6xl">
          <div className="mb-10 text-center">
            <h2 className="text-3xl font-bold tracking-tight text-zinc-900">
              Why choose {deployment.brandName}
            </h2>
            <p className="mt-2 text-zinc-600">
              The things that make us different.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {template.uniqueIdeas.map((idea) => (
              <div
                key={idea}
                className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"
              >
                <div className="text-sm font-medium text-zinc-800">{idea}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-zinc-900">
              Visit or call us
            </h2>
            <p className="mt-3 text-zinc-600">
              We&apos;re ready to help. Get in touch and we&apos;ll respond quickly.
            </p>
          </div>
          <div className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            {deployment.address && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Address
                </div>
                <div className="mt-1 text-sm text-zinc-800">{deployment.address}</div>
              </div>
            )}
            {deployment.phone && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Phone
                </div>
                <a
                  href={`tel:${deployment.phone.replace(/\s+/g, "")}`}
                  className="mt-1 block text-sm font-medium hover:underline"
                  style={{ color: primary }}
                >
                  {deployment.phone}
                </a>
              </div>
            )}
            {deployment.email && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Email
                </div>
                <a
                  href={`mailto:${deployment.email}`}
                  className="mt-1 block text-sm font-medium hover:underline"
                  style={{ color: primary }}
                >
                  {deployment.email}
                </a>
              </div>
            )}
            {deployment.hours && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Hours
                </div>
                <div className="mt-1 text-sm text-zinc-800">{deployment.hours}</div>
              </div>
            )}
          </div>
        </div>
      </section>

      <footer
        className="border-t px-6 py-10 text-center text-sm"
        style={{ backgroundColor: "#0a0a0a", color: "rgba(255,255,255,0.6)" }}
      >
        <div className="font-bold text-white">{deployment.brandName}</div>
        <div className="mt-1">
          © {new Date().getFullYear()} {deployment.brandName}. Powered by{" "}
          <span className="text-white">Open Idea EcoSyz</span>
        </div>
      </footer>
    </main>
  );
}

