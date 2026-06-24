/**
 * Deadline Scheduler — background worker that auto-processes registration deadlines.
 *
 * Runs every 5 minutes. For each "upcoming" league/tournament whose
 * registrationDeadline has passed:
 *   - Leagues with ≥ 2 teams: generates round-robin fixture schedule, sets status="scheduled"
 *   - Leagues with < 2 teams: sets status="scheduled" (no fixtures; admin handles manually)
 *   - Tournaments with ≥ 2 active registrations: auto-seeds teams by registration date,
 *     generates bracket fixtures, sets status="scheduled"
 *   - Tournaments with < 2 teams: sets status="scheduled" (bracket gen manual)
 *   - Sends an in-app notification to every admin user summarising what was processed
 *
 * Status lifecycle: upcoming → scheduled (deadline passed, fixtures ready) → active (season live)
 * All jobs are idempotent: once a league/tournament leaves "upcoming" it is skipped.
 */

import { db } from "@workspace/db";
import {
  leaguesTable,
  tournamentsTable,
  teamsTable,
  fixturesTable,
  usersTable,
  tournamentRegistrationsTable,
  tournamentSeedsTable,
  bracketsTable,
} from "@workspace/db";
import { eq, and, lte, sql, asc } from "drizzle-orm";
import { sendNotification } from "./notifications";
import {
  nextPowerOf2,
  generateSingleElimBracket,
  generateDoubleElimBracket,
  generateGroupStageBracket,
} from "../lib/bracketGenerators";

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ── Round-robin generator (matches leagues.ts) ─────────────────────────────
function generateRoundRobin(n: number): { homeIdx: number; awayIdx: number; round: number }[] {
  const fixtures: { homeIdx: number; awayIdx: number; round: number }[] = [];
  const teams = Array.from({ length: n }, (_, i) => i);
  if (n % 2 !== 0) teams.push(-1);
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

// ── Core processing ────────────────────────────────────────────────────────
interface ProcessResult {
  type: "league" | "tournament";
  id: number;
  name: string;
  action: string;
  fixturesGenerated?: number;
  error?: string;
}

async function processDeadlines(): Promise<ProcessResult[]> {
  const now = new Date();
  const results: ProcessResult[] = [];

  // Only process offerings whose deadline has passed and are still "upcoming"
  // (status lifecycle: upcoming → scheduled → active → completed)
  const [overdueLeagues, overdueTournaments] = await Promise.all([
    db.select().from(leaguesTable)
      .where(and(eq(leaguesTable.status, "upcoming"), lte(leaguesTable.registrationDeadline, now))),
    db.select().from(tournamentsTable)
      .where(and(eq(tournamentsTable.status, "upcoming"), lte(tournamentsTable.registrationDeadline, now))),
  ]);

  // ── League processing ──────────────────────────────────────────────────
  for (const league of overdueLeagues) {
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
      .from(fixturesTable)
      .where(and(eq(fixturesTable.entityType, "league"), eq(fixturesTable.entityId, league.id)));

    if (count > 0) {
      await db.update(leaguesTable).set({ status: "scheduled", updatedAt: new Date() } as any).where(eq(leaguesTable.id, league.id));
      results.push({ type: "league", id: league.id, name: league.name, action: "already_has_fixtures" });
      continue;
    }

    const teams = await db.select().from(teamsTable).where(eq(teamsTable.leagueId, league.id));
    if (teams.length < 2) {
      await db.update(leaguesTable).set({ status: "scheduled", updatedAt: new Date() } as any).where(eq(leaguesTable.id, league.id));
      results.push({ type: "league", id: league.id, name: league.name, action: "activated_insufficient_teams", error: `Only ${teams.length} team(s) registered` });
      continue;
    }

    try {
      const matchups = generateRoundRobin(teams.length);
      const startDt = league.startDate ? new Date(league.startDate) : new Date(now);
      while (startDt.getDay() !== 6) startDt.setDate(startDt.getDate() + 1);

      let created = 0;
      const roundSlotCount: Record<number, number> = {};
      for (const m of matchups) {
        if (!roundSlotCount[m.round]) roundSlotCount[m.round] = 0;
        const slotIndex = roundSlotCount[m.round];
        const gameDate = new Date(startDt);
        gameDate.setDate(gameDate.getDate() + (m.round - 1) * 7);
        gameDate.setHours(18 + slotIndex, 0, 0, 0);

        await db.insert(fixturesTable).values({
          entityType: "league",
          entityId: league.id,
          homeTeamId: teams[m.homeIdx].id,
          awayTeamId: teams[m.awayIdx].id,
          courtId: league.courtId,
          scheduledAt: gameDate,
          durationMinutes: 90,
          round: m.round,
          phase: "group",
          status: "scheduled",
        } as any);
        created++;
        roundSlotCount[m.round]++;
      }

      await db.update(leaguesTable).set({ status: "scheduled", updatedAt: new Date() } as any).where(eq(leaguesTable.id, league.id));
      results.push({ type: "league", id: league.id, name: league.name, action: "fixtures_generated", fixturesGenerated: created });
    } catch (err: any) {
      results.push({ type: "league", id: league.id, name: league.name, action: "error", error: err?.message });
    }
  }

  // ── Tournament processing ──────────────────────────────────────────────
  for (const tournament of overdueTournaments) {
    // Check if already has fixtures
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
      .from(fixturesTable)
      .where(and(eq(fixturesTable.entityType, "tournament"), eq(fixturesTable.entityId, tournament.id)));

    if (count > 0) {
      await db.update(tournamentsTable)
        .set({ status: "scheduled", registrationOpen: false, updatedAt: new Date() } as any)
        .where(eq(tournamentsTable.id, tournament.id));
      results.push({ type: "tournament", id: tournament.id, name: tournament.name, action: "already_has_fixtures" });
      continue;
    }

    // Get active registrations ordered by creation date (registration order = seed order)
    const regs = await db.select().from(tournamentRegistrationsTable)
      .where(and(
        eq(tournamentRegistrationsTable.tournamentId, tournament.id),
        eq(tournamentRegistrationsTable.status, "active"),
      ))
      .orderBy(asc(tournamentRegistrationsTable.createdAt));

    if (regs.length < 2) {
      await db.update(tournamentsTable)
        .set({ status: "scheduled", registrationOpen: false, updatedAt: new Date() } as any)
        .where(eq(tournamentsTable.id, tournament.id));
      results.push({ type: "tournament", id: tournament.id, name: tournament.name, action: "activated_insufficient_teams", error: `Only ${regs.length} active registration(s)` });
      continue;
    }

    try {
      // Auto-seed teams by registration order (first registered = seed 1)
      await db.delete(tournamentSeedsTable).where(eq(tournamentSeedsTable.tournamentId, tournament.id));
      await db.insert(tournamentSeedsTable).values(
        regs.map((r, idx) => ({
          tournamentId: tournament.id,
          teamId: r.teamId,
          seed: idx + 1,
        } as any))
      );

      const seeds = regs.map((r, idx) => ({ teamId: r.teamId, seed: idx + 1 }));

      // Generate bracket based on format
      let fixtures: any[];
      if ((tournament as any).hasGroupStage) {
        const groupCount = Math.ceil(seeds.length / 4);
        const groups: { name: string; teamIds: number[] }[] = [];
        const letters = "ABCDEFGH";
        for (let g = 0; g < groupCount; g++) {
          const groupSeeds = seeds.filter((_, i) => i % groupCount === g);
          groups.push({ name: letters[g], teamIds: groupSeeds.map((s) => s.teamId as number) });
        }
        fixtures = generateGroupStageBracket(tournament.id, groups);
        // Add playoff placeholders
        const playoffTeams = (tournament as any).playoffTeams || groupCount * 2;
        const n = nextPowerOf2(playoffTeams);
        const rounds = Math.log2(n);
        for (let round = 1; round <= rounds; round++) {
          const count = n / Math.pow(2, round);
          for (let i = 0; i < count; i++) {
            fixtures.push({ entityType: "tournament", entityId: tournament.id, homeTeamId: null, awayTeamId: null, status: "pending", round, phase: "playoff", durationMinutes: 60 });
          }
        }
      } else if (tournament.bracketFormat === "double_elimination") {
        fixtures = generateDoubleElimBracket(tournament.id, seeds.map(s => ({ teamId: s.teamId, seed: s.seed })));
      } else {
        fixtures = generateSingleElimBracket(
          tournament.id,
          seeds.map(s => ({ teamId: s.teamId, seed: s.seed })),
          (tournament as any).consolationEnabled ?? false,
        );
      }

      // Delete any existing fixtures and insert new ones
      await db.delete(fixturesTable).where(and(eq(fixturesTable.entityType, "tournament"), eq(fixturesTable.entityId, tournament.id)));
      await db.insert(fixturesTable).values(fixtures);

      // Create/update bracket record
      await db.delete(bracketsTable).where(eq(bracketsTable.tournamentId, tournament.id));
      const slots = nextPowerOf2(seeds.length);
      const totalRounds = Math.log2(slots);
      await db.insert(bracketsTable).values({
        tournamentId: tournament.id,
        bracketType: tournament.bracketFormat ?? "single_elimination",
        totalRounds,
        currentRound: 1,
        status: "in_progress",
      } as any);

      await db.update(tournamentsTable)
        .set({ status: "scheduled", registrationOpen: false, updatedAt: new Date() } as any)
        .where(eq(tournamentsTable.id, tournament.id));

      results.push({ type: "tournament", id: tournament.id, name: tournament.name, action: "bracket_generated", fixturesGenerated: fixtures.length });
    } catch (err: any) {
      results.push({ type: "tournament", id: tournament.id, name: tournament.name, action: "error", error: err?.message });
    }
  }

  return results;
}

async function notifyAdmins(results: ProcessResult[]): Promise<void> {
  if (results.length === 0) return;

  const admins = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.role, "admin"));

  const lines = results.map(r => {
    if (r.action === "fixtures_generated") return `✓ League "${r.name}": ${r.fixturesGenerated} fixtures auto-generated`;
    if (r.action === "bracket_generated") return `✓ Tournament "${r.name}": ${r.fixturesGenerated} bracket fixtures auto-generated`;
    if (r.action === "already_has_fixtures") return `↩ "${r.name}": already had fixtures, activated`;
    if (r.action === "activated_insufficient_teams") return `⚠ "${r.name}": activated (${r.error})`;
    return `✗ "${r.name}": error — ${r.error}`;
  });

  if (lines.length === 0) return;

  const body = `Registration deadlines processed:\n${lines.join("\n")}\n\nVisit Admin → Leagues/Tournaments to review.`;

  await Promise.allSettled(admins.map(admin =>
    sendNotification({
      userId: admin.id,
      type: "admin_override",
      subject: "Deadline Auto-Scheduler ran",
      body,
      channel: "in_app",
    })
  ));
}

// ── Public entry point ─────────────────────────────────────────────────────
export function startDeadlineScheduler(): void {
  const run = async () => {
    try {
      const results = await processDeadlines();
      if (results.length > 0) {
        console.log(`[deadline-scheduler] processed ${results.length} offering(s):`, results.map(r => `${r.type}:${r.name}:${r.action}`).join(", "));
        await notifyAdmins(results).catch(err => console.error("[deadline-scheduler] notification error:", err?.message));
      }
    } catch (err: any) {
      console.error("[deadline-scheduler] run error:", err?.message);
    }
  };

  // Run once at startup, then every 5 minutes
  run();
  setInterval(run, POLL_INTERVAL_MS);
}
