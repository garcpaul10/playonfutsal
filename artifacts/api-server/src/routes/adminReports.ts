import { Router, type IRouter } from "express";
import { db, registrationsTable, referralsTable, referralConfigTable, usersTable, leaguesTable, campsTable, dropinsTable, tournamentsTable, seasonsTable, spotsTable } from "@workspace/db";
import { eq, ne, sql, desc, gte, lte, and, isNotNull, inArray } from "drizzle-orm";
import { requirePermission, requireSuperAdmin, type AuthedRequest } from "../middlewares/auth";
import type { Request, Response } from "express";

const router: IRouter = Router();

router.get("/admin/reports/participation", requirePermission("canViewReports"), async (req: Request, res: Response): Promise<void> => {
  const { from, to, type: offeringType } = req.query as Record<string, string>;

  const conditions: ReturnType<typeof eq>[] = [];
  if (offeringType) conditions.push(eq(registrationsTable.programType, offeringType));

  let regsQuery = db.select({
    id: registrationsTable.id,
    programType: registrationsTable.programType,
    programId: registrationsTable.programId,
    status: registrationsTable.status,
    createdAt: registrationsTable.createdAt,
  }).from(registrationsTable).$dynamic();

  if (conditions.length) regsQuery = regsQuery.where(conditions[0]);

  const regs = await regsQuery;

  const filtered = regs.filter(r => {
    const d = new Date(r.createdAt);
    if (from && d < new Date(from)) return false;
    if (to && d > new Date(to + "T23:59:59")) return false;
    return true;
  });

  const byMonth: Record<string, Record<string, number>> = {};
  const byType: Record<string, number> = {};
  
  for (const r of filtered) {
    const month = new Date(r.createdAt).toISOString().slice(0, 7);
    if (!byMonth[month]) byMonth[month] = {};
    byMonth[month][r.programType] = (byMonth[month][r.programType] ?? 0) + 1;
    byType[r.programType] = (byType[r.programType] ?? 0) + 1;
  }

  const monthlyData = Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, types]) => ({ month, ...types, total: Object.values(types).reduce((s, v) => s + v, 0) }));

  const [leagues, camps, dropins, tournaments] = await Promise.all([
    db.select({ id: leaguesTable.id, ageGroup: leaguesTable.ageGroup, name: leaguesTable.name }).from(leaguesTable),
    db.select({ id: campsTable.id, ageGroup: campsTable.ageGroup, name: campsTable.name }).from(campsTable),
    db.select({ id: dropinsTable.id, ageGroup: dropinsTable.ageGroup, name: dropinsTable.name }).from(dropinsTable),
    db.select({ id: tournamentsTable.id, ageGroup: tournamentsTable.ageGroup, name: tournamentsTable.name }).from(tournamentsTable),
  ]);

  const ageGroupMap: Record<string, { id: number; ageGroup: string }> = {};
  for (const l of leagues) ageGroupMap[`league-${l.id}`] = { id: l.id, ageGroup: l.ageGroup };
  for (const c of camps) ageGroupMap[`camp-${c.id}`] = { id: c.id, ageGroup: c.ageGroup };
  for (const d of dropins) ageGroupMap[`drop_in-${d.id}`] = { id: d.id, ageGroup: d.ageGroup };
  for (const t of tournaments) ageGroupMap[`tournament-${t.id}`] = { id: t.id, ageGroup: t.ageGroup };

  const byAgeGroup: Record<string, number> = {};
  for (const r of filtered) {
    const key = `${r.programType}-${r.programId}`;
    const ag = ageGroupMap[key]?.ageGroup ?? "unknown";
    byAgeGroup[ag] = (byAgeGroup[ag] ?? 0) + 1;
  }

  // ── Spots fallback for drop-in participants ──────────────────────────────────
  // The normal drop-in booking path creates a spot row but NOT a registrations row.
  // Supplement the registrations-based counts with active spots that aren't already
  // covered by a registrations entry for the same user+session combination.
  if (!offeringType || offeringType === "drop_in") {
    const allDropinSpots = await db
      .select({
        userId: spotsTable.userId,
        entityId: spotsTable.entityId,
        createdAt: spotsTable.createdAt,
      })
      .from(spotsTable)
      .where(
        and(
          eq(spotsTable.entityType, "dropin"),
          eq(spotsTable.status, "reserved"),
          eq(spotsTable.waitlisted, false),
        ),
      );

    if (allDropinSpots.length > 0) {
      // Get clerkIds for spot user IDs so we can cross-reference with registrations.userId (clerkId)
      const spotUserIdInts = [...new Set(allDropinSpots.map((s) => s.userId).filter((id): id is number => id != null))];
      let spotUserMap = new Map<number, string>(); // userId (int) → clerkId
      if (spotUserIdInts.length > 0) {
        const spotUsers = await db
          .select({ id: usersTable.id, clerkId: usersTable.clerkId })
          .from(usersTable)
          .where(inArray(usersTable.id, spotUserIdInts));
        spotUserMap = new Map(spotUsers.map((u) => [u.id, u.clerkId]));
      }

      // Build (clerkId + entityId) key set from all drop_in registrations for precise dedup
      const allDropinRegs = await db
        .select({ userId: registrationsTable.userId, programId: registrationsTable.programId })
        .from(registrationsTable)
        .where(eq(registrationsTable.programType, "drop_in"));

      const regKeySet = new Set<string>(
        allDropinRegs.map((r) => `${r.userId}-${r.programId}`),
      );

      // Track unique (userId-int, entityId) pairs seen so far to avoid double-counting
      // if a player somehow has multiple spot rows for the same session.
      const seenSpotKeys = new Set<string>();

      for (const spot of allDropinSpots) {
        if (!spot.userId) continue;
        const clerkId = spotUserMap.get(spot.userId);
        if (!clerkId) continue;

        // Skip if this user+session is already counted via registrations
        const regKey = `${clerkId}-${spot.entityId}`;
        if (regKeySet.has(regKey)) continue;

        // Skip duplicate spot rows for the same user+session
        const spotKey = `${spot.userId}-${spot.entityId}`;
        if (seenSpotKeys.has(spotKey)) continue;
        seenSpotKeys.add(spotKey);

        // Apply date filter using spot.createdAt
        const d = new Date(spot.createdAt);
        if (from && d < new Date(from)) continue;
        if (to && d > new Date(to + "T23:59:59")) continue;

        // Count this extra spot as a drop_in participation in all three aggregations
        byType["drop_in"] = (byType["drop_in"] ?? 0) + 1;

        const month = d.toISOString().slice(0, 7);
        if (!byMonth[month]) byMonth[month] = {};
        byMonth[month]["drop_in"] = (byMonth[month]["drop_in"] ?? 0) + 1;

        // Update byAgeGroup using the dropin session's ageGroup (same ageGroupMap as registrations path)
        const ag = (ageGroupMap[`drop_in-${spot.entityId}`]?.ageGroup as any) ?? "unknown";
        byAgeGroup[ag] = (byAgeGroup[ag] ?? 0) + 1;
      }

      // Rebuild monthlyData to reflect any added spot contributions
      const updatedMonthlyData = Object.entries(byMonth)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, types]) => ({ month, ...types, total: Object.values(types).reduce((s, v) => s + v, 0) }));

      res.json({
        total: Object.values(byType).reduce((s, v) => s + v, 0),
        byType,
        byAgeGroup,
        monthlyData: updatedMonthlyData,
      });
      return;
    }
  }

  res.json({
    total: filtered.length,
    byType,
    byAgeGroup,
    monthlyData,
  });
});

router.get("/admin/reports/retention", requirePermission("canViewReports"), async (_req: Request, res: Response): Promise<void> => {
  const seasons = await db.select().from(seasonsTable).orderBy(desc(seasonsTable.startDate));
  const allRegs = await db.select({
    id: registrationsTable.id,
    userId: registrationsTable.userId,
    programType: registrationsTable.programType,
    createdAt: registrationsTable.createdAt,
  }).from(registrationsTable).where(ne(registrationsTable.status, "cancelled"));

  const userFirstSeen: Record<string, Date> = {};
  for (const r of allRegs) {
    const uid = r.userId;
    const d = new Date(r.createdAt);
    if (!userFirstSeen[uid] || d < userFirstSeen[uid]) {
      userFirstSeen[uid] = d;
    }
  }

  const data = seasons.map(s => {
    const start = s.startDate ? new Date(s.startDate) : null;
    const end = s.endDate ? new Date(s.endDate + "T23:59:59") : null;

    const seasonRegs = allRegs.filter(r => {
      const d = new Date(r.createdAt);
      if (start && d < start) return false;
      if (end && d > end) return false;
      return true;
    });

    const uniqueUserIds = [...new Set(seasonRegs.map(r => r.userId))];

    let newPlayers = 0;
    let returningPlayers = 0;
    for (const uid of uniqueUserIds) {
      const first = userFirstSeen[uid];
      if (!start || !first || first.getTime() >= start.getTime()) {
        newPlayers++;
      } else {
        returningPlayers++;
      }
    }

    return {
      seasonId: s.id,
      seasonName: s.name,
      startDate: s.startDate,
      endDate: s.endDate,
      totalPlayers: uniqueUserIds.length,
      newPlayers,
      returningPlayers,
      retentionRate: uniqueUserIds.length > 0
        ? Math.round((returningPlayers / uniqueUserIds.length) * 100)
        : 0,
    };
  });

  const totalPlayers = await db.select({ count: sql<number>`count(distinct ${usersTable.id})` }).from(usersTable);
  const allTimeUnique = new Set(allRegs.map(r => r.userId).filter(Boolean)).size;

  res.json({
    seasons: data,
    summary: {
      totalRegisteredUsers: Number(totalPlayers[0]?.count ?? 0),
      totalActivePlayers: allTimeUnique,
    },
  });
});

router.get("/admin/referrals", requirePermission("canViewReports"), async (_req: Request, res: Response): Promise<void> => {
  const refs = await db.select({
    id: referralsTable.id,
    code: referralsTable.code,
    status: referralsTable.status,
    rewardCreditCents: referralsTable.rewardCreditCents,
    createdAt: referralsTable.createdAt,
    redeemedAt: referralsTable.redeemedAt,
    referrerEmail: usersTable.email,
    referrerId: referralsTable.referrerId,
    referredUserId: referralsTable.referredUserId,
  }).from(referralsTable)
    .leftJoin(usersTable, eq(usersTable.id, referralsTable.referrerId))
    .where(isNotNull(referralsTable.referredUserId))
    .orderBy(desc(referralsTable.createdAt));

  res.json(refs);
});

router.get("/admin/referrals/config", requirePermission("canViewReports"), async (_req: Request, res: Response): Promise<void> => {
  let [cfg] = await db.select().from(referralConfigTable).where(eq(referralConfigTable.id, 1));
  if (!cfg) {
    [cfg] = await db.insert(referralConfigTable).values({ id: 1 }).returning();
  }
  res.json(cfg);
});

router.patch("/admin/referrals/config", requireSuperAdmin, async (req: Request, res: Response): Promise<void> => {
  const { rewardCreditCents, isEnabled } = req.body as { rewardCreditCents?: number; isEnabled?: boolean };
  const updates: Partial<{ rewardCreditCents: number; isEnabled: boolean }> = {};
  if (rewardCreditCents !== undefined) updates.rewardCreditCents = rewardCreditCents;
  if (isEnabled !== undefined) updates.isEnabled = isEnabled;

  if (!Object.keys(updates).length) { res.status(400).json({ error: "No fields to update" }); return; }

  const [cfg] = await db.update(referralConfigTable).set(updates).where(eq(referralConfigTable.id, 1)).returning();
  if (!cfg) {
    await db.insert(referralConfigTable).values({ id: 1, ...updates });
    const [fresh] = await db.select().from(referralConfigTable).where(eq(referralConfigTable.id, 1));
    res.json(fresh);
    return;
  }
  res.json(cfg);
});

export default router;
