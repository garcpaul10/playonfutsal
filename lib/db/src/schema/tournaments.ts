import {
  pgTable,
  text,
  serial,
  boolean,
  integer,
  numeric,
  timestamp,
  date,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tournamentsTable = pgTable("tournaments", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  ageGroup: text("age_group").array().notNull().default(["adult"]),
  format: text("format").notNull().default("5v5"),
  courtId: integer("court_id").notNull(),
  venueId: integer("venue_id"),
  status: text("status").notNull().default("upcoming"),
  teamPrice: numeric("team_price", { precision: 10, scale: 2 }).notNull().default("0"),
  maxTeams: integer("max_teams").notNull().default(8),
  teamsRegistered: integer("teams_registered").notNull().default(0),
  registrationOpen: boolean("registration_open").notNull().default(false),
  registrationDeadline: timestamp("registration_deadline", { withTimezone: true }),
  startDate: date("start_date"),
  endDate: date("end_date"),
  description: text("description"),
  imageUrl: text("image_url"),
  prizePot: numeric("prize_pot", { precision: 10, scale: 2 }),
  bracketFormat: text("bracket_format").notNull().default("single_elimination"),
  hasGroupStage: boolean("has_group_stage").notNull().default(false),
  groupStageTeams: integer("group_stage_teams"),
  playoffTeams: integer("playoff_teams"),
  depositAmount: numeric("deposit_amount", { precision: 10, scale: 2 }),
  balanceDueDate: timestamp("balance_due_date", { withTimezone: true }),
  tiebreakerRules: text("tiebreaker_rules"),
  consolationEnabled: boolean("consolation_enabled").notNull().default(false),
  seedingMethod: text("seeding_method").notNull().default("manual"),
  gender: text("gender"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  activeOverride: text("active_override"),
  isPublished: boolean("is_published").notNull().default(true),
  isFeatured: boolean("is_featured").notNull().default(false),
  showOnMobile: boolean("show_on_mobile").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertTournamentSchema = createInsertSchema(tournamentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTournament = z.infer<typeof insertTournamentSchema>;
export type Tournament = typeof tournamentsTable.$inferSelect;
