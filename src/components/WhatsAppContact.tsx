"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const WA_NUMBER = "917838832332";

const QUICK_REPLIES = [
  {
    label: "I need a website",
    text: "Hi! I'd like to create a website for my business with Open Idea EcoSyz.",
  },
  {
    label: "Pricing details",
    text: "Hi! Can you share pricing details for Open Idea EcoSyz?",
  },
  {
    label: "Talk to the team",
    text: "Hi! I'd like to connect with the Open Idea EcoSyz team.",
  },
];

function waLink(message: string) {
  return `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(message)}`;
}

export default function WhatsAppContact() {
  const pathname = usePathname() ?? "";
  // Hide on tenant sites (/s/*), preview pages, and admin pages.
  const hidden =
    pathname.startsWith("/s/") ||
    pathname.startsWith("/preview") ||
    pathname.startsWith("/admin");

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const popupRef = useRef<HTMLDivElement | null>(null);

  // Click outside + Esc to close
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (hidden) return null;

  function handleSend(message: string) {
    const text = message.trim();
    if (!text) return;
    window.open(waLink(text), "_blank", "noopener,noreferrer");
    setDraft("");
    setOpen(false);
  }

  return (
    <div ref={popupRef} className="fixed bottom-5 right-5 z-50 sm:bottom-6 sm:right-6">
      {/* Popup */}
      {open && (
        <div className="mb-3 w-[320px] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl">
          {/* Header */}
          <div className="flex items-center gap-3 bg-[#075e54] px-4 py-3 text-white">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15">
              <WhatsAppIcon className="h-5 w-5" />
            </span>
            <div className="flex-1">
              <div className="text-sm font-semibold">Open Idea EcoSyz</div>
              <div className="flex items-center gap-1 text-[11px] text-emerald-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Typically replies within an hour
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              className="rounded-full p-1 text-white/80 hover:bg-white/10 hover:text-white"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="space-y-3 bg-[#e5ddd5] px-3 py-4">
            <div className="max-w-[80%] rounded-xl rounded-tl-sm bg-white px-3 py-2 text-sm text-zinc-800 shadow-sm">
              Hi! How can we help you today?
            </div>

            <div className="flex flex-col gap-2">
              {QUICK_REPLIES.map((q) => (
                <button
                  key={q.label}
                  onClick={() => handleSend(q.text)}
                  className="self-end rounded-xl rounded-br-sm bg-[#dcf8c6] px-3 py-2 text-left text-sm text-zinc-800 shadow-sm transition hover:bg-[#cdf0ad]"
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>

          {/* Composer */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend(draft);
            }}
            className="flex items-center gap-2 border-t border-zinc-200 bg-zinc-50 px-3 py-2"
          >
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type a message…"
              className="flex-1 rounded-full border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              aria-label="Send message"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-[#25d366] text-white shadow-sm transition hover:bg-[#1ebe5d] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M2.01 21l20.99-9L2.01 3 2 10.5l15 1.5-15 1.5z" />
              </svg>
            </button>
          </form>

          <div className="border-t border-zinc-100 bg-white py-2 text-center text-[10px] text-zinc-400">
            Opens WhatsApp · +91 78388 32332
          </div>
        </div>
      )}

      {/* Floating button */}
      <button
        type="button"
        aria-label={open ? "Close WhatsApp chat" : "Open WhatsApp chat"}
        onClick={() => setOpen((s) => !s)}
        className="group relative flex h-14 w-14 items-center justify-center rounded-full bg-[#25d366] text-white shadow-xl shadow-emerald-900/20 transition hover:scale-105 hover:bg-[#1ebe5d]"
      >
        <span
          aria-hidden
          className="absolute inset-0 animate-ping rounded-full bg-[#25d366] opacity-30"
        />
        <WhatsAppIcon className="relative h-7 w-7" />
        <span className="pointer-events-none absolute right-full mr-3 hidden whitespace-nowrap rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white opacity-0 transition group-hover:opacity-100 sm:block">
          Chat with us
        </span>
      </button>
    </div>
  );
}

function WhatsAppIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.626.712.226 1.36.194 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347zM12.02 2C6.494 2 2 6.494 2 12.022c0 1.764.46 3.488 1.337 5.005L2 22l5.084-1.318a9.964 9.964 0 004.937 1.282h.004c5.526 0 10.018-4.494 10.018-10.022 0-2.677-1.041-5.193-2.932-7.085A9.957 9.957 0 0012.02 2zm0 18.296h-.003a8.273 8.273 0 01-4.213-1.155l-.302-.18-3.137.814.837-3.056-.197-.314a8.247 8.247 0 01-1.262-4.388C3.743 7.482 7.46 3.766 12.02 3.766c2.205 0 4.279.859 5.838 2.419a8.205 8.205 0 012.418 5.84c-.001 4.559-3.719 8.27-8.256 8.27z" />
    </svg>
  );
}
