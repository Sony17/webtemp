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
//   4. Optionally set EMAIL_FROM (defaults to "Open Groceries <support@openidea.co.in>").
//
// Shared helper: sendBuyerEmail extracts billing.email from the stored order and
// sends the provided subject/html. All callers fire-and-forget so a failure never
// blocks the callback ACK.
//
// Server-only: holds the API key, must never reach the client bundle.
import "server-only";
import { getOrder } from "@/lib/ondc/store";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

// Look up billing email from the stored order. Async so both backend (sync JSON
// and async Prisma) work — returns undefined when no order or no billing is known.
async function extractBillingEmail(
  transactionId: string,
  bppId: string
): Promise<string | undefined> {
  const record = await getOrder(transactionId, bppId);
  if (!record) return undefined;
  const rawOrder = record.order as
    | { billing?: { email?: string } }
    | undefined;
  return rawOrder?.billing?.email?.trim() || undefined;
}

// Fire-and-forget an email to the buyer associated with (transactionId, bppId).
// Looks up billing.email from the stored order. No-op when email is unconfigured
// or no billing email is known — never throws.
export async function sendBuyerEmail(
  transactionId: string,
  bppId: string,
  subject: string,
  html: string
): Promise<void> {
  const email = await extractBillingEmail(transactionId, bppId);
  if (!email) {
    console.log("email.sendBuyerEmail skipped — no billing email", {
      transactionId,
      bppId,
    });
    return;
  }
  await sendEmail({ to: email, subject, html });
}

// The verified From identity. Must be an address on a domain verified in Resend
// (or Resend's onboarding@resend.dev while testing). Override via EMAIL_FROM.
export function emailFrom(): string {
  return process.env.EMAIL_FROM?.trim() || "Open Groceries <support@openidea.co.in>";
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
