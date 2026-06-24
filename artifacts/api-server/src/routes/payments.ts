import { Router, type IRouter } from "express";
import { db, paymentsTable, registrationsTable, usersTable, notificationsTable, leagueRegistrationsTable, tournamentRegistrationsTable } from "@workspace/db";
import { eq, desc, and, gte, lte, sql } from "drizzle-orm";
import { requireAuth, requirePermission, hasPermission, type AuthedRequest } from "../middlewares/auth";
import type { Request } from "express";

const router: IRouter = Router();

// GET /payments — authenticated user sees own payments; admin sees all
router.get("/payments", requireAuth, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const isAdmin = await hasPermission(authed.clerkUserId, "canViewReports");
  const { from, to, status, entityType, limit: limitStr } = req.query as Record<string, string>;
  const limit = Math.min(parseInt(limitStr ?? "50", 10), 200);

  const conditions: any[] = [];

  if (!isAdmin) {
    const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
    if (!dbUser) { res.json([]); return; }
    conditions.push(eq(paymentsTable.userId, dbUser.id));
  }

  if (status) conditions.push(eq(paymentsTable.status, status));
  if (entityType) conditions.push(eq(paymentsTable.entityType, entityType));
  if (from) conditions.push(gte(paymentsTable.createdAt, new Date(from)));
  if (to) conditions.push(lte(paymentsTable.createdAt, new Date(to)));

  let query = db.select().from(paymentsTable).$dynamic();
  if (conditions.length) query = query.where(and(...conditions));
  const payments = await query.orderBy(desc(paymentsTable.createdAt)).limit(limit);
  res.json(payments);
});

// GET /admin/payments/outstanding — registrations with unpaid/partial status
router.get("/admin/payments/outstanding", requirePermission("canViewReports"), async (req, res): Promise<void> => {
  const { programType, limit: limitStr } = req.query as Record<string, string>;
  const limit = Math.min(parseInt(limitStr ?? "100", 10), 500);

  const conditions: any[] = [
    sql`${registrationsTable.paymentStatus} IN ('unpaid', 'partial')`,
    sql`${registrationsTable.status} != 'cancelled'`,
  ];
  if (programType) conditions.push(eq(registrationsTable.programType, programType));

  const outstanding = await db.select({
    id: registrationsTable.id,
    userId: registrationsTable.userId,
    programType: registrationsTable.programType,
    programId: registrationsTable.programId,
    programName: registrationsTable.programName,
    teamId: registrationsTable.teamId,
    status: registrationsTable.status,
    amountPaid: registrationsTable.amountPaid,
    paymentStatus: registrationsTable.paymentStatus,
    createdAt: registrationsTable.createdAt,
  })
    .from(registrationsTable)
    .where(and(...conditions))
    .orderBy(desc(registrationsTable.createdAt))
    .limit(limit);

  res.json(outstanding);
});

// GET /admin/payments/summary — aggregated financial summary per offering type
router.get("/admin/payments/summary", requirePermission("canViewReports"), async (req, res): Promise<void> => {
  const { from, to } = req.query as Record<string, string>;

  const conditions: any[] = [];
  if (from) conditions.push(gte(paymentsTable.createdAt, new Date(from)));
  if (to) conditions.push(lte(paymentsTable.createdAt, new Date(to)));
  conditions.push(eq(paymentsTable.status, "paid"));

  let totalQuery = db
    .select({
      entityType: paymentsTable.entityType,
      paymentMethod: paymentsTable.paymentMethod,
      count: sql<string>`COUNT(*)`,
      totalAmount: sql<string>`COALESCE(SUM(amount::numeric), 0)`,
      totalRefunded: sql<string>`COALESCE(SUM(CASE WHEN refunded THEN refund_amount::numeric ELSE 0 END), 0)`,
    })
    .from(paymentsTable)
    .where(and(...conditions))
    .groupBy(paymentsTable.entityType, paymentsTable.paymentMethod)
    .$dynamic();

  const rows = await totalQuery;

  const byType: Record<string, { inApp: number; external: number; refunded: number; count: number }> = {};
  for (const row of rows) {
    const t = row.entityType ?? "unknown";
    if (!byType[t]) byType[t] = { inApp: 0, external: 0, refunded: 0, count: 0 };
    const isExternal = row.paymentMethod === "cash" || row.paymentMethod === "venmo" || row.paymentMethod === "external";
    if (isExternal) {
      byType[t].external += Number(row.totalAmount);
    } else {
      byType[t].inApp += Number(row.totalAmount);
    }
    byType[t].refunded += Number(row.totalRefunded);
    byType[t].count += Number(row.count);
  }

  const totals = Object.values(byType).reduce(
    (acc, v) => ({ inApp: acc.inApp + v.inApp, external: acc.external + v.external, refunded: acc.refunded + v.refunded, count: acc.count + v.count }),
    { inApp: 0, external: 0, refunded: 0, count: 0 }
  );

  res.json({ byType, totals });
});

// GET /admin/payments/facility-split — gross/facility/net breakdown per offering type
router.get("/admin/payments/facility-split", requirePermission("canViewReports"), async (req, res): Promise<void> => {
  const { from, to } = req.query as Record<string, string>;

  const conditions: any[] = [eq(paymentsTable.status, "paid")];
  if (from) conditions.push(gte(paymentsTable.createdAt, new Date(from)));
  if (to) conditions.push(lte(paymentsTable.createdAt, new Date(to)));

  // Aggregate: gross = total amount charged; serviceFee = non-refundable platform fee; net = gross - serviceFee
  const rows = await db.select({
    entityType: paymentsTable.entityType,
    count: sql<string>`COUNT(*)`,
    gross: sql<string>`COALESCE(SUM(amount::numeric), 0)`,
    serviceFees: sql<string>`COALESCE(SUM(COALESCE(service_fee_amount::numeric, 0)), 0)`,
    refunded: sql<string>`COALESCE(SUM(CASE WHEN refunded THEN COALESCE(refund_amount::numeric, 0) ELSE 0 END), 0)`,
  })
    .from(paymentsTable)
    .where(and(...conditions))
    .groupBy(paymentsTable.entityType);

  const breakdown = rows.map(row => ({
    entityType: row.entityType,
    count: Number(row.count),
    gross: Number(row.gross),
    serviceFees: Number(row.serviceFees),
    net: Number(row.gross) - Number(row.serviceFees),
    refunded: Number(row.refunded),
    netAfterRefunds: Number(row.gross) - Number(row.serviceFees) - Number(row.refunded),
  }));

  const totals = breakdown.reduce(
    (acc, r) => ({
      count: acc.count + r.count,
      gross: acc.gross + r.gross,
      serviceFees: acc.serviceFees + r.serviceFees,
      net: acc.net + r.net,
      refunded: acc.refunded + r.refunded,
      netAfterRefunds: acc.netAfterRefunds + r.netAfterRefunds,
    }),
    { count: 0, gross: 0, serviceFees: 0, net: 0, refunded: 0, netAfterRefunds: 0 }
  );

  res.json({ breakdown, totals });
});

// POST /admin/payments/send-balance-reminders — create in-app notifications for users with unpaid balances
router.post("/admin/payments/send-balance-reminders", requirePermission("canViewReports"), async (_req, res): Promise<void> => {
  let sent = 0;
  const details: Array<{ userId: number; type: string; regId: number }> = [];

  // League registrations with unpaid balance
  const leagueRegs = await db.select({
    id: leagueRegistrationsTable.id,
    registeredByUserId: leagueRegistrationsTable.registeredByUserId,
    leagueId: leagueRegistrationsTable.leagueId,
    balanceDue: leagueRegistrationsTable.balanceDue,
    balanceDueDate: leagueRegistrationsTable.balanceDueDate,
  }).from(leagueRegistrationsTable)
    .where(and(
      eq(leagueRegistrationsTable.status, "active"),
      sql`${leagueRegistrationsTable.balanceDue} > 0`,
      eq(leagueRegistrationsTable.balanceOverriddenByAdmin, false),
    )).catch(() => []);

  for (const reg of leagueRegs) {
    const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.clerkId, reg.registeredByUserId));
    if (!user) continue;
    await db.insert(notificationsTable).values({
      userId: user.id,
      channel: "in_app",
      type: "balance_due_reminder",
      subject: "Balance due reminder",
      body: `Your league registration #${reg.id} has a balance of $${Number(reg.balanceDue).toFixed(2)} due${reg.balanceDueDate ? ` by ${reg.balanceDueDate}` : ""}. Please pay before your first game to avoid a play block.`,
      status: "sent",
      sentAt: new Date(),
      metadata: JSON.stringify({ regType: "league", regId: reg.id, leagueId: reg.leagueId }),
    } as any).catch(() => {});
    details.push({ userId: user.id, type: "league", regId: reg.id });
    sent++;
  }

  // Tournament registrations with unpaid balance
  const tourRegs = await db.select({
    id: tournamentRegistrationsTable.id,
    registeredByUserId: tournamentRegistrationsTable.registeredByUserId,
    tournamentId: tournamentRegistrationsTable.tournamentId,
    totalAmount: tournamentRegistrationsTable.totalAmount,
    amountPaid: tournamentRegistrationsTable.amountPaid,
    balanceDueDate: tournamentRegistrationsTable.balanceDueDate,
  }).from(tournamentRegistrationsTable)
    .where(and(
      eq(tournamentRegistrationsTable.status, "active"),
      sql`${tournamentRegistrationsTable.totalAmount} > ${tournamentRegistrationsTable.amountPaid}`,
      eq(tournamentRegistrationsTable.balanceOverriddenByAdmin, false),
    )).catch(() => []);

  for (const reg of tourRegs) {
    const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, reg.registeredByUserId ?? 0));
    if (!user) continue;
    const balance = Number(reg.totalAmount) - Number(reg.amountPaid);
    await db.insert(notificationsTable).values({
      userId: user.id,
      channel: "in_app",
      type: "balance_due_reminder",
      subject: "Tournament balance due",
      body: `Your tournament registration #${reg.id} has a balance of $${balance.toFixed(2)} outstanding${reg.balanceDueDate ? ` due ${new Date(reg.balanceDueDate as any).toLocaleDateString()}` : ""}. Please complete payment to avoid a play block.`,
      status: "sent",
      sentAt: new Date(),
      metadata: JSON.stringify({ regType: "tournament", regId: reg.id, tournamentId: reg.tournamentId }),
    } as any).catch(() => {});
    details.push({ userId: user.id, type: "tournament", regId: reg.id });
    sent++;
  }

  res.json({ sent, details });
});

// GET /admin/payments/external — list all external (cash/Venmo) payments
router.get("/admin/payments/external", requirePermission("canViewReports"), async (req, res): Promise<void> => {
  const { limit: limitStr } = req.query as Record<string, string>;
  const limit = Math.min(parseInt(limitStr ?? "100", 10), 500);

  const externals = await db.select().from(paymentsTable)
    .where(eq(paymentsTable.provider, "external"))
    .orderBy(desc(paymentsTable.createdAt))
    .limit(limit);
  res.json(externals);
});

// GET /admin/disputes — list all disputed payments with player info
router.get("/admin/disputes", requirePermission("canViewReports"), async (req, res): Promise<void> => {
  const { status, limit: limitStr } = req.query as Record<string, string>;
  const limit = Math.min(parseInt(limitStr ?? "100", 10), 500);

  const conditions: any[] = [sql`${paymentsTable.disputeStatus} IS NOT NULL`];
  if (status) conditions.push(eq(paymentsTable.disputeStatus, status));

  const disputes = await db.select({
    id: paymentsTable.id,
    userId: paymentsTable.userId,
    entityType: paymentsTable.entityType,
    entityId: paymentsTable.entityId,
    amount: paymentsTable.amount,
    currency: paymentsTable.currency,
    status: paymentsTable.status,
    providerChargeId: paymentsTable.providerChargeId,
    disputeStatus: paymentsTable.disputeStatus,
    disputedAt: paymentsTable.disputedAt,
    createdAt: paymentsTable.createdAt,
    userName: usersTable.name,
    userEmail: usersTable.email,
  })
    .from(paymentsTable)
    .leftJoin(usersTable, eq(paymentsTable.userId, usersTable.id))
    .where(and(...conditions))
    .orderBy(desc(paymentsTable.disputedAt))
    .limit(limit);

  res.json(disputes);
});

// GET /admin/disputes/summary — open dispute count for badge
router.get("/admin/disputes/summary", requirePermission("canViewReports"), async (req, res): Promise<void> => {
  const openStatuses = ["needs_response", "under_review", "warning_needs_response", "warning_under_review"];
  const [row] = await db.select({ count: sql<number>`count(*)::int` })
    .from(paymentsTable)
    .where(sql`${paymentsTable.disputeStatus} IN (${sql.join(openStatuses.map(s => sql`${s}`), sql`, `)})`);
  res.json({ openCount: row?.count ?? 0 });
});

export default router;
