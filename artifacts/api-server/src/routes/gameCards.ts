/**
 * Game Cards API
 *
 * GET  /game-cards/my-games                     — ref's/scorekeeper's upcoming game cards
 * GET  /game-cards/:id                          — card detail
 * POST /game-cards/:id/check-in                 — mark home/away team present (ref only)
 * PATCH /game-cards/:id                         — update scores, fouls, notes (ref or scorekeeper)
 * POST /game-cards/:id/clock                    — start/pause/resume clock (ref only)
 * POST /game-cards/:id/submit-for-approval      — scorekeeper submits for ref review
 * POST /game-cards/:id/approve                  — ref (or admin) approves and locks card
 * POST /game-cards/:id/correction               — ref logs a correction during review
 * POST /game-cards/:id/complete                 — legacy direct complete (ref only)
 * GET  /admin/game-cards                        — list all game cards (admin)
 * PATCH /admin/game-cards/:id/approve-override  — admin approves on behalf of ref
 * GET  /fixtures/:id/game-card                  — get game card for a fixture
 * POST /fixtures/:id/game-card/generate         — manually trigger game card generation
 */
import { Router, type IRouter } from "express";
import {
  db, gameCardsTable, fixturesTable, usersTable, teamsTable,
  teamMembersTable, courtsTable,
} from "@workspace/db";
import { eq, and, desc, asc, or, inArray, sql } from "drizzle-orm";
import { requireAuth, requirePermission, hasPermission, type AuthedRequest } from "../middlewares/auth";
import { ensureGameCard } from "../services/gameCardService";
import { recomputeStandings } from "./leagues";
import { runTournamentBracketProgression } from "./tournaments";

async function isGameCardAdmin(clerkUserId: string): Promise<boolean> {
  return hasPermission(clerkUserId, "canManageGameCards");
}

function requireGameCardAdmin(req: any, res: any, next: any) {
  requireAuth(req, res, async () => {
    const clerkUserId = (req as AuthedRequest).clerkUserId;
    if (await isGameCardAdmin(clerkUserId)) return next();
    res.status(403).json({ error: "Admin access required" });
  });
}

const router: IRouter = Router();

function parseCard(card: any) {
  return {
    ...card,
    homeRoster: (() => { try { return JSON.parse(card.homeRoster || "[]"); } catch { return []; } })(),
    awayRoster: (() => { try { return JSON.parse(card.awayRoster || "[]"); } catch { return []; } })(),
    refUserIds: (() => { try { return JSON.parse(card.refUserIds || "[]"); } catch { return []; } })(),
    fouls: (() => { try { return JSON.parse(card.fouls || "[]"); } catch { return []; } })(),
    disciplinaryActions: (() => { try { return JSON.parse(card.disciplinaryActions || "[]"); } catch { return []; } })(),
    clockState: (() => { try { return card.clockState ? JSON.parse(card.clockState) : null; } catch { return null; } })(),
    accumulatedFouls: (() => { try { return JSON.parse(card.accumulatedFouls || '{"home":0,"away":0,"half":1}'); } catch { return { home: 0, away: 0, half: 1 }; } })(),
    goals: (() => { try { return JSON.parse(card.goals || "[]"); } catch { return []; } })(),
    corrections: (() => { try { return JSON.parse(card.corrections || "[]"); } catch { return []; } })(),
  };
}

async function enrichCard(card: any) {
  const parsed = parseCard(card);

  const [fixture] = await db.select().from(fixturesTable).where(eq(fixturesTable.id, card.fixtureId));
  let court = null;
  if (fixture?.courtId) {
    const [c] = await db.select().from(courtsTable).where(eq(courtsTable.id, fixture.courtId));
    court = c ?? null;
  }

  let scorekeeperName: string | null = null;
  if (card.scorekeeperId) {
    const [sk] = await db.select().from(usersTable).where(eq(usersTable.id, card.scorekeeperId));
    if (sk) scorekeeperName = `${sk.firstName ?? ""} ${sk.lastName ?? ""}`.trim() || null;
  }

  let refNames: string[] = [];
  if (parsed.refUserIds.length > 0) {
    const refs = await db.select().from(usersTable).where(inArray(usersTable.id, parsed.refUserIds));
    refNames = refs.map((r) => `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim()).filter(Boolean);
  }

  return { ...parsed, fixture: fixture ?? null, court, scorekeeperName, refNames };
}

type CardAccessLevel = "full" | "team_member" | "denied";

async function getDbUser(clerkUserId: string) {
  const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkUserId));
  return dbUser ?? null;
}

async function getCardAccessLevel(card: any, clerkUserId: string): Promise<CardAccessLevel> {
  const isAdmin = await isGameCardAdmin(clerkUserId);
  if (isAdmin) return "full";

  const dbUser = await getDbUser(clerkUserId);
  if (!dbUser) return "denied";

  const refIds: number[] = (() => { try { return JSON.parse(card.refUserIds || "[]"); } catch { return []; } })();
  if (refIds.includes(dbUser.id)) return "full";

  if (card.scorekeeperId && card.scorekeeperId === dbUser.id) return "full";

  const teamIds: number[] = [card.homeTeamId, card.awayTeamId].filter(Boolean);
  if (teamIds.length > 0) {
    const [mem] = await db.select().from(teamMembersTable)
      .where(and(
        eq(teamMembersTable.userId, clerkUserId),
        eq(teamMembersTable.status, "active"),
        inArray(teamMembersTable.teamId, teamIds),
      ));
    if (mem) {
      return card.status === "completed" || card.status === "approved" ? "team_member" : "denied";
    }
  }

  return "denied";
}

async function canAccessCard(card: any, clerkUserId: string): Promise<boolean> {
  return (await getCardAccessLevel(card, clerkUserId)) !== "denied";
}

function redactRoster(roster: any[]): any[] {
  return roster.map(({ guardianContact: _stripped, ...rest }) => rest);
}

function applyCardRedaction(enriched: any, level: CardAccessLevel): any {
  if (level === "full") return enriched;
  return {
    ...enriched,
    homeRoster: Array.isArray(enriched.homeRoster) ? redactRoster(enriched.homeRoster) : enriched.homeRoster,
    awayRoster: Array.isArray(enriched.awayRoster) ? redactRoster(enriched.awayRoster) : enriched.awayRoster,
  };
}

async function isCardRef(card: any, clerkUserId: string): Promise<boolean> {
  const dbUser = await getDbUser(clerkUserId);
  if (!dbUser) return false;
  const refIds: number[] = (() => { try { return JSON.parse(card.refUserIds || "[]"); } catch { return []; } })();
  const isAdmin = await isGameCardAdmin(clerkUserId);
  return refIds.includes(dbUser.id) || isAdmin;
}

async function isCardScorekeeper(card: any, clerkUserId: string): Promise<boolean> {
  const dbUser = await getDbUser(clerkUserId);
  if (!dbUser) return false;
  return card.scorekeeperId === dbUser.id;
}

async function isRefOrAdmin(card: any, clerkUserId: string): Promise<boolean> {
  return await isCardRef(card, clerkUserId);
}

// ─── GET /game-cards/my-games ─────────────────────────────────────────────────

router.get("/game-cards/my-games", requireAuth, async (req, res): Promise<void> => {
  const clerkUserId = (req as AuthedRequest).clerkUserId;
  const dbUser = await getDbUser(clerkUserId);
  if (!dbUser) { res.status(404).json({ error: "User not found" }); return; }

  const isAdmin = await isGameCardAdmin(clerkUserId);

  let cards: any[];

  if (isAdmin) {
    cards = await db.select().from(gameCardsTable).orderBy(desc(gameCardsTable.createdAt)).limit(100);
  } else {
    const allCards = await db.select().from(gameCardsTable).orderBy(asc(gameCardsTable.createdAt));
    cards = allCards.filter((c) => {
      const refIds: number[] = (() => { try { return JSON.parse(c.refUserIds || "[]"); } catch { return []; } })();
      const isRef = refIds.includes(dbUser.id);
      const isScorekeeper = c.scorekeeperId === dbUser.id;
      return isRef || isScorekeeper;
    });
  }

  const enriched = await Promise.all(cards.map(enrichCard));
  res.json(enriched);
});

// ─── GET /game-cards/:id ──────────────────────────────────────────────────────

router.get("/game-cards/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const clerkUserId = (req as AuthedRequest).clerkUserId;

  const [card] = await db.select().from(gameCardsTable).where(eq(gameCardsTable.id, id));
  if (!card) { res.status(404).json({ error: "Game card not found" }); return; }

  const level = await getCardAccessLevel(card, clerkUserId);
  if (level === "denied") { res.status(403).json({ error: "Access denied" }); return; }

  res.json(applyCardRedaction(await enrichCard(card), level));
});

// ─── POST /game-cards/:id/check-in ───────────────────────────────────────────

router.post("/game-cards/:id/check-in", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const clerkUserId = (req as AuthedRequest).clerkUserId;

  const [card] = await db.select().from(gameCardsTable).where(eq(gameCardsTable.id, id));
  if (!card) { res.status(404).json({ error: "Game card not found" }); return; }
  if (card.lockedAt) { res.status(409).json({ error: "Game card is locked" }); return; }
  if (!await isCardRef(card, clerkUserId)) { res.status(403).json({ error: "Only the assigned ref can check in teams" }); return; }

  const { team } = req.body as { team: "home" | "away" };
  if (team !== "home" && team !== "away") { res.status(400).json({ error: "team must be 'home' or 'away'" }); return; }

  const updates: any = { updatedAt: new Date() };
  if (team === "home") updates.homePresent = true;
  else updates.awayPresent = true;

  const newHomePresent = team === "home" ? true : card.homePresent;
  const newAwayPresent = team === "away" ? true : card.awayPresent;
  if (newHomePresent && newAwayPresent && card.status === "upcoming") {
    updates.status = "in_progress";
  }

  const [updated] = await db.update(gameCardsTable).set(updates).where(eq(gameCardsTable.id, id)).returning();
  res.json(parseCard(updated));
});

// ─── PATCH /game-cards/:id ────────────────────────────────────────────────────

router.patch("/game-cards/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const clerkUserId = (req as AuthedRequest).clerkUserId;

  const [card] = await db.select().from(gameCardsTable).where(eq(gameCardsTable.id, id));
  if (!card) { res.status(404).json({ error: "Game card not found" }); return; }
  if (card.lockedAt) { res.status(409).json({ error: "Game card is locked" }); return; }
  if (card.status === "pending_approval") {
    res.status(409).json({ error: "Card is pending referee approval. Use the correction endpoint to make changes." }); return;
  }

  const isRef = await isCardRef(card, clerkUserId);
  const isScorekeeper = await isCardScorekeeper(card, clerkUserId);

  if (!isRef && !isScorekeeper) {
    res.status(403).json({ error: "Only the assigned ref or scorekeeper can update this card" }); return;
  }

  const { homeScore, awayScore, fouls, disciplinaryActions, notes, accumulatedFouls } = req.body;
  const updates: any = { updatedAt: new Date() };

  if (homeScore !== undefined) {
    if (typeof homeScore !== "number" || homeScore < 0) { res.status(400).json({ error: "homeScore must be a non-negative number" }); return; }
    updates.homeScore = homeScore;
  }
  if (awayScore !== undefined) {
    if (typeof awayScore !== "number" || awayScore < 0) { res.status(400).json({ error: "awayScore must be a non-negative number" }); return; }
    updates.awayScore = awayScore;
  }

  if (fouls !== undefined) {
    if (!isRef) { res.status(403).json({ error: "Only the ref can record fouls" }); return; }
    if (!Array.isArray(fouls)) { res.status(400).json({ error: "fouls must be an array" }); return; }
    updates.fouls = JSON.stringify(fouls);
  }
  if (disciplinaryActions !== undefined) {
    if (!isRef) { res.status(403).json({ error: "Only the ref can record disciplinary actions" }); return; }
    if (!Array.isArray(disciplinaryActions)) { res.status(400).json({ error: "disciplinaryActions must be an array" }); return; }
    updates.disciplinaryActions = JSON.stringify(disciplinaryActions);
    updates.disciplinaryFlagged = disciplinaryActions.length > 0;
  }
  if (notes !== undefined) {
    if (!isRef) { res.status(403).json({ error: "Only the ref can add notes" }); return; }
    updates.notes = notes;
  }
  if (accumulatedFouls !== undefined) {
    if (typeof accumulatedFouls !== "object") { res.status(400).json({ error: "accumulatedFouls must be an object" }); return; }
    updates.accumulatedFouls = JSON.stringify(accumulatedFouls);
  }

  if (card.status === "upcoming" && (homeScore !== undefined || awayScore !== undefined)) {
    const isTournament = card.entityType === "tournament";
    if (isTournament && (!card.homePresent || !card.awayPresent)) {
      res.status(409).json({ error: "Both teams must be checked in before scoring can begin" });
      return;
    }
    updates.status = "in_progress";
  }

  const [updated] = await db.update(gameCardsTable).set(updates).where(eq(gameCardsTable.id, id)).returning();
  res.json(parseCard(updated));
});

// ─── POST /game-cards/:id/clock ───────────────────────────────────────────────

router.post("/game-cards/:id/clock", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const clerkUserId = (req as AuthedRequest).clerkUserId;

  const [card] = await db.select().from(gameCardsTable).where(eq(gameCardsTable.id, id));
  if (!card) { res.status(404).json({ error: "Game card not found" }); return; }
  if (card.lockedAt) { res.status(409).json({ error: "Game card is locked" }); return; }
  if (!await isCardRef(card, clerkUserId)) { res.status(403).json({ error: "Only the assigned ref can control the clock" }); return; }

  const { action } = req.body as { action: "start" | "pause" | "resume" };
  if (!["start", "pause", "resume"].includes(action)) {
    res.status(400).json({ error: "action must be start, pause, or resume" }); return;
  }

  const now = Date.now();
  let clockState: { startedAt: number | null; pausedAt: number | null; totalPausedMs: number } =
    (() => { try { return card.clockState ? JSON.parse(card.clockState) : { startedAt: null, pausedAt: null, totalPausedMs: 0 }; } catch { return { startedAt: null, pausedAt: null, totalPausedMs: 0 }; } })();

  if (action === "start") {
    clockState = { startedAt: now, pausedAt: null, totalPausedMs: 0 };
  } else if (action === "pause") {
    if (!clockState.startedAt || clockState.pausedAt) {
      res.status(409).json({ error: "Clock is not running" }); return;
    }
    clockState = { ...clockState, pausedAt: now };
  } else if (action === "resume") {
    if (!clockState.pausedAt) {
      res.status(409).json({ error: "Clock is not paused" }); return;
    }
    const pauseDuration = now - clockState.pausedAt;
    clockState = {
      ...clockState,
      pausedAt: null,
      totalPausedMs: (clockState.totalPausedMs ?? 0) + pauseDuration,
    };
  }

  const updates: any = {
    clockState: JSON.stringify(clockState),
    updatedAt: new Date(),
  };
  if (action === "start" && card.status === "upcoming") {
    updates.status = "in_progress";
  }

  const [updated] = await db.update(gameCardsTable).set(updates).where(eq(gameCardsTable.id, id)).returning();
  res.json(parseCard(updated));
});

// ─── POST /game-cards/:id/goal ────────────────────────────────────────────────

router.post("/game-cards/:id/goal", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const clerkUserId = (req as AuthedRequest).clerkUserId;

  const [card] = await db.select().from(gameCardsTable).where(eq(gameCardsTable.id, id));
  if (!card) { res.status(404).json({ error: "Game card not found" }); return; }
  if (card.lockedAt || card.status === "approved" || card.status === "completed") {
    res.status(409).json({ error: "Game card is locked" }); return;
  }
  if (card.status === "pending_approval") {
    res.status(409).json({ error: "Card is pending referee approval. Use the correction endpoint to make changes." }); return;
  }

  const isScorekeeper = await isCardScorekeeper(card, clerkUserId);
  const isRef = await isCardRef(card, clerkUserId);
  const isAdmin = await isGameCardAdmin(clerkUserId);
  if (!isScorekeeper && !isRef && !isAdmin) {
    res.status(403).json({ error: "Only the assigned ref or scorekeeper can record goals" }); return;
  }

  const { team, playerName, score } = req.body as {
    team: "home" | "away";
    playerName?: string;
    score: number;
  };
  if (team !== "home" && team !== "away") { res.status(400).json({ error: "team must be 'home' or 'away'" }); return; }
  if (typeof score !== "number" || score < 0) { res.status(400).json({ error: "score must be a non-negative number" }); return; }

  const existing: any[] = (() => { try { return JSON.parse(card.goals || "[]"); } catch { return []; } })();
  const newGoal = {
    team,
    playerName: playerName?.trim() || null,
    score,
    timestamp: new Date().toISOString(),
  };
  const updatedGoals = [...existing, newGoal];

  const scoreUpdate = team === "home" ? { homeScore: score } : { awayScore: score };
  const [updated] = await db.update(gameCardsTable).set({
    ...scoreUpdate,
    goals: JSON.stringify(updatedGoals),
    updatedAt: new Date(),
  }).where(eq(gameCardsTable.id, id)).returning();

  res.json(parseCard(updated));
});

// ─── POST /game-cards/:id/submit-for-approval ─────────────────────────────────

router.post("/game-cards/:id/submit-for-approval", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const clerkUserId = (req as AuthedRequest).clerkUserId;

  const [card] = await db.select().from(gameCardsTable).where(eq(gameCardsTable.id, id));
  if (!card) { res.status(404).json({ error: "Game card not found" }); return; }
  if (card.lockedAt) { res.status(409).json({ error: "Game card is already locked" }); return; }
  if (card.status === "pending_approval") { res.status(409).json({ error: "Already pending approval" }); return; }

  const isScorekeeper = await isCardScorekeeper(card, clerkUserId);

  if (!isScorekeeper) {
    res.status(403).json({ error: "Only the assigned scorekeeper can submit for ref approval" }); return;
  }

  const [updated] = await db.update(gameCardsTable).set({
    status: "pending_approval",
    updatedAt: new Date(),
  }).where(eq(gameCardsTable.id, id)).returning();

  res.json(parseCard(updated));
});

// ─── POST /game-cards/:id/correction ─────────────────────────────────────────

router.post("/game-cards/:id/correction", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const clerkUserId = (req as AuthedRequest).clerkUserId;

  const [card] = await db.select().from(gameCardsTable).where(eq(gameCardsTable.id, id));
  if (!card) { res.status(404).json({ error: "Game card not found" }); return; }
  if (card.lockedAt) { res.status(409).json({ error: "Game card is locked" }); return; }
  if (!await isCardRef(card, clerkUserId)) { res.status(403).json({ error: "Only the ref can log corrections" }); return; }

  const { description, field, oldValue, newValue } = req.body;
  if (!description) { res.status(400).json({ error: "description is required" }); return; }

  const existing: any[] = (() => { try { return JSON.parse(card.corrections || "[]"); } catch { return []; } })();
  const newCorrection = {
    description,
    field: field ?? null,
    oldValue: oldValue ?? null,
    newValue: newValue ?? null,
    timestamp: new Date().toISOString(),
    correctedByClerkId: clerkUserId,
  };

  const updates: any = {
    corrections: JSON.stringify([...existing, newCorrection]),
    status: "pending_approval",
    updatedAt: new Date(),
  };

  if (req.body.homeScore !== undefined) updates.homeScore = req.body.homeScore;
  if (req.body.awayScore !== undefined) updates.awayScore = req.body.awayScore;
  if (req.body.fouls !== undefined) updates.fouls = JSON.stringify(req.body.fouls);
  if (req.body.disciplinaryActions !== undefined) {
    updates.disciplinaryActions = JSON.stringify(req.body.disciplinaryActions);
    updates.disciplinaryFlagged = req.body.disciplinaryActions.length > 0;
  }

  const [updated] = await db.update(gameCardsTable).set(updates).where(eq(gameCardsTable.id, id)).returning();
  res.json(parseCard(updated));
});

// ─── POST /game-cards/:id/approve ────────────────────────────────────────────

router.post("/game-cards/:id/approve", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const clerkUserId = (req as AuthedRequest).clerkUserId;

  const [card] = await db.select().from(gameCardsTable).where(eq(gameCardsTable.id, id));
  if (!card) { res.status(404).json({ error: "Game card not found" }); return; }
  if (card.lockedAt) { res.status(409).json({ error: "Game card is already locked" }); return; }
  if (card.status !== "pending_approval") {
    res.status(409).json({ error: "Card must be in pending_approval state before it can be approved" }); return;
  }
  if (!await isRefOrAdmin(card, clerkUserId)) { res.status(403).json({ error: "Only the assigned ref or admin can approve" }); return; }

  const dbUser = await getDbUser(clerkUserId);
  if (!dbUser) { res.status(404).json({ error: "User not found" }); return; }

  const { homeScore, awayScore } = req.body;
  const now = new Date();

  if (card.entityType === "tournament" && homeScore !== undefined && awayScore !== undefined) {
    const [preFix] = await db.select().from(fixturesTable).where(eq(fixturesTable.id, card.fixtureId));
    const knockoutPhases = ["playoff", "winners", "losers", "grand_final"];
    if (preFix && knockoutPhases.includes(preFix.phase ?? "") && Number(homeScore) === Number(awayScore)) {
      res.status(400).json({ error: "Ties are not allowed in elimination rounds. A winner must be declared." });
      return;
    }
  }

  const updates: any = {
    status: "approved",
    completedAt: now,
    lockedAt: now,
    approvedAt: now,
    approvedBy: dbUser.id,
    updatedAt: now,
  };
  if (homeScore !== undefined) updates.homeScore = homeScore;
  if (awayScore !== undefined) updates.awayScore = awayScore;

  const disciplinaryActions: any[] = (() => { try { return JSON.parse(card.disciplinaryActions || "[]"); } catch { return []; } })();
  if (disciplinaryActions.length > 0) updates.disciplinaryFlagged = true;

  const [updated] = await db.update(gameCardsTable).set(updates).where(eq(gameCardsTable.id, id)).returning();

  const finalHome = updated.homeScore ?? 0;
  const finalAway = updated.awayScore ?? 0;

  const [priorFixture] = await db.select().from(fixturesTable).where(eq(fixturesTable.id, card.fixtureId));
  await db.update(fixturesTable).set({
    homeScore: finalHome,
    awayScore: finalAway,
    status: "completed",
    updatedAt: now,
  }).where(eq(fixturesTable.id, card.fixtureId));

  if (card.entityType === "league" && card.entityId) {
    await recomputeStandings(card.entityId);
  } else if (card.entityType === "tournament" && card.entityId && priorFixture) {
    await runTournamentBracketProgression(
      card.fixtureId,
      card.entityId,
      priorFixture,
      finalHome,
      finalAway,
    );
  }

  res.json(parseCard(updated));
});

// ─── POST /game-cards/:id/complete ───────────────────────────────────────────

router.post("/game-cards/:id/complete", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const clerkUserId = (req as AuthedRequest).clerkUserId;

  const [card] = await db.select().from(gameCardsTable).where(eq(gameCardsTable.id, id));
  if (!card) { res.status(404).json({ error: "Game card not found" }); return; }
  if (card.lockedAt) { res.status(409).json({ error: "Game card is already completed" }); return; }
  if (card.scorekeeperId) {
    res.status(409).json({ error: "A scorekeeper is assigned. Use submit-for-approval → approve flow instead of direct complete." }); return;
  }
  if (!await isCardRef(card, clerkUserId)) { res.status(403).json({ error: "Only the assigned ref can complete this card" }); return; }

  const now = new Date();
  const { homeScore, awayScore } = req.body;

  if (homeScore !== undefined && (typeof homeScore !== "number" || homeScore < 0)) {
    res.status(400).json({ error: "homeScore must be a non-negative number" }); return;
  }
  if (awayScore !== undefined && (typeof awayScore !== "number" || awayScore < 0)) {
    res.status(400).json({ error: "awayScore must be a non-negative number" }); return;
  }

  if (card.entityType === "tournament" && homeScore !== undefined && awayScore !== undefined) {
    const [preFix] = await db.select().from(fixturesTable).where(eq(fixturesTable.id, card.fixtureId));
    const knockoutPhases = ["playoff", "winners", "losers", "grand_final"];
    if (preFix && knockoutPhases.includes(preFix.phase ?? "") && Number(homeScore) === Number(awayScore)) {
      res.status(400).json({ error: "Ties are not allowed in elimination rounds. A winner must be declared." });
      return;
    }
  }

  const dbUser = await getDbUser(clerkUserId);

  const updates: any = {
    status: "completed",
    completedAt: now,
    lockedAt: now,
    approvedAt: now,
    approvedBy: dbUser?.id ?? null,
    updatedAt: now,
  };
  if (homeScore !== undefined) updates.homeScore = homeScore;
  if (awayScore !== undefined) updates.awayScore = awayScore;

  const disciplinaryActions: any[] = (() => { try { return JSON.parse(card.disciplinaryActions || "[]"); } catch { return []; } })();
  if (disciplinaryActions.length > 0) updates.disciplinaryFlagged = true;

  const [updated] = await db.update(gameCardsTable).set(updates).where(eq(gameCardsTable.id, id)).returning();

  const finalHome = updated.homeScore ?? 0;
  const finalAway = updated.awayScore ?? 0;

  const [priorFixture] = await db.select().from(fixturesTable).where(eq(fixturesTable.id, card.fixtureId));
  await db.update(fixturesTable).set({
    homeScore: finalHome,
    awayScore: finalAway,
    status: "completed",
    updatedAt: now,
  }).where(eq(fixturesTable.id, card.fixtureId));

  if (card.entityType === "league" && card.entityId) {
    await recomputeStandings(card.entityId);
  } else if (card.entityType === "tournament" && card.entityId && priorFixture) {
    await runTournamentBracketProgression(
      card.fixtureId,
      card.entityId,
      priorFixture,
      finalHome,
      finalAway,
    );
  }

  res.json(parseCard(updated));
});

// ─── Admin routes ─────────────────────────────────────────────────────────────

router.get("/admin/game-cards", requireGameCardAdmin, async (req, res): Promise<void> => {
  const { entityType, entityId, status, flagged } = req.query as Record<string, string>;

  let cards = await db.select().from(gameCardsTable).orderBy(desc(gameCardsTable.createdAt));

  if (entityType) cards = cards.filter((c) => c.entityType === entityType);
  if (entityId) cards = cards.filter((c) => c.entityId === Number(entityId));
  if (status) cards = cards.filter((c) => c.status === status);
  if (flagged === "true") cards = cards.filter((c) => c.disciplinaryFlagged);

  const enriched = await Promise.all(cards.map(enrichCard));
  res.json(enriched);
});

router.patch("/admin/game-cards/:id/review-disciplinary", requireGameCardAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const clerkUserId = (req as AuthedRequest).clerkUserId;

  const [card] = await db.select().from(gameCardsTable).where(eq(gameCardsTable.id, id));
  if (!card) { res.status(404).json({ error: "Game card not found" }); return; }

  const dbUser = await getDbUser(clerkUserId);
  if (!dbUser) { res.status(404).json({ error: "User not found" }); return; }

  const [updated] = await db.update(gameCardsTable).set({
    disciplinaryReviewedAt: new Date(),
    disciplinaryReviewedBy: dbUser.id,
    updatedAt: new Date(),
  }).where(eq(gameCardsTable.id, id)).returning();

  res.json(parseCard(updated));
});

// ─── PATCH /admin/game-cards/:id/approve-override ────────────────────────────

router.patch("/admin/game-cards/:id/approve-override", requireGameCardAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const clerkUserId = (req as AuthedRequest).clerkUserId;

  const [card] = await db.select().from(gameCardsTable).where(eq(gameCardsTable.id, id));
  if (!card) { res.status(404).json({ error: "Game card not found" }); return; }
  if (card.lockedAt) { res.status(409).json({ error: "Game card is already locked" }); return; }
  if (card.status !== "pending_approval") {
    res.status(409).json({ error: "Card is not pending approval" }); return;
  }

  const dbUser = await getDbUser(clerkUserId);
  if (!dbUser) { res.status(404).json({ error: "User not found" }); return; }

  const now = new Date();
  const updates: any = {
    status: "approved",
    completedAt: now,
    lockedAt: now,
    approvedAt: now,
    approvedBy: dbUser.id,
    updatedAt: now,
  };

  const [updated] = await db.update(gameCardsTable).set(updates).where(eq(gameCardsTable.id, id)).returning();

  const finalHome = updated.homeScore ?? 0;
  const finalAway = updated.awayScore ?? 0;

  const [priorFixture] = await db.select().from(fixturesTable).where(eq(fixturesTable.id, card.fixtureId));
  await db.update(fixturesTable).set({
    homeScore: finalHome,
    awayScore: finalAway,
    status: "completed",
    updatedAt: now,
  }).where(eq(fixturesTable.id, card.fixtureId));

  if (card.entityType === "league" && card.entityId) {
    await recomputeStandings(card.entityId);
  } else if (card.entityType === "tournament" && card.entityId && priorFixture) {
    await runTournamentBracketProgression(
      card.fixtureId,
      card.entityId,
      priorFixture,
      finalHome,
      finalAway,
    );
  }

  res.json(parseCard(updated));
});

// ─── GET /fixtures/:id/game-card ─────────────────────────────────────────────

router.get("/fixtures/:id/game-card", requireAuth, async (req, res): Promise<void> => {
  const fixtureId = Number(req.params.id);
  if (isNaN(fixtureId)) { res.status(400).json({ error: "Invalid fixture id" }); return; }
  const clerkUserId = (req as AuthedRequest).clerkUserId;

  const [card] = await db.select().from(gameCardsTable).where(eq(gameCardsTable.fixtureId, fixtureId));
  if (!card) { res.status(404).json({ error: "No game card for this fixture" }); return; }

  const level = await getCardAccessLevel(card, clerkUserId);
  if (level === "denied") { res.status(403).json({ error: "Access denied" }); return; }

  res.json(applyCardRedaction(await enrichCard(card), level));
});

// ─── POST /fixtures/:id/game-card/generate ───────────────────────────────────

router.post("/fixtures/:id/game-card/generate", requireGameCardAdmin, async (req, res): Promise<void> => {
  const fixtureId = Number(req.params.id);
  if (isNaN(fixtureId)) { res.status(400).json({ error: "Invalid fixture id" }); return; }

  const [fixture] = await db.select().from(fixturesTable).where(eq(fixturesTable.id, fixtureId));
  if (!fixture) { res.status(404).json({ error: "Fixture not found" }); return; }

  await ensureGameCard(fixtureId);

  const [card] = await db.select().from(gameCardsTable).where(eq(gameCardsTable.fixtureId, fixtureId));
  if (!card) { res.status(500).json({ error: "Failed to generate game card" }); return; }

  res.status(201).json(parseCard(card));
});

export default router;
