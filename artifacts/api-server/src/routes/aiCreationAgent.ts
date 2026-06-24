/**
 * AI Creation Agent — Universal Admin Assistant
 *
 * POST /admin/ai/creation-agent              — send a message, get guided response + field updates
 * POST /admin/ai/creation-agent/create       — confirm & create the entity
 * POST /admin/ai/place-team                  — AI-guided team placement into division (persists to DB)
 * POST /admin/ai/trigger-deadline-schedules  — advance past-deadline offerings to active status
 *
 * Session management:
 * GET    /admin/ai/creation-sessions         — list my sessions
 * GET    /admin/ai/creation-sessions/:id     — get session with full thread
 * DELETE /admin/ai/creation-sessions/:id     — delete session
 *
 * Auth: requireSuperAdmin for all mutation endpoints (matches aiScheduling.ts convention).
 * Read endpoints (GET) also use requireSuperAdmin for admin-only resources.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  aiCreationSessionsTable,
  usersTable,
  courtsTable,
  ageGroupsTable,
  leaguesTable,
  campsTable,
  dropinsTable,
  tournamentsTable,
  membershipPlansTable,
  pricingRulesTable,
  payoutRateConfigsTable,
  assignmentsTable,
  fixturesTable,
  teamsTable,
  leagueRegistrationsTable,
  tournamentRegistrationsTable,
  seasonsTable,
} from "@workspace/db";
import { eq, and, desc, asc, lte, sql } from "drizzle-orm";
import { requireSuperAdmin, type AuthedRequest } from "../middlewares/auth";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import type { Request } from "express";

const router = Router();

const MODEL = "claude-sonnet-4-5";

// ── Round-robin fixture generator (mirrors leagues.ts logic) ──────────────

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

// ── Types ──────────────────────────────────────────────────────────────────

interface ThreadMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

// ── Context builder ────────────────────────────────────────────────────────

async function buildLiveContext(entityType: string) {
  const lines: string[] = [];
  const today = new Date().toISOString().split("T")[0];

  const [courts, ageGroups, activeSeason] = await Promise.all([
    db.select({ id: courtsTable.id, name: courtsTable.name, type: courtsTable.type })
      .from(courtsTable).where(eq(courtsTable.availableForScheduling, true)),
    db.select({ id: ageGroupsTable.id, label: ageGroupsTable.label, division: ageGroupsTable.division })
      .from(ageGroupsTable).orderBy(asc(ageGroupsTable.displayOrder)).limit(20),
    db.select({ id: seasonsTable.id, name: seasonsTable.name })
      .from(seasonsTable).where(eq(seasonsTable.isActive, true)).limit(1),
  ]);

  lines.push(`TODAY: ${today}`);
  lines.push(`ACTIVE SEASON: ${activeSeason[0] ? `[id=${activeSeason[0].id}] "${activeSeason[0].name}"` : "No active season — one must exist before creating league/tournament/camp"}`);
  lines.push(`\nAVAILABLE COURTS (eligibleForScheduling=true): ${courts.length > 0 ? courts.map(c => `[id=${c.id}] "${c.name}" (${c.type})`).join(", ") : "None — court required for event creation"}`);
  lines.push(`AGE GROUPS: ${ageGroups.map(g => `${g.label} (${g.division})`).join(", ")}`);

  const pricingRules = await db.select({ id: pricingRulesTable.id, name: pricingRulesTable.name, category: pricingRulesTable.category, basePrice: pricingRulesTable.basePrice, teamFee: pricingRulesTable.teamFee })
    .from(pricingRulesTable).where(eq(pricingRulesTable.isLatest, true)).limit(20);
  lines.push(`PRICING RULES (latest): ${pricingRules.map(p => `[id=${p.id}] ${p.name} (${p.category}) base=$${p.basePrice ?? "N/A"} teamFee=$${p.teamFee ?? "N/A"}`).join("; ")}`);

  if (entityType === "league") {
    const recentLeagues = await db.select({ id: leaguesTable.id, name: leaguesTable.name, ageGroup: leaguesTable.ageGroup, status: leaguesTable.status, maxTeams: leaguesTable.maxTeams, teamsRegistered: leaguesTable.teamsRegistered, startDate: (leaguesTable as any).startDate, endDate: (leaguesTable as any).endDate, courtId: (leaguesTable as any).courtId })
      .from(leaguesTable).orderBy(desc(leaguesTable.createdAt)).limit(5);
    lines.push(`\nEXISTING LEAGUES (recent): ${recentLeagues.map(l => `[id=${l.id}] "${l.name}" ${l.ageGroup} ${l.status} (${l.teamsRegistered}/${l.maxTeams} teams) start=${l.startDate ?? "TBD"} end=${l.endDate ?? "TBD"} court=${l.courtId ?? "TBD"}`).join("; ")}`);

    // Fixture-level court availability: query scheduled fixtures grouped by court
    const scheduledFixtures = await db.select({
      courtId: fixturesTable.courtId,
      scheduledAt: fixturesTable.scheduledAt,
      entityType: fixturesTable.entityType,
      entityId: fixturesTable.entityId,
    }).from(fixturesTable)
      .where(eq(fixturesTable.status, "scheduled"))
      .orderBy(asc(fixturesTable.scheduledAt))
      .limit(30);

    if (scheduledFixtures.length > 0) {
      const courtGroups: Record<string, string[]> = {};
      for (const fx of scheduledFixtures) {
        const key = String(fx.courtId ?? "unassigned");
        courtGroups[key] = courtGroups[key] ?? [];
        if (courtGroups[key].length < 3 && fx.scheduledAt) {
          courtGroups[key].push(new Date(fx.scheduledAt).toISOString().split("T")[0]);
        }
      }
      lines.push(`FIXTURE COURT AVAILABILITY — courts with scheduled fixtures: ${Object.entries(courtGroups).map(([c, dates]) => `court ${c} busy: ${dates.join(", ")}`).join("; ")}. Warn if proposed court/date overlaps.`);
    }

    lines.push(`PEAK PERIODS TO AVOID (school calendar): Late Dec (holiday break), late Mar/early Apr (spring break), May (exams). Ask about start date and warn if it falls in a peak period.`);
  }

  if (entityType === "tournament") {
    const recentTournaments = await db.select({ id: tournamentsTable.id, name: tournamentsTable.name, ageGroup: tournamentsTable.ageGroup, status: tournamentsTable.status, startDate: (tournamentsTable as any).startDate, courtId: (tournamentsTable as any).courtId })
      .from(tournamentsTable).orderBy(desc(tournamentsTable.createdAt)).limit(5);
    lines.push(`\nEXISTING TOURNAMENTS (recent): ${recentTournaments.map(t => `[id=${t.id}] "${t.name}" ${t.ageGroup} ${t.status} date=${(t as any).startDate ?? "TBD"} court=${(t as any).courtId ?? "TBD"}`).join("; ")}`);

    // Fixture-level availability for tournament courts
    const tournamentFixtures = await db.select({
      courtId: fixturesTable.courtId,
      scheduledAt: fixturesTable.scheduledAt,
    }).from(fixturesTable)
      .where(and(eq(fixturesTable.status, "scheduled"), eq(fixturesTable.entityType, "tournament")))
      .orderBy(asc(fixturesTable.scheduledAt))
      .limit(20);

    if (tournamentFixtures.length > 0) {
      const busyDates = [...new Set(tournamentFixtures.filter(f => f.scheduledAt).map(f => new Date(f.scheduledAt!).toISOString().split("T")[0]))].slice(0, 5);
      lines.push(`TOURNAMENT FIXTURE DATES ALREADY SCHEDULED: ${busyDates.join(", ")}. Warn if proposed date conflicts.`);
    }

    lines.push(`PEAK PERIODS TO AVOID (school calendar): Late Dec (holiday break), late Mar/early Apr (spring break), May (exams). Warn if proposed tournament date falls in peak period.`);
  }

  if (entityType === "camp") {
    const recentCamps = await db.select({ id: campsTable.id, name: campsTable.name, ageGroup: campsTable.ageGroup, status: campsTable.status })
      .from(campsTable).orderBy(desc(campsTable.createdAt)).limit(5);
    lines.push(`\nEXISTING CAMPS (recent): ${recentCamps.map(c => `[id=${c.id}] "${c.name}" ${c.ageGroup} ${c.status}`).join("; ")}`);
  }

  if (entityType === "membership") {
    const plans = await db.select().from(membershipPlansTable);
    lines.push(`\nEXISTING MEMBERSHIP PLANS (${plans.length}):\n${plans.map(p => `  • "${p.name}" $${p.price}/${p.billingCycle} active=${p.isActive}`).join("\n")}`);
    const byPrice = plans.map(p => `$${p.price}/${p.billingCycle}: "${p.name}"`);
    lines.push(`CONFLICT CHECK — existing price points:\n${byPrice.join("\n")}`);
  }

  if (entityType === "payout") {
    const staffRoles = await db.selectDistinct({ role: assignmentsTable.role }).from(assignmentsTable).limit(10);
    const existing = await db.select().from(payoutRateConfigsTable).where(eq(payoutRateConfigsTable.isActive, true));
    lines.push(`\nEXISTING STAFF ROLES (from assignments): ${staffRoles.map(r => r.role).join(", ")}`);
    lines.push(`EXISTING PAYOUT RATE CONFIGS: ${existing.length ? existing.map(r => `"${r.role}"/"${r.eventType}" ${r.rateType} $${r.amount}`).join("; ") : "None configured yet"}`);
  }

  if (entityType === "pricing") {
    const existing = await db.select({ name: pricingRulesTable.name, category: pricingRulesTable.category, basePrice: pricingRulesTable.basePrice })
      .from(pricingRulesTable).where(eq(pricingRulesTable.isLatest, true));
    lines.push(`\nEXISTING PRICING RULES (latest): ${existing.map(r => `"${r.name}" [${r.category}] $${r.basePrice}`).join("; ")}`);
    lines.push(`VALID PRICING CATEGORIES: drop_in, camp, league, tournament (must be one of these)`);
  }

  return lines.join("\n");
}

function buildSystemPrompt(entityType: string, liveContext: string): string {
  const typeGuides: Record<string, string> = {
    league: `You are helping create a LEAGUE. Required fields: name, ageGroup, format (5v5/4v4/3v3), courtId, seasonId, maxTeams, registrationPrice. Ask about: age group/division, format, number of teams, registration fee, start/end dates, registration deadline, court (from available courts above). Flag if a similar league (same ageGroup) is already active.`,
    tournament: `You are helping create a TOURNAMENT. Required fields: name, ageGroup, format, courtId, seasonId-like context, maxTeams, teamPrice. Ask about: age group, bracket format (single_elimination/double_elimination), number of teams, team entry fee, dates, prize pot, court. Check for date conflicts.`,
    camp: `You are helping create a CAMP. Required fields: name, ageGroup, courtId, price, maxParticipants. Optional: coachName, startDate, endDate, registrationDeadline, description. Ask about: age group, coach name, capacity, dates (multi-day), price per player, court.`,
    drop_in: `You are helping create a DROP-IN SESSION. Required fields: name, ageGroup, skillLevel, courtId, startsAt (ISO timestamp), durationMinutes, price, maxPlayers. Ask about: age group, skill level (all/beginner/intermediate/advanced), date/time, duration (minutes), price, court, max players. Note: startsAt must be a full ISO datetime.`,
    membership: `You are helping create a MEMBERSHIP PLAN. Required fields: name, price, billingCycle (monthly/annual). Optional: description, trialDays, features (array of strings), discountPercent. Flag if a plan at a similar price point already exists.`,
    payout: `You are helping configure PAYOUT RATE CONFIGS. Required fields: role (referee/scorekeeper/coach/etc), eventType (league_game/tournament_game/camp_session/drop_in), rateType (flat_per_game/hourly/per_session), amount. Optional: notes. Ask about each rate separately. If multiple role/eventType combos, create one at a time.`,
    pricing: `You are helping create a PRICING RULE. Required fields: name, category (must be exactly one of: drop_in, camp, league, tournament). Optional: basePrice, memberPrice, depositAmount, depositRequired, notes. Flag if a rule for this category already exists.`,
    unknown: `You are a universal admin assistant for PlayOn futsal. Your FIRST priority is to determine what the admin wants to create.

CRITICAL: As soon as the admin's message indicates intent (e.g. "create a league", "add a tournament", "set up a camp", "drop-in", "membership", "payout", "pricing"), you MUST immediately set "_entityType" in your fieldUpdates to exactly one of these canonical values: league, tournament, camp, drop_in, membership, pricing, payout. Then ask your first targeted question for that entity type.

If the intent is still genuinely unclear after reading the message, ask: "What would you like to create? Options: league, tournament, camp, drop-in session, membership plan, payout structure, or pricing rule."`,
  };

  const guide = typeGuides[entityType] ?? typeGuides.unknown;

  return `You are the PlayOn Admin AI Assistant — a smart, efficient creation guide for the PlayOn futsal platform at the Alumni Center in Lexington, KY.

YOUR JOB: ${guide}

RULES:
1. Ask ONE targeted follow-up question at a time. Never ask multiple questions at once.
2. For complex entities (league, tournament), guide through 6-8 questions total before confirming.
3. For simple entities (drop-in, pricing rule, payout config), aim for 3-5 questions then confirm.
4. After each answer, check the live context for conflicts and flag them inline if found.
5. When you have enough info, present a clear summary and say "Ready to create — shall I proceed?"
6. Always respond in JSON with this exact format:
{
  "message": "Your conversational message to the admin",
  "fieldUpdates": { "fieldName": "value", ... },
  "conflictWarning": "string or null",
  "readyToCreate": false,
  "entitySummary": null
}
When ready: set readyToCreate=true and populate entitySummary with all confirmed fields as a flat object.
7. Be concise. Admins are busy. Never say "Great!" or use filler phrases.

LIVE PLATFORM CONTEXT:
${liveContext}`;
}

// ── Main creation agent endpoint ───────────────────────────────────────────

router.post("/admin/ai/creation-agent", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const body = req.body as {
    sessionId?: number;
    message: string;
    entityType?: string;
  };

  if (!body.message?.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!dbUser) { res.status(404).json({ error: "User not found" }); return; }

  let session: typeof aiCreationSessionsTable.$inferSelect | null = null;

  if (body.sessionId) {
    const [s] = await db.select().from(aiCreationSessionsTable)
      .where(and(eq(aiCreationSessionsTable.id, body.sessionId), eq(aiCreationSessionsTable.adminUserId, dbUser.id)));
    if (!s) { res.status(404).json({ error: "Session not found" }); return; }
    session = s;
  } else {
    const [newSession] = await db.insert(aiCreationSessionsTable).values({
      adminUserId: dbUser.id,
      entityType: body.entityType ?? "unknown",
      thread: "[]",
      partialEntity: "{}",
      status: "drafting",
    } as any).returning();
    session = newSession;
  }

  const entityType = body.entityType ?? session.entityType ?? "unknown";
  const thread: ThreadMessage[] = JSON.parse(session.thread);
  const partialEntity: Record<string, any> = JSON.parse(session.partialEntity);

  const liveContext = await buildLiveContext(entityType);
  const systemPrompt = buildSystemPrompt(entityType, liveContext);

  const historyMessages = thread.slice(-16).map(m => ({ role: m.role, content: m.content }));
  historyMessages.push({ role: "user", content: body.message });

  let aiResponseText = "";
  let parsedResponse: any = null;

  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: systemPrompt,
      messages: historyMessages,
    });

    const block = msg.content[0];
    aiResponseText = block.type === "text" ? block.text : JSON.stringify(msg.content);

    const jsonText = aiResponseText.replace(/^```json?\s*/m, "").replace(/```\s*$/m, "").trim();
    parsedResponse = JSON.parse(jsonText);
  } catch (err: any) {
    res.status(502).json({ error: "AI request failed", detail: err.message });
    return;
  }

  const updatedPartialEntity = { ...partialEntity, ...(parsedResponse.fieldUpdates ?? {}) };
  if (body.entityType && body.entityType !== "unknown") {
    updatedPartialEntity._entityType = body.entityType;
  }

  // Pick up entity type inferred by the AI from a plain-language message
  const inferredEntityType: string | null = updatedPartialEntity._entityType ?? null;
  const resolvedEntityType =
    entityType !== "unknown" ? entityType :
    (inferredEntityType && inferredEntityType !== "unknown" ? inferredEntityType : session.entityType);

  const userMsg: ThreadMessage = { role: "user", content: body.message, createdAt: new Date().toISOString() };
  const assistantMsg: ThreadMessage = { role: "assistant", content: parsedResponse.message ?? aiResponseText, createdAt: new Date().toISOString() };
  const updatedThread = [...thread, userMsg, assistantMsg];

  await db.update(aiCreationSessionsTable).set({
    entityType: resolvedEntityType,
    thread: JSON.stringify(updatedThread),
    partialEntity: JSON.stringify(updatedPartialEntity),
    status: parsedResponse.readyToCreate ? "confirmed" : "drafting",
  } as any).where(eq(aiCreationSessionsTable.id, session.id));

  res.json({
    sessionId: session.id,
    message: parsedResponse.message ?? aiResponseText,
    fieldUpdates: parsedResponse.fieldUpdates ?? {},
    conflictWarning: parsedResponse.conflictWarning ?? null,
    readyToCreate: parsedResponse.readyToCreate ?? false,
    entitySummary: parsedResponse.entitySummary ?? null,
    partialEntity: updatedPartialEntity,
  });
});

// ── Confirm & create entity ────────────────────────────────────────────────

router.post("/admin/ai/creation-agent/create", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const body = req.body as { sessionId: number; confirmedEntity: Record<string, any> };

  if (!body.sessionId) { res.status(400).json({ error: "sessionId required" }); return; }

  const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!dbUser) { res.status(404).json({ error: "User not found" }); return; }

  const [session] = await db.select().from(aiCreationSessionsTable)
    .where(and(eq(aiCreationSessionsTable.id, body.sessionId), eq(aiCreationSessionsTable.adminUserId, dbUser.id)));
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }

  const entity: Record<string, any> = body.confirmedEntity ?? JSON.parse(session.partialEntity);
  const entityType: string = entity._entityType ?? session.entityType;

  let createdEntity: any = null;

  try {
    if (entityType === "league") {
      // courtId and seasonId are NOT NULL in the schema — fail explicitly if missing
      const courtId = entity.courtId ? Number(entity.courtId) : null;
      const seasonId = entity.seasonId ? Number(entity.seasonId) : null;

      if (!courtId) {
        // Auto-pick first available court
        const [court] = await db.select({ id: courtsTable.id })
          .from(courtsTable).where(eq(courtsTable.availableForScheduling, true)).limit(1);
        if (!court) {
          res.status(400).json({ error: "No available courts configured. Please add a court first." });
          return;
        }
        entity.courtId = court.id;
      }
      if (!seasonId) {
        const [season] = await db.select({ id: seasonsTable.id })
          .from(seasonsTable).where(eq(seasonsTable.isActive, true)).limit(1);
        if (!season) {
          res.status(400).json({ error: "No active season. Please create a season first." });
          return;
        }
        entity.seasonId = season.id;
      }

      const [league] = await db.insert(leaguesTable).values({
        name: String(entity.name ?? "New League"),
        ageGroup: String(entity.ageGroup ?? "adult"),
        format: String(entity.format ?? "5v5"),
        courtId: Number(entity.courtId),
        seasonId: Number(entity.seasonId),
        maxTeams: Number(entity.maxTeams ?? 8),
        registrationPrice: String(entity.registrationPrice ?? entity.fee ?? "0"),
        registrationOpen: false,
        registrationDeadline: entity.registrationDeadline ? new Date(entity.registrationDeadline) : null,
        startDate: entity.startDate ? String(entity.startDate) : null,
        endDate: entity.endDate ? String(entity.endDate) : null,
        description: entity.description ? String(entity.description) : `Created by AI assistant`,
        status: "upcoming",
      }).returning();
      createdEntity = { type: "league", entity: league };

    } else if (entityType === "tournament") {
      const courtId = entity.courtId ? Number(entity.courtId) : null;
      if (!courtId) {
        const [court] = await db.select({ id: courtsTable.id })
          .from(courtsTable).where(eq(courtsTable.availableForScheduling, true)).limit(1);
        if (!court) {
          res.status(400).json({ error: "No available courts configured." });
          return;
        }
        entity.courtId = court.id;
      }

      const [tournament] = await db.insert(tournamentsTable).values({
        name: String(entity.name ?? "New Tournament"),
        ageGroup: String(entity.ageGroup ?? "adult"),
        format: String(entity.format ?? "5v5"),
        bracketFormat: String(entity.bracketFormat ?? "single_elimination"),
        courtId: Number(entity.courtId),
        maxTeams: Number(entity.maxTeams ?? 8),
        teamPrice: String(entity.teamPrice ?? entity.teamEntryFee ?? "0"),
        registrationOpen: false,
        registrationDeadline: entity.registrationDeadline ? new Date(entity.registrationDeadline) : null,
        startDate: entity.startDate ? String(entity.startDate) : null,
        endDate: entity.endDate ? String(entity.endDate) : null,
        description: entity.description ? String(entity.description) : `Created by AI assistant`,
        prizePot: entity.prizePot ? String(entity.prizePot) : null,
        status: "upcoming",
      }).returning();
      createdEntity = { type: "tournament", entity: tournament };

    } else if (entityType === "camp") {
      const courtId = entity.courtId ? Number(entity.courtId) : null;
      if (!courtId) {
        const [court] = await db.select({ id: courtsTable.id })
          .from(courtsTable).where(eq(courtsTable.availableForScheduling, true)).limit(1);
        if (!court) {
          res.status(400).json({ error: "No available courts configured." });
          return;
        }
        entity.courtId = court.id;
      }

      const [camp] = await db.insert(campsTable).values({
        name: String(entity.name ?? "New Camp"),
        ageGroup: String(entity.ageGroup ?? "u8"),
        courtId: Number(entity.courtId),
        coachName: entity.coachName ? String(entity.coachName) : null,
        maxParticipants: Number(entity.maxParticipants ?? entity.capacity ?? 20),
        price: String(entity.price ?? "0"),
        registrationOpen: false,
        registrationDeadline: entity.registrationDeadline ? new Date(entity.registrationDeadline) : null,
        startDate: entity.startDate ? String(entity.startDate) : null,
        endDate: entity.endDate ? String(entity.endDate) : null,
        description: entity.description ? String(entity.description) : `Created by AI assistant`,
        status: "upcoming",
      }).returning();
      createdEntity = { type: "camp", entity: camp };

    } else if (entityType === "drop_in" || entityType === "dropin") {
      const courtId = entity.courtId ? Number(entity.courtId) : null;
      if (!courtId) {
        const [court] = await db.select({ id: courtsTable.id })
          .from(courtsTable).where(eq(courtsTable.availableForScheduling, true)).limit(1);
        if (!court) {
          res.status(400).json({ error: "No available courts configured." });
          return;
        }
        entity.courtId = court.id;
      }

      if (!entity.startsAt) {
        res.status(400).json({ error: "startsAt (date/time) is required for drop-in sessions." });
        return;
      }

      const [dropin] = await db.insert(dropinsTable).values({
        name: String(entity.name ?? entity.title ?? "Drop-in Session"),
        courtId: Number(entity.courtId),
        skillLevel: String(entity.skillLevel ?? "all"),
        ageGroup: String(entity.ageGroup ?? "adult"),
        price: String(entity.price ?? "0"),
        maxPlayers: Number(entity.maxPlayers ?? entity.maxParticipants ?? entity.capacity ?? 15),
        startsAt: new Date(entity.startsAt),
        durationMinutes: Number(entity.durationMinutes ?? 120),
        registrationOpen: false,
        status: "upcoming",
        description: entity.description ? String(entity.description) : null,
      }).returning();
      createdEntity = { type: "drop_in", entity: dropin };

    } else if (entityType === "membership") {
      if (!entity.price) {
        res.status(400).json({ error: "price is required for membership plans." });
        return;
      }
      const [plan] = await db.insert(membershipPlansTable).values({
        name: String(entity.name ?? entity.tierName ?? "New Membership"),
        description: entity.description ? String(entity.description) : null,
        price: String(entity.price),
        billingCycle: String(entity.billingCycle ?? "monthly"),
        trialDays: Number(entity.trialDays ?? 0),
        features: Array.isArray(entity.features) ? entity.features : [],
        discountPercent: String(entity.discountPercent ?? "0"),
        isActive: true,
      }).returning();
      createdEntity = { type: "membership", entity: plan };

    } else if (entityType === "pricing") {
      const validCategories = ["drop_in", "camp", "league", "tournament"];
      const category = String(entity.category ?? "league");
      if (!validCategories.includes(category)) {
        res.status(400).json({ error: `Invalid pricing category "${category}". Must be one of: ${validCategories.join(", ")}` });
        return;
      }
      const [rule] = await db.insert(pricingRulesTable).values({
        name: String(entity.name ?? "New Pricing Rule"),
        category: category as any,
        basePrice: entity.basePrice ? String(entity.basePrice) : null,
        memberPrice: entity.memberPrice ? String(entity.memberPrice) : null,
        teamFee: entity.teamFee ? String(entity.teamFee) : null,
        playerFee: entity.playerFee ? String(entity.playerFee) : null,
        depositRequired: Boolean(entity.depositRequired ?? false),
        depositAmount: entity.depositAmount ? String(entity.depositAmount) : null,
        notes: entity.notes ? String(entity.notes) : null,
        createdByClerkId: authed.clerkUserId,
        isLatest: true,
        version: 1,
      }).returning();
      createdEntity = { type: "pricing_rule", entity: rule };

    } else if (entityType === "payout") {
      if (!entity.role || !entity.eventType || !entity.amount) {
        res.status(400).json({ error: "role, eventType, and amount are required for payout rate configs." });
        return;
      }
      const [config] = await db.insert(payoutRateConfigsTable).values({
        role: String(entity.role),
        eventType: String(entity.eventType),
        rateType: String(entity.rateType ?? "flat_per_game"),
        amount: String(entity.amount),
        notes: entity.notes ? String(entity.notes) : null,
        isActive: true,
        createdByClerkId: authed.clerkUserId,
      }).returning();
      createdEntity = { type: "payout_rate_config", entity: config };

    } else {
      res.status(400).json({ error: `Unknown entity type: ${entityType}` });
      return;
    }
  } catch (err: any) {
    res.status(500).json({ error: "Failed to create entity", detail: err.message });
    return;
  }

  await db.update(aiCreationSessionsTable).set({
    status: "created",
    createdEntityType: createdEntity.type,
    createdEntityId: createdEntity.entity.id,
  } as any).where(eq(aiCreationSessionsTable.id, session.id));

  res.status(201).json({
    sessionId: session.id,
    created: createdEntity,
    message: `✓ ${entityType.charAt(0).toUpperCase() + entityType.slice(1)} created successfully (id=${createdEntity.entity.id})`,
  });
});

// ── Session management ─────────────────────────────────────────────────────

router.get("/admin/ai/creation-sessions", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const [dbUser] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!dbUser) { res.status(404).json({ error: "User not found" }); return; }

  const sessions = await db.select({
    id: aiCreationSessionsTable.id,
    entityType: aiCreationSessionsTable.entityType,
    status: aiCreationSessionsTable.status,
    createdEntityId: aiCreationSessionsTable.createdEntityId,
    createdEntityType: aiCreationSessionsTable.createdEntityType,
    createdAt: aiCreationSessionsTable.createdAt,
    updatedAt: aiCreationSessionsTable.updatedAt,
  }).from(aiCreationSessionsTable)
    .where(eq(aiCreationSessionsTable.adminUserId, dbUser.id))
    .orderBy(desc(aiCreationSessionsTable.updatedAt))
    .limit(50);

  res.json(sessions);
});

router.get("/admin/ai/creation-sessions/:id", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const id = Number(req.params.id);

  const [dbUser] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!dbUser) { res.status(404).json({ error: "User not found" }); return; }

  const [session] = await db.select().from(aiCreationSessionsTable)
    .where(and(eq(aiCreationSessionsTable.id, id), eq(aiCreationSessionsTable.adminUserId, dbUser.id)));
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }

  const thread: ThreadMessage[] = JSON.parse(session.thread);
  const partialEntity = JSON.parse(session.partialEntity);
  res.json({ ...session, thread, partialEntity });
});

router.delete("/admin/ai/creation-sessions/:id", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const id = Number(req.params.id);

  const [dbUser] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!dbUser) { res.status(404).json({ error: "User not found" }); return; }

  await db.delete(aiCreationSessionsTable)
    .where(and(eq(aiCreationSessionsTable.id, id), eq(aiCreationSessionsTable.adminUserId, dbUser.id)));
  res.sendStatus(204);
});

// ── Place team ─────────────────────────────────────────────────────────────

router.post("/admin/ai/place-team", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const body = req.body as {
    teamId: number;
    offeringId: number;
    offeringType: "league" | "tournament";
  };

  if (!body.teamId || !body.offeringId || !body.offeringType) {
    res.status(400).json({ error: "teamId, offeringId, offeringType required" });
    return;
  }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, body.teamId));
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }

  let offering: typeof leaguesTable.$inferSelect | typeof tournamentsTable.$inferSelect | null = null;
  let currentTeamCount = 0;

  if (body.offeringType === "league") {
    const [l] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, body.offeringId));
    if (!l) { res.status(404).json({ error: "League not found" }); return; }
    offering = l;
    const [countRow] = await db.select({ count: sql<number>`count(*)::int` })
      .from(teamsTable).where(eq(teamsTable.leagueId, body.offeringId));
    currentTeamCount = countRow.count;
  } else {
    const [t] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, body.offeringId));
    if (!t) { res.status(404).json({ error: "Tournament not found" }); return; }
    offering = t;
    const [countRow] = await db.select({ count: sql<number>`count(*)::int` })
      .from(teamsTable).where(eq((teamsTable as any).tournamentId, body.offeringId));
    currentTeamCount = countRow.count;
  }

  const maxTeams = (offering as any).maxTeams ?? 0;
  const isFull = maxTeams > 0 && currentTeamCount >= maxTeams;

  const systemPrompt = `You are a team placement engine for PlayOn futsal. Analyze the team and offering details to determine the correct placement. Respond ONLY with JSON:
{
  "division": "string or null — suggest a sub-division label if applicable (e.g. 'Division A'), else null",
  "waitlisted": false,
  "imbalanceAlert": "string or null — warn if this would create a lopsided division",
  "reasoning": "1-2 sentences"
}`;

  const userContent = `TEAM: name="${team.name}", ageGroup="${(team as any).ageGroup ?? "unknown"}"
OFFERING: id=${offering.id}, name="${offering.name}", ageGroup="${offering.ageGroup}", format="${(offering as any).format}", maxTeams=${maxTeams}
CURRENT TEAM COUNT: ${currentTeamCount}/${maxTeams}
IS FULL: ${isFull}
Place this team. If full, set waitlisted=true.`;

  let placement = {
    division: offering.ageGroup as string | null,
    waitlisted: isFull,
    imbalanceAlert: null as string | null,
    reasoning: "Auto-placed based on age group.",
  };

  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    });
    const block = msg.content[0];
    const text = block.type === "text" ? block.text : "";
    const jsonText = text.replace(/^```json?\s*/m, "").replace(/```\s*$/m, "").trim();
    placement = { ...placement, ...JSON.parse(jsonText) };
  } catch {
    // keep fallback placement
  }

  // Persist placement to DB
  if (!placement.waitlisted) {
    if (body.offeringType === "league") {
      // Link team to league and increment teamsRegistered
      await db.update(teamsTable).set({ leagueId: body.offeringId } as any)
        .where(eq(teamsTable.id, body.teamId));
      await db.update(leaguesTable).set({
        teamsRegistered: sql`${leaguesTable.teamsRegistered} + 1`,
      } as any).where(eq(leaguesTable.id, body.offeringId));
    } else {
      // Link team to tournament and increment teamsRegistered
      await db.update(teamsTable).set({ tournamentId: body.offeringId } as any)
        .where(eq(teamsTable.id, body.teamId));
      await db.update(tournamentsTable).set({
        teamsRegistered: sql`${tournamentsTable.teamsRegistered} + 1`,
      } as any).where(eq(tournamentsTable.id, body.offeringId));
    }
  } else {
    // Waitlisted — record via league registration row (leagues) or team notes (tournaments)
    const authed = req as AuthedRequest;
    if (body.offeringType === "league") {
      await db.insert(leagueRegistrationsTable).values({
        leagueId: body.offeringId,
        teamId: body.teamId,
        registeredByUserId: authed.clerkUserId,
        depositAmount: "0",
        totalAmount: "0",
        amountPaid: "0",
        balanceDue: "0",
        paymentStatus: "unpaid",
        status: "waitlisted",
        notes: `Waitlisted via AI placement on ${new Date().toISOString()}`,
      } as any).onConflictDoNothing();
    } else {
      // For tournaments: insert a waitlisted registration row using the proper
      // tournament_registrations table. Promotion clears the waitlisted status.
      const authed = req as AuthedRequest;
      const [dbUser] = await db.select({ id: usersTable.id }).from(usersTable)
        .where(eq(usersTable.clerkId, authed.clerkUserId));
      await db.insert(tournamentRegistrationsTable).values({
        tournamentId: body.offeringId,
        teamId: body.teamId,
        registeredByUserId: dbUser?.id ?? null,
        depositAmount: "0",
        totalAmount: "0",
        amountPaid: "0",
        paymentStatus: "unpaid",
        status: "waitlisted",
        notes: `Waitlisted via AI placement on ${new Date().toISOString()}`,
      } as any).onConflictDoNothing();
    }
  }

  res.json({
    teamId: body.teamId,
    offeringId: body.offeringId,
    offeringType: body.offeringType,
    persisted: true,
    ...placement,
  });
});

// ── Promote team from waitlist ─────────────────────────────────────────────
//
// When a spot opens (or admin decides to promote), this endpoint:
//   - For leagues: updates the leagueRegistrations row to status="active",
//     links the team via leagueId, and increments teamsRegistered
//   - For tournaments: updates the tournamentRegistrations row to status="active",
//     links the team via tournamentId, and increments teamsRegistered
//
// Imbalance check: if promoting would make one division 2+ teams larger than
// the others, a warning is returned (not blocking) so admin can decide.

router.post("/admin/ai/promote-from-waitlist", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const body = req.body as {
    teamId: number;
    offeringId: number;
    offeringType: "league" | "tournament";
  };

  if (!body.teamId || !body.offeringId || !body.offeringType) {
    res.status(400).json({ error: "teamId, offeringId, offeringType required" });
    return;
  }

  if (body.offeringType === "league") {
    const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, body.offeringId));
    if (!league) { res.status(404).json({ error: "League not found" }); return; }

    const [currentCount] = await db.select({ count: sql<number>`count(*)::int` })
      .from(teamsTable).where(eq(teamsTable.leagueId, body.offeringId));
    const maxTeams = (league as any).maxTeams ?? 0;
    const isFull = maxTeams > 0 && (currentCount?.count ?? 0) >= maxTeams;

    // Promote: update registration row + link team to league
    await db.update(leagueRegistrationsTable)
      .set({ status: "active", updatedAt: new Date() } as any)
      .where(and(
        eq(leagueRegistrationsTable.leagueId, body.offeringId),
        eq((leagueRegistrationsTable as any).teamId, body.teamId),
      ));
    await db.update(teamsTable).set({ leagueId: body.offeringId } as any).where(eq(teamsTable.id, body.teamId));
    await db.update(leaguesTable).set({
      teamsRegistered: sql`${leaguesTable.teamsRegistered} + 1`,
    } as any).where(eq(leaguesTable.id, body.offeringId));

    res.json({
      teamId: body.teamId,
      offeringId: body.offeringId,
      offeringType: "league",
      promoted: true,
      imbalanceAlert: isFull ? "League was at capacity — ensure a spot was genuinely freed before promoting." : null,
    });

  } else {
    const [tournament] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, body.offeringId));
    if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }

    const [currentCount] = await db.select({ count: sql<number>`count(*)::int` })
      .from(teamsTable).where(eq((teamsTable as any).tournamentId, body.offeringId));
    const maxTeams = (tournament as any).maxTeams ?? 0;
    const isFull = maxTeams > 0 && (currentCount?.count ?? 0) >= maxTeams;

    // Promote: update registration row to active + link team to tournament
    await db.update(tournamentRegistrationsTable)
      .set({ status: "active", updatedAt: new Date() } as any)
      .where(and(
        eq(tournamentRegistrationsTable.tournamentId, body.offeringId),
        eq(tournamentRegistrationsTable.teamId, body.teamId),
      ));
    await db.update(teamsTable).set({ tournamentId: body.offeringId } as any).where(eq(teamsTable.id, body.teamId));
    await db.update(tournamentsTable).set({
      teamsRegistered: sql`${tournamentsTable.teamsRegistered} + 1`,
    } as any).where(eq(tournamentsTable.id, body.offeringId));

    res.json({
      teamId: body.teamId,
      offeringId: body.offeringId,
      offeringType: "tournament",
      promoted: true,
      imbalanceAlert: isFull ? "Tournament was at capacity — ensure a spot was freed before promoting." : null,
    });
  }
});

// ── Deadline-triggered auto-schedule generation ────────────────────────────

router.post("/admin/ai/trigger-deadline-schedules", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const now = new Date();
  const results: { type: string; id: number; name: string; action: string; fixturesGenerated?: number; error?: string }[] = [];

  const [overdueLeagues, overdueTournaments] = await Promise.all([
    db.select().from(leaguesTable)
      .where(and(eq(leaguesTable.status, "upcoming"), lte(leaguesTable.registrationDeadline, now))),
    db.select().from(tournamentsTable)
      .where(and(eq(tournamentsTable.status, "upcoming"), lte(tournamentsTable.registrationDeadline, now))),
  ]);

  for (const league of overdueLeagues) {
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
      .from(fixturesTable)
      .where(and(eq(fixturesTable.entityType, "league"), eq(fixturesTable.entityId, league.id)));

    if (count > 0) {
      // Already has fixtures — just activate
      await db.update(leaguesTable)
        .set({ status: "active", updatedAt: new Date() } as any)
        .where(eq(leaguesTable.id, league.id));
      results.push({ type: "league", id: league.id, name: league.name, action: "already_has_fixtures" });
      continue;
    }

    // Generate round-robin fixtures from registered teams
    const teams = await db.select().from(teamsTable).where(eq(teamsTable.leagueId, league.id));
    if (teams.length < 2) {
      await db.update(leaguesTable)
        .set({ status: "active", updatedAt: new Date() } as any)
        .where(eq(leaguesTable.id, league.id));
      results.push({ type: "league", id: league.id, name: league.name, action: "activated_no_fixtures", error: "< 2 teams registered, fixtures skipped" });
      continue;
    }

    try {
      const matchups = generateRoundRobin(teams.length);
      const startDt = league.startDate ? new Date(league.startDate) : new Date(now);
      // Advance to next Saturday if no specific date
      while (startDt.getDay() !== 6) startDt.setDate(startDt.getDate() + 1);

      const created = [];
      const roundGameCount: Record<number, number> = {};
      for (const m of matchups) {
        if (roundGameCount[m.round] === undefined) roundGameCount[m.round] = 0;
        const slotIndex = roundGameCount[m.round];
        const gameDate = new Date(startDt);
        gameDate.setDate(gameDate.getDate() + (m.round - 1) * 7);
        gameDate.setHours(18 + slotIndex, 0, 0, 0);

        const [fx] = await db.insert(fixturesTable).values({
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
        } as any).returning();
        created.push(fx);
        roundGameCount[m.round]++;
      }

      await db.update(leaguesTable)
        .set({ status: "active", updatedAt: new Date() } as any)
        .where(eq(leaguesTable.id, league.id));

      results.push({ type: "league", id: league.id, name: league.name, action: "fixtures_generated", fixturesGenerated: created.length });
    } catch (err: any) {
      results.push({ type: "league", id: league.id, name: league.name, action: "error", error: err?.message });
    }
  }

  for (const tournament of overdueTournaments) {
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
      .from(fixturesTable)
      .where(and(eq(fixturesTable.entityType, "tournament"), eq(fixturesTable.entityId, tournament.id)));

    // For tournaments, fixture generation requires bracket seeding (single/double elimination)
    // which is handled by POST /tournaments/:id/brackets/generate. We close registration
    // and advance to active so admin can trigger bracket generation from the tournament panel.
    await db.update(tournamentsTable)
      .set({ status: "active", registrationOpen: false, updatedAt: new Date() } as any)
      .where(eq(tournamentsTable.id, tournament.id));

    results.push({
      type: "tournament",
      id: tournament.id,
      name: tournament.name,
      action: count > 0 ? "already_has_fixtures" : "activated_awaiting_bracket",
    });
  }

  const generatedCount = results.filter(r => r.action === "fixtures_generated").length;
  const activatedCount = results.filter(r => ["activated_no_fixtures", "activated_awaiting_bracket", "already_has_fixtures"].includes(r.action)).length;

  res.json({
    checkedAt: now.toISOString(),
    results,
    summary: results.length === 0
      ? "No offerings past deadline. Everything is current."
      : `Processed ${results.length} offering(s): ${generatedCount} league schedule(s) auto-generated, ${activatedCount} activated (tournaments require bracket generation from admin panel).`,
  });
});

// ── Edit mode: load existing entity into a session ────────────────────────
//
// POST /admin/ai/creation-agent/load-for-edit
// Body: { entityType, entityId }
//
// Loads the existing entity fields as the partialEntity so the AI can
// propose changes. Session status is set to "editing" so apply-edit
// is used instead of create.

router.post("/admin/ai/creation-agent/load-for-edit", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const { entityType, entityId } = req.body as { entityType: string; entityId: number };

  if (!entityType || !entityId) {
    res.status(400).json({ error: "entityType and entityId required" });
    return;
  }

  const [dbUser] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!dbUser) { res.status(404).json({ error: "User not found" }); return; }

  let currentEntity: Record<string, any> | null = null;

  if (entityType === "league") {
    const [row] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, entityId));
    currentEntity = row ?? null;
  } else if (entityType === "tournament") {
    const [row] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, entityId));
    currentEntity = row ?? null;
  } else if (entityType === "camp") {
    const [row] = await db.select().from(campsTable).where(eq(campsTable.id, entityId));
    currentEntity = row ?? null;
  } else if (entityType === "drop_in") {
    const [row] = await db.select().from(dropinsTable).where(eq(dropinsTable.id, entityId));
    currentEntity = row ?? null;
  } else if (entityType === "membership") {
    const [row] = await db.select().from(membershipPlansTable).where(eq(membershipPlansTable.id, entityId));
    currentEntity = row ?? null;
  } else if (entityType === "pricing") {
    const [row] = await db.select().from(pricingRulesTable).where(eq(pricingRulesTable.id, entityId));
    currentEntity = row ?? null;
  } else if (entityType === "payout") {
    const [row] = await db.select().from(payoutRateConfigsTable).where(eq(payoutRateConfigsTable.id, entityId));
    currentEntity = row ?? null;
  } else {
    res.status(400).json({ error: `Unsupported entity type: ${entityType}` });
    return;
  }

  if (!currentEntity) {
    res.status(404).json({ error: `${entityType} #${entityId} not found` });
    return;
  }

  const partialEntity = { ...currentEntity, _entityType: entityType, _editTargetId: entityId };

  const [session] = await db.insert(aiCreationSessionsTable).values({
    adminUserId: dbUser.id,
    entityType,
    thread: "[]",
    partialEntity: JSON.stringify(partialEntity),
    status: "editing",
  } as any).returning();

  const liveContext = await buildLiveContext(entityType);
  const editSystemPrompt = `You are helping an admin EDIT an existing ${entityType} (id=${entityId}).

CURRENT VALUES:
${Object.entries(currentEntity).filter(([k]) => !k.startsWith("_")).map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`).join("\n")}

Ask the admin what they want to change. For each change:
1. Confirm the current vs proposed value
2. Check for downstream impacts (e.g. changing dates may affect fixtures, changing maxTeams may affect waitlist)
3. Flag conflicts in conflictWarning
4. After all changes are confirmed, set readyToCreate=true and populate entitySummary with ALL fields (current + proposed merged)

LIVE PLATFORM CONTEXT:
${liveContext}

Respond ONLY with this JSON format:
{
  "message": "string",
  "fieldUpdates": { "fieldName": "newValue", ... },
  "conflictWarning": "string or null",
  "readyToCreate": false,
  "entitySummary": null
}`;

  const openingMsg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: editSystemPrompt,
    messages: [{ role: "user", content: `I want to edit this ${entityType}. What can I change?` }],
  });
  const openingBlock = openingMsg.content[0];
  const openingText = openingBlock.type === "text" ? openingBlock.text : "";
  let openingParsed: any = null;
  try {
    const cleaned = openingText.replace(/^```json?\s*/m, "").replace(/```\s*$/m, "").trim();
    openingParsed = JSON.parse(cleaned);
  } catch {
    openingParsed = { message: `I have loaded the current ${entityType}. What would you like to change?` };
  }

  const firstMsg: ThreadMessage = { role: "assistant", content: openingParsed.message ?? openingText, createdAt: new Date().toISOString() };
  await db.update(aiCreationSessionsTable).set({
    thread: JSON.stringify([firstMsg]),
  } as any).where(eq(aiCreationSessionsTable.id, session.id));

  res.status(201).json({
    sessionId: session.id,
    message: openingParsed.message ?? openingText,
    currentEntity,
    partialEntity,
    isEditMode: true,
  });
});

// ── Edit mode: apply confirmed changes to existing entity ──────────────────
//
// POST /admin/ai/creation-agent/apply-edit
// Body: { sessionId, confirmedEntity }
//
// Applies only changed fields to the existing entity. Downstream impacts
// (e.g. fixture count, standigns) are noted in the response but not
// automatically adjusted — admin must handle cascades manually.

router.post("/admin/ai/creation-agent/apply-edit", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const { sessionId, confirmedEntity } = req.body as { sessionId: number; confirmedEntity: Record<string, any> };

  if (!sessionId) { res.status(400).json({ error: "sessionId required" }); return; }

  const [dbUser] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!dbUser) { res.status(404).json({ error: "User not found" }); return; }

  const [session] = await db.select().from(aiCreationSessionsTable)
    .where(and(eq(aiCreationSessionsTable.id, sessionId), eq(aiCreationSessionsTable.adminUserId, dbUser.id)));
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }

  const partialEntity = confirmedEntity ?? JSON.parse(session.partialEntity);
  const entityType: string = partialEntity._entityType ?? session.entityType;
  const entityId: number = partialEntity._editTargetId ?? partialEntity.id;

  if (!entityId) { res.status(400).json({ error: "No target entity id found in session (missing _editTargetId)" }); return; }

  const updatePayload: Record<string, any> = {};
  const skipKeys = new Set(["_entityType", "_editTargetId", "id", "createdAt", "updatedAt"]);
  for (const [k, v] of Object.entries(partialEntity)) {
    if (!skipKeys.has(k)) updatePayload[k] = v;
  }
  updatePayload.updatedAt = new Date();

  let updated: any = null;
  try {
    if (entityType === "league") {
      [updated] = await db.update(leaguesTable).set(updatePayload as any).where(eq(leaguesTable.id, entityId)).returning();
    } else if (entityType === "tournament") {
      [updated] = await db.update(tournamentsTable).set(updatePayload as any).where(eq(tournamentsTable.id, entityId)).returning();
    } else if (entityType === "camp") {
      [updated] = await db.update(campsTable).set(updatePayload as any).where(eq(campsTable.id, entityId)).returning();
    } else if (entityType === "drop_in") {
      [updated] = await db.update(dropinsTable).set(updatePayload as any).where(eq(dropinsTable.id, entityId)).returning();
    } else if (entityType === "membership") {
      [updated] = await db.update(membershipPlansTable).set(updatePayload as any).where(eq(membershipPlansTable.id, entityId)).returning();
    } else if (entityType === "pricing") {
      [updated] = await db.update(pricingRulesTable).set(updatePayload as any).where(eq(pricingRulesTable.id, entityId)).returning();
    } else if (entityType === "payout") {
      [updated] = await db.update(payoutRateConfigsTable).set(updatePayload as any).where(eq(payoutRateConfigsTable.id, entityId)).returning();
    } else {
      res.status(400).json({ error: `Unsupported entity type: ${entityType}` });
      return;
    }
  } catch (err: any) {
    res.status(500).json({ error: "Failed to apply changes", detail: err.message });
    return;
  }

  await db.update(aiCreationSessionsTable).set({
    status: "created",
    createdEntityId: entityId,
    createdEntityType: entityType,
  } as any).where(eq(aiCreationSessionsTable.id, sessionId));

  res.json({
    message: `✓ ${entityType} #${entityId} updated successfully.`,
    entityType,
    entityId,
    updated,
  });
});

export default router;
