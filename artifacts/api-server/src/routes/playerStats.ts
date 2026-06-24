import { Router } from "express";
import { db, playerStatsTable, usersTable, guardiansTable } from "@workspace/db";
import { requireAuth, requireAdmin, type AuthedRequest } from "../middlewares/auth";
import { eq, desc, and, isNull } from "drizzle-orm";

const router = Router();

const AGE_GATE_YEARS = 16;

function isAdultOrOlderYouth(dateOfBirth: string | null | undefined): boolean {
  if (!dateOfBirth) return false;
  const dob = new Date(dateOfBirth);
  const age = (Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
  return age >= AGE_GATE_YEARS;
}

router.get("/player-stats/leaderboard", async (req, res) => {
  try {
    const metric = (req.query.metric as string) ?? "goals";
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
    const entityType = req.query.entityType as string | undefined;
    const entityId = req.query.entityId ? parseInt(req.query.entityId as string) : undefined;

    if (!entityType || !entityId) {
      return res.status(400).json({ error: "entityType and entityId are required. Use the leaderboard within an event page." });
    }

    const validMetrics = ["goals", "assists", "games", "streak"] as const;
    if (!validMetrics.includes(metric as any)) {
      return res.status(400).json({ error: "Invalid metric. Use goals | assists | games | streak" });
    }

    const orderCol =
      metric === "goals"
        ? playerStatsTable.goalsScored
        : metric === "assists"
          ? playerStatsTable.assists
          : metric === "games"
            ? playerStatsTable.gamesPlayed
            : playerStatsTable.bestAttendanceStreak;

    const rows = await db
      .select({
        userId: playerStatsTable.userId,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        dateOfBirth: usersTable.dateOfBirth,
        goalsScored: playerStatsTable.goalsScored,
        assists: playerStatsTable.assists,
        gamesPlayed: playerStatsTable.gamesPlayed,
        gamesAttended: playerStatsTable.gamesAttended,
        attendanceStreak: playerStatsTable.attendanceStreak,
        bestAttendanceStreak: playerStatsTable.bestAttendanceStreak,
      })
      .from(playerStatsTable)
      .innerJoin(usersTable, eq(playerStatsTable.userId, usersTable.id))
      .where(and(
        eq(playerStatsTable.entityType, entityType),
        eq(playerStatsTable.entityId, entityId),
      ))
      .orderBy(desc(orderCol))
      .limit(limit * 3);

    const eligible = rows.filter((r) => isAdultOrOlderYouth(r.dateOfBirth));
    const results = eligible.slice(0, limit).map((r, i) => ({
      rank: i + 1,
      userId: r.userId,
      displayName:
        r.firstName && r.lastName
          ? `${r.firstName} ${r.lastName[0]}.`
          : "Player",
      goalsScored: r.goalsScored,
      assists: r.assists,
      gamesPlayed: r.gamesPlayed,
      gamesAttended: r.gamesAttended,
      attendanceStreak: r.attendanceStreak,
      bestAttendanceStreak: r.bestAttendanceStreak,
    }));

    res.json(results);
  } catch (err) {
    console.error("[playerStats] leaderboard error:", err);
    res.status(500).json({ error: "Failed to load leaderboard" });
  }
});

router.get("/player-stats/me", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const [dbUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, req.clerkUserId));
    if (!dbUser) return res.status(401).json({ error: "User not found" });

    const seasonId = req.query.seasonId ? parseInt(req.query.seasonId as string) : undefined;

    const rows = await db
      .select()
      .from(playerStatsTable)
      .where(
        seasonId
          ? and(eq(playerStatsTable.userId, dbUser.id), eq(playerStatsTable.seasonId, seasonId))
          : and(eq(playerStatsTable.userId, dbUser.id), isNull(playerStatsTable.seasonId)),
      );

    if (rows.length === 0) {
      return res.json({
        userId: dbUser.id,
        goalsScored: 0,
        assists: 0,
        gamesPlayed: 0,
        gamesAttended: 0,
        attendanceStreak: 0,
        bestAttendanceStreak: 0,
      });
    }

    const totals = rows.reduce(
      (acc, r) => ({
        goalsScored: acc.goalsScored + r.goalsScored,
        assists: acc.assists + r.assists,
        gamesPlayed: acc.gamesPlayed + r.gamesPlayed,
        gamesAttended: acc.gamesAttended + r.gamesAttended,
        attendanceStreak: Math.max(acc.attendanceStreak, r.attendanceStreak),
        bestAttendanceStreak: Math.max(acc.bestAttendanceStreak, r.bestAttendanceStreak),
      }),
      { goalsScored: 0, assists: 0, gamesPlayed: 0, gamesAttended: 0, attendanceStreak: 0, bestAttendanceStreak: 0 },
    );

    res.json({ userId: dbUser.id, ...totals });
  } catch (err) {
    console.error("[playerStats] me error:", err);
    res.status(500).json({ error: "Failed to load stats" });
  }
});

router.get("/player-stats/:userId", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const [dbUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, req.clerkUserId));
    if (!dbUser) return res.status(401).json({ error: "User not found" });

    const targetUserId = parseInt(req.params.userId);
    const [targetUser] = await db.select().from(usersTable).where(eq(usersTable.id, targetUserId));
    if (!targetUser) return res.status(404).json({ error: "User not found" });

    const role = dbUser.role;
    const isSelf = dbUser.id === targetUserId;

    const canView =
      role === "admin" ||
      role === "staff" ||
      role === "coach" ||
      isSelf;

    let isApprovedGuardian = false;
    if (!canView && role === "parent") {
      const [guardianLink] = await db
        .select()
        .from(guardiansTable)
        .where(
          and(
            eq(guardiansTable.guardianUserId, dbUser.id),
            eq(guardiansTable.youthUserId, targetUserId),
            eq(guardiansTable.status, "approved"),
          ),
        );
      isApprovedGuardian = !!guardianLink;
    }

    if (!canView && !isApprovedGuardian) {
      return res.status(403).json({ error: "Access denied" });
    }

    const rows = await db
      .select()
      .from(playerStatsTable)
      .where(eq(playerStatsTable.userId, targetUserId));

    res.json(rows);
  } catch (err) {
    console.error("[playerStats] GET :userId error:", err);
    res.status(500).json({ error: "Failed to load stats" });
  }
});

router.post("/player-stats", requireAdmin, async (req: AuthedRequest, res) => {
  try {
    const {
      userId,
      seasonId,
      entityType,
      entityId,
      goalsScored,
      assists,
      gamesPlayed,
      gamesAttended,
      attendanceStreak,
      bestAttendanceStreak,
    } = req.body;

    if (!userId) return res.status(400).json({ error: "userId required" });

    const [row] = await db
      .insert(playerStatsTable)
      .values({
        userId,
        seasonId: seasonId ?? null,
        entityType: entityType ?? null,
        entityId: entityId ?? null,
        goalsScored: goalsScored ?? 0,
        assists: assists ?? 0,
        gamesPlayed: gamesPlayed ?? 0,
        gamesAttended: gamesAttended ?? 0,
        attendanceStreak: attendanceStreak ?? 0,
        bestAttendanceStreak: bestAttendanceStreak ?? 0,
      })
      .returning();

    res.status(201).json(row);
  } catch (err) {
    console.error("[playerStats] POST error:", err);
    res.status(500).json({ error: "Failed to upsert stats" });
  }
});

export default router;
