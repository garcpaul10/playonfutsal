/**
 * Dev-only email preview route.
 * Disabled in production (NODE_ENV=production).
 *
 * GET /dev/email-preview/:type
 *   Returns the rendered HTML for the given email type so it can be inspected
 *   in a browser during development and QA.
 *
 * Available types:
 *   staff_invite | upcoming_session | payment_due | balance_due |
 *   cancellation | reschedule | payment_receipt | registration_confirmed |
 *   waitlist_movement | refund_issued
 */

import { Router, type IRouter } from "express";
import { renderEmail, type EmailTemplatePayload } from "../services/emailTemplate";
import { emailConfigured, sendEmail } from "../services/email";

const router: IRouter = Router();

const APP_URL = (process.env.PUBLIC_APP_URL ?? "https://playon.replit.app").replace(/\/$/, "");

const SAMPLE_PAYLOADS: Record<string, EmailTemplatePayload> = {
  staff_invite: {
    subject: "You've been invited to join PlayOn as a Referee",
    preheader: "You have been invited to join PlayOn as a Referee. Accept your invite to get started.",
    heading: "You're invited to join PlayOn",
    bodyParagraphs: [
      "Hi there,",
      "You've been invited to join PlayOn Futsal as a Referee. Click the button below to complete your registration and set up your account.",
      "This invitation link expires in 7 days. If you didn't expect this email you can safely ignore it.",
    ],
    cta: { label: "Accept Invite", url: `${APP_URL}/sign-up?invite=sample-token` },
  },
  upcoming_session: {
    subject: "You have a game tomorrow",
    preheader: "Reminder: you have a league game scheduled for Tue, Jun 3 at 7:30 PM.",
    heading: "Game Reminder",
    bodyParagraphs: [
      "Reminder: you have a league game scheduled for Tue, Jun 3 at 7:30 PM. See you on the court!",
    ],
    cta: { label: "View Schedule", url: `${APP_URL}/schedule` },
  },
  payment_due: {
    subject: "Payment due for your registration",
    preheader: "Your registration for Spring League 2026 has an outstanding balance.",
    heading: "Payment Due",
    bodyParagraphs: [
      "Your registration for Spring League 2026 has an outstanding balance.",
      "Please pay before your first session to secure your spot.",
    ],
    cta: { label: "Pay Now", url: `${APP_URL}/dashboard` },
  },
  balance_due: {
    subject: "Balance due before your first game",
    preheader: "You have an unpaid balance and a game is coming up within 7 days.",
    heading: "Balance Due",
    bodyParagraphs: [
      "You have an unpaid balance for Spring League 2026 and a game is coming up within 7 days.",
      "Please pay now to avoid losing your spot.",
    ],
    cta: { label: "Pay Now", url: `${APP_URL}/dashboard` },
  },
  cancellation: {
    subject: "Game cancelled",
    preheader: "Your league game on Tue, Jun 3 has been cancelled.",
    heading: "Game Cancelled",
    bodyParagraphs: [
      "Your league game on Tue, Jun 3 has been cancelled due to a facility issue.",
      "A refund or account credit has been applied per our cancellation policy.",
    ],
    cta: { label: "View Schedule", url: `${APP_URL}/schedule` },
  },
  reschedule: {
    subject: "Game rescheduled",
    preheader: "Your league game has been rescheduled to Thu, Jun 5 at 7:30 PM.",
    heading: "Schedule Update",
    bodyParagraphs: [
      "Your league game has been rescheduled to Thu, Jun 5, 7:30 PM.",
      "Please update your calendar and check the schedule for the latest details.",
    ],
    cta: { label: "View Schedule", url: `${APP_URL}/schedule` },
  },
  payment_receipt: {
    subject: "Payment received — Spring League 2026",
    preheader: "Your payment of $120.00 for Spring League 2026 has been received.",
    heading: "Payment Received",
    bodyParagraphs: [
      "Your payment of $120.00 for Spring League 2026 has been received. Thank you!",
      "You're all set for the upcoming season. We'll send you a game reminder 24 hours before each match.",
    ],
    cta: { label: "View Receipt", url: `${APP_URL}/dashboard` },
  },
  registration_confirmed: {
    subject: "Registration confirmed — Spring League 2026",
    preheader: "Your registration for Spring League 2026 has been confirmed.",
    heading: "Registration Confirmed",
    bodyParagraphs: [
      "Your registration for Spring League 2026 has been confirmed.",
      "The season starts on June 9, 2026. You'll receive a game reminder before each match.",
    ],
    cta: { label: "View Registration", url: `${APP_URL}/dashboard` },
  },
  waitlist_movement: {
    subject: "You've been moved off the waitlist",
    preheader: "Great news — a spot opened up and you're now registered for Spring League 2026.",
    heading: "Waitlist Update",
    bodyParagraphs: [
      "Great news — a spot opened up and you're now registered for Spring League 2026.",
      "Please complete your payment within 48 hours to secure your spot.",
    ],
    cta: { label: "View Registration", url: `${APP_URL}/dashboard` },
  },
  refund_issued: {
    subject: "Refund issued — Spring League 2026",
    preheader: "A refund of $60.00 has been issued to your original payment method.",
    heading: "Refund Issued",
    bodyParagraphs: [
      "A refund of $60.00 has been issued to your original payment method.",
      "Please allow 5–10 business days for the funds to appear in your account.",
    ],
    cta: { label: "View Account", url: `${APP_URL}/dashboard` },
  },
};

const TYPE_LIST = Object.keys(SAMPLE_PAYLOADS).join(", ");

router.get("/dev/email-preview/:type", (req, res): void => {
  if (process.env.NODE_ENV === "production") {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const { type } = req.params;
  const payload = SAMPLE_PAYLOADS[type];

  if (!payload) {
    res.status(404).send(
      `<pre style="font-family:monospace;padding:16px;">Unknown email type: "${type}".\n\nAvailable types:\n  ${TYPE_LIST.split(", ").join("\n  ")}</pre>`,
    );
    return;
  }

  const { html } = renderEmail(payload);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

/**
 * GET /dev/email-status
 * Returns runtime email configuration status (dev only).
 */
router.get("/dev/email-status", (_req, res): void => {
  if (process.env.NODE_ENV === "production") {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({
    configured: emailConfigured,
    from: process.env.EMAIL_FROM ?? "(not set)",
    resendKeyPresent: !!process.env.RESEND_API_KEY,
  });
});

/**
 * POST /dev/email-send-test
 * Sends a real branded test email to the given address (dev only).
 * Body: { to: string }
 */
router.post("/dev/email-send-test", async (req, res): Promise<void> => {
  if (process.env.NODE_ENV === "production") {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const { to } = req.body as { to?: string };
  if (!to) {
    res.status(400).json({ error: "to is required" });
    return;
  }

  const payload: EmailTemplatePayload = SAMPLE_PAYLOADS.registration_confirmed;
  const { html, text } = renderEmail(payload);
  const result = await sendEmail({ to, subject: payload.subject, html, text });
  res.json({ ...result, to, from: process.env.EMAIL_FROM ?? "(not set)" });
});

/** Index page listing all available preview types */
router.get("/dev/email-preview", (_req, res): void => {
  if (process.env.NODE_ENV === "production") {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const links = Object.keys(SAMPLE_PAYLOADS)
    .map((t) => `<li><a href="/api/dev/email-preview/${t}" style="color:#921236;">${t}</a></li>`)
    .join("\n");

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Email Preview — PlayOn Dev</title></head>
<body style="font-family:system-ui,sans-serif;padding:32px;max-width:600px;">
  <h1 style="color:#0f172a;">PlayOn Email Preview</h1>
  <p style="color:#64748b;">Click a type to render the branded HTML email template.</p>
  <ul style="line-height:2;">${links}</ul>
</body>
</html>`);
});

export default router;
