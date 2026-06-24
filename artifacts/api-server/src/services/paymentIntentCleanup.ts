/**
 * PaymentIntent Cleanup Scheduler — legacy cleanup for abandoned PaymentIntents.
 *
 * New payments are created via Checkout Sessions (cs_xxx), which auto-expire after
 * 24 hours — no manual cleanup required for them.
 *
 * This scheduler exists only to clean up any legacy pending PaymentIntents (pi_xxx)
 * from before the Checkout Sessions migration. Once all legacy records have aged out,
 * this service can be safely retired.
 *
 * Runs every 30 minutes. Only targets records where:
 *  - provider = 'stripe'
 *  - status = 'pending'
 *  - created_at < NOW() - 1 hour   (give users reasonable time to complete payment)
 *  - providerPaymentId starts with 'pi_'  (skips new checkout session IDs cs_xxx)
 */

import { db, paymentsTable } from "@workspace/db";
import { eq, and, lt, sql } from "drizzle-orm";
import { getUncachableStripeClient } from "../lib/stripe";
import { logger } from "../lib/logger";

const POLL_INTERVAL_MS = 30 * 60 * 1000;
const STALE_THRESHOLD_HOURS = 1;

async function cancelStalePaymentIntents(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_HOURS * 60 * 60 * 1000);

  const staleRows = await db.select({
    id: paymentsTable.id,
    providerPaymentId: paymentsTable.providerPaymentId,
  })
    .from(paymentsTable)
    .where(and(
      eq(paymentsTable.provider, "stripe"),
      eq(paymentsTable.status, "pending"),
      lt(paymentsTable.createdAt, cutoff),
      // Only target legacy PaymentIntent IDs — Checkout Session IDs (cs_) auto-expire
      sql`${paymentsTable.providerPaymentId} LIKE 'pi_%'`,
    ))
    .limit(50);

  if (staleRows.length === 0) return;

  logger.info(`[pi-cleanup] Found ${staleRows.length} stale legacy PaymentIntent(s) to cancel`);

  const stripe = await getUncachableStripeClient();

  for (const row of staleRows) {
    if (!row.providerPaymentId) continue;
    try {
      const pi = await stripe.paymentIntents.retrieve(row.providerPaymentId);

      if (pi.status === "succeeded" || pi.status === "canceled") {
        if (pi.status === "succeeded") {
          await db.update(paymentsTable)
            .set({ status: "paid", updatedAt: new Date() } as any)
            .where(and(
              eq(paymentsTable.id, row.id),
              sql`${paymentsTable.status} != 'paid'`,
            ));
        }
        continue;
      }

      await stripe.paymentIntents.cancel(row.providerPaymentId);
      logger.info(`[pi-cleanup] Cancelled stale PaymentIntent ${row.providerPaymentId}`);
    } catch (err: any) {
      logger.warn({ piId: row.providerPaymentId, err: err?.message }, "[pi-cleanup] Failed to cancel PI");
    }
  }
}

export function startPaymentIntentCleanupScheduler(): void {
  setTimeout(() => {
    cancelStalePaymentIntents().catch((err) =>
      logger.warn({ err: err?.message }, "[pi-cleanup] Initial run failed"),
    );
    setInterval(() => {
      cancelStalePaymentIntents().catch((err) =>
        logger.warn({ err: err?.message }, "[pi-cleanup] Scheduled run failed"),
      );
    }, POLL_INTERVAL_MS);
  }, 5 * 60 * 1000);

  logger.info("[pi-cleanup] Legacy PaymentIntent cleanup scheduler started — runs every 30 minutes");
}
