// src/services/updates.service.ts

import { prisma } from "../prisma";
import { sendEmail } from "./email.service";
import { createUnsubscribeToken } from "./unsubscribe.service";
import { renderEmailTemplate, escapeHtml as escapeHtmlTpl } from "./email.templates";
import { s3Service } from "./s3.service";

/**
 * Publish distribution:
 * - For INVESTOR_ONLY: send only to INVESTOR (unless admin manually picks SELECTED)
 * - For PORTAL_ALL: send to INVESTOR + PREINVESTOR (but exclude opted-out preinvestors)
 * - Always exclude inactive users
 * - Always include unsubscribe link for PREINVESTOR recipients (bulk emails only)
 */
export async function sendBulkUpdateForPublishedUpdate(params: {
  updateId: string;
  actorUserId: string;
  appUrl: string;
  audienceMode: string; // AUTO | INVESTORS | PREINVESTORS | ALL | SELECTED
  selectedEmails?: string; // comma/newline separated
}) {
  const update = await prisma.update.findUnique({
    where: { id: params.updateId },
    include: {
      type: true,
      attachments: true,
    },
  });
  if (!update || !update.publishedAt) return;

  // Determine audience
  let mode = params.audienceMode || "AUTO";
  if (mode === "AUTO") {
    mode = update.visibility === "INVESTOR_ONLY" ? "INVESTORS" : "ALL";
  }

  // Build recipient list
  let recipients: { id: string; email: string; role: string; bulkOptOut: boolean }[] = [];

  if (mode === "SELECTED") {
    const raw = (params.selectedEmails || "")
      .split(/[\n,]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    if (raw.length === 0) return;

    const users = await prisma.user.findMany({
      where: { email: { in: raw }, isActive: true },
      include: { preferences: true },
    });

    recipients = users.map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      bulkOptOut: !!u.preferences?.bulkUpdatesOptOut,
    }));
  } else {
    const roleFilter =
      mode === "INVESTORS"
        ? ["INVESTOR"]
        : mode === "PREINVESTORS"
        ? ["PREINVESTOR"]
        : ["INVESTOR", "PREINVESTOR"];

    const users = await prisma.user.findMany({
      where: { role: { in: roleFilter as any }, isActive: true },
      include: { preferences: true },
    });

    recipients = users.map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      bulkOptOut: !!u.preferences?.bulkUpdatesOptOut,
    }));
  }

  // Apply unsubscribe suppression: only preinvestors who opted out
  recipients = recipients.filter((r) => !(r.role === "PREINVESTOR" && r.bulkOptOut));
  if (recipients.length === 0) return;

  // Create campaign snapshot
  const campaign = await prisma.emailCampaign.create({
    data: {
      subject: `[${update.type.name}] ${update.title}`,
      bodyHtml: buildUpdateEmailHtml(update, params.appUrl, /*unsubscribe*/ null),
      audienceMode:
        (mode === "INVESTORS"
          ? "INVESTORS"
          : mode === "PREINVESTORS"
          ? "PREINVESTORS"
          : mode === "SELECTED"
          ? "SELECTED"
          : "ALL") as any,
      createdBy: params.actorUserId,
    },
  });

  // Insert recipients snapshot
  await prisma.emailCampaignRecipient.createMany({
    data: recipients.map((r) => ({
      campaignId: campaign.id,
      userId: r.id,
      email: r.email,
      status: "QUEUED",
    })),
    skipDuplicates: true,
  });

  // Send (simple sequential v1)
  for (const r of recipients) {
    try {
      const unsubscribeLink =
        r.role === "PREINVESTOR" ? await buildUnsubLink(params.appUrl, r.id) : null;

      const html = buildUpdateEmailHtml(update, params.appUrl, unsubscribeLink);

      // Download PDF attachments from S3 if they exist
      const attachments = [];
      if (update.attachments && update.attachments.length > 0) {
        for (const att of update.attachments) {
          try {
            const buffer = await s3Service.downloadFile(att.storageKey);
            attachments.push({
              filename: att.fileName,
              content: buffer,
              contentType: att.mimeType,
            });
          } catch (err) {
            console.error(`Failed to download attachment ${att.storageKey}:`, err);
          }
        }
      }

      const info = await sendEmail({
        to: r.email,
        subject: campaign.subject,
        html,
        attachments,
        configurationSetName: process.env.SES_CONFIGURATION_SET || undefined,
        tags: { kind: "bulk_update", campaignId: campaign.id, updateId: update.id },
      });

      await prisma.emailCampaignRecipient.update({
        where: { campaignId_userId: { campaignId: campaign.id, userId: r.id } },
        data: {
          status: "SENT",
          providerMessageId: info?.messageId || null,
          sentAt: new Date(),
        },
      });
    } catch (e: any) {
      await prisma.emailCampaignRecipient.update({
        where: { campaignId_userId: { campaignId: campaign.id, userId: r.id } },
        data: {
          status: "FAILED",
          error: String(e?.message || e),
          sentAt: new Date(),
        },
      });
    }
  }

  await prisma.emailCampaign.update({
    where: { id: campaign.id },
    data: { sentAt: new Date() },
  });

  // Audit
  await prisma.auditLog.create({
    data: {
      actorUserId: params.actorUserId,
      action: "CAMPAIGN_SENT_FOR_UPDATE",
      targetType: "Update",
      targetId: update.id,
      metadataJson: { campaignId: campaign.id, recipients: recipients.length, mode },
      createdAt: new Date(),
    },
  });
}

function buildUpdateEmailHtml(
  update: {
    id: string;
    title: string;
    bodyHtml: string | null;
    type: { name: string };
    attachments: any[];
  },
  appUrl: string,
  unsubscribeLink: string | null
) {
  const viewLink = `${appUrl}/updates/${update.id}`;
  const hasPdf = update.attachments?.length > 0;
  const firstFile = hasPdf ? update.attachments[0] : null;

  // NOTE:
  // - update.bodyHtml is assumed to be admin-authored HTML (already "trusted" within your system).
  // - if you ever allow untrusted input here, sanitize before storing/using it.
  const inner = `
    <div style="margin-bottom:10px; color:#64748b; font-size:13px;">
      <strong>Type:</strong> ${escapeHtmlTpl(update.type.name)}
    </div>

    ${update.bodyHtml ? `<div>${update.bodyHtml}</div>` : `<p style="margin:0;">(No additional notes)</p>`}

    ${
      firstFile
        ? `<div style="margin-top:14px; color:#64748b; font-size:13px;">
            <strong>Attachment:</strong> ${escapeHtmlTpl(firstFile.fileName)}
          </div>`
        : ""
    }
  `.trim();

  return renderEmailTemplate({
    title: update.title,
    preheader: `${update.type.name} — ${update.title}`,
    bodyHtml: inner,
    primaryAction: { label: "View in portal", href: viewLink },
    unsubscribeHref: unsubscribeLink,
    footerNote: unsubscribeLink
      ? "You’ll still receive essential security/account emails."
      : undefined,
  });
}

async function buildUnsubLink(appUrl: string, userId: string) {
  const ttlDays = Number(process.env.UNSUB_TTL_DAYS || 365);
  const raw = await createUnsubscribeToken({ userId, ttlDays });
  return `${appUrl}/unsubscribe?token=${encodeURIComponent(raw)}`;
}
