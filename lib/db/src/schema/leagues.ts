import { pgTable, text, serial, boolean, integer, numeric, timestamp, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const leaguesTable = pgTable("leagues", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  ageGroup: text("age_group").array().notNull().default(["adult"]),
  format: text("format").notNull().default("5v5"),
  courtId: integer("court_id").notNull(),
  seasonId: integer("season_id").notNull(),
  status: text("status").notNull().default("upcoming"),
  registrationPrice: numeric("registration_price", { precision: 10, scale: 2 }).notNull().default("0"),
  maxTeams: integer("max_teams").notNull().default(8),
  teamsRegistered: integer("teams_registered").notNull().default(0),
  registrationOpen: boolean("registration_open").notNull().default(false),
  registrationDeadline: timestamp("registration_deadline", { withTimezone: true }),
  startDate: date("start_date"),
  endDate: date("end_date"),
  description: text("description"),
  imageUrl: text("image_url"),
  pricingRuleId: integer("pricing_rule_id"),
  divisionOrder: integer("division_order").default(0),
  tiebreakerRules: text("tiebreaker_rules").default('["goal_difference","goals_for","head_to_head"]'),
  playoffEnabled: boolean("playoff_enabled").notNull().default(false),
  playoffTeams: integer("playoff_teams").default(4),
  playoffFormat: text("playoff_format").default("single_elimination"),
  allowFreeAgents: boolean("allow_free_agents").notNull().default(true),
  gender: text("gender"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  activeOverride: text("active_override"),
  isPublished: boolean("is_published").notNull().default(true),
  isFeatured: boolean("is_featured").notNull().default(false),
  showOnMobile: boolean("show_on_mobile").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertLeagueSchema = createInsertSchema(leaguesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLeague = z.infer<typeof insertLeagueSchema>;
export type League = typeof leaguesTable.$inferSelect;
