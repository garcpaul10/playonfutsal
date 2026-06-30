/**
 * Fixture operations: cancel and reschedule.
 *
 * Cancel: marks fixture cancelled, invokes the existing RefundCreditPolicy engine for every
 *   paid payment tied to the fixture's program (entityType/entityId), and notifies affected parties.
 *
 * Reschedule: validates no court conflict using correct half-open interval semantics
 *   (existingStart < newEnd AND existingEnd > newStart), then updates and notifies.
 *
 * DB-level enforcement: a BEFORE INSERT OR UPDATE trigger `court_no_double_booking` on `fixtures`
 *   (created by migration 0014_p12_ops_compliance.sql) raises a Postgres exception if a same-court
 *   time overlap is detected. Application-level pre-checks here give early, user-friendly 409s
 *   before the DB write is attempted.
 */
import { Router, type IRouter } from "express";
import {
  db, fixturesTable, auditLogTable,
  teamMembersTable, usersTable, assignmentsTable, paymentsTable,
  guardiansTable,
} from "@workspace/db";
import { eq, and, ne } from "drizzle-orm";
import { requirePermission, type AuthedRequest } from "../middlewares/auth";
import { sendNotificationWithPreferences } from "../services/notifications";
import { applyPolicy } from "./cancellationEngine";
import { checkCourtConflict } from "../services/courtConflict.js";

const router: IRouter = Router();

/** GET /fixtures/:id — get a single fixture */
router.get("/fixtures/:id", async (req: any, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid fixture id" }); return; }
  const [fixture] = await db.select().from(fixturesTable).where(eq(fixturesTable.id, id));
  if (!fixture) { res.status(404).json({ error: "Fixture not found" }); return; }
  res.json(fixture);
});

/** GET /fixtures/:id/conflict-check?courtId=N&scheduledAt=ISO&durationMinutes=N */
router.get("/fixtures/:id/conflict-check", async (req: any, res): Promise<void> => {
  const id = parseInt(req.params.id);
  const courtId = req.query.courtId as string;
  const scheduledAt = req.query.scheduledAt as string;
  const durationMinutes = req.query.durationMinutes as string;
  if (!courtId || !scheduledAt) {
    res.status(400).json({ error: "courtId and scheduledAt are required" });
    return;
  }
  const start = new Date(scheduledAt);
  const dur = parseInt(durationMinutes ?? "60");
  const end = new Date(start.getTime() + dur * 60000);
  const result = await checkCourtConflict(
    parseInt(courtId),
    start,
    end,
    isNaN(id) ? undefined : { excludeFixtureId: id },
  );
  res.json(result);
});

/**
 * POST /admin/fixtures/:id/cancel
 * Body: {
 *   reason?: string             — human-readable cancellation reason (e.g., "weather", "facility issue")
 *   notifyParties?: boolean     — default true; notify team members and assigned staff
 *   applyRefundPolicy?: boolean — when true, runs the RefundCreditPolicy engine for every paid
 *                                  registration tied to this fixture's entityType/entityId
 *   daysUntilEvent?: number     — used by the policy engine to select the matching policy tier
 *   creditExpiryDays?: number   — passed to the policy engine for credit expiry
 * }
 */
router.post("/admin/fixtures/:id/cancel", requirePermission("canManageSchedules"), async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid fixture id" }); return; }

  const [fixture] = await db.select().from(fixturesTable).where(eq(fixturesTable.id, id));
  if (!fixture) { res.status(404).json({ error: "Fixture not found" }); return; }
  if (fixture.status === "cancelled") {
    res.status(409).json({ error: "Fixture is already cancelled" });
    return;
  }

  const {
    reason,
    notifyParties = true,
    applyRefundPolicy = true,
    daysUntilEvent: daysUntilEventOverride,
    creditExpiryDays,
  } = req.body as {
    reason?: string;
    notifyParties?: boolean;
    applyRefundPolicy?: boolean;
    daysUntilEvent?: number;
    creditExpiryDays?: number;
  };

  // Compute daysUntilEvent server-side from fixture.scheduledAt so the correct
  // RefundCreditPolicy tier is always applied — callers should not need to supply this.
  const computedDaysUntilEvent =
    fixture.scheduledAt
      ? Math.max(0, Math.floor((new Date(fixture.scheduledAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
      : 0;
  const daysUntilEvent = typeof daysUntilEventOverride === "number" ? daysUntilEventOverride : computedDaysUntilEvent;

  const [updated] = await db
    .update(fixturesTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(fixturesTable.id, id))
    .returning();

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "fixture_cancelled",
    entityType: fixture.entityType,
    entityId: String(fixture.entityId),
    notes: JSON.stringify({ fixtureId: id, reason, applyRefundPolicy }),
  });

  // Invoke the RefundCreditPolicy engine for every paid registration tied to this program
  const policyResults: any[] = [];
  if (applyRefundPolicy) {
    const payments = await db
      .select()
      .from(paymentsTable)
      .where(
        and(
          eq(paymentsTable.entityType, fixture.entityType),
          eq(paymentsTable.entityId, fixture.entityId),
          eq(paymentsTable.status, "paid"),
        ),
      );

    for (const payment of payments) {
      const result = await applyPolicy({
        paymentId: payment.id,
        programType: fixture.entityType,
        daysUntilEvent,
        cancellationReason: reason,
        actorClerkId: authed.clerkUserId,
        creditExpiryDays,
      });
      policyResults.push({ paymentId: payment.id, ...result });
    }
  }

  const notified: number[] = [];
  const creditApplied = policyResults.some((r) => r.action === "credit" || r.action === "refund");

  if (notifyParties) {
    const teamIds: number[] = [];
    if (fixture.homeTeamId) teamIds.push(fixture.homeTeamId);
    if (fixture.awayTeamId) teamIds.push(fixture.awayTeamId);

    if (teamIds.length > 0) {
      const members = await db.select().from(teamMembersTable).where(eq(teamMembersTable.status, "active"));
      const affectedMembers = members.filter((m) => teamIds.includes(m.teamId));
      const clerkIds = [...new Set(affectedMembers.map((m) => m.userId))];

      for (const clerkId of clerkIds) {
        const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
        if (!user) continue;
        const cancelMsg = `Your ${fixture.entityType} game${fixture.scheduledAt ? ` on ${new Date(fixture.scheduledAt).toLocaleDateString()}` : ""} has been cancelled${reason ? `: ${reason}` : "."}${creditApplied ? " A refund or account credit has been applied per our cancellation policy." : ""}`;
        await sendNotificationWithPreferences({
          userId: user.id,
          type: "cancellation_rainout",
          subject: "Game cancelled",
          body: cancelMsg,
          metadata: { fixtureId: id, reason },
        });
        notified.push(user.id);

        // Guardian fan-out: notify approved guardians of this player (youth participants)
        const guardians = await db
          .select()
          .from(guardiansTable)
          .where(
            and(
              eq(guardiansTable.youthUserId, user.id),
              eq(guardiansTable.status, "approved"),
            ),
          );
        for (const g of guardians) {
          if (!notified.includes(g.guardianUserId)) {
            await sendNotificationWithPreferences({
              userId: g.guardianUserId,
              type: "cancellation_rainout",
              subject: "Your player's game has been cancelled",
              body: `${user.firstName ?? "Your player"}'s ${fixture.entityType} game${fixture.scheduledAt ? ` on ${new Date(fixture.scheduledAt).toLocaleDateString()}` : ""} has been cancelled${reason ? `: ${reason}` : "."}${creditApplied ? " A refund or account credit has been applied." : ""}`,
              metadata: { fixtureId: id, reason, youthUserId: user.id },
            });
            notified.push(g.guardianUserId);
          }
        }
      }
    }

    const refs = await db
      .select()
      .from(assignmentsTable)
      .where(
        and(
          eq(assignmentsTable.entityType, fixture.entityType),
          eq(assignmentsTable.entityId, fixture.entityId),
        ),
      );
    for (const a of refs) {
      if (a.staffUserId && !notified.includes(a.staffUserId)) {
        await sendNotificationWithPreferences({
          userId: a.staffUserId,
          type: "schedule_change",
          subject: "Assignment cancelled",
          body: `Your ref/coach/scorekeeper assignment${fixture.scheduledAt ? ` on ${new Date(fixture.scheduledAt).toLocaleDateString()}` : ""} has been cancelled${reason ? `: ${reason}` : "."}`,
          metadata: { fixtureId: id },
        });
        notified.push(a.staffUserId);
      }
    }
  }

  res.json({
    fixture: updated,
    notified: notified.length,
    policyResults,
  });
});

/**
 * POST /admin/fixtures/:id/reschedule
 * Body: { scheduledAt: ISO, courtId?: number, durationMinutes?: number, notifyParties?: boolean }
 *
 * Application pre-check uses strict half-open interval semantics (no false positives on back-to-back).
 * DB trigger `court_no_double_booking` is the authoritative final enforcement.
 */
router.post("/admin/fixtures/:id/reschedule", requirePermission("canManageSchedules"), async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid fixture id" }); return; }

  const [fixture] = await db.select().from(fixturesTable).where(eq(fixturesTable.id, id));
  if (!fixture) { res.status(404).json({ error: "Fixture not found" }); return; }

  const { scheduledAt, courtId, durationMinutes, notifyParties = true } = req.body as {
    scheduledAt: string;
    courtId?: number;
    durationMinutes?: number;
    notifyParties?: boolean;
  };

  if (!scheduledAt) {
    res.status(400).json({ error: "scheduledAt is required" });
    return;
  }

  const newScheduledAt = new Date(scheduledAt);
  const newCourtId = courtId ?? fixture.courtId;
  const newDuration = durationMinutes ?? fixture.durationMinutes;

  // Application-level pre-check (DB trigger is the authoritative enforcement)
  if (newCourtId) {
    const newEndsAt = new Date(newScheduledAt.getTime() + (newDuration ?? 90) * 60000);
    const check = await checkCourtConflict(newCourtId, newScheduledAt, newEndsAt, { excludeFixtureId: id });
    if (check.conflict) {
      res.status(409).json({ error: check.reason, conflictingFixtureId: check.conflictId });
      return;
    }
  }

  const oldScheduledAt = fixture.scheduledAt;
  let updated: typeof fixture;
  try {
    const [row] = await db
      .update(fixturesTable)
      .set({ scheduledAt: newScheduledAt, courtId: newCourtId ?? null, durationMinutes: newDuration, updatedAt: new Date() })
      .where(eq(fixturesTable.id, id))
      .returning();
    updated = row;
  } catch (e: any) {
    if (e.message?.includes("already booked")) {
      res.status(409).json({ error: "Court already booked during this time slot (DB-level enforcement)" });
      return;
    }
    throw e;
  }

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "fixture_rescheduled",
    entityType: fixture.entityType,
    entityId: String(fixture.entityId),
    before: JSON.stringify({ scheduledAt: oldScheduledAt, courtId: fixture.courtId }),
    after: JSON.stringify({ scheduledAt: newScheduledAt, courtId: newCourtId }),
  });

  const notified: number[] = [];
  if (notifyParties) {
    const teamIds: number[] = [];
    if (fixture.homeTeamId) teamIds.push(fixture.homeTeamId);
    if (fixture.awayTeamId) teamIds.push(fixture.awayTeamId);

    // Collect resolved DB user IDs for guardian fan-out after the member loop
    const affectedMembersForGuardian: { dbUserId: number }[] = [];

    if (teamIds.length > 0) {
      const members = await db.select().from(teamMembersTable).where(eq(teamMembersTable.status, "active"));
      const affectedMembers = members.filter((m) => teamIds.includes(m.teamId));
      const clerkIds = [...new Set(affectedMembers.map((m) => m.userId))];

      for (const clerkId of clerkIds) {
        const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
        if (!user) continue;
        await sendNotificationWithPreferences({
          userId: user.id,
          type: "schedule_change",
          subject: "Game rescheduled",
          body: `Your ${fixture.entityType} game has been rescheduled to ${newScheduledAt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`,
          metadata: { fixtureId: id },
        });
        notified.push(user.id);
        affectedMembersForGuardian.push({ dbUserId: user.id });
      }
    }

    const refs = await db
      .select()
      .from(assignmentsTable)
      .where(
        and(
          eq(assignmentsTable.entityType, fixture.entityType),
          eq(assignmentsTable.entityId, fixture.entityId),
        ),
      );
    for (const a of refs) {
      if (a.staffUserId && !notified.includes(a.staffUserId)) {
        await sendNotificationWithPreferences({
          userId: a.staffUserId,
          type: "schedule_change",
          subject: "Assignment rescheduled",
          body: `Your ref/coach/scorekeeper assignment has been rescheduled to ${newScheduledAt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`,
          metadata: { fixtureId: id },
        });
        notified.push(a.staffUserId);
      }
    }

    // Guardian fan-out: notify approved guardians of affected youth players on reschedule
    for (const member of affectedMembersForGuardian) {
      const guardians = await db
        .select()
        .from(guardiansTable)
        .where(
          and(
            eq(guardiansTable.youthUserId, member.dbUserId),
            eq(guardiansTable.status, "approved"),
          ),
        );
      for (const g of guardians) {
        if (!notified.includes(g.guardianUserId)) {
          await sendNotificationWithPreferences({
            userId: g.guardianUserId,
            type: "schedule_change",
            subject: "Your player's game has been rescheduled",
            body: `A game involving your player has been rescheduled to ${newScheduledAt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`,
            metadata: { fixtureId: id },
          });
          notified.push(g.guardianUserId);
        }
      }
    }
  }

  res.json({ fixture: updated!, notified: notified.length });
});

export default router;
