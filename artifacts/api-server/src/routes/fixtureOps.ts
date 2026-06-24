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
  db, fixturesTable, courtAvailabilityTable, auditLogTable,
  teamMembersTable, usersTable, assignmentsTable, paymentsTable,
  dropinsTable, campDaysTable, campsTable, guardiansTable,
} from "@workspace/db";
import { eq, and, lte, gte, ne, sql } from "drizzle-orm";
import { requirePermission, type AuthedRequest } from "../middlewares/auth";
import { sendNotificationWithPreferences } from "../services/notifications";
import { applyPolicy } from "./cancellationEngine";

const router: IRouter = Router();

/**
 * Application-level court conflict pre-check.
 * Half-open interval overlap: [A, A+dA) ∩ [B, B+dB) ≠ ∅  iff  A < B+dB  AND  A+dA > B.
 * Strict less-than on both sides: back-to-back events (one ends exactly when the next starts) are NOT conflicts.
 * The DB trigger is the authoritative enforcement; this check gives early user-friendly errors.
 */
async function hasCourtConflict(
  courtId: number,
  scheduledAt: Date,
  durationMinutes: number,
  excludeFixtureId?: number,
): Promise<{ conflict: boolean; reason?: string; conflictingFixtureId?: number }> {
  const newEndsAt = new Date(scheduledAt.getTime() + durationMinutes * 60 * 1000);

  // Overlap: existing.start < newEnd (strict)  AND  existing.end > newStart (strict, via raw SQL)
  const overlapping = await db
    .select()
    .from(fixturesTable)
    .where(
      and(
        eq(fixturesTable.courtId, courtId),
        ne(fixturesTable.status, "cancelled"),
        // existing start is strictly before new end (half-open: < not <=)
        sql`${fixturesTable.scheduledAt} < ${newEndsAt.toISOString()}::timestamptz`,
        // existing end (start + duration) is strictly after new start
        sql`${fixturesTable.scheduledAt} + (${fixturesTable.durationMinutes} * interval '1 minute') > ${scheduledAt.toISOString()}::timestamptz`,
      ),
    );

  const conflicts = overlapping.filter((f) => f.id !== excludeFixtureId);
  if (conflicts.length > 0) {
    return {
      conflict: true,
      reason: "Court already has a fixture during this time slot",
      conflictingFixtureId: conflicts[0].id,
    };
  }

  // Check court availability blocks
  const blocks = await db
    .select()
    .from(courtAvailabilityTable)
    .where(
      and(
        eq(courtAvailabilityTable.courtId, courtId),
        sql`${courtAvailabilityTable.startsAt} < ${newEndsAt.toISOString()}::timestamptz`,
        sql`${courtAvailabilityTable.endsAt} > ${scheduledAt.toISOString()}::timestamptz`,
      ),
    );
  if (blocks.length > 0) {
    return { conflict: true, reason: `Court is blocked: ${blocks[0].reason ?? "unavailable"}` };
  }

  // Check drop-ins (cross-offering conflict)
  const dropinConflicts = await db
    .select()
    .from(dropinsTable)
    .where(
      and(
        eq(dropinsTable.courtId, courtId),
        sql`${dropinsTable.startsAt} < ${newEndsAt.toISOString()}::timestamptz`,
        sql`${dropinsTable.startsAt} + (${dropinsTable.durationMinutes} * interval '1 minute') > ${scheduledAt.toISOString()}::timestamptz`,
        ne(dropinsTable.status, "cancelled"),
      ),
    );
  if (dropinConflicts.length > 0) {
    return { conflict: true, reason: `Court already has a drop-in session during this time slot` };
  }

  // Check camp days (cross-offering conflict)
  const campDayConflicts = await db
    .select({ id: campDaysTable.id, campName: campsTable.name })
    .from(campDaysTable)
    .innerJoin(campsTable, eq(campsTable.id, campDaysTable.campId))
    .where(
      and(
        eq(campsTable.courtId, courtId),
        sql`(${campDaysTable.date} + ${campDaysTable.startTime}::time)::timestamp AT TIME ZONE 'America/New_York' < ${newEndsAt.toISOString()}::timestamptz`,
        sql`(${campDaysTable.date} + ${campDaysTable.endTime}::time)::timestamp AT TIME ZONE 'America/New_York' > ${scheduledAt.toISOString()}::timestamptz`,
      ),
    );
  if (campDayConflicts.length > 0) {
    return { conflict: true, reason: `Court already has a camp day during this time slot` };
  }

  return { conflict: false };
}

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
  const result = await hasCourtConflict(
    parseInt(courtId),
    new Date(scheduledAt),
    parseInt(durationMinutes ?? "60"),
    isNaN(id) ? undefined : id,
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
    const check = await hasCourtConflict(newCourtId, newScheduledAt, newDuration, id);
    if (check.conflict) {
      res.status(409).json({ error: check.reason, conflictingFixtureId: check.conflictingFixtureId });
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
