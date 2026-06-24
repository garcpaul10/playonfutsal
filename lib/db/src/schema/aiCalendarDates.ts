import { pgTable, serial, integer, text, boolean, date, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { aiCalendarSourcesTable } from "./aiCalendarSources";
import { usersTable } from "./users";

/**
 * AI Calendar Dates — individual confirmed/unconfirmed dates from external calendar sources.
 * The AI never schedules on unconfirmed dates.
 *
 * dateType values:
 *   school_day       — normal school day (youth typically unavailable daytime)
 *   school_holiday   — no school (youth available)
 *   break            — school break period (fall break, spring break, summer)
 *   blackout         — explicitly blocked (no events this day)
 *   alignment_hint   — KSSL/KPL/ECNL event (use as scheduling hint, not hard block)
 */
export const aiCalendarDatesTable = pgTable("ai_calendar_dates", {
  id: serial("id").primaryKey(),
  sourceId: integer("source_id").references(() => aiCalendarSourcesTable.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  label: text("label"),
  dateType: text("date_type").notNull().default("school_day"),
  isConfirmed: boolean("is_confirmed").notNull().default(false),
  confirmedByUserId: integer("confirmed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  // Prevents duplicate rows on repeated iCal/CSV fetches — ingestion uses onConflictDoNothing
  sourceDateUq: unique("ai_calendar_dates_source_date_uq").on(table.sourceId, table.date),
}));

export const insertAiCalendarDateSchema = createInsertSchema(aiCalendarDatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiCalendarDate = z.infer<typeof insertAiCalendarDateSchema>;
export type AiCalendarDate = typeof aiCalendarDatesTable.$inferSelect;
