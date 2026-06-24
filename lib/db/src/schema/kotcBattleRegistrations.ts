import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { kotcBattlesTable } from "./kotcBattles";
import { kotcTeamsTable } from "./kotcTeams";

export const kotcBattleRegistrationsTable = pgTable("kotc_battle_registrations", {
  id: serial("id").primaryKey(),
  battleId: integer("battle_id").notNull().references(() => kotcBattlesTable.id, { onDelete: "cascade" }),
  teamId: integer("team_id").notNull().references(() => kotcTeamsTable.id, { onDelete: "cascade" }),
  courtNumber: integer("court_number").notNull().default(1),
  actingCaptainUserId: integer("acting_captain_user_id"),
  status: text("status").notNull().default("registered"),
  registeredAt: timestamp("registered_at", { withTimezone: true }).notNull().defaultNow(),
  checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
});

export type KotcBattleRegistration = typeof kotcBattleRegistrationsTable.$inferSelect;
export type InsertKotcBattleRegistration = typeof kotcBattleRegistrationsTable.$inferInsert;
