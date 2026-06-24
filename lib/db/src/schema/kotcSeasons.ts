import { pgTable, serial, integer, text, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

export const kotcSeasonsTable = pgTable("kotc_seasons", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  sport: text("sport").notNull().default("basketball"),
  sportConfig: jsonb("sport_config").notNull().default({}),
  genderBracket: text("gender_bracket").notNull().default("coed"),
  ageBracket: text("age_bracket").notNull().default("open"),
  teamSize: integer("team_size").notNull().default(4),
  winCondition: text("win_condition").notNull().default("points"),
  winTarget: integer("win_target").notNull().default(7),
  timeLimitMinutes: integer("time_limit_minutes").notNull().default(5),
  gracePeriodSeconds: integer("grace_period_seconds").notNull().default(60),
  livesRequired: integer("lives_required").notNull().default(3),
  maxTeamsPerCourt: integer("max_teams_per_court").notNull().default(8),
  status: text("status").notNull().default("upcoming"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  venueId: integer("venue_id"),
  priorSeasonId: integer("prior_season_id"),
  championTeamId: integer("champion_team_id"),
  isYouth: boolean("is_youth").notNull().default(false),
  lifePacks: jsonb("life_packs").notNull().default([]),
  waitlistWindowMinutes: integer("waitlist_window_minutes").notNull().default(15),
  notes: text("notes"),
  isPublished: boolean("is_published").notNull().default(false),
  isFeatured: boolean("is_featured").notNull().default(false),
  showOnMobile: boolean("show_on_mobile").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type KotcSeason = typeof kotcSeasonsTable.$inferSelect;
export type InsertKotcSeason = typeof kotcSeasonsTable.$inferInsert;
