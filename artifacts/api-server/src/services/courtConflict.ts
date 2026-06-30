/**
 * courtConflict — single source-of-truth court double-booking check.
 *
 * Every write path that places something on a court (fixtures, rentals, drop-ins,
 * camp days, court blocks) must call checkCourtConflict before committing.
 *
 * All comparisons use half-open UTC intervals:  [startsAt, endsAt)
 * Back-to-back events (one ends exactly when the next starts) are NOT conflicts.
 */
import {
  db, fixturesTable, courtAvailabilityTable,
  dropinsTable, campDaysTable, campsTable, rentalsTable,
} from "@workspace/db";
import { eq, and, ne, sql } from "drizzle-orm";

// ─── Public types ─────────────────────────────────────────────────────────────

export type ConflictType = "fixture" | "block" | "dropin" | "campday" | "rental";

export interface CourtConflictResult {
  conflict: boolean;
  reason?: string;
  conflictType?: ConflictType;
  conflictId?: number;
}

export interface CheckConflictOptions {
  /** Fixture ID to exclude from the fixture check (used when rescheduling). */
  excludeFixtureId?: number;
  /** Rental ID to exclude from the rental check (used when admin edits a booking). */
  excludeRentalId?: number;
}

// ─── Core check ──────────────────────────────────────────────────────────────

/**
 * Returns the first conflict found for the given court + UTC time window.
 * Checks: fixtures → court blocks → drop-ins → camp days → rentals.
 */
export async function checkCourtConflict(
  courtId: number,
  startsAt: Date,
  endsAt: Date,
  options: CheckConflictOptions = {},
): Promise<CourtConflictResult> {
  const s = startsAt.toISOString();
  const e = endsAt.toISOString();

  // 1 — Fixtures
  const fxRows = await db
    .select({ id: fixturesTable.id })
    .from(fixturesTable)
    .where(
      and(
        eq(fixturesTable.courtId, courtId),
        ne(fixturesTable.status, "cancelled"),
        sql`${fixturesTable.scheduledAt} < ${e}::timestamptz`,
        sql`${fixturesTable.scheduledAt} + (${fixturesTable.durationMinutes} * interval '1 minute') > ${s}::timestamptz`,
      ),
    );
  const fxConflict = fxRows.find((f) => f.id !== options.excludeFixtureId);
  if (fxConflict) {
    return { conflict: true, reason: "Court already has a fixture scheduled during this time", conflictType: "fixture", conflictId: fxConflict.id };
  }

  // 2 — Court blocks (admin-created via the block wizard)
  const blockRows = await db
    .select({ id: courtAvailabilityTable.id, reason: courtAvailabilityTable.reason })
    .from(courtAvailabilityTable)
    .where(
      and(
        eq(courtAvailabilityTable.courtId, courtId),
        sql`${courtAvailabilityTable.startsAt} < ${e}::timestamptz`,
        sql`${courtAvailabilityTable.endsAt} > ${s}::timestamptz`,
      ),
    );
  if (blockRows.length > 0) {
    return { conflict: true, reason: `Court is blocked: ${blockRows[0].reason ?? "unavailable"}`, conflictType: "block", conflictId: blockRows[0].id };
  }

  // 3 — Drop-in sessions
  const dropinRows = await db
    .select({ id: dropinsTable.id })
    .from(dropinsTable)
    .where(
      and(
        eq(dropinsTable.courtId, courtId),
        ne(dropinsTable.status, "cancelled"),
        sql`${dropinsTable.startsAt} < ${e}::timestamptz`,
        sql`${dropinsTable.startsAt} + (${dropinsTable.durationMinutes} * interval '1 minute') > ${s}::timestamptz`,
      ),
    );
  if (dropinRows.length > 0) {
    return { conflict: true, reason: "Court already has a drop-in session during this time", conflictType: "dropin", conflictId: dropinRows[0].id };
  }

  // 4 — Camp days (date+time stored as Eastern text; convert via Postgres AT TIME ZONE)
  const campRows = await db
    .select({ id: campDaysTable.id, campName: campsTable.name })
    .from(campDaysTable)
    .innerJoin(campsTable, eq(campsTable.id, campDaysTable.campId))
    .where(
      and(
        eq(campsTable.courtId, courtId),
        sql`(${campDaysTable.date} + ${campDaysTable.startTime}::time)::timestamp AT TIME ZONE 'America/New_York' < ${e}::timestamptz`,
        sql`(${campDaysTable.date} + ${campDaysTable.endTime}::time)::timestamp AT TIME ZONE 'America/New_York' > ${s}::timestamptz`,
      ),
    );
  if (campRows.length > 0) {
    return { conflict: true, reason: `Court has a camp day during this time (${campRows[0].campName})`, conflictType: "campday", conflictId: campRows[0].id };
  }

  // 5 — Rentals (date+time stored as Eastern text; convert via Postgres AT TIME ZONE)
  const rentalRows = await db
    .select({ id: rentalsTable.id })
    .from(rentalsTable)
    .where(
      and(
        eq(rentalsTable.courtNumber, courtId),
        ne(rentalsTable.status, "cancelled"),
        sql`(${rentalsTable.date} + ${rentalsTable.startTime}::time)::timestamp AT TIME ZONE 'America/New_York' < ${e}::timestamptz`,
        sql`(${rentalsTable.date} + ${rentalsTable.endTime}::time)::timestamp AT TIME ZONE 'America/New_York' > ${s}::timestamptz`,
      ),
    );
  const rentalConflict = rentalRows.find((r) => r.id !== options.excludeRentalId);
  if (rentalConflict) {
    return { conflict: true, reason: "Court already has a confirmed rental during this time", conflictType: "rental", conflictId: rentalConflict.id };
  }

  return { conflict: false };
}

// ─── Utility ─────────────────────────────────────────────────────────────────

/**
 * Convert an Eastern-local date + HH:MM time to a UTC Date.
 * Handles DST correctly by computing the actual Eastern offset for that moment.
 */
export function easternToUtc(date: string, time: string): Date {
  const [h, m] = time.split(":").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const isoStr = `${date}T${pad(h)}:${pad(m)}:00`;
  // Parse as if UTC to get a reference point, then compute Eastern offset for that moment.
  const utcRef = new Date(isoStr + "Z");
  const easternAtRef = new Date(utcRef.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const offsetMs = utcRef.getTime() - easternAtRef.getTime();
  return new Date(utcRef.getTime() + offsetMs);
}
