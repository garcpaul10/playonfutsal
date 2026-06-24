/**
 * emailTemplate.ts — Branded HTML email renderer for PlayOn.
 *
 * All outgoing emails pass through `renderEmail()` which accepts a structured
 * payload and returns both an HTML and a plain-text version of the message.
 * Adding a new email type only requires constructing the payload — no raw HTML
 * copy-paste needed.
 *
 * Brand tokens:
 *   Primary crimson : #921236
 *   Dark header     : #111118
 *   Card bg         : #ffffff
 *   Body text       : #1e293b
 *   Muted text      : #64748b
 */

import fs from "fs";
import path from "path";

function loadLogoDataUri(): string {
  try {
    const logoPath = path.resolve(__dirname, "../assets/PlayOn_logo.png");
    const data = fs.readFileSync(logoPath);
    return `data:image/png;base64,${data.toString("base64")}`;
  } catch {
    return "";
  }
}

const LOGO_DATA_URI = loadLogoDataUri();

export interface EmailTemplatePayload {
  subject: string;
  preheader?: string;
  heading: string;
  bodyParagraphs: string[];
  cta?: {
    label: string;
    url: string;
  };
}

const APP_URL = (process.env.PUBLIC_APP_URL ?? "https://playon.replit.app").replace(/\/$/, "");

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderEmail(payload: EmailTemplatePayload): { html: string; text: string } {
  const { heading, bodyParagraphs, cta, preheader } = payload;

  const preheaderHtml = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}&nbsp;&zwnj;&nbsp;</div>`
    : "";

  const paragraphsHtml = bodyParagraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#1e293b;">${escapeHtml(p)}</p>`,
    )
    .join("\n");

  const ctaHtml = cta
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
        <tr>
          <td style="border-radius:6px;background:#921236;color-scheme:light;">
            <a href="${escapeHtml(cta.url)}"
               style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;
                      color:#ffffff;text-decoration:none;border-radius:6px;
                      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
              ${escapeHtml(cta.label)}
            </a>
          </td>
        </tr>
      </table>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${escapeHtml(payload.subject)}</title>
  <style>:root { color-scheme: light only; }</style>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color-scheme:light;">
  ${preheaderHtml}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="background:#f1f5f9;min-width:100%;">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <!-- Card -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="max-width:560px;border-radius:10px;overflow:hidden;
                      box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:#111118;padding:20px 32px;text-align:left;color-scheme:light;">
              <img src="${LOGO_DATA_URI}"
                   alt="PlayOn"
                   height="48"
                   style="display:block;border:0;outline:none;text-decoration:none;height:48px;width:auto;" />
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:#ffffff;padding:32px 32px 24px 32px;color-scheme:light;">
              <h1 style="margin:0 0 20px 0;font-size:22px;font-weight:700;
                         color:#111118;line-height:1.3;">
                ${escapeHtml(heading)}
              </h1>
              ${paragraphsHtml}
              ${ctaHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;color-scheme:light;">
              <p style="margin:0 0 6px 0;font-size:12px;color:#64748b;line-height:1.5;">
                You're receiving this because you have an account with
                <a href="${APP_URL}" style="color:#921236;text-decoration:none;">PlayOn</a>.
                If you have questions, reply to this email or visit
                <a href="${APP_URL}" style="color:#921236;text-decoration:none;">${APP_URL.replace(/^https?:\/\//, "")}</a>.
              </p>
              <p style="margin:0;font-size:11px;color:#94a3b8;">
                &copy; ${new Date().getFullYear()} PlayOn. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
        <!-- /Card -->

      </td>
    </tr>
  </table>
</body>
</html>`;

  const divider = "─".repeat(48);
  const ctaText = cta ? `\n${cta.label}: ${cta.url}\n` : "";
  const text = [
    `PlayOn`,
    divider,
    heading,
    divider,
    ...bodyParagraphs,
    ctaText,
    divider,
    `© ${new Date().getFullYear()} PlayOn  |  ${APP_URL}`,
  ]
    .join("\n\n")
    .trim();

  return { html, text };
}

// ─── Registration Confirmation Email ─────────────────────────────────────────

export interface RegistrationConfirmationParams {
  playerName: string;
  eventName: string;
  eventType: string;
  dates: string;
  times?: string;
  venue?: string;
  poolOrDivision?: string;
  amountPaid: string;
  qrDataUri: string;
}

/**
 * Renders a branded registration confirmation email with an embedded QR code image.
 * Returns { html, text, subject }.
 */
export function registrationConfirmationEmail(params: RegistrationConfirmationParams): {
  html: string;
  text: string;
  subject: string;
} {
  const { playerName, eventName, eventType, dates, times, venue, poolOrDivision, amountPaid, qrDataUri } = params;
  const subject = `You're registered — ${eventName}`;
  const preheader = `Your spot for ${eventName} is confirmed. Show your QR code at the door to check in.`;
  const APP_URL = (process.env.PUBLIC_APP_URL ?? "https://playon.replit.app").replace(/\/$/, "");

  const detailRows: { label: string; value: string }[] = [
    { label: "Event", value: escapeHtml(eventName) },
    { label: "Type", value: escapeHtml(eventType) },
    { label: "Date(s)", value: escapeHtml(dates) },
  ];
  if (times) detailRows.push({ label: "Time(s)", value: escapeHtml(times) });
  if (venue) detailRows.push({ label: "Venue", value: escapeHtml(venue) });
  if (poolOrDivision) detailRows.push({ label: "Pool / Division", value: escapeHtml(poolOrDivision) });
  detailRows.push({ label: "Amount Paid", value: escapeHtml(amountPaid) });

  const detailsTableHtml = detailRows
    .map(
      (r) => `
      <tr>
        <td style="padding:8px 0;font-size:14px;color:#64748b;font-weight:600;white-space:nowrap;vertical-align:top;width:130px;">
          ${r.label}
        </td>
        <td style="padding:8px 0 8px 12px;font-size:14px;color:#1e293b;vertical-align:top;">
          ${r.value}
        </td>
      </tr>`,
    )
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${escapeHtml(subject)}</title>
  <style>:root { color-scheme: light only; }</style>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color-scheme:light;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}&nbsp;&zwnj;&nbsp;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;min-width:100%;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="max-width:560px;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:#111118;padding:20px 32px;text-align:left;color-scheme:light;">
              <img src="${LOGO_DATA_URI}"
                   alt="PlayOn"
                   height="48"
                   style="display:block;border:0;outline:none;text-decoration:none;height:48px;width:auto;" />
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:#ffffff;padding:32px 32px 24px 32px;color-scheme:light;">
              <h1 style="margin:0 0 8px 0;font-size:22px;font-weight:700;color:#111118;line-height:1.3;">
                You're registered!
              </h1>
              <p style="margin:0 0 24px 0;font-size:15px;color:#64748b;">
                Hi ${escapeHtml(playerName)}, your spot is confirmed.
              </p>

              <!-- Event details -->
              <table role="presentation" cellpadding="0" cellspacing="0"
                     style="width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:4px 16px;margin-bottom:28px;">
                <tbody>
                  ${detailsTableHtml}
                </tbody>
              </table>

              <!-- QR code section -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;text-align:center;">
                <tr>
                  <td style="padding-bottom:12px;">
                    <p style="margin:0 0 16px 0;font-size:15px;font-weight:600;color:#111118;">
                      Your Check-In QR Code
                    </p>
                    <img src="${qrDataUri}"
                         alt="Check-in QR code"
                         width="200"
                         height="200"
                         style="display:block;margin:0 auto;border-radius:8px;border:1px solid #e2e8f0;" />
                    <p style="margin:14px 0 0 0;font-size:13px;color:#64748b;">
                      Show this at the door to check in
                    </p>
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0 0;">
                <tr>
                  <td style="border-radius:6px;background:#921236;color-scheme:light;">
                    <a href="${APP_URL}/dashboard"
                       style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;
                              color:#ffffff;text-decoration:none;border-radius:6px;
                              font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
                      View My Registration
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;color-scheme:light;">
              <p style="margin:0 0 6px 0;font-size:12px;color:#64748b;line-height:1.5;">
                You're receiving this because you have an account with
                <a href="${APP_URL}" style="color:#921236;text-decoration:none;">PlayOn</a>.
                If you have questions, reply to this email or visit
                <a href="${APP_URL}" style="color:#921236;text-decoration:none;">${APP_URL.replace(/^https?:\/\//, "")}</a>.
              </p>
              <p style="margin:0;font-size:11px;color:#94a3b8;">
                &copy; ${new Date().getFullYear()} PlayOn. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const divider = "─".repeat(48);
  const detailLines = detailRows.map((r) => `${r.label}: ${r.value}`).join("\n");
  const text = [
    "PlayOn",
    divider,
    `You're registered — ${eventName}`,
    divider,
    `Hi ${playerName}, your spot is confirmed.`,
    "",
    detailLines,
    divider,
    "Your check-in QR code is embedded in this email.",
    "Show this at the door to check in.",
    divider,
    `View registration: ${APP_URL}/dashboard`,
    divider,
    `© ${new Date().getFullYear()} PlayOn  |  ${APP_URL}`,
  ]
    .join("\n")
    .trim();

  return { html, text, subject };
}

/**
 * Map a NotificationType to a sensible default heading and optional CTA for
 * the branded template. Call sites can override heading/CTA by passing their
 * own payload — these are just safe fallbacks.
 */
export function defaultEmailPayload(
  type: string,
  subject: string,
  bodyText: string,
): EmailTemplatePayload {
  const ctaUrl = APP_URL;

  const ctaMap: Record<string, { label: string; url: string }> = {
    upcoming_session: { label: "View Schedule", url: `${ctaUrl}/schedule` },
    payment_due: { label: "Pay Now", url: `${ctaUrl}/dashboard` },
    balance_due: { label: "Pay Now", url: `${ctaUrl}/dashboard` },
    payment_receipt: { label: "View Receipt", url: `${ctaUrl}/dashboard` },
    payment_received: { label: "View Receipt", url: `${ctaUrl}/dashboard` },
    payment_failed: { label: "Update Payment", url: `${ctaUrl}/dashboard` },
    refund_issued: { label: "View Account", url: `${ctaUrl}/dashboard` },
    registration_confirmed: { label: "View Registration", url: `${ctaUrl}/dashboard` },
    registration_cancelled: { label: "View Account", url: `${ctaUrl}/dashboard` },
    cancellation_rainout: { label: "View Schedule", url: `${ctaUrl}/schedule` },
    schedule_change: { label: "View Schedule", url: `${ctaUrl}/schedule` },
    waitlist_movement: { label: "View Registration", url: `${ctaUrl}/dashboard` },
    league_start: { label: "View Schedule", url: `${ctaUrl}/schedule` },
    dropin_reminder: { label: "View Drop-in", url: `${ctaUrl}/drop-ins` },
    fa_match_proposal: { label: "View Match", url: `${ctaUrl}/free-agents` },
    fa_match_response: { label: "View Match", url: `${ctaUrl}/free-agents` },
  };

  const headingMap: Record<string, string> = {
    upcoming_session: "Game Reminder",
    payment_due: "Payment Due",
    balance_due: "Balance Due",
    payment_receipt: "Payment Received",
    payment_received: "Payment Received",
    payment_failed: "Payment Failed",
    refund_issued: "Refund Issued",
    registration_confirmed: "Registration Confirmed",
    registration_cancelled: "Registration Cancelled",
    cancellation_rainout: "Game Cancelled",
    schedule_change: "Schedule Update",
    waitlist_movement: "Waitlist Update",
    league_start: "League Starting Soon",
    dropin_reminder: "Drop-in Session Reminder",
    waiver_required: "Waiver Required",
    admin_override: "Account Update",
    role_changed: "Role Updated",
    general: "Notification",
    announcement: "Announcement",
    results_standings: "Results & Standings",
    sub_ref_alert: "Sub-Ref Alert",
    season_recap: "Season Recap",
    fa_match_proposal: "Free Agent Match Proposal",
    fa_match_response: "Free Agent Match Update",
  };

  return {
    subject,
    preheader: bodyText.slice(0, 90),
    heading: headingMap[type] ?? subject,
    bodyParagraphs: [bodyText],
    cta: ctaMap[type],
  };
}
