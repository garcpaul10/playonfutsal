import { pgTable, text, serial, boolean, integer, timestamp, jsonb, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export interface PoolConfig {
  courtId: number;
  ageGroup: string | string[];
  skillLevel: string;
  cap: number;
  dayOfWeek: number;
  startTime: string;
  durationMinutes: number;
  cancellationWindowMinutes: number;
  endsAt?: string | null;
  price?: string | null;
  gender?: string | null;
}

export const sessionTemplatesTable = pgTable("session_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  // Legacy top-level schedule fields — kept for backward compat; prefer poolsConfig
  dayOfWeek: integer("day_of_week").notNull(),
  startTime: text("start_time").notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(120),
  ageGroup: text("age_group").notNull(),
  skillLevel: text("skill_level").notNull().default("all"),
  courtId: integer("court_id").notNull(),
  defaultCap: integer("default_cap").notNull().default(15),
  cancellationWindowMinutes: integer("cancellation_window_minutes").notNull().default(120),
  price: numeric("price", { precision: 10, scale: 2 }).notNull().default("0"),
  gender: text("gender"),
  description: text("description"),
  // Legacy extra pools (no per-pool schedule) — superseded by poolsConfig
  extraPoolsConfig: jsonb("extra_pools_config").$type<Array<{ courtId: number; ageGroup: string; skillLevel: string; cap: number }>>(),
  // New: unified pool list where each entry carries its own independent schedule
  poolsConfig: jsonb("pools_config").$type<PoolConfig[]>(),
  recurrenceInterval: integer("recurrence_interval").default(1),
  recurrenceUnit: text("recurrence_unit").default("week"),
  isActive: boolean("is_active").notNull().default(true),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  lastGeneratedAt: timestamp("last_generated_at", { withTimezone: true }),
  skippedDates: text("skipped_dates").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSessionTemplateSchema = createInsertSchema(sessionTemplatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSessionTemplate = z.infer<typeof insertSessionTemplateSchema>;
export type SessionTemplate = typeof sessionTemplatesTable.$inferSelect;
