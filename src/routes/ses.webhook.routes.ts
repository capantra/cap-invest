// src/routes/ses.webhook.routes.ts
import { Router } from "express";
import https from "https";
import { prisma } from "../prisma";
import type { EmailRecipientStatus } from "@prisma/client";

export const sesWebhookRoutes = Router();

/**
 * SNS -> HTTPS webhook endpoint
 * POST /webhooks/ses/sns
 *
 * Expects SES events published to SNS (Bounce / Complaint).
 * We update EmailCampaignRecipient rows:
 *  1) Match by providerMessageId (SES mail.messageId) first
 *  2) Fallback to matching by email
 */
sesWebhookRoutes.post("/sns", async (req, res) => {
  try {
    const msgType = String(req.headers["x-amz-sns-message-type"] || "");
    const body: any = req.body;

    if (!body) return res.status(400).send("Missing body");

    // 1) Confirm SNS subscription
    if (msgType === "SubscriptionConfirmation" || body.Type === "SubscriptionConfirmation") {
      const url = body.SubscribeURL;

      if (typeof url === "string" && url.startsWith("https://")) {
        await new Promise<void>((resolve, reject) => {
          https
            .get(url, (r) => {
              r.on("data", () => {});
              r.on("end", () => resolve());
            })
            .on("error", reject);
        });
      }

      return res.json({ ok: true, subscribed: true });
    }

    // 2) Notifications
    if (msgType === "Notification" || body.Type === "Notification") {
      const raw = body.Message;
      const messageObj = typeof raw === "string" ? safeJson(raw) : raw;

      // SES via SNS usually looks like:
      // { notificationType: "Bounce"|"Complaint", mail: { messageId, destination: [...] }, bounce/complaint: {...} }
      const notificationType = String(messageObj?.notificationType || "");

      if (notificationType === "Bounce") {
        const sesMessageId = asString(messageObj?.mail?.messageId);
        const emails = normalizeEmails(messageObj?.mail?.destination);

        await handleBounceOrComplaint({
          kind: "BOUNCED",
          sesMessageId,
          emails,
          payload: messageObj,
        });
      }

      if (notificationType === "Complaint") {
        const sesMessageId = asString(messageObj?.mail?.messageId);
        const emails = normalizeEmails(messageObj?.mail?.destination);

        await handleBounceOrComplaint({
          kind: "COMPLAINED",
          sesMessageId,
          emails,
          payload: messageObj,
        });
      }

      return res.json({ ok: true });
    }

    return res.json({ ok: true, ignored: true });
  } catch (e) {
    console.error("SES/SNS webhook error:", e);
    return res.status(500).json({ ok: false });
  }
});

function safeJson(input: string) {
  try {
    return JSON.parse(input);
  } catch {
    return {};
  }
}

function asString(v: any): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : undefined;
}

function normalizeEmails(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => String(x || "").trim().toLowerCase())
    .filter(Boolean);
}

function clip(str: string, max = 900) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max) + "…" : str;
}

const STATUS_QUEUED: EmailRecipientStatus = "QUEUED";
const STATUS_SENT: EmailRecipientStatus = "SENT";
const STATUS_BOUNCED: EmailRecipientStatus = "BOUNCED";
const STATUS_COMPLAINED: EmailRecipientStatus = "COMPLAINED";

async function handleBounceOrComplaint(opts: {
  kind: "BOUNCED" | "COMPLAINED";
  sesMessageId?: string;
  emails: string[];
  payload: any;
}) {
  const { kind, sesMessageId, emails, payload } = opts;

  const payloadSnippet = clip(JSON.stringify(payload));
  let updated = 0;

  const openStates: EmailRecipientStatus[] = [STATUS_QUEUED, STATUS_SENT];
  const nextStatus: EmailRecipientStatus = kind === "BOUNCED" ? STATUS_BOUNCED : STATUS_COMPLAINED;

  // 1) Prefer matching by providerMessageId (SES mail.messageId)
  if (sesMessageId) {
    const r = await prisma.emailCampaignRecipient.updateMany({
      where: {
        providerMessageId: sesMessageId,
        status: { in: openStates },
      },
      data: {
        status: nextStatus,
        error: payloadSnippet,
      },
    });
    updated = r.count;
  }

  // 2) Fallback: match by email (if messageId missing or no rows matched)
  if (!updated && emails.length) {
    const r = await prisma.emailCampaignRecipient.updateMany({
      where: {
        email: { in: emails },
        status: { in: openStates },
      },
      data: {
        status: nextStatus,
        error: payloadSnippet,
      },
    });
    updated = r.count;
  }

  // 3) Complaint hygiene: opt-out from bulk updates
  if (nextStatus === STATUS_COMPLAINED && emails.length) {
    const users = await prisma.user.findMany({
      where: { email: { in: emails } },
      select: { id: true },
    });

    for (const u of users) {
      await prisma.emailPreference.upsert({
        where: { userId: u.id },
        update: { bulkUpdatesOptOut: true },
        create: { userId: u.id, bulkUpdatesOptOut: true },
      });
    }
  }

  // 4) Audit
  await prisma.auditLog.create({
    data: {
      action: nextStatus === STATUS_BOUNCED ? "SES_BOUNCE_RECEIVED" : "SES_COMPLAINT_RECEIVED",
      metadataJson: {
        kind: nextStatus,
        updated,
        sesMessageId: sesMessageId || null,
        emails,
      },
    },
  });
}
