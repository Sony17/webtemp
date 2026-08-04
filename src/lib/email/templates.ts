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
function wrapHtml(body: string): string {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">${body}</div>`;
}

function footer(): string {
  return `<p style="color:#888;font-size:12px;margin-top:24px">Need help? Reply to this email or write to <a href="mailto:support@openidea.co.in" style="color:#2563eb">support@openidea.co.in</a>.</p>`;
}

function orderDetailsTable(opts: {
  orderId: string;
  total?: string;
}): string {
  const totalRow = opts.total
    ? `<tr><td style="padding:4px 0;color:#555">Total</td><td style="padding:4px 0;text-align:right;font-weight:600">${escapeHtml(opts.total)}</td></tr>`
    : "";
  return `<table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:4px 0;color:#555">Order ID</td><td style="padding:4px 0;text-align:right;font-weight:600">${escapeHtml(opts.orderId)}</td></tr>
    ${totalRow}
  </table>`;
}

export function orderConfirmationEmail(opts: {
  orderId: string;
  providerName?: string;
  total?: string;
  orderUrl?: string;
}): { subject: string; html: string } {
  const subject = `Your Open Groceries order is confirmed — #${opts.orderId}`;
  const seller = opts.providerName ? ` from ${escapeHtml(opts.providerName)}` : "";
  const cta = opts.orderUrl
    ? `<p style="margin:24px 0"><a href="${opts.orderUrl}" style="background:#2563eb;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;display:inline-block">View your order</a></p>`
    : "";

  const html = wrapHtml(`
  <h2 style="margin:0 0 8px">Order confirmed</h2>
  <p style="margin:0 0 16px;color:#444">Thanks for shopping on Open Groceries. Your order${seller} has been placed on the ONDC network.</p>
  ${orderDetailsTable(opts)}
  ${cta}
  ${footer()}
`);

  return { subject, html };
}

export function orderCancelledEmail(opts: {
  orderId: string;
  reason?: string;
  orderUrl?: string;
}): { subject: string; html: string } {
  const subject = `Order cancelled — #${opts.orderId}`;
  const reasonRow = opts.reason
    ? `<tr><td style="padding:4px 0;color:#555">Reason</td><td style="padding:4px 0;text-align:right;color:#dc2626">${escapeHtml(opts.reason)}</td></tr>`
    : "";
  const cta = opts.orderUrl
    ? `<p style="margin:24px 0"><a href="${opts.orderUrl}" style="background:#2563eb;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;display:inline-block">View order details</a></p>`
    : "";

  const html = wrapHtml(`
  <h2 style="margin:0 0 8px;color:#dc2626">Order cancelled</h2>
  <p style="margin:0 0 16px;color:#444">Your order has been cancelled by the seller.</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:4px 0;color:#555">Order ID</td><td style="padding:4px 0;text-align:right;font-weight:600">${escapeHtml(opts.orderId)}</td></tr>
    ${reasonRow}
  </table>
  ${cta}
  ${footer()}
`);

  return { subject, html };
}

export function orderUpdatedEmail(opts: {
  orderId: string;
  state?: string;
  description?: string;
  orderUrl?: string;
}): { subject: string; html: string } {
  const subject = `Order updated — #${opts.orderId}`;
  const desc = opts.description ? `<p style="margin:0 0 16px;color:#444">${escapeHtml(opts.description)}</p>` : "";
  const stateRow = opts.state
    ? `<tr><td style="padding:4px 0;color:#555">Status</td><td style="padding:4px 0;text-align:right;font-weight:600">${escapeHtml(opts.state)}</td></tr>`
    : "";
  const cta = opts.orderUrl
    ? `<p style="margin:24px 0"><a href="${opts.orderUrl}" style="background:#2563eb;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;display:inline-block">View order details</a></p>`
    : "";

  const html = wrapHtml(`
  <h2 style="margin:0 0 8px">Order updated</h2>
  ${desc}
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:4px 0;color:#555">Order ID</td><td style="padding:4px 0;text-align:right;font-weight:600">${escapeHtml(opts.orderId)}</td></tr>
    ${stateRow}
  </table>
  ${cta}
  ${footer()}
`);

  return { subject, html };
}

export function orderStatusEmail(opts: {
  orderId: string;
  state?: string;
  orderUrl?: string;
}): { subject: string; html: string } {
  const subject = `Order status update — #${opts.orderId}`;
  const stateRow = opts.state
    ? `<tr><td style="padding:4px 0;color:#555">Status</td><td style="padding:4px 0;text-align:right;font-weight:600">${escapeHtml(opts.state)}</td></tr>`
    : "";
  const cta = opts.orderUrl
    ? `<p style="margin:24px 0"><a href="${opts.orderUrl}" style="background:#2563eb;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;display:inline-block">Track your order</a></p>`
    : "";

  const html = wrapHtml(`
  <h2 style="margin:0 0 8px">Order status update</h2>
  <p style="margin:0 0 16px;color:#444">There's a new update on your order.</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:4px 0;color:#555">Order ID</td><td style="padding:4px 0;text-align:right;font-weight:600">${escapeHtml(opts.orderId)}</td></tr>
    ${stateRow}
  </table>
  ${cta}
  ${footer()}
`);

  return { subject, html };
}

export function orderTrackingEmail(opts: {
  orderId: string;
  trackingUrl?: string;
  orderUrl?: string;
}): { subject: string; html: string } {
  const subject = `Tracking updated — #${opts.orderId}`;
  const trackingCta = opts.trackingUrl
    ? `<p style="margin:24px 0"><a href="${opts.trackingUrl}" style="background:#2563eb;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;display:inline-block">Track your package</a></p>`
    : "";
  const cta = opts.orderUrl
    ? `<p style="margin:12px 0"><a href="${opts.orderUrl}" style="color:#2563eb;text-decoration:underline;font-size:14px">View order details</a></p>`
    : "";

  const html = wrapHtml(`
  <h2 style="margin:0 0 8px">Tracking updated</h2>
  <p style="margin:0 0 16px;color:#444">Your order is on the move. Check the latest tracking info.</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:4px 0;color:#555">Order ID</td><td style="padding:4px 0;text-align:right;font-weight:600">${escapeHtml(opts.orderId)}</td></tr>
  </table>
  ${trackingCta}
  ${cta}
  ${footer()}
`);

  return { subject, html };
}

export function issueUpdateEmail(opts: {
  issueId: string;
  orderId?: string;
  status: string;
  action?: string;
  shortDesc?: string;
  orderUrl?: string;
}): { subject: string; html: string } {
  const subject = `Issue update — #${opts.issueId}`;
  const orderRow = opts.orderId
    ? `<tr><td style="padding:4px 0;color:#555">Order ID</td><td style="padding:4px 0;text-align:right;font-weight:600">${escapeHtml(opts.orderId)}</td></tr>`
    : "";
  const desc = opts.shortDesc
    ? `<p style="margin:0 0 16px;color:#444">${escapeHtml(opts.shortDesc)}</p>`
    : "";
  const cta = opts.orderUrl
    ? `<p style="margin:24px 0"><a href="${opts.orderUrl}" style="background:#2563eb;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;display:inline-block">View issue details</a></p>`
    : "";

  const html = wrapHtml(`
  <h2 style="margin:0 0 8px">Issue update</h2>
  ${desc}
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:4px 0;color:#555">Issue ID</td><td style="padding:4px 0;text-align:right;font-weight:600">${escapeHtml(opts.issueId)}</td></tr>
    <tr><td style="padding:4px 0;color:#555">Status</td><td style="padding:4px 0;text-align:right;font-weight:600">${escapeHtml(opts.status)}</td></tr>
    ${orderRow}
  </table>
  ${cta}
  ${footer()}
`);

  return { subject, html };
}

export function supportContactEmail(opts: {
  transactionId: string;
  phone?: string;
  email?: string;
  orderUrl?: string;
}): { subject: string; html: string } {
  const subject = "Support contact received";
  const contactDetails = [];
  if (opts.phone) contactDetails.push(`<tr><td style="padding:4px 0;color:#555">Phone</td><td style="padding:4px 0;text-align:right">${escapeHtml(opts.phone)}</td></tr>`);
  if (opts.email) contactDetails.push(`<tr><td style="padding:4px 0;color:#555">Email</td><td style="padding:4px 0;text-align:right">${escapeHtml(opts.email)}</td></tr>`);
  const cta = opts.orderUrl
    ? `<p style="margin:24px 0"><a href="${opts.orderUrl}" style="background:#2563eb;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;display:inline-block">View order details</a></p>`
    : "";

  const html = wrapHtml(`
  <h2 style="margin:0 0 8px">Support contact</h2>
  <p style="margin:0 0 16px;color:#444">The seller has shared their support contact details for your order.</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    ${contactDetails.join("\n    ")}
  </table>
  ${cta}
  ${footer()}
`);

  return { subject, html };
}

export function ratingAcknowledgedEmail(opts: {
  transactionId: string;
  orderUrl?: string;
}): { subject: string; html: string } {
  const subject = "Rating acknowledged";
  const cta = opts.orderUrl
    ? `<p style="margin:24px 0"><a href="${opts.orderUrl}" style="background:#2563eb;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;display:inline-block">View order details</a></p>`
    : "";

  const html = wrapHtml(`
  <h2 style="margin:0 0 8px">Rating acknowledged</h2>
  <p style="margin:0 0 16px;color:#444">Thank you! The seller has acknowledged your rating.</p>
  ${cta}
  ${footer()}
`);

  return { subject, html };
}
