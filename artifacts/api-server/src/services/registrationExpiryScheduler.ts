/**
 * Registration Expiry Scheduler
 *
 * Runs every 60 seconds. Finds registrations in `pending_payment` status
 * whose `expires_at` has passed, marks them as `expired`, releases capacity,
 * promotes the next waitlisted player (if any), and restores any reserved
 * account credits so the player is not charged twice.
 */

import { db, registrationsTable, usersTable, accountCreditsTable } from "@workspace/db";
import { eq, and, lt, sql, asc } from "drizzle-orm";
import { sendNotificationWithPreferences } from "./notifications";
import { logger } from "../lib/logger";

const POLL_INTERVAL_MS = 60 * 1000;

async function expireStaleRegistrations(): Promise<void> {
  const now = new Date();

  // Find all pending_payment registrations past their expiry window
  const stale = await db
    .select()
    .from(registrationsTable)
    .where(
      and(
        eq(registrationsTable.status, "pending_payment"),
        lt(registrationsTable.expiresAt as any, now),
      ),
    );

  if (stale.length === 0) return;

  logger.info(`[reg-expiry] Expiring ${stale.length} stale pending_payment registration(s)`);

  for (const reg of stale) {
    try {
      // Atomically transition pending_payment → expired (guards against concurrent webhook)
      const updated = await db
        .update(registrationsTable)
        .set({ status: "expired", updatedAt: new Date() } as any)
        .where(
          and(
            eq(registrationsTable.id, reg.id),
            eq(registrationsTable.status, "pending_payment"),
          ),
        )
        .returning({ id: registrationsTable.id });

      if (updated.length === 0) {
        // Already confirmed (webhook beat us) or already expired — skip
        logger.info(`[reg-expiry] Registration ${reg.id} already transitioned — skipping`);
        continue;
      }

      logger.info(`[reg-expiry] Expired registration ${reg.id} (${reg.programType} #${reg.programId})`);

      // Restore any reserved account credits that were pre-applied during checkout
      // Credits are stored as JSON in the payments table metadata; restore all credits
      // linked to a pending payment for this registration.
      try {
        const { paymentsTable } = await import("@workspace/db");
        const { restoreReservedCredits } = await import("../lib/creditUtils");
        const pendingPayments = await db
          .select({ id: paymentsTable.id, metadata: paymentsTable.metadata, status: paymentsTable.status })
          .from(paymentsTable)
          .where(
            and(
              eq(paymentsTable.registrationId, reg.id),
              eq(paymentsTable.status, "pending"),
            ),
          );

        for (const payment of pendingPayments) {
          const meta = payment.metadata
            ? (() => { try { return JSON.parse(payment.metadata as string); } catch { return {}; } })()
            : {};

          if (meta.reservedCreditIds && !meta.creditsRestored) {
            // Mark credits as restored before actually restoring (idempotency guard)
            const flagged = await db
              .update(paymentsTable)
              .set({ metadata: JSON.stringify({ ...meta, creditsRestored: true }), status: "failed", updatedAt: new Date() } as any)
              .where(
                and(
                  eq(paymentsTable.id, payment.id),
                  sql`(metadata::jsonb->>'creditsRestored')::boolean IS NOT TRUE`,
                  sql`${paymentsTable.status} != 'paid'`,
                ),
              )
              .returning({ id: paymentsTable.id });

            if (flagged.length > 0) {
              await restoreReservedCredits(JSON.stringify(meta.reservedCreditIds));
              logger.info(`[reg-expiry] Restored credits for payment ${payment.id} on expired registration ${reg.id}`);
            }
          } else if (!meta.reservedCreditIds) {
            // No credits to restore — just mark payment as failed
            await db
              .update(paymentsTable)
              .set({ status: "failed", updatedAt: new Date() } as any)
              .where(
                and(
                  eq(paymentsTable.id, payment.id),
                  sql`${paymentsTable.status} != 'paid'`,
                ),
              );
          }
        }
      } catch (creditErr: any) {
        logger.warn({ err: creditErr?.message, regId: reg.id }, "[reg-expiry] Credit restore failed");
      }

      // Promote the next waitlisted registration (same logic as cancellation handler)
      const [next] = await db
        .select()
        .from(registrationsTable)
        .where(
          and(
            eq(registrationsTable.programType, reg.programType),
            eq(registrationsTable.programId, reg.programId),
            eq(registrationsTable.status, "waitlisted"),
          ),
        )
        .orderBy(asc(registrationsTable.waitlistPosition as any), asc(registrationsTable.createdAt))
        .limit(1);

      if (next) {
        await db
          .update(registrationsTable)
          .set({ status: "confirmed", waitlistPosition: null, updatedAt: new Date() } as any)
          .where(eq(registrationsTable.id, next.id));

        // Renumber remaining waitlisted registrations
        const remaining = await db
          .select()
          .from(registrationsTable)
          .where(
            and(
              eq(registrationsTable.programType, reg.programType),
              eq(registrationsTable.programId, reg.programId),
              eq(registrationsTable.status, "waitlisted"),
            ),
          )
          .orderBy(asc(registrationsTable.waitlistPosition as any), asc(registrationsTable.createdAt));

        for (let i = 0; i < remaining.length; i++) {
          await db
            .update(registrationsTable)
            .set({ waitlistPosition: i + 1, updatedAt: new Date() } as any)
            .where(eq(registrationsTable.id, remaining[i].id));
        }

        // Notify the promoted player
        const [promotedUser] = await db
          .select()
          .from(usersTable)
          .where(eq(usersTable.clerkId, next.userId));

        if (promotedUser) {
          await sendNotificationWithPreferences({
            userId: promotedUser.id,
            type: "waitlist_movement",
            subject: `You're off the waitlist for ${next.programName}!`,
            body: `A spot opened up and you've been confirmed for ${next.programName}. Check your dashboard for details.`,
          } as any).catch(() => {});
        }
      }

      // Notify the player whose registration expired
      try {
        const [expiredUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, reg.userId));
        if (expiredUser) {
          await sendNotificationWithPreferences({
            userId: expiredUser.id,
            type: "registration_update",
            subject: `Your registration for ${reg.programName} has expired`,
            body: `Your 10-minute payment window for ${reg.programName} has expired and your spot has been released. You can register again from the program page.`,
          } as any).catch(() => {});
        }
      } catch (_) {}
    } catch (err: any) {
      logger.warn({ err: err?.message, regId: reg.id }, "[reg-expiry] Failed to expire registration");
    }
  }
}

export function startRegistrationExpiryScheduler(): void {
  // First run after 30 seconds to let the server stabilize
  setTimeout(() => {
    expireStaleRegistrations().catch((err) =>
      logger.warn({ err: err?.message }, "[reg-expiry] Initial run failed"),
    );
    setInterval(() => {
      expireStaleRegistrations().catch((err) =>
        logger.warn({ err: err?.message }, "[reg-expiry] Scheduled run failed"),
      );
    }, POLL_INTERVAL_MS);
  }, 30 * 1000);

  logger.info("[reg-expiry] Registration expiry scheduler started — runs every 60 seconds");
}
