/**
 * Memberships — subscription tier management and Stripe recurring billing.
 *
 * Public:
 *   GET  /membership-plans           — list active plans
 *   GET  /memberships/my             — caller's active membership (requireAuth)
 *   POST /memberships/subscribe      — create Stripe subscription (requireAuth)
 *   POST /memberships/cancel         — cancel Stripe subscription (requireAuth)
 *
 * Admin:
 *   GET    /admin/membership-plans       — all plans (requireAdmin)
 *   POST   /admin/membership-plans       — create plan + Stripe product/price (requireSuperAdmin)
 *   PATCH  /admin/membership-plans/:id   — update plan (requireSuperAdmin)
 *   GET    /admin/memberships            — list all user memberships (requireAdmin)
 *   POST   /admin/memberships            — manual grant (requireAdmin)
 *   PATCH  /admin/memberships/:id        — override status / dates (requireAdmin)
 *   DELETE /admin/memberships/:id        — cancel membership (requireAdmin)
 */
import { Router, type IRouter } from "express";
import { db, membershipPlansTable, userMembershipsTable, usersTable, pricingRulesTable, auditLogTable } from "@workspace/db";
import { eq, and, or, isNull, gte } from "drizzle-orm";
import { requireAuth, requireAdmin, requireSuperAdmin, type AuthedRequest } from "../middlewares/auth";
import { getUncachableStripeClient } from "../lib/stripe";

const router: IRouter = Router();

// ── helpers ──────────────────────────────────────────────────────────────────

async function getActiveMembership(userId: number) {
  const today = new Date().toISOString().slice(0, 10);
  const [mem] = await db
    .select()
    .from(userMembershipsTable)
    .where(
      and(
        eq(userMembershipsTable.userId, userId),
        eq(userMembershipsTable.status, "active"),
        // endDate NULL means no expiry; endDate >= today means still within the billing period
        or(isNull(userMembershipsTable.endDate), gte(userMembershipsTable.endDate, today)),
      ),
    )
    .limit(1);
  return mem ?? null;
}

// ── Public: list active plans ─────────────────────────────────────────────────

router.get("/membership-plans", async (_req, res): Promise<void> => {
  const plans = await db
    .select()
    .from(membershipPlansTable)
    .where(eq(membershipPlansTable.isActive, true));
  res.json(plans);
});

// ── Caller's membership status ────────────────────────────────────────────────

router.get("/memberships/my", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const mem = await getActiveMembership(user.id);
  if (!mem) { res.json(null); return; }

  const [plan] = await db.select().from(membershipPlansTable).where(eq(membershipPlansTable.id, mem.planId));
  res.json({ ...mem, plan });
});

// ── Subscribe (create Stripe subscription) ────────────────────────────────────

router.post("/memberships/subscribe", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const { planId, successUrl, cancelUrl } = req.body as {
    planId: number;
    successUrl?: string;
    cancelUrl?: string;
  };
  if (!planId) { res.status(400).json({ error: "planId is required" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const [plan] = await db.select().from(membershipPlansTable).where(eq(membershipPlansTable.id, planId));
  if (!plan || !plan.isActive) { res.status(404).json({ error: "Membership plan not found or inactive" }); return; }

  // Block double-subscription
  const existing = await getActiveMembership(user.id);
  if (existing) {
    res.status(409).json({ error: "You already have an active membership. Cancel it first to switch plans." });
    return;
  }

  const stripe = await getUncachableStripeClient();

  // Ensure Stripe Customer exists
  let stripeCustomerId = (user as any).stripeCustomerId as string | null;
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: [user.firstName, user.lastName].filter(Boolean).join(" ") || undefined,
      metadata: { playonUserId: String(user.id), clerkUserId: user.clerkId },
    });
    stripeCustomerId = customer.id;
    await db.update(usersTable)
      .set({ stripeCustomerId } as any)
      .where(eq(usersTable.id, user.id));
  }

  // Paid plans (price > $0) must have a Stripe Price ID — no free fallback allowed
  const planPrice = Number(plan.price ?? "0");
  if (!plan.stripePriceId && planPrice > 0) {
    res.status(400).json({
      error: "This membership plan is not configured for online payment. Please contact the facility to enroll.",
    });
    return;
  }

  // If the plan has a Stripe Price ID, create an incomplete subscription for embedded checkout
  if (plan.stripePriceId) {
    const subscription = await stripe.subscriptions.create({
      customer: stripeCustomerId,
      items: [{ price: plan.stripePriceId }],
      payment_behavior: "default_incomplete",
      expand: ["latest_invoice.payment_intent"],
      metadata: {
        planId: String(plan.id),
        userId: String(user.id),
        clerkUserId: user.clerkId,
        type: "membership_subscription",
      },
    });

    const invoice = subscription.latest_invoice as any;
    const paymentIntent = invoice?.payment_intent as any;
    const clientSecret = paymentIntent?.client_secret as string | null;

    if (!clientSecret) {
      res.status(500).json({ error: "Failed to retrieve payment intent for subscription" });
      return;
    }

    const { getStripePublishableKey } = await import("../lib/stripe");

    // Pre-create a pending membership so the subscription webhook can activate it
    const today = new Date().toISOString().slice(0, 10);
    await db.insert(userMembershipsTable).values({
      userId: user.id,
      planId: plan.id,
      status: "pending",
      startDate: today,
      providerSubscriptionId: subscription.id,
    } as any);

    res.json({
      clientSecret,
      publishableKey: await getStripePublishableKey(),
      subscriptionId: subscription.id,
      amount: Number(plan.price),
    });
    return;
  }

  // Free plan (price = $0, no Stripe price) — grant immediately without billing
  const today = new Date().toISOString().slice(0, 10);
  const endDate = plan.billingCycle === "annual"
    ? new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10)
    : new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const [membership] = await db.insert(userMembershipsTable).values({
    userId: user.id,
    planId: plan.id,
    status: "active",
    startDate: today,
    endDate,
    renewsAt: endDate,
  } as any).returning();

  await db.insert(auditLogTable).values({
    actorClerkId: user.clerkId,
    action: "membership_granted",
    entityType: "user_membership",
    entityId: String(membership.id),
    notes: `Free membership granted (price = $0) — plan: ${plan.name}`,
  });

  res.status(201).json(membership);
});

// ── Cancel subscription ────────────────────────────────────────────────────────

router.post("/memberships/cancel", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const mem = await getActiveMembership(user.id);
  if (!mem) { res.status(404).json({ error: "No active membership found" }); return; }

  if (mem.providerSubscriptionId) {
    // Stripe subscription — set cancel_at_period_end so the user keeps access
    // through the current billing period. The DB status stays "active" until
    // the `customer.subscription.deleted` webhook fires at period end.
    try {
      const stripe = await getUncachableStripeClient();
      await stripe.subscriptions.update(mem.providerSubscriptionId, { cancel_at_period_end: true });
    } catch (e: any) {
      console.error("Stripe subscription cancel error:", e.message);
      res.status(502).json({ error: "Failed to communicate with billing provider. Please try again." });
      return;
    }

    await db.insert(auditLogTable).values({
      actorClerkId: user.clerkId,
      action: "membership_cancel_scheduled",
      entityType: "user_membership",
      entityId: String(mem.id),
      notes: "User scheduled cancellation — access continues until billing period ends",
    });

    res.json({ message: "Cancellation scheduled. You'll keep full access until your current billing period ends." });
    return;
  }

  // Manual membership (no Stripe) — cancel immediately
  const now = new Date();
  await db.update(userMembershipsTable)
    .set({ status: "cancelled", cancelledAt: now, updatedAt: now } as any)
    .where(eq(userMembershipsTable.id, mem.id));

  await db.insert(auditLogTable).values({
    actorClerkId: user.clerkId,
    action: "membership_cancelled",
    entityType: "user_membership",
    entityId: String(mem.id),
    notes: "User cancelled manual (non-Stripe) membership",
  });

  res.json({ message: "Membership cancelled." });
});

// ── Admin: list all plans ─────────────────────────────────────────────────────

router.get("/admin/membership-plans", requireAdmin, async (_req, res): Promise<void> => {
  const plans = await db.select().from(membershipPlansTable);
  res.json(plans);
});

// ── Admin: create plan (+ optional Stripe Product/Price creation) ─────────────

router.post("/admin/membership-plans", requireSuperAdmin, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const {
    name, description, price, billingCycle = "monthly", trialDays = 0,
    features = [], discountPercent = "0", isActive = true,
    createStripeProduct = false, stripePriceId: providedStripePriceId,
    stripeProductId: providedStripeProductId,
  } = req.body as {
    name: string; description?: string; price: string; billingCycle?: string;
    trialDays?: number; features?: string[]; discountPercent?: string;
    isActive?: boolean; createStripeProduct?: boolean;
    stripePriceId?: string; stripeProductId?: string;
  };

  if (!name || !price) { res.status(400).json({ error: "name and price are required" }); return; }

  // Paid plans must be linked to Stripe — prevent misconfigured paid plans that bypass billing
  const planPriceNum = Number(price);
  if (planPriceNum > 0 && !createStripeProduct && !providedStripePriceId) {
    res.status(400).json({
      error: "Paid plans (price > $0) require a Stripe price. Set createStripeProduct to true or provide stripePriceId.",
    });
    return;
  }

  let stripeProductId: string | null = providedStripeProductId ?? null;
  let stripePriceId: string | null = providedStripePriceId ?? null;

  if (createStripeProduct) {
    const stripe = await getUncachableStripeClient();
    const product = await stripe.products.create({
      name,
      description: description ?? undefined,
      metadata: { source: "playon", billingCycle },
    });
    stripeProductId = product.id;

    const stripePrice = await stripe.prices.create({
      product: product.id,
      unit_amount: Math.round(Number(price) * 100),
      currency: "usd",
      recurring: {
        interval: billingCycle === "annual" ? "year" : "month",
      },
    });
    stripePriceId = stripePrice.id;
  }

  const [plan] = await db.insert(membershipPlansTable).values({
    name, description, price, billingCycle, trialDays, features,
    discountPercent, isActive, stripeProductId, stripePriceId,
  } as any).returning();

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "membership_plan_created",
    entityType: "membership_plan",
    entityId: String(plan.id),
    after: JSON.stringify({ name, price, billingCycle, stripeProductId, stripePriceId }),
  });

  res.status(201).json(plan);
});

// ── Admin: update plan ────────────────────────────────────────────────────────

router.patch("/admin/membership-plans/:id", requireSuperAdmin, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(membershipPlansTable).where(eq(membershipPlansTable.id, id));
  if (!existing) { res.status(404).json({ error: "Plan not found" }); return; }

  const {
    name, description, price, billingCycle, trialDays,
    features, discountPercent, isActive, stripePriceId, stripeProductId,
  } = req.body as Partial<{
    name: string; description: string; price: string; billingCycle: string;
    trialDays: number; features: string[]; discountPercent: string;
    isActive: boolean; stripePriceId: string; stripeProductId: string;
  }>;

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (price !== undefined) updates.price = price;
  if (billingCycle !== undefined) updates.billingCycle = billingCycle;
  if (trialDays !== undefined) updates.trialDays = trialDays;
  if (features !== undefined) updates.features = features;
  if (discountPercent !== undefined) updates.discountPercent = discountPercent;
  if (isActive !== undefined) updates.isActive = isActive;
  if (stripePriceId !== undefined) updates.stripePriceId = stripePriceId;
  if (stripeProductId !== undefined) updates.stripeProductId = stripeProductId;

  const [updated] = await db.update(membershipPlansTable)
    .set(updates as any)
    .where(eq(membershipPlansTable.id, id))
    .returning();

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "membership_plan_updated",
    entityType: "membership_plan",
    entityId: String(id),
    before: JSON.stringify({ name: existing.name, price: existing.price, isActive: existing.isActive }),
    after: JSON.stringify(updates),
  });

  res.json(updated);
});

// ── Admin: list all user memberships ─────────────────────────────────────────

router.get("/admin/memberships", requireAdmin, async (req: any, res): Promise<void> => {
  const statusFilter = req.query.status as string | undefined;
  const planIdFilter = req.query.planId ? parseInt(req.query.planId as string) : undefined;

  let rows = await db
    .select({
      id: userMembershipsTable.id,
      userId: userMembershipsTable.userId,
      planId: userMembershipsTable.planId,
      status: userMembershipsTable.status,
      startDate: userMembershipsTable.startDate,
      endDate: userMembershipsTable.endDate,
      renewsAt: userMembershipsTable.renewsAt,
      cancelledAt: userMembershipsTable.cancelledAt,
      providerSubscriptionId: userMembershipsTable.providerSubscriptionId,
      createdAt: userMembershipsTable.createdAt,
      userEmail: usersTable.email,
      userFirstName: usersTable.firstName,
      userLastName: usersTable.lastName,
      planName: membershipPlansTable.name,
      planBillingCycle: membershipPlansTable.billingCycle,
      planPrice: membershipPlansTable.price,
    })
    .from(userMembershipsTable)
    .innerJoin(usersTable, eq(userMembershipsTable.userId, usersTable.id))
    .innerJoin(membershipPlansTable, eq(userMembershipsTable.planId, membershipPlansTable.id));

  // "active" filter must also enforce date validity — same predicate used everywhere else
  if (statusFilter === "active") {
    const today = new Date().toISOString().slice(0, 10);
    rows = rows.filter((r) => r.status === "active" && (!r.endDate || r.endDate >= today));
  } else if (statusFilter) {
    rows = rows.filter((r) => r.status === statusFilter);
  }
  if (planIdFilter) rows = rows.filter((r) => r.planId === planIdFilter);

  res.json(rows);
});

// ── Admin: manual grant membership ───────────────────────────────────────────

router.post("/admin/memberships", requireSuperAdmin, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const { userId, planId, startDate, endDate, notes } = req.body as {
    userId: number; planId: number; startDate?: string; endDate?: string; notes?: string;
  };
  if (!userId || !planId) { res.status(400).json({ error: "userId and planId are required" }); return; }

  const [plan] = await db.select().from(membershipPlansTable).where(eq(membershipPlansTable.id, planId));
  if (!plan) { res.status(404).json({ error: "Plan not found" }); return; }

  const today = new Date().toISOString().slice(0, 10);
  const computedEnd = plan.billingCycle === "annual"
    ? new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10)
    : new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const [mem] = await db.insert(userMembershipsTable).values({
    userId,
    planId,
    status: "active",
    startDate: startDate ?? today,
    endDate: endDate ?? computedEnd,
    renewsAt: endDate ?? computedEnd,
  } as any).returning();

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "membership_manual_grant",
    entityType: "user_membership",
    entityId: String(mem.id),
    notes: notes ?? `Admin manually granted membership (plan: ${plan.name}) to user ${userId}`,
  });

  res.status(201).json(mem);
});

// ── Admin: override membership status ────────────────────────────────────────

router.patch("/admin/memberships/:id", requireSuperAdmin, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(userMembershipsTable).where(eq(userMembershipsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Membership not found" }); return; }

  const { status, endDate, renewsAt, notes } = req.body as {
    status?: string; endDate?: string; renewsAt?: string; notes?: string;
  };

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (status !== undefined) updates.status = status;
  if (endDate !== undefined) updates.endDate = endDate;
  if (renewsAt !== undefined) updates.renewsAt = renewsAt;
  if (status === "cancelled") updates.cancelledAt = new Date();

  const [updated] = await db.update(userMembershipsTable)
    .set(updates as any)
    .where(eq(userMembershipsTable.id, id))
    .returning();

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "membership_admin_override",
    entityType: "user_membership",
    entityId: String(id),
    before: JSON.stringify({ status: existing.status, endDate: existing.endDate }),
    after: JSON.stringify(updates),
    notes: notes ?? "Admin override",
  });

  res.json(updated);
});

// ── Admin: cancel/delete a membership ────────────────────────────────────────

router.delete("/admin/memberships/:id", requireSuperAdmin, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [mem] = await db.select().from(userMembershipsTable).where(eq(userMembershipsTable.id, id));
  if (!mem) { res.status(404).json({ error: "Membership not found" }); return; }

  // Cancel in Stripe if subscription exists — fail-close: do NOT update DB if Stripe fails
  if (mem.providerSubscriptionId) {
    try {
      const stripe = await getUncachableStripeClient();
      await stripe.subscriptions.cancel(mem.providerSubscriptionId);
    } catch (e: any) {
      console.error("Stripe admin cancel error:", e.message);
      res.status(502).json({
        error: "Failed to cancel the Stripe subscription. The membership has not been modified. Please retry or contact support.",
      });
      return;
    }
  }

  const now = new Date();
  await db.update(userMembershipsTable)
    .set({ status: "cancelled", cancelledAt: now, updatedAt: now } as any)
    .where(eq(userMembershipsTable.id, id));

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "membership_admin_cancelled",
    entityType: "user_membership",
    entityId: String(id),
    notes: `Admin cancelled membership (plan ${mem.planId}) for user ${mem.userId}`,
  });

  res.json({ message: "Membership cancelled" });
});

export default router;
