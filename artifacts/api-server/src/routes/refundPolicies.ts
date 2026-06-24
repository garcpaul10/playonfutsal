import { Router, type IRouter } from "express";
import { db, refundCreditPoliciesTable, accountCreditsTable, paymentsTable, registrationsTable, auditLogTable, usersTable } from "@workspace/db";
import { eq, desc, and, isNull, sql } from "drizzle-orm";
import { requireSuperAdmin, requirePermission, type AuthedRequest } from "../middlewares/auth";
import { getUncachableStripeClient } from "../lib/stripe";
import { computeRefundableBase } from "../lib/refundUtils";
import type { Request } from "express";

const router: IRouter = Router();

// GET /admin/refund-policies — list all refund/credit policies
router.get("/admin/refund-policies", requirePermission("canViewReports"), async (_req, res): Promise<void> => {
  const policies = await db.select().from(refundCreditPoliciesTable)
    .orderBy(desc(refundCreditPoliciesTable.createdAt));
  res.json(policies);
});

// POST /admin/refund-policies — create a policy
router.post("/admin/refund-policies", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const body = req.body as Record<string, unknown>;

  if (!body.name || !body.refundType) {
    res.status(400).json({ error: "name and refundType are required" });
    return;
  }

  if (!["credit", "original", "none"].includes(body.refundType as string)) {
    res.status(400).json({ error: "refundType must be credit, original, or none" });
    return;
  }

  const [policy] = await db.insert(refundCreditPoliciesTable).values({
    name: body.name as string,
    entityType: (body.entityType as string) ?? "all",
    refundType: body.refundType as string,
    windowDays: body.windowDays != null ? Number(body.windowDays) : 7,
    windowMinutes: body.windowMinutes != null ? Number(body.windowMinutes) : null,
    refundPercent: body.refundPercent != null ? String(body.refundPercent) : "100.00",
    creditPercent: body.creditPercent != null ? String(body.creditPercent) : "100.00",
    nonRefundableAmount: body.nonRefundableAmount != null ? String(body.nonRefundableAmount) : "0",
    allowPartialRefund: body.allowPartialRefund !== false,
    requiresAdminApproval: body.requiresAdminApproval === true,
    notes: (body.notes as string) ?? null,
    isActive: true,
  } as any).returning();

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "create",
    entityType: "refund_credit_policy",
    entityId: String(policy.id),
    after: JSON.stringify(policy),
  });

  res.status(201).json(policy);
});

// PATCH /admin/refund-policies/:id — update a policy
router.patch("/admin/refund-policies/:id", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(refundCreditPoliciesTable).where(eq(refundCreditPoliciesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Policy not found" }); return; }

  const body = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (body.name !== undefined) updates.name = body.name;
  if (body.entityType !== undefined) updates.entityType = body.entityType;
  if (body.refundType !== undefined) updates.refundType = body.refundType;
  if (body.windowDays !== undefined) updates.windowDays = Number(body.windowDays);
  if (body.windowMinutes !== undefined) updates.windowMinutes = body.windowMinutes != null ? Number(body.windowMinutes) : null;
  if (body.refundPercent !== undefined) updates.refundPercent = String(body.refundPercent);
  if (body.creditPercent !== undefined) updates.creditPercent = String(body.creditPercent);
  if (body.nonRefundableAmount !== undefined) updates.nonRefundableAmount = String(body.nonRefundableAmount);
  if (body.allowPartialRefund !== undefined) updates.allowPartialRefund = body.allowPartialRefund;
  if (body.requiresAdminApproval !== undefined) updates.requiresAdminApproval = body.requiresAdminApproval;
  if (body.notes !== undefined) updates.notes = body.notes;
  if (body.isActive !== undefined) updates.isActive = body.isActive;

  const [updated] = await db.update(refundCreditPoliciesTable)
    .set(updates as any)
    .where(eq(refundCreditPoliciesTable.id, id))
    .returning();

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "update",
    entityType: "refund_credit_policy",
    entityId: String(id),
    before: JSON.stringify(existing),
    after: JSON.stringify(updated),
  });

  res.json(updated);
});

// DELETE /admin/refund-policies/:id — deactivate
router.delete("/admin/refund-policies/:id", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(refundCreditPoliciesTable).where(eq(refundCreditPoliciesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Policy not found" }); return; }

  await db.update(refundCreditPoliciesTable)
    .set({ isActive: false, updatedAt: new Date() } as any)
    .where(eq(refundCreditPoliciesTable.id, id));

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "deactivate",
    entityType: "refund_credit_policy",
    entityId: String(id),
  });

  res.sendStatus(204);
});

// POST /admin/refunds/apply — apply a refund/credit policy to a payment
router.post("/admin/refunds/apply", requirePermission("canProcessRefunds"), async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const body = req.body as {
    paymentId?: number;
    policyId?: number;
    reason?: string;
    overrideAmount?: number;
    issueCredit?: boolean;
    creditExpiryDays?: number;
  };

  if (!body.paymentId) {
    res.status(400).json({ error: "paymentId is required" });
    return;
  }

  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, body.paymentId));
  if (!payment) { res.status(404).json({ error: "Payment not found" }); return; }
  if ((payment as any).compensationStatus != null) {
    res.status(409).json({ error: `Payment already compensated: ${(payment as any).compensationStatus}` });
    return;
  }
  if (payment.status !== "paid") { res.status(400).json({ error: "Payment is not in paid status" }); return; }

  let policy: typeof refundCreditPoliciesTable.$inferSelect | null = null;
  if (body.policyId) {
    const [p] = await db.select().from(refundCreditPoliciesTable).where(eq(refundCreditPoliciesTable.id, body.policyId));
    policy = p ?? null;
  }

  const grossPaid = Number(payment.amount);
  // Service fee is ALWAYS non-refundable (stored per-payment), plus any additional policy-level floor
  const serviceFeeNR = Number((payment as any).serviceFeeAmount ?? 0);
  const policyNR = policy ? Number(policy.nonRefundableAmount) : 0;
  const refundableBase = computeRefundableBase({ grossPaid, serviceFeeAmount: serviceFeeNR, policyNonRefundableAmount: policyNR });

  let refundAmount = 0;
  let creditAmount = 0;
  let action: "refund" | "credit" | "none" = "none";

  if (body.overrideAmount != null) {
    refundAmount = Math.min(body.overrideAmount, refundableBase);
    action = "refund";
  } else if (policy) {
    if (policy.refundType === "original") {
      refundAmount = refundableBase * (Number(policy.refundPercent) / 100);
      action = "refund";
    } else if (policy.refundType === "credit") {
      creditAmount = refundableBase * (Number(policy.creditPercent) / 100);
      action = "credit";
    }
  } else {
    refundAmount = refundableBase;
    action = "refund";
  }

  const results: Record<string, unknown> = { action, paymentId: payment.id };

  // Issue Stripe refund — must succeed before we update DB state
  if (action === "refund" && refundAmount > 0) {
    if (!payment.providerChargeId) {
      res.status(422).json({
        error: "Cannot issue Stripe refund: charge ID not recorded on this payment. " +
          "This payment may have been created before charge tracking was added, or is an external/manual payment. " +
          "Use the admin to issue a manual account credit instead.",
      });
      return;
    }
    try {
      const stripe = await getUncachableStripeClient();
      const refund = await stripe.refunds.create({
        charge: payment.providerChargeId,
        amount: Math.round(refundAmount * 100),
        reason: "requested_by_customer",
        metadata: { paymentId: String(payment.id), reason: body.reason ?? "" },
      });
      results.stripeRefundId = refund.id;
    } catch (e: any) {
      // Stripe refund failed — do NOT update DB state
      res.status(502).json({
        error: `Stripe refund failed: ${e.message}. No changes were made.`,
        stripeCode: e.code,
      });
      return;
    }

    // Atomic CAS — only mark compensated if compensation_status IS NULL (idempotency guard)
    const casUpdated = await db.update(paymentsTable)
      .set({
        refunded: true,
        refundAmount: String(refundAmount),
        refundedAt: new Date(),
        compensationStatus: "refunded",
        updatedAt: new Date(),
      } as any)
      .where(and(eq(paymentsTable.id, payment.id), sql`compensation_status IS NULL`))
      .returning();
    if (!casUpdated.length) {
      res.status(409).json({ error: "Payment was already compensated by a concurrent request" });
      return;
    }
    results.refundAmount = refundAmount;

    // Update registration payment status if linked
    if (payment.registrationId) {
      await db.update(registrationsTable)
        .set({ paymentStatus: "refunded", updatedAt: new Date() } as any)
        .where(eq(registrationsTable.id, payment.registrationId));
    }
  }

  // Create account credit record (no Stripe call needed for credits)
  if (action === "credit" && creditAmount > 0) {
    const expiryDays = body.creditExpiryDays ?? 365;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiryDays);

    const [dbUser] = payment.userId
      ? await db.select().from(usersTable).where(eq(usersTable.id, payment.userId))
      : [null];

    if (!dbUser) {
      res.status(422).json({ error: "Cannot issue credit: user account not found for this payment" });
      return;
    }

    // Atomic CAS — claim compensation slot before inserting credit row
    const casCredited = await db.update(paymentsTable)
      .set({ compensationStatus: "credited", updatedAt: new Date() } as any)
      .where(and(eq(paymentsTable.id, payment.id), sql`compensation_status IS NULL`))
      .returning();
    if (!casCredited.length) {
      res.status(409).json({ error: "Payment was already compensated by a concurrent request" });
      return;
    }

    const [credit] = await db.insert(accountCreditsTable).values({
      userId: dbUser.id,
      amount: String(creditAmount),
      remainingAmount: String(creditAmount),
      currency: payment.currency,
      reason: body.reason ?? "refund_credit",
      sourceEntityType: payment.entityType,
      sourceEntityId: payment.entityId,
      sourcePaymentId: payment.id,
      expiresAt,
    } as any).returning();
    results.creditId = credit.id;
    results.creditAmount = creditAmount;
  }

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "refund",
    entityType: "payment",
    entityId: String(payment.id),
    notes: JSON.stringify({ ...results, reason: body.reason }),
  });

  res.json(results);
});

// POST /admin/refunds/external — mark a registration as paid externally
router.post("/admin/refunds/external", requirePermission("canProcessRefunds"), async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const body = req.body as {
    registrationId?: number;
    amount?: number;
    method?: string;
    notes?: string;
  };

  if (!body.registrationId || body.amount == null) {
    res.status(400).json({ error: "registrationId and amount are required" });
    return;
  }

  const [reg] = await db.select().from(registrationsTable).where(eq(registrationsTable.id, body.registrationId));
  if (!reg) { res.status(404).json({ error: "Registration not found" }); return; }

  const [dbUser] = reg.userId
    ? await db.select().from(usersTable).where(eq(usersTable.clerkId, reg.userId))
    : [null];

  const [payment] = await db.insert(paymentsTable).values({
    userId: dbUser?.id ?? null,
    entityType: reg.programType,
    entityId: reg.programId,
    registrationId: reg.id,
    amount: String(body.amount),
    currency: "usd",
    status: "paid",
    provider: "external",
    paymentMethod: body.method ?? "cash",
    metadata: JSON.stringify({ notes: body.notes }),
  } as any).returning();

  await db.update(registrationsTable)
    .set({
      paymentStatus: "paid_external",
      amountPaid: String(body.amount),
      updatedAt: new Date(),
    } as any)
    .where(eq(registrationsTable.id, reg.id));

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "mark_paid_external",
    entityType: "registration",
    entityId: String(reg.id),
    notes: `Method: ${body.method ?? "cash"}, Amount: $${body.amount}. ${body.notes ?? ""}`,
  });

  res.status(201).json(payment);
});

export default router;
