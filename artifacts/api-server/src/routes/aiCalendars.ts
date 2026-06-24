/**
 * AI Calendar Routes
 *
 * Manages external calendar sources (Fayette County Schools, KSSL, KPL, ECNL)
 * and their individual dates that the AI uses for scheduling.
 *
 * GET  /admin/ai/calendar-sources          — list all sources
 * PATCH /admin/ai/calendar-sources/:id     — update source (toggle active, set fetchUrl)
 * POST /admin/ai/calendar-sources/:id/fetch — ingest dates from source fetchUrl (iCal or CSV)
 * GET  /admin/ai/calendar-dates            — list dates (query: sourceId, confirmed, limit)
 * POST /admin/ai/calendar-dates            — create/upsert a date entry
 * PATCH /admin/ai/calendar-dates/:id       — update date (label, dateType, notes)
 * POST /admin/ai/calendar-dates/:id/confirm — mark date confirmed by this admin
 * POST /admin/ai/calendar-dates/bulk-confirm — confirm multiple dates at once
 * DELETE /admin/ai/calendar-dates/:id      — remove a date entry
 * GET  /admin/ai/calendar-dates/summary   — confirmed/unconfirmed counts per source
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { aiCalendarSourcesTable, aiCalendarDatesTable, usersTable } from "@workspace/db";
import { eq, and, desc, asc, inArray, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { requireSuperAdmin, type AuthedRequest } from "../middlewares/auth";
import type { Request } from "express";

const router = Router();

// ── Sources ──────────────────────────────────────────────────────────────────

router.get("/admin/ai/calendar-sources", requireSuperAdmin, async (_req, res): Promise<void> => {
  const sources = await db.select().from(aiCalendarSourcesTable).orderBy(asc(aiCalendarSourcesTable.name));

  // Enrich each source with confirmed/unconfirmed counts
  const enriched = await Promise.all(sources.map(async (src) => {
    const [{ total, confirmed }] = await db.select({
      total: sql<number>`count(*)::int`,
      confirmed: sql<number>`count(*) filter (where ${aiCalendarDatesTable.isConfirmed} = true)::int`,
    }).from(aiCalendarDatesTable).where(eq(aiCalendarDatesTable.sourceId, src.id));
    return { ...src, totalDates: total, confirmedDates: confirmed };
  }));

  res.json(enriched);
});

router.patch("/admin/ai/calendar-sources/:id", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const id = Number(req.params.id);
  const body = req.body as { isActive?: boolean; fetchUrl?: string; notes?: string; name?: string };

  const [updated] = await db.update(aiCalendarSourcesTable)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
      ...(body.fetchUrl !== undefined && { fetchUrl: body.fetchUrl }),
      ...(body.notes !== undefined && { notes: body.notes }),
    })
    .where(eq(aiCalendarSourcesTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Source not found" }); return; }
  res.json(updated);
});

// ── Dates ─────────────────────────────────────────────────────────────────────

router.get("/admin/ai/calendar-dates/summary", requireSuperAdmin, async (_req, res): Promise<void> => {
  const rows = await db.select({
    sourceId: aiCalendarDatesTable.sourceId,
    sourceName: aiCalendarSourcesTable.name,
    sourceType: aiCalendarSourcesTable.sourceType,
    total: sql<number>`count(*)::int`,
    confirmed: sql<number>`count(*) filter (where ${aiCalendarDatesTable.isConfirmed} = true)::int`,
  })
    .from(aiCalendarDatesTable)
    .leftJoin(aiCalendarSourcesTable, eq(aiCalendarDatesTable.sourceId, aiCalendarSourcesTable.id))
    .groupBy(aiCalendarDatesTable.sourceId, aiCalendarSourcesTable.name, aiCalendarSourcesTable.sourceType)
    .orderBy(asc(aiCalendarSourcesTable.name));
  res.json(rows);
});

router.get("/admin/ai/calendar-dates", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const { sourceId, confirmed, dateType, limit = "200", offset = "0" } = req.query as Record<string, string>;

  const conditions = [];
  if (sourceId) conditions.push(eq(aiCalendarDatesTable.sourceId, Number(sourceId)));
  if (confirmed !== undefined) conditions.push(eq(aiCalendarDatesTable.isConfirmed, confirmed === "true"));
  if (dateType) conditions.push(eq(aiCalendarDatesTable.dateType, dateType));

  const rows = await db.select().from(aiCalendarDatesTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(aiCalendarDatesTable.date))
    .limit(Math.min(Number(limit), 500))
    .offset(Number(offset));

  res.json(rows);
});

router.post("/admin/ai/calendar-dates", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const body = req.body as {
    sourceId: number;
    date: string;
    label?: string;
    dateType?: string;
    notes?: string;
    isConfirmed?: boolean;
  };

  if (!body.sourceId || !body.date) {
    res.status(400).json({ error: "sourceId and date are required" });
    return;
  }

  const [created] = await db.insert(aiCalendarDatesTable).values({
    sourceId: body.sourceId,
    date: body.date,
    label: body.label ?? null,
    dateType: body.dateType ?? "school_day",
    notes: body.notes ?? null,
    isConfirmed: body.isConfirmed ?? false,
  }).onConflictDoNothing().returning();

  if (!created) {
    res.status(409).json({ error: "A date entry for this source+date combination already exists" });
    return;
  }
  res.status(201).json(created);
});

router.patch("/admin/ai/calendar-dates/:id", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const id = Number(req.params.id);
  const body = req.body as { label?: string; dateType?: string; notes?: string; isConfirmed?: boolean };

  const [updated] = await db.update(aiCalendarDatesTable)
    .set({
      ...(body.label !== undefined && { label: body.label }),
      ...(body.dateType !== undefined && { dateType: body.dateType }),
      ...(body.notes !== undefined && { notes: body.notes }),
      ...(body.isConfirmed !== undefined && { isConfirmed: body.isConfirmed }),
    })
    .where(eq(aiCalendarDatesTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Date not found" }); return; }
  res.json(updated);
});

router.post("/admin/ai/calendar-dates/:id/confirm", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const id = Number(req.params.id);

  const [dbUser] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.clerkId, authed.clerkUserId));

  const [updated] = await db.update(aiCalendarDatesTable)
    .set({
      isConfirmed: true,
      confirmedByUserId: dbUser?.id ?? null,
      confirmedAt: new Date(),
    })
    .where(eq(aiCalendarDatesTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Date not found" }); return; }
  res.json(updated);
});

router.post("/admin/ai/calendar-dates/bulk-confirm", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const body = req.body as { ids?: number[]; sourceId?: number; dateType?: string };

  const [dbUser] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.clerkId, authed.clerkUserId));

  const conditions = [];
  if (body.ids?.length) conditions.push(inArray(aiCalendarDatesTable.id, body.ids));
  if (body.sourceId) conditions.push(eq(aiCalendarDatesTable.sourceId, body.sourceId));
  if (body.dateType) conditions.push(eq(aiCalendarDatesTable.dateType, body.dateType));

  if (!conditions.length) {
    res.status(400).json({ error: "Provide ids, sourceId, or dateType to bulk-confirm" });
    return;
  }

  const updated = await db.update(aiCalendarDatesTable)
    .set({
      isConfirmed: true,
      confirmedByUserId: dbUser?.id ?? null,
      confirmedAt: new Date(),
    })
    .where(and(...conditions))
    .returning();

  res.json({ confirmed: updated.length });
});

router.delete("/admin/ai/calendar-dates/:id", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const id = Number(req.params.id);
  await db.delete(aiCalendarDatesTable).where(eq(aiCalendarDatesTable.id, id));
  res.status(204).send();
});

// ── iCal / CSV fetch ingestion ────────────────────────────────────────────────
//
// POST /admin/ai/calendar-sources/:id/fetch
//
// Fetches the source's fetchUrl and ingests dates into ai_calendar_dates.
// Supports iCal (.ics) and plain CSV (date, label, dateType).
//
// Source-specific date-type classification:
//   - school_calendar  → VEVENT SUMMARY containing "holiday", "break", "no school" → school_holiday
//                        VEVENT SUMMARY containing "delay", "dismissal"             → school_day
//                        Everything else                                             → school_day
//   - external_league  → all dates treated as alignment_hint
//   - internal_block   → all dates treated as blackout
//
// iCal parsing: lightweight inline parser — no external library required.
// New dates are inserted with isConfirmed=false so the admin must review them.
//
// Returns: { ingested, skipped, errors[] }

interface ParsedCalDate {
  date: string;        // YYYY-MM-DD
  label: string | null;
  dateType: string;
}

function classifyIcalSummary(summary: string, sourceType: string): string {
  // Use actual seeded source_type values from ai_calendar_sources:
  //   youth_availability → Fayette County Schools (school_holiday / school_day)
  //   alignment_hint     → KSSL / KPL / ECNL (always alignment_hint)
  //   internal_block     → manually-entered blackout days (always blackout)
  if (sourceType === "alignment_hint") return "alignment_hint";
  if (sourceType === "internal_block") return "blackout";
  // youth_availability (Fayette County Schools) classification by event title
  if (/holiday|no school|break|recess|closed|winter|spring|fall|thanksgiving|christmas|MLK|presidents/i.test(summary)) {
    return "school_holiday";
  }
  return "school_day";
}

function parseIcalDate(raw: string): string | null {
  // Handles DTSTART formats: 20260901, 20260901T000000, 20260901T000000Z
  const digits = raw.replace(/[TZ:]/g, "").replace(/;.*/, "").trim().slice(0, 8);
  if (digits.length < 8) return null;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function parseIcal(text: string, sourceType: string): ParsedCalDate[] {
  const results: ParsedCalDate[] = [];
  const events = text.split("BEGIN:VEVENT");
  for (let i = 1; i < events.length; i++) {
    const block = events[i];
    const summaryMatch = block.match(/^SUMMARY[^:]*:(.+)$/m);
    const dtStartMatch = block.match(/^DTSTART[^:]*:([^\r\n]+)/m);
    const dtEndMatch   = block.match(/^DTEND[^:]*:([^\r\n]+)/m);
    if (!dtStartMatch) continue;
    const startDate = parseIcalDate(dtStartMatch[1].trim());
    if (!startDate) continue;
    const summary = summaryMatch ? summaryMatch[1].replace(/\\,/g, ",").trim() : null;
    const dateType = classifyIcalSummary(summary ?? "", sourceType);

    // Multi-day events: expand date range (up to 60 days cap)
    if (dtEndMatch) {
      const endDate = parseIcalDate(dtEndMatch[1].trim());
      if (endDate && endDate > startDate) {
        let cur = new Date(startDate + "T12:00:00Z");
        const end = new Date(endDate + "T12:00:00Z");
        let cap = 0;
        while (cur < end && cap < 60) {
          const d = cur.toISOString().split("T")[0];
          results.push({ date: d, label: summary, dateType });
          cur.setUTCDate(cur.getUTCDate() + 1);
          cap++;
        }
        continue;
      }
    }
    results.push({ date: startDate, label: summary, dateType });
  }
  return results;
}

function parseCsv(text: string, _sourceType: string): ParsedCalDate[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim() && !l.startsWith("#"));
  const results: ParsedCalDate[] = [];
  // Expected columns: date, label (optional), dateType (optional)
  const header = lines[0]?.split(",").map(h => h.trim().toLowerCase());
  const hasHeader = header?.[0] === "date";
  const dataLines = hasHeader ? lines.slice(1) : lines;

  for (const line of dataLines) {
    const cols = line.split(",").map(c => c.trim().replace(/^"|"$/g, ""));
    const date = cols[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const label = cols[1] || null;
    const dateType = cols[2] || "school_day";
    results.push({ date, label, dateType });
  }
  return results;
}

router.post("/admin/ai/calendar-sources/:id/fetch", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const id = Number(req.params.id);
  const body = req.body as { overwrite?: boolean };

  const [source] = await db.select().from(aiCalendarSourcesTable).where(eq(aiCalendarSourcesTable.id, id));
  if (!source) { res.status(404).json({ error: "Source not found" }); return; }
  if (!source.fetchUrl) {
    res.status(400).json({ error: "Source has no fetchUrl configured. Set it via PATCH /admin/ai/calendar-sources/:id first." });
    return;
  }

  // Fetch the remote calendar
  let rawText: string;
  try {
    const response = await fetch(source.fetchUrl, {
      headers: { "User-Agent": "PlayOn-Scheduler/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      res.status(502).json({ error: `Fetch failed: ${response.status} ${response.statusText}` });
      return;
    }
    rawText = await response.text();
  } catch (err: any) {
    res.status(502).json({ error: "Failed to fetch calendar URL", detail: err.message });
    return;
  }

  // Detect format and parse
  let parsed: ParsedCalDate[];
  const looksLikeIcal = rawText.includes("BEGIN:VCALENDAR") || rawText.includes("BEGIN:VEVENT");
  if (looksLikeIcal) {
    parsed = parseIcal(rawText, source.sourceType);
  } else {
    parsed = parseCsv(rawText, source.sourceType);
  }

  if (!parsed.length) {
    res.json({ ingested: 0, skipped: 0, errors: ["No parseable date entries found in the remote file"] });
    return;
  }

  let ingested = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const entry of parsed) {
    try {
      const [row] = await db.insert(aiCalendarDatesTable).values({
        sourceId: id,
        date: entry.date,
        label: entry.label,
        dateType: entry.dateType,
        isConfirmed: false,
      }).onConflictDoNothing().returning();

      if (row) {
        ingested++;
      } else {
        skipped++;
      }
    } catch (err: any) {
      errors.push(`${entry.date}: ${err.message}`);
    }
  }

  // Update lastFetchedAt on the source
  await db.update(aiCalendarSourcesTable)
    .set({ lastFetchedAt: new Date() })
    .where(eq(aiCalendarSourcesTable.id, id));

  res.json({ ingested, skipped, errors, format: looksLikeIcal ? "ical" : "csv", total: parsed.length });
});

export default router;
