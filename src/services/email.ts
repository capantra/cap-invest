import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const ses = new SESv2Client({
  region: required("AWS_REGION"),
  credentials: {
    accessKeyId: required("AWS_ACCESS_KEY_ID"),
    secretAccessKey: required("AWS_SECRET_ACCESS_KEY"),
  },
});

export type SendEmailArgs = {
  to: string[];
  subject: string;
  html: string;
  text?: string;

  /**
   * Optional trace headers. These are helpful for debugging and,
   * depending on your SES event destination payloads, can be used
   * to correlate events.
   */
  headers?: Record<string, string>;
};

export type SendEmailResult = {
  messageId?: string;
};

export async function sendEmail({ to, subject, html, text, headers }: SendEmailArgs): Promise<SendEmailResult> {
  const from = required("MAIL_FROM");

  const additionalHeaders =
    headers && Object.keys(headers).length
      ? Object.entries(headers).map(([Name, Value]) => ({ Name, Value }))
      : [];

  const cmd = new SendEmailCommand({
    FromEmailAddress: from,
    Destination: { ToAddresses: to },
    Content: {
      Simple: {
        Subject: { Data: subject },
        Body: {
          Html: { Data: html },
          ...(text ? { Text: { Data: text } } : {}),
        },
        ...(additionalHeaders.length ? { Headers: additionalHeaders } : {}),
      },
    },
  });

  const resp = await ses.send(cmd);
  return { messageId: resp.MessageId };
}
