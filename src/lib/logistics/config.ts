// Tocxi Partner API config — read from ENV.
//
// Open Groceries books last-mile courier delivery through Tocxi's bilateral REST
// Partner API (https://www.tocxi.com/partner-api.html): we POST a shipment from
// our order backend, Tocxi delivers it via its own riders, and status flows back
// to us over webhooks. Every outbound call carries an `X-API-Key`; every inbound
// webhook is HMAC-SHA256 signed with a shared webhook secret.
//
// The API key and webhook secret are SECRETS — they must never live in this
// PUBLIC repo. Set them in Vercel → Settings → Environment Variables (Production),
// then redeploy (see project_vercel_deploy):
//
//   TOCXI_API_KEY         — issued once at onboarding (pk_live_…)   [SECRET]
//   TOCXI_WEBHOOK_SECRET  — keys the X-Tocxi-Signature HMAC          [SECRET]
//   TOCXI_BASE_URL        — API origin; defaults to https://api.tocxi.com
//
// Read via a getter (not a module-load constant) so serverless picks up the
// runtime environment on each request — mirrors src/lib/payments/config.ts.
// Missing key/secret return "" so isTocxiConfigured() can gate the routes with a
// clean 503 rather than throwing at import time.
export type TocxiConfig = {
  apiKey: string;
  baseUrl: string;
  webhookSecret: string;
};

// The public Tocxi base URL, used when TOCXI_BASE_URL is unset. A trailing slash
// is stripped so callers can join paths as `${baseUrl}/api/v1/...` unambiguously.
const DEFAULT_BASE_URL = "https://api.tocxi.com";

export function getTocxiConfig(): TocxiConfig {
  const env = (key: string): string => process.env[key]?.trim() ?? "";
  const baseUrl = env("TOCXI_BASE_URL") || DEFAULT_BASE_URL;
  return {
    apiKey: env("TOCXI_API_KEY"),
    // Normalize away a trailing slash so path joins never double up.
    baseUrl: baseUrl.replace(/\/+$/, ""),
    webhookSecret: env("TOCXI_WEBHOOK_SECRET"),
  };
}

// True once the API key is present — the minimum needed to talk to Tocxi. The
// logistics routes gate on this and return a clean 503 when unconfigured, the
// same posture the ONDC routes take (isOndcConfigured). The webhook secret is
// checked separately by the webhook route (a booking can work before an inbound
// URL is registered).
export function isTocxiConfigured(): boolean {
  return getTocxiConfig().apiKey.length > 0;
}

// True once a webhook secret is present — the minimum needed to VERIFY inbound
// status callbacks. The webhook route gates on this: without a secret we cannot
// authenticate Tocxi, so we must reject rather than trust an unsigned body.
export function isTocxiWebhookConfigured(): boolean {
  return getTocxiConfig().webhookSecret.length > 0;
}
