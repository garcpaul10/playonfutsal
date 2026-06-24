/**
 * Spot Expiry Scheduler
 *
 * Runs every 60 seconds. Finds drop-in spots in `payment_pending` status
 * whose `expires_at` has passed, marks them as `expired`/`cancelled`,
 * promotes the next waitlisted player (if any), and notifies the player
 * that their reservation lapsed.
 */

import { db, spotsTable, dropinsTable, usersTable } from "@workspace/db";
import { eq, and, lt, asc, isNotNull, sql } from "drizzle-orm";
import { sendNotificationWithPreferences } from "./notifications";
import { logger } from "../lib/logger";
import { reconcileSpotFromStripe } from "./reconcileSpot";

const POLL_INTERVAL_MS = 60 * 1000;

async function promoteWaitlistForPool(poolId: number, dropinId: number): Promise<void> {
  const [nextWaiting] = await db
    .select()
    .from(spotsTable)
    .where(
      and(
        eq(spotsTable.poolId, poolId),
        eq(spotsTable.entityType, "dropin"),
        eq(spotsTable.entityId, dropinId),
        eq(spotsTable.waitlisted, true),
        eq(spotsTable.status, "reserved"),
      )
    )
    .orderBy(asc(spotsTable.waitlistPosition))
    .limit(1);

  if (!nextWaiting) return;

  const [promoted] = await db
    .update(spotsTable)
    .set({
      waitlisted: false,
      waitlistPosition: null,
      promotedFromWaitlist: true,
      confirmedAt: new Date(),
      updatedAt: new Date(),
    } as any)
    .where(eq(spotsTable.id, nextWaiting.id))
    .returning();

  await db.execute(
    sql`UPDATE spots
        SET waitlist_position = waitlist_position - 1
        WHERE pool_id = ${poolId}
          AND entity_type = 'dropin'
          AND entity_id = ${dropinId}
          AND waitlisted = true
          AND status = 'reserved'
          AND waitlist_position > ${nextWaiting.waitlistPosition ?? 1}`
  );

  if (promoted?.userId) {
    const [dropin] = await db
      .select({ name: dropinsTable.name })
      .from(dropinsTable)
      .where(eq(dropinsTable.id, dropinId));

    if (dropin) {
      await sendNotificationWithPreferences({
        userId: promoted.userId,
        type: "waitlist_movement",
        subject: `You're off the waitlist for ${dropin.name}!`,
        body: `A spot opened up and you've been promoted from the waitlist for ${dropin.name}. Your spot is now confirmed.`,
      } as any).catch(() => {});
    }
  }
}

async function expireStaleSpots(): Promise<void> {
  const now = new Date();

  const stale = await db
    .select()
    .from(spotsTable)
    .where(
      and(
        eq(spotsTable.paymentStatus, "payment_pending"),
        eq(spotsTable.status, "reserved"),
        isNotNull((spotsTable as any).expiresAt),
        lt((spotsTable as any).expiresAt, now),
      )
    );

  if (stale.length === 0) return;

  logger.info(`[spot-expiry] Expiring ${stale.length} stale payment_pending spot(s)`);

  for (const spot of stale) {
    try {
      // Before cancelling, check whether Stripe already received payment.
      // Webhook delivery can lag; we must not cancel a paid spot.
      const reconciled = await reconcileSpotFromStripe(spot);
      if (reconciled) {
        logger.info(`[spot-expiry] Spot ${spot.id} was already paid — confirmed via Stripe reconciliation, skipping expiry`);
        continue;
      }

      const updated = await db
        .update(spotsTable)
        .set({
          paymentStatus: "expired",
          status: "cancelled",
          cancelledAt: new Date(),
          cancellationReason: "payment_expired",
          updatedAt: new Date(),
        } as any)
        .where(
          and(
            eq(spotsTable.id, spot.id),
            eq(spotsTable.paymentStatus, "payment_pending"),
            eq(spotsTable.status, "reserved"),
          )
        )
        .returning({ id: spotsTable.id });

      if (updated.length === 0) {
        logger.info(`[spot-expiry] Spot ${spot.id} already transitioned — skipping`);
        continue;
      }

      logger.info(`[spot-expiry] Expired spot ${spot.id} (pool #${spot.poolId}, dropin #${spot.entityId})`);

      if (spot.poolId && spot.entityId) {
        try {
          await promoteWaitlistForPool(spot.poolId, spot.entityId);
        } catch (promoteErr: any) {
          logger.warn({ err: promoteErr?.message, spotId: spot.id }, "[spot-expiry] Waitlist promotion failed");
        }
      }

      if (spot.userId) {
        try {
          const [dropin] = spot.entityId
            ? await db.select({ name: dropinsTable.name }).from(dropinsTable).where(eq(dropinsTable.id, spot.entityId))
            : [];
          const dropinName = dropin?.name ?? "drop-in session";

          await sendNotificationWithPreferences({
            userId: spot.userId,
            type: "registration_update",
            subject: `Your drop-in spot for ${dropinName} has expired`,
            body: `Your 15-minute payment window for ${dropinName} has expired and your spot has been released. You can register again from the event page.`,
          } as any).catch(() => {});
        } catch (_) {}
      }
    } catch (err: any) {
      logger.warn({ err: err?.message, spotId: spot.id }, "[spot-expiry] Failed to expire spot");
    }
  }
}

export function startSpotExpiryScheduler(): void {
  setTimeout(() => {
    expireStaleSpots().catch((err) =>
      logger.warn({ err: err?.message }, "[spot-expiry] Initial run failed"),
    );
    setInterval(() => {
      expireStaleSpots().catch((err) =>
        logger.warn({ err: err?.message }, "[spot-expiry] Scheduled run failed"),
      );
    }, POLL_INTERVAL_MS);
  }, 45 * 1000);

  logger.info("[spot-expiry] Spot expiry scheduler started — runs every 60 seconds");
}
