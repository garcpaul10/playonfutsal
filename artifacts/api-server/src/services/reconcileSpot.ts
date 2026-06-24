/**
 * reconcileSpot.ts
 *
 * Shared utility: check whether a Stripe checkout session for a
 * payment_pending drop-in spot has already been paid and, if so,
 * confirm the spot immediately (without waiting for the webhook).
 */

import { db, spotsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getUncachableStripeClient } from "../lib/stripe";
import { logger } from "../lib/logger";

/**
 * Reads the Stripe checkout session ID from `spot.notes` (stored as `cs:<id>`),
 * retrieves the session from Stripe, and if `payment_status === 'paid'` confirms
 * the spot in the DB (paid_inapp, clears expiresAt, sets confirmedAt).
 *
 * Returns `true` if the spot was reconciled (already paid), `false` otherwise.
 * Never throws — logs errors and returns false so callers can continue safely.
 */
export async function reconcileSpotFromStripe(spot: {
  id: number;
  notes?: string | null;
  paymentStatus?: string | null;
}): Promise<boolean> {
  if (!spot.notes) return false;

  const match = spot.notes.match(/cs:([^\s,]+)/);
  if (!match) return false;
  const sessionId = match[1];

  try {
    const stripe = await getUncachableStripeClient();
    const session = await (stripe.checkout.sessions.retrieve as any)(sessionId);

    if (session?.payment_status !== "paid") return false;

    await db
      .update(spotsTable)
      .set({
        paymentStatus: "paid_inapp",
        confirmedAt: new Date(),
        expiresAt: null,
        updatedAt: new Date(),
      } as any)
      .where(eq(spotsTable.id, spot.id));

    logger.info(
      { spotId: spot.id, sessionId },
      "[reconcile-spot] Spot reconciled from Stripe — marked paid_inapp",
    );
    return true;
  } catch (err: any) {
    logger.warn(
      { err: err?.message, spotId: spot.id, sessionId },
      "[reconcile-spot] Failed to reconcile spot from Stripe",
    );
    return false;
  }
}
