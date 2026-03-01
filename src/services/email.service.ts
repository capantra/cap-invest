import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

function buildFrom(): string {
  // Prefer a single MAIL_FROM if you have it (e.g. "Capantra <no-reply@capantra.com>")
  const mailFrom = optional("MAIL_FROM");
  if (mailFrom) return mailFrom;

  const name = optional("MAIL_FROM_NAME");
  const email = optional("MAIL_FROM_EMAIL");

  if (email && name) return `${name} <${email}>`;
  if (email) return email;

  // Fallback: force a clear error instead of silently using localhost SMTP
  throw new Error("Missing MAIL_FROM or MAIL_FROM_EMAIL (+ optional MAIL_FROM_NAME).");
}

const ses = new SESv2Client({
  region: required("AWS_REGION"),
  credentials: {
    accessKeyId: required("AWS_ACCESS_KEY_ID"),
    secretAccessKey: required("AWS_SECRET_ACCESS_KEY"),
  },
});

export async function sendEmail(opts: {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  /**
   * Optional: array of attachments
   */
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
  }>;
  /**
   * SESv2 Simple emails do not support arbitrary SMTP-style headers.
   * Keep this field for compatibility; we safely ignore it.
   * If you need headers like List-Unsubscribe, we can switch to Raw emails later.
   */
  headers?: Record<string, string>;
  /**
   * Optional: if you configured an SES Configuration Set for SNS events, set it here.
   * Example: "investor-portal"
   */
  configurationSetName?: string;
  /**
   * Optional: pass tags through to SES (useful for tracking)
   */
  tags?: Record<string, string>;
}) {
  const from = buildFrom();

  const toAddresses = Array.isArray(opts.to) ? opts.to : [opts.to];
  const cleanTo = toAddresses.map((e) => String(e).trim().toLowerCase()).filter(Boolean);
  if (cleanTo.length === 0) throw new Error("Missing recipient email.");

  // If attachments are provided, use Raw email format
  if (opts.attachments && opts.attachments.length > 0) {
    const rawEmail = buildRawEmailWithAttachments({
      from,
      to: cleanTo,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      attachments: opts.attachments,
    });

    const cmd = new SendEmailCommand({
      FromEmailAddress: from,
      Destination: {
        ToAddresses: cleanTo,
      },
      Content: {
        Raw: {
          Data: rawEmail,
        },
      },
      ...(opts.configurationSetName ? { ConfigurationSetName: opts.configurationSetName } : {}),
      ...(opts.tags
        ? {
            EmailTags: Object.entries(opts.tags).map(([Name, Value]) => ({ Name, Value })),
          }
        : {}),
    });

    const resp = await ses.send(cmd);
    return { messageId: resp.MessageId || null };
  }

  // Simple email (no attachments)
  const cmd = new SendEmailCommand({
    FromEmailAddress: from,
    Destination: {
      ToAddresses: cleanTo,
    },
    Content: {
      Simple: {
        Subject: { Data: opts.subject },
        Body: {
          Html: { Data: opts.html },
          ...(opts.text ? { Text: { Data: opts.text } } : {}),
        },
      },
    },
    ...(opts.configurationSetName ? { ConfigurationSetName: opts.configurationSetName } : {}),
    ...(opts.tags
      ? {
          EmailTags: Object.entries(opts.tags).map(([Name, Value]) => ({ Name, Value })),
        }
      : {}),
  });

  const resp = await ses.send(cmd);
  return { messageId: resp.MessageId || null };
}

/**
 * Build a raw MIME email with attachments
 */
function buildRawEmailWithAttachments(params: {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text?: string;
  attachments: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
  }>;
}): Buffer {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36)}`;
  const altBoundary = `----=_Alt_${Date.now()}_${Math.random().toString(36)}`;

  let raw = `From: ${params.from}\r\n`;
  raw += `To: ${params.to.join(", ")}\r\n`;
  raw += `Subject: ${params.subject}\r\n`;
  raw += `MIME-Version: 1.0\r\n`;
  raw += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n`;
  raw += `\r\n`;

  // Multipart alternative (text + html)
  raw += `--${boundary}\r\n`;
  raw += `Content-Type: multipart/alternative; boundary="${altBoundary}"\r\n`;
  raw += `\r\n`;

  if (params.text) {
    raw += `--${altBoundary}\r\n`;
    raw += `Content-Type: text/plain; charset=utf-8\r\n`;
    raw += `Content-Transfer-Encoding: base64\r\n`;
    raw += `\r\n`;
    raw += Buffer.from(params.text).toString("base64") + `\r\n`;
  }

  raw += `--${altBoundary}\r\n`;
  raw += `Content-Type: text/html; charset=utf-8\r\n`;
  raw += `Content-Transfer-Encoding: base64\r\n`;
  raw += `\r\n`;
  raw += Buffer.from(params.html).toString("base64") + `\r\n`;
  raw += `--${altBoundary}--\r\n`;

  // Attachments
  for (const att of params.attachments) {
    raw += `--${boundary}\r\n`;
    raw += `Content-Type: ${att.contentType}; name="${att.filename}"\r\n`;
    raw += `Content-Transfer-Encoding: base64\r\n`;
    raw += `Content-Disposition: attachment; filename="${att.filename}"\r\n`;
    raw += `\r\n`;
    raw += att.content.toString("base64") + `\r\n`;
  }

  raw += `--${boundary}--\r\n`;

  return Buffer.from(raw);
}
