/**
 * email.ts — Transactional email delivery via Resend.
 *
 * Requires env vars:
 *   RESEND_API_KEY   — Resend API key (https://resend.com)
 *   EMAIL_FROM       — Sender address (e.g. "PlayOn <no-reply@playon.app>")
 *
 * When credentials are absent the send is skipped and `sent: false` is returned,
 * allowing the caller to record a failed notification status.
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM ?? "PlayOn <no-reply@playon.app>";

export const emailConfigured = !!RESEND_API_KEY;

/**
 * Domain verification check — logged at startup to surface misconfiguration early.
 *
 * Resend requires the sender domain to be verified in the Resend dashboard before
 * emails can be delivered. If EMAIL_FROM is set to a domain that has not been verified
 * (e.g. info@playonfutsal.com), all sends will fail silently from Resend's perspective.
 *
 * To fix:
 *   1. Log in to https://resend.com/domains and verify the domain used in EMAIL_FROM.
 *   2. Add the DNS records Resend provides (SPF, DKIM, DMARC) to your DNS provider.
 *   3. Once verified, emails from that domain will be accepted.
 *
 * Current EMAIL_FROM domain: extracted and logged below at module load time.
 */
(function checkEmailDomain() {
  const from = EMAIL_FROM;
  const match = from.match(/@([\w.-]+)/);
  const domain = match ? match[1] : "(unknown)";
  if (!RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY is not set — email delivery is disabled.");
  } else {
    console.info(`[email] Sender domain: ${domain} — ensure this domain is verified in Resend (https://resend.com/domains)`);
  }
})();

export interface EmailResult {
  sent: boolean;
  error?: string;
}

/**
 * Send a single transactional email via Resend.
 */
export async function sendEmail(params: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<EmailResult> {
  if (!emailConfigured) {
    console.warn("[email] RESEND_API_KEY not configured — skipping email to", params.to);
    return { sent: false, error: "Email not configured" };
  }

  try {
    const body: Record<string, unknown> = {
      from: EMAIL_FROM,
      to: [params.to],
      subject: params.subject,
      text: params.text,
    };
    if (params.html) body.html = params.html;

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("[email] Resend API error:", err);
      return { sent: false, error: "Resend API error" };
    }

    return { sent: true };
  } catch (e) {
    console.error("[email] Network error:", e);
    return { sent: false, error: "Network error" };
  }
}
