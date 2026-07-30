import type { Metadata } from "next";
import Link from "next/link";
import Footer from "@/components/Footer";

/* -------------------------------------------------------------------------
 * ONDC Static Terms — Open Idea Retail (Buyer Application)
 *
 * Published to satisfy the ONDC onboarding requirement: a stable public URL
 * carrying the Network Participant's static terms (orders, refunds,
 * cancellations, IGM, payouts). The URL of THIS page goes into workbench 3.b.
 *
 * Identity/contact values below are confirmed by the operator. The operational
 * terms (return window, refund TAT, settlement window) use common defaults —
 * confirm they match your actual policies. ONDC operations must conform to
 * what is published here.
 * ---------------------------------------------------------------------- */
const NP_NAME = "Open Idea Retail";
const LEGAL_ENTITY = "ECOSYZ CORE SOLUTIONS PVT LTD";
const SITE = "openidea.co.in";
const SUPPORT_EMAIL = "info@openidea.world";
const GRIEVANCE_EMAIL = "info@openidea.world";
const GRIEVANCE_OFFICER = "Sony Yadav";
const REGISTERED_ADDRESS =
  "8125, 8th Floor, Gaur City Mall Office Space, Sector 4, Greater Noida West, Gautam Buddha Nagar, Uttar Pradesh 201318";
const PHONE = "+91 81302 96940";
const EFFECTIVE_DATE = "30 July 2026";
const VERSION = "1.0";

// Operational specifics referenced in the clauses below — confirm they match
// your actual policies.
const RETURN_WINDOW = "7 days";
const REFUND_TAT = "5 to 7 business days";
const SETTLEMENT_WINDOW = "T+1 working day";
const JURISDICTION = "Noida, Uttar Pradesh, India";

export const metadata: Metadata = {
  title: `Static Terms & Conditions — ${NP_NAME} (ONDC Buyer App)`,
  description: `Static terms of ${NP_NAME}, a Buyer Application on the ONDC Network — orders, cancellations, returns & refunds, payments & settlement, and Issue & Grievance Management (IGM).`,
  robots: { index: true, follow: true },
};

const sections: { id: string; title: string }[] = [
  { id: "scope", title: "1. Scope & role of Open Idea Retail" },
  { id: "definitions", title: "2. Definitions" },
  { id: "orders", title: "3. Orders & acceptance" },
  { id: "pricing", title: "4. Pricing, taxes & charges" },
  { id: "cancellations", title: "5. Cancellations" },
  { id: "returns", title: "6. Returns & refunds" },
  { id: "delivery", title: "7. Delivery & fulfillment" },
  { id: "payments", title: "8. Payments, settlement & payouts" },
  { id: "igm", title: "9. Issue & Grievance Management (IGM)" },
  { id: "prohibited", title: "10. Prohibited items & buyer conduct" },
  { id: "liability", title: "11. Liability & disclaimers" },
  { id: "law", title: "12. Governing law & jurisdiction" },
  { id: "changes", title: "13. Changes to these terms" },
  { id: "contact", title: "14. Contact & Grievance Officer" },
];

export default function StaticTermsPage() {
  return (
    <>
      <main className="min-h-screen bg-white text-zinc-800">
        {/* Header band */}
        <header className="border-b border-zinc-200 bg-zinc-50">
          <div className="mx-auto max-w-4xl px-6 py-12 sm:py-16">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-700">
              <span className="inline-flex h-2 w-2 rounded-full bg-blue-600" />
              ONDC Network Participant · Static Terms
            </div>
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
              Static Terms &amp; Conditions
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-600">
              These terms govern transactions you place through {NP_NAME}, a Buyer
              Application on the Open Network for Digital Commerce (ONDC). They cover
              orders, cancellations, returns &amp; refunds, payments &amp; settlement, and
              issue &amp; grievance management.
            </p>

            <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200 sm:grid-cols-4">
              <MetaCell label="Network Participant" value={NP_NAME} />
              <MetaCell label="Domain" value="Retail (ONDC:RET1x)" />
              <MetaCell label="Effective date" value={EFFECTIVE_DATE} />
              <MetaCell label="Version" value={`v${VERSION}`} />
            </dl>
          </div>
        </header>

        <div className="mx-auto max-w-4xl px-6 py-12">
          {/* Table of contents */}
          <nav
            aria-label="Contents"
            className="mb-14 rounded-xl border border-zinc-200 bg-zinc-50 p-6"
          >
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Contents
            </h2>
            <ol className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
              {sections.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="text-sm text-zinc-700 underline-offset-2 hover:text-blue-700 hover:underline"
                  >
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <article className="space-y-12">
            <Section id="scope" title="1. Scope & role of Open Idea Retail">
              <P>
                {NP_NAME} (operated by {LEGAL_ENTITY}, &ldquo;we&rdquo;, &ldquo;us&rdquo;,
                &ldquo;our&rdquo;) is a <strong>Buyer Application</strong> on the ONDC
                Network. We provide the technology interface through which you discover,
                order, and pay for goods and services listed by independent sellers via
                their Seller Applications. By placing an order you agree to these terms.
              </P>
              <P>
                We are a <strong>technology intermediary and not the seller of record</strong>.
                The seller identified at checkout is responsible for the goods or services,
                the accuracy of the listing, invoicing, statutory compliance, and
                fulfillment. Delivery may be performed by the seller or by a Logistics
                Service Provider on the Network.
              </P>
            </Section>

            <Section id="definitions" title="2. Definitions">
              <UL
                items={[
                  <><strong>ONDC</strong> — the Open Network for Digital Commerce, the open protocol network facilitating these transactions.</>,
                  <><strong>Buyer App</strong> — {NP_NAME}, the application you use to place orders.</>,
                  <><strong>Seller App</strong> — the application through which a seller lists and sells the goods or services you order.</>,
                  <><strong>Logistics Service Provider</strong> — a Network Participant that fulfills delivery for an order.</>,
                  <><strong>Order</strong> — a confirmed transaction, evidenced by the <code className="rounded bg-zinc-100 px-1 py-0.5 text-[0.85em]">on_confirm</code> response on the Network.</>,
                  <><strong>IGM</strong> — the ONDC Issue &amp; Grievance Management framework for raising and resolving order issues.</>,
                ]}
              />
            </Section>

            <Section id="orders" title="3. Orders & acceptance">
              <UL
                items={[
                  "Placing an order is an offer to purchase. The order is accepted only when the Seller App confirms it; until then, price, availability, and delivery estimates are provided by the Seller App and may change.",
                  "You are responsible for providing an accurate delivery address, PIN code, and contact details. Orders may fail or be cancelled where a seller cannot service your location.",
                  "Product descriptions, images, and attributes are supplied by the seller. Where a listing contains an obvious error, the seller may decline or cancel the affected order.",
                ]}
              />
            </Section>

            <Section id="pricing" title="4. Pricing, taxes & charges">
              <UL
                items={[
                  "Item prices, applicable taxes, delivery charges, packing charges, and any convenience fee are shown to you before payment, as itemised in the order quote on the Network.",
                  "The final payable amount is the price breakup presented at order confirmation. Prices are inclusive of taxes unless stated otherwise at checkout.",
                  "Offers, coupons, and discounts are subject to their specific terms and to seller participation.",
                ]}
              />
            </Section>

            <Section id="cancellations" title="5. Cancellations">
              <UL
                items={[
                  "You may request cancellation before dispatch, subject to the seller's cancellation policy for the item and category. Certain items may become non-cancellable once packed or shipped.",
                  "Cancellations follow the standard ONDC cancellation reason codes. Where an order is cancelled by the seller or logistics provider, or is undeliverable, you are eligible for a full refund of the amount paid.",
                  <>Eligible refunds arising from a cancellation are initiated to your original payment method (see <a href="#returns" className="text-blue-700 underline-offset-2 hover:underline">Section 6</a>).</>,
                ]}
              />
            </Section>

            <Section id="returns" title="6. Returns & refunds">
              <UL
                items={[
                  <>Return eligibility and windows follow the seller&rsquo;s policy for the item and category. Where returns are supported, the return window is typically <strong>{RETURN_WINDOW}</strong> from delivery. Perishable, personal-care, hygiene, and custom items may be non-returnable except where damaged, defective, or incorrectly delivered.</>,
                  <>Approved refunds (for cancellations, returns, or non-fulfillment) are initiated to your original payment method, ordinarily within <strong>{REFUND_TAT}</strong> of approval. The time for funds to reflect depends on your bank or payment provider.</>,
                  "Refund amounts are computed per the ONDC settlement breakup and may be full or partial (for example, where only part of an order is returned). Delivery or convenience charges may be non-refundable except where the issue is attributable to the seller or logistics provider.",
                ]}
              />
            </Section>

            <Section id="delivery" title="7. Delivery & fulfillment">
              <UL
                items={[
                  "Orders are fulfilled by the seller or by a Logistics Service Provider on the Network. Delivery timelines shown are estimates provided at order time and are not guarantees.",
                  "Risk and title in the goods pass to you on delivery. Please inspect items on receipt and raise any issue promptly through the app.",
                  "Where a delivery attempt fails due to incorrect address or unavailability, re-attempt and cancellation terms follow the seller's and logistics provider's policies.",
                ]}
              />
            </Section>

            <Section id="payments" title="8. Payments, settlement & payouts">
              <UL
                items={[
                  "Payments are collected through the payment methods offered at checkout (for example, prepaid via a payment service provider, or cash on delivery where available). We do not store your full card or bank credentials; these are handled by regulated payment providers.",
                  <>Funds are settled to sellers and logistics providers through the ONDC settlement and reconciliation framework. As the Buyer App, {NP_NAME} collects the Buyer Finder Fee as permitted under ONDC rules, and participates in reconciliation and settlement per the agreed settlement window (ordinarily <strong>{SETTLEMENT_WINDOW}</strong>, subject to Network and provider terms).</>,
                  "Refunds, reversals, and chargebacks are processed in accordance with the ONDC settlement rules and the applicable payment provider's terms.",
                ]}
              />
            </Section>

            <Section id="igm" title="9. Issue & Grievance Management (IGM)">
              <P>
                You can raise an issue for any order directly in the app. Issues are handled
                through the ONDC Issue &amp; Grievance Management (IGM) framework, which
                connects your complaint to the responsible seller or logistics provider on
                the Network.
              </P>
              <UL
                items={[
                  "Acknowledgement: we acknowledge grievances within 48 hours of receipt.",
                  "Resolution: we work to resolve issues as quickly as practicable, and in any event within the timelines prescribed under the Consumer Protection (E-Commerce) Rules, 2020 — ordinarily within one month of receipt.",
                  "Escalation: issues that cannot be resolved bilaterally are escalated through the ONDC grievance mechanism, including Online Dispute Resolution (ODR) where applicable.",
                ]}
              />
              <P>
                The details of our Grievance Officer are set out in{" "}
                <a href="#contact" className="text-blue-700 underline-offset-2 hover:underline">
                  Section 14
                </a>
                .
              </P>
            </Section>

            <Section id="prohibited" title="10. Prohibited items & buyer conduct">
              <UL
                items={[
                  "You agree not to use the platform to order items prohibited or restricted under applicable law, or to place fraudulent, abusive, or automated bulk orders.",
                  "Items requiring age verification, a licence, or a prescription are sold subject to the seller's compliance checks and applicable law.",
                  "We may decline, cancel, or restrict access where we reasonably suspect misuse, fraud, or a breach of these terms.",
                ]}
              />
            </Section>

            <Section id="liability" title="11. Liability & disclaimers">
              <UL
                items={[
                  <>{NP_NAME} acts as a Buyer Application and technology intermediary. The seller of record is responsible for the goods or services, their quality, and their statutory compliance.</>,
                  "To the extent permitted by law, our aggregate liability arising out of or in connection with an order is limited to the amount paid by you for that order. We are not liable for indirect or consequential losses.",
                  "Nothing in these terms limits any right you have under the Consumer Protection Act, 2019 or other applicable law.",
                ]}
              />
            </Section>

            <Section id="law" title="12. Governing law & jurisdiction">
              <P>
                These terms are governed by the laws of India. Subject to applicable
                consumer-protection rights and any ONDC dispute-resolution mechanism, the
                courts at <strong>{JURISDICTION}</strong> have jurisdiction over disputes
                arising from these terms.
              </P>
            </Section>

            <Section id="changes" title="13. Changes to these terms">
              <P>
                We maintain these static terms under version control. Changes take effect
                when published on this page, with an updated version number and effective
                date. Material changes will be reflected in the version history below. The
                version applicable to your order is the one in effect at the time the order
                is confirmed.
              </P>
              <div className="mt-5 overflow-x-auto rounded-xl border border-zinc-200">
                <table className="w-full text-left text-sm">
                  <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Version</th>
                      <th className="px-4 py-3 font-semibold">Effective date</th>
                      <th className="px-4 py-3 font-semibold">Changes</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-zinc-200 text-zinc-700">
                      <td className="px-4 py-3 font-medium text-zinc-900">v{VERSION}</td>
                      <td className="px-4 py-3">{EFFECTIVE_DATE}</td>
                      <td className="px-4 py-3">Initial publication.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Section>

            <Section id="contact" title="14. Contact & Grievance Officer">
              <P>
                For any question, order issue, or grievance, reach us through the app or
                using the details below.
              </P>
              <dl className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <ContactCard label="Grievance Officer" lines={[GRIEVANCE_OFFICER, NP_NAME]} />
                <ContactCard
                  label="Grievance email"
                  lines={[<a key="e" href={`mailto:${GRIEVANCE_EMAIL}`} className="text-blue-700 hover:underline">{GRIEVANCE_EMAIL}</a>]}
                />
                <ContactCard
                  label="Customer support"
                  lines={[
                    <a key="e" href={`mailto:${SUPPORT_EMAIL}`} className="text-blue-700 hover:underline">{SUPPORT_EMAIL}</a>,
                    <a key="p" href={`tel:${PHONE.replace(/\s/g, "")}`} className="text-blue-700 hover:underline">{PHONE}</a>,
                  ]}
                />
                <ContactCard label="Registered office" lines={[LEGAL_ENTITY, REGISTERED_ADDRESS]} />
              </dl>
              <p className="mt-6 text-xs text-zinc-500">
                Published by {LEGAL_ENTITY} for {NP_NAME}, a Buyer Application on the ONDC
                Network · {SITE} · Version v{VERSION} · Effective {EFFECTIVE_DATE}.
              </p>
              <p className="mt-4 text-sm">
                <Link href="/" className="text-blue-700 underline-offset-2 hover:underline">
                  Back to {SITE}
                </Link>
              </p>
            </Section>
          </article>
        </div>
      </main>
      <Footer />
    </>
  );
}

/* ---------- presentational helpers ---------- */
function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white px-4 py-3">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-medium text-zinc-900">{value}</dd>
    </div>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="mb-3 border-b border-zinc-200 pb-2 text-xl font-semibold text-zinc-900">
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[15px] leading-relaxed text-zinc-600">{children}</p>;
}

function UL({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="space-y-2">
      {items.map((it, i) => (
        <li key={i} className="flex gap-3 text-[15px] leading-relaxed text-zinc-600">
          <span aria-hidden className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-blue-500" />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

function ContactCard({ label, lines }: { label: string; lines: React.ReactNode[] }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
        {label}
      </div>
      <div className="mt-1 space-y-0.5 text-sm text-zinc-700">
        {lines.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  );
}
