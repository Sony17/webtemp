import fs from "node:fs/promises";
import path from "node:path";

const SAI_HTML_PATH = path.join(process.cwd(), "tenants", "sai", "index.html");

export type Product = {
  category: string;
  categorySlug: string;
  title: string;
  titleHi: string;
  mediaSrc: string;
  mediaType: "image" | "video";
  alt: string;
  waText: string;
};

export type SaiContent = {
  hero: {
    heading: string;
    headingHi: string;
    tagline: string;
    taglineHi: string;
  };
  contact: {
    phoneDisplay: string;
    phoneTel: string;
    whatsappNumber: string;
    address: string;
    addressHi: string;
  };
  products: Product[];
};

const CATEGORY_OPTIONS: { slug: string; label: string; labelHi: string }[] = [
  { slug: "wallpapers", label: "Wallpapers", labelHi: "वॉलपेपर" },
  { slug: "wpc-louvers", label: "WPC Louvers", labelHi: "WPC लूवर" },
  { slug: "pvc-panels", label: "PVC Panels", labelHi: "PVC पैनल" },
  { slug: "blinds", label: "Window Blinds", labelHi: "विंडो ब्लाइंड्स" },
  { slug: "sofas", label: "Luxury Sofas", labelHi: "लग्ज़री सोफा" },
];

export function categoryOptions() {
  return CATEGORY_OPTIONS;
}

function labelForSlug(slug: string) {
  return CATEGORY_OPTIONS.find((c) => c.slug === slug) ?? CATEGORY_OPTIONS[0];
}

async function readHtml() {
  return fs.readFile(SAI_HTML_PATH, "utf8");
}

async function writeHtml(html: string) {
  await fs.writeFile(SAI_HTML_PATH, html, "utf8");
}

function escapeAttr(s: string) {
  // The sai template stores raw `<br/>` and `<em>` inside data-hi-html / data-hi
  // attributes (a deliberate quirk used by the bilingual swap script), so we
  // preserve `<`/`>` and only escape what would break attribute parsing.
  return s.replace(/&(?!(?:amp|lt|gt|quot|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;").replace(/"/g, "&quot;");
}

function escapeText(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function encodeWaText(s: string) {
  // encodeURIComponent leaves `'` raw; encode it to match the existing
  // wa.me URLs in the template (so the diff stays minimal on save).
  return encodeURIComponent(s).replace(/'/g, "%27");
}

// --- Parsers ---

function parseHero(html: string) {
  const h1Match = html.match(
    /<h1\s+data-hi-html="([^"]*)"\s*>([\s\S]*?)<\/h1>/
  );
  const tagMatch = html.match(
    /<p\s+class="tagline"\s+data-hi="([^"]*)"\s*>([\s\S]*?)<\/p>/
  );
  return {
    heading: h1Match?.[2]?.trim() ?? "",
    headingHi: h1Match?.[1] ?? "",
    tagline: tagMatch?.[2]?.trim() ?? "",
    taglineHi: tagMatch?.[1] ?? "",
  };
}

function parseContact(html: string) {
  const phoneDisplayMatch = html.match(
    /<div\s+class="info-val">\s*<a\s+href="tel:([^"]+)"\s*>([^<]+)<\/a>\s*<\/div>/
  );
  const addressMatch = html.match(
    /<div\s+class="info-val"\s+data-hi-html="([^"]*)">([\s\S]*?)<\/div>/
  );
  const waMatch = html.match(/https:\/\/wa\.me\/(\d+)/);
  return {
    phoneDisplay: phoneDisplayMatch?.[2]?.trim() ?? "",
    phoneTel: phoneDisplayMatch?.[1]?.trim() ?? "",
    whatsappNumber: waMatch?.[1] ?? "",
    address: addressMatch?.[2]?.trim() ?? "",
    addressHi: addressMatch?.[1] ?? "",
  };
}

function parseProducts(html: string): Product[] {
  const gridMatch = html.match(
    /<div\s+class="pgs-grid">([\s\S]*?)<\/div>\s*<\/div>\s*<\/section>/
  );
  if (!gridMatch) return [];
  const grid = gridMatch[1];

  const cardRe =
    /<article\s+class="pgs-card"\s+data-cat="([^"]+)">([\s\S]*?)<\/article>/g;
  const products: Product[] = [];

  let m: RegExpExecArray | null;
  while ((m = cardRe.exec(grid))) {
    const slug = m[1];
    const body = m[2];

    const videoMatch = body.match(/<video\s+src="([^"]+)"/);
    const imgMatch = body.match(/<img[^>]+src="([^"]+)"[^>]*alt="([^"]*)"/);
    let mediaSrc = "";
    let mediaType: "image" | "video" = "image";
    let alt = "";
    if (videoMatch) {
      mediaSrc = videoMatch[1];
      mediaType = "video";
    } else if (imgMatch) {
      mediaSrc = imgMatch[1];
      alt = imgMatch[2];
      mediaType = "image";
    }

    const titleMatch = body.match(
      /<h3\s+data-hi="([^"]*)"\s*>([\s\S]*?)<\/h3>/
    );
    const waTextMatch = body.match(/wa\.me\/\d+\?text=([^"]+)"/);
    const decodedWa = waTextMatch
      ? decodeURIComponent(waTextMatch[1]).replace(
          /^Hi,\s*I'd like a quote for\s*/i,
          ""
        )
      : "";

    products.push({
      category: labelForSlug(slug).label,
      categorySlug: slug,
      title: (titleMatch?.[2] ?? "").trim(),
      titleHi: titleMatch?.[1] ?? "",
      mediaSrc,
      mediaType,
      alt,
      waText: decodedWa,
    });
  }
  return products;
}

export async function getSaiContent(): Promise<SaiContent> {
  const html = await readHtml();
  return {
    hero: parseHero(html),
    contact: parseContact(html),
    products: parseProducts(html),
  };
}

// --- Writers ---

const WA_SVG_PATH =
  '<svg viewBox="0 0 24 24"><path d="M19.05 4.91A10 10 0 0 0 4.06 18.08L2 22l4-1.05a10 10 0 0 0 4.96 1.28h.01A10 10 0 0 0 19.05 4.91Z"/></svg>';

function renderProduct(p: Product, waNumber: string): string {
  const slug = p.categorySlug;
  const cat = labelForSlug(slug);
  const mediaTag =
    p.mediaType === "video"
      ? `<video src="${escapeAttr(p.mediaSrc)}" muted loop playsinline preload="metadata" autoplay></video>`
      : `<img loading="lazy" src="${escapeAttr(p.mediaSrc)}" alt="${escapeAttr(p.alt || p.title)}" />`;
  const waHref = `https://wa.me/${waNumber}?text=${encodeWaText("Hi, I'd like a quote for " + p.waText)}`;

  return `      <article class="pgs-card" data-cat="${escapeAttr(slug)}">
        <div class="pgs-img">${mediaTag}</div>
        <div class="pgs-body">
          <span class="pgs-cat" data-hi="${escapeAttr(cat.labelHi)}">${escapeText(cat.label)}</span>
          <h3 data-hi="${escapeAttr(p.titleHi)}">${escapeText(p.title)}</h3>
          <a class="pgs-cta" href="${waHref}" target="_blank" rel="noopener" data-hi="कोटेशन पाएं">${WA_SVG_PATH} Get quote</a>
        </div>
      </article>`;
}

export async function writeSaiContent(next: SaiContent): Promise<void> {
  let html = await readHtml();
  const current = {
    hero: parseHero(html),
    contact: parseContact(html),
  };

  // Hero h1 — replace the entire <h1 data-hi-html="..."> block
  html = html.replace(
    /<h1\s+data-hi-html="[^"]*"\s*>[\s\S]*?<\/h1>/,
    `<h1 data-hi-html="${escapeAttr(next.hero.headingHi)}">${next.hero.heading}</h1>`
  );

  // Hero tagline
  html = html.replace(
    /<p\s+class="tagline"\s+data-hi="[^"]*"\s*>[\s\S]*?<\/p>/,
    `<p class="tagline" data-hi="${escapeAttr(next.hero.taglineHi)}">${next.hero.tagline}</p>`
  );

  // Address (info-val with data-hi-html, immediately after Address label)
  html = html.replace(
    /<div\s+class="info-val"\s+data-hi-html="[^"]*">[\s\S]*?<\/div>/,
    `<div class="info-val" data-hi-html="${escapeAttr(next.contact.addressHi)}">${next.contact.address}</div>`
  );

  // Phone display + tel: links — global swap on the previous phone values
  if (current.contact.phoneDisplay && next.contact.phoneDisplay) {
    html = html.split(current.contact.phoneDisplay).join(next.contact.phoneDisplay);
  }
  if (current.contact.phoneTel && next.contact.phoneTel) {
    html = html.split("tel:" + current.contact.phoneTel).join("tel:" + next.contact.phoneTel);
  }

  // WhatsApp number — global swap on wa.me/<num>
  if (current.contact.whatsappNumber && next.contact.whatsappNumber) {
    html = html
      .split("wa.me/" + current.contact.whatsappNumber)
      .join("wa.me/" + next.contact.whatsappNumber);
  }

  // Products grid — rebuild entire <div class="pgs-grid">...</div>
  const cardsHtml = next.products
    .map((p) => renderProduct(p, next.contact.whatsappNumber))
    .join("\n");
  html = html.replace(
    /<div\s+class="pgs-grid">[\s\S]*?<\/div>(\s*<\/div>\s*<\/section>)/,
    `<div class="pgs-grid">\n${cardsHtml}\n    </div>$1`
  );

  await writeHtml(html);
}
