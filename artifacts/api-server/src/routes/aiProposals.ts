/**
 * AI Proposals — Stage 2: Schedule Proposal Engine
 *
 * POST /admin/ai/proposals/generate      — AI generates ScheduleProposal for a locked offering
 * GET  /admin/ai/proposals               — list proposals (query: status, entityType, entityId)
 * GET  /admin/ai/proposals/:id           — get a single proposal (full proposalData)
 * PATCH /admin/ai/proposals/:id/fixture  — admin edits a single fixture in the proposal
 * POST /admin/ai/proposals/:id/reoptimize — natural-language re-optimization request
 * POST /admin/ai/proposals/:id/approve   — admin approves → publishes fixtures to DB
 * POST /admin/ai/proposals/:id/reject    — admin rejects the proposal
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  scheduleProposalsTable, fixturesTable, courtsTable, ageGroupsTable,
  aiCalendarDatesTable, aiCalendarSourcesTable, pricingRulesTable, usersTable,
  leaguesTable, campsTable, tournamentsTable, teamsTable, eventSuggestionsTable,
  dropinsTable,
} from "@workspace/db";
import { eq, and, desc, asc, inArray, ne, gte, lte } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { requireSuperAdmin, type AuthedRequest } from "../middlewares/auth";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import type { Request } from "express";

const router = Router();

// ── Interfaces ────────────────────────────────────────────────────────────────

interface ProposedFixture {
  id?: string;
  homeTeamId: number | null;
  awayTeamId: number | null;
  courtId: number | null;
  scheduledAt: string;
  durationMinutes: number;
  round: number | null;
  phase: string | null;
  notes: string | null;
}

interface ProposalData {
  fixtures: ProposedFixture[];
  summary: string;
  rulesApplied: string[];
  conflicts: string[];
}

// ── Context builder ───────────────────────────────────────────────────────────

async function buildProposalContext(entityType: string, entityId: number) {
  const [courts, ageGroups, confirmedDates] = await Promise.all([
    db.select().from(courtsTable).where(eq(courtsTable.availableForScheduling, true)),
    db.select().from(ageGroupsTable).orderBy(asc(ageGroupsTable.displayOrder)),
    db.select().from(aiCalendarDatesTable)
      .where(eq(aiCalendarDatesTable.isConfirmed, true))
      .orderBy(asc(aiCalendarDatesTable.date)),
  ]);

  let offering: any = null;
  let teams: any[] = [];

  if (entityType === "league") {
    const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, entityId));
    offering = league;
    if (league) {
      teams = await db.select().from(teamsTable).where(eq(teamsTable.leagueId as any, entityId));
    }
  } else if (entityType === "camp") {
    const [camp] = await db.select().from(campsTable).where(eq(campsTable.id, entityId));
    offering = camp;
  } else if (entityType === "tournament") {
    const [tournament] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, entityId));
    offering = tournament;
    if (tournament) {
      teams = await db.select().from(teamsTable).where(eq(teamsTable.tournamentId as any, entityId));
    }
  } else if (entityType === "drop_in") {
    // Drop-ins are individual sessions (no teams). The offering contains court, time, and age group.
    const [dropin] = await db.select().from(dropinsTable).where(eq(dropinsTable.id, entityId));
    offering = dropin;
    // Drop-ins generate session-type fixtures (no teams, uses offering's courtId + startsAt as base)
  }

  // Existing fixtures for this offering (for conflict checking)
  const existingFixtures = await db.select().from(fixturesTable)
    .where(and(eq(fixturesTable.entityType, entityType), eq(fixturesTable.entityId, entityId)));

  const schoolHolidays = confirmedDates.filter(d => d.dateType === "school_holiday" || d.dateType === "break");
  const blackouts = confirmedDates.filter(d => d.dateType === "blackout");
  const alignmentHints = confirmedDates.filter(d => d.dateType === "alignment_hint");

  return { courts, ageGroups, offering, teams, existingFixtures, schoolHolidays, blackouts, alignmentHints };
}

function detectConflicts(fixtures: ProposedFixture[]): string[] {
  const conflicts: string[] = [];
  for (let i = 0; i < fixtures.length; i++) {
    for (let j = i + 1; j < fixtures.length; j++) {
      const a = fixtures[i];
      const b = fixtures[j];
      if (a.courtId && a.courtId === b.courtId && a.scheduledAt === b.scheduledAt) {
        conflicts.push(
          `Court ${a.courtId} double-booked at ${a.scheduledAt} (fixtures ${i} and ${j})`
        );
      }
    }
  }
  return conflicts;
}

// ── Generate proposal ─────────────────────────────────────────────────────────

router.post("/admin/ai/proposals/generate", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const body = req.body as {
    entityType: string;
    entityId: number;
    reoptimizeRequest?: string;
  };

  if (!body.entityType || !body.entityId) {
    res.status(400).json({ error: "entityType and entityId are required" });
    return;
  }

  // ── Stage 2 gate: require a locked EventSuggestion for this offering ──────
  // Admins must complete Stage 1 (accept + lock a suggestion) before Stage 2
  // can generate a schedule proposal for any offering.
  const [lockedSuggestion] = await db.select({ id: eventSuggestionsTable.id })
    .from(eventSuggestionsTable)
    .where(and(
      eq(eventSuggestionsTable.status, "locked"),
      eq(eventSuggestionsTable.lockedOfferingType, body.entityType),
      eq(eventSuggestionsTable.lockedOfferingId, body.entityId),
    ))
    .limit(1);

  if (!lockedSuggestion) {
    res.status(409).json({
      error: "Stage 2 requires a locked Stage 1 suggestion",
      detail: `No EventSuggestion with status='locked' exists for ${body.entityType} #${body.entityId}. ` +
        "Complete Stage 1 first: accept a suggestion and lock it to this offering.",
    });
    return;
  }

  const ctx = await buildProposalContext(body.entityType, body.entityId);

  if (!ctx.offering) {
    res.status(404).json({ error: `No ${body.entityType} found with id ${body.entityId}` });
    return;
  }

  const systemPrompt = `You are an expert futsal scheduling assistant for PlayOn at the Alumni Center in Lexington, KY.

Generate a complete, detailed fixture schedule for the offering provided. Follow these rules strictly:

1. YOUTH-FIRST: For youth offerings, prioritize times when school is out. School holidays/breaks = youth available.
2. COURT ASSIGNMENT: Full court (type=full) for 5v5; small court (type=small_sided) for 4v4/3v3. Use admin's preferred court if specified.
3. FRIDAY DROP-IN BANDS: Youth 8-11 → small court 5:30-7:30pm; Youth 12-15 → full court 5:30-7:30pm; Adults → both courts 7:30-9:30pm.
4. NO CONFLICTS: Never assign two fixtures to the same court at the same time.
5. BALANCED SCHEDULE: Home/away balance for leagues; round-robin before playoffs.
6. DURATION: League/tournament fixtures typically 60-90 min. Camp sessions as configured.
7. CONFIRMED DATES ONLY: Only schedule on dates in the confirmed calendar data provided.

Respond ONLY with valid JSON — no markdown, no extra text:
{
  "fixtures": [
    {
      "id": "f1",
      "homeTeamId": number or null,
      "awayTeamId": number or null,
      "courtId": number,
      "scheduledAt": "ISO 8601 datetime with offset e.g. 2026-09-05T17:30:00-04:00",
      "durationMinutes": number,
      "round": number or null,
      "phase": "group|playoff|final|session|null",
      "notes": "string or null"
    }
  ],
  "summary": "string — overall scheduling logic and rationale",
  "rulesApplied": ["string", ...],
  "conflicts": []
}`;

  const userContent = `Generate a fixture schedule for this offering:

TYPE: ${body.entityType}
OFFERING: ${JSON.stringify(ctx.offering, null, 2)}
TEAMS (${ctx.teams.length}): ${ctx.teams.map(t => `[id=${t.id} name="${t.name}"]`).join(", ")}

AVAILABLE COURTS:
${ctx.courts.map(c => `- Court ${c.id} "${c.name}" type=${c.type} capacity=${c.maxPlayers}`).join("\n")}

AGE GROUPS: ${ctx.ageGroups.map(g => g.label).join(", ")}

CONFIRMED SCHOOL HOLIDAYS / BREAKS (${ctx.schoolHolidays.length} dates — youth available these days):
${ctx.schoolHolidays.slice(0, 50).map(d => `${d.date}: ${d.label ?? d.dateType}`).join("\n")}

BLACKOUT DATES (${ctx.blackouts.length}):
${ctx.blackouts.map(d => `${d.date}: ${d.label ?? ""}`).join("\n")}

ALIGNMENT HINTS (${ctx.alignmentHints.length}):
${ctx.alignmentHints.slice(0, 20).map(d => `${d.date}: ${d.label ?? ""}`).join("\n")}

EXISTING FIXTURES (${ctx.existingFixtures.length} — avoid conflicts):
${ctx.existingFixtures.slice(0, 20).map(f => `court=${f.courtId} at ${f.scheduledAt}`).join("\n")}

${body.reoptimizeRequest ? `OPTIMIZATION REQUEST: ${body.reoptimizeRequest}` : ""}

Generate the complete schedule now.`;

  let aiRawResponse = "";
  let proposalData: ProposalData = { fixtures: [], summary: "", rulesApplied: [], conflicts: [] };

  try {
    const msg = await anthropic.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    });

    const block = msg.content[0];
    aiRawResponse = block.type === "text" ? block.text : JSON.stringify(msg.content);

    const jsonText = aiRawResponse.replace(/^```json?\s*/m, "").replace(/```\s*$/m, "").trim();
    proposalData = JSON.parse(jsonText);
  } catch (err: any) {
    res.status(502).json({ error: "AI request failed", detail: err.message });
    return;
  }

  // Run conflict detection
  const serverConflicts = detectConflicts(proposalData.fixtures ?? []);
  if (serverConflicts.length > 0) {
    proposalData.conflicts = [...(proposalData.conflicts ?? []), ...serverConflicts];
  }

  const [dbUser] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.clerkId, authed.clerkUserId));

  const [proposal] = await db.insert(scheduleProposalsTable).values({
    createdByUserId: dbUser?.id ?? null,
    status: proposalData.conflicts.length > 0 ? "draft" : "ready",
    entityType: body.entityType,
    entityId: body.entityId,
    proposalData: JSON.stringify(proposalData),
    conflictSummary: proposalData.conflicts.length > 0 ? proposalData.conflicts.join("; ") : null,
    notes: proposalData.summary ?? null,
    aiModel: "claude-opus-4-7",
    aiRawResponse,
    reoptimizeRequest: body.reoptimizeRequest ?? null,
    reoptimizeCount: 0,
  } as any).returning();

  res.status(201).json({ ...proposal, proposalData });
});

// ── List proposals ────────────────────────────────────────────────────────────

router.get("/admin/ai/proposals", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const { status, entityType, entityId, limit = "50", offset = "0" } = req.query as Record<string, string>;

  const conditions = [];
  if (status) conditions.push(eq(scheduleProposalsTable.status, status));
  if (entityType) conditions.push(eq(scheduleProposalsTable.entityType, entityType));
  if (entityId) conditions.push(eq(scheduleProposalsTable.entityId, Number(entityId)));

  const rows = await db.select({
    id: scheduleProposalsTable.id,
    status: scheduleProposalsTable.status,
    entityType: scheduleProposalsTable.entityType,
    entityId: scheduleProposalsTable.entityId,
    notes: scheduleProposalsTable.notes,
    conflictSummary: scheduleProposalsTable.conflictSummary,
    aiModel: scheduleProposalsTable.aiModel,
    reoptimizeCount: scheduleProposalsTable.reoptimizeCount,
    reviewedAt: scheduleProposalsTable.reviewedAt,
    approvedAt: scheduleProposalsTable.approvedAt,
    createdAt: scheduleProposalsTable.createdAt,
    updatedAt: scheduleProposalsTable.updatedAt,
  }).from(scheduleProposalsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(scheduleProposalsTable.createdAt))
    .limit(Math.min(Number(limit), 200))
    .offset(Number(offset));

  res.json(rows);
});

router.get("/admin/ai/proposals/:id", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(scheduleProposalsTable).where(eq(scheduleProposalsTable.id, id));
  if (!row) { res.status(404).json({ error: "Proposal not found" }); return; }

  const proposalData = row.proposalData ? JSON.parse(row.proposalData) : null;
  res.json({ ...row, proposalData });
});

// ── Edit a single fixture in the proposal ─────────────────────────────────────

router.patch("/admin/ai/proposals/:id/fixture", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const id = Number(req.params.id);
  const body = req.body as { fixtureId: string } & Partial<ProposedFixture>;

  const [proposal] = await db.select().from(scheduleProposalsTable).where(eq(scheduleProposalsTable.id, id));
  if (!proposal) { res.status(404).json({ error: "Proposal not found" }); return; }
  if (proposal.status === "approved") { res.status(409).json({ error: "Approved proposals cannot be edited" }); return; }

  const proposalData: ProposalData = proposal.proposalData ? JSON.parse(proposal.proposalData) : { fixtures: [] };
  const idx = proposalData.fixtures.findIndex(f => f.id === body.fixtureId);

  if (idx === -1) { res.status(404).json({ error: "Fixture not found in proposal" }); return; }

  proposalData.fixtures[idx] = { ...proposalData.fixtures[idx], ...body };

  // Re-run conflict detection
  const conflicts = detectConflicts(proposalData.fixtures);
  proposalData.conflicts = conflicts;

  const [updated] = await db.update(scheduleProposalsTable)
    .set({
      proposalData: JSON.stringify(proposalData),
      conflictSummary: conflicts.length > 0 ? conflicts.join("; ") : null,
      status: conflicts.length > 0 ? "draft" : "ready",
    })
    .where(eq(scheduleProposalsTable.id, id))
    .returning();

  res.json({ ...updated, proposalData });
});

// ── Re-optimize ───────────────────────────────────────────────────────────────

router.post("/admin/ai/proposals/:id/reoptimize", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const id = Number(req.params.id);
  const body = req.body as { reoptimizeRequest: string };

  if (!body.reoptimizeRequest) {
    res.status(400).json({ error: "reoptimizeRequest (natural language instruction) is required" });
    return;
  }

  const [existing] = await db.select().from(scheduleProposalsTable).where(eq(scheduleProposalsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Proposal not found" }); return; }
  if (existing.status === "approved") { res.status(409).json({ error: "Approved proposals cannot be re-optimized" }); return; }

  // Re-generate with the optimization request
  const fakeReq = {
    body: {
      entityType: existing.entityType,
      entityId: existing.entityId,
      reoptimizeRequest: body.reoptimizeRequest,
    },
    clerkUserId: (req as AuthedRequest).clerkUserId,
  } as any;

  const ctx = await buildProposalContext(existing.entityType!, existing.entityId!);
  const systemPrompt = `You are an expert futsal scheduling assistant. You are re-optimizing an existing schedule proposal based on a specific admin request. Apply the optimization faithfully while still following all scheduling rules (youth-first, no court conflicts, confirmed dates only). Return JSON only.`;

  const existingProposalData = existing.proposalData ? JSON.parse(existing.proposalData) : {};

  const userContent = `Re-optimize this schedule:

CURRENT SCHEDULE:
${JSON.stringify(existingProposalData.fixtures ?? [], null, 2)}

ADMIN OPTIMIZATION REQUEST: "${body.reoptimizeRequest}"

AVAILABLE COURTS: ${ctx.courts.map(c => `Court ${c.id} ${c.name} (${c.type})`).join(", ")}
CONFIRMED HOLIDAY DATES: ${ctx.schoolHolidays.slice(0, 30).map(d => d.date).join(", ")}

Return the full re-optimized schedule in the same JSON format:
{
  "fixtures": [...],
  "summary": "what changed and why",
  "rulesApplied": [...],
  "conflicts": []
}`;

  let aiRawResponse = "";
  let proposalData: ProposalData = { fixtures: [], summary: "", rulesApplied: [], conflicts: [] };

  try {
    const msg = await anthropic.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    });

    const block = msg.content[0];
    aiRawResponse = block.type === "text" ? block.text : JSON.stringify(msg.content);
    const jsonText = aiRawResponse.replace(/^```json?\s*/m, "").replace(/```\s*$/m, "").trim();
    proposalData = JSON.parse(jsonText);
  } catch (err: any) {
    res.status(502).json({ error: "AI request failed", detail: err.message });
    return;
  }

  const serverConflicts = detectConflicts(proposalData.fixtures ?? []);
  if (serverConflicts.length > 0) proposalData.conflicts = [...(proposalData.conflicts ?? []), ...serverConflicts];

  const [updated] = await db.update(scheduleProposalsTable)
    .set({
      proposalData: JSON.stringify(proposalData),
      conflictSummary: proposalData.conflicts.length > 0 ? proposalData.conflicts.join("; ") : null,
      status: proposalData.conflicts.length > 0 ? "draft" : "ready",
      notes: proposalData.summary ?? existing.notes,
      aiRawResponse,
      reoptimizeRequest: body.reoptimizeRequest,
      reoptimizeCount: (existing.reoptimizeCount ?? 0) + 1,
    })
    .where(eq(scheduleProposalsTable.id, id))
    .returning();

  res.json({ ...updated, proposalData });
});

// ── Approve → publish fixtures ────────────────────────────────────────────────

router.post("/admin/ai/proposals/:id/approve", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const id = Number(req.params.id);

  const [proposal] = await db.select().from(scheduleProposalsTable).where(eq(scheduleProposalsTable.id, id));
  if (!proposal) { res.status(404).json({ error: "Proposal not found" }); return; }
  if (proposal.status === "approved") { res.status(409).json({ error: "Already approved" }); return; }

  const proposalData: ProposalData = proposal.proposalData ? JSON.parse(proposal.proposalData) : { fixtures: [] };

  if (proposalData.conflicts && proposalData.conflicts.length > 0) {
    res.status(409).json({
      error: "Cannot approve a proposal with unresolved conflicts",
      conflicts: proposalData.conflicts,
    });
    return;
  }

  // ── Server-enforce confirmed-date rule ─────────────────────────────────────
  // Every fixture must land on a date that exists in ai_calendar_dates with
  // isConfirmed = true. This is a hard system rule, not just a prompt hint.
  const fixtureList = proposalData.fixtures ?? [];
  const unconfirmedFixtures: string[] = [];

  for (const f of fixtureList) {
    if (!f.scheduledAt) continue;
    const fixtureDate = new Date(f.scheduledAt).toISOString().split("T")[0];
    const [confirmedRow] = await db.select({ id: aiCalendarDatesTable.id })
      .from(aiCalendarDatesTable)
      .where(and(
        eq(aiCalendarDatesTable.date, fixtureDate),
        eq(aiCalendarDatesTable.isConfirmed, true),
      ))
      .limit(1);

    if (!confirmedRow) {
      unconfirmedFixtures.push(
        `Fixture on ${fixtureDate} (court ${f.courtId}) is not on a confirmed calendar date`
      );
    }
  }

  if (unconfirmedFixtures.length > 0) {
    res.status(409).json({
      error: "Cannot approve: one or more fixtures are not on confirmed calendar dates",
      detail: unconfirmedFixtures,
    });
    return;
  }

  const [dbUser] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.clerkId, authed.clerkUserId));

  // Publish fixtures to the fixtures table
  const publishedFixtures: any[] = [];
  const conflictErrors: string[] = [];

  for (const f of (proposalData.fixtures ?? [])) {
    try {
      const [created] = await db.insert(fixturesTable).values({
        entityType: proposal.entityType ?? "league",
        entityId: proposal.entityId ?? 0,
        homeTeamId: f.homeTeamId ?? null,
        awayTeamId: f.awayTeamId ?? null,
        courtId: f.courtId ?? null,
        scheduledAt: f.scheduledAt ? new Date(f.scheduledAt) : null,
        durationMinutes: f.durationMinutes ?? 60,
        round: f.round ?? null,
        phase: f.phase ?? "group",
        notes: f.notes ?? null,
        status: "scheduled",
      } as any).onConflictDoNothing().returning();

      if (created) {
        publishedFixtures.push(created);
      } else {
        conflictErrors.push(`Court ${f.courtId} at ${f.scheduledAt} conflicts with existing fixture`);
      }
    } catch (err: any) {
      conflictErrors.push(`Failed to publish fixture: ${err.message}`);
    }
  }

  const [updated] = await db.update(scheduleProposalsTable)
    .set({
      status: conflictErrors.length > 0 ? "partially_approved" : "approved",
      reviewedByUserId: dbUser?.id ?? null,
      reviewedAt: new Date(),
      approvedAt: new Date(),
      conflictSummary: conflictErrors.length > 0 ? conflictErrors.join("; ") : null,
    })
    .where(eq(scheduleProposalsTable.id, id))
    .returning();

  res.json({
    proposal: updated,
    publishedFixtures: publishedFixtures.length,
    skippedDueToConflicts: conflictErrors.length,
    conflictErrors,
  });
});

// ── Reject proposal ───────────────────────────────────────────────────────────

router.post("/admin/ai/proposals/:id/reject", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const id = Number(req.params.id);
  const body = req.body as { reason?: string };

  const [dbUser] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.clerkId, authed.clerkUserId));

  const [updated] = await db.update(scheduleProposalsTable)
    .set({
      status: "rejected",
      reviewedByUserId: dbUser?.id ?? null,
      reviewedAt: new Date(),
      notes: body.reason ?? null,
    })
    .where(eq(scheduleProposalsTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Proposal not found" }); return; }
  res.json(updated);
});

export default router;
