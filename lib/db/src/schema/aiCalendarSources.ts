import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * AI Calendar Sources — external organizations whose calendars the system ingests.
 * Fayette County Public Schools (youth_availability), KSSL/KPL/ECNL (alignment_hint).
 */
export const aiCalendarSourcesTable = pgTable("ai_calendar_sources", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  sourceType: text("source_type").notNull().default("youth_availability"),
  fetchUrl: text("fetch_url"),
  isActive: boolean("is_active").notNull().default(true),
  lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
  lastFetchError: text("last_fetch_error"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiCalendarSourceSchema = createInsertSchema(aiCalendarSourcesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiCalendarSource = z.infer<typeof insertAiCalendarSourceSchema>;
export type AiCalendarSource = typeof aiCalendarSourcesTable.$inferSelect;
