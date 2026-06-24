/**
 * AI Scheduling — Stage 1: Event Suggestion Engine
 *
 * POST /admin/ai/suggest-events          — trigger AI to generate EventSuggestions
 * GET  /admin/ai/suggestions             — list suggestions (query: status)
 * GET  /admin/ai/suggestions/:id         — get a single suggestion
 * PATCH /admin/ai/suggestions/:id        — admin gate: accept/reject + adjust details
 * POST /admin/ai/suggestions/:id/lock    — lock an accepted suggestion into a configured Offering
 *
 * All Anthropic calls are server-side only; keys never exposed to the client.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  eventSuggestionsTable, aiCalendarSourcesTable, aiCalendarDatesTable,
  pricingRulesTable, courtsTable, ageGroupsTable, usersTable,
  leaguesTable, campsTable, dropinsTable, tournamentsTable,
} from "@workspace/db";
import { eq, and, desc, asc, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { requireSuperAdmin, type AuthedRequest } from "../middlewares/auth";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import type { Request } from "express";

const router = Router();

// ── helpers ───────────────────────────────────────────────────────────────────

async function buildSchedulingContext() {
  const [courts, ageGroups, pricingRules, confirmedDates, sources] = await Promise.all([
    db.select().from(courtsTable).where(eq(courtsTable.availableForScheduling, true)),
    db.select().from(ageGroupsTable).orderBy(asc(ageGroupsTable.displayOrder)),
    db.select().from(pricingRulesTable).where(eq(pricingRulesTable.isLatest, true)),
    db.select().from(aiCalendarDatesTable)
      .where(eq(aiCalendarDatesTable.isConfirmed, true))
      .orderBy(asc(aiCalendarDatesTable.date)),
    db.select().from(aiCalendarSourcesTable).where(eq(aiCalendarSourcesTable.isActive, true)),
  ]);

  // Active offerings summary (just counts + recent entries)
  const [leagueCount] = await db.select({ count: sql<number>`count(*)::int` }).from(leaguesTable);
  const [campCount] = await db.select({ count: sql<number>`count(*)::int` }).from(campsTable);

  return { courts, ageGroups, pricingRules, confirmedDates, sources, leagueCount: leagueCount.count, campCount: campCount.count };
}

const CURRENT_DATE = () => new Date().toISOString().split("T")[0];

// ── Stage 1: generate event suggestions ──────────────────────────────────────

router.post("/admin/ai/suggest-events", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const body = req.body as { offeringType?: string; hint?: string; targetSeasonYear?: number };

  const ctx = await buildSchedulingContext();

  const schoolDates = ctx.confirmedDates.filter(d => d.dateType === "school_holiday" || d.dateType === "break");
  const alignmentHints = ctx.confirmedDates.filter(d => d.dateType === "alignment_hint");

  const systemPrompt = `You are an expert futsal program scheduling assistant for PlayOn, a futsal brand at the Alumni Center in Lexington, KY.

PlayOn operates TWO dedicated courts:
- Court 1 (Full): 5v5 with goalkeepers
- Court 2 (Small): 4v4 or 3v3, format set per session

Scheduling rules you MUST follow:
1. YOUTH-FIRST: Youth availability (Fayette County Schools calendar) is the primary constraint.
2. FRIDAY DROP-IN BANDS (fixed): Youth 8-11 on small court 5:30-7:30pm; Youth 12-15 on full court 5:30-7:30pm; Adults both courts 7:30-9:30pm.
3. Adult leagues run YEAR-ROUND.
4. KSSL/KPL/ECNL schedules are alignment hints (not blackouts) — slot PlayOn seasons into their gaps.
5. Only schedule on confirmed calendar dates.

Respond ONLY with valid JSON — no markdown, no extra text — matching this schema:
{
  "suggestions": [
    {
      "title": "string",
      "entityType": "league|camp|drop_in|tournament",
      "description": "string — rationale and timing logic",
      "suggestedAgeGroup": "string e.g. 8-11 | 12-15 | adult",
      "suggestedFormat": "5v5 | 4v4 | 3v3",
      "suggestedCourtId": number or null,
      "suggestedStartDate": "YYYY-MM-DD or null",
      "suggestedEndDate": "YYYY-MM-DD or null",
      "suggestedCapacity": number or null,
      "suggestedDurationWeeks": number or null,
      "suggestedFee": number or null,
      "pricingRuleId": number or null,
      "seasonAlignment": "string — KSSL/KPL/ECNL context if relevant"
    }
  ],
  "summary": "string — brief overall reasoning"
}`;

  const userContent = `Today is ${CURRENT_DATE()}.
${body.targetSeasonYear ? `Target season year: ${body.targetSeasonYear}.` : ""}
${body.offeringType ? `Focus on offering type: ${body.offeringType}.` : "Consider all offering types."}
${body.hint ? `Admin hint: "${body.hint}"` : ""}

ACTIVE COURTS:
${ctx.courts.map(c => `- Court ${c.id} "${c.name}" (${c.type})`).join("\n")}

AGE GROUPS:
${ctx.ageGroups.map(g => `- ${g.label} (${g.division})`).join("\n")}

PRICING RULES (latest versions):
${ctx.pricingRules.map(p => `- ${p.name} [${p.category}] basePrice=$${p.basePrice ?? "N/A"} teamFee=$${p.teamFee ?? "N/A"} id=${p.id}`).join("\n")}

CONFIRMED SCHOOL HOLIDAY / BREAK DATES (${schoolDates.length} total):
${schoolDates.slice(0, 30).map(d => `${d.date}: ${d.label ?? d.dateType}`).join("\n")}
${schoolDates.length > 30 ? `...and ${schoolDates.length - 30} more.` : ""}

ALIGNMENT HINTS (${alignmentHints.length} total):
${alignmentHints.slice(0, 20).map(d => `${d.date}: ${d.label ?? d.dateType}`).join("\n")}

EXISTING OFFERINGS: ${ctx.leagueCount} leagues, ${ctx.campCount} camps active.

Generate 3-6 specific event suggestions optimized for PlayOn's schedule and demand.`;

  let aiRawResponse = "";
  let suggestions: any[] = [];
  let summary = "";

  try {
    const msg = await anthropic.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    });

    const block = msg.content[0];
    aiRawResponse = block.type === "text" ? block.text : JSON.stringify(msg.content);

    // Parse JSON response (strip markdown fences if present)
    const jsonText = aiRawResponse.replace(/^```json?\s*/m, "").replace(/```\s*$/m, "").trim();
    const parsed = JSON.parse(jsonText);
    suggestions = parsed.suggestions ?? [];
    summary = parsed.summary ?? "";
  } catch (err: any) {
    res.status(502).json({ error: "AI request failed", detail: err.message });
    return;
  }

  const [dbUser] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.clerkId, authed.clerkUserId));

  const created = await Promise.all(suggestions.map(async (s: any) => {
    const [row] = await db.insert(eventSuggestionsTable).values({
      submittedByUserId: dbUser?.id ?? null,
      entityType: s.entityType ?? "league",
      title: s.title ?? "AI Suggested Event",
      description: s.description ?? null,
      suggestedAgeGroup: s.suggestedAgeGroup ?? null,
      suggestedFormat: s.suggestedFormat ?? null,
      suggestedCourtId: s.suggestedCourtId ?? null,
      suggestedStartDate: s.suggestedStartDate ?? null,
      suggestedEndDate: s.suggestedEndDate ?? null,
      suggestedCapacity: s.suggestedCapacity ?? null,
      suggestedDurationWeeks: s.suggestedDurationWeeks ?? null,
      suggestedFee: s.suggestedFee != null ? String(s.suggestedFee) : null,
      pricingRuleId: s.pricingRuleId ?? null,
      seasonAlignment: s.seasonAlignment ?? null,
      aiModel: "claude-opus-4-7",
      aiRawResponse,
      status: "pending",
    } as any).returning();
    return row;
  }));

  res.status(201).json({ suggestions: created, summary });
});

// ── List / get suggestions ────────────────────────────────────────────────────

router.get("/admin/ai/suggestions", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const { status, entityType, limit = "50", offset = "0" } = req.query as Record<string, string>;

  const conditions = [];
  if (status) conditions.push(eq(eventSuggestionsTable.status, status));
  if (entityType) conditions.push(eq(eventSuggestionsTable.entityType, entityType));

  const rows = await db.select().from(eventSuggestionsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(eventSuggestionsTable.createdAt))
    .limit(Math.min(Number(limit), 200))
    .offset(Number(offset));

  res.json(rows);
});

router.get("/admin/ai/suggestions/:id", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(eventSuggestionsTable).where(eq(eventSuggestionsTable.id, id));
  if (!row) { res.status(404).json({ error: "Suggestion not found" }); return; }
  res.json(row);
});

// ── Admin gate: accept / reject / adjust ─────────────────────────────────────

router.patch("/admin/ai/suggestions/:id", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const id = Number(req.params.id);
  const body = req.body as {
    status?: "accepted" | "rejected" | "pending";
    reviewNotes?: string;
    adjustedDetails?: string;
    suggestedAgeGroup?: string;
    suggestedFormat?: string;
    suggestedCourtId?: number | null;
    suggestedStartDate?: string | null;
    suggestedEndDate?: string | null;
    suggestedCapacity?: number | null;
    suggestedDurationWeeks?: number | null;
    suggestedFee?: string | null;
    pricingRuleId?: number | null;
  };

  const [dbUser] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.clerkId, authed.clerkUserId));

  const setValues: Record<string, any> = {};
  if (body.status !== undefined) {
    setValues.status = body.status;
    if (body.status === "accepted" || body.status === "rejected") {
      setValues.reviewedByUserId = dbUser?.id ?? null;
      setValues.reviewedAt = new Date();
    }
  }
  if (body.reviewNotes !== undefined) setValues.reviewNotes = body.reviewNotes;
  if (body.adjustedDetails !== undefined) setValues.adjustedDetails = body.adjustedDetails;
  if (body.suggestedAgeGroup !== undefined) setValues.suggestedAgeGroup = body.suggestedAgeGroup;
  if (body.suggestedFormat !== undefined) setValues.suggestedFormat = body.suggestedFormat;
  if (body.suggestedCourtId !== undefined) setValues.suggestedCourtId = body.suggestedCourtId;
  if (body.suggestedStartDate !== undefined) setValues.suggestedStartDate = body.suggestedStartDate;
  if (body.suggestedEndDate !== undefined) setValues.suggestedEndDate = body.suggestedEndDate;
  if (body.suggestedCapacity !== undefined) setValues.suggestedCapacity = body.suggestedCapacity;
  if (body.suggestedDurationWeeks !== undefined) setValues.suggestedDurationWeeks = body.suggestedDurationWeeks;
  if (body.suggestedFee !== undefined) setValues.suggestedFee = body.suggestedFee;
  if (body.pricingRuleId !== undefined) setValues.pricingRuleId = body.pricingRuleId;

  const [updated] = await db.update(eventSuggestionsTable)
    .set(setValues)
    .where(eq(eventSuggestionsTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Suggestion not found" }); return; }
  res.json(updated);
});

// ── Lock suggestion → Offering ─────────────────────────────────────────────

router.post("/admin/ai/suggestions/:id/lock", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const id = Number(req.params.id);
  const body = req.body as { offeringType: string; offeringId: number };

  if (!body.offeringType || !body.offeringId) {
    res.status(400).json({ error: "offeringType and offeringId are required" });
    return;
  }

  const [suggestion] = await db.select().from(eventSuggestionsTable).where(eq(eventSuggestionsTable.id, id));
  if (!suggestion) { res.status(404).json({ error: "Suggestion not found" }); return; }
  if (suggestion.status !== "accepted") {
    res.status(409).json({ error: "Only accepted suggestions can be locked" });
    return;
  }

  const [updated] = await db.update(eventSuggestionsTable)
    .set({
      status: "locked",
      lockedOfferingType: body.offeringType,
      lockedOfferingId: body.offeringId,
      lockedAt: new Date(),
    })
    .where(eq(eventSuggestionsTable.id, id))
    .returning();

  res.json(updated);
});

export default router;
