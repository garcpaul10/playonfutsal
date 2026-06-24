/**
 * Automatic Cancellation / Refund Policy Engine
 *
 * When a registration is cancelled (or when an admin triggers a policy evaluation),
 * this engine finds the best matching RefundCreditPolicy and applies it automatically.
 *
 * Matching priority:
 *  1. entityType === programType (specific)
 *  2. entityType === "all" (catch-all)
 *
 * Within each tier, the policy with the narrowest window (smallest windowDays) that
 * still covers the days-until-event is preferred.
 */
import { Router, type IRouter } from "express";
import { db, refundCreditPoliciesTable, paymentsTable, registrationsTable, leagueRegistrationsTable, tournamentRegistrationsTable, campRegistrationsTable, accountCreditsTable, usersTable, auditLogTable, spotsTable, dropinsTable } from "@workspace/db";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { requireSuperAdmin, requirePermission, type AuthedRequest } from "../middlewares/auth";
import { getUncachableStripeClient } from "../lib/stripe";
import { computeRefundableBase } from "../lib/refundUtils";
import { promoteNextWaitlisted } from "./dropins";
import type { Request } from "express";

const router: IRouter = Router();

async function findBestPolicy(
  programType: string,
  daysUntilEvent: number,
): Promise<typeof refundCreditPoliciesTable.$inferSelect | null> {
  const allPolicies = await db.select().from(refundCreditPoliciesTable)
    .where(eq(refundCreditPoliciesTable.isActive, true))
    .orderBy(desc(refundCreditPoliciesTable.windowDays));

  // Find specific-type policies that cover the cancellation window
  const specific = allPolicies.filter(
    (p) => p.entityType === programType && p.windowDays >= daysUntilEvent,
  ).sort((a, b) => a.windowDays - b.windowDays);

  if (specific.length > 0) return specific[0];

  // Fall back to catch-all
  const catchAll = allPolicies.filter(
    (p) => p.entityType === "all" && p.windowDays >= daysUntilEvent,
  ).sort((a, b) => a.windowDays - b.windowDays);

  return catchAll[0] ?? null;
}

/**
 * Minute-based policy matching for drop-in sessions.
 * Finds active drop_in policies with window_minutes set, picks the narrowest
 * window that is >= minutesUntilEvent (same logic as findBestPolicy but in minutes).
 *
 * If phaseOverrides is provided, each policy's windowMinutes is substituted with
 * the pool-specific override value (if one exists for that policyId) before the
 * phase-selection comparison runs. Falls back to the global windowMinutes when
 * no override entry is present for a given policy.
 */
async function findBestDropinPolicy(
  minutesUntilEvent: number,
  phaseOverrides?: Array<{ policyId: number; windowMinutes: number }> | null,
): Promise<typeof refundCreditPoliciesTable.$inferSelect | null> {
  const allPolicies = await db.select().from(refundCreditPoliciesTable)
    .where(and(eq(refundCreditPoliciesTable.isActive, true), eq(refundCreditPoliciesTable.entityType, "drop_in")));

  // Apply per-pool windowMinutes overrides: create a virtual copy of each policy
  // with the overridden threshold substituted in, then run the normal matching logic.
  const effectivePolicies = allPolicies.map((p) => {
    if (!phaseOverrides) return p;
    const override = phaseOverrides.find((o) => o.policyId === p.id);
    if (!override) return p;
    return { ...p, windowMinutes: override.windowMinutes } as typeof p;
  });

  // Keep only policies that have a minute-based window and still cover the time remaining.
  // "Still covers" means the window threshold <= minutesUntilEvent (i.e. the cancellation is
  // still within the phase's eligibility period). Among qualifying policies, prefer the largest
  // windowMinutes (most permissive tier the player falls into).
  const covering = effectivePolicies
    .filter((p) => (p as any).windowMinutes != null && Number((p as any).windowMinutes) <= minutesUntilEvent)
    .sort((a, b) => Number((b as any).windowMinutes) - Number((a as any).windowMinutes));

  return covering[0] ?? null;
}

interface ApplyPolicyResult {
  action: "refund" | "credit" | "none";
  refundAmount?: number;
  creditAmount?: number;
  stripeRefundId?: string;
  creditId?: number;
  policyId?: number | null;
  policyName?: string | null;
  error?: string;
}

/**
 * Core engine: find payment, compute amounts, apply policy.
 * Returns a result object; caller decides how to surface it.
 * For drop-in cancellations pass minutesUntilEvent; for all others pass daysUntilEvent.
 */
export async function applyPolicy(opts: {
  paymentId: number;
  programType: string;
  daysUntilEvent: number;
  minutesUntilEvent?: number;
  cancellationReason?: string;
  actorClerkId: string;
  creditExpiryDays?: number;
  policyIdOverride?: number | null;
  cancellationPhaseOverrides?: Array<{ policyId: number; windowMinutes: number }> | null;
}): Promise<ApplyPolicyResult> {
  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, opts.paymentId));
  if (!payment) return { action: "none", error: "Payment not found" };
  if ((payment as any).compensationStatus != null) {
    return { action: "none", error: `Payment already compensated: ${(payment as any).compensationStatus}` };
  }
  if (payment.status !== "paid") return { action: "none", error: "Payment not in paid state" };

  const policy = opts.programType === "drop_in" && opts.minutesUntilEvent != null
    ? await findBestDropinPolicy(opts.minutesUntilEvent, opts.cancellationPhaseOverrides ?? null)
    : opts.policyIdOverride != null
      ? (await db.select().from(refundCreditPoliciesTable).where(eq(refundCreditPoliciesTable.id, opts.policyIdOverride)).then(r => r[0] ?? null))
      : await findBestPolicy(opts.programType, opts.daysUntilEvent);

  // If no matching policy was found, cancel with no financial action taken.
  // This is the required behavior for drop-ins (policy coverage gaps → no compensation)
  // and keeps other program types safe when policies are not configured.
  if (!policy) {
    await db.insert(auditLogTable).values({
      actorClerkId: opts.actorClerkId,
      action: "auto_policy_apply",
      entityType: "payment",
      entityId: String(payment.id),
      notes: JSON.stringify({ action: "none", reason: "no_matching_policy", cancellationReason: opts.cancellationReason }),
    });
    return { action: "none" };
  }

  const grossPaid = Number(payment.amount);
  // Service fee is ALWAYS non-refundable; policyNonRefundableAmount is an additional floor.
  // Uses the same formula as refundPolicies.ts: gross - serviceFee - policyNR (NOT max(serviceFee, policyNR))
  const serviceFee = Number((payment as any).serviceFeeAmount ?? 0);
  const policyNonRefundable = Number(policy.nonRefundableAmount);
  const refundableBase = computeRefundableBase({
    grossPaid,
    serviceFeeAmount: serviceFee,
    policyNonRefundableAmount: policyNonRefundable,
  });

  let action: "refund" | "credit" | "none" = policy.refundType as any;
  let refundAmount = 0;
  let creditAmount = 0;

  if (action === "refund" || (action as string) === "original") {
    action = "refund";
    refundAmount = refundableBase * (policy ? Number(policy.refundPercent) / 100 : 1);
  } else if (action === "credit") {
    creditAmount = refundableBase * (policy ? Number(policy.creditPercent) / 100 : 1);
  }

  const result: ApplyPolicyResult = { action, policyId: policy?.id ?? null, policyName: policy?.name ?? null };

  if (action === "refund" && refundAmount > 0) {
    if (!payment.providerChargeId) {
      return { action: "none", error: "Cannot issue Stripe refund: charge ID not recorded. Issue a credit instead.", policyId: policy?.id };
    }
    try {
      const stripe = await getUncachableStripeClient();
      const refund = await stripe.refunds.create({
        charge: payment.providerChargeId,
        amount: Math.round(refundAmount * 100),
        reason: "requested_by_customer",
        metadata: { paymentId: String(payment.id), reason: opts.cancellationReason ?? "" },
      });
      result.stripeRefundId = refund.id;
    } catch (e: any) {
      return { action: "none", error: `Stripe refund failed: ${e.message}`, policyId: policy?.id };
    }

    // Atomic CAS — claim compensation slot; if already claimed, abort (Stripe refund will need manual reversal)
    const casRefund = await db.update(paymentsTable)
      .set({ refunded: true, refundAmount: String(refundAmount), refundedAt: new Date(), compensationStatus: "refunded", updatedAt: new Date() } as any)
      .where(and(eq(paymentsTable.id, payment.id), sql`compensation_status IS NULL`))
      .returning();
    if (!casRefund.length) {
      return { action: "none", error: "Payment was concurrently compensated; Stripe refund issued but DB not updated — review manually.", policyId: policy?.id };
    }
    result.refundAmount = refundAmount;
  }

  if (action === "credit" && creditAmount > 0) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (opts.creditExpiryDays ?? 365));

    const [dbUser] = payment.userId
      ? await db.select().from(usersTable).where(eq(usersTable.id, payment.userId))
      : [null];

    if (dbUser) {
      // Atomic CAS — claim compensation slot before inserting credit row
      const casCredit = await db.update(paymentsTable)
        .set({ compensationStatus: "credited", updatedAt: new Date() } as any)
        .where(and(eq(paymentsTable.id, payment.id), sql`compensation_status IS NULL`))
        .returning();
      if (!casCredit.length) {
        return { action: "none", error: "Payment was already compensated by a concurrent request", policyId: policy?.id };
      }

      const [credit] = await db.insert(accountCreditsTable).values({
        userId: dbUser.id,
        amount: String(creditAmount),
        remainingAmount: String(creditAmount),
        currency: payment.currency,
        reason: opts.cancellationReason ?? "cancellation_credit",
        sourceEntityType: payment.entityType,
        sourceEntityId: payment.entityId,
        sourcePaymentId: payment.id,
        expiresAt,
      } as any).returning();
      result.creditId = credit.id;
      result.creditAmount = creditAmount;
    }
  }

  await db.insert(auditLogTable).values({
    actorClerkId: opts.actorClerkId,
    action: "auto_policy_apply",
    entityType: "payment",
    entityId: String(payment.id),
    notes: JSON.stringify({ ...result, reason: opts.cancellationReason, daysUntilEvent: opts.daysUntilEvent }),
  });

  return result;
}

// POST /admin/cancellations/evaluate — evaluate and auto-apply policy for a registration cancellation
router.post("/admin/cancellations/evaluate", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const body = req.body as {
    registrationId: number;
    programType: string;
    eventDate?: string;
    cancellationReason?: string;
    policyIdOverride?: number | null;
    creditExpiryDays?: number;
    dryRun?: boolean;
  };

  if (!body.registrationId || !body.programType) {
    res.status(400).json({ error: "registrationId and programType are required" });
    return;
  }

  // Calculate days until event
  const eventDate = body.eventDate ? new Date(body.eventDate) : new Date();
  const now = new Date();
  const daysUntilEvent = Math.max(0, Math.floor((eventDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

  // Find the most recent paid payment for this registration
  const payments = await db.select().from(paymentsTable)
    .where(and(
      eq(paymentsTable.registrationId, body.registrationId),
      eq(paymentsTable.status, "paid"),
    ))
    .orderBy(desc(paymentsTable.createdAt));

  if (!payments.length) {
    res.status(404).json({ error: "No paid payment found for this registration" });
    return;
  }

  const payment = payments[0];

  // Dry run — just preview the policy without applying
  if (body.dryRun) {
    const policy = body.policyIdOverride != null
      ? (await db.select().from(refundCreditPoliciesTable).where(eq(refundCreditPoliciesTable.id, body.policyIdOverride)).then(r => r[0] ?? null))
      : await findBestPolicy(body.programType, daysUntilEvent);

    const grossPaid = Number(payment.amount);
    const serviceFee = Number((payment as any).serviceFeeAmount ?? 0);
    const policyNonRefundable = policy ? Number(policy.nonRefundableAmount) : 0;
    const refundableBase = computeRefundableBase({ grossPaid, serviceFeeAmount: serviceFee, policyNonRefundableAmount: policyNonRefundable });

    let previewRefundAmount = 0;
    let previewCreditAmount = 0;
    const refundType = policy?.refundType ?? "credit";

    if (refundType === "original" || refundType === "refund") {
      previewRefundAmount = refundableBase * (policy ? Number(policy.refundPercent) / 100 : 1);
    } else if (refundType === "credit") {
      previewCreditAmount = refundableBase * (policy ? Number(policy.creditPercent) / 100 : 1);
    }

    res.json({
      dryRun: true,
      daysUntilEvent,
      policyId: policy?.id ?? null,
      policyName: policy?.name ?? "No matching policy — full refund would apply",
      refundType: policy?.refundType ?? "refund",
      grossPaid,
      nonRefundableAmount: serviceFee + policyNonRefundable,
      refundableBase,
      previewRefundAmount,
      previewCreditAmount,
    });
    return;
  }

  // Actually cancel the registration and apply policy
  const result = await applyPolicy({
    paymentId: payment.id,
    programType: body.programType,
    daysUntilEvent,
    cancellationReason: body.cancellationReason,
    actorClerkId: authed.clerkUserId,
    creditExpiryDays: body.creditExpiryDays,
    policyIdOverride: body.policyIdOverride,
  });

  // Cancel the registration — use explicit status mapping per action to avoid misclassification
  if (!result.error) {
    let paymentStatus: string;
    if (result.action === "refund") paymentStatus = "refunded";
    else if (result.action === "credit") paymentStatus = "credit_issued";
    else paymentStatus = "cancelled"; // action === "none" — no financial change, just cancelled

    await db.update(registrationsTable)
      .set({ status: "cancelled", paymentStatus, updatedAt: new Date() } as any)
      .where(eq(registrationsTable.id, body.registrationId));
  }

  res.json({ daysUntilEvent, paymentId: payment.id, ...result });
});

// POST /admin/cancellations/weather — bulk apply weather-cancellation credit to a program
router.post("/admin/cancellations/weather", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const body = req.body as {
    programType: string;
    programId: number;
    creditAmount?: number;
    creditExpiryDays?: number;
    reason?: string;
  };

  if (!body.programType || !body.programId) {
    res.status(400).json({ error: "programType and programId are required" });
    return;
  }

  // Find all paid payments for this program
  const payments = await db.select().from(paymentsTable)
    .where(and(
      eq(paymentsTable.entityType, body.programType),
      eq(paymentsTable.entityId, body.programId),
      eq(paymentsTable.status, "paid"),
    ));

  if (!payments.length) {
    res.status(404).json({ error: "No paid payments found for this program" });
    return;
  }

  const expiryDays = body.creditExpiryDays ?? 365;
  const issued: any[] = [];

  for (const payment of payments) {
    if (!payment.userId) continue;
    const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.id, payment.userId));
    if (!dbUser) continue;

    // Default credit = refundable portion only (total paid minus non-refundable service fee).
    // Service fee is always retained per policy — never credited back, even for weather cancellations.
    // Admin may pass an explicit creditAmount to override (e.g. partial credit for a single session).
    const serviceFee = Number((payment as any).serviceFeeAmount ?? 0);
    const refundableBase = Math.max(0, Number(payment.amount) - serviceFee);
    const creditAmt = body.creditAmount != null ? Math.min(body.creditAmount, refundableBase) : refundableBase;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiryDays);

    const [credit] = await db.insert(accountCreditsTable).values({
      userId: dbUser.id,
      amount: String(creditAmt),
      remainingAmount: String(creditAmt),
      currency: payment.currency,
      reason: body.reason ?? "weather_cancellation",
      sourceEntityType: payment.entityType,
      sourceEntityId: payment.entityId,
      sourcePaymentId: payment.id,
      expiresAt,
    } as any).returning();

    issued.push({ userId: dbUser.id, creditId: credit.id, creditAmount: creditAmt });
  }

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "weather_cancellation_credits",
    entityType: body.programType,
    entityId: String(body.programId),
    notes: JSON.stringify({ issued: issued.length, reason: body.reason }),
  });

  res.json({ issued: issued.length, credits: issued });
});

// POST /admin/cancellations/dropin — cancel a drop-in spot (or all spots for a pool or session)
//
// Accepts one of:
//   spotId: number    — cancel a single spot
//   poolId: number    — cancel all active spots for a pool
//   dropinId: number  — cancel all active spots across every pool in a session
//
// For each cancelled spot, processes any refund/credit using the existing payment engine and
// auto-promotes the next waitlisted player if the freed spot was not itself a waitlisted entry.
router.post("/admin/cancellations/dropin", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const body = req.body as {
    spotId?: number;
    poolId?: number;
    dropinId?: number;
    cancellationReason?: string;
    policyIdOverride?: number | null;
    creditExpiryDays?: number;
    dryRun?: boolean;
  };

  if (!body.spotId && !body.poolId && !body.dropinId) {
    res.status(400).json({ error: "One of spotId, poolId, or dropinId is required" });
    return;
  }

  // Resolve the set of spots to cancel.
  // All three paths constrain to entityType='dropin' and status='reserved' so that:
  //   - Already-cancelled spots are never re-processed (prevents spurious promotion)
  //   - Non-drop-in spots cannot be inadvertently reached through this endpoint
  let spots: (typeof spotsTable.$inferSelect)[];
  if (body.spotId) {
    const [s] = await db.select().from(spotsTable).where(
      and(
        eq(spotsTable.id, body.spotId),
        eq(spotsTable.entityType, "dropin"),
        eq(spotsTable.status, "reserved"),
      ),
    );
    spots = s ? [s] : [];
  } else if (body.poolId) {
    spots = await db.select().from(spotsTable).where(
      and(
        eq(spotsTable.poolId, body.poolId),
        eq(spotsTable.entityType, "dropin"),
        eq(spotsTable.status, "reserved"),
      ),
    );
  } else {
    spots = await db.select().from(spotsTable).where(
      and(
        eq(spotsTable.entityId, body.dropinId!),
        eq(spotsTable.entityType, "dropin"),
        eq(spotsTable.status, "reserved"),
      ),
    );
  }

  if (!spots.length) {
    res.json({ cancelled: 0, results: [], message: "No active spots found" });
    return;
  }

  if (body.dryRun) {
    res.json({
      dryRun: true,
      spotsFound: spots.length,
      spots: spots.map((s) => ({ id: s.id, userId: s.userId, poolId: s.poolId, waitlisted: s.waitlisted })),
    });
    return;
  }

  const results: any[] = [];

  // Helper: cancel a spot record and apply the matching refund/credit policy to any
  // associated paid payment. Returns the policy result for audit purposes.
  async function cancelSpotWithPolicy(spot: typeof spotsTable.$inferSelect): Promise<ApplyPolicyResult> {
    await db.update(spotsTable)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        cancellationReason: body.cancellationReason ?? null,
        updatedAt: new Date(),
      } as any)
      .where(eq(spotsTable.id, spot.id));

    // Payments for drop-ins use entityType='drop_in' (with underscore); spots use 'dropin'.
    if (!spot.userId) return { action: "none" };

    // Build candidate payer IDs: the player themselves, plus the guardian if one exists.
    // For guardian-paid bookings, stripe webhook writes payment.userId = guardian/payer,
    // while spot.userId = child/player and spot.guardianUserId = guardian/payer.
    const payerIds = [spot.userId];
    if (spot.guardianUserId && spot.guardianUserId !== spot.userId) {
      payerIds.push(spot.guardianUserId);
    }

    const candidates = await db.select().from(paymentsTable)
      .where(
        and(
          eq(paymentsTable.entityType, "drop_in"),
          eq(paymentsTable.entityId, spot.entityId),
          inArray(paymentsTable.userId, payerIds),
          eq(paymentsTable.status, "paid"),
        ),
      )
      .orderBy(desc(paymentsTable.createdAt));

    if (!candidates.length) return { action: "none" };

    // For spot-specific matching, prefer the payment whose metadata.playerUserId
    // matches spot.userId (guardian-pays-for-multiple-children: each spot should
    // compensate its own payment, not always the same latest one). Among matches,
    // pick the first that has not yet been compensated.
    //
    // Selection order:
    //   1. metadata.playerUserId == spot.userId AND compensationStatus IS NULL
    //   2. any candidate with compensationStatus IS NULL (self-paid or missing metadata)
    //
    // This prevents the same already-compensated payment from being selected for
    // subsequent spots, which would silently skip their refunds.
    const matchesPlayer = (p: typeof candidates[number]) => {
      if (!p.metadata) return false;
      try {
        const meta = JSON.parse(p.metadata);
        return meta.playerUserId != null && Number(meta.playerUserId) === spot.userId;
      } catch {
        return false;
      }
    };

    const payment =
      candidates.find((p) => matchesPlayer(p) && p.compensationStatus == null) ??
      candidates.find((p) => p.compensationStatus == null);

    if (!payment) return { action: "none" };

    const [dropin] = await db.select().from(dropinsTable).where(eq(dropinsTable.id, spot.entityId));
    const eventDate = dropin?.startsAt ? new Date(dropin.startsAt) : new Date();
    const now = new Date();
    const daysUntilEvent = Math.max(
      0,
      Math.floor((eventDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
    );

    return applyPolicy({
      paymentId: payment.id,
      programType: "drop_in",
      daysUntilEvent,
      cancellationReason: body.cancellationReason,
      actorClerkId: authed.clerkUserId,
      creditExpiryDays: body.creditExpiryDays,
      policyIdOverride: body.policyIdOverride,
    });
  }

  // Waitlist promotion is scoped to single-spot (spotId) cancellations only.
  //
  // spotId: one confirmed seat is freed → promote the next waitlisted player into the
  //   vacancy. Standard on-cancellation flow (one seat opens, one player fills it).
  //
  // poolId / dropinId: the session/pool is being shut down entirely — "no one plays."
  //   Every spot (confirmed and waitlisted) must end up cancelled. Promoting a
  //   waitlisted player into a confirmed spot and then immediately cancelling them
  //   would send contradictory notifications and leave players confused. Per product
  //   intent, bulk cancellations cancel ALL spots with no promotion.

  for (const spot of spots) {
    const policyResult = await cancelSpotWithPolicy(spot);

    let promotedSpotId: number | null = null;
    if (body.spotId && !spot.waitlisted && spot.poolId) {
      const promoted = await promoteNextWaitlisted(spot.poolId, spot.entityId, authed.clerkUserId).catch(() => null);
      promotedSpotId = promoted?.id ?? null;
    }

    results.push({ spotId: spot.id, userId: spot.userId, policyResult, promotedSpotId });
  }

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "dropin_spots_cancelled",
    entityType: "dropin",
    entityId: String(body.spotId ?? body.poolId ?? body.dropinId),
    notes: JSON.stringify({
      cancelled: results.length,
      reason: body.cancellationReason,
      scope: body.spotId ? "spot" : body.poolId ? "pool" : "session",
    }),
  });

  res.json({ cancelled: results.length, results });
});

export default router;
