// Transactional email via Resend (https://resend.com) — REST API, no SDK dep.
//
// Deliberately ENV-GATED and best-effort: if RESEND_API_KEY isn't set, sendEmail
// is a no-op that logs and returns { ok:false } — so this ships safely BEFORE the
// Resend account / domain / key exist, and an email failure never breaks the
// order flow that triggers it.
//
// Setup (all on the Resend side, then Vercel env):
//   1. Create a Resend account (ecosyz2024@gmail.com).
//   2. Add + verify the domain openidea.co.in (DNS: SPF + DKIM records Resend
//      gives you) so mail can be sent FROM support@openidea.co.in.
//   3. Create an API key → set RESEND_API_KEY in Vercel (Production).
//   4. Optionally set EMAIL_FROM (defaults to "OpenIdea <support@openidea.co.in>").
//
// Server-only: holds the API key, must never reach the client bundle.
import "server-only";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

// The verified From identity. Must be an address on a domain verified in Resend
// (or Resend's onboarding@resend.dev while testing). Override via EMAIL_FROM.
export function emailFrom(): string {
  return process.env.EMAIL_FROM?.trim() || "OpenIdea <support@openidea.co.in>";
}

// Whether email is wired (an API key is present). Callers can skip work when off.
export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY?.trim();
}

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  html: string;
  // Where replies go — defaults to the From address (support@openidea.co.in).
  replyTo?: string;
};

export type SendEmailResult = { ok: true; id?: string } | { ok: false; error: string };

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) {
    // Not configured yet — no-op (safe to ship before the account exists).
    console.log("email.send skipped — RESEND_API_KEY not set", {
      to: input.to,
      subject: input.subject,
    });
    return { ok: false, error: "email not configured" };
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: emailFrom(),
        to: Array.isArray(input.to) ? input.to : [input.to],
        subject: input.subject,
        html: input.html,
        reply_to: input.replyTo ?? emailFrom(),
      }),
      cache: "no-store",
    });

    const data = (await res.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
    };
    if (!res.ok) {
      console.warn("email.send failed", { status: res.status, message: data?.message });
      return { ok: false, error: data?.message ?? `HTTP ${res.status}` };
    }
    console.log("email.send ok", { id: data?.id, subject: input.subject });
    return { ok: true, id: data?.id };
  } catch (err) {
    console.warn("email.send error", {
      msg: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "network error" };
  }
}
