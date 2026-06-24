import { Router, type IRouter } from "express";
import {
  db, leaguesTable, tournamentsTable, teamsTable, fixturesTable, standingsTable, checkInsTable,
  usersTable, teamMembersTable, leagueRegistrationsTable, leagueFreeAgentsTable,
  waiverTemplatesTable, waiverSignaturesTable, teamInvitesTable, playerProfilesTable,
  leagueDivisionsTable, ageGroupWaiversTable,
  isEventActive,
} from "@workspace/db";
import { checkUsysAgeEligibility } from "../lib/usysAgeEligibility";
import { eq, and, or, asc, sql, ne } from "drizzle-orm";
import { requireAuth, requireAdmin, requirePermission, hasPermission, type AuthedRequest } from "../middlewares/auth";
import { getAuth } from "@clerk/express";
import { ensureGameCard, ensureGameCardsForEntity } from "../services/gameCardService";
import { runAIPlacement, runPlacementChecks } from "../services/teamPlacement";
import { runAIFreeAgentMatch, scoreTeam, type TeamCandidate, type FreeAgentProfile } from "../services/freeAgentMatcher";
import { sendNotification, sendNotificationWithPreferences } from "../services/notifications";
import { randomUUID } from "crypto";

const router: IRouter = Router();

const normalizeAgeGroup = (raw: unknown): string[] => {
  if (Array.isArray(raw)) return (raw as string[]).filter((v) => typeof v === "string" && v.length > 0);
  if (typeof raw === "string" && raw.length > 0) return [raw];
  return ["adult"];
};

const parseLeague = (l: any) => ({
  ...l,
  registrationPrice: Number(l.registrationPrice),
  ageGroup: normalizeAgeGroup(l.ageGroup),
  tiebreakerRules: (() => { try { return JSON.parse(l.tiebreakerRules || "[]"); } catch { return []; } })(),
});

async function getDbUser(clerkId: string) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  return user;
}

export async function recomputeStandings(leagueId: number, divisionId?: number | null) {
  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));

  // Get all divisions for this league (or just the specified one)
  const divisions = divisionId
    ? await db.select().from(leagueDivisionsTable).where(and(eq(leagueDivisionsTable.leagueId, leagueId), eq(leagueDivisionsTable.id, divisionId)))
    : await db.select().from(leagueDivisionsTable).where(eq(leagueDivisionsTable.leagueId, leagueId));

  // If divisions exist, recompute per-division; otherwise fall back to league-wide
  if (divisions.length > 0) {
    for (const div of divisions) {
      await _recomputeDivisionStandings(leagueId, div.id, league);
    }
    return;
  }

  // Legacy fallback: no divisions — recompute league-wide
  await _recomputeLeagueWideStandings(leagueId, league);
}

async function _recomputeDivisionStandings(leagueId: number, divisionId: number, league: any) {
  const completedFixtures = await db.select().from(fixturesTable)
    .where(and(
      eq(fixturesTable.entityType, "league"),
      eq(fixturesTable.entityId, leagueId),
      eq(fixturesTable.status, "completed"),
      eq(fixturesTable.divisionId, divisionId),
    ));

  const teamsInDivision = await db.select().from(teamsTable).where(eq(teamsTable.divisionId, divisionId));
  const teamIds = teamsInDivision.map((t) => t.id);
  if (!teamIds.length) return;

  const statsMap = _buildStatsMap(teamIds, completedFixtures);
  const sorted = _sortByTiebreaker(teamIds, statsMap, league);

  await db.delete(standingsTable).where(and(eq(standingsTable.leagueId, leagueId), eq(standingsTable.divisionId, divisionId)));

  for (let i = 0; i < sorted.length; i++) {
    const { tid, gamesPlayed, wins, draws, losses, goalsFor, goalsAgainst, gd, points } = sorted[i];
    await db.insert(standingsTable).values({
      leagueId, divisionId, seasonId: league?.seasonId ?? null, teamId: tid,
      gamesPlayed, wins, draws, losses, goalsFor, goalsAgainst, goalDifference: gd, points, rank: i + 1,
    } as typeof standingsTable.$inferInsert);
  }
}

type StatsMap = Record<number, { gamesPlayed: number; wins: number; draws: number; losses: number; goalsFor: number; goalsAgainst: number; points: number }>;
type StatsRow = { tid: number; gd: number; gamesPlayed: number; wins: number; draws: number; losses: number; goalsFor: number; goalsAgainst: number; points: number };

function _buildStatsMap(teamIds: number[], fixtures: any[]): StatsMap {
  const statsMap: StatsMap = {};
  for (const tid of teamIds) {
    statsMap[tid] = { gamesPlayed: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, points: 0 };
  }
  for (const f of fixtures) {
    const hs = f.homeScore ?? 0;
    const as_ = f.awayScore ?? 0;
    if (f.homeTeamId && statsMap[f.homeTeamId] !== undefined) {
      statsMap[f.homeTeamId].gamesPlayed++;
      statsMap[f.homeTeamId].goalsFor += hs;
      statsMap[f.homeTeamId].goalsAgainst += as_;
      if (hs > as_) { statsMap[f.homeTeamId].wins++; statsMap[f.homeTeamId].points += 3; }
      else if (hs === as_) { statsMap[f.homeTeamId].draws++; statsMap[f.homeTeamId].points += 1; }
      else { statsMap[f.homeTeamId].losses++; }
    }
    if (f.awayTeamId && statsMap[f.awayTeamId] !== undefined) {
      statsMap[f.awayTeamId].gamesPlayed++;
      statsMap[f.awayTeamId].goalsFor += as_;
      statsMap[f.awayTeamId].goalsAgainst += hs;
      if (as_ > hs) { statsMap[f.awayTeamId].wins++; statsMap[f.awayTeamId].points += 3; }
      else if (hs === as_) { statsMap[f.awayTeamId].draws++; statsMap[f.awayTeamId].points += 1; }
      else { statsMap[f.awayTeamId].losses++; }
    }
  }
  return statsMap;
}

function _sortByTiebreaker(teamIds: number[], statsMap: StatsMap, league: any): StatsRow[] {
  const normalizeKey = (k: string): string => {
    const map: Record<string, string> = {
      goal_difference: "goalDifference", goals_for: "goalsFor",
      goals_against: "goalsAgainst", games_played: "gamesPlayed",
      head_to_head: "goalDifference",
    };
    return map[k] ?? k;
  };

  let rules: string[] = ["points", "goalDifference", "goalsFor"];
  try {
    const parsed = JSON.parse(league?.tiebreakerRules ?? "[]");
    if (Array.isArray(parsed) && parsed.length > 0) {
      const normalized = parsed.map(normalizeKey);
      rules = normalized[0] === "points" ? normalized : ["points", ...normalized];
    }
  } catch { /* keep default */ }

  const getValue = (row: StatsRow, rule: string): number => {
    switch (rule) {
      case "points": return row.points;
      case "goalDifference": return row.gd;
      case "goalsFor": return row.goalsFor;
      case "goalsAgainst": return -row.goalsAgainst;
      case "wins": return row.wins;
      case "gamesPlayed": return -row.gamesPlayed;
      default: return 0;
    }
  };

  return teamIds
    .map((tid) => ({ tid, ...statsMap[tid], gd: statsMap[tid].goalsFor - statsMap[tid].goalsAgainst }))
    .sort((a, b) => {
      for (const rule of rules) {
        const diff = getValue(b, rule) - getValue(a, rule);
        if (diff !== 0) return diff;
      }
      return 0;
    });
}

async function _recomputeLeagueWideStandings(leagueId: number, league: any) {
  const completedFixtures = await db.select().from(fixturesTable)
    .where(and(eq(fixturesTable.entityType, "league"), eq(fixturesTable.entityId, leagueId), eq(fixturesTable.status, "completed")));

  const teamsInLeague = await db.select().from(teamsTable).where(eq(teamsTable.leagueId, leagueId));
  const teamIds = teamsInLeague.map((t) => t.id);
  if (!teamIds.length) return;

  const statsMap = _buildStatsMap(teamIds, completedFixtures);
  const sorted = _sortByTiebreaker(teamIds, statsMap, league);

  await db.delete(standingsTable).where(and(eq(standingsTable.leagueId, leagueId), sql`division_id IS NULL`));

  for (let i = 0; i < sorted.length; i++) {
    const { tid, gamesPlayed, wins, draws, losses, goalsFor, goalsAgainst, gd, points } = sorted[i];
    const row = { leagueId, seasonId: league?.seasonId ?? null, teamId: tid, gamesPlayed, wins, draws, losses, goalsFor, goalsAgainst, goalDifference: gd, points, rank: i + 1 };
    await db.insert(standingsTable).values(row as any);
  }
}

function generateRoundRobin(n: number): { homeIdx: number; awayIdx: number; round: number }[] {
  const fixtures: { homeIdx: number; awayIdx: number; round: number }[] = [];
  const teams = Array.from({ length: n }, (_, i) => i);
  const hasBye = n % 2 !== 0;
  if (hasBye) teams.push(-1);
  const numRounds = teams.length - 1;
  const half = Math.floor(teams.length / 2);
  const rotatable = teams.slice(1);

  for (let round = 0; round < numRounds; round++) {
    const current = [teams[0], ...rotatable];
    for (let i = 0; i < half; i++) {
      const home = current[i];
      const away = current[current.length - 1 - i];
      if (home !== -1 && away !== -1) fixtures.push({ homeIdx: home, awayIdx: away, round: round + 1 });
    }
    rotatable.unshift(rotatable.pop()!);
  }
  return fixtures;
}

// ─── League CRUD ───────────────────────────────────────────────────────────────

router.get("/leagues", async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req as any);
  const isAdmin = clerkId ? await hasPermission(clerkId, "canManageLeagues") : false;
  let leagues = await db.select().from(leaguesTable).orderBy(asc(leaguesTable.startDate));
  const { seasonId, ageGroup, status } = req.query as Record<string, string>;
  if (seasonId) leagues = leagues.filter((l) => l.seasonId === Number(seasonId));
  if (ageGroup) leagues = leagues.filter((l) => normalizeAgeGroup(l.ageGroup).includes(ageGroup));
  if (status) leagues = leagues.filter((l) => l.status === status);
  if (!isAdmin) leagues = leagues.filter((l) => isEventActive(l));
  res.json(leagues.map(parseLeague));
});

router.post("/leagues", requirePermission("canManageLeagues"), async (req, res): Promise<void> => {
  const b = req.body;
  const ageGroupArr = normalizeAgeGroup(b.ageGroup);
  if (!b.name || !ageGroupArr.length || !b.courtId || !b.seasonId) {
    res.status(400).json({ error: "name, ageGroup (at least one), courtId, seasonId required" });
    return;
  }
  const [league] = await db.insert(leaguesTable).values({ ...b, ageGroup: ageGroupArr } as typeof leaguesTable.$inferInsert).returning();
  res.status(201).json(parseLeague(league));
});

router.get("/leagues/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, id));
  if (!league) { res.status(404).json({ error: "League not found" }); return; }
  res.json(parseLeague(league));
});

router.patch("/leagues/:id", requirePermission("canManageLeagues"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const patch: any = { ...req.body, updatedAt: new Date() };
  if (req.body.ageGroup !== undefined) patch.ageGroup = normalizeAgeGroup(req.body.ageGroup);
  const [league] = await db.update(leaguesTable).set(patch as any).where(eq(leaguesTable.id, id)).returning();
  if (!league) { res.status(404).json({ error: "League not found" }); return; }
  res.json(parseLeague(league));
});

router.delete("/leagues/:id", requirePermission("canManageLeagues"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [deleted] = await db.delete(leaguesTable).where(eq(leaguesTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "League not found" }); return; }
  res.sendStatus(204);
});

// ─── Division CRUD ─────────────────────────────────────────────────────────────

router.get("/leagues/:id/divisions", async (req, res): Promise<void> => {
  const leagueId = Number(req.params.id);
  const divisions = await db.select().from(leagueDivisionsTable)
    .where(eq(leagueDivisionsTable.leagueId, leagueId))
    .orderBy(asc(leagueDivisionsTable.divisionOrder), asc(leagueDivisionsTable.createdAt));
  const enriched = await Promise.all(divisions.map(async (d) => {
    const [{ teamCount }] = await db.select({ teamCount: sql<number>`count(*)::int` })
      .from(teamsTable).where(eq(teamsTable.divisionId, d.id));
    return { ...d, teamCount };
  }));
  res.json(enriched);
});

router.post("/leagues/:id/divisions", requirePermission("canManageLeagues"), async (req, res): Promise<void> => {
  const leagueId = Number(req.params.id);
  const { name, ageGroups = [], format, divisionOrder = 0 } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: "name required" }); return; }
  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  if (!league) { res.status(404).json({ error: "League not found" }); return; }
  const [div] = await db.insert(leagueDivisionsTable).values({
    leagueId, name: name.trim(),
    ageGroups: Array.isArray(ageGroups) ? ageGroups : [ageGroups],
    format: format ?? null,
    divisionOrder,
  } as typeof leagueDivisionsTable.$inferInsert).returning();
  res.status(201).json(div);
});

router.patch("/leagues/:id/divisions/:divId", requirePermission("canManageLeagues"), async (req, res): Promise<void> => {
  const leagueId = Number(req.params.id);
  const divId = Number(req.params.divId);
  const [div] = await db.select().from(leagueDivisionsTable)
    .where(and(eq(leagueDivisionsTable.id, divId), eq(leagueDivisionsTable.leagueId, leagueId)));
  if (!div) { res.status(404).json({ error: "Division not found" }); return; }
  const { name, ageGroups, format, divisionOrder } = req.body;
  const patch: any = { updatedAt: new Date() };
  if (name !== undefined) patch.name = name.trim();
  if (ageGroups !== undefined) patch.ageGroups = Array.isArray(ageGroups) ? ageGroups : [ageGroups];
  if (format !== undefined) patch.format = format ?? null;
  if (divisionOrder !== undefined) patch.divisionOrder = divisionOrder;
  const [updated] = await db.update(leagueDivisionsTable).set(patch).where(eq(leagueDivisionsTable.id, divId)).returning();
  res.json(updated);
});

router.delete("/leagues/:id/divisions/:divId", requirePermission("canManageLeagues"), async (req, res): Promise<void> => {
  const leagueId = Number(req.params.id);
  const divId = Number(req.params.divId);
  const [div] = await db.select().from(leagueDivisionsTable)
    .where(and(eq(leagueDivisionsTable.id, divId), eq(leagueDivisionsTable.leagueId, leagueId)));
  if (!div) { res.status(404).json({ error: "Division not found" }); return; }
  // Prevent deleting the last division in a league
  const [{ cnt }] = await db.select({ cnt: sql<number>`count(*)::int` }).from(leagueDivisionsTable).where(eq(leagueDivisionsTable.leagueId, leagueId));
  if (cnt <= 1) { res.status(400).json({ error: "Cannot delete the only division. Add another division first." }); return; }
  // Prevent deletion when competitive data exists — deleting would orphan teams/fixtures/standings
  const [{ teamCnt }] = await db.select({ teamCnt: sql<number>`count(*)::int` }).from(teamsTable).where(eq(teamsTable.divisionId, divId));
  const [{ fixtureCnt }] = await db.select({ fixtureCnt: sql<number>`count(*)::int` }).from(fixturesTable).where(eq(fixturesTable.divisionId, divId));
  const [{ standingsCnt }] = await db.select({ standingsCnt: sql<number>`count(*)::int` }).from(standingsTable).where(eq(standingsTable.divisionId, divId));
  if ((teamCnt + fixtureCnt + standingsCnt) > 0) {
    res.status(400).json({ error: `Cannot delete division — it has ${teamCnt} team(s), ${fixtureCnt} fixture(s), and ${standingsCnt} standings row(s). Reassign or remove them first.` });
    return;
  }
  await db.delete(leagueDivisionsTable).where(eq(leagueDivisionsTable.id, divId));
  res.sendStatus(204);
});

router.patch("/leagues/:id/override", requirePermission("canManageLeagues"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { activeOverride } = req.body;
  if (activeOverride !== null && activeOverride !== "active" && activeOverride !== "closed") {
    res.status(400).json({ error: "activeOverride must be 'active', 'closed', or null" }); return;
  }
  const [league] = await db.update(leaguesTable).set({ activeOverride: activeOverride ?? null, updatedAt: new Date() } as Partial<typeof leaguesTable.$inferInsert>).where(eq(leaguesTable.id, id)).returning();
  if (!league) { res.status(404).json({ error: "League not found" }); return; }
  res.json(parseLeague(league));
});

// ─── Teams in a league ─────────────────────────────────────────────────────────

router.get("/leagues/:id/teams", async (req, res): Promise<void> => {
  const leagueId = Number(req.params.id);

  // Determine if caller has admin/staff access (used to gate PII and payment data)
  const { userId: clerkId } = getAuth(req as any);
  const isAdmin = clerkId ? await hasPermission(clerkId, "canManageLeagues") : false;

  const teams = await db.select().from(teamsTable).where(eq(teamsTable.leagueId, leagueId));
  const regs = isAdmin
    ? await db.select().from(leagueRegistrationsTable).where(eq(leagueRegistrationsTable.leagueId, leagueId))
    : [];

  const result = await Promise.all(teams.map(async (t) => {
    const members = await db.select().from(teamMembersTable).where(and(eq(teamMembersTable.teamId, t.id), eq(teamMembersTable.status, "active")));
    const memberProfiles = await Promise.all(members.map(async (m) => {
      const [u] = await db.select().from(usersTable).where(eq(usersTable.clerkId, m.userId));
      const userPayload = u
        ? isAdmin
          ? { id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email, qrCode: u.qrCode, playonId: u.playonId }
          : { id: u.id, firstName: u.firstName, lastName: u.lastName }  // public: no email/PII
        : null;
      return { ...m, user: userPayload };
    }));
    const reg = isAdmin ? (regs.find((r) => r.teamId === t.id) ?? null) : undefined;
    return { ...t, registration: reg, members: memberProfiles };
  }));
  res.json(result);
});

// Admin: create team + registration record directly
router.post("/leagues/:id/teams", requirePermission("canManageLeagues"), async (req, res): Promise<void> => {
  const leagueId = Number(req.params.id);
  const { name, captainUserId, depositPaid = false, notes } = req.body;
  if (!name) { res.status(400).json({ error: "Team name required" }); return; }

  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  if (!league) { res.status(404).json({ error: "League not found" }); return; }

  // Capacity check: determine if league is full and team should be waitlisted
  const [{ currentCount }] = await db.select({ currentCount: sql<number>`count(*)::int` })
    .from(teamsTable).where(eq(teamsTable.leagueId, leagueId));
  const maxTeams = (league as any).maxTeams ?? 0;
  const isWaitlisted = maxTeams > 0 && currentCount >= maxTeams;

  // Resolve divisionId: use explicitly passed value, or default to the first division in the league
  // For multi-division leagues, an explicit divisionId is required.
  let resolvedDivisionId: number | null = req.body.divisionId ? Number(req.body.divisionId) : null;
  if (!isWaitlisted) {
    const allDivisions = await db.select().from(leagueDivisionsTable)
      .where(eq(leagueDivisionsTable.leagueId, leagueId))
      .orderBy(asc(leagueDivisionsTable.divisionOrder));
    if (allDivisions.length > 1 && !resolvedDivisionId) {
      res.status(400).json({ error: "This league has multiple divisions. Provide a divisionId to specify which division the team belongs to." });
      return;
    }
    if (resolvedDivisionId) {
      const div = allDivisions.find((d) => d.id === resolvedDivisionId);
      if (!div) { res.status(400).json({ error: "Division does not belong to this league" }); return; }
    } else {
      resolvedDivisionId = allDivisions[0]?.id ?? null;
    }
  }

  const [team] = await db.insert(teamsTable).values({
    name,
    // Only link team to league immediately if not waitlisted
    leagueId: isWaitlisted ? null : leagueId,
    divisionId: isWaitlisted ? null : resolvedDivisionId,
    seasonId: league.seasonId,
    captainUserId: captainUserId || null,
    status: isWaitlisted ? "pending" : (depositPaid ? "active" : "pending"),
  } as typeof teamsTable.$inferInsert).returning();

  const total = Number(league.registrationPrice);
  const deposit = total * 0.5;
  const regStatus = isWaitlisted ? "waitlisted" : (depositPaid ? "confirmed" : "pending");
  const [reg] = await db.insert(leagueRegistrationsTable).values({
    leagueId,
    teamId: team.id,
    registeredByUserId: captainUserId || "admin",
    depositAmount: deposit.toFixed(2),
    depositPaid: isWaitlisted ? false : depositPaid,
    depositPaidAt: (!isWaitlisted && depositPaid) ? new Date() : null,
    totalAmount: total.toFixed(2),
    amountPaid: (!isWaitlisted && depositPaid) ? deposit.toFixed(2) : "0",
    balanceDue: (!isWaitlisted && depositPaid) ? (total - deposit).toFixed(2) : total.toFixed(2),
    paymentStatus: isWaitlisted ? "unpaid" : (depositPaid ? "partial" : "unpaid"),
    status: regStatus,
    notes: isWaitlisted
      ? `Waitlisted — league at capacity (${currentCount}/${maxTeams}). ${notes || ""}`.trim()
      : (notes || null),
  } as typeof leagueRegistrationsTable.$inferInsert).returning();

  if (!isWaitlisted) {
    await db.update(leaguesTable).set({ teamsRegistered: (league.teamsRegistered ?? 0) + 1, updatedAt: new Date() } as Partial<typeof leaguesTable.$inferInsert>).where(eq(leaguesTable.id, leagueId));
    await db.insert(standingsTable).values({ leagueId, divisionId: resolvedDivisionId, seasonId: league.seasonId, teamId: team.id } as typeof standingsTable.$inferInsert).onConflictDoNothing();
  }

  if (captainUserId) {
    await db.insert(teamMembersTable).values({ teamId: team.id, userId: captainUserId, role: "captain", status: "active" } as typeof teamMembersTable.$inferInsert);
  }

  const placement = await runAIPlacement({
    teamId: team.id,
    teamName: name,
    offeringId: leagueId,
    offeringName: league.name,
    offeringType: "league",
    currentCount,
    maxTeams,
    ageGroup: (league as any).ageGroup ?? null,
    format: (league as any).format ?? null,
  });

  res.status(201).json({ team, registration: reg, placement });
});

// Update deposit/payment status for a team's league registration
router.patch("/leagues/:id/teams/:teamId/registration", requirePermission("canManageLeagues"), async (req, res): Promise<void> => {
  const leagueId = Number(req.params.id);
  const teamId = Number(req.params.teamId);
  const { depositPaid, amountPaid, paymentStatus, status, notes, paymentMethod } = req.body;

  const [reg] = await db.select().from(leagueRegistrationsTable)
    .where(and(eq(leagueRegistrationsTable.leagueId, leagueId), eq(leagueRegistrationsTable.teamId, teamId)));
  if (!reg) { res.status(404).json({ error: "Registration not found" }); return; }

  const updates: any = { updatedAt: new Date() };
  if (depositPaid !== undefined) { updates.depositPaid = depositPaid; if (depositPaid) updates.depositPaidAt = new Date(); }
  if (amountPaid !== undefined) {
    updates.amountPaid = String(amountPaid);
    updates.balanceDue = (Number(reg.totalAmount) - Number(amountPaid)).toFixed(2);
    updates.balanceOverriddenByAdmin = true;
  }
  if (paymentStatus) updates.paymentStatus = paymentStatus;
  if (paymentMethod) updates.paymentMethod = paymentMethod;
  if (status) {
    updates.status = status;
    if (status === "confirmed") updates.confirmedAt = new Date();
    await db.update(teamsTable).set({ status, updatedAt: new Date() } as Partial<typeof teamsTable.$inferInsert>).where(eq(teamsTable.id, teamId));
  }
  if (notes !== undefined) updates.notes = notes;

  const [updated] = await db.update(leagueRegistrationsTable).set(updates).where(eq(leagueRegistrationsTable.id, reg.id)).returning();

  // FIFO auto-promotion: only when an actively-counted slot is freed up.
  // Waitlisted registrations were never included in teamsRegistered, so cancelling
  // them must not decrement the count or trigger promotion.
  const priorStatusCounted = ["active", "confirmed", "pending"].includes(reg.status as string);
  if ((status === "cancelled" || status === "withdrawn") && priorStatusCounted) {
    // 1. Unlink the cancelled team from the league and decrement counter
    await db.update(teamsTable)
      .set({ leagueId: null, status: "inactive", updatedAt: new Date() } as Partial<typeof teamsTable.$inferInsert>)
      .where(eq(teamsTable.id, teamId));
    await db.update(leaguesTable)
      .set({ teamsRegistered: sql`GREATEST(${leaguesTable.teamsRegistered} - 1, 0)`, updatedAt: new Date() } as Partial<typeof leaguesTable.$inferInsert>)
      .where(eq(leaguesTable.id, leagueId));

    // 2. Promote the first waitlisted team (FIFO by waitlist position, then createdAt)
    const [waitlisted] = await db.select().from(leagueRegistrationsTable)
      .where(and(
        eq(leagueRegistrationsTable.leagueId, leagueId),
        eq(leagueRegistrationsTable.status, "waitlisted" as string),
      ))
      .orderBy(asc(leagueRegistrationsTable.waitlistPosition), asc(leagueRegistrationsTable.createdAt))
      .limit(1);

    if (waitlisted && waitlisted.teamId) {
      // Resolve default division for the promoted team
      const [firstDiv] = await db.select().from(leagueDivisionsTable)
        .where(eq(leagueDivisionsTable.leagueId, leagueId))
        .orderBy(asc(leagueDivisionsTable.divisionOrder))
        .limit(1);
      const promotionDivisionId = firstDiv?.id ?? null;

      await db.update(leagueRegistrationsTable)
        .set({ status: "pending", waitlistPosition: null, updatedAt: new Date() } as Partial<typeof leagueRegistrationsTable.$inferInsert>)
        .where(eq(leagueRegistrationsTable.id, waitlisted.id));
      await db.update(teamsTable)
        .set({ leagueId, divisionId: promotionDivisionId, status: "pending", updatedAt: new Date() } as Partial<typeof teamsTable.$inferInsert>)
        .where(eq(teamsTable.id, waitlisted.teamId));
      await db.update(leaguesTable)
        .set({ teamsRegistered: sql`${leaguesTable.teamsRegistered} + 1`, updatedAt: new Date() } as Partial<typeof leaguesTable.$inferInsert>)
        .where(eq(leaguesTable.id, leagueId));
      await db.insert(standingsTable).values({ leagueId, divisionId: promotionDivisionId, seasonId: league?.seasonId, teamId: waitlisted.teamId } as typeof standingsTable.$inferInsert).onConflictDoNothing();

      // Renumber remaining waitlisted regs for this league
      const remaining = await db.select().from(leagueRegistrationsTable)
        .where(and(eq(leagueRegistrationsTable.leagueId, leagueId), eq(leagueRegistrationsTable.status, "waitlisted" as string)))
        .orderBy(asc(leagueRegistrationsTable.waitlistPosition), asc(leagueRegistrationsTable.createdAt));
      for (let i = 0; i < remaining.length; i++) {
        await db.update(leagueRegistrationsTable)
          .set({ waitlistPosition: i + 1, updatedAt: new Date() } as Partial<typeof leagueRegistrationsTable.$inferInsert>)
          .where(eq(leagueRegistrationsTable.id, remaining[i].id));
      }

      // Notify promoted team captain (non-blocking)
      try {
        const [promotedTeam] = await db.select().from(teamsTable).where(eq(teamsTable.id, waitlisted.teamId));
        if (promotedTeam?.captainUserId) {
          const [captainUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, promotedTeam.captainUserId));
          if (captainUser) {
            await sendNotificationWithPreferences({
              userId: captainUser.id,
              type: "waitlist_movement",
              subject: `Your team is off the waitlist for ${league?.name ?? "the league"}!`,
              body: `Great news! Your team "${promotedTeam.name}" has moved off the waitlist and is now registered for ${league?.name ?? "the league"}.`,
            });
          }
        }
      } catch (notifErr) {
        console.error("[leagues] waitlist auto-promote notification failed:", notifErr);
      }
    }
  }

  res.json(updated);
});

// Admin: list waitlisted registrations for a league
router.get("/leagues/:id/waitlist", requirePermission("canManageLeagues"), async (req, res): Promise<void> => {
  const leagueId = Number(req.params.id);
  const regs = await db.select().from(leagueRegistrationsTable)
    .where(and(eq(leagueRegistrationsTable.leagueId, leagueId), eq(leagueRegistrationsTable.status, "waitlisted" as string)))
    .orderBy(asc(leagueRegistrationsTable.waitlistPosition), asc(leagueRegistrationsTable.createdAt));
  const enriched = await Promise.all(regs.map(async (r) => {
    const [team] = r.teamId ? await db.select().from(teamsTable).where(eq(teamsTable.id, r.teamId)) : [null];
    const [user] = team?.captainUserId ? await db.select().from(usersTable).where(eq(usersTable.clerkId, team.captainUserId)) : [null];
    return { ...r, team: team ?? null, captain: user ? { id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email } : null };
  }));
  res.json(enriched);
});

// Admin: manually promote a specific waitlisted registration
router.post("/leagues/:id/waitlist/:regId/promote", requirePermission("canManageLeagues"), async (req, res): Promise<void> => {
  const leagueId = Number(req.params.id);
  const regId = Number(req.params.regId);

  const [reg] = await db.select().from(leagueRegistrationsTable)
    .where(and(eq(leagueRegistrationsTable.id, regId), eq(leagueRegistrationsTable.leagueId, leagueId), eq(leagueRegistrationsTable.status, "waitlisted" as string)));
  if (!reg) { res.status(404).json({ error: "Waitlisted registration not found" }); return; }

  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));

  // Resolve default division for manual promotion
  const [firstDivForPromotion] = await db.select().from(leagueDivisionsTable)
    .where(eq(leagueDivisionsTable.leagueId, leagueId))
    .orderBy(asc(leagueDivisionsTable.divisionOrder))
    .limit(1);
  const manualPromotionDivisionId = firstDivForPromotion?.id ?? null;

  await db.update(leagueRegistrationsTable)
    .set({ status: "pending", waitlistPosition: null, updatedAt: new Date() } as Partial<typeof leagueRegistrationsTable.$inferInsert>)
    .where(eq(leagueRegistrationsTable.id, regId));
  if (reg.teamId) {
    await db.update(teamsTable).set({ leagueId, divisionId: manualPromotionDivisionId, status: "pending", updatedAt: new Date() } as Partial<typeof teamsTable.$inferInsert>).where(eq(teamsTable.id, reg.teamId));
    await db.insert(standingsTable).values({ leagueId, divisionId: manualPromotionDivisionId, seasonId: league?.seasonId, teamId: reg.teamId } as typeof standingsTable.$inferInsert).onConflictDoNothing();
  }
  await db.update(leaguesTable)
    .set({ teamsRegistered: sql`${leaguesTable.teamsRegistered} + 1`, updatedAt: new Date() } as Partial<typeof leaguesTable.$inferInsert>)
    .where(eq(leaguesTable.id, leagueId));

  // Renumber remaining waitlisted regs
  const remaining = await db.select().from(leagueRegistrationsTable)
    .where(and(eq(leagueRegistrationsTable.leagueId, leagueId), eq(leagueRegistrationsTable.status, "waitlisted" as string)))
    .orderBy(asc(leagueRegistrationsTable.waitlistPosition), asc(leagueRegistrationsTable.createdAt));
  for (let i = 0; i < remaining.length; i++) {
    await db.update(leagueRegistrationsTable)
      .set({ waitlistPosition: i + 1, updatedAt: new Date() } as Partial<typeof leagueRegistrationsTable.$inferInsert>)
      .where(eq(leagueRegistrationsTable.id, remaining[i].id));
  }

  // Notify promoted team captain (non-blocking)
  if (reg.teamId) {
    try {
      const [promotedTeam] = await db.select().from(teamsTable).where(eq(teamsTable.id, reg.teamId));
      if (promotedTeam?.captainUserId) {
        const [captainUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, promotedTeam.captainUserId));
        if (captainUser) {
          await sendNotificationWithPreferences({
            userId: captainUser.id,
            type: "waitlist_movement",
            subject: `Your team is off the waitlist for ${league?.name ?? "the league"}!`,
            body: `Great news! Your team "${promotedTeam.name}" has moved off the waitlist and is now registered for ${league?.name ?? "the league"}.`,
          });
        }
      }
    } catch (notifErr) {
      console.error("[leagues] waitlist manual-promote notification failed:", notifErr);
    }
  }

  const [updated] = await db.select().from(leagueRegistrationsTable).where(eq(leagueRegistrationsTable.id, regId));
  res.json(updated);
});

// ─── Team members ──────────────────────────────────────────────────────────────

/** Roles that carry team management permissions */
const TEAM_MANAGING_ROLES = ["captain", "manager", "coach"] as const;

/** Returns true if clerkUserId has management permissions on teamId */
async function canManageTeam(clerkUserId: string, team: { id: number; captainUserId: string | null }): Promise<boolean> {
  if (await hasPermission(clerkUserId, "canManageLeagues")) return true;
  if (team.captainUserId === clerkUserId) return true;
  const [member] = await db.select().from(teamMembersTable)
    .where(and(
      eq(teamMembersTable.teamId, team.id),
      eq(teamMembersTable.userId, clerkUserId),
      eq(teamMembersTable.status, "active"),
    ));
  return !!member && (TEAM_MANAGING_ROLES as readonly string[]).includes(member.role);
}

router.get("/teams/:teamId/members", requireAuth, async (req, res): Promise<void> => {
  const teamId = Number(req.params.teamId);
  const clerkUserId = (req as AuthedRequest).clerkUserId;

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }

  const isAdmin = await hasPermission(clerkUserId, "canManageLeagues");
  const isManaging = await canManageTeam(clerkUserId, team);

  // Check if caller is a member of this team
  const [isMember] = await db.select().from(teamMembersTable)
    .where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, clerkUserId), eq(teamMembersTable.status, "active")));

  if (!isManaging && !isMember) {
    res.status(403).json({ error: "Only team members, managers, coaches, or an admin can view the roster" });
    return;
  }

  const members = await db.select().from(teamMembersTable).where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.status, "active")));
  const enriched = await Promise.all(members.map(async (m) => {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.clerkId, m.userId));
    // Admin and managing roles get full PII; plain members see name only
    const userPayload = u
      ? (isAdmin || isManaging)
        ? { id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email, qrCode: u.qrCode, playonId: u.playonId }
        : { id: u.id, firstName: u.firstName, lastName: u.lastName }
      : null;
    return { ...m, user: userPayload };
  }));
  res.json(enriched);
});

router.post("/teams/:teamId/members", requireAuth, async (req, res): Promise<void> => {
  const teamId = Number(req.params.teamId);
  const clerkUserId = (req as AuthedRequest).clerkUserId;
  const { userId, role = "player" } = req.body;
  if (!userId) { res.status(400).json({ error: "userId required" }); return; }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }

  let eventAgeGroup: string[] | null = null;
  let eventStartDate: Date | null = null;

  if ((team as any).leagueId) {
    const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, (team as any).leagueId));
    if (league && !isEventActive(league)) { res.status(403).json({ error: "Event is not currently active" }); return; }
    if (league) {
      const ag = Array.isArray(league.ageGroup) ? league.ageGroup as string[] : (league.ageGroup ? [league.ageGroup as string] : null);
      if (ag) eventAgeGroup = ag;
      if ((league as any).startsAt) eventStartDate = new Date((league as any).startsAt);
    }
  }
  if ((team as any).tournamentId) {
    const [tournament] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, (team as any).tournamentId));
    if (tournament && !isEventActive(tournament)) { res.status(403).json({ error: "Event is not currently active" }); return; }
    if (tournament) {
      const ag = Array.isArray(tournament.ageGroup) ? tournament.ageGroup as string[] : (tournament.ageGroup ? [tournament.ageGroup as string] : null);
      if (ag) eventAgeGroup = ag;
      if ((tournament as any).startsAt) eventStartDate = new Date((tournament as any).startsAt);
    }
  }

  if (!await canManageTeam(clerkUserId, team)) {
    res.status(403).json({ error: "Only team captain, manager, coach, or admin can add members" });
    return;
  }

  if (eventAgeGroup && eventAgeGroup.length > 0) {
    const [playerUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, userId));
    if (playerUser) {
      const waivers = await db.select().from(ageGroupWaiversTable).where(
        and(eq(ageGroupWaiversTable.playerId, playerUser.id), eq(ageGroupWaiversTable.status, "approved"))
      );
      const waivedGroups = waivers.map((w) => w.ageGroup);
      const refDate = eventStartDate ?? new Date();
      const ageError = checkUsysAgeEligibility(eventAgeGroup, playerUser.dateOfBirth, refDate, waivedGroups);
      if (ageError) { res.status(422).json({ error: ageError }); return; }
    }
  }

  const [member] = await db.insert(teamMembersTable).values({ teamId, userId, role, status: "active" } as typeof teamMembersTable.$inferInsert).returning();
  res.status(201).json(member);
});

router.delete("/teams/:teamId/members/:memberId", requireAuth, async (req, res): Promise<void> => {
  const teamId = Number(req.params.teamId);
  const memberId = Number(req.params.memberId);
  const clerkUserId = (req as AuthedRequest).clerkUserId;

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }

  if ((team as any).leagueId) {
    const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, (team as any).leagueId));
    if (league && !isEventActive(league)) { res.status(403).json({ error: "Event is not currently active" }); return; }
  }
  if ((team as any).tournamentId) {
    const [tournament] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, (team as any).tournamentId));
    if (tournament && !isEventActive(tournament)) { res.status(403).json({ error: "Event is not currently active" }); return; }
  }

  if (!await canManageTeam(clerkUserId, team)) {
    res.status(403).json({ error: "Only team captain, manager, coach, or admin can remove members" });
    return;
  }

  await db.update(teamMembersTable).set({ status: "removed", updatedAt: new Date() } as Partial<typeof teamMembersTable.$inferInsert>)
    .where(and(eq(teamMembersTable.id, memberId), eq(teamMembersTable.teamId, teamId)));
  res.sendStatus(204);
});

// ─── Player self-registration (public) ────────────────────────────────────────

router.post("/leagues/:id/register", requireAuth, async (req, res): Promise<void> => {
  const leagueId = Number(req.params.id);
  const clerkUserId = (req as AuthedRequest).clerkUserId;
  const { teamName, waiverSigned = false, jerseyColor, estimatedRosterSize, blackoutDates } = req.body;
  const requestedDivisionId: number | null = req.body.divisionId ? Number(req.body.divisionId) : null;

  if (!teamName?.trim()) { res.status(400).json({ error: "teamName required" }); return; }

  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  if (!league) { res.status(404).json({ error: "League not found" }); return; }
  if (!isEventActive(league)) { res.status(403).json({ error: "Event is not currently active" }); return; }
  if (!league.registrationOpen) { res.status(400).json({ error: "Registration is currently closed" }); return; }
  if (league.status === "completed") { res.status(400).json({ error: "This season has ended" }); return; }
  const isFull = (league.teamsRegistered ?? 0) >= league.maxTeams;

  // Resolve divisionId — require explicit selection for multi-division leagues
  let resolvedDivisionId: number | null = null;
  if (!isFull) {
    const allDivisions = await db.select().from(leagueDivisionsTable)
      .where(eq(leagueDivisionsTable.leagueId, leagueId))
      .orderBy(asc(leagueDivisionsTable.divisionOrder));
    if (allDivisions.length > 1 && !requestedDivisionId) {
      res.status(400).json({ error: "This league has multiple divisions. Select a division to register your team into." });
      return;
    }
    if (requestedDivisionId) {
      const div = allDivisions.find((d) => d.id === requestedDivisionId);
      if (!div) { res.status(400).json({ error: "Division does not belong to this league" }); return; }
      // Age-group eligibility: if division has ageGroups defined and teamAgeGroup was supplied, enforce match
      const teamAgeGroup: string | null = req.body.teamAgeGroup ?? null;
      const divAgeGroups: string[] = Array.isArray((div as any).ageGroups) ? (div as any).ageGroups : [];
      if (teamAgeGroup && divAgeGroups.length > 0 && !divAgeGroups.includes(teamAgeGroup)) {
        res.status(400).json({ error: `Your team's age group (${teamAgeGroup}) is not eligible for division "${(div as any).name}" (accepts: ${divAgeGroups.join(", ")})` });
        return;
      }
      resolvedDivisionId = div.id;
    } else {
      resolvedDivisionId = allDivisions[0]?.id ?? null;
    }
  }

  // Check if player is already on a team in this league
  const existingTeams = await db.select().from(teamsTable).where(eq(teamsTable.leagueId, leagueId));
  for (const t of existingTeams) {
    const [mem] = await db.select().from(teamMembersTable)
      .where(and(eq(teamMembersTable.teamId, t.id), eq(teamMembersTable.userId, clerkUserId), eq(teamMembersTable.status, "active")));
    if (mem) { res.status(409).json({ error: "already_registered", message: "You are already registered in this league" }); return; }
  }

  // Server-side waiver gate: check that the player has a valid, non-expired signature
  // on file — do not trust the client-sent waiverSigned boolean for legal gating.
  const [activeWaiver] = await db.select().from(waiverTemplatesTable).where(eq(waiverTemplatesTable.isActive, true));
  if (activeWaiver) {
    const dbUser = await getDbUser(clerkUserId);
    const now = new Date();
    const validSig = dbUser
      ? await db.select().from(waiverSignaturesTable)
          .where(and(eq(waiverSignaturesTable.userId, dbUser.id)))
          .orderBy(sql`signed_at DESC`)
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : null;
    const sigValid = validSig && (!validSig.expiresAt || validSig.expiresAt > now);
    if (!sigValid) {
      res.status(400).json({ error: "A valid waiver signature is required before registering", waiverId: activeWaiver.id });
      return;
    }
  }

  // Compute waitlist position if league is full
  let waitlistPosition: number | null = null;
  if (isFull) {
    const [{ wlCount }] = await db.select({ wlCount: sql<number>`count(*)::int` })
      .from(leagueRegistrationsTable)
      .where(and(eq(leagueRegistrationsTable.leagueId, leagueId), eq(leagueRegistrationsTable.status, "waitlisted" as string)));
    waitlistPosition = (wlCount ?? 0) + 1;
  }

  // Create team + captain membership + registration record
  const [team] = await db.insert(teamsTable).values({
    name: teamName.trim(),
    leagueId: isFull ? null : leagueId,
    divisionId: isFull ? null : resolvedDivisionId,
    seasonId: league.seasonId,
    captainUserId: clerkUserId,
    status: isFull ? "pending" : "pending",
    color: jerseyColor ?? null,
  } as typeof teamsTable.$inferInsert).returning();

  const total = Number(league.registrationPrice);
  const deposit = +(total * 0.5).toFixed(2);

  let reg: any;
  try {
    [reg] = await db.insert(leagueRegistrationsTable).values({
      leagueId,
      teamId: team.id,
      registeredByUserId: clerkUserId,
      depositAmount: deposit.toFixed(2),
      depositPaid: false,
      totalAmount: total.toFixed(2),
      amountPaid: "0",
      balanceDue: total.toFixed(2),
      paymentStatus: "unpaid" as const,
      status: isFull ? "waitlisted" as const : "pending" as const,
      waitlistPosition: waitlistPosition ?? undefined,
      waiverSigned: waiverSigned && !!activeWaiver,
      waiverSignedAt: waiverSigned ? new Date() : null,
      waiverTemplateId: activeWaiver?.id ?? null,
      notes: JSON.stringify({ estimatedRosterSize: estimatedRosterSize ?? null, blackoutDates: Array.isArray(blackoutDates) ? blackoutDates : [] }),
    } as typeof leagueRegistrationsTable.$inferInsert).returning();
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "already_registered", message: "This team is already registered for this league" });
      return;
    }
    throw err;
  }

  await db.insert(teamMembersTable).values({
    teamId: team.id, userId: clerkUserId, role: "captain", status: "active",
    waiverSigned: waiverSigned && !!activeWaiver,
    waiverSignedAt: waiverSigned ? new Date() : null,
    waiverTemplateId: activeWaiver?.id ?? null,
  } as typeof teamMembersTable.$inferInsert);

  if (!isFull) {
    await db.update(leaguesTable)
      .set({ teamsRegistered: (league.teamsRegistered ?? 0) + 1, updatedAt: new Date() } as Partial<typeof leaguesTable.$inferInsert>)
      .where(eq(leaguesTable.id, leagueId));
    await db.insert(standingsTable).values({ leagueId, divisionId: resolvedDivisionId, seasonId: league.seasonId, teamId: team.id } as typeof standingsTable.$inferInsert).onConflictDoNothing();
  }

  if (activeWaiver && waiverSigned) {
    const dbUser = await getDbUser(clerkUserId);
    if (dbUser) {
      await db.insert(waiverSignaturesTable).values({ templateId: activeWaiver.id, userId: dbUser.id, entityType: "league", entityId: leagueId } as typeof waiverSignaturesTable.$inferInsert);
    }
  }

  res.status(201).json({
    team, registration: reg,
    waitlisted: isFull,
    waitlistPosition,
    message: isFull
      ? `League is full. You have been added to the waitlist at position #${waitlistPosition}.`
      : "Registration successful. Please contact admin to arrange deposit payment.",
  });
});

// ─── Free agents ───────────────────────────────────────────────────────────────

router.get("/leagues/:id/free-agents", async (req, res): Promise<void> => {
  const leagueId = Number(req.params.id);

  const { userId: clerkId } = getAuth(req as any);
  const isAdmin = clerkId ? await hasPermission(clerkId, "canManageLeagues") : false;

  // Team managing roles (captain, manager, coach) in this league may also view free agents
  let isLeagueTeamManager = false;
  if (!isAdmin && clerkId) {
    const leagueTeams = await db.select().from(teamsTable).where(eq(teamsTable.leagueId, leagueId));
    for (const team of leagueTeams) {
      if (await canManageTeam(clerkId, team)) { isLeagueTeamManager = true; break; }
    }
  }

  if (!isAdmin && !isLeagueTeamManager) { res.status(403).json({ error: "Admin or team manager/captain/coach access required" }); return; }

  const agents = await db.select().from(leagueFreeAgentsTable).where(eq(leagueFreeAgentsTable.leagueId, leagueId));
  const enriched = await Promise.all(agents.map(async (a) => {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.clerkId, a.userId));
    return { ...a, user: u ? { id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email } : null };
  }));
  res.json(enriched);
});

router.post("/leagues/:id/free-agents", requireAuth, async (req, res): Promise<void> => {
  const leagueId = Number(req.params.id);
  const clerkUserId = (req as AuthedRequest).clerkUserId;
  const { waiverSigned = false, notes, positions, skillLevel, availability } = req.body;

  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  if (!league) { res.status(404).json({ error: "League not found" }); return; }
  if (!league.allowFreeAgents) { res.status(400).json({ error: "Free agent registration not available" }); return; }
  if (!league.registrationOpen) { res.status(400).json({ error: "Registration is closed" }); return; }

  const existing = await db.select().from(leagueFreeAgentsTable)
    .where(and(eq(leagueFreeAgentsTable.leagueId, leagueId), eq(leagueFreeAgentsTable.userId, clerkUserId)));
  if (existing.length) { res.status(409).json({ error: "Already registered as free agent" }); return; }

  const [activeWaiver] = await db.select().from(waiverTemplatesTable).where(eq(waiverTemplatesTable.isActive, true));
  if (activeWaiver && !waiverSigned) {
    res.status(400).json({ error: "Waiver signature required", waiverId: activeWaiver.id, waiverBody: activeWaiver.body });
    return;
  }

  const [agent] = await db.insert(leagueFreeAgentsTable).values({
    leagueId, userId: clerkUserId, status: "confirmed",
    waiverSigned: waiverSigned && !!activeWaiver,
    waiverSignedAt: waiverSigned ? new Date() : null,
    waiverTemplateId: activeWaiver?.id ?? null,
    notes: notes || null,
    positions: positions ? JSON.stringify(positions) : null,
    skillLevel: skillLevel || null,
    availability: availability ? JSON.stringify(availability) : null,
    matchStatus: "unmatched",
  } as typeof leagueFreeAgentsTable.$inferInsert).returning();

  if (activeWaiver && waiverSigned) {
    const dbUser = await getDbUser(clerkUserId);
    if (dbUser) {
      await db.insert(waiverSignaturesTable).values({ templateId: activeWaiver.id, userId: dbUser.id, entityType: "league", entityId: leagueId } as typeof waiverSignaturesTable.$inferInsert);
    }
  }

  // Auto-trigger AI matching in the background (fire and forget)
  triggerFreeAgentMatching(leagueId, agent.id).catch(() => {});

  res.status(201).json(agent);
});

/** Trigger AI matching for a free agent against all available teams in the league */
async function triggerFreeAgentMatching(leagueId: number, freeAgentId: number): Promise<void> {
  const [agent] = await db.select().from(leagueFreeAgentsTable).where(eq(leagueFreeAgentsTable.id, freeAgentId));
  if (!agent || agent.matchStatus !== "unmatched") return;

  const agentProfile: FreeAgentProfile = {
    positions: agent.positions ? JSON.parse(agent.positions) : [],
    skillLevel: agent.skillLevel ?? "intermediate",
    availability: agent.availability ? JSON.parse(agent.availability) : { days: [], timePreference: "any" },
  };

  // Get already-declined teams (from notes convention)
  const declinedTeamIds: number[] = (() => {
    try { return agent.notes ? JSON.parse(agent.notes)?.declinedTeams ?? [] : []; } catch { return []; }
  })();

  const teams = await db.select().from(teamsTable)
    .where(and(eq(teamsTable.leagueId, leagueId)));

  if (teams.length === 0) return;

  const candidates: TeamCandidate[] = await Promise.all(teams.map(async (t) => {
    const members = await db.select().from(teamMembersTable)
      .where(and(eq(teamMembersTable.teamId, t.id), eq(teamMembersTable.status, "active")));
    const memberProfiles = await Promise.all(members.map(async (m) => {
      const [u] = await db.select().from(usersTable).where(eq(usersTable.clerkId, m.userId));
      if (!u) return null;
      const [profile] = await db.select().from(playerProfilesTable).where(eq(playerProfilesTable.userId, u.id));
      return profile;
    }));
    const validProfiles = memberProfiles.filter(Boolean);
    return {
      teamId: t.id,
      teamName: t.name,
      memberCount: members.length,
      memberPositions: validProfiles.flatMap((p) => [p?.primaryPosition, p?.secondaryPosition].filter(Boolean) as string[]),
      memberSkillLevels: validProfiles.map((p) => p?.fitnessLevel ?? "recreational").filter(Boolean),
      blackoutDates: [],
      jerseyColor: (t as any).color ?? null,
    };
  }));

  const match = await runAIFreeAgentMatch(agentProfile, candidates, declinedTeamIds);
  if (!match) return;

  await db.update(leagueFreeAgentsTable).set({
    matchStatus: "team_reviewing",
    proposedTeamId: match.teamId,
    proposedAt: new Date(),
    matchReasoning: match.reasoning,
    updatedAt: new Date(),
  } as Partial<typeof leagueFreeAgentsTable.$inferInsert>).where(eq(leagueFreeAgentsTable.id, freeAgentId));

  // Notify the team captain about the proposed free agent (in-app + email)
  const [captainMember] = await db.select().from(teamMembersTable)
    .where(and(eq(teamMembersTable.teamId, match.teamId), eq(teamMembersTable.role, "captain"), eq(teamMembersTable.status, "active")));
  if (captainMember) {
    const captainDbUser = await getDbUser(captainMember.userId);
    if (captainDbUser) {
      const appBase = (process.env.PUBLIC_APP_URL ?? "").replace(/\/$/, "");
      const reviewUrl = `${appBase}/leagues/${leagueId}/free-agents`;
      const positions = agentProfile.positions.length > 0 ? agentProfile.positions.join(", ") : "not specified";
      const skill = agentProfile.skillLevel ?? "not specified";
      sendNotificationWithPreferences({
        userId: captainDbUser.id,
        type: "fa_match_proposal",
        subject: "New Free Agent Match Proposal for Your Team",
        body: `The PlayOn AI has proposed a free agent for ${match.teamName}.\n\nPlayer profile:\n• Positions: ${positions}\n• Skill level: ${skill}\n• AI reasoning: ${match.reasoning}\n\nReview and respond here: ${reviewUrl}`,
        metadata: { freeAgentId, leagueId, teamId: match.teamId },
      }).catch(() => {});
    }
  }
}

/** POST /leagues/:id/free-agents/:faId/team-respond — Team captain/manager/coach approves or declines a proposed match */
router.patch("/leagues/:id/free-agents/:faId/team-respond", requireAuth, async (req, res): Promise<void> => {
  const leagueId = Number(req.params.id);
  const faId = Number(req.params.faId);
  const clerkUserId = (req as AuthedRequest).clerkUserId;
  const { decision } = req.body; // "approve" | "decline"

  if (!["approve", "decline"].includes(decision)) {
    res.status(400).json({ error: "decision must be 'approve' or 'decline'" });
    return;
  }

  const [agent] = await db.select().from(leagueFreeAgentsTable)
    .where(and(eq(leagueFreeAgentsTable.id, faId), eq(leagueFreeAgentsTable.leagueId, leagueId)));
  if (!agent) { res.status(404).json({ error: "Free agent not found" }); return; }
  if (agent.matchStatus !== "team_reviewing") {
    res.status(409).json({ error: "Free agent is not in team_reviewing state" }); return;
  }
  if (!agent.proposedTeamId) { res.status(400).json({ error: "No team proposed" }); return; }

  // Verify caller manages the proposed team
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, agent.proposedTeamId));
  if (!team) { res.status(404).json({ error: "Proposed team not found" }); return; }

  const isAdmin = await hasPermission(clerkUserId, "canManageLeagues");
  const isTeamManager = await canManageTeam(clerkUserId, team);
  if (!isAdmin && !isTeamManager) {
    res.status(403).json({ error: "Only the proposed team's captain, manager, or coach can respond" });
    return;
  }

  if (decision === "approve") {
    await db.update(leagueFreeAgentsTable).set({
      matchStatus: "player_reviewing",
      updatedAt: new Date(),
    } as Partial<typeof leagueFreeAgentsTable.$inferInsert>).where(eq(leagueFreeAgentsTable.id, faId));

    // Notify the free agent player that the team approved (in-app + email)
    const faDbUser = await getDbUser(agent.userId);
    if (faDbUser) {
      const appBase = (process.env.PUBLIC_APP_URL ?? "").replace(/\/$/, "");
      const respondUrl = `${appBase}/leagues/${leagueId}/free-agents`;
      sendNotificationWithPreferences({
        userId: faDbUser.id,
        type: "fa_match_proposal",
        subject: `Team Match Offer from ${team.name}`,
        body: `Great news! ${team.name} has reviewed your free agent application and wants you on their roster.\n\nTeam details:\n• Team: ${team.name}\n• League ID: ${leagueId}\n\nLog in to accept or decline this offer: ${respondUrl}`,
        metadata: { freeAgentId: faId, teamId: agent.proposedTeamId, teamName: team.name, leagueId },
      }).catch(() => {});
    }

    res.json({ success: true, matchStatus: "player_reviewing", message: "Team approved — waiting for player response" });
  } else {
    // Record the declined team and retry matching
    const declinedTeams: number[] = (() => {
      try { return agent.notes ? (JSON.parse(agent.notes)?.declinedTeams ?? []) : []; } catch { return []; }
    })();
    declinedTeams.push(agent.proposedTeamId);
    const notesPayload = JSON.stringify({ declinedTeams });

    await db.update(leagueFreeAgentsTable).set({
      matchStatus: "unmatched",
      proposedTeamId: null,
      proposedAt: null,
      matchReasoning: null,
      notes: notesPayload,
      updatedAt: new Date(),
    } as Partial<typeof leagueFreeAgentsTable.$inferInsert>).where(eq(leagueFreeAgentsTable.id, faId));

    // Notify the free agent player that the team declined (in-app + email)
    const faDbUserDeclined = await getDbUser(agent.userId);
    if (faDbUserDeclined) {
      const appBase = (process.env.PUBLIC_APP_URL ?? "").replace(/\/$/, "");
      sendNotificationWithPreferences({
        userId: faDbUserDeclined.id,
        type: "fa_match_response",
        subject: "Team Declined — AI is Finding Your Next Match",
        body: `The team was unable to accept your free agent application at this time. Don't worry — our AI is already searching for your next best match.\n\nYou'll hear back as soon as a new team is proposed. Track your status: ${appBase}/leagues/${leagueId}/free-agents`,
        metadata: { freeAgentId: faId, leagueId },
      }).catch(() => {});
    }

    // Retry in background
    triggerFreeAgentMatching(leagueId, faId).catch(() => {});
    res.json({ success: true, matchStatus: "unmatched", message: "Declined — trying next best match" });
  }
});

/** PATCH /leagues/:id/free-agents/:faId/player-respond — Player accepts or declines a confirmed match offer */
router.patch("/leagues/:id/free-agents/:faId/player-respond", requireAuth, async (req, res): Promise<void> => {
  const leagueId = Number(req.params.id);
  const faId = Number(req.params.faId);
  const clerkUserId = (req as AuthedRequest).clerkUserId;
  const { decision } = req.body; // "accept" | "decline"

  if (!["accept", "decline"].includes(decision)) {
    res.status(400).json({ error: "decision must be 'accept' or 'decline'" });
    return;
  }

  const [agent] = await db.select().from(leagueFreeAgentsTable)
    .where(and(eq(leagueFreeAgentsTable.id, faId), eq(leagueFreeAgentsTable.leagueId, leagueId)));
  if (!agent) { res.status(404).json({ error: "Free agent not found" }); return; }
  const isAdminResponder = await hasPermission(clerkUserId, "canManageLeagues");
  if (!isAdminResponder && agent.userId !== clerkUserId) {
    res.status(403).json({ error: "Only the free agent or an admin can respond" }); return;
  }
  if (agent.matchStatus !== "player_reviewing") {
    res.status(409).json({ error: "No pending offer to respond to" }); return;
  }
  if (!agent.proposedTeamId) { res.status(400).json({ error: "No team proposed" }); return; }

  if (decision === "accept") {
    // Add the free agent (not the caller, who may be an admin acting on their behalf) to the team
    await db.insert(teamMembersTable).values({
      teamId: agent.proposedTeamId,
      userId: agent.userId,
      role: "player",
      status: "active",
      waiverSigned: agent.waiverSigned,
      waiverSignedAt: agent.waiverSignedAt,
      waiverTemplateId: agent.waiverTemplateId,
    } as typeof teamMembersTable.$inferInsert).onConflictDoNothing();

    await db.update(leagueFreeAgentsTable).set({
      matchStatus: "matched",
      teamId: agent.proposedTeamId,
      assignedAt: new Date(),
      status: "assigned",
      updatedAt: new Date(),
    } as Partial<typeof leagueFreeAgentsTable.$inferInsert>).where(eq(leagueFreeAgentsTable.id, faId));

    const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, agent.proposedTeamId));

    // Notify team captain that the player accepted (in-app + email)
    const [captainMem] = await db.select().from(teamMembersTable)
      .where(and(eq(teamMembersTable.teamId, agent.proposedTeamId), eq(teamMembersTable.role, "captain"), eq(teamMembersTable.status, "active")));
    if (captainMem) {
      const captainDbUser = await getDbUser(captainMem.userId);
      if (captainDbUser) {
        const appBase = (process.env.PUBLIC_APP_URL ?? "").replace(/\/$/, "");
        sendNotificationWithPreferences({
          userId: captainDbUser.id,
          type: "fa_match_response",
          subject: "Free Agent Accepted — Roster Updated",
          body: `A free agent has accepted the offer and joined ${team?.name ?? "your team"}. They are now on the active roster.\n\nView your updated roster: ${appBase}/leagues/${leagueId}/teams`,
          metadata: { freeAgentId: faId, leagueId },
        }).catch(() => {});
      }
    }

    res.json({ success: true, matchStatus: "matched", teamId: agent.proposedTeamId, teamName: team?.name ?? null, message: "Placement confirmed! You have been added to the team." });
  } else {
    // Record the declined team and retry matching
    const declinedTeams: number[] = (() => {
      try { return agent.notes ? (JSON.parse(agent.notes)?.declinedTeams ?? []) : []; } catch { return []; }
    })();
    declinedTeams.push(agent.proposedTeamId);
    const notesPayload = JSON.stringify({ declinedTeams });

    await db.update(leagueFreeAgentsTable).set({
      matchStatus: "unmatched",
      proposedTeamId: null,
      proposedAt: null,
      matchReasoning: null,
      notes: notesPayload,
      updatedAt: new Date(),
    } as Partial<typeof leagueFreeAgentsTable.$inferInsert>).where(eq(leagueFreeAgentsTable.id, faId));

    // Notify team captain that the player declined (in-app + email)
    const [declinedTeamRecord] = await db.select().from(teamsTable).where(eq(teamsTable.id, agent.proposedTeamId as number));
    const [captainMemDeclined] = await db.select().from(teamMembersTable)
      .where(and(eq(teamMembersTable.teamId, agent.proposedTeamId as number), eq(teamMembersTable.role, "captain"), eq(teamMembersTable.status, "active")));
    if (captainMemDeclined) {
      const captainDbUserDeclined = await getDbUser(captainMemDeclined.userId);
      if (captainDbUserDeclined) {
        sendNotificationWithPreferences({
          userId: captainDbUserDeclined.id,
          type: "fa_match_response",
          subject: "Free Agent Declined Your Team Offer",
          body: `The free agent has declined the offer to join ${declinedTeamRecord?.name ?? "your team"}. The AI will continue searching for other candidates and may propose a new match shortly.`,
          metadata: { freeAgentId: faId, leagueId, teamId: agent.proposedTeamId },
        }).catch(() => {});
      }
    }

    triggerFreeAgentMatching(leagueId, faId).catch(() => {});
    res.json({ success: true, matchStatus: "unmatched", message: "Declined — looking for another match" });
  }
});

/** GET /leagues/:id/free-agents/queue — Admin view: full free agent matching queue */
router.get("/leagues/:id/free-agents/queue", requireAuth, async (req, res): Promise<void> => {
  const leagueId = Number(req.params.id);
  const clerkUserId = (req as AuthedRequest).clerkUserId;

  const isAdmin = await hasPermission(clerkUserId, "canManageLeagues");
  let isLeagueTeamManager = false;
  if (!isAdmin) {
    const leagueTeams = await db.select().from(teamsTable).where(eq(teamsTable.leagueId, leagueId));
    for (const team of leagueTeams) {
      if (await canManageTeam(clerkUserId, team)) { isLeagueTeamManager = true; break; }
    }
  }
  if (!isAdmin && !isLeagueTeamManager) {
    res.status(403).json({ error: "Admin or team manager/captain/coach access required" }); return;
  }

  const agents = await db.select().from(leagueFreeAgentsTable).where(eq(leagueFreeAgentsTable.leagueId, leagueId));
  const enriched = await Promise.all(agents.map(async (a) => {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.clerkId, a.userId));
    const [proposedTeam] = a.proposedTeamId
      ? await db.select().from(teamsTable).where(eq(teamsTable.id, a.proposedTeamId))
      : [null];
    const [assignedTeam] = a.teamId
      ? await db.select().from(teamsTable).where(eq(teamsTable.id, a.teamId))
      : [null];
    return {
      ...a,
      positions: a.positions ? JSON.parse(a.positions) : [],
      availability: a.availability ? JSON.parse(a.availability) : null,
      user: u ? { id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email } : null,
      proposedTeam: proposedTeam ? { id: proposedTeam.id, name: proposedTeam.name } : null,
      assignedTeam: assignedTeam ? { id: assignedTeam.id, name: assignedTeam.name } : null,
    };
  }));

  res.json(enriched);
});

/** POST /leagues/:id/free-agents/:faId/retry-match — Admin: force-retry AI matching */
router.post("/leagues/:id/free-agents/:faId/retry-match", requirePermission("canManageLeagues"), async (req, res): Promise<void> => {
  const leagueId = Number(req.params.id);
  const faId = Number(req.params.faId);

  await db.update(leagueFreeAgentsTable).set({
    matchStatus: "unmatched",
    proposedTeamId: null,
    proposedAt: null,
    matchReasoning: null,
    updatedAt: new Date(),
  } as Partial<typeof leagueFreeAgentsTable.$inferInsert>).where(eq(leagueFreeAgentsTable.id, faId));

  await triggerFreeAgentMatching(leagueId, faId);
  const [updated] = await db.select().from(leagueFreeAgentsTable).where(eq(leagueFreeAgentsTable.id, faId));
  res.json(updated);
});

/** POST /leagues/:id/teams/:teamId/player-invite — Captain generates a shareable player invite link */
router.post("/leagues/:id/teams/:teamId/player-invite", requireAuth, async (req, res): Promise<void> => {
  const teamId = Number(req.params.teamId);
  const clerkUserId = (req as AuthedRequest).clerkUserId;

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }

  const canManage = await canManageTeam(clerkUserId, team);
  if (!canManage) { res.status(403).json({ error: "Only team captain, manager, or coach can generate invite links" }); return; }

  const token = randomUUID();
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days

  // Store as a generic player invite using teamInvites table with role="player"
  await db.insert(teamInvitesTable).values({
    token,
    email: `player-invite-${token.slice(0, 8)}@playon.internal`, // placeholder — email not required for open links
    teamId,
    role: "player",
    createdBy: clerkUserId,
    expiresAt,
  } as typeof teamInvitesTable.$inferInsert).returning();

  const appBase = (process.env.PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const inviteUrl = `${appBase}/leagues/join/${token}`;

  res.status(201).json({ token, inviteUrl, teamName: team.name, expiresAt });
});

/** GET /leagues/join/:token — Validate a player invite token */
router.get("/leagues/join/:token", async (req, res): Promise<void> => {
  const { token } = req.params;
  const now = new Date();

  const [invite] = await db.select().from(teamInvitesTable)
    .where(eq(teamInvitesTable.token, token));

  if (!invite) { res.status(404).json({ error: "Invite link not found or expired" }); return; }
  if (invite.revokedAt) { res.status(410).json({ error: "This invite has been revoked" }); return; }
  if (invite.expiresAt < now) { res.status(410).json({ error: "This invite link has expired" }); return; }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, invite.teamId));
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }

  // Get league info from the team
  const [league] = team.leagueId
    ? await db.select().from(leaguesTable).where(eq(leaguesTable.id, team.leagueId))
    : [null];

  res.json({
    teamId: invite.teamId,
    teamName: team.name,
    leagueId: team.leagueId ?? null,
    leagueName: league?.name ?? null,
    role: invite.role,
    usedAt: invite.usedAt ?? null,
    expiresAt: invite.expiresAt,
  });
});

/** POST /leagues/join/:token — Authenticated player joins a team via invite link */
router.post("/leagues/join/:token", requireAuth, async (req, res): Promise<void> => {
  const { token } = req.params;
  const clerkUserId = (req as AuthedRequest).clerkUserId;
  const { positions, skillLevel, shirtSize, scheduleConflicts } = req.body;
  const now = new Date();

  const [invite] = await db.select().from(teamInvitesTable)
    .where(eq(teamInvitesTable.token, token));

  if (!invite || invite.revokedAt || invite.expiresAt < now) {
    res.status(410).json({ error: "Invite link is invalid or expired" }); return;
  }

  // Check already a member
  const [existing] = await db.select().from(teamMembersTable)
    .where(and(eq(teamMembersTable.teamId, invite.teamId), eq(teamMembersTable.userId, clerkUserId), eq(teamMembersTable.status, "active")));
  if (existing) { res.status(409).json({ error: "You are already a member of this team" }); return; }

  // Check valid waiver
  const [activeWaiver] = await db.select().from(waiverTemplatesTable).where(eq(waiverTemplatesTable.isActive, true));
  if (activeWaiver) {
    const dbUser = await getDbUser(clerkUserId);
    if (dbUser) {
      const [sig] = await db.select().from(waiverSignaturesTable)
        .where(eq(waiverSignaturesTable.userId, dbUser.id))
        .orderBy(sql`signed_at DESC`)
        .limit(1);
      if (!sig || (sig.expiresAt && sig.expiresAt < now)) {
        res.status(400).json({ error: "A valid waiver signature is required before joining", waiverId: activeWaiver.id }); return;
      }
    }
  }

  const [member] = await db.insert(teamMembersTable).values({
    teamId: invite.teamId,
    userId: clerkUserId,
    role: "player",
    status: "active",
    waiverSigned: !!activeWaiver,
    waiverSignedAt: activeWaiver ? new Date() : null,
    waiverTemplateId: activeWaiver?.id ?? null,
    notes: scheduleConflicts?.length ? JSON.stringify({ scheduleConflicts }) : null,
  } as typeof teamMembersTable.$inferInsert).returning();

  // Update player profile with submitted data if provided
  if (positions || skillLevel || shirtSize) {
    const dbUser = await getDbUser(clerkUserId);
    if (dbUser) {
      const updates: any = {};
      if (positions?.length > 0) updates.primaryPosition = positions[0];
      if (positions?.length > 1) updates.secondaryPosition = positions[1];
      if (skillLevel) updates.fitnessLevel = skillLevel;
      await db.update(playerProfilesTable).set({ ...updates, updatedAt: new Date() }).where(eq(playerProfilesTable.userId, dbUser.id));
    }
  }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, invite.teamId));
  const [league] = team?.leagueId
    ? await db.select().from(leaguesTable).where(eq(leaguesTable.id, team.leagueId))
    : [null];

  res.status(201).json({ member, teamId: invite.teamId, teamName: team?.name, leagueName: league?.name });
});

router.patch("/leagues/:id/free-agents/:faId/assign", requireAuth, async (req, res): Promise<void> => {
  const leagueId = Number(req.params.id);
  const faId = Number(req.params.faId);
  const clerkUserId = (req as AuthedRequest).clerkUserId;
  const { teamId } = req.body;
  if (!teamId) { res.status(400).json({ error: "teamId required" }); return; }

  const [fa] = await db.select().from(leagueFreeAgentsTable)
    .where(and(eq(leagueFreeAgentsTable.id, faId), eq(leagueFreeAgentsTable.leagueId, leagueId)));
  if (!fa) { res.status(404).json({ error: "Free agent not found" }); return; }

  // Integrity: target team must belong to the same league
  const [targetTeam] = await db.select().from(teamsTable)
    .where(and(eq(teamsTable.id, teamId), eq(teamsTable.leagueId, leagueId)));
  if (!targetTeam) { res.status(400).json({ error: "Team does not belong to this league" }); return; }

  // Admin, or managing role of the target team, can assign a free agent
  const isAdmin = await hasPermission(clerkUserId, "canManageLeagues");
  const isTeamManaging = await canManageTeam(clerkUserId, targetTeam);
  if (!isAdmin && !isTeamManaging) {
    res.status(403).json({ error: "Only admin or the target team's captain/manager/coach can assign a free agent" });
    return;
  }

  const [updated] = await db.update(leagueFreeAgentsTable)
    .set({ teamId, status: "assigned", assignedAt: new Date(), updatedAt: new Date() } as Partial<typeof leagueFreeAgentsTable.$inferInsert>)
    .where(eq(leagueFreeAgentsTable.id, faId)).returning();

  await db.insert(teamMembersTable).values({
    teamId, userId: fa.userId, role: "player", status: "active",
    waiverSigned: fa.waiverSigned, waiverSignedAt: fa.waiverSignedAt, waiverTemplateId: fa.waiverTemplateId,
  } as typeof teamMembersTable.$inferInsert);

  res.json(updated);
});

// ─── Fixtures ──────────────────────────────────────────────────────────────────

router.get("/leagues/:id/fixtures", async (req, res): Promise<void> => {
  const leagueId = Number(req.params.id);
  const fixtures = await db.select().from(fixturesTable)
    .where(and(eq(fixturesTable.entityType, "league"), eq(fixturesTable.entityId, leagueId)))
    .orderBy(asc(fixturesTable.round), asc(fixturesTable.scheduledAt));

  const enriched = await Promise.all(fixtures.map(async (f) => {
    const [[home], [away], [ref]] = await Promise.all([
      f.homeTeamId ? db.select().from(teamsTable).where(eq(teamsTable.id, f.homeTeamId)) : [[]],
      f.awayTeamId ? db.select().from(teamsTable).where(eq(teamsTable.id, f.awayTeamId)) : [[]],
      f.refereeUserId ? db.select().from(usersTable).where(eq(usersTable.id, f.refereeUserId)) : [[]],
    ] as any);
    return {
      ...f,
      homeTeam: home ? { id: (home as any).id, name: (home as any).name } : null,
      awayTeam: away ? { id: (away as any).id, name: (away as any).name } : null,
      referee: ref ? { id: (ref as any).id, firstName: (ref as any).firstName, lastName: (ref as any).lastName } : null,
    };
  }));
  res.json(enriched);
});

router.post("/leagues/:id/fixtures/generate", requirePermission("canManageLeagues"), async (req, res): Promise<void> => {
  const leagueId = Number(req.params.id);
  // refereeUserIds: optional ordered list of DB user IDs to rotate through when assigning refs
  // divisionId: optional — generate fixtures only for teams in that division
  const { startDate, gameTimeMinutes = 90, dayOfWeek = 6, startHour = 18, doubleRoundRobin = false, refereeUserIds = [], divisionId } = req.body;

  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  if (!league) { res.status(404).json({ error: "League not found" }); return; }

  const allLeagueDivisions = await db.select().from(leagueDivisionsTable)
    .where(eq(leagueDivisionsTable.leagueId, leagueId))
    .orderBy(asc(leagueDivisionsTable.divisionOrder));
  if (allLeagueDivisions.length > 1 && !divisionId) {
    res.status(400).json({ error: "This league has multiple divisions. Provide a divisionId to scope fixture generation to a specific division." });
    return;
  }
  if (divisionId) {
    const div = allLeagueDivisions.find((d) => d.id === Number(divisionId));
    if (!div) { res.status(400).json({ error: "Division does not belong to this league" }); return; }
  }

  const teamsQuery = divisionId
    ? db.select().from(teamsTable).where(and(eq(teamsTable.leagueId, leagueId), eq(teamsTable.divisionId, Number(divisionId))))
    : db.select().from(teamsTable).where(eq(teamsTable.leagueId, leagueId));
  const teams = await teamsQuery;
  if (teams.length < 2) { res.status(400).json({ error: "Need at least 2 teams" }); return; }

  const deleteWhere = divisionId
    ? and(eq(fixturesTable.entityType, "league"), eq(fixturesTable.entityId, leagueId), eq(fixturesTable.status, "scheduled"), eq(fixturesTable.divisionId, divisionId))
    : and(eq(fixturesTable.entityType, "league"), eq(fixturesTable.entityId, leagueId), eq(fixturesTable.status, "scheduled"));
  await db.delete(fixturesTable).where(deleteWhere);

  const matchups = generateRoundRobin(teams.length);
  const base = matchups[matchups.length - 1].round;
  const allMatchups = doubleRoundRobin
    ? [...matchups, ...matchups.map((m) => ({ homeIdx: m.awayIdx, awayIdx: m.homeIdx, round: m.round + base }))]
    : matchups;

  const startDt = startDate ? new Date(startDate) : (league.startDate ? new Date(league.startDate) : new Date());
  while (startDt.getDay() !== (dayOfWeek % 7)) startDt.setDate(startDt.getDate() + 1);

  // Track how many games are already scheduled within each round so we can
  // stagger kick-off times (one court → sequential slots, ~gameTimeMinutes apart)
  const roundGameCount: Record<number, number> = {};
  // Track which refs are assigned per timeslot key (ISO string) to prevent conflicts
  const refTimeslotMap: Record<string, Set<number>> = {};
  const created = [];
  let refPoolIndex = 0;

  for (const m of allMatchups) {
    if (roundGameCount[m.round] === undefined) roundGameCount[m.round] = 0;
    const slotIndex = roundGameCount[m.round];

    const gameDate = new Date(startDt);
    gameDate.setDate(gameDate.getDate() + (m.round - 1) * 7);
    // Stagger within round: each game gets its own time slot
    const offsetMinutes = slotIndex * Number(gameTimeMinutes);
    gameDate.setHours(Number(startHour), offsetMinutes % 60, 0, 0);
    if (offsetMinutes >= 60) gameDate.setHours(gameDate.getHours() + Math.floor(offsetMinutes / 60));

    // Assign a referee from the pool, rotating and skipping conflicts within this timeslot
    let assignedRefId: number | null = null;
    if (refereeUserIds.length > 0) {
      const slotKey = gameDate.toISOString();
      if (!refTimeslotMap[slotKey]) refTimeslotMap[slotKey] = new Set();
      const refsThisSlot = refTimeslotMap[slotKey];
      // Try each ref in pool starting from current position; skip ones already busy this slot
      for (let attempt = 0; attempt < refereeUserIds.length; attempt++) {
        const candidateId = refereeUserIds[(refPoolIndex + attempt) % refereeUserIds.length];
        if (!refsThisSlot.has(candidateId)) {
          assignedRefId = candidateId;
          refsThisSlot.add(candidateId);
          refPoolIndex = (refPoolIndex + attempt + 1) % refereeUserIds.length;
          break;
        }
      }
      // If all refs conflict (fewer refs than concurrent games), leave unassigned
    }

    const [fx] = await db.insert(fixturesTable).values({
      entityType: "league", entityId: leagueId,
      divisionId: divisionId ?? null,
      homeTeamId: teams[m.homeIdx].id, awayTeamId: teams[m.awayIdx].id,
      courtId: league.courtId,
      refereeUserId: assignedRefId,
      scheduledAt: gameDate,
      durationMinutes: gameTimeMinutes,
      round: m.round, phase: "group", status: "scheduled",
    } as typeof fixturesTable.$inferInsert).returning();
    created.push(fx);
    roundGameCount[m.round]++;
  }

  await ensureGameCardsForEntity("league", leagueId).catch((err) => { console.error("[game-card] failed to generate cards for league", leagueId, err?.message); });
  res.status(201).json({ generated: created.length, fixtures: created });
});

router.patch("/leagues/:id/fixtures/:fid", requirePermission("canManageLeagues"), async (req, res): Promise<void> => {
  const leagueId = Number(req.params.id);
  const fid = Number(req.params.fid);

  // Integrity: ensure fixture belongs to this league
  const [existing] = await db.select().from(fixturesTable)
    .where(and(eq(fixturesTable.id, fid), eq(fixturesTable.entityType, "league"), eq(fixturesTable.entityId, leagueId)));
  if (!existing) { res.status(404).json({ error: "Fixture not found in this league" }); return; }

  const { scheduledAt, courtId, refereeUserId, status, notes, durationMinutes, forceConflict } = req.body;
  const updates: any = { updatedAt: new Date() };
  if (scheduledAt !== undefined) updates.scheduledAt = new Date(scheduledAt);
  if (courtId !== undefined) updates.courtId = courtId;
  if (refereeUserId !== undefined) updates.refereeUserId = refereeUserId;
  if (status !== undefined) updates.status = status;
  if (notes !== undefined) updates.notes = notes;
  if (durationMinutes !== undefined) updates.durationMinutes = durationMinutes;

  // Conflict checks when scheduling or re-assigning court/ref
  if (!forceConflict && (updates.scheduledAt || updates.courtId || updates.refereeUserId)) {
    const effectiveStart = updates.scheduledAt ?? (existing.scheduledAt ? new Date(existing.scheduledAt) : null);
    const effectiveDuration = updates.durationMinutes ?? existing.durationMinutes ?? 90;
    const effectiveCourt = updates.courtId ?? existing.courtId;
    const effectiveRef = updates.refereeUserId ?? existing.refereeUserId;

    if (effectiveStart && effectiveCourt) {
      const newEnd = new Date(effectiveStart.getTime() + effectiveDuration * 60000);
      const conflicts = await db.select().from(fixturesTable)
        .where(and(eq(fixturesTable.courtId, effectiveCourt), eq(fixturesTable.status, "scheduled")));
      const courtConflict = conflicts.find((c) => {
        if (c.id === fid) return false;
        const cs = c.scheduledAt ? new Date(c.scheduledAt) : null;
        if (!cs) return false;
        const ce = new Date(cs.getTime() + (c.durationMinutes ?? 90) * 60000);
        return effectiveStart < ce && newEnd > cs;
      });
      if (courtConflict) {
        res.status(409).json({
          error: "Court conflict: another fixture is scheduled at this time on the same court",
          conflictFixtureId: courtConflict.id,
          conflictTime: courtConflict.scheduledAt,
          hint: "Pass forceConflict: true to override",
        });
        return;
      }
    }

    if (effectiveStart && effectiveRef) {
      const newEnd = new Date(effectiveStart.getTime() + effectiveDuration * 60000);
      const refConflicts = await db.select().from(fixturesTable)
        .where(and(eq(fixturesTable.refereeUserId, effectiveRef), eq(fixturesTable.status, "scheduled")));
      const refConflict = refConflicts.find((c) => {
        if (c.id === fid) return false;
        const cs = c.scheduledAt ? new Date(c.scheduledAt) : null;
        if (!cs) return false;
        const ce = new Date(cs.getTime() + (c.durationMinutes ?? 90) * 60000);
        return effectiveStart < ce && newEnd > cs;
      });
      if (refConflict) {
        res.status(409).json({
          error: "Referee conflict: this referee is assigned to another fixture at this time",
          conflictFixtureId: refConflict.id,
          conflictTime: refConflict.scheduledAt,
          hint: "Pass forceConflict: true to override",
        });
        return;
      }
    }
  }

  const [fx] = await db.update(fixturesTable).set(updates).where(eq(fixturesTable.id, fid)).returning();
  if (!fx) { res.status(404).json({ error: "Fixture not found" }); return; }
  ensureGameCard(fid).catch((err) => { console.error("[game-card] failed to update card for fixture", fid, err?.message); });
  res.json(fx);
});

router.post("/leagues/:id/fixtures/:fid/result", requireAuth, async (req, res): Promise<void> => {
  const leagueId = Number(req.params.id);
  const fid = Number(req.params.fid);
  const clerkUserId = (req as AuthedRequest).clerkUserId;
  const { homeScore, awayScore, status = "completed", notes } = req.body;

  if (homeScore === undefined || awayScore === undefined) {
    res.status(400).json({ error: "homeScore and awayScore required" });
    return;
  }

  const isAdmin = await hasPermission(clerkUserId, "canManageLeagues");
  const dbUser = await getDbUser(clerkUserId);

  // Integrity: fixture must belong to this league
  const [fx] = await db.select().from(fixturesTable)
    .where(and(eq(fixturesTable.id, fid), eq(fixturesTable.entityType, "league"), eq(fixturesTable.entityId, leagueId)));
  if (!fx) { res.status(404).json({ error: "Fixture not found in this league" }); return; }

  if (!isAdmin && !(dbUser && fx.refereeUserId === dbUser.id)) {
    res.status(403).json({ error: "Only assigned referee or admin can enter results" });
    return;
  }

  // Deposit enforcement: block result entry if either team has an unpaid balance,
  // unless admin explicitly passes overridePaymentBlock: true
  const { overridePaymentBlock } = req.body;
  if (!overridePaymentBlock) {
    const teamIds = [fx.homeTeamId, fx.awayTeamId].filter((id): id is number => id != null);
    const regs = await db.select().from(leagueRegistrationsTable)
      .where(and(eq(leagueRegistrationsTable.leagueId, leagueId)));
    const unpaid = regs.filter((r) =>
      r.teamId != null &&
      teamIds.includes(r.teamId) &&
      r.paymentStatus !== "paid" && r.paymentStatus !== "waived" &&
      !r.balanceOverriddenByAdmin
    );
    if (unpaid.length > 0 && !isAdmin) {
      const names = await Promise.all(unpaid.map(async (r) => {
        const [t] = r.teamId != null ? await db.select().from(teamsTable).where(eq(teamsTable.id, r.teamId)) : [];
        return t?.name ?? `Team #${r.teamId}`;
      }));
      res.status(402).json({
        error: "Payment required: one or more teams have an outstanding balance",
        unpaidTeams: names,
        hint: "Admin can pass overridePaymentBlock: true to record the result anyway",
      });
      return;
    }
  }

  const [updated] = await db.update(fixturesTable).set({
    homeScore: Number(homeScore), awayScore: Number(awayScore), status,
    notes: notes ?? fx.notes, updatedAt: new Date(),
  } as Partial<typeof fixturesTable.$inferInsert>).where(eq(fixturesTable.id, fid)).returning();

  await recomputeStandings(leagueId, fx.divisionId);
  res.json(updated);
});

router.post("/leagues/:id/fixtures/:fid/forfeit", requirePermission("canManageLeagues"), async (req, res): Promise<void> => {
  const leagueId = Number(req.params.id);
  const fid = Number(req.params.fid);
  const { forfeitingTeamId, notes } = req.body;
  if (!forfeitingTeamId) { res.status(400).json({ error: "forfeitingTeamId required" }); return; }

  // Integrity: fixture must belong to this league
  const [fx] = await db.select().from(fixturesTable)
    .where(and(eq(fixturesTable.id, fid), eq(fixturesTable.entityType, "league"), eq(fixturesTable.entityId, leagueId)));
  if (!fx) { res.status(404).json({ error: "Fixture not found in this league" }); return; }

  const hs = fx.homeTeamId === forfeitingTeamId ? 0 : 3;
  const as_ = fx.awayTeamId === forfeitingTeamId ? 0 : 3;

  const [updated] = await db.update(fixturesTable).set({
    homeScore: hs, awayScore: as_, status: "completed",
    notes: `FORFEIT — team #${forfeitingTeamId}. ${notes || ""}`, updatedAt: new Date(),
  } as Partial<typeof fixturesTable.$inferInsert>).where(eq(fixturesTable.id, fid)).returning();

  await recomputeStandings(leagueId, fx.divisionId);
  res.json(updated);
});

// ─── Fixture check-in ──────────────────────────────────────────────────────────

router.get("/leagues/:id/fixtures/:fid/checkin", requirePermission("canManageLeagues"), async (req, res): Promise<void> => {
  const leagueId = Number(req.params.id);
  const fid = Number(req.params.fid);
  // Integrity: fixture must belong to this league (leagueId=0 is the bypass used by check-in page)
  const [fx] = leagueId === 0
    ? await db.select().from(fixturesTable).where(eq(fixturesTable.id, fid))
    : await db.select().from(fixturesTable)
        .where(and(eq(fixturesTable.id, fid), eq(fixturesTable.entityType, "league"), eq(fixturesTable.entityId, leagueId)));
  if (!fx) { res.status(404).json({ error: "Fixture not found in this league" }); return; }

  const [homeTeam, awayTeam] = await Promise.all([
    fx.homeTeamId ? db.select().from(teamsTable).where(eq(teamsTable.id, fx.homeTeamId)).then(r => r[0]) : null,
    fx.awayTeamId ? db.select().from(teamsTable).where(eq(teamsTable.id, fx.awayTeamId)).then(r => r[0]) : null,
  ]);

  const [homeMembers, awayMembers] = await Promise.all([
    fx.homeTeamId ? db.select().from(teamMembersTable).where(and(eq(teamMembersTable.teamId, fx.homeTeamId), eq(teamMembersTable.status, "active"))) : [],
    fx.awayTeamId ? db.select().from(teamMembersTable).where(and(eq(teamMembersTable.teamId, fx.awayTeamId), eq(teamMembersTable.status, "active"))) : [],
  ]);

  const checkins = await db.select().from(checkInsTable)
    .where(and(
      eq(checkInsTable.entityType, "fixture"),
      eq(checkInsTable.entityId, fid),
      sql`${checkInsTable.voidedAt} IS NULL`,
    ));

  const enrich = async (m: any, side: string) => {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.clerkId, m.userId));
    const ci = checkins.find((c) => u && c.userId === u.id);
    return { ...m, teamSide: side, user: u ? { id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email, qrCode: u.qrCode, playonId: u.playonId } : null, checkedIn: !!ci, checkedInAt: ci?.checkedInAt ?? null, checkinId: ci?.id ?? null };
  };

  const [homePlayers, awayPlayers] = await Promise.all([
    Promise.all(homeMembers.map((m) => enrich(m, "home"))),
    Promise.all(awayMembers.map((m) => enrich(m, "away"))),
  ]);

  res.json({ fixture: fx, homeTeam: homeTeam ?? null, awayTeam: awayTeam ?? null, homePlayers, awayPlayers, totalCheckedIn: checkins.length });
});

router.post("/leagues/:id/fixtures/:fid/checkin", requirePermission("canManageLeagues"), async (req, res): Promise<void> => {
  const leagueId = Number(req.params.id);
  const fid = Number(req.params.fid);
  const clerkUserId = (req as AuthedRequest).clerkUserId;
  const { userId: targetClerkId, qrCode, method = "manual", notes } = req.body;

  if (leagueId > 0) {
    const [leagueRecord] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
    if (!leagueRecord || !isEventActive(leagueRecord)) {
      res.status(403).json({ error: "This league is not currently active" });
      return;
    }
  }

  const lookup = targetClerkId || qrCode;
  if (!lookup) { res.status(400).json({ error: "userId or qrCode required" }); return; }

  const [targetUser] = await db.select().from(usersTable)
    .where(or(eq(usersTable.clerkId, lookup), eq(usersTable.qrCode, lookup)));
  if (!targetUser) { res.status(404).json({ error: "Player not found" }); return; }

  // Integrity: fixture must belong to this league (leagueId=0 bypasses for standalone check-in page)
  const [fx] = leagueId === 0
    ? await db.select().from(fixturesTable).where(eq(fixturesTable.id, fid))
    : await db.select().from(fixturesTable)
        .where(and(eq(fixturesTable.id, fid), eq(fixturesTable.entityType, "league"), eq(fixturesTable.entityId, leagueId)));
  if (!fx) { res.status(404).json({ error: "Fixture not found in this league" }); return; }

  let eligible = false;
  let playerTeamId: number | null = null;
  for (const tid of [fx.homeTeamId, fx.awayTeamId].filter(Boolean)) {
    const [mem] = await db.select().from(teamMembersTable)
      .where(and(eq(teamMembersTable.teamId, tid!), eq(teamMembersTable.userId, targetUser.clerkId), eq(teamMembersTable.status, "active")));
    if (mem) { eligible = true; playerTeamId = tid!; break; }
  }

  // Deposit enforcement at check-in: flag or block teams with outstanding balance.
  // Admin check-in always proceeds, but the response includes payment status for awareness.
  let teamPaymentStatus: string | null = null;
  if (playerTeamId && fx.entityId) {
    const [reg] = await db.select().from(leagueRegistrationsTable)
      .where(and(eq(leagueRegistrationsTable.leagueId, fx.entityId), eq(leagueRegistrationsTable.teamId, playerTeamId)));
    teamPaymentStatus = reg?.paymentStatus ?? null;
    // Block non-admin check-in if team has outstanding balance and no admin override
    if (reg && reg.paymentStatus !== "paid" && reg.paymentStatus !== "waived" && !(reg as any).balanceOverriddenByAdmin) {
      const { overridePaymentBlock } = req.body;
      if (!overridePaymentBlock) {
        res.status(402).json({
          error: "Team has an outstanding balance — check-in blocked until payment is cleared",
          teamId: playerTeamId,
          paymentStatus: reg.paymentStatus,
          balanceDue: reg.balanceDue,
          hint: "Pass overridePaymentBlock: true to check in anyway (admin override)",
        });
        return;
      }
    }
  }

  const existing = await db.select().from(checkInsTable)
    .where(and(
      eq(checkInsTable.entityType, "fixture"),
      eq(checkInsTable.entityId, fid),
      eq(checkInsTable.userId, targetUser.id),
      sql`${checkInsTable.voidedAt} IS NULL`,
    ));
  if (existing.length) { res.status(409).json({ error: "Already checked in", checkin: existing[0] }); return; }

  const adminUser = await getDbUser(clerkUserId);
  const [checkin] = await db.insert(checkInsTable).values({
    entityType: "fixture", entityId: fid,
    userId: targetUser.id,
    checkedInByUserId: adminUser?.id ?? null,
    method: qrCode ? "qr" : method,
    qrCodeScanned: qrCode || null,
    isManual: !qrCode,
    notes: !eligible ? `⚠ NOT ON ROSTER. ${notes || ""}` : (notes || null),
  } as typeof checkInsTable.$inferInsert).returning();

  res.status(201).json({ checkin, eligible, player: { id: targetUser.id, firstName: targetUser.firstName, lastName: targetUser.lastName } });
});

// ─── Standings ─────────────────────────────────────────────────────────────────

router.get("/leagues/:id/standings", async (req, res): Promise<void> => {
  const leagueId = Number(req.params.id);
  const standings = await db.select().from(standingsTable).where(eq(standingsTable.leagueId, leagueId)).orderBy(asc(standingsTable.rank));
  const divisions = await db.select().from(leagueDivisionsTable).where(eq(leagueDivisionsTable.leagueId, leagueId)).orderBy(asc(leagueDivisionsTable.divisionOrder));

  const enriched = await Promise.all(standings.map(async (s) => {
    const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, s.teamId));
    const div = s.divisionId ? divisions.find((d) => d.id === s.divisionId) ?? null : null;
    return { ...s, team: team ? { id: team.id, name: team.name, color: team.color, logoUrl: team.logoUrl } : null, division: div ? { id: div.id, name: div.name } : null };
  }));

  // Return as division-grouped when multiple divisions exist; flat otherwise
  if (divisions.length > 1) {
    const grouped = divisions.map((d) => ({
      division: { id: d.id, name: d.name, ageGroups: d.ageGroups, format: d.format },
      standings: enriched.filter((s) => s.divisionId === d.id),
    }));
    res.json({ type: "grouped", divisions: grouped });
  } else {
    res.json(enriched);
  }
});

router.post("/leagues/:id/standings/recompute", requirePermission("canManageLeagues"), async (req, res): Promise<void> => {
  const leagueId = Number(req.params.id);
  await recomputeStandings(leagueId);
  const standings = await db.select().from(standingsTable).where(eq(standingsTable.leagueId, leagueId)).orderBy(asc(standingsTable.rank));
  res.json(standings);
});

// ─── Playoff brackets ──────────────────────────────────────────────────────────

router.get("/leagues/:id/brackets", async (req, res): Promise<void> => {
  const leagueId = Number(req.params.id);
  const fixtures = await db.select().from(fixturesTable)
    .where(and(eq(fixturesTable.entityType, "league"), eq(fixturesTable.entityId, leagueId), eq(fixturesTable.phase, "playoff")))
    .orderBy(asc(fixturesTable.round));

  const enriched = await Promise.all(fixtures.map(async (f) => {
    const [[home], [away]] = await Promise.all([
      f.homeTeamId ? db.select().from(teamsTable).where(eq(teamsTable.id, f.homeTeamId)) : [[]],
      f.awayTeamId ? db.select().from(teamsTable).where(eq(teamsTable.id, f.awayTeamId)) : [[]],
    ] as any);
    return { ...f, homeTeam: home || null, awayTeam: away || null };
  }));
  res.json(enriched);
});

router.post("/leagues/:id/brackets/generate", requirePermission("canManageLeagues"), async (req, res): Promise<void> => {
  const leagueId = Number(req.params.id);
  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  if (!league) { res.status(404).json({ error: "League not found" }); return; }
  if (!league.playoffEnabled) { res.status(400).json({ error: "Playoffs not enabled" }); return; }

  const topN = league.playoffTeams ?? 4;
  const standings = await db.select().from(standingsTable).where(eq(standingsTable.leagueId, leagueId)).orderBy(asc(standingsTable.rank));
  const playoffTeams = standings.slice(0, topN);
  if (playoffTeams.length < 2) { res.status(400).json({ error: "Not enough teams for playoffs" }); return; }

  const n = playoffTeams.length;
  const matchups = [];
  for (let i = 0; i < Math.floor(n / 2); i++) matchups.push({ home: playoffTeams[i], away: playoffTeams[n - 1 - i] });

  const startDt = league.endDate ? new Date(league.endDate) : new Date();
  startDt.setDate(startDt.getDate() + 7);

  const created = [];
  for (let i = 0; i < matchups.length; i++) {
    const { home, away } = matchups[i];
    const [fx] = await db.insert(fixturesTable).values({
      entityType: "league", entityId: leagueId,
      homeTeamId: home.teamId, awayTeamId: away.teamId,
      courtId: league.courtId,
      scheduledAt: new Date(startDt.getTime() + i * 3600 * 1000),
      durationMinutes: 90, round: 1, phase: "playoff", status: "scheduled",
    } as typeof fixturesTable.$inferInsert).returning();
    created.push(fx);
  }

  res.status(201).json({ generated: created.length, fixtures: created });
});

// ─── Quick-add player at check-in (game-day walk-in with waiver capture) ───────

router.post("/leagues/:id/fixtures/:fid/checkin/quickadd", requirePermission("canManageLeagues"), async (req, res): Promise<void> => {
  const leagueId = Number(req.params.id);
  const fid = Number(req.params.fid);
  const clerkUserId = (req as AuthedRequest).clerkUserId;

  if (leagueId > 0) {
    const [leagueRecord] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
    if (!leagueRecord || !isEventActive(leagueRecord)) {
      res.status(403).json({ error: "This league is not currently active" });
      return;
    }
  }

  const {
    firstName, lastName, email, phone, teamId,
    waiverSigned = false, guardianName, guardianPhone, guardianSignature, notes,
  } = req.body;

  if (!firstName || !lastName || !email || !teamId) {
    res.status(400).json({ error: "firstName, lastName, email, and teamId required" });
    return;
  }

  // Integrity: fixture belongs to this league (0 = bypass for check-in page)
  const [fx] = leagueId === 0
    ? await db.select().from(fixturesTable).where(eq(fixturesTable.id, fid))
    : await db.select().from(fixturesTable)
        .where(and(eq(fixturesTable.id, fid), eq(fixturesTable.entityType, "league"), eq(fixturesTable.entityId, leagueId)));
  if (!fx) { res.status(404).json({ error: "Fixture not found in this league" }); return; }

  const effectiveLeagueId = leagueId || (fx.entityId ?? 0);

  // Integrity: team must play in this game
  if (fx.homeTeamId !== teamId && fx.awayTeamId !== teamId) {
    res.status(400).json({ error: "teamId is not participating in this fixture" });
    return;
  }

  // Find or create the user — walk-ins may not have a Clerk account yet
  let [targetUser] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (!targetUser) {
    const guestClerkId = `guest_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const guestPlayonId = `PLY-${Date.now().toString(36).toUpperCase()}`;
    [targetUser] = await db.insert(usersTable).values({
      clerkId: guestClerkId, email, firstName, lastName, phone: phone ?? null,
      role: "player", playonId: guestPlayonId,
    } as typeof usersTable.$inferInsert).returning();
  }

  // Guardian / youth waiver capture note
  const guardianNote = guardianName
    ? `Guardian: ${guardianName}${guardianPhone ? ` (${guardianPhone})` : ""}${guardianSignature ? " — signature captured" : " — ⚠ signature MISSING"}.`
    : "";

  // Add to team roster if not already active
  const [existingMember] = await db.select().from(teamMembersTable)
    .where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, targetUser.clerkId)));
  let isNewMember = false;
  if (!existingMember || existingMember.status !== "active") {
    await db.insert(teamMembersTable).values({
      teamId, userId: targetUser.clerkId, role: "player", status: "active",
      waiverSigned: Boolean(waiverSigned), waiverSignedAt: waiverSigned ? new Date() : null,
    } as typeof teamMembersTable.$inferInsert);
    isNewMember = true;
  }

  // Record check-in (idempotent — only consider active, non-voided check-ins)
  const adminUser = await getDbUser(clerkUserId);
  const [existingCI] = await db.select().from(checkInsTable)
    .where(and(
      eq(checkInsTable.entityType, "fixture"),
      eq(checkInsTable.entityId, fid),
      eq(checkInsTable.userId, targetUser.id),
      sql`${checkInsTable.voidedAt} IS NULL`,
    ));

  const checkin = existingCI ?? (await db.insert(checkInsTable).values({
    entityType: "fixture", entityId: fid,
    userId: targetUser.id, checkedInByUserId: adminUser?.id ?? null,
    method: "manual", isManual: true,
    notes: [
      "Game-day quick-add walk-in.",
      !waiverSigned ? "⚠ WAIVER NOT SIGNED." : "Waiver signed.",
      guardianNote, notes || "",
    ].filter(Boolean).join(" "),
  } as typeof checkInsTable.$inferInsert).returning().then(r => r[0]));

  res.status(201).json({
    user: { id: targetUser.id, firstName: targetUser.firstName, lastName: targetUser.lastName, email: targetUser.email, playonId: targetUser.playonId },
    checkin,
    isNewMember,
    waiverSigned,
    warning: !waiverSigned ? "Player checked in without a signed waiver — obtain signature before the match" : null,
  });
});

// ─── Referee-facing views ───────────────────────────────────────────────────────

router.get("/referees/my-fixtures", requireAuth, async (req, res): Promise<void> => {
  const clerkUserId = (req as AuthedRequest).clerkUserId;
  const dbUser = await getDbUser(clerkUserId);
  if (!dbUser) { res.status(404).json({ error: "User not found" }); return; }

  const fixtures = await db.select().from(fixturesTable)
    .where(eq(fixturesTable.refereeUserId, dbUser.id))
    .orderBy(asc(fixturesTable.scheduledAt));

  const enriched = await Promise.all(fixtures.map(async (f) => {
    const [[home], [away]] = await Promise.all([
      f.homeTeamId ? db.select().from(teamsTable).where(eq(teamsTable.id, f.homeTeamId)) : [[]],
      f.awayTeamId ? db.select().from(teamsTable).where(eq(teamsTable.id, f.awayTeamId)) : [[]],
    ] as any);
    return {
      ...f,
      homeTeam: home ? { id: (home as any).id, name: (home as any).name } : null,
      awayTeam: away ? { id: (away as any).id, name: (away as any).name } : null,
    };
  }));

  res.json(enriched);
});

// ─── Playoff bracket progression (advance winner to next round) ─────────────────

router.post("/leagues/:id/brackets/playoff/advance", requirePermission("canManageLeagues"), async (req, res): Promise<void> => {
  const leagueId = Number(req.params.id);
  const { fixtureId, winnerId } = req.body;
  if (!fixtureId || !winnerId) { res.status(400).json({ error: "fixtureId and winnerId required" }); return; }

  const [fx] = await db.select().from(fixturesTable)
    .where(and(eq(fixturesTable.id, fixtureId), eq(fixturesTable.entityType, "league"), eq(fixturesTable.entityId, leagueId), eq(fixturesTable.phase, "playoff")));
  if (!fx) { res.status(404).json({ error: "Playoff fixture not found in this league" }); return; }

  if (winnerId !== fx.homeTeamId && winnerId !== fx.awayTeamId) {
    res.status(400).json({ error: "winnerId must be one of the two teams in this fixture" });
    return;
  }

  const allPlayoff = await db.select().from(fixturesTable)
    .where(and(eq(fixturesTable.entityType, "league"), eq(fixturesTable.entityId, leagueId), eq(fixturesTable.phase, "playoff")))
    .orderBy(asc(fixturesTable.round));

  const currentRound = fx.round ?? 1;
  const nextRound = currentRound + 1;

  const currentRoundGames = allPlayoff.filter((f) => (f.round ?? 1) === currentRound);
  const fixtureSlot = currentRoundGames.findIndex((f) => f.id === fixtureId);
  const targetNextSlot = Math.floor(fixtureSlot / 2);
  const isHome = fixtureSlot % 2 === 0;

  const nextRoundGames = allPlayoff.filter((f) => (f.round ?? 1) === nextRound);
  let nextFixture = nextRoundGames[targetNextSlot] ?? null;

  if (!nextFixture) {
    // Create new next-round slot with winner slotted in
    const baseDate = fx.scheduledAt ? new Date(fx.scheduledAt) : new Date();
    const nextDate = new Date(baseDate.getTime() + 7 * 24 * 3600 * 1000 + targetNextSlot * 3600 * 1000);
    [nextFixture] = await db.insert(fixturesTable).values({
      entityType: "league", entityId: leagueId,
      homeTeamId: isHome ? winnerId : null,
      awayTeamId: isHome ? null : winnerId,
      courtId: fx.courtId,
      scheduledAt: nextDate,
      durationMinutes: fx.durationMinutes ?? 90,
      round: nextRound, phase: "playoff", status: "scheduled",
    } as typeof fixturesTable.$inferInsert).returning();
  } else {
    // Fill winner into existing slot
    const updateField = isHome ? { homeTeamId: winnerId } : { awayTeamId: winnerId };
    [nextFixture] = await db.update(fixturesTable)
      .set({ ...updateField, updatedAt: new Date() } as Partial<typeof fixturesTable.$inferInsert>)
      .where(eq(fixturesTable.id, nextFixture.id)).returning();
  }

  res.json({ advanced: winnerId, round: currentRound, nextRound, nextFixture });
});

// ─── Registration overdue list + deposit reminder ──────────────────────────────

router.get("/leagues/:id/registrations/overdue", requirePermission("canManageLeagues"), async (req, res): Promise<void> => {
  const leagueId = Number(req.params.id);

  const regs = await db.select().from(leagueRegistrationsTable)
    .where(eq(leagueRegistrationsTable.leagueId, leagueId));

  // First-fixture date is the natural payment due cutoff
  const [firstFixture] = await db.select().from(fixturesTable)
    .where(and(eq(fixturesTable.entityType, "league"), eq(fixturesTable.entityId, leagueId)))
    .orderBy(asc(fixturesTable.scheduledAt));

  const firstFixtureDate = firstFixture?.scheduledAt ? new Date(firstFixture.scheduledAt) : null;
  const now = new Date();

  const overdue = regs.filter((r) =>
    r.paymentStatus !== "paid" && r.paymentStatus !== "waived" &&
    !(r as any).balanceOverriddenByAdmin &&
    (
      (firstFixtureDate && firstFixtureDate <= now) ||
      (r.balanceDueDate && new Date(r.balanceDueDate) <= now)
    )
  );

  const enriched = await Promise.all(overdue.map(async (r) => {
    const team = r.teamId
      ? await db.select().from(teamsTable).where(eq(teamsTable.id, r.teamId)).then(rows => rows[0] ?? null)
      : null;
    return {
      ...r,
      team: team ? { id: team.id, name: team.name } : null,
      firstFixtureDate,
      daysOverdue: firstFixtureDate ? Math.max(0, Math.floor((now.getTime() - firstFixtureDate.getTime()) / 86400000)) : null,
    };
  }));

  res.json({ overdue: enriched, firstFixtureDate, totalOverdue: enriched.length });
});

router.post("/leagues/:id/registrations/:regId/remind", requirePermission("canManageLeagues"), async (req, res): Promise<void> => {
  const leagueId = Number(req.params.id);
  const regId = Number(req.params.regId);
  const { message } = req.body;

  const [reg] = await db.select().from(leagueRegistrationsTable)
    .where(and(eq(leagueRegistrationsTable.id, regId), eq(leagueRegistrationsTable.leagueId, leagueId)));
  if (!reg) { res.status(404).json({ error: "Registration not found" }); return; }

  const reminderNote = `[REMINDER ${new Date().toISOString()}] Balance: $${reg.balanceDue}.${message ? ` ${message}` : ""}`;
  const updatedNotes = reg.notes ? `${reg.notes}\n${reminderNote}` : reminderNote;

  const [updated] = await db.update(leagueRegistrationsTable)
    .set({ notes: updatedNotes, updatedAt: new Date() } as Partial<typeof leagueRegistrationsTable.$inferInsert>)
    .where(eq(leagueRegistrationsTable.id, regId)).returning();

  res.json({
    registration: updated,
    reminderLogged: true,
    hint: "Reminder recorded in notes. Connect an email integration to deliver actual notifications.",
  });
});

// ─── Player self-service ───────────────────────────────────────────────────────

router.get("/leagues/:id/is-registered", async (req, res): Promise<void> => {
  const leagueId = Number(req.params.id);
  const auth = getAuth(req);

  if (!auth?.userId) {
    res.json({ isRegistered: false });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, auth.userId));
  if (user?.role === "admin" || user?.role === "staff") {
    res.json({ isRegistered: true });
    return;
  }

  const teams = await db.select().from(teamsTable).where(eq(teamsTable.leagueId, leagueId));
  for (const team of teams) {
    const [mem] = await db.select().from(teamMembersTable)
      .where(and(eq(teamMembersTable.teamId, team.id), eq(teamMembersTable.userId, auth.userId), eq(teamMembersTable.status, "active")));
    if (mem) {
      res.json({ isRegistered: true });
      return;
    }
  }

  const [fa] = await db.select().from(leagueFreeAgentsTable)
    .where(and(eq(leagueFreeAgentsTable.leagueId, leagueId), eq(leagueFreeAgentsTable.userId, auth.userId)));

  res.json({ isRegistered: !!fa });
});

router.get("/leagues/:id/my-status", requireAuth, async (req, res): Promise<void> => {
  const leagueId = Number(req.params.id);
  const clerkUserId = (req as AuthedRequest).clerkUserId;

  const teams = await db.select().from(teamsTable).where(eq(teamsTable.leagueId, leagueId));
  let myTeam = null;
  let myMembership = null;
  for (const team of teams) {
    const [mem] = await db.select().from(teamMembersTable)
      .where(and(eq(teamMembersTable.teamId, team.id), eq(teamMembersTable.userId, clerkUserId), eq(teamMembersTable.status, "active")));
    if (mem) { myTeam = team; myMembership = mem; break; }
  }

  const [freeAgent] = await db.select().from(leagueFreeAgentsTable)
    .where(and(eq(leagueFreeAgentsTable.leagueId, leagueId), eq(leagueFreeAgentsTable.userId, clerkUserId)));

  let registration = null;
  if (myTeam) {
    const [reg] = await db.select().from(leagueRegistrationsTable)
      .where(and(eq(leagueRegistrationsTable.leagueId, leagueId), eq(leagueRegistrationsTable.teamId, myTeam.id)));
    registration = reg ?? null;
  }

  res.json({ myTeam, myMembership, freeAgent: freeAgent ?? null, registration });
});

export default router;
