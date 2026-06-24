/**
 * Game events routes — live scoring, fouls, and timeouts per fixture.
 *
 * GET  /fixtures/:id/events           — all events aggregated into scores + foul lists
 * POST /fixtures/:id/events           — record a new event (scorekeeper assigned to fixture, or admin/staff)
 * DELETE /fixtures/:id/events/:eid    — remove an erroneous event (admin/staff only)
 *
 * GET  /admin/fixtures/:id/scorekeeper          — get current scorekeeper assignment
 * POST /admin/fixtures/:id/scorekeeper          — assign a scorekeeper to a fixture
 * DELETE /admin/fixtures/:id/scorekeeper/:uid   — remove a scorekeeper assignment
 */
import { Router, type IRouter } from "express";
import {
  db, gameEventsTable, usersTable, assignmentsTable, fixturesTable, teamsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireAdmin, requirePermission, type AuthedRequest } from "../middlewares/auth";

const router: IRouter = Router();

async function getDbUser(clerkId: string) {
  const [u] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  return u ?? null;
}

/** Determine if the caller is allowed to record events for this fixture. */
async function canRecordEvents(dbUser: any, fixtureId: number): Promise<boolean> {
  if (dbUser.role === "admin" || dbUser.role === "staff") return true;
  const [assignment] = await db.select().from(assignmentsTable).where(
    and(
      eq(assignmentsTable.staffUserId, dbUser.id),
      eq(assignmentsTable.entityType, "fixture"),
      eq(assignmentsTable.entityId, fixtureId),
    ),
  );
  return !!assignment;
}

/**
 * GET /fixtures/:id/events
 * Returns all events for a fixture plus aggregated scores and foul lists.
 * Public — no auth required (live scoreboard view).
 */
router.get("/fixtures/:id/events", async (req: any, res): Promise<void> => {
  const fixtureId = parseInt(req.params.id);
  if (isNaN(fixtureId)) { res.status(400).json({ error: "Invalid fixture id" }); return; }

  const [fixture] = await db.select().from(fixturesTable).where(eq(fixturesTable.id, fixtureId));
  if (!fixture) { res.status(404).json({ error: "Fixture not found" }); return; }

  const events = await db.select().from(gameEventsTable)
    .where(eq(gameEventsTable.fixtureId, fixtureId))
    .orderBy(gameEventsTable.occurredAt);

  const homeTeamId = fixture.homeTeamId;
  const awayTeamId = fixture.awayTeamId;

  let homeScore = 0;
  let awayScore = 0;
  const homeFoulEvents: any[] = [];
  const awayFoulEvents: any[] = [];

  for (const ev of events) {
    const isHome = ev.teamId === homeTeamId;
    const isAway = ev.teamId === awayTeamId;
    if (ev.eventType === "score") {
      if (isHome) homeScore += ev.value;
      else if (isAway) awayScore += ev.value;
    } else if (ev.eventType === "foul") {
      if (isHome) homeFoulEvents.push(ev);
      else if (isAway) awayFoulEvents.push(ev);
    }
  }

  const homeTeam = homeTeamId
    ? (await db.select({ id: teamsTable.id, name: teamsTable.name }).from(teamsTable).where(eq(teamsTable.id, homeTeamId)))[0] ?? null
    : null;
  const awayTeam = awayTeamId
    ? (await db.select({ id: teamsTable.id, name: teamsTable.name }).from(teamsTable).where(eq(teamsTable.id, awayTeamId)))[0] ?? null
    : null;

  res.json({
    fixtureId,
    homeScore,
    awayScore,
    homeTeam,
    awayTeam,
    homeFouls: homeFoulEvents.length,
    awayFouls: awayFoulEvents.length,
    homeFoulEvents,
    awayFoulEvents,
    events,
  });
});

/**
 * POST /fixtures/:id/events
 * Record a new game event. Caller must be assigned to the fixture or be admin/staff.
 * Body: { teamId?, eventType, playerId?, value? }
 */
router.post("/fixtures/:id/events", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const fixtureId = parseInt(req.params.id);
  if (isNaN(fixtureId)) { res.status(400).json({ error: "Invalid fixture id" }); return; }

  const [fixture] = await db.select().from(fixturesTable).where(eq(fixturesTable.id, fixtureId));
  if (!fixture) { res.status(404).json({ error: "Fixture not found" }); return; }

  const dbUser = await getDbUser(authed.clerkUserId);
  if (!dbUser) { res.status(401).json({ error: "User not found" }); return; }

  const allowed = await canRecordEvents(dbUser, fixtureId);
  if (!allowed) {
    res.status(403).json({ error: "You must be assigned to this fixture to record events" });
    return;
  }

  const { teamId, eventType, playerId, value } = req.body as {
    teamId?: number;
    eventType: string;
    playerId?: number;
    value?: number;
  };

  if (!eventType || !["score", "foul", "timeout", "half_end", "game_end"].includes(eventType)) {
    res.status(400).json({ error: "eventType must be one of: score, foul, timeout, half_end, game_end" });
    return;
  }

  // Validate teamId belongs to this fixture's teams
  if (teamId != null) {
    const validTeams = [fixture.homeTeamId, fixture.awayTeamId].filter(Boolean);
    if (validTeams.length > 0 && !validTeams.includes(teamId)) {
      res.status(400).json({ error: "teamId must be one of the fixture's home or away teams" });
      return;
    }
  }

  const [event] = await db.insert(gameEventsTable).values({
    fixtureId,
    teamId: teamId ?? null,
    eventType,
    playerId: playerId ?? null,
    value: value ?? 1,
    recordedByUserId: dbUser.id,
    occurredAt: new Date(),
  }).returning();

  res.status(201).json(event);
});

/**
 * DELETE /fixtures/:id/events/:eid
 * Remove an erroneous event. Admin/staff only.
 */
router.delete("/fixtures/:id/events/:eid", requirePermission("canManageGameCards"), async (req: any, res): Promise<void> => {
  const fixtureId = parseInt(req.params.id);
  const eventId = parseInt(req.params.eid);
  if (isNaN(fixtureId) || isNaN(eventId)) {
    res.status(400).json({ error: "Invalid fixture or event id" });
    return;
  }

  const [deleted] = await db.delete(gameEventsTable)
    .where(and(eq(gameEventsTable.id, eventId), eq(gameEventsTable.fixtureId, fixtureId)))
    .returning();

  if (!deleted) { res.status(404).json({ error: "Event not found" }); return; }
  res.json({ deleted: true, event: deleted });
});

// ── Scorekeeper Assignment ────────────────────────────────────────────────────

/**
 * GET /admin/fixtures/:id/scorekeeper
 * Returns the current scorekeeper assignment(s) for a fixture.
 */
router.get("/admin/fixtures/:id/scorekeeper", requirePermission("canManageAssignments"), async (req: any, res): Promise<void> => {
  const fixtureId = parseInt(req.params.id);
  if (isNaN(fixtureId)) { res.status(400).json({ error: "Invalid fixture id" }); return; }

  const assignments = await db.select({
    id: assignmentsTable.id,
    staffUserId: assignmentsTable.staffUserId,
    status: assignmentsTable.status,
    notes: assignmentsTable.notes,
    firstName: usersTable.firstName,
    lastName: usersTable.lastName,
  })
    .from(assignmentsTable)
    .leftJoin(usersTable, eq(assignmentsTable.staffUserId, usersTable.id))
    .where(
      and(
        eq(assignmentsTable.entityType, "fixture"),
        eq(assignmentsTable.entityId, fixtureId),
        eq(assignmentsTable.role, "scorekeeper"),
      ),
    );

  res.json({ fixtureId, scorekeepers: assignments });
});

/**
 * POST /admin/fixtures/:id/scorekeeper
 * Assign a scorekeeper to a fixture. Body: { userId, notes? }
 */
router.post("/admin/fixtures/:id/scorekeeper", requirePermission("canManageAssignments"), async (req: any, res): Promise<void> => {
  const fixtureId = parseInt(req.params.id);
  if (isNaN(fixtureId)) { res.status(400).json({ error: "Invalid fixture id" }); return; }

  const [fixture] = await db.select().from(fixturesTable).where(eq(fixturesTable.id, fixtureId));
  if (!fixture) { res.status(404).json({ error: "Fixture not found" }); return; }

  const { userId, notes } = req.body as { userId: number; notes?: string };
  if (!userId || isNaN(Number(userId))) {
    res.status(400).json({ error: "userId is required" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, Number(userId)));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  // Remove existing scorekeeper assignments for this fixture to avoid duplicates
  await db.delete(assignmentsTable).where(
    and(
      eq(assignmentsTable.entityType, "fixture"),
      eq(assignmentsTable.entityId, fixtureId),
      eq(assignmentsTable.role, "scorekeeper"),
    ),
  );

  const [assignment] = await db.insert(assignmentsTable).values({
    staffUserId: Number(userId),
    entityType: "fixture",
    entityId: fixtureId,
    role: "scorekeeper",
    status: "assigned",
    startAt: fixture.scheduledAt,
    endAt: fixture.scheduledAt
      ? new Date(new Date(fixture.scheduledAt).getTime() + (fixture.durationMinutes ?? 60) * 60_000)
      : null,
    notes: notes ?? null,
  }).returning();

  res.status(201).json({ assigned: true, assignment, user: { id: user.id, firstName: user.firstName, lastName: user.lastName } });
});

/**
 * DELETE /admin/fixtures/:id/scorekeeper/:uid
 * Remove a scorekeeper assignment by user id.
 */
router.delete("/admin/fixtures/:id/scorekeeper/:uid", requirePermission("canManageAssignments"), async (req: any, res): Promise<void> => {
  const fixtureId = parseInt(req.params.id);
  const userId = parseInt(req.params.uid);
  if (isNaN(fixtureId) || isNaN(userId)) {
    res.status(400).json({ error: "Invalid fixture or user id" });
    return;
  }

  await db.delete(assignmentsTable).where(
    and(
      eq(assignmentsTable.staffUserId, userId),
      eq(assignmentsTable.entityType, "fixture"),
      eq(assignmentsTable.entityId, fixtureId),
      eq(assignmentsTable.role, "scorekeeper"),
    ),
  );

  res.json({ removed: true, fixtureId, userId });
});

export default router;
