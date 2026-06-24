import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { kotcSeasonsTable } from "./kotcSeasons";

export const kotcTeamsTable = pgTable("kotc_teams", {
  id: serial("id").primaryKey(),
  seasonId: integer("season_id").notNull().references(() => kotcSeasonsTable.id, { onDelete: "cascade" }),
  captainUserId: integer("captain_user_id").notNull(),
  name: text("name").notNull(),
  color: text("color"),
  logoUrl: text("logo_url"),
  livesBalance: integer("lives_balance").notNull().default(0),
  livesConsumed: integer("lives_consumed").notNull().default(0),
  status: text("status").notNull().default("active"),
  qrCode: text("qr_code").notNull().unique(),
  isReigning: boolean("is_reigning").notNull().default(false),
  firstPurchaseAt: timestamp("first_purchase_at", { withTimezone: true }),
  guardianSpendingCapCents: integer("guardian_spending_cap_cents"),
  totalPurchasedCents: integer("total_purchased_cents").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const kotcTeamPlayersTable = pgTable("kotc_team_players", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull().references(() => kotcTeamsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull(),
  role: text("role").notNull().default("player"),
  status: text("status").notNull().default("active"),
  rulesAcknowledgedAt: timestamp("rules_acknowledged_at", { withTimezone: true }),
  invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
  joinedAt: timestamp("joined_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type KotcTeam = typeof kotcTeamsTable.$inferSelect;
export type InsertKotcTeam = typeof kotcTeamsTable.$inferInsert;
export type KotcTeamPlayer = typeof kotcTeamPlayersTable.$inferSelect;
export type InsertKotcTeamPlayer = typeof kotcTeamPlayersTable.$inferInsert;
