import { pgTable, serial, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

// Singleton table — platform-wide KotC rules that apply the same way to every
// division/battle, as opposed to kotc_seasons fields which vary per division.
export const kotcSettingsTable = pgTable("kotc_settings", {
  id: serial("id").primaryKey(),
  maxRosterSize: integer("max_roster_size").notNull().default(5),
  gracePeriodSeconds: integer("grace_period_seconds").notNull().default(60),
  livesRequired: integer("lives_required").notNull().default(1),
  waitlistWindowMinutes: integer("waitlist_window_minutes").notNull().default(15),
  lifePacks: jsonb("life_packs").notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type KotcSettings = typeof kotcSettingsTable.$inferSelect;
export type InsertKotcSettings = typeof kotcSettingsTable.$inferInsert;
