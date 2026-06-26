import { Router, type IRouter } from "express";
import { db, leagueRegistrationsTable, tournamentRegistrationsTable, leaguesTable, tournamentsTable, usersTable, fixturesTable, paymentsTable } from "@workspace/db";
import { eq, and, lte, lt, sql } from "drizzle-orm";
import { requireAuth, requireSuperAdmin, requirePermission, type AuthedRequest } from "../middlewares/auth";
import { getUncachableStripeClient, getStripePublishableKey } from "../lib/stripe";
import { computeRevenueSplit } from "../services/revenueComputation";
import type { Request } from "express";

const router: IRouter = Router();

// GET /admin/deposits/outstanding — league/tournament registrations with unpaid deposits or balances
router.get("/admin/deposits/outstanding", requirePermission("canViewReports"), async (req, res): Promise<void> => {
  const { type } = req.query as Record<string, string>;

  const results: any[] = [];

  if (!type || type === "league") {
    const rows = await db.select({
      id: leagueRegistrationsTable.id,
      leagueId: leagueRegistrationsTable.leagueId,
      teamId: leagueRegistrationsTable.teamId,
      registeredByUserId: leagueRegistrationsTable.registeredByUserId,
      depositAmount: leagueRegistrationsTable.depositAmount,
      depositPaid: leagueRegistrationsTable.depositPaid,
      totalAmount: leagueRegistrationsTable.totalAmount,
      amountPaid: leagueRegistrationsTable.amountPaid,
      balanceDue: leagueRegistrationsTable.balanceDue,
      balanceDueDate: leagueRegistrationsTable.balanceDueDate,
      paymentStatus: leagueRegistrationsTable.paymentStatus,
      playBlocked: leagueRegistrationsTable.playBlocked,
      balanceOverriddenByAdmin: leagueRegistrationsTable.balanceOverriddenByAdmin,
    }).from(leagueRegistrationsTable)
      .where(and(
        eq(leagueRegistrationsTable.status, "active"),
        sql`${leagueRegistrationsTable.balanceDue} > 0`,
      ));
    for (const row of rows) {
      const [league] = await db.select({ name: leaguesTable.name }).from(leaguesTable).where(eq(leaguesTable.id, row.leagueId));
      results.push({ ...row, offeringType: "league", offeringName: league?.name ?? `League #${row.leagueId}` });
    }
  }

  if (!type || type === "tournament") {
    const rows = await db.select({
      id: tournamentRegistrationsTable.id,
      tournamentId: tournamentRegistrationsTable.tournamentId,
      teamId: tournamentRegistrationsTable.teamId,
      depositAmount: tournamentRegistrationsTable.depositAmount,
      depositPaid: tournamentRegistrationsTable.depositPaid,
      totalAmount: tournamentRegistrationsTable.totalAmount,
      amountPaid: tournamentRegistrationsTable.amountPaid,
      balanceDueDate: tournamentRegistrationsTable.balanceDueDate,
      paymentStatus: tournamentRegistrationsTable.paymentStatus,
      playBlocked: tournamentRegistrationsTable.playBlocked,
      balanceOverriddenByAdmin: tournamentRegistrationsTable.balanceOverriddenByAdmin,
    }).from(tournamentRegistrationsTable)
      .where(and(
        eq(tournamentRegistrationsTable.status, "active"),
        sql`${tournamentRegistrationsTable.totalAmount} > ${tournamentRegistrationsTable.amountPaid}`,
      ));
    for (const row of rows) {
      const [tourney] = await db.select({ name: tournamentsTable.name }).from(tournamentsTable).where(eq(tournamentsTable.id, row.tournamentId));
      const balanceDue = Number(row.totalAmount) - Number(row.amountPaid);
      results.push({ ...row, offeringType: "tournament", offeringName: tourney?.name ?? `Tournament #${row.tournamentId}`, balanceDue });
    }
  }

  res.json(results);
});

// POST /checkout/deposit — create a Stripe session for a deposit payment (league or tournament)
router.post("/checkout/deposit", requireAuth, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const body = req.body as {
    offeringType: "league" | "tournament";
    registrationId: number;
    payBalance?: boolean;
    successUrl?: string;
    cancelUrl?: string;
  };

  if (!body.offeringType || !body.registrationId) {
    res.status(400).json({ error: "offeringType and registrationId are required" });
    return;
  }

  const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!dbUser) { res.status(404).json({ error: "User not found" }); return; }

  let depositAmount = 0;
  let balanceDue = 0;
  let offeringName = "";
  let programId = 0;
  let programType = body.offeringType;

  if (body.offeringType === "league") {
    const [reg] = await db.select().from(leagueRegistrationsTable).where(eq(leagueRegistrationsTable.id, body.registrationId));
    if (!reg) { res.status(404).json({ error: "League registration not found" }); return; }
    if (reg.registeredByUserId !== authed.clerkUserId) {
      res.status(403).json({ error: "You do not have access to this registration" }); return;
    }
    depositAmount = Number(reg.depositAmount);
    balanceDue = Number(reg.balanceDue);
    programId = reg.leagueId;
    const [l] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, reg.leagueId));
    offeringName = l?.name ?? `League #${reg.leagueId}`;
  } else {
    const [reg] = await db.select().from(tournamentRegistrationsTable).where(eq(tournamentRegistrationsTable.id, body.registrationId));
    if (!reg) { res.status(404).json({ error: "Tournament registration not found" }); return; }
    if (reg.registeredByUserId !== dbUser.id) {
      res.status(403).json({ error: "You do not have access to this registration" }); return;
    }
    depositAmount = Number(reg.depositAmount);
    balanceDue = Number(reg.totalAmount) - Number(reg.amountPaid);
    programId = reg.tournamentId;
    const [t] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, reg.tournamentId));
    offeringName = t?.name ?? `Tournament #${reg.tournamentId}`;
  }

  const chargeAmount = body.payBalance ? balanceDue : depositAmount;
  const label = body.payBalance ? "Balance due" : "Deposit";

  if (chargeAmount <= 0) {
    res.status(400).json({ error: `${label} is zero — nothing to charge` });
    return;
  }

  const split = await computeRevenueSplit({
    entityType: programType,
    entityId: programId,
    category: programType,
    grossAmount: chargeAmount,
    paymentMethod: "card",
  });

  const stripe = await getUncachableStripeClient();
  const totalCharge = Math.round((chargeAmount + split.serviceFeeAmount) * 100);

  const depMeta = {
    clerkUserId: authed.clerkUserId,
    programType,
    programId: String(programId),
    registrationId: String(body.registrationId),
    depositFor: `${body.offeringType}_registration`,
    depositRegistrationId: String(body.registrationId),
    depositType: body.payBalance ? "balance" : "deposit",
    basePrice: String(chargeAmount),
    serviceFeeAmount: String(split.serviceFeeAmount),
    category: programType,
  };

  const depOrigin = (req.headers.origin ?? req.headers.referer ?? "https://playonfutsal.vercel.app").replace(/\/$/, "");
  const session = await (stripe.checkout.sessions.create as any)({
    mode: "payment",
    ui_mode: "custom",
    return_url: `${depOrigin}/checkout/complete?session_id={CHECKOUT_SESSION_ID}`,
    line_items: [{
      price_data: {
        currency: "usd",
        product_data: { name: label },
        unit_amount: totalCharge,
      },
      quantity: 1,
    }],
    metadata: depMeta,
    customer_email: dbUser.email ?? undefined,
    payment_intent_data: {
      receipt_email: dbUser.email ?? undefined,
      metadata: depMeta,
    },
  });

  const clientSecret = session.client_secret as string;
  if (!clientSecret) throw new Error("Checkout session did not return a client secret");

  await db.insert(paymentsTable).values({
    userId: dbUser.id,
    entityType: programType,
    entityId: programId,
    amount: String(chargeAmount + split.serviceFeeAmount),
    currency: "usd",
    status: "pending",
    provider: "stripe",
    providerPaymentId: session.id,
    paymentMethod: "card",
    serviceFeeAmount: String(split.serviceFeeAmount),
    metadata: JSON.stringify({ checkoutSessionId: session.id, registrationId: body.registrationId, label }),
  } as any);

  res.json({
    clientSecret,
    checkoutSessionId: session.id,
    publishableKey: await getStripePublishableKey(),
    amount: chargeAmount + split.serviceFeeAmount,
  });
});

// POST /admin/deposits/enforce-play-blocks — check balance due dates and block teams
router.post("/admin/deposits/enforce-play-blocks", requirePermission("canManageLeagues"), async (_req, res): Promise<void> => {
  const now = new Date();
  let blocked = 0;
  let alreadyBlocked = 0;
  const details: any[] = [];

  // League registrations: balance due date has passed, balance still owed, admin hasn't overridden
  const overdueLeague = await db.select().from(leagueRegistrationsTable)
    .where(and(
      eq(leagueRegistrationsTable.status, "active"),
      sql`${leagueRegistrationsTable.balanceDue} > 0`,
      sql`${leagueRegistrationsTable.balanceDueDate} IS NOT NULL AND ${leagueRegistrationsTable.balanceDueDate}::timestamptz < now()`,
      eq(leagueRegistrationsTable.balanceOverriddenByAdmin, false),
      eq(leagueRegistrationsTable.playBlocked, false),
    )).catch(() => []);

  for (const reg of overdueLeague) {
    await db.update(leagueRegistrationsTable)
      .set({ playBlocked: true, updatedAt: new Date() } as any)
      .where(eq(leagueRegistrationsTable.id, reg.id));
    blocked++;
    details.push({ type: "league", id: reg.id, leagueId: reg.leagueId });
  }

  // Check first-fixture approach for leagues: find upcoming first fixture, block 24h before
  const leagueRegsWithBalance = await db.select().from(leagueRegistrationsTable)
    .where(and(
      eq(leagueRegistrationsTable.status, "active"),
      sql`${leagueRegistrationsTable.balanceDue} > 0`,
      eq(leagueRegistrationsTable.balanceOverriddenByAdmin, false),
      eq(leagueRegistrationsTable.playBlocked, false),
    )).catch(() => []);

  for (const reg of leagueRegsWithBalance) {
    const firstFixture = await db.select().from(fixturesTable)
      .where(and(
        eq(fixturesTable.entityType, "league"),
        eq(fixturesTable.entityId, reg.leagueId),
        sql`${fixturesTable.scheduledAt} > now()`,
      ))
      .limit(1)
      .then(rows => rows[0] ?? null);

    if (firstFixture?.scheduledAt) {
      const blockDeadline = new Date(firstFixture.scheduledAt);
      blockDeadline.setHours(blockDeadline.getHours() - 24);
      if (now >= blockDeadline) {
        await db.update(leagueRegistrationsTable)
          .set({ playBlocked: true, updatedAt: new Date() } as any)
          .where(eq(leagueRegistrationsTable.id, reg.id));
        blocked++;
        details.push({ type: "league_first_fixture", id: reg.id, fixtureId: firstFixture.id });
      }
    }
  }

  // Tournament registrations: balance due date has passed
  const overdrueTournament = await db.select().from(tournamentRegistrationsTable)
    .where(and(
      eq(tournamentRegistrationsTable.status, "active"),
      sql`${tournamentRegistrationsTable.totalAmount} > ${tournamentRegistrationsTable.amountPaid}`,
      sql`${tournamentRegistrationsTable.balanceDueDate} IS NOT NULL AND ${tournamentRegistrationsTable.balanceDueDate}::timestamptz < now()`,
      eq(tournamentRegistrationsTable.balanceOverriddenByAdmin, false),
      eq(tournamentRegistrationsTable.playBlocked, false),
    )).catch(() => []);

  for (const reg of overdrueTournament) {
    await db.update(tournamentRegistrationsTable)
      .set({ playBlocked: true, updatedAt: new Date() } as any)
      .where(eq(tournamentRegistrationsTable.id, reg.id));
    blocked++;
    details.push({ type: "tournament", id: reg.id, tournamentId: reg.tournamentId });
  }

  res.json({ blocked, alreadyBlocked, details });
});

// POST /admin/deposits/override-play-block — admin overrides a play block
router.post("/admin/deposits/override-play-block", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const body = req.body as { offeringType: "league" | "tournament"; registrationId: number; notes?: string };

  if (!body.offeringType || !body.registrationId) {
    res.status(400).json({ error: "offeringType and registrationId are required" });
    return;
  }

  if (body.offeringType === "league") {
    const [reg] = await db.select().from(leagueRegistrationsTable).where(eq(leagueRegistrationsTable.id, body.registrationId));
    if (!reg) { res.status(404).json({ error: "League registration not found" }); return; }
    await db.update(leagueRegistrationsTable)
      .set({ playBlocked: false, balanceOverriddenByAdmin: true, playBlockOverrideBy: authed.clerkUserId, updatedAt: new Date() } as any)
      .where(eq(leagueRegistrationsTable.id, body.registrationId));
  } else {
    const [reg] = await db.select().from(tournamentRegistrationsTable).where(eq(tournamentRegistrationsTable.id, body.registrationId));
    if (!reg) { res.status(404).json({ error: "Tournament registration not found" }); return; }
    await db.update(tournamentRegistrationsTable)
      .set({ playBlocked: false, balanceOverriddenByAdmin: true, playBlockOverrideBy: authed.clerkUserId, updatedAt: new Date() } as any)
      .where(eq(tournamentRegistrationsTable.id, body.registrationId));
  }

  res.json({ overridden: true, by: authed.clerkUserId });
});

export default router;
