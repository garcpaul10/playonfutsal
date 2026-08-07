import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { kotcTeamSeasonsTable } from "./kotcTeamSeasons";

export const kotcLifeLedgerTable = pgTable("kotc_life_ledger", {
  id: serial("id").primaryKey(),
  teamSeasonId: integer("team_season_id").notNull().references(() => kotcTeamSeasonsTable.id, { onDelete: "cascade" }),
  delta: integer("delta").notNull(),
  reason: text("reason").notNull(),
  referenceType: text("reference_type"),
  referenceId: integer("reference_id"),
  balanceAfter: integer("balance_after").notNull(),
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type KotcLifeLedger = typeof kotcLifeLedgerTable.$inferSelect;
export type InsertKotcLifeLedger = typeof kotcLifeLedgerTable.$inferInsert;
