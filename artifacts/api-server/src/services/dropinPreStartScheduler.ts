/**
 * Drop-in Pre-Start Scheduler
 *
 * Runs every 30 minutes.
 * For each published dropin_template, finds occurrences starting within the
 * next 24 hours (the materialization window) and:
 *   1. Materializes dropin_occurrences → dropins → dropin_court_pools if not yet done.
 *   2. Checks autoCancelThreshold: if registered spots < threshold at T-24h, cancels
 *      the occurrence and notifies registered players.
 */

import {
  db,
  dropinTemplatesTable,
  dropinTemplatePoolsTable,
  dropinOccurrencesTable,
  dropinsTable,
  dropinCourtPoolsTable,
  spotsTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { computeOccurrenceDates, occurrenceDateToUtc } from "./dropinOccurrenceService";
import { sendNotificationWithPreferences } from "./notifications";
import type { RecurrenceRule } from "@workspace/db";

const JOB_INTERVAL_MS = 30 * 60 * 1000;
const MATERIALIZE_WINDOW_HOURS = 24;
const AUTO_CANCEL_CHECK_HOURS = 24;

async function materializeOccurrence(
  template: typeof dropinTemplatesTable.$inferSelect,
  pools: (typeof dropinTemplatePoolsTable.$inferSelect)[],
  date: string,
): Promise<{ occurrenceId: number; dropinIds: number[] }> {
  const rule = template.recurrenceRule as RecurrenceRule;
  const startsAt = occurrenceDateToUtc(date, rule.startTime);

  // 1. Materialize dropin_occurrences row
  let [occurrence] = await db
    .select()
    .from(dropinOccurrencesTable)
    .where(
      and(
        eq(dropinOccurrencesTable.templateId, template.id),
        eq(dropinOccurrencesTable.occurrenceDate, date),
      ),
    );
  if (!occurrence) {
    [occurrence] = await db
      .insert(dropinOccurrencesTable)
      .values({ templateId: template.id, occurrenceDate: date, status: "upcoming" })
      .returning();
    logger.info(
      { templateId: template.id, date },
      "[dropin-prestart] Materialized occurrence",
    );
  }

  if (occurrence.status === "cancelled") {
    return { occurrenceId: occurrence.id, dropinIds: [] };
  }

  // 2. Materialize legacy dropin row (one per template+date, keyed by templateId + startsAt)
  let [dropin] = await db
    .select()
    .from(dropinsTable)
    .where(
      and(
        eq(dropinsTable.templateId, template.id),
        sql`starts_at = ${startsAt.toISOString()}::timestamptz`,
      ),
    );
  if (!dropin) {
    const firstPool = pools[0];
    [dropin] = await db
      .insert(dropinsTable)
      .values({
        name: template.name,
        ageGroup: (firstPool?.ageGroup ?? ["adult"]) as string[],
        courtId: firstPool?.courtId ?? 0,
        startsAt,
        durationMinutes: rule.durationMinutes ?? 120,
        price: String(firstPool?.price ?? "0"),
        registrationOpen: true,
        status: "upcoming",
        templateId: template.id,
        description: template.description ?? null,
        imageUrl: template.imageUrl ?? null,
        isPublished: true,
      })
      .returning();
  }

  // Back-link the occurrence to its materialized dropin (idempotent)
  if (occurrence.materializedDropinId !== dropin.id) {
    await db
      .update(dropinOccurrencesTable)
      .set({ materializedDropinId: dropin.id, updatedAt: new Date() })
      .where(eq(dropinOccurrencesTable.id, occurrence.id));
    occurrence = { ...occurrence, materializedDropinId: dropin.id };
  }

  // 3. Materialize a legacy dropin_court_pools row for each template pool.
  // Keyed by (dropin_id, dropin_template_pool_id) so that multiple pools on the
  // same court each get their own distinct inventory bucket.
  const dropinIds: number[] = [dropin.id];
  for (const pool of pools) {
    const [existing] = await db
      .select()
      .from(dropinCourtPoolsTable)
      .where(
        and(
          eq(dropinCourtPoolsTable.dropinId, dropin.id),
          eq(dropinCourtPoolsTable.dropinTemplatePoolId, pool.id),
        ),
      );
    if (!existing) {
      await db.insert(dropinCourtPoolsTable).values({
        dropinId: dropin.id,
        courtId: pool.courtId,
        dropinTemplatePoolId: pool.id,
        ageGroup: pool.ageGroup as string[],
        skillLevel: pool.skillLevel ?? "all",
        cap: pool.cap,
        price: String(pool.price ?? "0"),
        registrationOpen: true,
        startsAt,
        durationMinutes: rule.durationMinutes ?? 120,
        offerWindowMinutes: pool.offerWindowMinutes ?? 240,
        gender: pool.gender ?? null,
      });
    }
  }

  return { occurrenceId: occurrence.id, dropinIds };
}

async function checkAutoCancel(
  template: typeof dropinTemplatesTable.$inferSelect,
  occurrenceId: number,
  dropinIds: number[],
): Promise<void> {
  const threshold = template.autoCancelThreshold;
  if (!threshold || threshold <= 0) return;

  // Count confirmed (non-waitlisted, non-cancelled) spots across all legacy pools for this occurrence
  const countResult = await db.execute<{ cnt: string }>(sql`
    SELECT COUNT(*)::text AS cnt
    FROM spots s
    JOIN dropin_court_pools dcp ON dcp.id = s.pool_id
    WHERE dcp.dropin_id = ANY(ARRAY[${sql.raw(dropinIds.join(","))}]::int[])
      AND s.entity_type = 'dropin'
      AND s.status = 'reserved'
      AND s.waitlisted = false
  `);
  const countRows: any[] = Array.isArray(countResult) ? countResult : (countResult as any).rows ?? [];
  const spotsTaken = Number(countRows[0]?.cnt ?? 0);
  if (spotsTaken >= threshold) return;

  logger.info(
    { templateId: template.id, occurrenceId, spotsTaken, threshold },
    "[dropin-prestart] Auto-cancelling under-threshold occurrence",
  );

  // Cancel the occurrence
  await db
    .update(dropinOccurrencesTable)
    .set({ status: "cancelled" })
    .where(eq(dropinOccurrencesTable.id, occurrenceId));

  // Cancel all registered spots for this occurrence (notify each registrant)
  const affectedSpots = await db.execute<{ id: number; user_id: number; pool_id: number }>(sql`
    SELECT s.id, s.user_id, s.pool_id
    FROM spots s
    JOIN dropin_court_pools dcp ON dcp.id = s.pool_id
    WHERE dcp.dropin_id = ANY(ARRAY[${sql.raw(dropinIds.join(","))}]::int[])
      AND s.entity_type = 'dropin'
      AND s.status = 'reserved'
  `);

  const spotRows: any[] = Array.isArray(affectedSpots)
    ? affectedSpots
    : (affectedSpots as any).rows ?? [];

  if (spotRows.length > 0) {
    const spotIds = spotRows.map((r) => Number(r.id));
    await db.execute(sql`
      UPDATE spots SET status = 'cancelled' WHERE id = ANY(ARRAY[${sql.raw(spotIds.join(","))}]::int[])
    `);
    logger.info(
      { count: spotIds.length },
      "[dropin-prestart] Cancelled spots due to auto-cancel",
    );

    // Notify each affected registrant
    const uniqueUserIds = [...new Set(spotRows.map((r) => Number(r.user_id)))];
    await Promise.allSettled(
      uniqueUserIds.map((userId) =>
        sendNotificationWithPreferences({
          userId,
          type: "registration_update",
          subject: `${template.name} has been cancelled`,
          body: `The upcoming ${template.name} session has been automatically cancelled due to low registration. We apologize for the inconvenience. — PlayOn`,
          metadata: { templateId: template.id },
        } as any),
      ),
    );
  }
}

async function runPreStartJobs(): Promise<void> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + MATERIALIZE_WINDOW_HOURS * 60 * 60 * 1000);

  const templates = await db
    .select()
    .from(dropinTemplatesTable)
    .where(
      and(
        eq(dropinTemplatesTable.isPublished, true),
        eq(dropinTemplatesTable.isDraft, false),
      ),
    );

  for (const template of templates) {
    try {
      const rule = template.recurrenceRule as RecurrenceRule;
      if (!rule) continue;

      const pools = await db
        .select()
        .from(dropinTemplatePoolsTable)
        .where(eq(dropinTemplatePoolsTable.templateId, template.id));
      if (!pools.length) continue;

      // Find occurrence dates within the materialization window
      const dates = computeOccurrenceDates(rule, {
        from: now,
        to: windowEnd,
        limit: 10,
      });

      for (const date of dates) {
        const startsAt = occurrenceDateToUtc(date, rule.startTime);

        // Check if already cancelled (skip if so)
        const [existingOcc] = await db
          .select()
          .from(dropinOccurrencesTable)
          .where(
            and(
              eq(dropinOccurrencesTable.templateId, template.id),
              eq(dropinOccurrencesTable.occurrenceDate, date),
            ),
          );
        if (existingOcc?.status === "cancelled") continue;

        // Materialize
        const { occurrenceId, dropinIds } = await materializeOccurrence(template, pools, date);

        // Check auto-cancel threshold at T-24h (only if within 24h window)
        const msUntilStart = startsAt.getTime() - now.getTime();
        if (msUntilStart <= AUTO_CANCEL_CHECK_HOURS * 60 * 60 * 1000 && dropinIds.length > 0) {
          await checkAutoCancel(template, occurrenceId, dropinIds);
        }
      }
    } catch (err: any) {
      logger.error(
        { err: err?.message, templateId: template.id },
        "[dropin-prestart] Error processing template",
      );
    }
  }
}

export function startDropinPreStartScheduler(): void {
  const run = () => {
    runPreStartJobs()
      .then(() => logger.info("[dropin-prestart] Scheduler run complete"))
      .catch((err) => logger.error({ err: err?.message }, "[dropin-prestart] Scheduler run failed"));
  };

  run();
  setInterval(run, JOB_INTERVAL_MS);
  logger.info("[dropin-prestart] Scheduler started (interval: 30m, window: 24h)");
}
