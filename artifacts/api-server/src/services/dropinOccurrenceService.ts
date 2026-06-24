/**
 * Lazy occurrence materialization service for drop-in templates.
 *
 * Computes upcoming occurrence dates from a template recurrence rule on the fly.
 * Materializes dropin_occurrences rows (and the legacy dropins + dropin_court_pools rows
 * needed for the existing payment/waitlist/check-in flows) only when a player registers
 * or within 24h of the session start.
 */

import type { RecurrenceRule } from "@workspace/db";

export function pad(n: number, l = 2): string {
  return String(n).padStart(l, "0");
}

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

function addEasternDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

export function toEasternDateString(utc: Date): string {
  const e = toEasternWallClock(utc);
  return `${e.getFullYear()}-${pad(e.getMonth() + 1)}-${pad(e.getDate())}`;
}

/**
 * Given a recurrence rule and a date string "YYYY-MM-DD", return the UTC start timestamp.
 */
export function occurrenceDateToUtc(dateStr: string, startTime: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [h, m] = startTime.split(":").map(Number);
  return easternLocalToUtc(year, month, day, h, m);
}

/**
 * Compute all occurrence dates (YYYY-MM-DD) for a template within a window.
 * Returns dates sorted ascending.
 */
export function computeOccurrenceDates(
  rule: RecurrenceRule,
  opts: { from?: Date; to?: Date; limit?: number } = {},
): string[] {
  const from = opts.from ?? new Date();
  const to = opts.to ?? new Date(from.getTime() + 60 * 24 * 60 * 60 * 1000);
  const limit = opts.limit ?? 500;
  const skipped = new Set(rule.skippedDates ?? []);

  if (rule.type === "one_time") {
    const occDate = rule.startDate;
    if (!occDate) return [];
    const utc = occurrenceDateToUtc(occDate, rule.startTime);
    if (utc < from || utc > to) return [];
    if (skipped.has(occDate)) return [];
    return [occDate];
  }

  // Recurring
  const dayOfWeek = rule.dayOfWeek ?? 1;
  const intervalNum = rule.intervalNum ?? 1;
  const intervalUnit = rule.intervalUnit ?? "week";
  const [h, m] = rule.startTime.split(":").map(Number);

  const results: string[] = [];

  // Find first occurrence on or after startDate that matches dayOfWeek.
  // Always iterate from the series startDate to preserve correct day-of-week alignment
  // and so the lower-bound filter (utc >= from) correctly excludes past occurrences.
  const startEastern = toEasternWallClock(occurrenceDateToUtc(rule.startDate, rule.startTime));
  const startDow = startEastern.getDay();
  const daysToFirst = (dayOfWeek - startDow + 7) % 7;
  let currentEastern = addEasternDays(startEastern, daysToFirst);

  let maxIterations = 10000;

  while (maxIterations-- > 0) {
    const utc = easternLocalToUtc(
      currentEastern.getFullYear(), currentEastern.getMonth() + 1, currentEastern.getDate(), h, m
    );

    if (utc > to) break;

    const dateStr = `${currentEastern.getFullYear()}-${pad(currentEastern.getMonth() + 1)}-${pad(currentEastern.getDate())}`;

    // Check on_date end condition before counting
    if (rule.endCondition === "on_date" && rule.endDate && dateStr > rule.endDate) break;

    // Only add to results if within the requested window and not skipped
    if (utc >= from && !skipped.has(dateStr)) {
      results.push(dateStr);
      if (results.length >= limit) break;
    }

    // after_n: stop once we've collected N future occurrences in the window.
    // This counts only results (future sessions) rather than all sessions since
    // series start, so templates show the full remaining schedule regardless of
    // how long ago they were created — matching the admin wizard preview behaviour.
    if (rule.endCondition === "after_n" && rule.endAfterN && results.length >= rule.endAfterN) break;

    // Advance to next occurrence
    if (intervalUnit === "month") {
      const advanced = new Date(currentEastern.getFullYear(), currentEastern.getMonth() + intervalNum, currentEastern.getDate());
      const dow = advanced.getDay();
      const diff = (dayOfWeek - dow + 7) % 7;
      currentEastern = new Date(advanced.getFullYear(), advanced.getMonth(), advanced.getDate() + diff);
    } else {
      currentEastern = addEasternDays(currentEastern, intervalNum * 7);
    }
  }

  return results;
}

/**
 * Return a human-readable description of a recurrence rule.
 * E.g. "Every Friday at 5:30 PM" or "Every other week on Tuesday at 7:00 PM"
 */
export function describeRecurrenceRule(rule: RecurrenceRule): string {
  if (rule.type === "one_time") {
    const d = new Date(rule.startDate + "T12:00:00");
    return d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  }
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const day = days[rule.dayOfWeek ?? 1] ?? "Unknown";
  const [h, m] = rule.startTime.split(":").map(Number);
  const hour12 = h % 12 || 12;
  const ampm = h >= 12 ? "PM" : "AM";
  const timeStr = `${hour12}:${pad(m)} ${ampm}`;

  if (!rule.intervalNum || rule.intervalNum === 1) {
    return `Every ${day} at ${timeStr}`;
  }
  if (rule.intervalNum === 2 && rule.intervalUnit === "week") {
    return `Every other ${day} at ${timeStr}`;
  }
  return `Every ${rule.intervalNum} ${rule.intervalUnit}s on ${day} at ${timeStr}`;
}
