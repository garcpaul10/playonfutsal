import { Router, type IRouter } from "express";
import { db, leaguesTable, campsTable, dropinsTable, tournamentsTable, dropinCourtPoolsTable, spotsTable, dropinTemplatesTable, dropinTemplatePoolsTable, dropinOccurrencesTable, kotcSeasonsTable, kotcTeamsTable } from "@workspace/db";
import { eq, and, inArray, isNull, isNotNull, ne, sql, count } from "drizzle-orm";
import { ListProgramsQueryParams, ListFeaturedProgramsResponse, ListProgramsResponse } from "@workspace/api-zod";
import { requireAdmin, requirePermission, requireAnyPermission } from "../middlewares/auth.js";
import type { AuthedRequest } from "../middlewares/auth.js";
import { occurrenceDateToUtc } from "../services/dropinOccurrenceService.js";

const router: IRouter = Router();

const normalizeAgeGroup = (raw: unknown): string[] => {
  if (Array.isArray(raw)) return (raw as string[]).filter((v) => typeof v === "string" && v.length > 0);
  if (typeof raw === "string" && raw.length > 0) return [raw];
  return ["adult"];
};

/**
 * For a list of dropin IDs, returns a map of dropinId → { spotsTotal, spotsTaken }.
 * Sums across all pools for each dropin. Returns nothing for dropins that have no pools
 * (caller should use a flat spot count from the spots table as the fallback spotsTaken).
 */
interface DropinPoolAggregate {
  spotsTotal: number;
  spotsTaken: number;
  ageGroups: string[];
  earliestStartsAt: Date | null;
  latestStartsAt: Date | null;
  minPrice: number | null;
  maxPrice: number | null;
}

async function dropinPoolAggregates(dropinIds: number[]): Promise<Map<number, DropinPoolAggregate>> {
  const result = new Map<number, DropinPoolAggregate>();
  if (!dropinIds.length) return result;

  // Step 1: get all pools for these dropins (include ageGroup and startsAt)
  const pools = await db
    .select({
      id: dropinCourtPoolsTable.id,
      dropinId: dropinCourtPoolsTable.dropinId,
      cap: dropinCourtPoolsTable.cap,
      ageGroup: dropinCourtPoolsTable.ageGroup,
      startsAt: dropinCourtPoolsTable.startsAt,
      price: dropinCourtPoolsTable.price,
    })
    .from(dropinCourtPoolsTable)
    .where(inArray(dropinCourtPoolsTable.dropinId, dropinIds));

  if (!pools.length) return result;

  // Step 2: get confirmed (non-waitlisted) spot counts per pool
  const poolIds = pools.map((p) => p.id);
  const spotRows = await db
    .select({ poolId: spotsTable.poolId, count: sql<number>`count(*)` })
    .from(spotsTable)
    .where(
      and(
        inArray(spotsTable.poolId, poolIds),
        eq(spotsTable.status, "reserved"),
        eq(spotsTable.waitlisted, false),
        ne(spotsTable.paymentStatus, "payment_pending"),
      )
    )
    .groupBy(spotsTable.poolId);

  const spotsByPool = new Map<number, number>();
  for (const row of spotRows) {
    spotsByPool.set(row.poolId!, Number(row.count));
  }

  // Step 3: aggregate per dropin (spots, age groups, time range)
  for (const pool of pools) {
    const did = pool.dropinId!;
    const existing = result.get(did) ?? { spotsTotal: 0, spotsTaken: 0, ageGroups: [], earliestStartsAt: null, latestStartsAt: null, minPrice: null, maxPrice: null };
    existing.spotsTotal += pool.cap ?? 0;
    existing.spotsTaken += spotsByPool.get(pool.id) ?? 0;

    const poolAgeGroups: string[] = Array.isArray(pool.ageGroup) ? (pool.ageGroup as string[]) : [];
    for (const ag of poolAgeGroups) {
      if (!existing.ageGroups.includes(ag)) existing.ageGroups.push(ag);
    }

    if (pool.startsAt) {
      if (!existing.earliestStartsAt || pool.startsAt < existing.earliestStartsAt) existing.earliestStartsAt = pool.startsAt;
      if (!existing.latestStartsAt || pool.startsAt > existing.latestStartsAt) existing.latestStartsAt = pool.startsAt;
    }

    const poolPrice = Number(pool.price ?? 0);
    if (existing.minPrice === null || poolPrice < existing.minPrice) existing.minPrice = poolPrice;
    if (existing.maxPrice === null || poolPrice > existing.maxPrice) existing.maxPrice = poolPrice;

    result.set(did, existing);
  }

  return result;
}

interface DropinTemplatePoolAggregate {
  spotsTotal: number;
  spotsConfirmed: number;
  ageGroups: string[];
  gender: string | null;
  minPrice: number;
}

async function dropinTemplatePoolAggregates(templateIds: number[]): Promise<Map<number, DropinTemplatePoolAggregate>> {
  const result = new Map<number, DropinTemplatePoolAggregate>();
  if (!templateIds.length) return result;

  // 1. Fetch all template pools
  const pools = await db
    .select({
      id: dropinTemplatePoolsTable.id,
      templateId: dropinTemplatePoolsTable.templateId,
      cap: dropinTemplatePoolsTable.cap,
      price: dropinTemplatePoolsTable.price,
      ageGroup: dropinTemplatePoolsTable.ageGroup,
      gender: dropinTemplatePoolsTable.gender,
    })
    .from(dropinTemplatePoolsTable)
    .where(inArray(dropinTemplatePoolsTable.templateId, templateIds));

  // 2. Fetch materialized dropin IDs from non-cancelled occurrences
  const occurrenceRows = await db
    .select({
      templateId: dropinOccurrencesTable.templateId,
      materializedDropinId: dropinOccurrencesTable.materializedDropinId,
    })
    .from(dropinOccurrencesTable)
    .where(
      and(
        inArray(dropinOccurrencesTable.templateId, templateIds),
        ne(dropinOccurrencesTable.status, "cancelled"),
        isNotNull(dropinOccurrencesTable.materializedDropinId),
      )
    );

  // Group materialized dropin IDs by templateId
  const materializedByTemplate = new Map<number, number[]>();
  for (const row of occurrenceRows) {
    if (row.materializedDropinId === null) continue;
    const arr = materializedByTemplate.get(row.templateId) ?? [];
    arr.push(row.materializedDropinId);
    materializedByTemplate.set(row.templateId, arr);
  }

  // 3. Count confirmed spots for all materialized dropin IDs
  const allMaterializedIds = occurrenceRows
    .map((r) => r.materializedDropinId)
    .filter((id): id is number => id !== null);

  const spotsByDropin = new Map<number, number>();
  if (allMaterializedIds.length) {
    const spotRows = await db
      .select({ entityId: spotsTable.entityId, count: sql<number>`count(*)` })
      .from(spotsTable)
      .where(
        and(
          eq(spotsTable.entityType, "dropin"),
          inArray(spotsTable.entityId, allMaterializedIds),
          eq(spotsTable.status, "reserved"),
          eq(spotsTable.waitlisted, false),
          ne(spotsTable.paymentStatus, "payment_pending"),
        )
      )
      .groupBy(spotsTable.entityId);
    for (const row of spotRows) {
      if (row.entityId !== null) spotsByDropin.set(row.entityId, Number(row.count));
    }
  }

  // 4. Aggregate per template from pool rows
  for (const pool of pools) {
    const tid = pool.templateId;
    const existing = result.get(tid) ?? { spotsTotal: 0, spotsConfirmed: 0, ageGroups: [], gender: null, minPrice: Infinity };
    existing.spotsTotal += pool.cap ?? 0;
    const poolAgeGroups: string[] = Array.isArray(pool.ageGroup)
      ? (pool.ageGroup as string[])
      : typeof pool.ageGroup === "string" && pool.ageGroup
        ? pool.ageGroup.split(",").map((g: string) => g.trim())
        : [];
    for (const ag of poolAgeGroups) {
      if (!existing.ageGroups.includes(ag)) existing.ageGroups.push(ag);
    }
    if (!existing.gender && pool.gender) existing.gender = pool.gender;
    const poolPrice = Number(pool.price ?? 0);
    if (poolPrice < existing.minPrice) existing.minPrice = poolPrice;
    result.set(tid, existing);
  }

  // 5. Sum confirmed spots per template via materialized dropin IDs
  for (const [tid, materializedIds] of materializedByTemplate) {
    const agg = result.get(tid);
    if (!agg) continue;
    for (const mid of materializedIds) {
      agg.spotsConfirmed += spotsByDropin.get(mid) ?? 0;
    }
  }

  // Fix Infinity for templates with no pools
  for (const [, agg] of result) {
    if (agg.minPrice === Infinity) agg.minPrice = 0;
  }

  return result;
}

interface GetAllProgramsOptions {
  /** If true, only return events where isPublished = true */
  publishedOnly?: boolean;
  /** If true, additionally filter by showOnMobile = true */
  mobileOnly?: boolean;
  /** If true, additionally filter by isFeatured = true */
  featuredOnly?: boolean;
}

async function getAllPrograms(opts: GetAllProgramsOptions = {}) {
  const { publishedOnly = false, mobileOnly = false, featuredOnly = false } = opts;

  const buildConditions = (table: typeof leaguesTable | typeof campsTable | typeof dropinsTable | typeof tournamentsTable) => {
    const conds = [];
    if (publishedOnly) conds.push(eq((table as any).isPublished, true));
    if (mobileOnly) conds.push(eq((table as any).showOnMobile, true));
    if (featuredOnly) conds.push(eq((table as any).isFeatured, true));
    return conds;
  };

  const buildTemplateConditions = () => {
    const conds: any[] = [
      eq(dropinTemplatesTable.isPublished, true),
      eq(dropinTemplatesTable.isDraft, false),
      sql`(${dropinTemplatesTable.publishAt} IS NULL OR ${dropinTemplatesTable.publishAt} <= NOW())`,
    ];
    if (mobileOnly) conds.push(eq(dropinTemplatesTable.showOnMobile, true));
    if (featuredOnly) conds.push(eq(dropinTemplatesTable.isFeatured, true));
    return conds;
  };

  const buildKotcConditions = () => {
    const conds: any[] = [];
    if (publishedOnly) conds.push(eq(kotcSeasonsTable.isPublished, true));
    if (mobileOnly) conds.push(eq(kotcSeasonsTable.showOnMobile, true));
    if (featuredOnly) conds.push(eq(kotcSeasonsTable.isFeatured, true));
    return conds;
  };

  const [leagues, camps, dropins, tournaments, dropinTemplates, kotcSeasons] = await Promise.all([
    buildConditions(leaguesTable).length
      ? db.select().from(leaguesTable).where(and(...buildConditions(leaguesTable)))
      : db.select().from(leaguesTable),
    buildConditions(campsTable).length
      ? db.select().from(campsTable).where(and(...buildConditions(campsTable)))
      : db.select().from(campsTable),
    buildConditions(dropinsTable).length
      ? db.select().from(dropinsTable).where(and(...buildConditions(dropinsTable)))
      : db.select().from(dropinsTable),
    buildConditions(tournamentsTable).length
      ? db.select().from(tournamentsTable).where(and(...buildConditions(tournamentsTable)))
      : db.select().from(tournamentsTable),
    // Always include publishedOnly filter for templates (templates need isPublished + !isDraft)
    publishedOnly
      ? db.select().from(dropinTemplatesTable).where(and(...buildTemplateConditions()))
      : db.select().from(dropinTemplatesTable),
    // KotC seasons
    buildKotcConditions().length
      ? db.select().from(kotcSeasonsTable).where(and(...buildKotcConditions()))
      : publishedOnly ? db.select().from(kotcSeasonsTable).where(eq(kotcSeasonsTable.isPublished, true)) : db.select().from(kotcSeasonsTable),
  ]);

  // Batch-fetch pool aggregates for all dropins and templates in parallel
  const dropinIds = dropins.map((d) => d.id);
  const templateIds = dropinTemplates.map((t: any) => t.id);
  const [aggregates, templatePoolAggMap] = await Promise.all([
    dropinPoolAggregates(dropinIds),
    dropinTemplatePoolAggregates(templateIds),
  ]);

  // Identify dropin IDs that were materialized from a template so we can exclude them
  // from the raw dropin list (they already appear via their parent template card).
  const materializedDropinIds = new Set<number>();
  if (templateIds.length) {
    const materializedRows = await db
      .select({ materializedDropinId: dropinOccurrencesTable.materializedDropinId })
      .from(dropinOccurrencesTable)
      .where(
        and(
          inArray(dropinOccurrencesTable.templateId, templateIds),
          isNotNull(dropinOccurrencesTable.materializedDropinId),
          ne(dropinOccurrencesTable.status, "cancelled"),
        )
      );
    for (const row of materializedRows) {
      if (row.materializedDropinId !== null) {
        materializedDropinIds.add(row.materializedDropinId);
      }
    }
  }

  // Filter out template-backed dropins — they are represented by their template card.
  // Exclude both: dropin rows linked via dropin_occurrences.materialized_dropin_id AND
  // any dropin whose template_id matches a known template (legacy rows predate the occurrence link).
  const templateIdSet = new Set(templateIds);
  const nonTemplateDropins = dropins.filter(
    (d) => !materializedDropinIds.has(d.id) && !(d.templateId != null && templateIdSet.has(d.templateId))
  );

  // For dropins that have no pools, count confirmed flat-path spots live from the spots table
  const nopoolDropinIds = dropinIds.filter((id) => !aggregates.has(id));
  const flatSpotCounts = new Map<number, number>();
  if (nopoolDropinIds.length) {
    const flatRows = await db
      .select({ entityId: spotsTable.entityId, count: sql<number>`count(*)` })
      .from(spotsTable)
      .where(
        and(
          eq(spotsTable.entityType, "dropin"),
          inArray(spotsTable.entityId, nopoolDropinIds),
          isNull(spotsTable.poolId),
          eq(spotsTable.status, "reserved"),
          eq(spotsTable.waitlisted, false),
        )
      )
      .groupBy(spotsTable.entityId);
    for (const row of flatRows) flatSpotCounts.set(row.entityId!, Number(row.count));
  }

  const leaguePrograms = leagues.map((l) => {
    const sd = l.startDate ?? new Date().toISOString().split("T")[0];
    const ed = l.endDate ?? null;
    return {
      id: l.id,
      type: "league" as const,
      name: l.name,
      ageGroup: normalizeAgeGroup(l.ageGroup).join(","),
      gender: l.gender ?? null,
      status: l.status,
      price: Number(l.registrationPrice),
      spotsAvailable: Math.max(0, l.maxTeams - l.teamsRegistered),
      spotsTotal: l.maxTeams,
      startDate: sd,
      endDate: ed,
      imageUrl: l.imageUrl ?? null,
      description: l.description ?? null,
      isPublished: l.isPublished,
      isFeatured: l.isFeatured,
      showOnMobile: l.showOnMobile,
      _startsAt: new Date(`${sd}T00:00:00`),
      _endsAt: ed ? new Date(`${ed}T23:59:59`) : null,
      _activeOverride: (l as any).activeOverride ?? null,
      _durationMinutes: null as null,
    };
  });

  const campPrograms = camps.map((c) => {
    const sd = c.startDate ?? new Date().toISOString().split("T")[0];
    const ed = c.endDate ?? null;
    return {
      id: c.id,
      type: "camp" as const,
      name: c.name,
      ageGroup: normalizeAgeGroup(c.ageGroup).join(","),
      gender: c.gender ?? null,
      status: c.status,
      price: Number(c.price),
      spotsAvailable: Math.max(0, c.maxParticipants - c.participantsRegistered),
      spotsTotal: c.maxParticipants,
      startDate: sd,
      endDate: ed,
      imageUrl: c.imageUrl ?? null,
      description: c.description ?? null,
      isPublished: c.isPublished,
      isFeatured: c.isFeatured,
      showOnMobile: c.showOnMobile,
      _startsAt: new Date(`${sd}T00:00:00`),
      _endsAt: ed ? new Date(`${ed}T23:59:59`) : null,
      _activeOverride: (c as any).activeOverride ?? null,
      _durationMinutes: null as null,
    };
  });

  const dropinPrograms = nonTemplateDropins.map((d) => {
    const agg = aggregates.get(d.id);
    // Pool-based aggregates take precedence; no-pool dropins use a live spot count
    const spotsTotal = agg ? agg.spotsTotal : (d.maxPlayers ?? null);
    const spotsTaken = agg ? agg.spotsTaken : (flatSpotCounts.get(d.id) ?? 0);
    const spotsAvailable = spotsTotal !== null ? Math.max(0, spotsTotal - spotsTaken) : 0;
    // Pool-aggregated age groups (fall back to session-level)
    const ageGroup = (agg && agg.ageGroups.length > 0) ? agg.ageGroups : normalizeAgeGroup(d.ageGroup);
    // Earliest/latest pool start times for time-range display on cards
    const earliestStart = agg?.earliestStartsAt ?? d.startsAt ?? null;
    const latestStart = agg?.latestStartsAt ?? null;

    return {
      id: d.id,
      type: "drop_in" as const,
      name: d.name,
      ageGroup: ageGroup.join(","),
      gender: d.gender ?? null,
      status: d.status,
      price: agg?.minPrice ?? Number(d.price),
      spotsAvailable,
      spotsTotal,
      startDate: (agg?.earliestStartsAt ?? d.startsAt).toISOString().split("T")[0],
      endDate: null,
      imageUrl: d.imageUrl ?? null,
      description: d.description ?? null,
      isPublished: d.isPublished,
      isFeatured: d.isFeatured,
      showOnMobile: d.showOnMobile,
      startsAt: earliestStart ? earliestStart.toISOString() : null,
      poolLatestStartsAt: latestStart ? latestStart.toISOString() : null,
      _startsAt: (agg?.earliestStartsAt ?? d.startsAt) ?? null,
      _endsAt: (() => {
        const base = agg?.latestStartsAt ?? d.startsAt ?? null;
        return base && d.durationMinutes
          ? new Date(base.getTime() + d.durationMinutes * 60 * 1000)
          : null;
      })(),
      _activeOverride: (d as any).activeOverride ?? null,
      _durationMinutes: d.durationMinutes ?? null,
    };
  });

  const tournamentPrograms = tournaments.map((t) => {
    const sd = t.startDate ?? new Date().toISOString().split("T")[0];
    const ed = t.endDate ?? null;
    return {
      id: t.id,
      type: "tournament" as const,
      name: t.name,
      ageGroup: normalizeAgeGroup(t.ageGroup).join(","),
      gender: t.gender ?? null,
      status: t.status,
      price: Number(t.teamPrice),
      spotsAvailable: Math.max(0, t.maxTeams - t.teamsRegistered),
      spotsTotal: t.maxTeams,
      startDate: sd,
      endDate: ed,
      imageUrl: t.imageUrl ?? null,
      description: t.description ?? null,
      isPublished: t.isPublished,
      isFeatured: t.isFeatured,
      showOnMobile: t.showOnMobile,
      _startsAt: new Date(`${sd}T00:00:00`),
      _endsAt: ed ? new Date(`${ed}T23:59:59`) : null,
      _activeOverride: (t as any).activeOverride ?? null,
      _durationMinutes: null as null,
    };
  });

  /**
   * Given a recurrence rule, return the next upcoming occurrence date string (YYYY-MM-DD).
   * For one_time templates: use rule.startDate (or today as fallback).
   * For recurring templates: advance from today to the next matching dayOfWeek.
   */
  function nextOccurrenceDate(rule: any): string {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (!rule || rule.type === "one_time") {
      return rule?.startDate ?? today.toISOString().split("T")[0];
    }
    // Recurring: find the next date (>= max(today, startDate)) with the matching weekday
    const targetDow = Number(rule.dayOfWeek ?? 0); // 0=Sun … 6=Sat
    const seriesStart = rule.startDate ? new Date(rule.startDate + "T00:00:00") : today;
    const current = new Date(today < seriesStart ? seriesStart : today);
    for (let i = 0; i < 7; i++) {
      if (current.getDay() === targetDow) {
        return current.toISOString().split("T")[0];
      }
      current.setDate(current.getDate() + 1);
    }
    // Fallback (should never happen — one of 7 days always matches)
    return (today < seriesStart ? seriesStart : today).toISOString().split("T")[0];
  }

  // Dropin templates: map to FeaturedProgram shape using live pool data and next occurrence date
  const dropinTemplatePrograms = dropinTemplates.map((t: any) => {
    const rule: any = t.recurrenceRule ?? {};
    const startDate: string = nextOccurrenceDate(rule);
    const startsAtDate = occurrenceDateToUtc(startDate, rule.startTime ?? "00:00");

    const tpAgg = templatePoolAggMap.get(t.id);
    const spotsTotal: number = tpAgg ? tpAgg.spotsTotal : 0;
    const spotsConfirmed: number = tpAgg ? tpAgg.spotsConfirmed : 0;
    const spotsAvailable: number = Math.max(0, spotsTotal - spotsConfirmed);
    const ageGroup: string = (tpAgg && tpAgg.ageGroups.length > 0) ? tpAgg.ageGroups.join(",") : "adult";
    const gender: string | null = tpAgg?.gender ?? null;
    const price: number = tpAgg ? tpAgg.minPrice : 0;

    return {
      id: t.id,
      type: "drop_in" as const,
      isTemplate: true,
      occurrenceDate: startDate,
      name: t.name,
      ageGroup,
      gender,
      status: "upcoming" as const,
      price,
      spotsAvailable,
      spotsTotal,
      startDate,
      endDate: null,
      imageUrl: t.imageUrl ?? null,
      description: t.description ?? null,
      isPublished: t.isPublished,
      isFeatured: t.isFeatured,
      showOnMobile: t.showOnMobile,
      startsAt: startsAtDate.toISOString(),
      _startsAt: startsAtDate,
      _endsAt: null,
      _activeOverride: "active" as const,
      _durationMinutes: rule.durationMinutes ?? null,
    };
  });

  // Fetch team counts per KotC season
  const kotcSeasonIds = kotcSeasons.map((s: any) => s.id);
  const kotcTeamCountMap = new Map<number, number>();
  if (kotcSeasonIds.length) {
    const teamCounts = await db
      .select({ seasonId: kotcTeamsTable.seasonId, count: count() })
      .from(kotcTeamsTable)
      .where(and(inArray(kotcTeamsTable.seasonId, kotcSeasonIds), eq(kotcTeamsTable.status, "active")))
      .groupBy(kotcTeamsTable.seasonId);
    for (const row of teamCounts) {
      kotcTeamCountMap.set(row.seasonId, Number(row.count));
    }
  }

  const kotcPrograms = (kotcSeasons as any[]).map((s) => {
    const lifePacks: Array<{ price: number }> = Array.isArray(s.lifePacks) ? s.lifePacks : [];
    const minLifePrice = lifePacks.length
      ? Math.min(...lifePacks.map((p) => Number(p.price ?? 0)))
      : 0;
    const teamCount = kotcTeamCountMap.get(s.id) ?? 0;
    const startDate = s.startsAt ? new Date(s.startsAt).toISOString().split("T")[0] : new Date().toISOString().split("T")[0];
    const endDate = s.endsAt ? new Date(s.endsAt).toISOString().split("T")[0] : null;
    const statusRaw: string = s.status ?? "upcoming";
    const status = (["upcoming", "active", "completed"].includes(statusRaw) ? statusRaw : "upcoming") as "upcoming" | "active" | "completed";
    return {
      id: s.id,
      type: "kotc" as const,
      name: s.name,
      ageGroup: s.ageBracket ?? "open",
      gender: s.genderBracket ?? null,
      status,
      price: minLifePrice,
      spotsAvailable: 0,
      spotsTotal: 0,
      startDate,
      endDate,
      imageUrl: (s as any).imageUrl ?? null,
      description: (s as any).description ?? null,
      isPublished: s.isPublished,
      isFeatured: s.isFeatured,
      showOnMobile: s.showOnMobile,
      teamSize: s.teamSize ?? 4,
      sport: s.sport ?? "basketball",
      teamCount,
      _startsAt: s.startsAt ? new Date(s.startsAt) : new Date(),
      _endsAt: s.endsAt ? new Date(s.endsAt) : null,
      _activeOverride: null,
      _durationMinutes: null as null,
    };
  });

  return [...leaguePrograms, ...campPrograms, ...dropinPrograms, ...tournamentPrograms, ...dropinTemplatePrograms, ...kotcPrograms];
}

/**
 * Browse/discovery visibility: show if the event has not yet ended.
 * - activeOverride="active" → always show
 * - activeOverride="closed" → always hide
 * - _endsAt in the future (or null/undefined = open-ended) → show
 * - _endsAt in the past → hide
 *
 * This intentionally replaces isEventActive() (which is a ±30-min real-time
 * window check) for the Explore/Featured listing context.
 */
function isProgramVisible(p: { _endsAt: Date | null; _activeOverride: string | null }): boolean {
  if (p._activeOverride === "active") return true;
  if (p._activeOverride === "closed") return false;
  if (!p._endsAt) return true;
  return p._endsAt > new Date();
}

router.get("/programs/featured", async (_req, res): Promise<void> => {
  const all = await getAllPrograms({ publishedOnly: true, featuredOnly: true });
  const featured = all
    .filter((p) => (p.status === "upcoming" || p.status === "active") && isProgramVisible(p))
    .sort((a, b) => {
      const aTime = a._startsAt ? new Date(a._startsAt).getTime() : Infinity;
      const bTime = b._startsAt ? new Date(b._startsAt).getTime() : Infinity;
      return aTime - bTime;
    })
    .map(({ _startsAt: _, _endsAt: __, _activeOverride: ___, _durationMinutes: ____, isPublished: _p, isFeatured: _f, showOnMobile: _m, ...rest }) => rest)
    .slice(0, 6);
  res.json(ListFeaturedProgramsResponse.parse(featured));
});

router.get("/programs", async (req, res): Promise<void> => {
  const query = ListProgramsQueryParams.safeParse(req.query);
  const isMobile = req.query.mobile === "true" || req.query.mobile === "1";
  let all = await getAllPrograms({ publishedOnly: true, mobileOnly: isMobile });
  if (query.success) {
    if (query.data.type) all = all.filter((p) => p.type === query.data.type);
    if (query.data.ageGroup) all = all.filter((p) => p.ageGroup.includes(query.data.ageGroup!));
  }
  all = all.filter((p) => isProgramVisible(p));
  all.sort((a, b) => {
    const aTime = a._startsAt ? new Date(a._startsAt).getTime() : Infinity;
    const bTime = b._startsAt ? new Date(b._startsAt).getTime() : Infinity;
    return aTime - bTime;
  });
  const stripped = all.map(({ _startsAt: _, _endsAt: __, _activeOverride: ___, _durationMinutes: ____, isPublished: _p, isFeatured: _f, showOnMobile: _m, ...rest }) => rest);
  res.json(ListProgramsResponse.parse(stripped));
});

// ─── Visibility PATCH endpoints ─────────────────────────────────────────────

const visibilityBody = (body: any): { isPublished?: boolean; isFeatured?: boolean; showOnMobile?: boolean } => {
  const patch: any = {};
  if (typeof body.isPublished === "boolean") patch.isPublished = body.isPublished;
  if (typeof body.isFeatured === "boolean") patch.isFeatured = body.isFeatured;
  if (typeof body.showOnMobile === "boolean") patch.showOnMobile = body.showOnMobile;
  return patch;
};

router.patch(
  "/programs/leagues/:id/visibility",
  requirePermission("canManageLeagues"),
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
    const patch = visibilityBody(req.body);
    if (!Object.keys(patch).length) { res.status(400).json({ error: "No visibility fields provided" }); return; }
    const [updated] = await db.update(leaguesTable).set(patch).where(eq(leaguesTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ id: updated.id, isPublished: updated.isPublished, isFeatured: updated.isFeatured, showOnMobile: updated.showOnMobile });
  }
);

router.patch(
  "/programs/tournaments/:id/visibility",
  requirePermission("canManageTournaments"),
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
    const patch = visibilityBody(req.body);
    if (!Object.keys(patch).length) { res.status(400).json({ error: "No visibility fields provided" }); return; }
    const [updated] = await db.update(tournamentsTable).set(patch).where(eq(tournamentsTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ id: updated.id, isPublished: updated.isPublished, isFeatured: updated.isFeatured, showOnMobile: updated.showOnMobile });
  }
);

router.patch(
  "/programs/camps/:id/visibility",
  requirePermission("canManageCamps"),
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
    const patch = visibilityBody(req.body);
    if (!Object.keys(patch).length) { res.status(400).json({ error: "No visibility fields provided" }); return; }
    const [updated] = await db.update(campsTable).set(patch).where(eq(campsTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ id: updated.id, isPublished: updated.isPublished, isFeatured: updated.isFeatured, showOnMobile: updated.showOnMobile });
  }
);

router.patch(
  "/programs/dropins/:id/visibility",
  requirePermission("canManageDropins"),
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
    const patch = visibilityBody(req.body);
    if (!Object.keys(patch).length) { res.status(400).json({ error: "No visibility fields provided" }); return; }
    const [updated] = await db.update(dropinsTable).set(patch).where(eq(dropinsTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ id: updated.id, isPublished: updated.isPublished, isFeatured: updated.isFeatured, showOnMobile: updated.showOnMobile });
  }
);

router.patch(
  "/programs/dropin-templates/:id/visibility",
  requirePermission("canManageDropins"),
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
    const patch = visibilityBody(req.body);
    if (!Object.keys(patch).length) { res.status(400).json({ error: "No visibility fields provided" }); return; }
    const updateData: any = { ...patch, updatedAt: new Date() };
    if (typeof patch.isPublished === "boolean") {
      updateData.isDraft = patch.isPublished ? false : undefined;
    }
    const [updated] = await db.update(dropinTemplatesTable).set(updateData).where(eq(dropinTemplatesTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ id: updated.id, isPublished: updated.isPublished, isFeatured: updated.isFeatured, showOnMobile: updated.showOnMobile });
  }
);

router.patch(
  "/programs/kotc/:id/visibility",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
    const patch = visibilityBody(req.body);
    if (!Object.keys(patch).length) { res.status(400).json({ error: "No visibility fields provided" }); return; }
    const [updated] = await db
      .update(kotcSeasonsTable)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(kotcSeasonsTable.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ id: updated.id, isPublished: updated.isPublished, isFeatured: updated.isFeatured, showOnMobile: updated.showOnMobile });
  }
);

export default router;
