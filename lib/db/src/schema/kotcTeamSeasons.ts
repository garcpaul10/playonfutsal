import { pgTable, serial, integer, text, boolean, timestamp, unique } from "drizzle-orm/pg-core";
import { kotcTeamsTable } from "./kotcTeams";
import { kotcSeasonsTable } from "./kotcSeasons";

// A team's registration for a single season. A team (captain) can have many of
// these rows over time, but never more than one active registration per season —
// enforced by the unique(teamId, seasonId) constraint.
export const kotcTeamSeasonsTable = pgTable("kotc_team_seasons", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull().references(() => kotcTeamsTable.id, { onDelete: "cascade" }),
  seasonId: integer("season_id").notNull().references(() => kotcSeasonsTable.id, { onDelete: "cascade" }),
  livesBalance: integer("lives_balance").notNull().default(0),
  livesConsumed: integer("lives_consumed").notNull().default(0),
  status: text("status").notNull().default("active"),
  isReigning: boolean("is_reigning").notNull().default(false),
  firstPurchaseAt: timestamp("first_purchase_at", { withTimezone: true }),
  guardianSpendingCapCents: integer("guardian_spending_cap_cents"),
  totalPurchasedCents: integer("total_purchased_cents").notNull().default(0),
  registeredAt: timestamp("registered_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => ({
  teamSeasonUnique: unique("kotc_team_seasons_team_season_unique").on(t.teamId, t.seasonId),
}));

export type KotcTeamSeason = typeof kotcTeamSeasonsTable.$inferSelect;
export type InsertKotcTeamSeason = typeof kotcTeamSeasonsTable.$inferInsert;
