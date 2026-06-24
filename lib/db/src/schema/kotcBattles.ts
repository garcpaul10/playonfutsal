import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { kotcSeasonsTable } from "./kotcSeasons";

export const kotcBattlesTable = pgTable("kotc_battles", {
  id: serial("id").primaryKey(),
  seasonId: integer("season_id").notNull().references(() => kotcSeasonsTable.id, { onDelete: "cascade" }),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  venueId: integer("venue_id"),
  courtCount: integer("court_count").notNull().default(1),
  courtIds: integer("court_ids").array(),
  maxTeamsPerCourt: integer("max_teams_per_court").notNull().default(8),
  durationMinutes: integer("duration_minutes").notNull().default(120),
  status: text("status").notNull().default("scheduled"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  registrationCutoffAt: timestamp("registration_cutoff_at", { withTimezone: true }),
  waitlistLockedAt: timestamp("waitlist_locked_at", { withTimezone: true }),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  pausedDurationSeconds: integer("paused_duration_seconds").notNull().default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const kotcBattleModsTable = pgTable("kotc_battle_mods", {
  id: serial("id").primaryKey(),
  battleId: integer("battle_id").notNull().references(() => kotcBattlesTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull(),
  courtNumber: integer("court_number").notNull().default(1),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
});

export type KotcBattle = typeof kotcBattlesTable.$inferSelect;
export type InsertKotcBattle = typeof kotcBattlesTable.$inferInsert;
export type KotcBattleMod = typeof kotcBattleModsTable.$inferSelect;
