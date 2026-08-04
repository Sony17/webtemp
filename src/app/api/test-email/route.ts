import { NextResponse } from "next/server";
import { sendEmail, isEmailConfigured, emailFrom } from "@/lib/email/send";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!isEmailConfigured()) {
    return NextResponse.json(
      { ok: false, error: "RESEND_API_KEY is not set on this server." },
      { status: 503 }
    );
  }

  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const to = body.email?.trim();
  if (!to) {
    return NextResponse.json(
      { ok: false, error: "'email' is required." },
      { status: 400 }
    );
  }

  const result = await sendEmail({
    to,
    subject: "Open Groceries — test email",
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="margin:0 0 8px">Test email</h2>
      <p style="margin:0 0 16px;color:#444">If you're reading this, Resend is working correctly for <strong>${emailFrom()}</strong>.</p>
      <hr style="border:none;border-top:1px solid #eee" />
      <p style="color:#888;font-size:12px">Sent from the Open Groceries admin · ${new Date().toISOString()}</p>
    </div>`,
  });

  if (result.ok) {
    return NextResponse.json({ ok: true, id: result.id, from: emailFrom() });
  }

  return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
}
