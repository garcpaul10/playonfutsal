/**
 * smoke-test-email-templates.mjs
 *
 * Verifies the real emailTemplate.ts (not an inline copy) by:
 *   1. Compiling emailTemplate.ts via esbuild into a temp file.
 *   2. Importing renderEmail and defaultEmailPayload from it.
 *   3. For every opt-in NotificationType, asserting:
 *        a. defaultEmailPayload() produces a valid payload.
 *        b. renderEmail() returns non-empty html and text strings.
 *        c. The HTML contains the PlayOn brand colour (#921236).
 *        d. The HTML contains the notification-type heading.
 *   4. Verifying registrationConfirmationEmail() renders without error
 *      and also contains the crimson brand colour.
 *
 * Does NOT send actual emails — purely a render smoke test.
 *
 * Usage:
 *   node artifacts/api-server/src/scripts/smoke-test-email-templates.mjs
 */

import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const BRAND_COLOUR = "#921236";

const ALL_TYPES = [
  "registration_confirmed", "registration_cancelled",
  "payment_received", "payment_failed", "refund_issued",
  "dropin_reminder", "league_start", "waiver_required",
  "admin_override", "role_changed", "general",
  "waitlist_movement", "cancellation_rainout", "payment_receipt",
  "schedule_change", "upcoming_session", "payment_due", "balance_due",
  "announcement", "results_standings", "sub_ref_alert",
  "season_recap", "fa_match_proposal", "fa_match_response",
];

async function main() {
  const tmpDir = await mkdtemp(join(tmpdir(), "playon-email-smoke-"));
  const outFile = join(tmpDir, "emailTemplate.mjs");

  try {
    // Compile the real emailTemplate.ts to a temp ESM file
    await build({
      entryPoints: [resolve(__dirname, "../services/emailTemplate.ts")],
      bundle: true,
      format: "esm",
      platform: "node",
      outfile: outFile,
      logLevel: "silent",
    });

    // Dynamically import compiled module
    const { renderEmail, defaultEmailPayload, registrationConfirmationEmail } =
      await import(outFile);

    let passed = 0;
    let failed = 0;

    // ── Test every notification type via defaultEmailPayload + renderEmail ──
    for (const type of ALL_TYPES) {
      try {
        const subject = `Test: ${type}`;
        const bodyText = `This is a test notification body for type "${type}".`;
        const payload = defaultEmailPayload(type, subject, bodyText);

        if (!payload || !payload.heading) throw new Error("defaultEmailPayload returned invalid payload");

        const { html, text } = renderEmail(payload);

        if (!html || !text) throw new Error("renderEmail returned empty output");
        if (!html.includes(BRAND_COLOUR))
          throw new Error(`Brand colour ${BRAND_COLOUR} missing from HTML`);
        const escapedHeading = payload.heading
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
        if (!html.includes(escapedHeading))
          throw new Error(`Heading "${payload.heading}" missing from HTML`);

        console.log(`  ✓ ${type}`);
        passed++;
      } catch (err) {
        console.error(`  ✗ ${type}: ${err.message}`);
        failed++;
      }
    }

    // ── Test registrationConfirmationEmail ────────────────────────────────
    try {
      const result = registrationConfirmationEmail({
        playerName: "Alex Smith",
        eventName: "Spring League 2026",
        eventType: "League",
        dates: "June 9 – August 18, 2026",
        times: "7:30 PM",
        venue: "PlayOn Futsal Centre",
        poolOrDivision: "Division A",
        amountPaid: "$120.00",
        qrDataUri: "data:image/png;base64,iVBORw0KGgo=",
      });

      if (!result.html || !result.text || !result.subject)
        throw new Error("registrationConfirmationEmail returned incomplete output");
      if (!result.html.includes(BRAND_COLOUR))
        throw new Error(`Brand colour ${BRAND_COLOUR} missing from registrationConfirmationEmail HTML`);

      console.log(`  ✓ registrationConfirmationEmail`);
      passed++;
    } catch (err) {
      console.error(`  ✗ registrationConfirmationEmail: ${err.message}`);
      failed++;
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
