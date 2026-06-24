import { Router, type IRouter } from "express";
import { db, installmentSchedulesTable, installmentPaymentsTable, paymentsTable, registrationsTable, leagueRegistrationsTable, tournamentRegistrationsTable, usersTable, leaguesTable, tournamentsTable, campsTable, dropinsTable, guardiansTable, campRegistrationsTable } from "@workspace/db";
import { eq, and, lte, sql } from "drizzle-orm";
import { requireAuth, requireSuperAdmin, requirePermission, hasPermission, type AuthedRequest } from "../middlewares/auth";
import { getUncachableStripeClient, getStripePublishableKey } from "../lib/stripe";
import { computeRevenueSplit } from "../services/revenueComputation";
import { computeAuthoritativeTotal } from "../services/pricingPipeline";
import type { Request } from "express";

/**
 * Derive server-authoritative sibling number for camp installment plans.
 * Mirrors the identical function in checkout.ts — kept local to avoid circular imports.
 */
async function deriveSiblingNumber(
  guardianDbUserId: number,
  campId: number,
  playerDbUserId: number | null,
): Promise<number> {
  const guardianLinks = await db
    .select({ youthUserId: guardiansTable.youthUserId })
    .from(guardiansTable)
    .where(and(
      eq(guardiansTable.guardianUserId, guardianDbUserId),
      eq(guardiansTable.status, "approved"),
      eq(guardiansTable.canRegister, true),
    ));

  if (guardianLinks.length === 0) return 1;

  const siblingUserIds = guardianLinks.map(g => g.youthUserId);

  const whereConditions: any[] = [
    eq(campRegistrationsTable.campId, campId),
    sql`${campRegistrationsTable.playerUserId} = ANY(ARRAY[${sql.join(siblingUserIds.map(id => sql`${id}::int`), sql`, `)}])`,
    sql`${campRegistrationsTable.status} IN ('confirmed', 'pending')`,
  ];
  if (playerDbUserId != null) {
    whereConditions.push(sql`${campRegistrationsTable.playerUserId} != ${playerDbUserId}`);
  }

  const priorRows = await db
    .select({ id: campRegistrationsTable.id })
    .from(campRegistrationsTable)
    .where(and(...whereConditions));

  return priorRows.length + 1;
}

const router: IRouter = Router();

router.post("/checkout/installment-plan", requireAuth, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const body = req.body as {
    programType: string;
    programId: number;
    registrationId?: number;
    installmentCount: number;
    /** Optional discount/promo code — validated and applied server-side, same as normal checkout. */
    discountCode?: string;
    /** DB user id of the camper (youth) — used for server-side sibling discount derivation. Camps only. */
    playerUserId?: number;
    firstDueDate?: string;
    intervalDays?: number;
    successUrl?: string;
    cancelUrl?: string;
  };

  if (!body.programType || !body.programId || !body.installmentCount) {
    res.status(400).json({ error: "programType, programId, and installmentCount are required" });
    return;
  }
  if (body.installmentCount < 2 || body.installmentCount > 12) {
    res.status(400).json({ error: "installmentCount must be between 2 and 12" });
    return;
  }

  const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!dbUser) { res.status(404).json({ error: "User not found" }); return; }

  // Verify the caller owns the registration they're setting up payments for
  if (body.registrationId != null) {
    const [reg] = await db.select().from(registrationsTable).where(eq(registrationsTable.id, body.registrationId));
    if (!reg) { res.status(404).json({ error: "Registration not found" }); return; }
    if (reg.userId !== authed.clerkUserId) {
      res.status(403).json({ error: "You do not have access to this registration" }); return;
    }
  }

  // Compute authoritative total using the SAME pricing pipeline as POST /checkout/session:
  // base offering price → PricingRule modifiers (early-bird, late fee, sibling) → discount code.
  // This ensures installment plans charge the identical total as a normal checkout session.
  // Client-supplied totalAmount is never trusted. Sibling number is derived server-side.
  let serverSiblingNumber = 1;
  if (body.programType === "camp") {
    const playerDbUserId = body.playerUserId != null ? body.playerUserId : dbUser.id;
    serverSiblingNumber = await deriveSiblingNumber(dbUser.id, body.programId, playerDbUserId);
  }

  let pricing: Awaited<ReturnType<typeof computeAuthoritativeTotal>>;
  try {
    pricing = await computeAuthoritativeTotal({
      programType: body.programType,
      programId: body.programId,
      discountCode: body.discountCode,
      serverSiblingNumber,
    });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
    return;
  }
  const totalAmount = pricing.finalPrice;
  if (totalAmount <= 0) {
    res.status(400).json({ error: "This offering has no price configured" });
    return;
  }
  const count = body.installmentCount;
  const installmentAmount = Math.round((totalAmount / count) * 100) / 100;
  const intervalDays = body.intervalDays ?? 30;
  const firstDueDate = body.firstDueDate ? new Date(body.firstDueDate) : new Date();

  // Create schedule
  const [schedule] = await db.insert(installmentSchedulesTable).values({
    userId: dbUser.id,
    entityType: body.programType,
    entityId: body.programId,
    registrationId: body.registrationId ?? null,
    totalAmount: String(totalAmount),
    paidAmount: "0",
    installmentCount: count,
    status: "active",
  } as any).returning();

  // Create payment milestone rows
  const milestones: any[] = [];
  for (let i = 1; i <= count; i++) {
    const dueDate = new Date(firstDueDate);
    dueDate.setDate(dueDate.getDate() + (i - 1) * intervalDays);
    const amt = i === count
      ? Math.round((totalAmount - installmentAmount * (count - 1)) * 100) / 100
      : installmentAmount;
    milestones.push({
      scheduleId: schedule.id,
      installmentNumber: i,
      amount: String(amt),
      dueDate,
      status: "pending",
    });
  }
  await db.insert(installmentPaymentsTable).values(milestones as any);

  // Create Checkout Session for installment #1 (embedded checkout — no redirect)
  const firstInstallment = milestones[0];
  const split = await computeRevenueSplit({
    entityType: body.programType,
    entityId: body.programId,
    category: body.programType,
    grossAmount: Number(firstInstallment.amount),
    paymentMethod: "card",
  });

  const totalCharge = Math.round((Number(firstInstallment.amount) + split.serviceFeeAmount) * 100);
  const stripe = await getUncachableStripeClient();

  const installMeta = {
    clerkUserId: authed.clerkUserId,
    programType: body.programType,
    programId: String(body.programId),
    registrationId: body.registrationId != null ? String(body.registrationId) : "",
    scheduleId: String(schedule.id),
    installmentNumber: "1",
    basePrice: String(firstInstallment.amount),
    serviceFeeAmount: String(split.serviceFeeAmount),
    category: body.programType,
  };

  const installOrigin = (req.headers.origin ?? req.headers.referer ?? "https://playon.replit.app").replace(/\/$/, "");
  const session = await (stripe.checkout.sessions.create as any)({
    mode: "payment",
    ui_mode: "custom",
    return_url: `${installOrigin}/checkout/complete?session_id={CHECKOUT_SESSION_ID}`,
    line_items: [{
      price_data: {
        currency: "usd",
        product_data: { name: `${body.programType} — installment 1 of ${count}` },
        unit_amount: totalCharge,
      },
      quantity: 1,
    }],
    metadata: installMeta,
    customer_email: dbUser.email ?? undefined,
    payment_intent_data: {
      receipt_email: dbUser.email ?? undefined,
      metadata: installMeta,
    },
  });

  const clientSecret = session.client_secret as string;
  if (!clientSecret) throw new Error("Checkout session did not return a client secret");

  await db.insert(paymentsTable).values({
    userId: dbUser.id,
    entityType: body.programType,
    entityId: body.programId,
    registrationId: body.registrationId ?? null,
    amount: String(Number(firstInstallment.amount) + split.serviceFeeAmount),
    currency: "usd",
    status: "pending",
    provider: "stripe",
    providerPaymentId: session.id,
    paymentMethod: "card",
    serviceFeeAmount: String(split.serviceFeeAmount),
    metadata: JSON.stringify({ checkoutSessionId: session.id, scheduleId: schedule.id, installmentNumber: 1 }),
  } as any);

  res.json({
    scheduleId: schedule.id,
    installmentCount: count,
    firstAmount: firstInstallment.amount,
    clientSecret,
    checkoutSessionId: session.id,
    publishableKey: await getStripePublishableKey(),
    amount: Number(firstInstallment.amount) + split.serviceFeeAmount,
  });
});

// GET /installments/my — list the current user's installment schedules
router.get("/installments/my", requireAuth, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!dbUser) { res.json([]); return; }

  const schedules = await db.select().from(installmentSchedulesTable)
    .where(eq(installmentSchedulesTable.userId, dbUser.id));

  const result = await Promise.all(schedules.map(async (s) => {
    const payments = await db.select().from(installmentPaymentsTable)
      .where(eq(installmentPaymentsTable.scheduleId, s.id));
    return { ...s, payments };
  }));

  res.json(result);
});

// GET /admin/installments — list all installment schedules (admin)
router.get("/admin/installments", requirePermission("canViewReports"), async (req, res): Promise<void> => {
  const { status, entityType } = req.query as Record<string, string>;
  let query = db.select().from(installmentSchedulesTable).$dynamic();
  const conditions: any[] = [];
  if (status) conditions.push(eq(installmentSchedulesTable.status, status));
  if (entityType) conditions.push(eq(installmentSchedulesTable.entityType, entityType));
  if (conditions.length) query = query.where(and(...conditions));
  const schedules = await query;

  const result = await Promise.all(schedules.map(async (s) => {
    const payments = await db.select().from(installmentPaymentsTable)
      .where(eq(installmentPaymentsTable.scheduleId, s.id));
    return { ...s, payments };
  }));

  res.json(result);
});

// POST /admin/installments/:scheduleId/pay-next — admin triggers next installment checkout for a player
router.post("/admin/installments/:scheduleId/pay-next", requirePermission("canManageLeagues"), async (req: Request, res): Promise<void> => {
  const scheduleId = Number(req.params.scheduleId);
  if (isNaN(scheduleId)) { res.status(400).json({ error: "Invalid scheduleId" }); return; }

  const [schedule] = await db.select().from(installmentSchedulesTable).where(eq(installmentSchedulesTable.id, scheduleId));
  if (!schedule) { res.status(404).json({ error: "Schedule not found" }); return; }

  const payments = await db.select().from(installmentPaymentsTable)
    .where(and(eq(installmentPaymentsTable.scheduleId, scheduleId), eq(installmentPaymentsTable.status, "pending")));
  if (!payments.length) { res.status(400).json({ error: "No pending installments remaining" }); return; }

  const next = payments.sort((a, b) => a.installmentNumber - b.installmentNumber)[0];
  const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.id, schedule.userId));
  if (!dbUser) { res.status(404).json({ error: "User not found" }); return; }

  const split = await computeRevenueSplit({
    entityType: schedule.entityType,
    entityId: schedule.entityId,
    category: schedule.entityType,
    grossAmount: Number(next.amount),
    paymentMethod: "card",
  });

  const stripe = await getUncachableStripeClient();
  const totalCharge = Math.round((Number(next.amount) + split.serviceFeeAmount) * 100);

  const nextMeta = {
    clerkUserId: dbUser.clerkId,
    programType: schedule.entityType,
    programId: String(schedule.entityId),
    registrationId: schedule.registrationId != null ? String(schedule.registrationId) : "",
    scheduleId: String(schedule.id),
    installmentNumber: String(next.installmentNumber),
    basePrice: String(next.amount),
    serviceFeeAmount: String(split.serviceFeeAmount),
    category: schedule.entityType,
  };

  const nextOrigin = (req.headers.origin ?? req.headers.referer ?? "https://playon.replit.app").replace(/\/$/, "");
  const session = await (stripe.checkout.sessions.create as any)({
    mode: "payment",
    ui_mode: "custom",
    return_url: `${nextOrigin}/checkout/complete?session_id={CHECKOUT_SESSION_ID}`,
    line_items: [{
      price_data: {
        currency: "usd",
        product_data: { name: `${schedule.entityType} — installment ${next.installmentNumber}` },
        unit_amount: totalCharge,
      },
      quantity: 1,
    }],
    metadata: nextMeta,
    customer_email: dbUser.email ?? undefined,
    payment_intent_data: {
      receipt_email: dbUser.email ?? undefined,
      metadata: nextMeta,
    },
  });

  const clientSecret = session.client_secret as string;
  if (!clientSecret) throw new Error("Checkout session did not return a client secret");

  await db.insert(paymentsTable).values({
    userId: dbUser.id,
    entityType: schedule.entityType,
    entityId: schedule.entityId,
    registrationId: schedule.registrationId ?? null,
    amount: String(Number(next.amount) + split.serviceFeeAmount),
    currency: "usd",
    status: "pending",
    provider: "stripe",
    providerPaymentId: session.id,
    paymentMethod: "card",
    serviceFeeAmount: String(split.serviceFeeAmount),
    metadata: JSON.stringify({ checkoutSessionId: session.id, scheduleId: schedule.id, installmentNumber: next.installmentNumber }),
  } as any);

  res.json({
    clientSecret,
    checkoutSessionId: session.id,
    publishableKey: await getStripePublishableKey(),
    amount: Number(next.amount) + split.serviceFeeAmount,
  });
});

// POST /admin/installments/check-overdue — enforce play blocks for overdue installments
router.post("/admin/installments/check-overdue", requirePermission("canManageLeagues"), async (_req, res): Promise<void> => {
  const now = new Date();
  const overduePayments = await db.select().from(installmentPaymentsTable)
    .where(and(
      eq(installmentPaymentsTable.status, "pending"),
      lte(installmentPaymentsTable.dueDate, now),
    ));

  const blocked: number[] = [];
  for (const ip of overduePayments) {
    const [schedule] = await db.select().from(installmentSchedulesTable).where(eq(installmentSchedulesTable.id, ip.scheduleId));
    if (!schedule || schedule.status !== "active") continue;
    if (schedule.registrationId && schedule.entityType === "league") {
      const [lr] = await db.select().from(leagueRegistrationsTable).where(eq(leagueRegistrationsTable.id, schedule.registrationId));
      if (lr && !lr.balanceOverriddenByAdmin && !lr.playBlocked) {
        await db.update(leagueRegistrationsTable)
          .set({ playBlocked: true, updatedAt: new Date() } as any)
          .where(eq(leagueRegistrationsTable.id, lr.id));
        blocked.push(lr.id);
      }
    } else if (schedule.registrationId && schedule.entityType === "tournament") {
      const [tr] = await db.select().from(tournamentRegistrationsTable).where(eq(tournamentRegistrationsTable.id, schedule.registrationId));
      if (tr && !tr.balanceOverriddenByAdmin && !tr.playBlocked) {
        await db.update(tournamentRegistrationsTable)
          .set({ playBlocked: true, updatedAt: new Date() } as any)
          .where(eq(tournamentRegistrationsTable.id, tr.id));
        blocked.push(tr.id);
      }
    }
  }

  res.json({ checked: overduePayments.length, blocked: blocked.length, blockedIds: blocked });
});

export default router;
