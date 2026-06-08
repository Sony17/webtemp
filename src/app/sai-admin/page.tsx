"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Product = {
  category: string;
  categorySlug: string;
  title: string;
  titleHi: string;
  mediaSrc: string;
  mediaType: "image" | "video";
  alt: string;
  waText: string;
};

type SaiContent = {
  hero: { heading: string; headingHi: string; tagline: string; taglineHi: string };
  contact: {
    phoneDisplay: string;
    phoneTel: string;
    whatsappNumber: string;
    address: string;
    addressHi: string;
  };
  products: Product[];
};

const CATEGORIES: { slug: string; label: string }[] = [
  { slug: "wallpapers", label: "Wallpapers" },
  { slug: "wpc-louvers", label: "WPC Louvers" },
  { slug: "pvc-panels", label: "PVC Panels" },
  { slug: "blinds", label: "Window Blinds" },
  { slug: "sofas", label: "Luxury Sofas" },
];

export default function SaiAdminPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [content, setContent] = useState<SaiContent | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    let authed = false;
    try {
      authed = localStorage.getItem("oi_admin") === "1";
    } catch {
      // ignore
    }
    if (!authed) {
      router.replace("/admin/login?next=/sai-admin");
      return;
    }
    fetch("/api/sai-admin", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setContent(data as SaiContent);
        }
        setReady(true);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load");
        setReady(true);
      });
  }, [router]);

  function updateHero<K extends keyof SaiContent["hero"]>(k: K, v: string) {
    setContent((c) => (c ? { ...c, hero: { ...c.hero, [k]: v } } : c));
  }
  function updateContact<K extends keyof SaiContent["contact"]>(k: K, v: string) {
    setContent((c) => (c ? { ...c, contact: { ...c.contact, [k]: v } } : c));
  }
  function updateProduct(idx: number, patch: Partial<Product>) {
    setContent((c) => {
      if (!c) return c;
      const products = c.products.slice();
      products[idx] = { ...products[idx], ...patch };
      return { ...c, products };
    });
  }
  function moveProduct(idx: number, dir: -1 | 1) {
    setContent((c) => {
      if (!c) return c;
      const j = idx + dir;
      if (j < 0 || j >= c.products.length) return c;
      const products = c.products.slice();
      [products[idx], products[j]] = [products[j], products[idx]];
      return { ...c, products };
    });
  }
  function removeProduct(idx: number) {
    setContent((c) =>
      c ? { ...c, products: c.products.filter((_, i) => i !== idx) } : c
    );
  }
  function addProduct() {
    setContent((c) =>
      c
        ? {
            ...c,
            products: [
              ...c.products,
              {
                category: "Wallpapers",
                categorySlug: "wallpapers",
                title: "New product",
                titleHi: "",
                mediaSrc: "/demo-wallpaper/images/img1.jpeg",
                mediaType: "image",
                alt: "",
                waText: "New product",
              },
            ],
          }
        : c
    );
  }

  async function save() {
    if (!content) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/sai-admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(content),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Save failed");
      } else {
        setSavedAt(Date.now());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setSaving(false);
    }
  }

  if (!ready) {
    return <main style={shellStyle}><p style={{ color: "#888" }}>Loading…</p></main>;
  }
  if (!content) {
    return (
      <main style={shellStyle}>
        <p style={{ color: "#f87171" }}>{error ?? "Could not load sai content."}</p>
      </main>
    );
  }

  return (
    <main style={shellStyle}>
      <header style={headerStyle}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>Sai admin</h1>
          <p style={{ margin: "4px 0 0", color: "#888", fontSize: 14 }}>
            Edits write directly to <code>tenants/sai/index.html</code>. Refresh{" "}
            <a
              href="https://sai.openidea.co.in"
              target="_blank"
              rel="noopener"
              style={{ color: "#60a5fa" }}
            >
              sai.openidea.co.in
            </a>{" "}
            after saving.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {savedAt && (
            <span style={{ color: "#4ade80", fontSize: 13 }}>
              Saved {new Date(savedAt).toLocaleTimeString()}
            </span>
          )}
          <button onClick={save} disabled={saving} style={primaryBtn}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </header>

      {error && (
        <div style={{ ...cardStyle, borderColor: "#f87171", color: "#fca5a5" }}>{error}</div>
      )}

      <section style={cardStyle}>
        <h2 style={sectionTitle}>Hero</h2>
        <Field label="Heading (English, can include <br/> and <em>…</em>)">
          <textarea
            style={textareaStyle}
            rows={2}
            value={content.hero.heading}
            onChange={(e) => updateHero("heading", e.target.value)}
          />
        </Field>
        <Field label="Heading (Hindi)">
          <textarea
            style={textareaStyle}
            rows={2}
            value={content.hero.headingHi}
            onChange={(e) => updateHero("headingHi", e.target.value)}
          />
        </Field>
        <Field label="Tagline (English)">
          <textarea
            style={textareaStyle}
            rows={2}
            value={content.hero.tagline}
            onChange={(e) => updateHero("tagline", e.target.value)}
          />
        </Field>
        <Field label="Tagline (Hindi)">
          <textarea
            style={textareaStyle}
            rows={2}
            value={content.hero.taglineHi}
            onChange={(e) => updateHero("taglineHi", e.target.value)}
          />
        </Field>
      </section>

      <section style={cardStyle}>
        <h2 style={sectionTitle}>Contact</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Phone (display)">
            <input
              style={inputStyle}
              value={content.contact.phoneDisplay}
              onChange={(e) => updateContact("phoneDisplay", e.target.value)}
            />
          </Field>
          <Field label="Phone (tel: digits only)">
            <input
              style={inputStyle}
              value={content.contact.phoneTel}
              onChange={(e) => updateContact("phoneTel", e.target.value)}
            />
          </Field>
        </div>
        <Field label="WhatsApp number (intl, no plus — e.g. 919760017505)">
          <input
            style={inputStyle}
            value={content.contact.whatsappNumber}
            onChange={(e) => updateContact("whatsappNumber", e.target.value)}
          />
        </Field>
        <Field label="Address (English, &lt;br/&gt; allowed)">
          <textarea
            style={textareaStyle}
            rows={3}
            value={content.contact.address}
            onChange={(e) => updateContact("address", e.target.value)}
          />
        </Field>
        <Field label="Address (Hindi)">
          <textarea
            style={textareaStyle}
            rows={3}
            value={content.contact.addressHi}
            onChange={(e) => updateContact("addressHi", e.target.value)}
          />
        </Field>
      </section>

      <section style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={sectionTitle}>Products ({content.products.length})</h2>
          <button onClick={addProduct} style={ghostBtn}>
            + Add product
          </button>
        </div>
        {content.products.map((p, i) => (
          <div
            key={i}
            style={{
              border: "1px solid #2a2a35",
              borderRadius: 10,
              padding: 14,
              marginTop: 12,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <strong style={{ color: "#d4d4d8" }}>#{i + 1} · {p.title || "(untitled)"}</strong>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => moveProduct(i, -1)} disabled={i === 0} style={miniBtn}>↑</button>
                <button onClick={() => moveProduct(i, 1)} disabled={i === content.products.length - 1} style={miniBtn}>↓</button>
                <button onClick={() => removeProduct(i)} style={{ ...miniBtn, color: "#fca5a5" }}>Delete</button>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="Category">
                <select
                  style={inputStyle}
                  value={p.categorySlug}
                  onChange={(e) => {
                    const slug = e.target.value;
                    const cat = CATEGORIES.find((c) => c.slug === slug)!;
                    updateProduct(i, { categorySlug: slug, category: cat.label });
                  }}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.slug} value={c.slug}>{c.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Media type">
                <select
                  style={inputStyle}
                  value={p.mediaType}
                  onChange={(e) => updateProduct(i, { mediaType: e.target.value as "image" | "video" })}
                >
                  <option value="image">Image</option>
                  <option value="video">Video</option>
                </select>
              </Field>
            </div>
            <Field label="Title (English)">
              <input
                style={inputStyle}
                value={p.title}
                onChange={(e) => updateProduct(i, { title: e.target.value })}
              />
            </Field>
            <Field label="Title (Hindi)">
              <input
                style={inputStyle}
                value={p.titleHi}
                onChange={(e) => updateProduct(i, { titleHi: e.target.value })}
              />
            </Field>
            <Field label="Media URL">
              <input
                style={inputStyle}
                value={p.mediaSrc}
                onChange={(e) => updateProduct(i, { mediaSrc: e.target.value })}
              />
            </Field>
            {p.mediaType === "image" && (
              <Field label="Image alt text">
                <input
                  style={inputStyle}
                  value={p.alt}
                  onChange={(e) => updateProduct(i, { alt: e.target.value })}
                />
              </Field>
            )}
            <Field label="WhatsApp quote subject (filled after &quot;Hi, I'd like a quote for …&quot;)">
              <input
                style={inputStyle}
                value={p.waText}
                onChange={(e) => updateProduct(i, { waText: e.target.value })}
              />
            </Field>
          </div>
        ))}
      </section>

      <footer style={{ display: "flex", justifyContent: "flex-end", padding: "16px 0 40px" }}>
        <button onClick={save} disabled={saving} style={primaryBtn}>
          {saving ? "Saving…" : "Save changes"}
        </button>
      </footer>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", marginTop: 10 }}>
      <div style={{ fontSize: 12, color: "#a1a1aa", marginBottom: 4 }}>{label}</div>
      {children}
    </label>
  );
}

const shellStyle: React.CSSProperties = {
  maxWidth: 880,
  margin: "0 auto",
  padding: "32px 24px",
  fontFamily:
    "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
  color: "#e4e4e7",
  background: "#0a0a0f",
  minHeight: "100vh",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 20,
  marginBottom: 20,
};

const cardStyle: React.CSSProperties = {
  background: "#13131a",
  border: "1px solid #27272f",
  borderRadius: 12,
  padding: 20,
  marginBottom: 16,
};

const sectionTitle: React.CSSProperties = {
  margin: "0 0 12px",
  fontSize: 16,
  fontWeight: 600,
  letterSpacing: 0.2,
  color: "#fafafa",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  background: "#0a0a0f",
  border: "1px solid #2a2a35",
  borderRadius: 6,
  color: "#fafafa",
  fontSize: 14,
  fontFamily: "inherit",
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: "vertical",
  lineHeight: 1.45,
};

const primaryBtn: React.CSSProperties = {
  background: "#60a5fa",
  color: "#0a0a0f",
  border: "none",
  padding: "9px 18px",
  borderRadius: 6,
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
};

const ghostBtn: React.CSSProperties = {
  background: "transparent",
  color: "#e4e4e7",
  border: "1px solid #2a2a35",
  padding: "6px 12px",
  borderRadius: 6,
  fontSize: 13,
  cursor: "pointer",
};

const miniBtn: React.CSSProperties = {
  background: "transparent",
  color: "#a1a1aa",
  border: "1px solid #2a2a35",
  padding: "4px 10px",
  borderRadius: 6,
  fontSize: 12,
  cursor: "pointer",
};
