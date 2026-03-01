// src/services/email.templates.ts

type EmailTemplateParams = {
  title?: string;              // e.g. "You’ve been invited"
  preheader?: string;          // hidden preview line for inboxes
  bodyHtml: string;            // your content (already escaped/safe)
  primaryAction?: { label: string; href: string };
  secondaryAction?: { label: string; href: string };
  footerNote?: string;         // optional extra footer text
  unsubscribeHref?: string | null; // optional unsubscribe link
};

const BRAND = {
  product: "Capantra Investor Portal",
  logoUrl: "https://pub-1e587b8a735340e788c5a49ed8f83204.r2.dev/Brand/logo.png",
  accent: "#009755",
  bg: "#f6f8fb",
  text: "#0f172a",
  muted: "#64748b",
  border: "#e5e7eb",
};

export function renderEmailTemplate(params: EmailTemplateParams) {
  const title = params.title || BRAND.product;

  // Preheader: hidden but improves inbox preview
  const preheader = (params.preheader || "").trim();

  const primaryBtn = params.primaryAction
    ? `
      <div style="margin-top:18px;">
        <a href="${params.primaryAction.href}"
          style="
            display:inline-block;
            background:${BRAND.accent};
            color:#06221f;
            text-decoration:none;
            font-weight:700;
            padding:12px 16px;
            border-radius:12px;
            border:1px solid rgba(0,0,0,0.06);
          ">
          ${escapeHtml(params.primaryAction.label)}
        </a>
      </div>
    `
    : "";

  const secondaryBtn = params.secondaryAction
    ? `
      <div style="margin-top:10px;">
        <a href="${params.secondaryAction.href}"
          style="color:${BRAND.muted}; text-decoration:underline; font-size:14px;">
          ${escapeHtml(params.secondaryAction.label)}
        </a>
      </div>
    `
    : "";

  const unsubscribe = params.unsubscribeHref
    ? `
      <div style="margin-top:14px;">
        <a href="${params.unsubscribeHref}" style="color:${BRAND.muted}; text-decoration:underline;">
          Unsubscribe from bulk updates
        </a>
      </div>
    `
    : "";

  const footerNote = params.footerNote
    ? `<div style="margin-top:10px;">${escapeHtml(params.footerNote)}</div>`
    : "";

  // IMPORTANT: bodyHtml is expected to be safe HTML you control.
  // Don’t pipe untrusted user input into it without escaping.
  const html = `
  <!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>${escapeHtml(title)}</title>
    </head>
    <body style="margin:0; padding:0; background:${BRAND.bg}; color:${BRAND.text};">
      ${preheader ? `
        <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">
          ${escapeHtml(preheader)}
        </div>
      ` : ""}

      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${BRAND.bg}; padding:22px 0;">
        <tr>
          <td align="center" style="padding:0 16px;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="640"
              style="
                width:640px; max-width:640px;
                background:#ffffff;
                border:1px solid ${BRAND.border};
                border-radius:18px;
                overflow:hidden;
                box-shadow:0 10px 30px rgba(2,6,23,0.06);
              ">
              <!-- Header -->
              <tr>
                <td style="padding:18px 20px; border-bottom:1px solid ${BRAND.border};">
                  <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                    <tr>
                      <td style="vertical-align:middle;">
                        <img src="${BRAND.logoUrl}" width="120" alt="Capantra" style="display:block; height:auto;" />
                      </td>
                      <td align="right" style="vertical-align:middle; font-size:12px; color:${BRAND.muted};">
                        ${escapeHtml(BRAND.product)}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Body -->
              <tr>
                <td style="padding:22px 20px;">
                  <div style="font-size:18px; font-weight:800; margin:0 0 6px;">
                    ${escapeHtml(title)}
                  </div>

                  <div style="font-size:14px; color:${BRAND.muted}; margin:0 0 16px;">
                    Secure portal • Audit logged
                  </div>

                  <div style="font-size:14px; line-height:1.6;">
                    ${params.bodyHtml}
                  </div>

                  ${primaryBtn}
                  ${secondaryBtn}
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="padding:16px 20px; border-top:1px solid ${BRAND.border}; background:#fbfdff;">
                  <div style="font-size:12px; line-height:1.5; color:${BRAND.muted};">
                    © ${new Date().getFullYear()} Capantra. All rights reserved.<br/>
                    Confidential — intended only for the recipient.
                    ${unsubscribe}
                    ${footerNote}
                  </div>
                </td>
              </tr>
            </table>

            <div style="font-size:11px; color:${BRAND.muted}; margin-top:12px;">
              If you can’t click the button, copy/paste the link into your browser.
            </div>
          </td>
        </tr>
      </table>
    </body>
  </html>
  `.trim();

  return html;
}

export function escapeHtml(s: string) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
