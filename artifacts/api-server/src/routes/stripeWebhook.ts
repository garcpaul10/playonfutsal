import { Router, type IRouter } from "express";
import {
  db, paymentsTable, registrationsTable, discountCodesTable,
  usersTable, stripeEventsTable, installmentSchedulesTable, installmentPaymentsTable,
  leagueRegistrationsTable, tournamentRegistrationsTable,
  userMembershipsTable, membershipPlansTable, auditLogTable,
  spotsTable, dropinCourtPoolsTable,
  courtsTable, leaguesTable, campsTable, tournamentsTable, dropinsTable,
  campRegistrationsTable,
  staffProfilesTable, venuesTable, payoutsTable,
} from "@workspace/db";
import { handleKotcLifePurchase } from "./kotc";
import { eq, and, sql, or, isNull } from "drizzle-orm";
import { getUncachableStripeClient } from "../lib/stripe";
import { restoreReservedCredits } from "../lib/creditUtils";
import { recordRevenue } from "../services/revenueComputation";
import { sendNotificationWithPreferences, sendMultiChannelNotification, sendRegistrationConfirmationEmail } from "../services/notifications";
import type { Request, Response } from "express";

const router: IRouter = Router();

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Look up the venueId for an event by resolving its courtId → court.venueId.
 * Returns null if the event has no court or the court has no venue.
 */
async function resolveEventVenueId(programType: string, programId: number): Promise<number | null> {
  try {
    let courtId: number | null = null;
    if (programType === "league") {
      const [row] = await db.select({ courtId: leaguesTable.courtId }).from(leaguesTable).where(eq(leaguesTable.id, programId));
      courtId = row?.courtId ?? null;
    } else if (programType === "tournament") {
      const [row] = await db.select({ courtId: tournamentsTable.courtId }).from(tournamentsTable).where(eq(tournamentsTable.id, programId));
      courtId = row?.courtId ?? null;
    } else if (programType === "camp") {
      const [row] = await db.select({ courtId: campsTable.courtId }).from(campsTable).where(eq(campsTable.id, programId));
      courtId = row?.courtId ?? null;
    } else if (programType === "drop_in") {
      const [row] = await db.select({ courtId: dropinsTable.courtId }).from(dropinsTable).where(eq(dropinsTable.id, programId));
      courtId = row?.courtId ?? null;
    }
    if (!courtId) return null;
    const [court] = await db.select({ venueId: courtsTable.venueId }).from(courtsTable).where(eq(courtsTable.id, courtId));
    return court?.venueId ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve the actual player's numeric DB user ID for a registration payment.
 *
 * For drop-in guardian checkouts, `meta.playerUserId` already carries the child's DB user ID.
 * For general registrations (league / camp / tournament), `registrations.userId` is the
 * child's clerkId (guardian registered on behalf of child), so we look that up directly
 * instead of falling back to the payer (dbUser.id).
 *
 * Falls back to payerDbUserId if the registration record cannot be found.
 */
async function resolveRegistrationPlayerUserId(
  meta: Record<string, string>,
  programType: string,
  programId: number,
  registrationId: number | null,
  clerkUserId: string,
  payerDbUserId: number,
): Promise<number> {
  // Drop-in guardian path: child's DB user ID is explicit in Stripe metadata
  if (meta.playerUserId) return Number(meta.playerUserId);

  // General registration path: derive player's clerkId from the registration row
  try {
    let playerClerkId: string | null = null;
    if (registrationId) {
      const [reg] = await db
        .select({ userId: registrationsTable.userId })
        .from(registrationsTable)
        .where(eq(registrationsTable.id, registrationId));
      playerClerkId = reg?.userId ?? null;
    } else {
      const regs = await db
        .select({ userId: registrationsTable.userId })
        .from(registrationsTable)
        .where(
          and(
            eq(registrationsTable.programType, programType),
            eq(registrationsTable.programId, programId),
            eq(registrationsTable.userId, clerkUserId),
          ),
        );
      if (regs.length > 0) playerClerkId = regs[regs.length - 1].userId;
    }

    if (playerClerkId) {
      const [playerUser] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.clerkId, playerClerkId));
      if (playerUser?.id) return playerUser.id;
    }
  } catch {
    // Non-blocking fallback
  }

  return payerDbUserId;
}

/**
 * After reconciliation, check whether the registration/spot actually ended up
 * in a confirmed (non-waitlisted) state in the DB.
 *
 * This prevents sending confirmation emails for waitlisted paid drop-in spots —
 * e.g. when a pool fills up between checkout initiation and webhook delivery.
 *
 * Returns true only when the player has a confirmed, non-waitlisted reservation.
 */
async function isEntityConfirmedInDb(
  programType: string,
  programId: number,
  registrationId: number | null,
  clerkUserId: string,
  poolId: number | null,
  playerDbUserId: number,
): Promise<boolean> {
  try {
    if (programType === "drop_in" && poolId) {
      // For drop-in pools: the player must have a non-waitlisted, reserved spot
      const [spot] = await db
        .select({ waitlisted: spotsTable.waitlisted, status: spotsTable.status })
        .from(spotsTable)
        .where(
          and(
            eq(spotsTable.poolId, poolId),
            eq(spotsTable.userId, playerDbUserId),
            eq(spotsTable.entityType, "dropin"),
            eq(spotsTable.entityId, programId),
          ),
        )
        .limit(1);
      if (!spot || spot.status === "cancelled") return false;
      return !(spot as any).waitlisted;
    }

    // For leagues / camps / tournaments / flat drop-ins: check registration status
    if (registrationId) {
      const [reg] = await db
        .select({ status: registrationsTable.status })
        .from(registrationsTable)
        .where(eq(registrationsTable.id, registrationId));
      return reg?.status === "confirmed";
    }

    const regs = await db
      .select({ status: registrationsTable.status })
      .from(registrationsTable)
      .where(
        and(
          eq(registrationsTable.programType, programType),
          eq(registrationsTable.programId, programId),
          eq(registrationsTable.userId, clerkUserId),
        ),
      );
    if (!regs.length) return false;
    return regs[regs.length - 1].status === "confirmed";
  } catch {
    return false;
  }
}

/**
 * Resolve a human-readable offering name for notifications.
 * Falls back to a generic label if the record is not found.
 */
async function resolveOfferingName(programType: string, programId: number): Promise<string> {
  try {
    if (programType === "league") {
      const [row] = await db.select({ name: leaguesTable.name }).from(leaguesTable).where(eq(leaguesTable.id, programId));
      if (row?.name) return row.name;
    } else if (programType === "tournament") {
      const [row] = await db.select({ name: tournamentsTable.name }).from(tournamentsTable).where(eq(tournamentsTable.id, programId));
      if (row?.name) return row.name;
    } else if (programType === "camp") {
      const [row] = await db.select({ name: campsTable.name }).from(campsTable).where(eq(campsTable.id, programId));
      if (row?.name) return row.name;
    } else if (programType === "drop_in") {
      const [row] = await db.select({ name: dropinsTable.name }).from(dropinsTable).where(eq(dropinsTable.id, programId));
      if (row?.name) return row.name;
    }
  } catch (_) {}
  const label = programType === "drop_in" ? "Drop-in" : programType.charAt(0).toUpperCase() + programType.slice(1);
  return `${label} #${programId}`;
}

/**
 * Reconcile an installment milestone after payment success.
 * Uses baseAmount (program amount only, no service fee) for principal tracking.
 */
async function reconcileInstallment(
  meta: Record<string, string>,
  paymentId: number,
  baseAmount: number,
): Promise<void> {
  // installments.ts uses "scheduleId" key; support both key names
  const scheduleId = meta.scheduleId
    ? Number(meta.scheduleId)
    : (meta.installmentScheduleId ? Number(meta.installmentScheduleId) : null);
  const installmentNumber = meta.installmentNumber ? Number(meta.installmentNumber) : null;
  if (!scheduleId || !installmentNumber) return;

  // Idempotency: skip if this installment was already marked paid
  const [installment] = await db.select().from(installmentPaymentsTable)
    .where(and(
      eq(installmentPaymentsTable.scheduleId, scheduleId),
      eq(installmentPaymentsTable.installmentNumber, installmentNumber),
    ));
  if (installment?.status === "paid") return;

  await db.update(installmentPaymentsTable)
    .set({ status: "paid", paidAt: new Date(), paymentId, updatedAt: new Date() } as Partial<typeof installmentPaymentsTable.$inferInsert>)
    .where(and(
      eq(installmentPaymentsTable.scheduleId, scheduleId),
      eq(installmentPaymentsTable.installmentNumber, installmentNumber),
    ));

  const [schedule] = await db.select().from(installmentSchedulesTable).where(eq(installmentSchedulesTable.id, scheduleId));
  if (!schedule) return;

  const newPaid = Number(schedule.paidAmount) + baseAmount;
  const allPaid = newPaid >= Number(schedule.totalAmount);

  await db.update(installmentSchedulesTable)
    .set({ paidAmount: String(newPaid), status: allPaid ? "completed" : "active", updatedAt: new Date() } as Partial<typeof installmentSchedulesTable.$inferInsert>)
    .where(eq(installmentSchedulesTable.id, scheduleId));
}

/**
 * Reconcile deposit/balance fields on league or tournament registration.
 * Uses baseAmount (program amount only, no service fee) for obligation tracking.
 * meta.depositFor = "league_registration" | "tournament_registration"
 * meta.depositRegistrationId = numeric ID
 * meta.depositType = "deposit" | "balance"
 */
async function reconcileDepositOrBalance(
  meta: Record<string, string>,
  baseAmount: number,
): Promise<void> {
  const depositFor = meta.depositFor;
  const regId = meta.depositRegistrationId ? Number(meta.depositRegistrationId) : null;
  const depositType: "deposit" | "balance" | null = (meta.depositType as any) ?? null;
  if (!depositFor || !regId || !depositType) return;

  if (depositFor === "league_registration") {
    const [reg] = await db.select().from(leagueRegistrationsTable).where(eq(leagueRegistrationsTable.id, regId));
    if (!reg) return;
    // Idempotency: skip if deposit already recorded (for deposit type) or balance already zero
    if (depositType === "deposit" && reg.depositPaid) return;
    if (depositType === "balance" && Number(reg.balanceDue) <= 0) return;
    const newAmountPaid = Number(reg.amountPaid) + baseAmount;
    const newBalanceDue = Math.max(0, Number(reg.balanceDue) - baseAmount);
    const updates: Record<string, unknown> = { amountPaid: String(newAmountPaid), balanceDue: String(newBalanceDue), updatedAt: new Date() };
    if (depositType === "deposit") { updates.depositPaid = true; updates.depositPaidAt = new Date(); }
    if (newBalanceDue <= 0) updates.paymentStatus = "paid_inapp";
    await db.update(leagueRegistrationsTable).set(updates as any).where(eq(leagueRegistrationsTable.id, regId));

  } else if (depositFor === "tournament_registration") {
    const [reg] = await db.select().from(tournamentRegistrationsTable).where(eq(tournamentRegistrationsTable.id, regId));
    if (!reg) return;
    // Idempotency: skip if deposit already recorded or balance already cleared
    if (depositType === "deposit" && reg.depositPaid) return;
    const currentBalance = Math.max(0, Number(reg.totalAmount) - Number(reg.amountPaid));
    if (depositType === "balance" && currentBalance <= 0) return;
    const newAmountPaid = Number(reg.amountPaid) + baseAmount;
    const newBalance = Math.max(0, Number(reg.totalAmount) - newAmountPaid);
    const updates: Record<string, unknown> = { amountPaid: String(newAmountPaid), updatedAt: new Date() };
    if (depositType === "deposit") { updates.depositPaid = true; updates.depositPaidAt = new Date(); }
    if (newBalance <= 0) updates.paymentStatus = "paid_inapp";
    await db.update(tournamentRegistrationsTable).set(updates as any).where(eq(tournamentRegistrationsTable.id, regId));
  }
}

// ── membership subscription handlers ─────────────────────────────────────────

/**
 * Handle checkout.session.completed for membership subscriptions.
 * Creates/updates the userMembership record with the Stripe subscription ID.
 */
async function handleMembershipCheckout(session: any): Promise<void> {
  const meta = session.metadata ?? {};
  const userId = Number(meta.userId);
  const planId = Number(meta.planId);
  if (!userId || !planId) return;

  const subscriptionId = session.subscription as string | undefined;
  const today = new Date().toISOString().slice(0, 10);

  // Check for existing pending/cancelled membership for this user+plan
  const [existing] = await db
    .select()
    .from(userMembershipsTable)
    .where(and(eq(userMembershipsTable.userId, userId), eq(userMembershipsTable.planId, planId)))
    .limit(1);

  if (existing) {
    await db.update(userMembershipsTable)
      .set({ status: "active", providerSubscriptionId: subscriptionId ?? null, startDate: today, cancelledAt: null, updatedAt: new Date() } as Partial<typeof userMembershipsTable.$inferInsert>)
      .where(eq(userMembershipsTable.id, existing.id));
  } else {
    await db.insert(userMembershipsTable).values({
      userId, planId,
      status: "active",
      startDate: today,
      providerSubscriptionId: subscriptionId ?? null,
    } as typeof userMembershipsTable.$inferInsert);
  }

  await db.insert(auditLogTable).values({
    actorClerkId: meta.clerkUserId ?? "",
    action: "membership_subscribed",
    entityType: "user_membership",
    entityId: String(userId),
    notes: `Stripe subscription checkout completed — plan ${planId}, sub ${subscriptionId}`,
  });

  // Fire payment_receipt notification for the membership subscriber
  try {
    const [plan] = await db.select({ name: membershipPlansTable.name, price: membershipPlansTable.price })
      .from(membershipPlansTable).where(eq(membershipPlansTable.id, planId));
    const planName = plan?.name ?? `Membership Plan #${planId}`;
    const amountDollars = session.amount_total ? (session.amount_total / 100).toFixed(2) : (plan?.price ? Number(plan.price).toFixed(2) : "0.00");
    const paidOn = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    await sendNotificationWithPreferences({
      userId,
      type: "payment_receipt",
      subject: `Payment confirmed — ${planName}`,
      body: `Your payment of $${amountDollars} for ${planName} was received on ${paidOn}. Your membership is now active.`,
      metadata: { planId, amount: amountDollars, paidOn },
    });
  } catch (notifErr) {
    console.error("[stripeWebhook] membership payment_receipt notification failed:", notifErr);
  }
}

/**
 * Handle customer.subscription.created / customer.subscription.updated.
 * Syncs renewal date and status from Stripe to the DB.
 */
async function handleSubscriptionSync(subscription: any): Promise<void> {
  const subscriptionId: string = subscription.id;
  const status: string = subscription.status; // active | past_due | canceled | trialing | paused
  const currentPeriodEnd: number = subscription.current_period_end;

  const renewsAt = currentPeriodEnd
    ? new Date(currentPeriodEnd * 1000).toISOString().slice(0, 10)
    : null;

  const mapped = status === "active" || status === "trialing" ? "active"
    : status === "canceled" ? "cancelled"
    : "past_due";

  const [mem] = await db
    .select()
    .from(userMembershipsTable)
    .where(eq(userMembershipsTable.providerSubscriptionId, subscriptionId))
    .limit(1);

  if (!mem) return;

  const updates: Record<string, any> = { status: mapped, updatedAt: new Date() };
  if (renewsAt) updates.renewsAt = renewsAt;
  if (mapped === "cancelled") updates.cancelledAt = new Date();

  await db.update(userMembershipsTable)
    .set(updates as any)
    .where(eq(userMembershipsTable.id, mem.id));
}

/**
 * Handle customer.subscription.deleted — marks the membership as cancelled.
 */
async function handleSubscriptionDeleted(subscription: any): Promise<void> {
  const subscriptionId: string = subscription.id;
  const [mem] = await db
    .select()
    .from(userMembershipsTable)
    .where(eq(userMembershipsTable.providerSubscriptionId, subscriptionId))
    .limit(1);

  if (!mem) return;

  await db.update(userMembershipsTable)
    .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() } as Partial<typeof userMembershipsTable.$inferInsert>)
    .where(eq(userMembershipsTable.id, mem.id));
}

// ── payment intent complete handler (embedded checkout) ──────────────────────

async function handlePaymentIntentComplete(pi: any): Promise<void> {
  const meta: Record<string, string> = pi.metadata ?? {};
  const piId: string = pi.id;

  const clerkUserId: string = meta.clerkUserId ?? "";
  const programType: string = meta.programType ?? "";
  const programId = Number(meta.programId);
  const registrationId = meta.registrationId ? Number(meta.registrationId) : null;
  const discountCodeId = meta.discountCodeId ? Number(meta.discountCodeId) : null;
  const creditApplied = Number(meta.creditApplied ?? 0);
  const baseAmount = Number(meta.basePrice ?? 0);
  const serviceFeeAmount = Number(meta.serviceFeeAmount ?? 0);
  const totalAmount = baseAmount + serviceFeeAmount;
  const category: string = meta.category ?? programType;

  // Resolve charge ID and receipt URL from the charge object
  const providerChargeId = typeof pi.latest_charge === "string"
    ? pi.latest_charge
    : (pi.latest_charge?.id ?? null);

  let receiptUrl: string | null = null;
  if (providerChargeId) {
    try {
      const stripe = await getUncachableStripeClient();
      const charge = await stripe.charges.retrieve(providerChargeId);
      receiptUrl = charge.receipt_url ?? null;
    } catch (_) {}
  }

  const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkUserId));

  // Update or create the payment record, keyed on PI id
  const [existingPayment] = await db.select().from(paymentsTable)
    .where(eq(paymentsTable.providerPaymentId, piId));

  let paymentId: number;
  let piAlreadyPaid = false;
  if (existingPayment) {
    if (existingPayment.status !== "paid") {
      await db.update(paymentsTable)
        .set({ status: "paid", providerChargeId, receiptUrl, updatedAt: new Date() } as Partial<typeof paymentsTable.$inferInsert>)
        .where(eq(paymentsTable.providerPaymentId, piId));
    } else {
      piAlreadyPaid = true;
    }
    paymentId = existingPayment.id;
  } else {
    const [ins] = await db.insert(paymentsTable).values({
      userId: dbUser?.id ?? null,
      entityType: programType,
      entityId: programId,
      registrationId,
      amount: String(totalAmount),
      currency: "usd",
      status: "paid",
      provider: "stripe",
      providerPaymentId: piId,
      providerChargeId,
      paymentMethod: "card",
      serviceFeeAmount: String(serviceFeeAmount),
      receiptUrl,
      metadata: JSON.stringify({ discountCodeId, creditApplied }),
    } as typeof paymentsTable.$inferInsert).returning();
    paymentId = ins.id;
  }

  await reconcileInstallment(meta, paymentId, baseAmount);
  await reconcileDepositOrBalance(meta, baseAmount);

  const isPartialPayment = !!(meta.depositFor || meta.scheduleId || meta.installmentScheduleId);
  if (!isPartialPayment) {
    if (registrationId) {
      const [reg] = await db.select().from(registrationsTable).where(eq(registrationsTable.id, registrationId));
      if (reg && reg.paymentStatus !== "paid_inapp") {
        // Transition pending_payment → confirmed on successful payment; clear the expiry window.
        // If the registration was expired (race with background job), re-confirm since payment succeeded.
        const newStatus = (reg.status === "pending_payment" || reg.status === "expired")
          ? "confirmed"
          : reg.status;
        await db.update(registrationsTable)
          .set({ paymentStatus: "paid_inapp", amountPaid: String(totalAmount), status: newStatus, expiresAt: null, updatedAt: new Date() } as Partial<typeof registrationsTable.$inferInsert>)
          .where(eq(registrationsTable.id, registrationId));
      }
    } else {
      const regs = await db.select().from(registrationsTable)
        .where(and(
          eq(registrationsTable.userId, clerkUserId),
          eq(registrationsTable.programType, programType),
          eq(registrationsTable.programId, programId),
        ));
      if (regs.length > 0) {
        const latest = regs[regs.length - 1];
        if (latest.paymentStatus !== "paid_inapp") {
          const newStatus = (latest.status === "pending_payment" || latest.status === "expired")
            ? "confirmed"
            : latest.status;
          await db.update(registrationsTable)
            .set({ paymentStatus: "paid_inapp", amountPaid: String(totalAmount), status: newStatus, expiresAt: null, updatedAt: new Date() } as Partial<typeof registrationsTable.$inferInsert>)
            .where(eq(registrationsTable.id, latest.id));
        }
      }
    }
  }

  // Increment discount code usage (idempotent via CAS flag on payment metadata)
  if (discountCodeId) {
    const [currentPayment] = await db.select({ id: paymentsTable.id, metadata: paymentsTable.metadata })
      .from(paymentsTable).where(eq(paymentsTable.id, paymentId));
    const paymentMeta = currentPayment?.metadata
      ? (() => { try { return JSON.parse(currentPayment.metadata as string); } catch { return {}; } })()
      : {};
    if (!paymentMeta.discountIncremented) {
      const flagged = await db.update(paymentsTable)
        .set({ metadata: JSON.stringify({ ...paymentMeta, discountIncremented: true }), updatedAt: new Date() } as Partial<typeof paymentsTable.$inferInsert>)
        .where(and(
          eq(paymentsTable.id, paymentId),
          sql`(metadata::jsonb->>'discountIncremented')::boolean IS NOT TRUE`,
        ))
        .returning({ id: paymentsTable.id });
      if (flagged.length > 0) {
        await db.update(discountCodesTable)
          .set({ timesUsed: sql`${discountCodesTable.timesUsed} + 1`, updatedAt: new Date() } as Partial<typeof discountCodesTable.$inferInsert>)
          .where(eq(discountCodesTable.id, discountCodeId));
      }
    }
  }

  if (totalAmount > 0) {
    const venueId = await resolveEventVenueId(programType, programId);
    await recordRevenue({
      entityType: programType,
      entityId: programId,
      category,
      grossAmount: totalAmount,
      paymentMethod: "card",
      paymentId,
      description: `Stripe payment intent: ${programType} #${programId}`,
      actorClerkId: clerkUserId,
      offeringType: programType || null,
      offeringId: programId || null,
      venueId,
    });
  }

  // Drop-in: create/confirm spot on successful payment
  if (programType === "drop_in" && meta.poolId) {
    const poolId = Number(meta.poolId);
    if (dbUser && poolId) {
      // When a guardian paid on behalf of a child, playerUserId is set in metadata
      const metaPlayerUserId = meta.playerUserId ? Number(meta.playerUserId) : null;
      const targetUserId = metaPlayerUserId ?? dbUser.id;
      const guardianUserIdForSpot: number | null = metaPlayerUserId ? dbUser.id : null;

      const existingSpots = await db.select().from(spotsTable).where(
        and(
          eq(spotsTable.poolId, poolId),
          eq(spotsTable.userId, targetUserId),
          eq(spotsTable.entityType, "dropin"),
          eq(spotsTable.entityId, programId),
        )
      );
      const activeSpot = existingSpots.find((s: any) => s.status !== "cancelled");
      if (!activeSpot) {
        const [pool] = await db.select().from(dropinCourtPoolsTable).where(eq(dropinCourtPoolsTable.id, poolId));
        const poolAllSpots = await db.select().from(spotsTable).where(
          and(
            eq(spotsTable.poolId, poolId),
            eq(spotsTable.entityType, "dropin"),
            sql`${spotsTable.status} != 'cancelled'`,
            eq((spotsTable as any).waitlisted, false),
          )
        );
        const spotsTaken = poolAllSpots.length;
        const cap = pool?.cap ?? Infinity;
        const isFull = spotsTaken >= cap;
        let waitlistPosition: number | null = null;
        if (isFull) {
          const waitlistedSpots = await db.select().from(spotsTable).where(
            and(
              eq(spotsTable.poolId, poolId),
              eq(spotsTable.entityType, "dropin"),
              sql`${spotsTable.status} != 'cancelled'`,
              eq((spotsTable as any).waitlisted, true),
            )
          );
          waitlistPosition = waitlistedSpots.length + 1;
        }
        await db.insert(spotsTable).values({
          entityType: "dropin",
          entityId: programId,
          poolId,
          userId: targetUserId,
          guardianUserId: guardianUserIdForSpot,
          status: "reserved",
          paymentStatus: "paid_inapp",
          waitlisted: isFull,
          waitlistPosition,
          confirmedAt: isFull ? null : new Date(),
        } as typeof spotsTable.$inferInsert);
      } else if (
        activeSpot.paymentStatus !== "paid_inapp" ||
        // Idempotent fix-up: spot may already be marked paid (by PI webhook) but
        // still have stale waitlisted/offer fields if events arrived out of order.
        ((activeSpot as any).waitlisted && (activeSpot as any).offerSentAt)
      ) {
        const spotUpdateData: any = { paymentStatus: "paid_inapp", updatedAt: new Date() };
        // Confirm waitlist offer — clear offer + waitlist fields regardless of which
        // event fires first (checkout.session.completed or payment_intent.succeeded)
        if ((activeSpot as any).waitlisted && (activeSpot as any).offerSentAt) {
          // Cap-safety: count currently confirmed seats (excluding this spot) to
          // prevent overbooking in the rare race where two offers are paid simultaneously.
          const [confirmPool] = await db.select({ cap: dropinCourtPoolsTable.cap })
            .from(dropinCourtPoolsTable).where(eq(dropinCourtPoolsTable.id, activeSpot.poolId!));
          const [capRow] = await db.execute(sql`
            SELECT COUNT(*) AS confirmed FROM spots
            WHERE pool_id = ${activeSpot.poolId}
              AND entity_type = 'dropin'
              AND NOT waitlisted
              AND status != 'cancelled'
              AND id != ${activeSpot.id}
          `);
          const alreadyConfirmed = Number((capRow as any).confirmed ?? 0);
          const poolCap = Number(confirmPool?.cap ?? Infinity);
          if (alreadyConfirmed >= poolCap) {
            // Pool is at capacity — do not confirm; log for admin review.
            console.error(
              `[stripeWebhook] cap-safety: pool ${activeSpot.poolId} full (${alreadyConfirmed}/${poolCap}), ` +
              `spot ${activeSpot.id} paid but kept waitlisted — admin must resolve`
            );
          } else {
            spotUpdateData.waitlisted = false;
            spotUpdateData.waitlistPosition = null;
            spotUpdateData.confirmedAt = new Date();
            spotUpdateData.offerSentAt = null;
            spotUpdateData.offerExpiresAt = null;
            spotUpdateData.stripeCheckoutSessionId = null;
          }
        }
        await db.update(spotsTable)
          .set(spotUpdateData)
          .where(eq(spotsTable.id, activeSpot.id));
        // Shift remaining waitlist positions down if this player was promoted
        if ((activeSpot as any).waitlisted && activeSpot.poolId && (activeSpot as any).waitlistPosition) {
          await db.execute(
            sql`UPDATE spots SET waitlist_position = waitlist_position - 1
                WHERE pool_id = ${activeSpot.poolId}
                  AND entity_type = 'dropin'
                  AND entity_id = ${programId}
                  AND waitlisted = true
                  AND status = 'reserved'
                  AND waitlist_position > ${(activeSpot as any).waitlistPosition}`
          );
        }
      }
    }
  }

  // Camp: update campRegistrationsTable.paymentStatus (idempotent)
  if (programType === "camp") {
    const campRegId = meta.campRegId ? Number(meta.campRegId) : null;
    if (campRegId) {
      // Consistency guard: only update if campId matches programId in metadata
      await db.update(campRegistrationsTable)
        .set({ paymentStatus: "paid_inapp", pricePaid: String(baseAmount), updatedAt: new Date() } as Partial<typeof campRegistrationsTable.$inferInsert>)
        .where(and(
          eq(campRegistrationsTable.id, campRegId),
          eq(campRegistrationsTable.campId, programId),
          sql`${campRegistrationsTable.paymentStatus} != 'paid_inapp'`,
        ));
    } else if (dbUser) {
      const [campReg] = await db.select().from(campRegistrationsTable)
        .where(and(
          eq(campRegistrationsTable.campId, programId),
          or(eq(campRegistrationsTable.userId, dbUser.id), eq(campRegistrationsTable.playerUserId, dbUser.id)),
          sql`${campRegistrationsTable.status} != 'cancelled'`,
        ))
        .limit(1);
      if (campReg && campReg.paymentStatus !== "paid_inapp") {
        await db.update(campRegistrationsTable)
          .set({ paymentStatus: "paid_inapp", pricePaid: String(baseAmount), updatedAt: new Date() } as Partial<typeof campRegistrationsTable.$inferInsert>)
          .where(eq(campRegistrationsTable.id, campReg.id));
      }
    }
  }

  // Fire payment_receipt notification (skip if this event was already processed)
  if (!piAlreadyPaid && dbUser) {
    try {
      const offeringName = await resolveOfferingName(programType, programId);
      const amountDollars = totalAmount.toFixed(2);
      const paidOn = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
      await sendNotificationWithPreferences({
        userId: dbUser.id,
        type: "payment_receipt",
        subject: `Payment confirmed — ${offeringName}`,
        body: `Your payment of $${amountDollars} for ${offeringName} was received on ${paidOn}. You're all set!`,
        metadata: { programType, programId, amount: amountDollars, paidOn, receiptUrl },
      });
    } catch (notifErr) {
      console.error("[stripeWebhook] payment_intent payment_receipt notification failed:", notifErr);
    }

    // Send registration confirmation email with embedded QR code (confirmed spots only)
    if (!isPartialPayment) {
      try {
        const resolvedPoolId = meta.poolId ? Number(meta.poolId) : null;
        const playerUserId = await resolveRegistrationPlayerUserId(
          meta, programType, programId, registrationId, clerkUserId, dbUser.id,
        );
        const confirmed = await isEntityConfirmedInDb(
          programType, programId, registrationId, clerkUserId, resolvedPoolId, playerUserId,
        );
        if (confirmed) {
          await sendRegistrationConfirmationEmail({
            recipientUserId: dbUser.id,
            playerUserId,
            entityType: programType,
            entityId: programId,
            poolId: resolvedPoolId,
            amountPaid: totalAmount,
          });
        }
      } catch (confirmErr) {
        console.error("[stripeWebhook] payment_intent confirmation email failed:", confirmErr);
      }
    }
  }
}

// ── main checkout complete handler ───────────────────────────────────────────

async function handleCheckoutComplete(session: any): Promise<void> {
  const meta: Record<string, string> = session.metadata ?? {};
  const sessionId: string = session.id;

  const clerkUserId: string = meta.clerkUserId ?? "";
  const programType: string = meta.programType ?? "";
  const programId = Number(meta.programId);
  const registrationId = meta.registrationId ? Number(meta.registrationId) : null;
  const discountCodeId = meta.discountCodeId ? Number(meta.discountCodeId) : null;
  const creditApplied = Number(meta.creditApplied ?? 0);

  // basePrice in metadata = the program amount charged via Stripe (excludes service fee)
  const baseAmount = Number(meta.basePrice ?? 0);
  const serviceFeeAmount = Number(meta.serviceFeeAmount ?? 0);
  // totalAmount = what Stripe actually charged (program + service fee)
  const totalAmount = baseAmount + serviceFeeAmount;
  const category: string = meta.category ?? programType;

  // ── 1. Resolve Stripe charge ID ─────────────────────────────────────────
  // Treat retrieval failure as retryable — do NOT silently proceed with null
  // chargeId for card payments, as it would permanently block future refunds.
  let providerChargeId: string | null = null;
  if (session.payment_intent) {
    const stripe = await getUncachableStripeClient();
    const pi = await stripe.paymentIntents.retrieve(session.payment_intent as string);
    providerChargeId = (pi.latest_charge as string) ?? null;
    // If Stripe returned a payment_intent but no charge yet (e.g. async), fail
    // so the webhook retries and picks up the charge ID once it's available.
    if (!providerChargeId) {
      throw new Error(`PaymentIntent ${session.payment_intent} has no charge yet — will retry`);
    }
  }

  // ── 2. Resolve DB user ──────────────────────────────────────────────────
  const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkUserId));

  // ── 3. Update or create the payment record ─────────────────────────────
  // Key on providerPaymentId alone (not status) so retries after a partial
  // failure don't insert a second paid row for the same Stripe session.
  const [existingPayment] = await db.select().from(paymentsTable)
    .where(eq(paymentsTable.providerPaymentId, sessionId));

  let paymentId: number;
  // alreadyPaid = true when this session was already marked paid in a prior attempt.
  // Downstream reconciliation steps must still run (they may have failed previously),
  // but each step guards itself against double-application.
  let alreadyPaid = false;
  if (existingPayment) {
    if (existingPayment.status !== "paid") {
      await db.update(paymentsTable)
        .set({ status: "paid", providerChargeId, receiptUrl: session.receipt_url ?? null, updatedAt: new Date() } as Partial<typeof paymentsTable.$inferInsert>)
        .where(eq(paymentsTable.providerPaymentId, sessionId));
    } else {
      alreadyPaid = true;
    }
    paymentId = existingPayment.id;
  } else {
    const [ins] = await db.insert(paymentsTable).values({
      userId: dbUser?.id ?? null,
      entityType: programType,
      entityId: programId,
      registrationId,
      amount: String(totalAmount),
      currency: "usd",
      status: "paid",
      provider: "stripe",
      providerPaymentId: sessionId,
      providerChargeId,
      paymentMethod: "card",
      serviceFeeAmount: String(serviceFeeAmount),
      receiptUrl: session.receipt_url ?? null,
      metadata: JSON.stringify({ discountCodeId, creditApplied }),
    } as typeof paymentsTable.$inferInsert).returning();
    paymentId = ins.id;
  }

  // ── 4. Reconcile installment milestone (program amount only, no svc fee) 
  await reconcileInstallment(meta, paymentId, baseAmount);

  // ── 5. Reconcile deposit/balance (program amount only, no svc fee) ──────
  await reconcileDepositOrBalance(meta, baseAmount);

  // ── 6. Update generic registration for full-charge sessions only ────────
  // Idempotency: skip if already paid_inapp (retry-safe).
  const isPartialPayment = !!(meta.depositFor || meta.scheduleId || meta.installmentScheduleId);
  if (!isPartialPayment) {
    if (registrationId) {
      const [reg] = await db.select().from(registrationsTable).where(eq(registrationsTable.id, registrationId));
      if (reg && reg.paymentStatus !== "paid_inapp") {
        const newStatus = (reg.status === "pending_payment" || reg.status === "expired")
          ? "confirmed"
          : reg.status;
        await db.update(registrationsTable)
          .set({ paymentStatus: "paid_inapp", amountPaid: String(totalAmount), status: newStatus, expiresAt: null, updatedAt: new Date() } as Partial<typeof registrationsTable.$inferInsert>)
          .where(eq(registrationsTable.id, registrationId));
      }
    } else {
      const regs = await db.select().from(registrationsTable)
        .where(and(
          eq(registrationsTable.userId, clerkUserId),
          eq(registrationsTable.programType, programType),
          eq(registrationsTable.programId, programId),
        ));
      if (regs.length > 0) {
        const latest = regs[regs.length - 1];
        if (latest.paymentStatus !== "paid_inapp") {
          const newStatus = (latest.status === "pending_payment" || latest.status === "expired")
            ? "confirmed"
            : latest.status;
          await db.update(registrationsTable)
            .set({ paymentStatus: "paid_inapp", amountPaid: String(totalAmount), status: newStatus, expiresAt: null, updatedAt: new Date() } as Partial<typeof registrationsTable.$inferInsert>)
            .where(eq(registrationsTable.id, latest.id));
        }
      }
    }
  }

  // ── 7. Increment discount code usage ────────────────────────────────────
  // Durable idempotency via two-phase atomic flag:
  //   Phase 1 — atomically set discountIncremented=true on the payment metadata
  //             only if it is currently false (compare-and-swap via SQL condition).
  //             This ensures exactly one concurrent retry wins.
  //   Phase 2 — only if phase 1 succeeded (rowcount=1), increment timesUsed.
  //   On retry: phase 1 is a no-op (flag already set), so timesUsed is not touched again.
  if (discountCodeId) {
    const [currentPayment] = await db.select({ id: paymentsTable.id, metadata: paymentsTable.metadata })
      .from(paymentsTable).where(eq(paymentsTable.id, paymentId));
    const paymentMeta = currentPayment?.metadata
      ? (() => { try { return JSON.parse(currentPayment.metadata as string); } catch { return {}; } })()
      : {};

    if (!paymentMeta.discountIncremented) {
      // Atomic CAS: only succeeds if metadata does NOT already contain discountIncremented=true
      const flagged = await db.update(paymentsTable)
        .set({ metadata: JSON.stringify({ ...paymentMeta, discountIncremented: true }), updatedAt: new Date() } as Partial<typeof paymentsTable.$inferInsert>)
        .where(and(
          eq(paymentsTable.id, paymentId),
          sql`(metadata::jsonb->>'discountIncremented')::boolean IS NOT TRUE`,
        ))
        .returning({ id: paymentsTable.id });

      if (flagged.length > 0) {
        // We won the race — exactly one retry will reach this branch
        await db.update(discountCodesTable)
          .set({ timesUsed: sql`${discountCodesTable.timesUsed} + 1`, updatedAt: new Date() } as Partial<typeof discountCodesTable.$inferInsert>)
          .where(eq(discountCodesTable.id, discountCodeId));
      }
    }
  }

  // ── 8. Record revenue (total Stripe charge including service fee) ────────
  // Durable idempotency: recordRevenue checks for an existing row keyed by paymentId
  // before inserting, so retries are safe regardless of prior failure point.
  if (totalAmount > 0) {
    const venueId = await resolveEventVenueId(programType, programId);
    await recordRevenue({
      entityType: programType,
      entityId: programId,
      category,
      grossAmount: totalAmount,
      paymentMethod: "card",
      paymentId,
      description: `Stripe checkout: ${programType} #${programId}`,
      actorClerkId: clerkUserId,
      offeringType: programType || null,
      offeringId: programId || null,
      venueId,
    });
  }

  // ── Drop-in: create/confirm spot on successful payment ───────────────────
  // For paid drop-in pools, spot is created post-payment rather than pre-RSVP.
  // Idempotent: skips if an active (non-cancelled) spot already exists.
  // Re-checks pool capacity at webhook time to prevent overbooking from concurrent checkouts.
  if (programType === "drop_in" && meta.poolId) {
    const poolId = Number(meta.poolId);
    if (dbUser && poolId) {
      // When a guardian paid on behalf of a child, playerUserId is set in metadata
      const metaPlayerUserId = meta.playerUserId ? Number(meta.playerUserId) : null;
      const targetUserId = metaPlayerUserId ?? dbUser.id;
      const guardianUserIdForSpot: number | null = metaPlayerUserId ? dbUser.id : null;

      const existingSpots = await db.select().from(spotsTable).where(
        and(
          eq(spotsTable.poolId, poolId),
          eq(spotsTable.userId, targetUserId),
          eq(spotsTable.entityType, "dropin"),
          eq(spotsTable.entityId, programId),
        )
      );
      const activeSpot = existingSpots.find((s: any) => s.status !== "cancelled");
      if (!activeSpot) {
        // No spot yet (legacy path: no payment_pending spot was pre-created).
        // Re-check capacity at payment time to prevent overbooking from concurrent checkouts.
        const [pool] = await db.select().from(dropinCourtPoolsTable).where(eq(dropinCourtPoolsTable.id, poolId));
        const poolAllSpots = await db.select().from(spotsTable).where(
          and(
            eq(spotsTable.poolId, poolId),
            eq(spotsTable.entityType, "dropin"),
            sql`${spotsTable.status} != 'cancelled'`,
            eq((spotsTable as any).waitlisted, false),
          )
        );
        const spotsTaken = poolAllSpots.length;
        const cap = pool?.cap ?? Infinity;
        const isFull = spotsTaken >= cap;

        // Count waitlisted spots to get next position
        let waitlistPosition: number | null = null;
        if (isFull) {
          const waitlistedSpots = await db.select().from(spotsTable).where(
            and(
              eq(spotsTable.poolId, poolId),
              eq(spotsTable.entityType, "dropin"),
              sql`${spotsTable.status} != 'cancelled'`,
              eq((spotsTable as any).waitlisted, true),
            )
          );
          waitlistPosition = waitlistedSpots.length + 1;
        }

        await db.insert(spotsTable).values({
          entityType: "dropin",
          entityId: programId,
          poolId,
          userId: targetUserId,
          guardianUserId: guardianUserIdForSpot,
          status: "reserved",
          paymentStatus: "paid_inapp",
          waitlisted: isFull,
          waitlistPosition,
          confirmedAt: isFull ? null : new Date(),
        } as typeof spotsTable.$inferInsert);
      } else if (activeSpot.paymentStatus !== "paid_inapp") {
        // Upgrade the payment_pending spot created by the checkout endpoint.
        await db.update(spotsTable)
          .set({ paymentStatus: "paid_inapp", confirmedAt: new Date(), updatedAt: new Date() } as Partial<typeof spotsTable.$inferInsert>)
          .where(eq(spotsTable.id, activeSpot.id));
      }
    }
  }

  // ── Camp: update campRegistrationsTable.paymentStatus (idempotent) ───────
  if (programType === "camp") {
    const campRegId = meta.campRegId ? Number(meta.campRegId) : null;
    if (campRegId) {
      // Consistency guard: only update if campId matches programId in metadata
      await db.update(campRegistrationsTable)
        .set({ paymentStatus: "paid_inapp", pricePaid: String(baseAmount), updatedAt: new Date() } as Partial<typeof campRegistrationsTable.$inferInsert>)
        .where(and(
          eq(campRegistrationsTable.id, campRegId),
          eq(campRegistrationsTable.campId, programId),
          sql`${campRegistrationsTable.paymentStatus} != 'paid_inapp'`,
        ));
    } else if (dbUser) {
      const [campReg] = await db.select().from(campRegistrationsTable)
        .where(and(
          eq(campRegistrationsTable.campId, programId),
          or(eq(campRegistrationsTable.userId, dbUser.id), eq(campRegistrationsTable.playerUserId, dbUser.id)),
          sql`${campRegistrationsTable.status} != 'cancelled'`,
        ))
        .limit(1);
      if (campReg && campReg.paymentStatus !== "paid_inapp") {
        await db.update(campRegistrationsTable)
          .set({ paymentStatus: "paid_inapp", pricePaid: String(baseAmount), updatedAt: new Date() } as Partial<typeof campRegistrationsTable.$inferInsert>)
          .where(eq(campRegistrationsTable.id, campReg.id));
      }
    }
  }

  // Fire payment_receipt notification (skip on idempotent retry that was already paid)
  if (!alreadyPaid && dbUser) {
    try {
      const offeringName = await resolveOfferingName(programType, programId);
      const amountDollars = totalAmount.toFixed(2);
      const paidOn = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
      await sendNotificationWithPreferences({
        userId: dbUser.id,
        type: "payment_receipt",
        subject: `Payment confirmed — ${offeringName}`,
        body: `Your payment of $${amountDollars} for ${offeringName} was received on ${paidOn}. You're all set!`,
        metadata: { programType, programId, amount: amountDollars, paidOn },
      });
    } catch (notifErr) {
      console.error("[stripeWebhook] checkout payment_receipt notification failed:", notifErr);
    }

    // Send registration confirmation email with embedded QR code (confirmed spots only)
    if (!isPartialPayment) {
      try {
        const resolvedPoolId = meta.poolId ? Number(meta.poolId) : null;
        const playerUserId = await resolveRegistrationPlayerUserId(
          meta, programType, programId, registrationId, clerkUserId, dbUser.id,
        );
        const confirmed = await isEntityConfirmedInDb(
          programType, programId, registrationId, clerkUserId, resolvedPoolId, playerUserId,
        );
        if (confirmed) {
          await sendRegistrationConfirmationEmail({
            recipientUserId: dbUser.id,
            playerUserId,
            entityType: programType,
            entityId: programId,
            poolId: resolvedPoolId,
            amountPaid: totalAmount,
          });
        }
      } catch (confirmErr) {
        console.error("[stripeWebhook] checkout confirmation email failed:", confirmErr);
      }
    }
  }
}

// ── webhook endpoint ─────────────────────────────────────────────────────────

router.post("/stripe/webhook", async (req: Request, res: Response): Promise<void> => {
  let event: any;
  const sig = req.headers["stripe-signature"] as string | undefined;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const isDev = process.env.NODE_ENV === "development";

  // ── Parse & verify signature ────────────────────────────────────────────
  try {
    const stripe = await getUncachableStripeClient();
    const rawBody = (req as any).rawBody ?? req.body;
    if (webhookSecret && sig) {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } else if (isDev && !sig) {
      event = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
    } else {
      res.status(400).json({ error: "Webhook signature verification required in production" });
      return;
    }
  } catch (err: any) {
    console.error("Webhook signature verification failed:", err.message);
    res.status(400).json({ error: `Webhook Error: ${err.message}` });
    return;
  }

  // ── Idempotency: only deduplicate successfully processed events ──────────
  // Check if we already have a successful record for this event.
  // If it was previously attempted but failed (success=false), allow retry.
  const [existing] = await db.select().from(stripeEventsTable)
    .where(eq(stripeEventsTable.stripeEventId, event.id));

  if (existing) {
    if (existing.success) {
      // Already processed successfully — safe to skip
      res.json({ received: true, duplicate: true });
      return;
    }
    // Previous attempt failed — fall through to retry processing
    // (will update the existing row at the end)
  } else {
    // First time we've seen this event — insert a pending record
    try {
      await db.insert(stripeEventsTable).values({
        stripeEventId: event.id,
        eventType: event.type,
        success: false,
      } as typeof stripeEventsTable.$inferInsert);
    } catch (_) {
      // Race condition: another process inserted between our SELECT and INSERT
      // Treat it as a duplicate and skip
      res.json({ received: true, duplicate: true });
      return;
    }
  }

  // ── Process event ───────────────────────────────────────────────────────
  try {
    switch (event.type) {

      case "checkout.session.expired": {
        const session = event.data.object as any;
        await db.update(paymentsTable)
          .set({ status: "failed", updatedAt: new Date() } as Partial<typeof paymentsTable.$inferInsert>)
          .where(eq(paymentsTable.providerPaymentId, session.id));

        // Restore pre-reserved credits — idempotent via atomic CAS on payment metadata.
        // Only one webhook delivery (or retry) restores credits; subsequent retries are no-ops.
        const reservedJson = (session.metadata as any)?.reservedCreditIds;
        if (reservedJson) {
          // Atomically set creditsRestored=true on the payment row — only succeeds once.
          const [paymentRow] = await db.select({ id: paymentsTable.id, metadata: paymentsTable.metadata })
            .from(paymentsTable).where(eq(paymentsTable.providerPaymentId, session.id));

          if (paymentRow) {
            const flagged = await db.update(paymentsTable)
              .set({ metadata: JSON.stringify({ ...(() => { try { return JSON.parse(paymentRow.metadata as string ?? "{}"); } catch { return {}; } })(), creditsRestored: true }), updatedAt: new Date() } as Partial<typeof paymentsTable.$inferInsert>)
              .where(and(
                eq(paymentsTable.id, paymentRow.id),
                sql`(metadata::jsonb->>'creditsRestored')::boolean IS NOT TRUE`,
              ))
              .returning({ id: paymentsTable.id });

            // Only restore if we won the CAS race (exactly once per session)
            if (flagged.length > 0) {
              await restoreReservedCredits(reservedJson);
            }
          }
        }

        // Waitlist offer expired: notify player, clear offer fields, advance queue
        const sessionExpiredMeta: Record<string, string> = session.metadata ?? {};
        if (sessionExpiredMeta.waitlistOffer === "true" && sessionExpiredMeta.waitlistSpotId) {
          const expiredSpotId = Number(sessionExpiredMeta.waitlistSpotId);
          const [expiredOfferSpot] = await db.select().from(spotsTable).where(eq(spotsTable.id, expiredSpotId));
          if (expiredOfferSpot && expiredOfferSpot.poolId) {
            // Guard: if offerSentAt is already null, the offer was cleared by an admin
            // displacement before this webhook fired. Skip re-dispatch entirely to
            // prevent a second concurrent offer being issued for the same spot.
            if (!(expiredOfferSpot as any).offerSentAt) {
              console.log("[stripeWebhook] waitlist offer already cleared (admin displacement) — skipping re-dispatch for spot", expiredSpotId);
              // fall through to next webhook processing block
            } else {
            // Notify the player whose offer just expired
            if (expiredOfferSpot.userId) {
              try {
                const [dropinForNotif] = await db
                  .select({ name: dropinsTable.name })
                  .from(dropinsTable)
                  .where(eq(dropinsTable.id, expiredOfferSpot.entityId));
                await sendMultiChannelNotification(["in_app", "email"], {
                  userId: expiredOfferSpot.userId,
                  type: "offer_expired",
                  subject: `Your spot offer for ${dropinForNotif?.name ?? "drop-in"} has expired`,
                  body: `Your reserved spot offer has expired. You remain on the waitlist and will be notified if another spot opens up.`,
                  metadata: {
                    dropinId: expiredOfferSpot.entityId,
                    poolId: expiredOfferSpot.poolId,
                    spotId: expiredSpotId,
                  },
                });
              } catch (notifErr) {
                console.error("[stripeWebhook] waitlist offer expiry notification failed:", notifErr);
              }
            }
            // Clear offer fields on the expired spot and push it to the back of
            // the waitlist queue so dispatchWaitlistOffer selects the next player
            // in line rather than re-offering to the same person.
            const [lastInQueue] = await db
              .select({ pos: sql<number>`MAX(waitlist_position)` })
              .from(spotsTable)
              .where(
                and(
                  eq(spotsTable.poolId, expiredOfferSpot.poolId),
                  eq(spotsTable.entityType, "dropin"),
                  eq(spotsTable.waitlisted, true),
                  sql`${spotsTable.status} != 'cancelled'`,
                )
              );
            const backOfQueue = (Number(lastInQueue?.pos ?? 0)) + 1;
            await db.update(spotsTable)
              .set({
                offerSentAt: null,
                offerExpiresAt: null,
                stripeCheckoutSessionId: null,
                waitlistPosition: backOfQueue,
                updatedAt: new Date(),
              } as Partial<typeof spotsTable.$inferInsert>)
              .where(eq(spotsTable.id, expiredSpotId));
            // Shift everyone who was behind the expired slot one position forward
            await db.execute(
              sql`UPDATE spots
                  SET waitlist_position = waitlist_position - 1
                  WHERE pool_id = ${expiredOfferSpot.poolId}
                    AND entity_type = 'dropin'
                    AND waitlisted = true
                    AND status != 'cancelled'
                    AND id != ${expiredSpotId}
                    AND waitlist_position IS NOT NULL
                    AND waitlist_position > ${(expiredOfferSpot as any).waitlistPosition ?? 0}`
            );
            try {
              const { dispatchWaitlistOffer } = await import("./dropins");
              await dispatchWaitlistOffer(expiredOfferSpot.poolId, expiredOfferSpot.entityId, 1);
            } catch (dispatchErr) {
              console.error("[stripeWebhook] waitlist offer re-dispatch failed:", dispatchErr);
            }
            } // closes else (admin-displacement guard)
          }   // closes if (expiredOfferSpot && expiredOfferSpot.poolId)
        }     // closes if (sessionExpiredMeta.waitlistOffer === "true" ...)

        // Cancel any payment_pending drop-in spot that was pre-created by the checkout endpoint.
        // Spots are now tagged with cs:<sessionId> in their notes field.
        const expiredMeta: Record<string, string> = session.metadata ?? {};
        if (expiredMeta.programType === "drop_in" && expiredMeta.poolId && expiredMeta.clerkUserId) {
          const [cancelUser] = await db.select({ id: usersTable.id }).from(usersTable)
            .where(eq(usersTable.clerkId, expiredMeta.clerkUserId));
          if (cancelUser) {
            await db.update(spotsTable)
              .set({ status: "cancelled", cancelledAt: new Date(), cancellationReason: "payment_failed", updatedAt: new Date() } as Partial<typeof spotsTable.$inferInsert>)
              .where(
                and(
                  eq(spotsTable.poolId, Number(expiredMeta.poolId)),
                  eq(spotsTable.userId, Number(expiredMeta.playerUserId ?? cancelUser.id)),
                  eq(spotsTable.entityType, "dropin"),
                  sql`${spotsTable.paymentStatus} = 'payment_pending'`,
                )
              );
          }
        }

        // Fire payment_failed notification if we have a user
        if (expiredMeta.clerkUserId) {
          try {
            const [failedUser] = await db.select({ id: usersTable.id }).from(usersTable)
              .where(eq(usersTable.clerkId, expiredMeta.clerkUserId));
            if (failedUser) {
              const offeringName = expiredMeta.programType && expiredMeta.programId
                ? await resolveOfferingName(expiredMeta.programType, Number(expiredMeta.programId))
                : "your registration";
              await sendNotificationWithPreferences({
                userId: failedUser.id,
                type: "payment_failed",
                subject: `Payment not completed — ${offeringName}`,
                body: `Your checkout session for ${offeringName} expired before payment was completed. Please try again from your dashboard.`,
                metadata: { programType: expiredMeta.programType, programId: expiredMeta.programId },
              });
            }
          } catch (notifErr) {
            console.error("[stripeWebhook] checkout.session.expired payment_failed notification failed:", notifErr);
          }
        }
        break;
      }

      // ── Membership subscription events ──────────────────────────────────

      case "checkout.session.completed": {
        const session = event.data.object as any;
        if (session.metadata?.type === "membership_subscription") {
          await handleMembershipCheckout(session);
        } else if (session.metadata?.type === "kotc_life_purchase") {
          await handleKotcLifePurchase(session);
        } else {
          await handleCheckoutComplete(session);
        }
        break;
      }

      case "payment_intent.succeeded": {
        const pi = event.data.object as any;
        const meta: Record<string, string> = pi.metadata ?? {};
        if (meta.clerkUserId) {
          await handlePaymentIntentComplete(pi);
        }
        break;
      }

      case "payment_intent.payment_failed":
      case "payment_intent.canceled": {
        const pi = event.data.object as any;
        await db.update(paymentsTable)
          .set({ status: "failed", updatedAt: new Date() } as Partial<typeof paymentsTable.$inferInsert>)
          .where(eq(paymentsTable.providerPaymentId, pi.id));
        const reservedJson = (pi.metadata as any)?.reservedCreditIds;
        if (reservedJson) {
          const [paymentRow] = await db.select({ id: paymentsTable.id, metadata: paymentsTable.metadata })
            .from(paymentsTable).where(eq(paymentsTable.providerPaymentId, pi.id));
          if (paymentRow) {
            const flagged = await db.update(paymentsTable)
              .set({ metadata: JSON.stringify({ ...(() => { try { return JSON.parse(paymentRow.metadata as string ?? "{}"); } catch { return {}; } })(), creditsRestored: true }), updatedAt: new Date() } as Partial<typeof paymentsTable.$inferInsert>)
              .where(and(
                eq(paymentsTable.id, paymentRow.id),
                sql`(metadata::jsonb->>'creditsRestored')::boolean IS NOT TRUE`,
              ))
              .returning({ id: paymentsTable.id });
            if (flagged.length > 0) {
              await restoreReservedCredits(reservedJson);
            }
          }
        }
        // Cancel any payment_pending spot that was pre-created by the checkout endpoint
        const cancelMeta: Record<string, string> = pi.metadata ?? {};
        if (cancelMeta.programType === "drop_in" && cancelMeta.poolId && cancelMeta.clerkUserId) {
          const [cancelUser] = await db.select({ id: usersTable.id }).from(usersTable)
            .where(eq(usersTable.clerkId, cancelMeta.clerkUserId));
          if (cancelUser) {
            await db.update(spotsTable)
              .set({ status: "cancelled", cancelledAt: new Date(), cancellationReason: "payment_failed", updatedAt: new Date() } as Partial<typeof spotsTable.$inferInsert>)
              .where(
                and(
                  eq(spotsTable.poolId, Number(cancelMeta.poolId)),
                  eq(spotsTable.userId, cancelUser.id),
                  eq(spotsTable.entityType, "dropin"),
                  sql`${spotsTable.paymentStatus} = 'payment_pending'`,
                )
              );
          }
        }

        // Fire payment_failed notification
        if (cancelMeta.clerkUserId && event.type === "payment_intent.payment_failed") {
          try {
            const [failedUser] = await db.select({ id: usersTable.id }).from(usersTable)
              .where(eq(usersTable.clerkId, cancelMeta.clerkUserId));
            if (failedUser) {
              const offeringName = cancelMeta.programType && cancelMeta.programId
                ? await resolveOfferingName(cancelMeta.programType, Number(cancelMeta.programId))
                : "your registration";
              const failureMsg = pi.last_payment_error?.message ?? "Your card was declined or could not be processed.";
              await sendNotificationWithPreferences({
                userId: failedUser.id,
                type: "payment_failed",
                subject: `Payment failed — ${offeringName}`,
                body: `We were unable to process your payment for ${offeringName}. ${failureMsg} Please update your payment method and try again.`,
                metadata: { programType: cancelMeta.programType, programId: cancelMeta.programId, reason: failureMsg },
              });
            }
          } catch (notifErr) {
            console.error("[stripeWebhook] payment_intent.payment_failed notification failed:", notifErr);
          }
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
        await handleSubscriptionSync(event.data.object as any);
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object as any);
        break;

      case "charge.dispute.created": {
        const dispute = event.data.object as any;
        const chargeId: string = dispute.charge;
        const disputeStatus: string = dispute.reason === "general" ? "needs_response" : dispute.status ?? "needs_response";
        const [payment] = await db.select().from(paymentsTable)
          .where(eq(paymentsTable.providerChargeId, chargeId));
        if (payment) {
          await db.update(paymentsTable)
            .set({ disputeStatus, disputedAt: new Date(), updatedAt: new Date() } as Partial<typeof paymentsTable.$inferInsert>)
            .where(eq(paymentsTable.id, payment.id));
        }

        // Notify all super admins about the new dispute
        try {
          const superAdmins = await db.select({ id: usersTable.id }).from(usersTable)
            .where(sql`${usersTable.role} = 'admin'`);
          const amountDollars = dispute.amount ? (dispute.amount / 100).toFixed(2) : "?";
          const offeringName = payment?.entityType && payment?.entityId
            ? await resolveOfferingName(payment.entityType as string, Number(payment.entityId))
            : "Unknown";
          for (const admin of superAdmins) {
            await sendNotificationWithPreferences({
              userId: admin.id,
              type: "general",
              subject: `Stripe dispute opened — $${amountDollars}`,
              body: `A chargeback dispute of $${amountDollars} was opened on a payment for ${offeringName}. Stripe dispute ID: ${dispute.id}. Visit /admin/disputes to review.`,
              metadata: { disputeId: dispute.id, chargeId, paymentId: payment?.id, amount: amountDollars, offeringName },
            });
          }
        } catch (notifErr) {
          console.error("[stripeWebhook] charge.dispute.created admin notification failed:", notifErr);
        }
        break;
      }

      case "charge.dispute.updated": {
        const dispute = event.data.object as any;
        const chargeId: string = dispute.charge;
        const newStatus: string = dispute.status ?? "under_review";
        const [payment] = await db.select().from(paymentsTable)
          .where(eq(paymentsTable.providerChargeId, chargeId));
        if (payment) {
          await db.update(paymentsTable)
            .set({ disputeStatus: newStatus, updatedAt: new Date() } as Partial<typeof paymentsTable.$inferInsert>)
            .where(eq(paymentsTable.id, payment.id));
        }
        break;
      }

      case "charge.dispute.closed": {
        const dispute = event.data.object as any;
        const chargeId: string = dispute.charge;
        const outcome: string = dispute.status; // "won" | "lost" | "warning_closed"
        const [payment] = await db.select().from(paymentsTable)
          .where(eq(paymentsTable.providerChargeId, chargeId));
        if (payment) {
          await db.update(paymentsTable)
            .set({ disputeStatus: outcome, updatedAt: new Date() } as Partial<typeof paymentsTable.$inferInsert>)
            .where(eq(paymentsTable.id, payment.id));

          // Lost dispute: create a negative reversal revenue record
          if (outcome === "lost") {
            const disputeAmount = dispute.amount ? dispute.amount / 100 : Number(payment.amount);
            await recordRevenue({
              entityType: payment.entityType as string,
              entityId: Number(payment.entityId),
              category: "dispute_reversal",
              grossAmount: -disputeAmount,
              paymentMethod: "card",
              description: `Dispute lost — chargeback reversal for payment #${payment.id} (Stripe dispute ${dispute.id})`,
              actorClerkId: null,
            });
          }

          // Notify admins of the outcome
          try {
            const superAdmins = await db.select({ id: usersTable.id }).from(usersTable)
              .where(sql`${usersTable.role} = 'admin'`);
            const amountDollars = dispute.amount ? (dispute.amount / 100).toFixed(2) : "?";
            const offeringName = payment.entityType && payment.entityId
              ? await resolveOfferingName(payment.entityType as string, Number(payment.entityId))
              : "Unknown";
            const outcomeLabel = outcome === "won" ? "WON" : outcome === "lost" ? "LOST" : "Closed";
            for (const admin of superAdmins) {
              await sendNotificationWithPreferences({
                userId: admin.id,
                type: "general",
                subject: `Stripe dispute ${outcomeLabel} — $${amountDollars}`,
                body: `The $${amountDollars} dispute for ${offeringName} was ${outcomeLabel.toLowerCase()}.${outcome === "lost" ? " A negative revenue reversal has been recorded." : ""} Stripe dispute ID: ${dispute.id}.`,
                metadata: { disputeId: dispute.id, chargeId, paymentId: payment.id, outcome, amount: amountDollars },
              });
            }
          } catch (notifErr) {
            console.error("[stripeWebhook] charge.dispute.closed admin notification failed:", notifErr);
          }
        }
        break;
      }

      case "account.updated": {
        const account = event.data.object as any;
        const stripeAccountId: string = account.id;
        const chargesEnabled: boolean = account.charges_enabled ?? false;
        const payoutsEnabled: boolean = account.payouts_enabled ?? false;
        const isFullyOnboarded = chargesEnabled && payoutsEnabled;

        if (!isFullyOnboarded) break;

        // ── 1. Find and update the matching staff profile or venue ────────────
        const [staffProfile] = await db.select({ id: staffProfilesTable.id, userId: staffProfilesTable.userId })
          .from(staffProfilesTable)
          .where(eq((staffProfilesTable as any).connectAccountId, stripeAccountId))
          .limit(1);

        const [venue] = await db.select({ id: venuesTable.id })
          .from(venuesTable)
          .where(eq((venuesTable as any).stripeConnectAccountId, stripeAccountId))
          .limit(1);

        if (staffProfile) {
          await db.update(staffProfilesTable)
            .set({ connectOnboardingStatus: "onboarded", updatedAt: new Date() } as Partial<typeof staffProfilesTable.$inferInsert>)
            .where(eq(staffProfilesTable.id, staffProfile.id));
        }

        if (venue) {
          await db.update(venuesTable)
            .set({ stripeConnectOnboardingStatus: "onboarded", updatedAt: new Date() } as Partial<typeof venuesTable.$inferInsert>)
            .where(eq(venuesTable.id, venue.id));
        }

        if (!staffProfile && !venue) {
          console.log(`[stripeWebhook] account.updated: no staff/venue found for account ${stripeAccountId}`);
          break;
        }

        // ── 2. Backfill connectAccountId on payouts that were created before ─
        //       the invite was sent (they were queued with a null connectAccountId)
        if (staffProfile) {
          await db.update(payoutsTable)
            .set({ connectAccountId: stripeAccountId, updatedAt: new Date() } as Partial<typeof payoutsTable.$inferInsert>)
            .where(
              and(
                eq(payoutsTable.recipientUserId, staffProfile.userId),
                eq(payoutsTable.status, "pending_onboarding"),
                isNull(payoutsTable.connectAccountId as any),
              ),
            );
        }
        if (venue) {
          await db.update(payoutsTable)
            .set({ connectAccountId: stripeAccountId, updatedAt: new Date() } as Partial<typeof payoutsTable.$inferInsert>)
            .where(
              and(
                eq((payoutsTable as any).venueId, venue.id),
                eq(payoutsTable.status, "pending_onboarding"),
                isNull(payoutsTable.connectAccountId as any),
              ),
            );
        }

        // ── 3. Find all pending_onboarding payouts for this account ──────────
        const pendingPayouts = staffProfile
          ? await db.select().from(payoutsTable).where(
              and(
                eq(payoutsTable.recipientUserId, staffProfile.userId),
                eq(payoutsTable.status, "pending_onboarding"),
              ),
            )
          : await db.select().from(payoutsTable).where(
              and(
                // After backfill above, all venue payouts for this account now have connectAccountId set
                eq(payoutsTable.connectAccountId as any, stripeAccountId),
                eq(payoutsTable.status, "pending_onboarding"),
              ),
            );

        if (!pendingPayouts.length) break;

        const stripe = await getUncachableStripeClient();

        // ── 4. Execute each queued payout via Stripe transfer ─────────────────
        for (const payout of pendingPayouts) {
          try {
            // Atomic CAS: mark as processing
            const cas = await db.update(payoutsTable)
              .set({ status: "processing", updatedAt: new Date() } as Partial<typeof payoutsTable.$inferInsert>)
              .where(and(eq(payoutsTable.id, payout.id), eq(payoutsTable.status, "pending_onboarding")))
              .returning();
            if (!cas.length) continue; // Already processed by a concurrent webhook

            const amountCents = Math.round(Number(payout.amount) * 100);
            const transfer = await stripe.transfers.create({
              amount: amountCents,
              currency: payout.currency,
              destination: stripeAccountId,
              description: payout.description ?? `PlayOn payout #${payout.id}`,
              metadata: {
                payoutId: String(payout.id),
                assignmentId: String((payout as any).assignmentId ?? ""),
                recipientUserId: String(payout.recipientUserId ?? ""),
                autoReleased: "true",
              },
            });

            await db.update(payoutsTable)
              .set({
                status: "paid",
                providerTransferId: transfer.id,
                processedAt: new Date(),
                failureReason: null,
                updatedAt: new Date(),
              } as Partial<typeof payoutsTable.$inferInsert>)
              .where(eq(payoutsTable.id, payout.id));

            if ((payout as any).assignmentId) {
              const { assignmentsTable } = await import("@workspace/db");
              await db.update(assignmentsTable)
                .set({ isPaid: true, paidAt: new Date(), updatedAt: new Date() } as Partial<typeof assignmentsTable.$inferInsert>)
                .where(eq(assignmentsTable.id, (payout as any).assignmentId));
            }

            await db.insert(auditLogTable).values({
              actorClerkId: "system",
              action: "auto_execute",
              entityType: "payout",
              entityId: String(payout.id),
              notes: `Auto-released on account.updated for ${stripeAccountId}. Transfer: ${transfer.id}`,
            });
          } catch (payoutErr: any) {
            console.error(`[stripeWebhook] Auto-release failed for payout ${payout.id}:`, payoutErr.message);
            await db.update(payoutsTable)
              .set({ status: "failed", failureReason: payoutErr.message, updatedAt: new Date() } as Partial<typeof payoutsTable.$inferInsert>)
              .where(eq(payoutsTable.id, payout.id));
          }
        }
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object as any;
        const [payment] = await db.select().from(paymentsTable)
          .where(eq(paymentsTable.providerChargeId, charge.id));
        if (payment) {
          await db.update(paymentsTable)
            .set({ refunded: true, refundAmount: String(charge.amount_refunded / 100), refundedAt: new Date(), updatedAt: new Date() } as Partial<typeof paymentsTable.$inferInsert>)
            .where(eq(paymentsTable.id, payment.id));
          if (payment.registrationId) {
            await db.update(registrationsTable)
              .set({ paymentStatus: "refunded", updatedAt: new Date() } as Partial<typeof registrationsTable.$inferInsert>)
              .where(eq(registrationsTable.id, payment.registrationId));
          }

          // Fire refund_issued notification if we can resolve the user
          if (payment.userId) {
            try {
              const refundDollars = (charge.amount_refunded / 100).toFixed(2);
              const offeringName = payment.entityType && payment.entityId
                ? await resolveOfferingName(payment.entityType as string, Number(payment.entityId))
                : "your registration";
              await sendNotificationWithPreferences({
                userId: payment.userId as number,
                type: "refund_issued",
                subject: `Refund issued — ${offeringName}`,
                body: `A refund of $${refundDollars} for ${offeringName} has been processed. Please allow 5–10 business days for the funds to appear on your statement.`,
                metadata: { paymentId: payment.id, refundAmount: refundDollars, offeringName },
              });
            } catch (notifErr) {
              console.error("[stripeWebhook] charge.refunded refund_issued notification failed:", notifErr);
            }
          }
        }
        break;
      }

      default:
        break;
    }

    // Mark event as successfully processed
    await db.update(stripeEventsTable)
      .set({ success: true, errorMessage: null } as Partial<typeof stripeEventsTable.$inferInsert>)
      .where(eq(stripeEventsTable.stripeEventId, event.id));

  } catch (err: any) {
    // Leave success=false so Stripe retries will reprocess this event
    await db.update(stripeEventsTable)
      .set({ errorMessage: err.message } as Partial<typeof stripeEventsTable.$inferInsert>)
      .where(eq(stripeEventsTable.stripeEventId, event.id));
    console.error("Error handling webhook event:", event.type, err);
    // Return 500 so Stripe knows to retry
    res.status(500).json({ error: "Internal error handling webhook" });
    return;
  }

  res.json({ received: true });
});

export default router;
