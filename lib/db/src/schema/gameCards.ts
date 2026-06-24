import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { fixturesTable } from "./fixtures";
import { usersTable } from "./users";

export const gameCardsTable = pgTable("game_cards", {
  id: serial("id").primaryKey(),
  fixtureId: integer("fixture_id").notNull().references(() => fixturesTable.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull().default("league"),
  entityId: integer("entity_id").notNull(),
  homeTeamId: integer("home_team_id"),
  awayTeamId: integer("away_team_id"),
  homeTeamName: text("home_team_name"),
  awayTeamName: text("away_team_name"),
  homeRoster: text("home_roster").notNull().default("[]"),
  awayRoster: text("away_roster").notNull().default("[]"),
  refUserIds: text("ref_user_ids").notNull().default("[]"),
  scorekeeperId: integer("scorekeeper_id").references(() => usersTable.id, { onDelete: "set null" }),
  homeScore: integer("home_score").notNull().default(0),
  awayScore: integer("away_score").notNull().default(0),
  homePresent: boolean("home_present").notNull().default(false),
  awayPresent: boolean("away_present").notNull().default(false),
  status: text("status").notNull().default("upcoming"),
  fouls: text("fouls").notNull().default("[]"),
  disciplinaryActions: text("disciplinary_actions").notNull().default("[]"),
  disciplinaryFlagged: boolean("disciplinary_flagged").notNull().default(false),
  disciplinaryReviewedAt: timestamp("disciplinary_reviewed_at", { withTimezone: true }),
  disciplinaryReviewedBy: integer("disciplinary_reviewed_by").references(() => usersTable.id, { onDelete: "set null" }),
  clockState: text("clock_state"),
  accumulatedFouls: text("accumulated_fouls").notNull().default('{"home":0,"away":0,"half":1}'),
  goals: text("goals").notNull().default("[]"),
  corrections: text("corrections").notNull().default("[]"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedBy: integer("approved_by").references(() => usersTable.id, { onDelete: "set null" }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type GameCard = typeof gameCardsTable.$inferSelect;
