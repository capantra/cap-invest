// src/services/invite.service.ts
import { prisma } from "../prisma";
import { randomToken, sha256 } from "../utils/crypto";
import { sendEmail } from "./email.service";
import { renderEmailTemplate, escapeHtml } from "./email.templates";

export async function createInvite(params: {
  email: string;
  role: "ADMIN" | "INVESTOR" | "PREINVESTOR";
  canViewTreasury?: boolean;
  createdBy?: string;
  appUrl: string;
  ttlHours: number;
}) {
  const raw = randomToken(32);
  const tokenHash = sha256(raw);
  const expiresAt = new Date(Date.now() + params.ttlHours * 60 * 60 * 1000);

  await prisma.invite.create({
    data: {
      email: params.email.toLowerCase(),
      role: params.role,
      canViewTreasury: Boolean(params.canViewTreasury),
      tokenHash,
      expiresAt,
      createdBy: params.createdBy,
    },
  });

  // Your system uses /invite/<raw> in this file, so keep it consistent:
  const link = `${params.appUrl}/invite/${raw}`;

  const inner = `
    <p style="margin:0 0 10px;">
      You’ve been invited to access the Capantra Investor Portal.
    </p>
    <p style="margin:0 0 10px;">
      This invite expires on <strong>${escapeHtml(expiresAt.toISOString())}</strong>.
    </p>
    <p style="margin:0;">
      If you weren’t expecting this invite, you can ignore this email.
    </p>
  `.trim();

  const html = renderEmailTemplate({
    title: "You’ve been invited",
    preheader: "Set your password and access the investor portal.",
    bodyHtml: inner,
    primaryAction: { label: "Accept invite", href: link },
    secondaryAction: { label: "Open portal", href: params.appUrl },
  });

  await sendEmail({
    to: params.email,
    subject: "Capantra Investor Portal — Your invite",
    html,
    text: `You’ve been invited to access the investor portal.\nAccept invite: ${link}\nExpires: ${expiresAt.toISOString()}`,
  });

  return { expiresAt };
}
