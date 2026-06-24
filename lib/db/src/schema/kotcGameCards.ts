import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { kotcBattlesTable } from "./kotcBattles";
import { kotcTeamsTable } from "./kotcTeams";

export const kotcGameCardsTable = pgTable("kotc_game_cards", {
  id: serial("id").primaryKey(),
  battleId: integer("battle_id").notNull().references(() => kotcBattlesTable.id, { onDelete: "cascade" }),
  courtNumber: integer("court_number").notNull().default(1),
  team1Id: integer("team1_id").notNull().references(() => kotcTeamsTable.id),
  team2Id: integer("team2_id").notNull().references(() => kotcTeamsTable.id),
  winnerTeamId: integer("winner_team_id").references(() => kotcTeamsTable.id),
  loserTeamId: integer("loser_team_id").references(() => kotcTeamsTable.id),
  moderatorUserId: integer("moderator_user_id"),
  status: text("status").notNull().default("in_progress"),
  isDisputed: boolean("is_disputed").notNull().default(false),
  disputeOverrideByUserId: integer("dispute_override_by_user_id"),
  disputeOverrideNotes: text("dispute_override_notes"),
  scannedAt: timestamp("scanned_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type KotcGameCard = typeof kotcGameCardsTable.$inferSelect;
export type InsertKotcGameCard = typeof kotcGameCardsTable.$inferInsert;
