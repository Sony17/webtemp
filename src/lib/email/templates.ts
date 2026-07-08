// Email templates (plain, inline-styled HTML — email clients ignore <style>/CSS
// files, so everything is inlined). Server-only alongside the sender.
import "server-only";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Order-confirmation email sent to the buyer after /confirm is accepted.
export function orderConfirmationEmail(opts: {
  orderId: string;
  providerName?: string;
  total?: string;
  orderUrl?: string;
}): { subject: string; html: string } {
  const subject = `Your OpenIdea order is confirmed — #${opts.orderId}`;
  const seller = opts.providerName ? ` from ${escapeHtml(opts.providerName)}` : "";
  const totalRow = opts.total
    ? `<tr><td style="padding:4px 0;color:#555">Total</td><td style="padding:4px 0;text-align:right;font-weight:600">${escapeHtml(opts.total)}</td></tr>`
    : "";
  const cta = opts.orderUrl
    ? `<p style="margin:24px 0"><a href="${opts.orderUrl}" style="background:#2563eb;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;display:inline-block">View your order</a></p>`
    : "";

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">
  <h2 style="margin:0 0 8px">Order confirmed 🎉</h2>
  <p style="margin:0 0 16px;color:#444">Thanks for shopping on OpenIdea. Your order${seller} has been placed on the ONDC network.</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:4px 0;color:#555">Order ID</td><td style="padding:4px 0;text-align:right;font-weight:600">${escapeHtml(opts.orderId)}</td></tr>
    ${totalRow}
  </table>
  ${cta}
  <p style="color:#888;font-size:12px;margin-top:24px">Need help? Just reply to this email or write to support@openidea.co.in.</p>
</div>`;

  return { subject, html };
}
