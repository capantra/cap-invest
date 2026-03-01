// src/services/otp.service.ts
import { prisma } from "../prisma";
import { randomOtp6, sha256 } from "../utils/crypto";
import { sendEmail } from "./email.service";
import { renderEmailTemplate, escapeHtml } from "./email.templates";

export async function issueLoginOtp(params: {
  userId: string;
  email: string;
  ttlMinutes: number;
}) {
  const otp = randomOtp6();
  const otpHash = sha256(otp);
  const expiresAt = new Date(Date.now() + params.ttlMinutes * 60 * 1000);

  await prisma.emailOtp.create({
    data: {
      userId: params.userId,
      otpHash,
      purpose: "LOGIN_2FA",
      expiresAt,
    },
  });

  const inner = `
    <p style="margin:0 0 12px;">
      Use the verification code below to sign in:
    </p>

    <div style="
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
      font-size:28px;
      letter-spacing:0.14em;
      font-weight:900;
      padding:14px 16px;
      border:1px solid rgba(0,0,0,0.08);
      border-radius:14px;
      display:inline-block;
      background:#f8fafc;
    ">
      ${escapeHtml(otp)}
    </div>

    <p style="margin:12px 0 0; color:#64748b; font-size:13px;">
      This code expires in ${escapeHtml(String(params.ttlMinutes))} minutes.
    </p>
  `.trim();

  const html = renderEmailTemplate({
    title: "Your verification code",
    preheader: `Your code is ${otp} (expires soon).`,
    bodyHtml: inner,
  });

  await sendEmail({
    to: params.email,
    subject: "Capantra — Your verification code",
    html,
    text: `Your verification code: ${otp}\nExpires in ${params.ttlMinutes} minutes.`,
  });

  return { expiresAt };
}

export async function verifyLoginOtp(params: { userId: string; otp: string }) {
  const otpHash = sha256(params.otp);
  const record = await prisma.emailOtp.findFirst({
    where: {
      userId: params.userId,
      purpose: "LOGIN_2FA",
      otpHash,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!record) return false;

  await prisma.emailOtp.update({
    where: { id: record.id },
    data: { usedAt: new Date() },
  });

  return true;
}
