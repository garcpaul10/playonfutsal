import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { teamsTable } from "./teams";

export const standingsTable = pgTable("standings", {
  id: serial("id").primaryKey(),
  leagueId: integer("league_id").notNull(),
  divisionId: integer("division_id"),
  seasonId: integer("season_id"),
  teamId: integer("team_id").notNull().references(() => teamsTable.id, { onDelete: "cascade" }),
  gamesPlayed: integer("games_played").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  draws: integer("draws").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  goalsFor: integer("goals_for").notNull().default(0),
  goalsAgainst: integer("goals_against").notNull().default(0),
  goalDifference: integer("goal_difference").notNull().default(0),
  points: integer("points").notNull().default(0),
  rank: integer("rank"),
  group: text("group"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("standings_league_team_unique").on(t.leagueId, t.teamId),
  uniqueIndex("standings_division_team_unique").on(t.divisionId, t.teamId),
]);

export const insertStandingSchema = createInsertSchema(standingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertStanding = z.infer<typeof insertStandingSchema>;
export type Standing = typeof standingsTable.$inferSelect;
