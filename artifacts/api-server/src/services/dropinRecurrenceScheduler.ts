/**
 * Dropin Recurrence Scheduler
 *
 * Runs once at startup and every 24 hours thereafter.
 * For every active session template, generates sessions from lastGeneratedAt up to
 * a rolling 4-week horizon, then updates lastGeneratedAt.
 *
 * Pool-level logistics (startsAt, durationMinutes, price, cancellationWindowMinutes,
 * registrationOpen) are stored on each pool rather than the session.
 *
 * Each pool in a template can now carry its own independent schedule
 * (dayOfWeek, startTime, durationMinutes, cancellationWindowMinutes, endsAt, price, gender)
 * via the poolsConfig column. Legacy templates without poolsConfig are handled
 * by resolvePoolsConfig() which synthesises pool entries from top-level fields.
 */

import { db, sessionTemplatesTable, dropinsTable, dropinCourtPoolsTable, pricingRulesTable } from "@workspace/db";
import type { PoolConfig } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { logger } from "../lib/logger";

const HORIZON_DAYS = 28;
const JOB_INTERVAL_MS = 24 * 60 * 60 * 1000;

function pad(n: number, l = 2) { return String(n).padStart(l, "0"); }

function toEasternWallClock(utc: Date): Date {
  return new Date(utc.toLocaleString("en-US", { timeZone: "America/New_York" }));
}

function easternLocalToUtc(year: number, month: number, day: number, h: number, m: number): Date {
  const isoStr = `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(h)}:${pad(m)}:00`;
  const utcRef = new Date(isoStr + "Z");
  const easternAtUtcRef = new Date(utcRef.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const offsetMs = utcRef.getTime() - easternAtUtcRef.getTime();
  return new Date(utcRef.getTime() + offsetMs);
}

function addEasternDays(eastern: Date, days: number): Date {
  return new Date(eastern.getFullYear(), eastern.getMonth(), eastern.getDate() + days);
}

function firstOccurrenceAfter(after: Date, dayOfWeek: number, startTime: string, cutoff: Date): Date | null {
  const [h, m] = startTime.split(":").map(Number);
  const eastern = toEasternWallClock(after);
  const dow = eastern.getDay();
  const daysAhead = (dayOfWeek - dow + 7) % 7;

  let candidateEastern = addEasternDays(eastern, daysAhead);
  let occurrence = easternLocalToUtc(
    candidateEastern.getFullYear(), candidateEastern.getMonth() + 1, candidateEastern.getDate(), h, m
  );

  if (occurrence.getTime() <= after.getTime()) {
    candidateEastern = addEasternDays(candidateEastern, 7);
    occurrence = easternLocalToUtc(
      candidateEastern.getFullYear(), candidateEastern.getMonth() + 1, candidateEastern.getDate(), h, m
    );
  }

  return occurrence.getTime() > cutoff.getTime() ? null : occurrence;
}

function nextWeekOccurrence(prev: Date, startTime: string): Date {
  const [h, m] = startTime.split(":").map(Number);
  const prevEastern = toEasternWallClock(prev);
  const nextEastern = addEasternDays(prevEastern, 7);
  return easternLocalToUtc(
    nextEastern.getFullYear(), nextEastern.getMonth() + 1, nextEastern.getDate(), h, m
  );
}

/**
 * Advance from one occurrence to the next according to a recurrence interval.
 * - unit="week": advance by interval*7 days (e.g. 2 = every 2 weeks)
 * - unit="month": advance by interval calendar months, then snap to the
 *   nearest upcoming dayOfWeek so the session always lands on the right weekday.
 */
function nextRecurrenceOccurrence(
  prev: Date,
  startTime: string,
  intervalNum: number,
  unit: string,
  dayOfWeek: number,
): Date {
  const [h, m] = startTime.split(":").map(Number);
  const prevEastern = toEasternWallClock(prev);

  if (unit === "month") {
    const advanced = new Date(prevEastern.getFullYear(), prevEastern.getMonth() + intervalNum, prevEastern.getDate());
    const dow = advanced.getDay();
    const diff = (dayOfWeek - dow + 7) % 7;
    const target = new Date(advanced.getFullYear(), advanced.getMonth(), advanced.getDate() + diff);
    return easternLocalToUtc(target.getFullYear(), target.getMonth() + 1, target.getDate(), h, m);
  }

  // default: weeks
  const nextEastern = addEasternDays(prevEastern, intervalNum * 7);
  return easternLocalToUtc(
    nextEastern.getFullYear(), nextEastern.getMonth() + 1, nextEastern.getDate(), h, m,
  );
}

function toEasternDateString(utc: Date): string {
  const eastern = toEasternWallClock(utc);
  return `${eastern.getFullYear()}-${pad(eastern.getMonth() + 1)}-${pad(eastern.getDate())}`;
}

function normalizeAgeGroupLocal(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((v) => typeof v === "string" && v.length > 0);
  if (typeof raw === "string" && raw.length > 0) return [raw];
  return ["adult"];
}

function resolvePoolPrice(pc: PoolConfig, fallback: number): number {
  const p = pc.price !== undefined && pc.price !== null ? Number(pc.price) : null;
  return p !== null && !isNaN(p) ? p : fallback;
}

/**
 * Resolve a unified pool list from a template.
 * If the template has a poolsConfig array, use it directly.
 * Otherwise synthesise from legacy top-level fields + extraPoolsConfig.
 * This ensures the scheduler and API never break on old data.
 */
export function resolvePoolsConfig(template: any): PoolConfig[] {
  const raw = (template as any).poolsConfig;
  if (Array.isArray(raw) && raw.length > 0) return raw as PoolConfig[];

  const endsAtStr = template.endsAt
    ? (template.endsAt instanceof Date ? template.endsAt.toISOString() : String(template.endsAt))
    : null;

  const primary: PoolConfig = {
    courtId: template.courtId,
    ageGroup: template.ageGroup,
    skillLevel: template.skillLevel ?? "all",
    cap: template.defaultCap ?? 15,
    dayOfWeek: template.dayOfWeek,
    startTime: template.startTime,
    durationMinutes: template.durationMinutes ?? 120,
    cancellationWindowMinutes: template.cancellationWindowMinutes ?? 120,
    endsAt: endsAtStr,
    price: template.price ? String(template.price) : "0",
    gender: template.gender ?? null,
  };

  const extras: PoolConfig[] = (template.extraPoolsConfig ?? []).map((ep: any) => ({
    courtId: ep.courtId,
    ageGroup: ep.ageGroup,
    skillLevel: ep.skillLevel ?? template.skillLevel ?? "all",
    cap: ep.cap,
    dayOfWeek: template.dayOfWeek,
    startTime: template.startTime,
    durationMinutes: template.durationMinutes ?? 120,
    cancellationWindowMinutes: template.cancellationWindowMinutes ?? 120,
    endsAt: endsAtStr,
    price: template.price ? String(template.price) : "0",
    gender: ep.gender ?? template.gender ?? null,
  }));

  return [primary, ...extras];
}

export async function generateRollingForTemplate(
  templateId: number,
  horizonDays: number = HORIZON_DAYS,
  startFrom?: Date,
): Promise<{ created: number; skipped: number }> {
  const [template] = await db.select().from(sessionTemplatesTable).where(eq(sessionTemplatesTable.id, templateId));
  if (!template || !template.isActive) return { created: 0, skipped: 0 };

  const skippedDateSet = new Set<string>((template as any).skippedDates ?? []);
  const poolsConfig = resolvePoolsConfig(template);
  if (poolsConfig.length === 0) return { created: 0, skipped: 0 };

  // Recurrence settings: how often to generate sessions.
  // Default to weekly (interval=1, unit='week') for backward compat with templates
  // that predate the recurrence columns.
  const recurrenceIntervalNum: number = Number((template as any).recurrenceInterval ?? 1) || 1;
  const recurrenceUnitStr: string = (template as any).recurrenceUnit ?? "week";

  const now = new Date();

  // Use the caller-supplied startFrom override first, then fall back to the
  // template's lastGeneratedAt (used by cron runs), and finally to now.
  const generationAnchor: Date = startFrom ?? template.lastGeneratedAt ?? now;

  // When a startFrom date is explicitly provided (e.g. admin picking a future
  // series start), extend the horizon forward from that anchor so sessions are
  // actually generated.  Cron runs (no override) continue to use now as base.
  const horizonBase = startFrom ?? now;
  const horizon = new Date(horizonBase.getTime() + horizonDays * 24 * 60 * 60 * 1000);

  // template.endsAt is only a hard global cap in legacy mode (no poolsConfig).
  // When poolsConfig is present, each pool drives its own endsAt independently.
  const hasPoolsConfig = Array.isArray((template as any).poolsConfig) && (template as any).poolsConfig.length > 0;
  const templateCutoff = (!hasPoolsConfig && template.endsAt && template.endsAt < horizon)
    ? template.endsAt
    : horizon;
  if (templateCutoff <= now) return { created: 0, skipped: 0 };

  // Pre-fetch all existing dropin sessions for this template — dedup by Eastern date
  const existingDropins = await db
    .select({ id: dropinsTable.id, startsAt: dropinsTable.startsAt })
    .from(dropinsTable)
    .where(eq(dropinsTable.templateId, template.id));

  const existingDates = new Set<string>(
    existingDropins
      .filter((d) => d.startsAt)
      .map((d) => toEasternDateString(d.startsAt!))
  );

  // Resolve global fallback price from active pricing rule
  let globalFallbackPrice = 0;
  const [pricingRule] = await db
    .select()
    .from(pricingRulesTable)
    .where(and(eq(pricingRulesTable.category, "drop_in"), eq(pricingRulesTable.isLatest, true)))
    .orderBy(desc(pricingRulesTable.createdAt))
    .limit(1);
  if (pricingRule?.basePrice) globalFallbackPrice = Number(pricingRule.basePrice);

  // Group pools by dayOfWeek — pools sharing the same day go into one dropin session
  const byDay = new Map<number, PoolConfig[]>();
  for (const pc of poolsConfig) {
    const arr = byDay.get(pc.dayOfWeek) ?? [];
    arr.push(pc);
    byDay.set(pc.dayOfWeek, arr);
  }

  let created = 0;
  let skipped = 0;
  let lastScanned: Date | null = null;

  for (const [, pools] of byDay) {
    // Group iteration bound: iterate as far as any pool in the group might still be active.
    // Use the MAXIMUM per-pool endsAt (not the minimum) capped at horizon.
    // Each pool is individually checked per occurrence using its own endsAt.
    let groupCutoff: Date;
    if (hasPoolsConfig) {
      const allHaveEndsAt = pools.every(pc => !!pc.endsAt);
      if (allHaveEndsAt) {
        const maxPoolEnd = pools.reduce((max, pc) => {
          const pEnd = new Date(pc.endsAt!);
          return pEnd > max ? pEnd : max;
        }, new Date(0));
        groupCutoff = maxPoolEnd < horizon ? maxPoolEnd : horizon;
      } else {
        groupCutoff = horizon; // at least one pool runs indefinitely
      }
    } else {
      groupCutoff = templateCutoff; // legacy: use template.endsAt
    }

    // Use any pool's dayOfWeek for the iteration anchor (all in this group share the same day)
    // But use the first pool's startTime only as the reference for weekly stepping.
    // The anchor pool for each occurrence is re-computed as the first still-active pool.
    const groupDayOfWeek = pools[0].dayOfWeek;
    const groupReferenceTime = pools[0].startTime; // only used for weekly stepping cadence

    let occurrence = firstOccurrenceAfter(generationAnchor, groupDayOfWeek, groupReferenceTime, groupCutoff);

    while (occurrence !== null) {
      if (!lastScanned || occurrence > lastScanned) lastScanned = occurrence;

      const occurrenceDateStr = toEasternDateString(occurrence);

      if (skippedDateSet.has(occurrenceDateStr)) {
        skipped++;
        const next = nextRecurrenceOccurrence(occurrence, groupReferenceTime, recurrenceIntervalNum, recurrenceUnitStr, groupDayOfWeek);
        occurrence = next.getTime() > groupCutoff.getTime() ? null : next;
        continue;
      }

      // Filter pools that are still active for this occurrence
      const activePools = pools.filter(pc => {
        if (!pc.endsAt) return true;
        return new Date(pc.endsAt) >= occurrence!;
      });

      if (activePools.length === 0) {
        // All pools in this day-group have expired; skip occurrence (don't create empty session)
        skipped++;
        const next = nextRecurrenceOccurrence(occurrence, groupReferenceTime, recurrenceIntervalNum, recurrenceUnitStr, groupDayOfWeek);
        occurrence = next.getTime() > groupCutoff.getTime() ? null : next;
        continue;
      }

      if (existingDates.has(occurrenceDateStr)) {
        skipped++;
      } else {
        const anchorPool = activePools[0];

        // Compute anchor pool's exact startsAt
        const [ah, am] = anchorPool.startTime.split(":").map(Number);
        const anchorEastern = toEasternWallClock(occurrence);
        const anchorStartsAt = easternLocalToUtc(
          anchorEastern.getFullYear(), anchorEastern.getMonth() + 1, anchorEastern.getDate(), ah, am
        );

        const anchorPrice = resolvePoolPrice(anchorPool, globalFallbackPrice);

        // Create the dropin session container
        const [dropin] = await db.insert(dropinsTable).values({
          name: template.name,
          ageGroup: normalizeAgeGroupLocal(anchorPool.ageGroup),
          skillLevel: anchorPool.skillLevel,
          courtId: anchorPool.courtId,
          startsAt: anchorStartsAt,
          durationMinutes: anchorPool.durationMinutes,
          price: String(anchorPrice),
          registrationOpen: false,
          cancellationWindowMinutes: anchorPool.cancellationWindowMinutes,
          templateId: template.id,
          description: template.description ?? null,
        } as any).returning();

        // Create one dropin_court_pool per active pool, each with its own schedule
        for (const pc of activePools) {
          const [ph, pm] = pc.startTime.split(":").map(Number);
          const poolEastern = toEasternWallClock(occurrence);
          const poolStartsAt = easternLocalToUtc(
            poolEastern.getFullYear(), poolEastern.getMonth() + 1, poolEastern.getDate(), ph, pm
          );
          const poolPrice = resolvePoolPrice(pc, globalFallbackPrice);

          await db.insert(dropinCourtPoolsTable).values({
            dropinId: dropin.id,
            courtId: pc.courtId,
            ageGroup: normalizeAgeGroupLocal(pc.ageGroup),
            skillLevel: pc.skillLevel,
            cap: pc.cap,
            isClosed: false,
            templateId: template.id,
            startsAt: poolStartsAt,
            durationMinutes: pc.durationMinutes,
            price: String(poolPrice),
            cancellationWindowMinutes: pc.cancellationWindowMinutes,
            registrationOpen: false,
            gender: pc.gender ?? null,
          } as any);
        }

        existingDates.add(occurrenceDateStr);
        created++;
      }

      const next = nextRecurrenceOccurrence(occurrence, groupReferenceTime, recurrenceIntervalNum, recurrenceUnitStr, groupDayOfWeek);
      occurrence = next.getTime() > groupCutoff.getTime() ? null : next;
    }
  }

  if (lastScanned) {
    await db
      .update(sessionTemplatesTable)
      .set({ lastGeneratedAt: lastScanned, updatedAt: new Date() } as any)
      .where(eq(sessionTemplatesTable.id, template.id));
  }

  return { created, skipped };
}

// ─── auto-complete finished sessions ──────────────────────────────────────────

import { sql } from "drizzle-orm";

const AUTO_COMPLETE_INTERVAL_MS = 20 * 60 * 1000;

export async function autoCompleteFinishedSessions(): Promise<number> {
  // A session is completed when:
  //   (a) it has pools and ALL pools have ended (latest pool end < now), OR
  //   (b) it has no pools and the session-level starts_at + duration_minutes < now.
  const result = await db.execute<{ id: number }>(sql`
    UPDATE dropins d
    SET status = 'completed', updated_at = NOW()
    WHERE d.status IN ('upcoming', 'active')
      AND (
        (
          EXISTS (SELECT 1 FROM dropin_court_pools WHERE dropin_id = d.id)
          AND NOT EXISTS (
            SELECT 1 FROM dropin_court_pools p
            WHERE p.dropin_id = d.id
              AND (
                p.starts_at IS NULL
                OR p.starts_at + (p.duration_minutes * INTERVAL '1 minute') >= NOW()
              )
          )
        )
        OR (
          NOT EXISTS (SELECT 1 FROM dropin_court_pools WHERE dropin_id = d.id)
          AND d.starts_at + (d.duration_minutes * INTERVAL '1 minute') < NOW()
        )
      )
    RETURNING d.id
  `);
  const rows: any[] = Array.isArray(result) ? result : (result as any).rows ?? [];
  return rows.length;
}

export function startDropinAutoCompleteScheduler(): void {
  const run = () => {
    autoCompleteFinishedSessions()
      .then((count) => {
        if (count > 0) {
          logger.info(`[dropin-autocomplete] Marked ${count} finished session(s) as completed`);
        }
      })
      .catch((err) => {
        logger.error({ err: err?.message }, "[dropin-autocomplete] Error auto-completing sessions");
      });
  };

  run();
  setInterval(run, AUTO_COMPLETE_INTERVAL_MS);
  logger.info("[dropin-autocomplete] Scheduler started (interval: 20m)");
}

// ─── scheduler ─────────────────────────────────────────────────────────────────

async function runAllTemplates(): Promise<void> {
  const templates = await db
    .select({ id: sessionTemplatesTable.id, name: sessionTemplatesTable.name })
    .from(sessionTemplatesTable)
    .where(eq(sessionTemplatesTable.isActive, true));

  if (templates.length === 0) return;
  logger.info(`[dropin-recurrence] Rolling generation for ${templates.length} active template(s)`);

  for (const t of templates) {
    try {
      const { created, skipped } = await generateRollingForTemplate(t.id);
      if (created > 0 || skipped > 0) {
        logger.info(`[dropin-recurrence] template=${t.id} (${t.name}): created=${created}, skipped=${skipped}`);
      }
    } catch (err: any) {
      logger.error({ err: err?.message }, `[dropin-recurrence] Error processing template ${t.id}`);
    }
  }
}

export function startDropinRecurrenceScheduler(): void {
  runAllTemplates().catch((err) => {
    logger.error({ err: err?.message }, "[dropin-recurrence] Initial run failed");
  });

  setInterval(() => {
    runAllTemplates().catch((err) => {
      logger.error({ err: err?.message }, "[dropin-recurrence] Scheduled run failed");
    });
  }, JOB_INTERVAL_MS);

  logger.info("[dropin-recurrence] Scheduler started (interval: 24h)");
}
