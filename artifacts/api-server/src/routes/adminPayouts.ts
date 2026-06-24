/**
 * Admin payout management routes (P8 — Stripe Connect).
 *
 * Endpoints:
 *  GET  /admin/payouts/queue        — pending + approved payouts awaiting execution
 *  GET  /admin/payouts/history      — paid / failed payout history (paginated)
 *  POST /admin/payouts/create       — create a payout record for an assignment
 *  POST /admin/payouts/approve      — approve one or more pending payouts
 *  POST /admin/payouts/:id/execute  — execute an approved payout via Stripe Connect transfer
 *  POST /admin/payouts/:id/retry    — retry a failed payout
 *  GET  /admin/payouts/owed         — assignments with compensation set but not yet paid out (queue feed)
 *
 * Staff-facing:
 *  GET  /staff/payouts/me           — payout history for the authenticated staff member
 */
import { Router, type IRouter } from "express";
import { db, payoutsTable, assignmentsTable, usersTable, staffProfilesTable, auditLogTable, venuesTable } from "@workspace/db";
import { eq, and, inArray, desc, notInArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { requirePermission, requireAdmin, requireAuth, type AuthedRequest } from "../middlewares/auth";
import { getUncachableStripeClient } from "../lib/stripe";
import type { Request } from "express";

const router: IRouter = Router();

// ─── helpers ────────────────────────────────────────────────────────────────

async function getDbUser(clerkId: string) {
  const [u] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  return u ?? null;
}

/** Enrich a payout row with recipient name and assignment summary. */
async function enrichPayout(p: typeof payoutsTable.$inferSelect) {
  const recipient = p.recipientUserId
    ? (await db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email })
        .from(usersTable).where(eq(usersTable.id, p.recipientUserId)))
        .map(u => ({ name: [u.firstName, u.lastName].filter(Boolean).join(" ") || null, email: u.email }))[0] ?? null
    : null;

  const assignment = (p as any).assignmentId
    ? (await db.select().from(assignmentsTable)
        .where(eq(assignmentsTable.id, (p as any).assignmentId)))[0] ?? null
    : null;

  return { ...p, recipient, assignment };
}

// ─── Admin: payout queue ─────────────────────────────────────────────────────

/**
 * GET /admin/payouts/queue
 * Returns payouts in status "pending" or "approved" — i.e., not yet executed.
 */
router.get("/admin/payouts/queue", requirePermission("canManagePayouts"), async (_req, res): Promise<void> => {
  const rows = await db.select().from(payoutsTable)
    .where(inArray(payoutsTable.status, ["pending_onboarding", "pending", "approved"]))
    .orderBy(desc(payoutsTable.createdAt));

  const enriched = await Promise.all(rows.map(enrichPayout));
  res.json(enriched);
});

/**
 * GET /admin/payouts/owed
 * Assignments with compensation_amount set and is_paid = false — the raw feed
 * from which admin creates payout records.
 */
router.get("/admin/payouts/owed", requirePermission("canManagePayouts"), async (_req, res): Promise<void> => {
  // Find assignment IDs that already have an active (non-failed/voided) payout record
  const activePayoutRows = await db.select({ assignmentId: sql<number>`${payoutsTable.assignmentId}` })
    .from(payoutsTable)
    .where(
      and(
        sql`${payoutsTable.assignmentId} IS NOT NULL`,
        notInArray(payoutsTable.status, ["failed", "voided"]),
      ),
    );
  const activeAssignmentIds = activePayoutRows.map(r => r.assignmentId).filter(Boolean) as number[];

  const rows = await db.select({
    assignment: assignmentsTable,
    staffUser: {
      id: usersTable.id,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      email: usersTable.email,
    },
    connectAccountId: staffProfilesTable.connectAccountId,
    connectOnboardingStatus: staffProfilesTable.connectOnboardingStatus,
  })
    .from(assignmentsTable)
    .leftJoin(usersTable, eq(assignmentsTable.staffUserId, usersTable.id))
    .leftJoin(staffProfilesTable, eq(staffProfilesTable.userId, assignmentsTable.staffUserId))
    .where(
      and(
        eq(assignmentsTable.isPaid, false),
        sql`${assignmentsTable.compensationAmount} IS NOT NULL`,
        sql`${assignmentsTable.compensationAmount} != ''`,
        // Exclude assignments that already have a pending/approved/processing/paid payout
        activeAssignmentIds.length > 0
          ? notInArray(assignmentsTable.id, activeAssignmentIds)
          : sql`TRUE`,
      ),
    )
    .orderBy(desc(assignmentsTable.createdAt));

  res.json(rows);
});

/**
 * GET /admin/payouts/history
 * Paginated history of paid / failed payouts.
 * Query: ?limit=50&offset=0
 */
router.get("/admin/payouts/history", requirePermission("canManagePayouts"), async (req, res): Promise<void> => {
  const limit = Math.min(Number(req.query.limit ?? 50), 200);
  const offset = Number(req.query.offset ?? 0);

  const rows = await db.select().from(payoutsTable)
    .where(inArray(payoutsTable.status, ["paid", "failed"]))
    .orderBy(desc(payoutsTable.processedAt))
    .limit(limit)
    .offset(offset);

  const enriched = await Promise.all(rows.map(enrichPayout));
  res.json(enriched);
});

/**
 * POST /admin/payouts/create
 * Create a payout record for one or more assignment IDs.
 * Body: { assignmentIds: number[]; notes?: string }
 */
router.post("/admin/payouts/create", requirePermission("canManagePayouts"), async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const body = req.body as { assignmentIds?: number[]; notes?: string };

  if (!body.assignmentIds?.length) {
    res.status(400).json({ error: "assignmentIds (non-empty array) is required" });
    return;
  }

  const assignments = await db.select().from(assignmentsTable)
    .where(inArray(assignmentsTable.id, body.assignmentIds));

  if (!assignments.length) {
    res.status(404).json({ error: "No matching assignments found" });
    return;
  }

  // Pre-check: find assignments that already have an active payout (idempotency guard)
  const existingPayouts = await db.select({ assignmentId: sql<number>`${payoutsTable.assignmentId}` })
    .from(payoutsTable)
    .where(
      and(
        inArray(payoutsTable.assignmentId as any, body.assignmentIds),
        notInArray(payoutsTable.status, ["failed", "voided"]),
      ),
    );
  const alreadyQueued = new Set(existingPayouts.map(r => r.assignmentId));

  const skipped: number[] = [];
  const created: (typeof payoutsTable.$inferSelect)[] = [];

  for (const asgn of assignments) {
    if (asgn.isPaid) { skipped.push(asgn.id); continue; }
    if (!asgn.compensationAmount) { skipped.push(asgn.id); continue; }
    if (alreadyQueued.has(asgn.id)) { skipped.push(asgn.id); continue; }

    const amount = Number(asgn.compensationAmount);
    if (isNaN(amount) || amount <= 0) { skipped.push(asgn.id); continue; }

    // Get connect account ID and onboarding status for recipient
    const [sp] = asgn.staffUserId
      ? await db.select({
            connectAccountId: staffProfilesTable.connectAccountId,
            connectOnboardingStatus: staffProfilesTable.connectOnboardingStatus,
          })
          .from(staffProfilesTable)
          .where(eq(staffProfilesTable.userId, asgn.staffUserId))
      : [null];

    // If the recipient hasn't finished onboarding, queue the payout as
    // pending_onboarding — it will auto-execute once their account is verified.
    const isFullyOnboarded =
      sp?.connectOnboardingStatus === "complete" ||
      sp?.connectOnboardingStatus === "onboarded";
    const payoutStatus = isFullyOnboarded ? "pending" : "pending_onboarding";

    // ON CONFLICT: the partial unique index (assignment_id, active) prevents double-insert;
    // use DO NOTHING so concurrent requests are safe without error.
    const insertResult = await db.insert(payoutsTable).values({
      recipientUserId: asgn.staffUserId,
      assignmentId: asgn.id,
      amount: String(amount),
      currency: "usd",
      status: payoutStatus,
      payoutType: asgn.role === "coach" ? "coach_fee" : asgn.role === "scorekeeper" ? "scorekeeper_fee" : "referee_fee",
      provider: "stripe_connect",
      connectAccountId: (sp as any)?.connectAccountId ?? null,
      description: `${asgn.role} fee — ${asgn.entityType} #${asgn.entityId}`,
      notes: body.notes ?? null,
    } as any).onConflictDoNothing().returning();

    if (!insertResult.length) { skipped.push(asgn.id); continue; }
    const payout = insertResult[0];

    await db.insert(auditLogTable).values({
      actorClerkId: authed.clerkUserId,
      action: "create",
      entityType: "payout",
      entityId: String(payout.id),
      notes: `Payout created for assignment ${asgn.id}, amount $${amount}`,
    });

    created.push(payout);
  }

  res.status(201).json({ created, skipped });
});

/**
 * POST /admin/payouts/venue-create
 * Manually create a payout record for a venue (facility split).
 * If the venue's Stripe Connect account is not yet onboarded, the payout is
 * saved as "pending_onboarding" and auto-executed by the account.updated webhook.
 * Body: { venueId: number; amount: number; description?: string; notes?: string }
 */
router.post("/admin/payouts/venue-create", requirePermission("canManagePayouts"), async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const body = req.body as { venueId?: number; amount?: number; description?: string; notes?: string };

  if (!body.venueId || !body.amount) {
    res.status(400).json({ error: "venueId and amount are required" });
    return;
  }
  if (isNaN(body.amount) || body.amount <= 0) {
    res.status(400).json({ error: "amount must be a positive number" });
    return;
  }

  const [venue] = await db.select().from(venuesTable).where(eq(venuesTable.id, body.venueId));
  if (!venue) {
    res.status(404).json({ error: "Venue not found" });
    return;
  }

  const connectAccountId = (venue as any).stripeConnectAccountId as string | null;
  const onboardingStatus = (venue as any).stripeConnectOnboardingStatus as string ?? "none";

  const isOnboarded = onboardingStatus === "onboarded";
  const payoutStatus = isOnboarded ? "pending" : "pending_onboarding";

  const [payout] = await db.insert(payoutsTable).values({
    recipientUserId: null,
    assignmentId: null,
    venueId: body.venueId,
    amount: String(body.amount),
    currency: "usd",
    status: payoutStatus,
    payoutType: "facility_split",
    provider: "stripe_connect",
    connectAccountId,
    description: body.description ?? `Facility split — ${venue.name}`,
    notes: body.notes ?? null,
  } as any).returning();

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "create",
    entityType: "payout",
    entityId: String(payout.id),
    notes: `Venue payout created for ${venue.name} (venue ${body.venueId}), amount $${body.amount}. Status: ${payoutStatus}`,
  });

  res.status(201).json({ payout, status: payoutStatus });
});

/**
 * POST /admin/payouts/approve
 * Approve one or more pending payouts.
 * Body: { payoutIds: number[] }
 */
router.post("/admin/payouts/approve", requirePermission("canManagePayouts"), async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const body = req.body as { payoutIds?: number[] };

  if (!body.payoutIds?.length) {
    res.status(400).json({ error: "payoutIds (non-empty array) is required" });
    return;
  }

  const dbUser = await getDbUser(authed.clerkUserId);

  const updated = await db.update(payoutsTable)
    .set({
      status: "approved",
      approvedAt: new Date(),
      approvedByUserId: dbUser?.id ?? null,
      updatedAt: new Date(),
    } as any)
    .where(
      and(
        inArray(payoutsTable.id, body.payoutIds),
        eq(payoutsTable.status, "pending"),
      ),
    )
    .returning();

  for (const p of updated) {
    await db.insert(auditLogTable).values({
      actorClerkId: authed.clerkUserId,
      action: "approve",
      entityType: "payout",
      entityId: String(p.id),
      notes: `Payout approved by ${authed.clerkUserId}`,
    });
  }

  res.json({ approved: updated.length, payouts: updated });
});

/**
 * POST /admin/payouts/:id/execute
 * Execute an approved payout via Stripe Connect transfer.
 * The payout must be in status "approved" and the recipient must have a
 * complete Stripe Connect account.
 */
router.post("/admin/payouts/:id/execute", requirePermission("canManagePayouts"), async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid payout id" }); return; }

  const [payout] = await db.select().from(payoutsTable).where(eq(payoutsTable.id, id));
  if (!payout) { res.status(404).json({ error: "Payout not found" }); return; }
  if (payout.status !== "approved") {
    res.status(400).json({ error: `Payout is in status "${payout.status}" — must be "approved" to execute` });
    return;
  }

  const connectAccountId = (payout as any).connectAccountId as string | null;
  if (!connectAccountId) {
    res.status(422).json({
      error: "Recipient does not have a Stripe Connect account ID. " +
        "They must complete onboarding via /staff/connect/onboard first.",
    });
    return;
  }

  // Verify Connect account has payouts enabled
  const stripe = await getUncachableStripeClient();
  const account = await stripe.accounts.retrieve(connectAccountId);
  if (!account.payouts_enabled) {
    res.status(422).json({
      error: "Recipient's Stripe Connect account does not have payouts enabled. " +
        "They may need to complete additional verification steps.",
      requirements: account.requirements,
    });
    return;
  }

  // Mark as processing atomically before Stripe call
  const casResult = await db.update(payoutsTable)
    .set({ status: "processing", updatedAt: new Date() } as any)
    .where(and(eq(payoutsTable.id, id), eq(payoutsTable.status, "approved")))
    .returning();

  if (!casResult.length) {
    res.status(409).json({ error: "Payout status changed concurrently — refresh and try again" });
    return;
  }

  try {
    // Execute Stripe Connect transfer to the connected account
    const amountCents = Math.round(Number(payout.amount) * 100);
    const transfer = await stripe.transfers.create({
      amount: amountCents,
      currency: payout.currency,
      destination: connectAccountId,
      description: payout.description ?? `PlayOn payout #${payout.id}`,
      metadata: {
        payoutId: String(payout.id),
        assignmentId: String((payout as any).assignmentId ?? ""),
        recipientUserId: String(payout.recipientUserId ?? ""),
      },
    });

    // Success — mark paid
    const [paid] = await db.update(payoutsTable)
      .set({
        status: "paid",
        providerTransferId: transfer.id,
        processedAt: new Date(),
        failureReason: null,
        updatedAt: new Date(),
      } as any)
      .where(eq(payoutsTable.id, id))
      .returning();

    // Mark assignment as paid if linked
    if ((payout as any).assignmentId) {
      await db.update(assignmentsTable)
        .set({ isPaid: true, paidAt: new Date(), updatedAt: new Date() } as any)
        .where(eq(assignmentsTable.id, (payout as any).assignmentId));
    }

    await db.insert(auditLogTable).values({
      actorClerkId: authed.clerkUserId,
      action: "execute",
      entityType: "payout",
      entityId: String(id),
      notes: `Stripe transfer ${transfer.id} executed for $${payout.amount}`,
    });

    res.json(paid);
  } catch (e: any) {
    // Mark failed, preserve failure reason
    await db.update(payoutsTable)
      .set({
        status: "failed",
        failureReason: e.message ?? String(e),
        updatedAt: new Date(),
      } as any)
      .where(eq(payoutsTable.id, id));

    res.status(502).json({
      error: `Stripe transfer failed: ${e.message}`,
      stripeCode: e.code,
    });
  }
});

/**
 * POST /admin/payouts/:id/retry
 * Reset a failed payout back to "approved" so it can be executed again.
 */
router.post("/admin/payouts/:id/retry", requirePermission("canManagePayouts"), async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid payout id" }); return; }

  const updated = await db.update(payoutsTable)
    .set({ status: "approved", failureReason: null, updatedAt: new Date() } as any)
    .where(and(eq(payoutsTable.id, id), eq(payoutsTable.status, "failed")))
    .returning();

  if (!updated.length) {
    res.status(400).json({ error: "Payout is not in failed status or does not exist" });
    return;
  }

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "retry",
    entityType: "payout",
    entityId: String(id),
  });

  res.json(updated[0]);
});

// ─── Staff-facing: my payouts ────────────────────────────────────────────────

/**
 * GET /staff/payouts/me
 * Returns payout history for the authenticated staff member.
 */
router.get("/staff/payouts/me", requireAuth, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const dbUser = await getDbUser(authed.clerkUserId);
  if (!dbUser) { res.status(404).json({ error: "User not found" }); return; }

  const rows = await db.select().from(payoutsTable)
    .where(eq(payoutsTable.recipientUserId, dbUser.id))
    .orderBy(desc(payoutsTable.createdAt));

  // Enrich with assignment details
  const enriched = await Promise.all(rows.map(async (p) => {
    const assignment = (p as any).assignmentId
      ? (await db.select().from(assignmentsTable)
          .where(eq(assignmentsTable.id, (p as any).assignmentId)))[0] ?? null
      : null;
    return { ...p, assignment };
  }));

  res.json(enriched);
});

/**
 * GET /staff/payouts/owed/me
 * Assignments owed to the current staff member that are not yet paid.
 */
router.get("/staff/payouts/owed/me", requireAuth, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const dbUser = await getDbUser(authed.clerkUserId);
  if (!dbUser) { res.status(404).json({ error: "User not found" }); return; }

  const rows = await db.select().from(assignmentsTable)
    .where(
      and(
        eq(assignmentsTable.staffUserId, dbUser.id),
        eq(assignmentsTable.isPaid, false),
        sql`${assignmentsTable.compensationAmount} IS NOT NULL`,
        sql`${assignmentsTable.compensationAmount} != ''`,
      ),
    )
    .orderBy(desc(assignmentsTable.createdAt));

  const totalOwed = rows.reduce((sum, a) => sum + Number(a.compensationAmount ?? 0), 0);
  res.json({ assignments: rows, totalOwed });
});

export default router;
