/**
 * Drop-in Template + Occurrence API Routes
 *
 * Template-first, lazy-materialization architecture:
 *  - Templates define master config (name, sport, recurrence rule, pools)
 *  - Occurrences are computed on the fly from recurrence rules for display
 *  - Concrete dropin_occurrences rows are materialized only when a player registers
 *    or within 24h of start (via the auto-complete scheduler)
 *  - When materializing, corresponding dropins + dropin_court_pools rows are created
 *    so the existing payment/waitlist/cancellation flow continues to work unchanged
 */

import { Router, type IRouter } from "express";
import {
  db, dropinTemplatesTable, dropinTemplatePoolsTable, dropinOccurrencesTable,
  dropinOccurrenceOverridesTable, dropinPoolPresetsTable,
  dropinsTable, dropinCourtPoolsTable, usersTable, courtsTable, venuesTable,
  spotsTable, auditLogTable, guardiansTable, ageGroupWaiversTable,
  accountCreditsTable, discountCodesTable, paymentsTable,
} from "@workspace/db";
import { eq, and, inArray, desc, asc, sql, ne, isNull, gt, or } from "drizzle-orm";
import { requireAuth, requirePermission, hasPermission } from "../middlewares/auth";
import type { AuthedRequest } from "../middlewares/auth";
import { getAuth } from "@clerk/express";
import {
  computeOccurrenceDates,
  occurrenceDateToUtc,
  toEasternDateString,
  describeRecurrenceRule,
} from "../services/dropinOccurrenceService";
import type { RecurrenceRule } from "@workspace/db";
import { getUncachableStripeClient, getStripePublishableKey } from "../lib/stripe";
import { computeRevenueSplit } from "../services/revenueComputation";
import { checkUsysAgeEligibility } from "../lib/usysAgeEligibility";
import { sendRegistrationConfirmationEmail } from "../services/notifications";
import { restoreReservedCredits } from "../lib/creditUtils";

const router: IRouter = Router();

const SPORT_LABELS: Record<string, string> = {
  basketball: "Basketball",
  soccer: "Soccer",
  futsal: "Futsal",
  volleyball: "Volleyball",
  tennis: "Tennis",
  pickleball: "Pickleball",
  badminton: "Badminton",
  swimming: "Swimming",
  hockey: "Hockey",
  football: "Football",
  baseball: "Baseball",
  softball: "Softball",
  lacrosse: "Lacrosse",
  other: "Other",
};

async function getDbUserFromClerk(clerkId: string) {
  const [u] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  return u;
}

async function writeAuditLog(params: {
  actorClerkId?: string | null;
  action: string;
  entityType: string;
  entityId: string | number;
  before?: any;
  after?: any;
  notes?: string;
}) {
  await db.insert(auditLogTable).values({
    actorClerkId: params.actorClerkId ?? null,
    actorUserId: null,
    action: params.action,
    entityType: params.entityType,
    entityId: String(params.entityId),
    before: params.before ? JSON.stringify(params.before) : null,
    after: params.after ? JSON.stringify(params.after) : null,
    notes: params.notes ?? null,
  });
}

function normalizeAgeGroup(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((v) => typeof v === "string" && v.length > 0);
  if (typeof raw === "string" && raw.length > 0) return [raw];
  return ["adult"];
}

async function getPlayerWaivedGroups(playerUserId: number): Promise<string[]> {
  const waivers = await db.select().from(ageGroupWaiversTable).where(
    and(eq(ageGroupWaiversTable.playerId, playerUserId), eq(ageGroupWaiversTable.status, "approved"))
  );
  return waivers.map((w) => w.ageGroup);
}

// ─── Early-bird price computation ─────────────────────────────────────────────
// Evaluates date- or spots-triggered early-bird pricing server-side so the
// price displayed to the player always matches the price charged at checkout.

function computeEffectivePrice(templatePool: any, now: Date, spotsTaken: number = 0): string {
  const basePrice = String(templatePool.price ?? "0");
  const eb = templatePool.earlyBirdPricing;
  if (!eb) return basePrice;

  if (eb.triggerType === "date" && eb.triggerDate) {
    // Treat triggerDate as end-of-day UTC (inclusive)
    const cutoff = new Date(eb.triggerDate + "T23:59:59Z");
    if (now <= cutoff) return String(eb.price ?? basePrice);
  } else if (eb.triggerType === "spots_taken" && eb.triggerSpotsCount != null) {
    const cap = Number(templatePool.cap ?? 15);
    const remaining = cap - spotsTaken;
    // Early-bird active while remaining spots >= triggerSpotsCount
    if (remaining >= Number(eb.triggerSpotsCount)) return String(eb.price ?? basePrice);
  }
  return basePrice;
}

// ─── Template pool aggregate helpers ──────────────────────────────────────────

async function poolFillStats(templatePoolIds: number[]): Promise<Map<number, { spotsTaken: number; waitlistCount: number }>> {
  const result = new Map<number, { spotsTaken: number; waitlistCount: number }>();
  if (!templatePoolIds.length) return result;

  // RSVP materializes spots as entityType='dropin' (legacy) with legacy dropin_court_pools.id as poolId.
  // Resolve template pool → legacy court pool via: dropin_template_pools → dropins (d.template_id) → dropin_court_pools (matching court_id).
  // Safe to inline: templatePoolIds are integers fetched from DB.
  const idArr = templatePoolIds.map(Number).join(",");
  const rows = await db.execute<{ tpid: string; waitlisted: boolean; cnt: string }>(sql`
    SELECT tp.id::text AS tpid, s.waitlisted, COUNT(*)::text AS cnt
    FROM spots s
    JOIN dropin_court_pools dcp ON dcp.id = s.pool_id
    JOIN dropins d ON d.id = dcp.dropin_id AND d.template_id IS NOT NULL
    JOIN dropin_template_pools tp ON tp.template_id = d.template_id AND tp.court_id = dcp.court_id
    WHERE tp.id = ANY(ARRAY[${sql.raw(idArr)}]::int[])
      AND s.entity_type = 'dropin'
      AND s.status = 'reserved'
      AND s.payment_status != 'payment_pending'
    GROUP BY tp.id, s.waitlisted
  `);

  const resultRows: any[] = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
  for (const row of resultRows) {
    const tid = Number(row.tpid);
    if (!result.has(tid)) result.set(tid, { spotsTaken: 0, waitlistCount: 0 });
    const entry = result.get(tid)!;
    if (row.waitlisted) entry.waitlistCount += Number(row.cnt);
    else entry.spotsTaken += Number(row.cnt);
  }
  return result;
}

/**
 * Build virtual occurrence objects from a template for the given date window.
 * Merges materialized dropin_occurrences rows and their overrides.
 */
async function buildOccurrencesForTemplate(
  template: any,
  pools: any[],
  opts: { from?: Date; to?: Date; limit?: number } = {},
): Promise<any[]> {
  const rule: RecurrenceRule = template.recurrenceRule;
  const dates = computeOccurrenceDates(rule, opts);
  if (dates.length === 0) return [];

  // Fetch any materialized occurrence rows for this template in the date range
  const materialized = await db
    .select()
    .from(dropinOccurrencesTable)
    .where(and(
      eq(dropinOccurrencesTable.templateId, template.id),
      inArray(dropinOccurrencesTable.occurrenceDate, dates),
    ));
  const matByDate = new Map(materialized.map((m) => [m.occurrenceDate, m]));

  // Fetch overrides for materialized occurrences
  const matIds = materialized.map((m) => m.id);
  const overrides = matIds.length
    ? await db.select().from(dropinOccurrenceOverridesTable).where(inArray(dropinOccurrenceOverridesTable.occurrenceId, matIds))
    : [];
  const overridesByOccurrence = new Map<number, any[]>();
  for (const ov of overrides) {
    const arr = overridesByOccurrence.get(ov.occurrenceId) ?? [];
    arr.push(ov);
    overridesByOccurrence.set(ov.occurrenceId, arr);
  }

  // Occurrence-scoped fill stats: look up materialized dropin rows and their court pools,
  // then count spots per court pool (entityType='dropin'). This gives accurate per-date
  // availability rather than inflated cross-occurrence aggregates.
  const dropins = await db.select().from(dropinsTable).where(
    eq(dropinsTable.templateId, template.id)
  );
  // Map occurrence date → dropin[] (collect ALL dropins per date — pools with custom start
  // times materialise to distinct dropin rows keyed by startsAt; we must not overwrite here).
  const dropinsByDate = new Map<string, (typeof dropinsTable.$inferSelect)[]>();
  for (const d of dropins) {
    const dateStr = toEasternDateString(d.startsAt);
    if (dates.includes(dateStr)) {
      const arr = dropinsByDate.get(dateStr) ?? [];
      arr.push(d);
      dropinsByDate.set(dateStr, arr);
    }
  }

  // Fetch court pools for those dropin rows
  const dropinIds = [...dropinsByDate.values()].flat().map((d) => d.id);
  const courtPoolsByDropinId = new Map<number, (typeof dropinCourtPoolsTable.$inferSelect)[]>();
  if (dropinIds.length > 0) {
    const cps = await db.select().from(dropinCourtPoolsTable).where(
      inArray(dropinCourtPoolsTable.dropinId, dropinIds)
    );
    for (const cp of cps) {
      const arr = courtPoolsByDropinId.get(cp.dropinId) ?? [];
      arr.push(cp);
      courtPoolsByDropinId.set(cp.dropinId, arr);
    }
  }

  // Count spots per legacy court pool ID (scoped to their specific dropin)
  const allCpIds = [...courtPoolsByDropinId.values()].flat().map((cp) => cp.id);
  const spotsByPoolId = new Map<number, { spotsTaken: number; waitlistCount: number }>();
  if (allCpIds.length > 0) {
    const spotRows = await db
      .select({ poolId: spotsTable.poolId, waitlisted: spotsTable.waitlisted, count: sql<number>`count(*)` })
      .from(spotsTable)
      .where(and(
        inArray(spotsTable.poolId, allCpIds),
        eq(spotsTable.entityType, "dropin"),
        eq(spotsTable.status, "reserved"),
        sql`${(spotsTable as any).paymentStatus} != 'payment_pending'`,
      ))
      .groupBy(spotsTable.poolId, spotsTable.waitlisted);
    for (const row of spotRows) {
      const pid = row.poolId!;
      if (!spotsByPoolId.has(pid)) spotsByPoolId.set(pid, { spotsTaken: 0, waitlistCount: 0 });
      const entry = spotsByPoolId.get(pid)!;
      if (row.waitlisted) entry.waitlistCount += Number(row.count);
      else entry.spotsTaken += Number(row.count);
    }
  }

  const result: any[] = [];
  for (const date of dates) {
    const mat = matByDate.get(date);
    if (mat && mat.status === "cancelled") continue;

    const occId = mat ? mat.id : null;
    const occOverrides = occId ? (overridesByOccurrence.get(occId) ?? []) : [];

    const startsAt = occurrenceDateToUtc(date, rule.startTime);

    // All materialised dropin rows for this occurrence date (may be >1 when pools have custom times)
    const dropinsForDate = dropinsByDate.get(date) ?? [];

    // Apply pool overrides and occurrence-scoped fill stats
    const enrichedPools = pools.map((pool) => {
      const poolOverrides = occOverrides.filter((o) => o.templatePoolId === pool.id);
      let poolData = { ...pool };
      let registrationOpenOverrideApplied = false;
      for (const ov of poolOverrides) {
        if (ov.field === "cap") poolData.cap = Number(ov.value);
        if (ov.field === "price") poolData.price = String(ov.value);
        if (ov.field === "registrationOpen") { poolData.registrationOpen = Boolean(ov.value); registrationOpenOverrideApplied = true; }
        if (ov.field === "earlyBirdPricing") poolData.earlyBirdPricing = ov.value;
      }
      // Compute effective registrationOpen from template window when no per-occurrence override is set
      if (!registrationOpenOverrideApplied) {
        const regMode = template.registrationOpens ?? "immediately";
        if (regMode === "immediately") {
          poolData.registrationOpen = true;
        } else if (regMode === "on_date") {
          const opensAt = template.registrationOpensAt ? new Date(template.registrationOpensAt) : null;
          poolData.registrationOpen = opensAt ? new Date() >= opensAt : false;
        } else {
          // "manual" — closed by default; only opened via explicit registrationOpen override
          poolData.registrationOpen = false;
        }
      }
      // Compute per-pool effective start time and duration (pool overrides session-level if set)
      const effectiveStartTime = pool.startTime ?? rule.startTime;
      const effectiveDurationMinutes = pool.durationMinutes ?? rule.durationMinutes;
      const poolEffectiveStartsAt = occurrenceDateToUtc(date, effectiveStartTime);
      poolData.effectiveStartsAt = poolEffectiveStartsAt.toISOString();
      poolData.effectiveDurationMinutes = effectiveDurationMinutes;
      // Scope fill stats to this specific occurrence.
      // Match the dropin by effective startsAt so pools with custom times resolve to their own
      // dropin row (keyed by templateId+startsAt) rather than the session-default dropin.
      // Only match a dropin whose startsAt aligns with this pool's effective start time
      // (within 60s tolerance). Never fall back to an unrelated dropin — that would cause
      // pools at different times on the same court to share each other's fill stats.
      const matchedDropin = dropinsForDate.find(
        (d) => Math.abs(d.startsAt.getTime() - poolEffectiveStartsAt.getTime()) < 60_000
      );
      // Prefer bridge-column (dropinTemplatePoolId) match across ALL dropins for this date —
      // this handles cases where pools were materialized onto a dropin with a different start
      // time than the pool's own effective start time (e.g., adult pool on a youth-start dropin).
      const allCpForDate = dropinsForDate.flatMap((d) => courtPoolsByDropinId.get(d.id) ?? []);
      const cpByTemplatePoolId = new Map(
        allCpForDate.filter((cp) => cp.dropinTemplatePoolId != null).map((cp) => [cp.dropinTemplatePoolId!, cp])
      );
      // Fall back to court-ID match on the time-matched dropin for legacy rows without the bridge column.
      const cpList = matchedDropin ? (courtPoolsByDropinId.get(matchedDropin.id) ?? []) : [];
      const cpByCourtId = new Map(cpList.map((cp) => [cp.courtId, cp]));
      const cp = cpByTemplatePoolId.get(pool.id) ?? cpByCourtId.get(pool.courtId);
      const stats = cp
        ? (spotsByPoolId.get(cp.id) ?? { spotsTaken: 0, waitlistCount: 0 })
        : { spotsTaken: 0, waitlistCount: 0 };
      poolData.spotsTaken = stats.spotsTaken;
      poolData.waitlistCount = stats.waitlistCount;
      return poolData;
    });

    result.push({
      id: occId ?? `v-${template.id}-${date}`,
      templateId: template.id,
      occurrenceDate: date,
      startsAt: startsAt.toISOString(),
      durationMinutes: rule.durationMinutes,
      status: mat?.status ?? "upcoming",
      isVirtual: !mat,
      materializedDropinId: dropinsForDate[0]?.id ?? null,
      pools: enrichedPools,
      template: {
        id: template.id,
        name: template.name,
        sport: template.sport,
        imageUrl: template.imageUrl,
        description: template.description,
        recurrenceRule: rule,
        waitlistEnabled: template.waitlistEnabled,
        registrationCutoffMinutes: template.registrationCutoffMinutes,
        registrationOpens: template.registrationOpens,
        registrationOpensAt: template.registrationOpensAt,
      },
    });
  }

  return result;
}

// ─── GET /dropin-templates ────────────────────────────────────────────────────

router.get("/dropin-templates", requireAuth, async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req as any);
  if (!clerkId || !(await hasPermission(clerkId, "canManageDropins"))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { includeDrafts, sport, venueId } = req.query as Record<string, string>;

  let templates = await db
    .select()
    .from(dropinTemplatesTable)
    .orderBy(desc(dropinTemplatesTable.createdAt));

  if (includeDrafts !== "true") {
    templates = templates.filter((t) => !t.isDraft);
  }
  if (sport) templates = templates.filter((t) => t.sport === sport);
  if (venueId) templates = templates.filter((t) => String(t.venueId) === venueId);

  if (!templates.length) { res.json([]); return; }

  const templateIds = templates.map((t) => t.id);
  const allPools = await db
    .select()
    .from(dropinTemplatePoolsTable)
    .where(inArray(dropinTemplatePoolsTable.templateId, templateIds))
    .orderBy(asc(dropinTemplatePoolsTable.sortOrder));

  const poolsByTemplate = new Map<number, any[]>();
  for (const pool of allPools) {
    const arr = poolsByTemplate.get(pool.templateId) ?? [];
    arr.push(pool);
    poolsByTemplate.set(pool.templateId, arr);
  }

  const now = new Date();
  const horizon = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const result = await Promise.all(templates.map(async (t) => {
    const pools = poolsByTemplate.get(t.id) ?? [];
    const upcomingOccurrences = await buildOccurrencesForTemplate(t, pools, { from: now, to: horizon, limit: 5 });

    return {
      ...t,
      pools,
      upcomingOccurrences,
      recurrenceDescription: describeRecurrenceRule(t.recurrenceRule as RecurrenceRule),
    };
  }));

  res.json(result);
});

// ─── GET /dropin-templates/:id ───────────────────────────────────────────────

router.get("/dropin-templates/:id", requireAuth, async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req as any);
  if (!clerkId || !(await hasPermission(clerkId, "canManageDropins"))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [template] = await db.select().from(dropinTemplatesTable).where(eq(dropinTemplatesTable.id, id));
  if (!template) { res.status(404).json({ error: "Not found" }); return; }

  const pools = await db
    .select()
    .from(dropinTemplatePoolsTable)
    .where(eq(dropinTemplatePoolsTable.templateId, id))
    .orderBy(asc(dropinTemplatePoolsTable.sortOrder));

  const now = new Date();
  const horizon = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  const upcomingOccurrences = await buildOccurrencesForTemplate(template, pools, { from: now, to: horizon, limit: 20 });

  res.json({
    ...template,
    pools,
    upcomingOccurrences,
    recurrenceDescription: describeRecurrenceRule(template.recurrenceRule as RecurrenceRule),
  });
});

// ─── POST /dropin-templates ──────────────────────────────────────────────────

router.post("/dropin-templates", requireAuth, async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req as any);
  if (!clerkId || !(await hasPermission(clerkId, "canManageDropins"))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const {
    name, sport = "basketball", venueId, description, imageUrl,
    recurrenceRule, isDraft = true, publishAt, staffUserId,
    autoCancelThreshold, registrationCutoffMinutes, registrationOpens = "immediately",
    registrationOpensAt, waitlistEnabled = true, autoPromoteEnabled = false,
    pools: poolsInput = [],
  } = req.body;

  if (!name || !recurrenceRule) {
    res.status(400).json({ error: "name and recurrenceRule are required" });
    return;
  }

  const [template] = await db.insert(dropinTemplatesTable).values({
    name: String(name),
    sport: String(sport),
    venueId: venueId ? Number(venueId) : null,
    description: description ? String(description) : null,
    imageUrl: imageUrl ? String(imageUrl) : null,
    recurrenceRule,
    isDraft: Boolean(isDraft),
    // Only mark published immediately when not drafting AND publishAt is not a future date
    isPublished: !isDraft && (!publishAt || new Date(publishAt) <= new Date()),
    publishAt: publishAt ? new Date(publishAt) : null,
    staffUserId: staffUserId ? Number(staffUserId) : null,
    autoCancelThreshold: autoCancelThreshold ? Number(autoCancelThreshold) : null,
    registrationCutoffMinutes: registrationCutoffMinutes ? Number(registrationCutoffMinutes) : null,
    registrationOpens: String(registrationOpens),
    registrationOpensAt: registrationOpensAt ? new Date(registrationOpensAt) : null,
    waitlistEnabled: Boolean(waitlistEnabled),
    autoPromoteEnabled: Boolean(autoPromoteEnabled),
    createdByClerkId: clerkId,
  }).returning();

  // Insert pools
  if (poolsInput.length > 0) {
    await db.insert(dropinTemplatePoolsTable).values(
      poolsInput.map((p: any, idx: number) => ({
        templateId: template.id,
        courtId: Number(p.courtId),
        cap: Number(p.cap ?? 15),
        price: String(p.price ?? "0"),
        ageGroup: normalizeAgeGroup(p.ageGroup),
        skillLevel: p.skillLevel ?? "all",
        gender: p.gender ?? null,
        earlyBirdPricing: p.earlyBirdPricing ?? null,
        cancellationPhaseOverrides: p.cancellationPhaseOverrides ?? null,
        offerWindowMinutes: Number(p.offerWindowMinutes ?? 240),
        startTime: p.startTime ?? null,
        durationMinutes: p.durationMinutes != null ? Number(p.durationMinutes) : null,
        simplifiedRegistration: Number(p.price ?? 0) > 0 ? false : Boolean(p.simplifiedRegistration ?? false),
        sortOrder: idx,
      }))
    );
  }

  await writeAuditLog({ actorClerkId: clerkId, action: "dropin_template_created", entityType: "dropin_template", entityId: template.id, after: { name, sport, isDraft } });

  const insertedPools = await db.select().from(dropinTemplatePoolsTable).where(eq(dropinTemplatePoolsTable.templateId, template.id));
  res.status(201).json({ ...template, pools: insertedPools });
});

// ─── PATCH /dropin-templates/:id ─────────────────────────────────────────────

router.patch("/dropin-templates/:id", requireAuth, async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req as any);
  if (!clerkId || !(await hasPermission(clerkId, "canManageDropins"))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(dropinTemplatesTable).where(eq(dropinTemplatesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const { scope = "all", forkFromDate, pools: poolsInput, publish, ...updates } = req.body;

  // "from here forward" → fork the template at forkFromDate
  if (scope === "forward" && forkFromDate) {
    const oldRule = existing.recurrenceRule as RecurrenceRule;
    const newRule: RecurrenceRule = {
      ...oldRule,
      ...(updates.recurrenceRule ?? {}),
      startDate: forkFromDate,
      skippedDates: [],
    };

    // Update old template to end the day BEFORE forkFromDate (no overlap)
    const forkDate = new Date(forkFromDate + "T12:00:00Z");
    const dayBefore = new Date(forkDate.getTime() - 86400000);
    const dayBeforeStr = `${dayBefore.getUTCFullYear()}-${String(dayBefore.getUTCMonth() + 1).padStart(2, "0")}-${String(dayBefore.getUTCDate()).padStart(2, "0")}`;
    const updatedOldRule: RecurrenceRule = {
      ...oldRule,
      endCondition: "on_date",
      endDate: dayBeforeStr,
    };
    await db.update(dropinTemplatesTable).set({ recurrenceRule: updatedOldRule, updatedAt: new Date() }).where(eq(dropinTemplatesTable.id, id));

    // Build the set of allowed scalar fields from the payload to merge into the fork
    const scalarFields = ["name", "sport", "venueId", "description", "imageUrl", "staffUserId",
      "autoCancelThreshold", "registrationCutoffMinutes", "registrationOpens", "registrationOpensAt",
      "waitlistEnabled", "autoPromoteEnabled"];
    const mergedUpdates: Record<string, any> = {};
    for (const field of scalarFields) {
      if (field in updates) mergedUpdates[field] = (updates as any)[field];
    }

    // Determine publish state for the fork (default: publish immediately like the original)
    let forkIsDraft = false;
    let forkIsPublished = true;
    let forkPublishAt: Date | null = null;
    if (req.body.isDraft === true) {
      forkIsDraft = true;
      forkIsPublished = false;
    } else if (publish === true) {
      const scheduledAt = req.body.publishAt ? new Date(req.body.publishAt) : null;
      forkPublishAt = scheduledAt;
      forkIsPublished = !scheduledAt || scheduledAt <= new Date();
    }

    // Create forked template (spread existing, then overlay all payload changes)
    const [forked] = await db.insert(dropinTemplatesTable).values({
      ...existing,
      ...mergedUpdates,
      id: undefined as any,
      recurrenceRule: newRule,
      isDraft: forkIsDraft,
      isPublished: forkIsPublished,
      publishAt: forkPublishAt,
      createdByClerkId: clerkId,
      createdAt: undefined as any,
      updatedAt: undefined as any,
    } as any).returning();

    // Copy pools from original to fork (potentially with updates)
    const existingPools = await db.select().from(dropinTemplatePoolsTable).where(eq(dropinTemplatePoolsTable.templateId, id));
    if (existingPools.length > 0) {
      await db.insert(dropinTemplatePoolsTable).values(
        existingPools.map((p) => ({ ...p, id: undefined as any, templateId: forked.id, createdAt: undefined as any, updatedAt: undefined as any } as any))
      );
    }

    // Apply pool updates to forked template if provided
    if (poolsInput) {
      await db.delete(dropinTemplatePoolsTable).where(eq(dropinTemplatePoolsTable.templateId, forked.id));
      if (poolsInput.length > 0) {
        await db.insert(dropinTemplatePoolsTable).values(
          poolsInput.map((p: any, idx: number) => ({
            templateId: forked.id,
            courtId: Number(p.courtId),
            cap: Number(p.cap ?? 15),
            price: String(p.price ?? "0"),
            ageGroup: normalizeAgeGroup(p.ageGroup),
            skillLevel: p.skillLevel ?? "all",
            gender: p.gender ?? null,
            earlyBirdPricing: p.earlyBirdPricing ?? null,
            cancellationPhaseOverrides: p.cancellationPhaseOverrides ?? null,
            offerWindowMinutes: Number(p.offerWindowMinutes ?? 240),
            startTime: p.startTime ?? null,
            durationMinutes: p.durationMinutes != null ? Number(p.durationMinutes) : null,
            simplifiedRegistration: Number(p.price ?? 0) > 0 ? false : Boolean(p.simplifiedRegistration ?? false),
            sortOrder: idx,
          }))
        );
      }
    }

    await writeAuditLog({ actorClerkId: clerkId, action: "dropin_template_forked", entityType: "dropin_template", entityId: forked.id, after: { forkedFrom: id, forkFromDate } });
    const forkedPools = await db.select().from(dropinTemplatePoolsTable).where(eq(dropinTemplatePoolsTable.templateId, forked.id));
    res.json({ ...forked, pools: forkedPools, forkedFrom: id });
    return;
  }

  // "just this session" → handled via override endpoint
  // "all sessions" → mutate template directly
  const updateData: any = {};
  const allowedFields = ["name", "sport", "venueId", "description", "imageUrl", "recurrenceRule", "isDraft", "publishAt", "staffUserId", "autoCancelThreshold", "registrationCutoffMinutes", "registrationOpens", "registrationOpensAt", "waitlistEnabled", "autoPromoteEnabled"];
  for (const field of allowedFields) {
    if (field in updates) updateData[field] = updates[field];
  }
  if (publish === true) {
    updateData.isDraft = false;
    // Honor publishAt: if it's in the future, defer isPublished until the scheduled time
    const scheduledAt = updateData.publishAt ?? (updates as any)?.publishAt ?? null;
    const effectivePublishAt = scheduledAt ? new Date(scheduledAt) : null;
    updateData.isPublished = !effectivePublishAt || effectivePublishAt <= new Date();
  }
  updateData.updatedAt = new Date();

  const [updated] = await db.update(dropinTemplatesTable).set(updateData).where(eq(dropinTemplatesTable.id, id)).returning();

  // Update pools if provided
  if (poolsInput) {
    await db.delete(dropinTemplatePoolsTable).where(eq(dropinTemplatePoolsTable.templateId, id));
    if (poolsInput.length > 0) {
      await db.insert(dropinTemplatePoolsTable).values(
        poolsInput.map((p: any, idx: number) => ({
          templateId: id,
          courtId: Number(p.courtId),
          cap: Number(p.cap ?? 15),
          price: String(p.price ?? "0"),
          ageGroup: normalizeAgeGroup(p.ageGroup),
          skillLevel: p.skillLevel ?? "all",
          gender: p.gender ?? null,
          earlyBirdPricing: p.earlyBirdPricing ?? null,
          cancellationPhaseOverrides: p.cancellationPhaseOverrides ?? null,
          offerWindowMinutes: Number(p.offerWindowMinutes ?? 240),
          startTime: p.startTime ?? null,
          durationMinutes: p.durationMinutes != null ? Number(p.durationMinutes) : null,
          simplifiedRegistration: Number(p.price ?? 0) > 0 ? false : Boolean(p.simplifiedRegistration ?? false),
          sortOrder: idx,
        }))
      );
    }
  }

  await writeAuditLog({ actorClerkId: clerkId, action: "dropin_template_updated", entityType: "dropin_template", entityId: id, before: existing, after: updateData });
  const updatedPools = await db.select().from(dropinTemplatePoolsTable).where(eq(dropinTemplatePoolsTable.templateId, id));
  res.json({ ...updated, pools: updatedPools });
});

// ─── DELETE /dropin-templates/:id ────────────────────────────────────────────

router.delete("/dropin-templates/:id", requireAuth, async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req as any);
  if (!clerkId || !(await hasPermission(clerkId, "canManageDropins"))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  await db.delete(dropinTemplatesTable).where(eq(dropinTemplatesTable.id, id));
  await writeAuditLog({ actorClerkId: clerkId, action: "dropin_template_deleted", entityType: "dropin_template", entityId: id });
  res.json({ ok: true });
});

// ─── POST /dropin-templates/:id/duplicate ────────────────────────────────────

router.post("/dropin-templates/:id/duplicate", requireAuth, async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req as any);
  if (!clerkId || !(await hasPermission(clerkId, "canManageDropins"))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [source] = await db.select().from(dropinTemplatesTable).where(eq(dropinTemplatesTable.id, id));
  if (!source) { res.status(404).json({ error: "Not found" }); return; }

  const [clone] = await db.insert(dropinTemplatesTable).values({
    ...source,
    id: undefined as any,
    name: `${source.name} (Copy)`,
    isDraft: true,
    isPublished: false,
    createdByClerkId: clerkId,
    createdAt: undefined as any,
    updatedAt: undefined as any,
  } as any).returning();

  const sourcePools = await db.select().from(dropinTemplatePoolsTable).where(eq(dropinTemplatePoolsTable.templateId, id));
  if (sourcePools.length > 0) {
    await db.insert(dropinTemplatePoolsTable).values(
      sourcePools.map((p) => ({ ...p, id: undefined as any, templateId: clone.id, createdAt: undefined as any, updatedAt: undefined as any } as any))
    );
  }

  const clonePools = await db.select().from(dropinTemplatePoolsTable).where(eq(dropinTemplatePoolsTable.templateId, clone.id));
  res.status(201).json({ ...clone, pools: clonePools });
});

// ─── PATCH /dropin-templates/:id/pools/:poolId ───────────────────────────────

router.patch("/dropin-templates/:id/pools/:poolId", requireAuth, async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req as any);
  if (!clerkId || !(await hasPermission(clerkId, "canManageDropins"))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const templateId = Number(req.params.id);
  const poolId = Number(req.params.poolId);
  if (isNaN(templateId) || isNaN(poolId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [pool] = await db.select().from(dropinTemplatePoolsTable).where(and(eq(dropinTemplatePoolsTable.id, poolId), eq(dropinTemplatePoolsTable.templateId, templateId)));
  if (!pool) { res.status(404).json({ error: "Pool not found" }); return; }

  const { courtId, cap, price, ageGroup, skillLevel, gender, earlyBirdPricing, cancellationPhaseOverrides, offerWindowMinutes, startTime, durationMinutes: poolDurationMinutes, sortOrder } = req.body;
  const updateData: any = {};
  if (courtId !== undefined) updateData.courtId = Number(courtId);
  if (cap !== undefined) updateData.cap = Number(cap);
  if (price !== undefined) updateData.price = String(price);
  if (ageGroup !== undefined) updateData.ageGroup = normalizeAgeGroup(ageGroup);
  if (skillLevel !== undefined) updateData.skillLevel = String(skillLevel);
  if (gender !== undefined) updateData.gender = gender ?? null;
  if (earlyBirdPricing !== undefined) updateData.earlyBirdPricing = earlyBirdPricing;
  if (cancellationPhaseOverrides !== undefined) updateData.cancellationPhaseOverrides = cancellationPhaseOverrides;
  if (offerWindowMinutes !== undefined) updateData.offerWindowMinutes = Number(offerWindowMinutes);
  if (startTime !== undefined) updateData.startTime = startTime ?? null;
  if (poolDurationMinutes !== undefined) updateData.durationMinutes = poolDurationMinutes != null ? Number(poolDurationMinutes) : null;
  if (sortOrder !== undefined) updateData.sortOrder = Number(sortOrder);
  updateData.updatedAt = new Date();

  const [updated] = await db.update(dropinTemplatePoolsTable).set(updateData).where(eq(dropinTemplatePoolsTable.id, poolId)).returning();
  res.json(updated);
});

// ─── GET /dropin-occurrences (public) ────────────────────────────────────────

router.get("/dropin-occurrences", async (req, res): Promise<void> => {
  const { from, to, sport, limit: limitQ } = req.query as Record<string, string>;
  const fromDate = from ? new Date(from) : new Date();
  const toDate = to ? new Date(to) : new Date(fromDate.getTime() + 45 * 24 * 60 * 60 * 1000);
  const limit = Math.min(Number(limitQ ?? 200), 500);

  const templates = await db
    .select()
    .from(dropinTemplatesTable)
    .where(and(
      eq(dropinTemplatesTable.isPublished, true),
      eq(dropinTemplatesTable.isDraft, false),
      // Respect scheduled publish: hide templates whose publishAt is still in the future
      sql`(${dropinTemplatesTable.publishAt} IS NULL OR ${dropinTemplatesTable.publishAt} <= NOW())`,
    ))
    .orderBy(asc(dropinTemplatesTable.name));

  const filteredTemplates = sport
    ? templates.filter((t) => t.sport === sport)
    : templates;

  if (!filteredTemplates.length) { res.json([]); return; }

  const templateIds = filteredTemplates.map((t) => t.id);
  const allPools = await db
    .select()
    .from(dropinTemplatePoolsTable)
    .where(inArray(dropinTemplatePoolsTable.templateId, templateIds))
    .orderBy(asc(dropinTemplatePoolsTable.sortOrder));

  const poolsByTemplate = new Map<number, any[]>();
  for (const pool of allPools) {
    const arr = poolsByTemplate.get(pool.templateId) ?? [];
    arr.push(pool);
    poolsByTemplate.set(pool.templateId, arr);
  }

  // Compute fill stats for all template pools
  const allPoolIds = allPools.map((p) => p.id);
  const fillStats = await poolFillStats(allPoolIds);
  const enrichedPoolsByTemplate = new Map<number, any[]>();
  for (const [tid, pools] of poolsByTemplate.entries()) {
    enrichedPoolsByTemplate.set(tid, pools.map((p) => ({
      ...p,
      spotsTaken: fillStats.get(p.id)?.spotsTaken ?? 0,
      waitlistCount: fillStats.get(p.id)?.waitlistCount ?? 0,
      registrationOpen: p.registrationOpen ?? true,
    })));
  }

  const occurrences: any[] = [];
  for (const template of filteredTemplates) {
    const pools = enrichedPoolsByTemplate.get(template.id) ?? [];
    const occ = await buildOccurrencesForTemplate(template, pools, { from: fromDate, to: toDate, limit: 50 });
    occurrences.push(...occ);
  }

  occurrences.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

  res.json(occurrences.slice(0, limit));
});

// ─── GET /dropin-occurrences/:templateId/:date ───────────────────────────────

router.get("/dropin-occurrences/:templateId/:date", async (req, res): Promise<void> => {
  const templateId = Number(req.params.templateId);
  const date = req.params.date;
  if (isNaN(templateId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "Invalid templateId or date" });
    return;
  }

  const [template] = await db.select().from(dropinTemplatesTable).where(eq(dropinTemplatesTable.id, templateId));
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }

  // Public endpoint: guard draft/unpublished/future-scheduled templates
  const { userId: clerkIdForDetail } = getAuth(req as any);
  const isAdminViewer = clerkIdForDetail
    ? await hasPermission(clerkIdForDetail, "canManageDropins")
    : false;
  if (!isAdminViewer) {
    const publishedAndLive =
      template.isPublished &&
      !template.isDraft &&
      (!template.publishAt || template.publishAt <= new Date());
    if (!publishedAndLive) { res.status(404).json({ error: "Template not found" }); return; }
  }

  const pools = await db
    .select()
    .from(dropinTemplatePoolsTable)
    .where(eq(dropinTemplatePoolsTable.templateId, templateId))
    .orderBy(asc(dropinTemplatePoolsTable.sortOrder));

  // Use Eastern midnight boundaries so sessions starting after 8 PM EDT / 7 PM EST
  // are not cut off by the next UTC calendar day.
  const dayStartEt = occurrenceDateToUtc(date, "00:00");
  const dayEndEt = new Date(dayStartEt.getTime() + 86_400_000 - 1);
  const occurrences = await buildOccurrencesForTemplate(template, pools, {
    from: dayStartEt,
    to: dayEndEt,
    limit: 1,
  });

  if (!occurrences.length) { res.status(404).json({ error: "Occurrence not found for this date" }); return; }

  // buildOccurrencesForTemplate already computes occurrence-scoped fill stats;
  // do NOT overwrite with template-wide aggregate from poolFillStats().
  const occ = occurrences[0];

  // ── Embed mySpot per pool for authenticated users ─────────────────────────
  const { userId: authedClerkId } = getAuth(req as any);
  if (authedClerkId && occ?.pools?.length) {
    const authedUser = await getDbUserFromClerk(authedClerkId);
    if (authedUser) {
      // Find the materialized dropin for this occurrence (if it exists)
      const [matOcc] = await db.select().from(dropinOccurrencesTable).where(
        and(eq(dropinOccurrencesTable.templateId, templateId), eq(dropinOccurrencesTable.occurrenceDate, date))
      );
      const materializedDropinId = matOcc?.materializedDropinId ?? null;

      if (materializedDropinId) {
        // Map template pool id → legacy court pool
        const courtPools = await db.select().from(dropinCourtPoolsTable).where(
          eq(dropinCourtPoolsTable.dropinId, materializedDropinId)
        );
        // Get user's active spots for this dropin
        const courtPoolIds = courtPools.map((cp) => cp.id);
        const userSpots = courtPoolIds.length > 0
          ? await db.select().from(spotsTable).where(
              and(
                inArray(spotsTable.poolId, courtPoolIds),
                or(
                  eq(spotsTable.userId, authedUser.id),
                  eq(spotsTable.guardianUserId, authedUser.id),
                ),
                eq(spotsTable.entityType, "dropin"),
                eq(spotsTable.entityId, materializedDropinId),
                ne(spotsTable.status, "cancelled"),
              )
            )
          : [];

        // Attach mySpot to each pool by matching templatePoolId on the court pool
        occ.pools = occ.pools.map((p: any) => {
          const legacyPool = courtPools.find((cp) => cp.dropinTemplatePoolId === p.id);
          if (!legacyPool) return p;
          const mySpot = userSpots.find((s: any) => s.poolId === legacyPool.id) ?? null;
          return {
            ...p,
            mySpot,
            legacyPoolId: legacyPool.id,
            cancellationWindowMinutes: (legacyPool as any).cancellationWindowMinutes ?? null,
          };
        });
      }
    }
  }

  res.json(occ);
});

// ─── POST /dropin-occurrences/:templateId/:date/skip ────────────────────────

router.post("/dropin-occurrences/:templateId/:date/skip", requireAuth, async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req as any);
  if (!clerkId || !(await hasPermission(clerkId, "canManageDropins"))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const templateId = Number(req.params.templateId);
  const date = req.params.date;
  if (isNaN(templateId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "Invalid templateId or date" });
    return;
  }

  const [template] = await db.select().from(dropinTemplatesTable).where(eq(dropinTemplatesTable.id, templateId));
  if (!template) { res.status(404).json({ error: "Not found" }); return; }

  const rule = template.recurrenceRule as RecurrenceRule;
  const { unskip } = req.body;
  let skippedDates: string[] = rule.skippedDates ?? [];

  if (unskip) {
    skippedDates = skippedDates.filter((d) => d !== date);
  } else if (!skippedDates.includes(date)) {
    skippedDates = [...skippedDates, date];
  }

  const updatedRule: RecurrenceRule = { ...rule, skippedDates };
  await db.update(dropinTemplatesTable).set({ recurrenceRule: updatedRule, updatedAt: new Date() }).where(eq(dropinTemplatesTable.id, templateId));

  // Also update materialized occurrence if it exists
  const [mat] = await db.select().from(dropinOccurrencesTable).where(and(eq(dropinOccurrencesTable.templateId, templateId), eq(dropinOccurrencesTable.occurrenceDate, date)));
  if (mat) {
    await db.update(dropinOccurrencesTable).set({ status: unskip ? "upcoming" : "skipped", updatedAt: new Date() }).where(eq(dropinOccurrencesTable.id, mat.id));
  }

  res.json({ ok: true, skippedDates, unskipped: Boolean(unskip) });
});

// ─── POST /dropin-occurrences/:templateId/:date/override ────────────────────

router.post("/dropin-occurrences/:templateId/:date/override", requireAuth, async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req as any);
  if (!clerkId || !(await hasPermission(clerkId, "canManageDropins"))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const templateId = Number(req.params.templateId);
  const date = req.params.date;
  if (isNaN(templateId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "Invalid templateId or date" });
    return;
  }

  const { field, value, templatePoolId, cancel, cancelReason } = req.body;

  // Materialize the occurrence if it doesn't exist
  let [occurrence] = await db.select().from(dropinOccurrencesTable).where(
    and(eq(dropinOccurrencesTable.templateId, templateId), eq(dropinOccurrencesTable.occurrenceDate, date))
  );

  if (!occurrence) {
    const [inserted] = await db.insert(dropinOccurrencesTable).values({
      templateId,
      occurrenceDate: date,
      status: cancel ? "cancelled" : "upcoming",
      cancelledReason: cancel ? (cancelReason ?? null) : null,
    }).returning();
    occurrence = inserted;
  } else if (cancel) {
    await db.update(dropinOccurrencesTable).set({ status: "cancelled", cancelledReason: cancelReason ?? null, updatedAt: new Date() }).where(eq(dropinOccurrencesTable.id, occurrence.id));
    res.json({ ok: true, cancelled: true });
    return;
  }

  if (!cancel && field && value !== undefined) {
    // Upsert override (delete existing for same field/pool, then insert)
    await db.delete(dropinOccurrenceOverridesTable).where(and(
      eq(dropinOccurrenceOverridesTable.occurrenceId, occurrence.id),
      eq(dropinOccurrenceOverridesTable.field, field),
      ...(templatePoolId ? [eq(dropinOccurrenceOverridesTable.templatePoolId, Number(templatePoolId))] : []),
    ));
    await db.insert(dropinOccurrenceOverridesTable).values({
      occurrenceId: occurrence.id,
      templatePoolId: templatePoolId ? Number(templatePoolId) : null,
      field: String(field),
      value: value,
    });
  }

  res.json({ ok: true, occurrenceId: occurrence.id });
});

// ─── POST /dropin-occurrences/:templateId/:date/pools/:poolId/rsvp ────────────
// Materialize occurrence on first RSVP; create a spot using the legacy dropin entity type.

router.post("/dropin-occurrences/:templateId/:date/pools/:poolId/rsvp", requireAuth, async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req as any);
  if (!clerkId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const templateId = Number(req.params.templateId);
  const date = req.params.date;
  const templatePoolId = Number(req.params.poolId);
  if (isNaN(templateId) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(templatePoolId)) {
    res.status(400).json({ error: "Invalid params" }); return;
  }

  const [template] = await db.select().from(dropinTemplatesTable).where(eq(dropinTemplatesTable.id, templateId));
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  if (template.isDraft || !template.isPublished) { res.status(403).json({ error: "Session not published" }); return; }

  const [templatePool] = await db.select().from(dropinTemplatePoolsTable).where(
    and(eq(dropinTemplatePoolsTable.id, templatePoolId), eq(dropinTemplatePoolsTable.templateId, templateId))
  );
  if (!templatePool) { res.status(404).json({ error: "Pool not found" }); return; }

  // Validate that the date falls on the template's recurrence schedule
  // (allow if an occurrence row already exists for idempotency, e.g. after rule edits)
  const ruleForCheck = template.recurrenceRule as RecurrenceRule;
  const dayMs = 24 * 60 * 60 * 1000;
  const checkMid = new Date(date + "T12:00:00Z");
  const scheduledDates = computeOccurrenceDates(ruleForCheck, {
    from: new Date(checkMid.getTime() - dayMs),
    to: new Date(checkMid.getTime() + dayMs),
    limit: 5,
  });
  if (!scheduledDates.includes(date)) {
    const [existingOcc] = await db.select().from(dropinOccurrencesTable).where(
      and(eq(dropinOccurrencesTable.templateId, templateId), eq(dropinOccurrencesTable.occurrenceDate, date))
    );
    if (!existingOcc) {
      res.status(400).json({ error: "Date is not on the schedule for this template" }); return;
    }
  }

  // Check if registration is closed via occurrence override
  const occRows = await db.select().from(dropinOccurrencesTable).where(
    and(eq(dropinOccurrencesTable.templateId, templateId), eq(dropinOccurrencesTable.occurrenceDate, date))
  );
  if (occRows[0]) {
    const overrides = await db.select().from(dropinOccurrenceOverridesTable).where(
      and(
        eq(dropinOccurrenceOverridesTable.occurrenceId, occRows[0].id),
        eq(dropinOccurrenceOverridesTable.field, "registrationOpen"),
        ...(templatePoolId ? [eq(dropinOccurrenceOverridesTable.templatePoolId, templatePoolId)] : []),
      )
    );
    const regOpenOverride = overrides[0];
    if (regOpenOverride && regOpenOverride.value === false) {
      res.status(400).json({ error: "Registration closed for this pool" }); return;
    }
  }

  const rule = template.recurrenceRule as RecurrenceRule;
  // Use pool-level startTime override if set; fall back to session-level rule
  const effectivePoolStartTime = (templatePool as any).startTime ?? rule.startTime;
  const startsAt = occurrenceDateToUtc(date, effectivePoolStartTime);
  const now = new Date();

  // Enforce template-level registration-open window
  const regOpens: string = template.registrationOpens ?? "immediately";
  if (regOpens === "on_date") {
    const opensAt = template.registrationOpensAt ? new Date(template.registrationOpensAt) : null;
    if (!opensAt || now < opensAt) {
      res.status(400).json({ error: "Registration is not open yet", opensAt: opensAt?.toISOString() ?? null });
      return;
    }
  } else if (regOpens === "manual") {
    // manual → registration is closed unless a positive registrationOpen override exists for this pool
    if (occRows[0]) {
      const poolOpenOverrides = await db.select().from(dropinOccurrenceOverridesTable).where(
        and(
          eq(dropinOccurrenceOverridesTable.occurrenceId, occRows[0].id),
          eq(dropinOccurrenceOverridesTable.field, "registrationOpen"),
          eq(dropinOccurrenceOverridesTable.templatePoolId, templatePoolId),
        )
      );
      const isManuallyOpened = poolOpenOverrides.some((o) => o.value === true);
      if (!isManuallyOpened) {
        res.status(400).json({ error: "Registration is not yet open for this pool" });
        return;
      }
    } else {
      res.status(400).json({ error: "Registration is not yet open for this pool" });
      return;
    }
  }

  // Enforce registration cutoff (how many minutes before startsAt registration closes)
  if (template.registrationCutoffMinutes) {
    const cutoffMs = Number(template.registrationCutoffMinutes) * 60 * 1000;
    if (now.getTime() > startsAt.getTime() - cutoffMs) {
      res.status(400).json({ error: "Registration has closed — cutoff time has passed" });
      return;
    }
  }

  // Materialize dropin_occurrences row
  let [occurrence] = await db.select().from(dropinOccurrencesTable).where(
    and(eq(dropinOccurrencesTable.templateId, templateId), eq(dropinOccurrencesTable.occurrenceDate, date))
  );
  if (!occurrence) {
    [occurrence] = await db.insert(dropinOccurrencesTable).values({
      templateId, occurrenceDate: date, status: "upcoming",
    }).returning();
  }
  if (occurrence.status === "cancelled") { res.status(400).json({ error: "Session cancelled" }); return; }

  // Materialize legacy dropin row (keyed by templateId + startsAt)
  let [dropin] = await db.select().from(dropinsTable).where(
    and(eq(dropinsTable.templateId, templateId), sql`starts_at = ${startsAt.toISOString()}::timestamptz`)
  );
  if (!dropin) {
    [dropin] = await db.insert(dropinsTable).values({
      name: template.name,
      ageGroup: templatePool.ageGroup as string[],
      courtId: templatePool.courtId,
      startsAt,
      durationMinutes: (templatePool as any).durationMinutes ?? rule.durationMinutes ?? 120,
      price: String(templatePool.price ?? "0"),
      registrationOpen: true,
      status: "upcoming",
      templateId: template.id,
      description: template.description ?? null,
      imageUrl: template.imageUrl ?? null,
      isPublished: true,
    }).returning();
  }

  // Back-link the occurrence to its materialized dropin (idempotent)
  if (occurrence.materializedDropinId !== dropin.id) {
    await db.update(dropinOccurrencesTable)
      .set({ materializedDropinId: dropin.id, updatedAt: new Date() })
      .where(eq(dropinOccurrencesTable.id, occurrence.id));
    occurrence = { ...occurrence, materializedDropinId: dropin.id };
  }

  // Count existing non-waitlisted spots for this dropin to evaluate early-bird trigger
  const [spotCountRow] = await db.select({ count: sql<string>`count(*)` }).from(spotsTable).where(
    and(
      eq(spotsTable.entityType, "dropin"),
      eq(spotsTable.entityId, dropin.id),
      eq(spotsTable.status, "reserved"),
      eq(spotsTable.waitlisted, false),
    )
  );
  const currentSpotsTaken = Number(spotCountRow?.count ?? 0);
  const effectivePrice = computeEffectivePrice(templatePool, now, currentSpotsTaken);

  // Materialize legacy dropin_court_pools row keyed by (dropinId, dropinTemplatePoolId)
  // so that two pools on the same court remain distinct inventory buckets.
  let [courtPool] = await db.select().from(dropinCourtPoolsTable).where(
    and(
      eq(dropinCourtPoolsTable.dropinId, dropin.id),
      eq(dropinCourtPoolsTable.dropinTemplatePoolId, templatePool.id),
    )
  );
  if (!courtPool) {
    [courtPool] = await db.insert(dropinCourtPoolsTable).values({
      dropinId: dropin.id,
      courtId: templatePool.courtId,
      dropinTemplatePoolId: templatePool.id,
      ageGroup: templatePool.ageGroup as string[],
      skillLevel: templatePool.skillLevel ?? "all",
      cap: templatePool.cap,
      price: effectivePrice,
      registrationOpen: true,
      startsAt,
      durationMinutes: (templatePool as any).durationMinutes ?? rule.durationMinutes ?? 120,
      offerWindowMinutes: templatePool.offerWindowMinutes ?? 240,
      gender: templatePool.gender ?? null,
      simplifiedRegistration: (templatePool as any).simplifiedRegistration ?? false,
    }).returning();
  }

  // ── Resolve caller identity + participant (shared by paid and free paths) ────
  const user = await getDbUserFromClerk(clerkId);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const rawParticipantId = req.body.participantUserId;
  const playerUserId = rawParticipantId ? Number(rawParticipantId) : user.id;
  let guardianUserIdForSpot: number | null = null;

  if (playerUserId !== user.id) {
    const isAdminReg = await hasPermission(clerkId, "canManageDropins");
    if (!isAdminReg) {
      const [guardianLink] = await db.select().from(guardiansTable).where(
        and(
          eq(guardiansTable.guardianUserId, user.id),
          eq(guardiansTable.youthUserId, playerUserId),
          eq(guardiansTable.canRegister, true),
          eq(guardiansTable.status, "approved"),
        )
      );
      if (!guardianLink) {
        res.status(403).json({ error: "Not authorized to register for this participant" });
        return;
      }
    }
    guardianUserIdForSpot = user.id;
  }

  // ── Age eligibility check (applies to both paid and free) ────────────────────
  const [playerUser] = await db.select().from(usersTable).where(eq(usersTable.id, playerUserId));
  if (!playerUser) { res.status(404).json({ error: "Player not found" }); return; }
  if (templatePool.ageGroup && Array.isArray(templatePool.ageGroup) && templatePool.ageGroup.length > 0) {
    const ageCheckDate = courtPool.startsAt ?? startsAt;
    const waivedGroups = await getPlayerWaivedGroups(playerUserId);
    const ageError = checkUsysAgeEligibility(templatePool.ageGroup as string[], playerUser.dateOfBirth, ageCheckDate, waivedGroups);
    if (ageError) { res.status(422).json({ error: ageError }); return; }
  }

  // ── Duplicate-registration guard ─────────────────────────────────────────────
  const [existingSpot] = await db.select().from(spotsTable).where(
    and(
      eq(spotsTable.poolId, courtPool.id),
      eq(spotsTable.entityType, "dropin"),
      eq(spotsTable.entityId, dropin.id),
      eq(spotsTable.userId, playerUserId),
      ne(spotsTable.status, "cancelled"),
    )
  );
  if (existingSpot) { res.status(409).json({ error: "Already registered", spot: existingSpot }); return; }

  // ── Capacity check ───────────────────────────────────────────────────────────
  const [takenRow] = await db.select({ count: sql<string>`count(*)` }).from(spotsTable).where(
    and(
      eq(spotsTable.poolId, courtPool.id),
      eq(spotsTable.entityType, "dropin"),
      eq(spotsTable.entityId, dropin.id),
      eq(spotsTable.waitlisted, false),
      ne(spotsTable.status, "cancelled"),
    )
  );
  const taken = Number(takenRow?.count ?? 0);
  const isFull = taken >= courtPool.cap;

  // ── Paid pool: apply discounts/credits then create Stripe session inline ──────
  if (Number(effectivePrice) > 0) {
    if (isFull) {
      res.status(409).json({ error: "Pool is full — join the waitlist instead" });
      return;
    }

    const discountCode = req.body.discountCode as string | undefined;
    const useCredits = Boolean(req.body.useCredits);

    // Apply discount code
    let discountAmount = 0;
    let discountCodeId: number | null = null;
    if (discountCode) {
      const [dc] = await db.select().from(discountCodesTable).where(
        and(eq(discountCodesTable.code, discountCode.toUpperCase()), eq(discountCodesTable.isActive, true))
      );
      if (!dc) { res.status(400).json({ error: "Invalid or inactive discount code" }); return; }
      if (dc.maxUses != null && dc.timesUsed >= dc.maxUses) { res.status(400).json({ error: "Discount code has reached its usage limit" }); return; }
      const dcNow = new Date();
      if (dc.validFrom && new Date(dc.validFrom) > dcNow) { res.status(400).json({ error: "Discount code is not yet active" }); return; }
      if (dc.validUntil && new Date(dc.validUntil) < dcNow) { res.status(400).json({ error: "Discount code has expired" }); return; }
      const base = Number(effectivePrice);
      if ((dc as any).minOrderAmount && base < Number((dc as any).minOrderAmount)) {
        res.status(400).json({ error: `Minimum order amount of $${(dc as any).minOrderAmount} required` }); return;
      }
      // applicableTo gate: "all" | "league" | "camp" | "drop_in" | "tournament" | "specific"
      if (dc.applicableTo !== "all") {
        const typeGates = ["league", "camp", "drop_in", "tournament"];
        if (typeGates.includes(dc.applicableTo as string) && dc.applicableTo !== "drop_in") {
          res.status(400).json({ error: `Discount code is only valid for ${(dc.applicableTo as string).replace("_", " ")} registrations` }); return;
        }
        if (dc.applicableTo === "specific") {
          if ((dc as any).entityType && (dc as any).entityType !== "drop_in") {
            res.status(400).json({ error: "Discount code not applicable to this offering type" }); return;
          }
          if ((dc as any).entityId && (dc as any).entityId !== dropin.id) {
            res.status(400).json({ error: "Discount code not applicable to this specific offering" }); return;
          }
        }
      }
      discountAmount = dc.discountType === "percent"
        ? Math.round(base * (Number(dc.discountValue) / 100) * 100) / 100
        : Math.min(Number(dc.discountValue), base);
      discountCodeId = dc.id;
    }
    const discountedPrice = Math.max(0, Number(effectivePrice) - discountAmount);

    // Reserve account credits (conditional update pattern — race-safe)
    let creditApplied = 0;
    const reservedCreditIds: Array<{ id: number; consumed: number }> = [];
    if (useCredits) {
      const creditsNow = new Date();
      const credits = await db.select().from(accountCreditsTable).where(and(
        eq(accountCreditsTable.userId, user.id),
        or(isNull(accountCreditsTable.expiresAt), gt(accountCreditsTable.expiresAt, creditsNow)),
        sql`${accountCreditsTable.remainingAmount} > 0`,
      ));
      let toApply = discountedPrice;
      for (const credit of credits) {
        if (toApply <= 0) break;
        const avail = Number(credit.remainingAmount);
        if (avail <= 0) continue;
        const consume = Math.min(avail, toApply);
        const updated = await db.update(accountCreditsTable)
          .set({ remainingAmount: String(avail - consume), usedAt: new Date(), updatedAt: new Date() } as any)
          .where(and(eq(accountCreditsTable.id, credit.id), sql`${accountCreditsTable.remainingAmount} >= ${String(consume)}`))
          .returning();
        if (updated.length > 0) {
          reservedCreditIds.push({ id: credit.id, consumed: consume });
          creditApplied += consume;
          toApply -= consume;
        }
      }
    }
    const priceAfterCredits = Math.max(0, discountedPrice - creditApplied);

    const feeSplit = await computeRevenueSplit({
      entityType: "drop_in",
      entityId: dropin.id,
      category: "drop_in",
      grossAmount: priceAfterCredits,
      paymentMethod: "card",
    });
    const serviceFeeAmount = feeSplit.serviceFeeAmount;
    const totalAmount = priceAfterCredits + serviceFeeAmount;

    // Credit-only path: credits cover the full cost — no Stripe needed
    if (totalAmount <= 0 && creditApplied > 0) {
      const [spot] = await db.insert(spotsTable).values({
        entityType: "dropin",
        entityId: dropin.id,
        poolId: courtPool.id,
        userId: playerUserId,
        guardianUserId: guardianUserIdForSpot,
        status: "reserved",
        paymentStatus: "paid_inapp",
        waitlisted: false,
        waitlistPosition: null,
        confirmedAt: new Date(),
      } as any).returning();
      sendRegistrationConfirmationEmail({
        recipientUserId: guardianUserIdForSpot ?? playerUserId,
        playerUserId,
        entityType: "drop_in",
        entityId: dropin.id,
        poolId: courtPool.id,
        amountPaid: creditApplied,
      }).catch((err: any) => console.error("[dropin-template RSVP] confirmation email failed:", err));
      res.status(201).json({ spot, creditOnly: true, creditApplied, legacyPoolId: courtPool.id, legacyDropinId: dropin.id });
      return;
    }

    const stripe = await getUncachableStripeClient();
    const pubKey = await getStripePublishableKey();

    const sharedMeta: Record<string, string> = {
      clerkUserId: clerkId,
      programType: "drop_in",
      programId: String(dropin.id),
      poolId: String(courtPool.id),
      basePrice: String(priceAfterCredits),
      serviceFeeAmount: String(serviceFeeAmount),
      category: "drop_in",
      creditApplied: String(creditApplied),
      reservedCreditIds: JSON.stringify(reservedCreditIds),
      discountCodeId: discountCodeId != null ? String(discountCodeId) : "",
    };
    if (guardianUserIdForSpot) {
      sharedMeta.guardianUserId = String(guardianUserIdForSpot);
      sharedMeta.playerUserId = String(playerUserId);
    }

    const origin = (req.headers.origin ?? req.headers.referer ?? "https://playon.replit.app").replace(/\/$/, "");
    const lineItems: any[] = [{
      price_data: { currency: "usd", product_data: { name: dropin.name }, unit_amount: Math.round(priceAfterCredits * 100) },
      quantity: 1,
    }];
    if (serviceFeeAmount > 0) {
      lineItems.push({
        price_data: { currency: "usd", product_data: { name: "Processing fee" }, unit_amount: Math.round(serviceFeeAmount * 100) },
        quantity: 1,
      });
    }

    let session: any;
    let clientSecret: string;
    try {
      session = await (stripe.checkout.sessions.create as any)({
        mode: "payment",
        ui_mode: "custom",
        return_url: `${origin}/checkout/complete?session_id={CHECKOUT_SESSION_ID}`,
        line_items: lineItems,
        metadata: sharedMeta,
        customer_email: user.email ?? undefined,
        payment_intent_data: { receipt_email: user.email ?? undefined, metadata: sharedMeta },
      });
      clientSecret = session.client_secret as string;
      if (!clientSecret) throw new Error("Stripe checkout session did not return a client secret");

      // Insert pending payment row so webhook credit-restoration and
      // payment-reconciliation logic can find this session by providerPaymentId.
      await db.insert(paymentsTable).values({
        userId: user.id,
        entityType: "drop_in",
        entityId: dropin.id,
        amount: String(totalAmount),
        currency: "usd",
        status: "pending",
        provider: "stripe",
        providerPaymentId: session.id,
        paymentMethod: "card",
        serviceFeeAmount: String(serviceFeeAmount),
        metadata: JSON.stringify({ checkoutSessionId: session.id, discountCodeId, creditApplied, reservedCreditIds }),
      } as any);
    } catch (stripeErr: any) {
      // Restore any pre-reserved credits so they aren't stranded
      if (reservedCreditIds.length > 0) {
        await restoreReservedCredits(JSON.stringify(reservedCreditIds)).catch(() => {});
      }
      throw stripeErr;
    }

    try {
      await db.insert(spotsTable).values({
        entityType: "dropin",
        entityId: dropin.id,
        poolId: courtPool.id,
        userId: playerUserId,
        guardianUserId: guardianUserIdForSpot,
        status: "reserved",
        paymentStatus: "payment_pending",
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        waitlisted: false,
        waitlistPosition: null,
        confirmedAt: null,
        notes: `cs:${session.id}`,
      } as any);
    } catch (err: any) {
      // Race: spot already exists — restore credits and void the pending Stripe session
      if (reservedCreditIds.length > 0) {
        await restoreReservedCredits(JSON.stringify(reservedCreditIds)).catch(() => {});
      }
      try { await (stripe.checkout.sessions.expire as any)(session.id); } catch { /* best-effort */ }
      await db.update(paymentsTable).set({ status: "failed" } as any).where(eq(paymentsTable.providerPaymentId, session.id));
      if (err?.code === "23505") {
        res.status(409).json({ error: "Already registered", message: "This player already has an active spot for this pool" });
        return;
      }
      throw err;
    }

    res.json({
      paid: true,
      clientSecret,
      publishableKey: pubKey,
      amount: totalAmount,
      basePrice: priceAfterCredits,
      serviceFeeAmount,
      legacyPoolId: courtPool.id,
      legacyDropinId: dropin.id,
    });
    return;
  }

  // ── Free pool: direct registration ───────────────────────────────────────────
  if (isFull && template.waitlistEnabled === false) {
    res.status(400).json({ error: "Pool is full and waitlist is not available for this session" });
    return;
  }

  let waitlistPosition: number | null = null;
  if (isFull) {
    const [wlRow] = await db.select({ count: sql<string>`count(*)` }).from(spotsTable).where(
      and(
        eq(spotsTable.poolId, courtPool.id),
        eq(spotsTable.entityType, "dropin"),
        eq(spotsTable.entityId, dropin.id),
        eq(spotsTable.waitlisted, true),
        ne(spotsTable.status, "cancelled"),
      )
    );
    waitlistPosition = Number(wlRow?.count ?? 0) + 1;
  }

  const [spot] = await db.insert(spotsTable).values({
    entityType: "dropin",
    entityId: dropin.id,
    poolId: courtPool.id,
    userId: playerUserId,
    guardianUserId: guardianUserIdForSpot,
    status: "reserved",
    paymentStatus: "free",
    waitlisted: isFull,
    waitlistPosition,
    confirmedAt: isFull ? null : new Date(),
  } as any).returning();

  if (!isFull) {
    sendRegistrationConfirmationEmail({
      recipientUserId: guardianUserIdForSpot ?? playerUserId,
      playerUserId,
      entityType: "drop_in",
      entityId: dropin.id,
      poolId: courtPool.id,
      amountPaid: 0,
    }).catch((err: any) => console.error("[dropin-template RSVP] confirmation email failed:", err));
  }

  res.status(201).json({ spot, legacyPoolId: courtPool.id, legacyDropinId: dropin.id });
});

// ─── GET /dropin-presets ──────────────────────────────────────────────────────

router.get("/dropin-presets", requireAuth, async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req as any);
  if (!clerkId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const user = await getDbUserFromClerk(clerkId);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const presets = await db.select().from(dropinPoolPresetsTable).where(eq(dropinPoolPresetsTable.createdByUserId, user.id)).orderBy(asc(dropinPoolPresetsTable.name));
  res.json(presets);
});

// ─── POST /dropin-presets ─────────────────────────────────────────────────────

router.post("/dropin-presets", requireAuth, async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req as any);
  if (!clerkId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const user = await getDbUserFromClerk(clerkId);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const { name, config } = req.body;
  if (!name || !config) { res.status(400).json({ error: "name and config required" }); return; }

  const [preset] = await db.insert(dropinPoolPresetsTable).values({
    createdByUserId: user.id,
    name: String(name),
    config,
  }).returning();

  res.status(201).json(preset);
});

// ─── DELETE /dropin-presets/:id ───────────────────────────────────────────────

router.delete("/dropin-presets/:id", requireAuth, async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req as any);
  if (!clerkId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const user = await getDbUserFromClerk(clerkId);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  await db.delete(dropinPoolPresetsTable).where(and(eq(dropinPoolPresetsTable.id, id), eq(dropinPoolPresetsTable.createdByUserId, user.id)));
  res.json({ ok: true });
});

// ─── GET /courts/:courtId/conflicts ──────────────────────────────────────────

router.get("/courts/:courtId/conflicts", requireAuth, async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req as any);
  if (!clerkId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const courtId = Number(req.params.courtId);
  const { startsAt, duration } = req.query as Record<string, string>;
  if (!startsAt || !duration) { res.status(400).json({ error: "startsAt and duration required" }); return; }

  const startUtc = new Date(startsAt);
  const endUtc = new Date(startUtc.getTime() + Number(duration) * 60 * 1000);

  // Check dropin_court_pools for conflicts
  const conflicts = await db.execute<{ id: number; dropin_id: number; starts_at: string }>(sql`
    SELECT p.id, p.dropin_id, p.starts_at::text
    FROM dropin_court_pools p
    WHERE p.court_id = ${courtId}
      AND p.starts_at IS NOT NULL
      AND p.starts_at < ${endUtc.toISOString()}::timestamptz
      AND (p.starts_at + (p.duration_minutes * INTERVAL '1 minute')) > ${startUtc.toISOString()}::timestamptz
    LIMIT 5
  `);

  const rows: any[] = Array.isArray(conflicts) ? conflicts : (conflicts as any).rows ?? [];
  res.json({ hasConflict: rows.length > 0, conflicts: rows });
});

export default router;
