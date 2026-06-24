import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { kotcTeamsTable } from "./kotcTeams";
import { kotcSeasonsTable } from "./kotcSeasons";
import { usersTable } from "./users";

export const kotcPendingPurchasesTable = pgTable("kotc_pending_purchases", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull().references(() => kotcTeamsTable.id, { onDelete: "cascade" }),
  seasonId: integer("season_id").notNull().references(() => kotcSeasonsTable.id, { onDelete: "cascade" }),
  guardianUserId: integer("guardian_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  packIndex: integer("pack_index").notNull(),
  packName: text("pack_name").notNull(),
  packLives: integer("pack_lives").notNull(),
  packPriceCents: integer("pack_price_cents").notNull(),
  stripeSessionId: text("stripe_session_id"),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type KotcPendingPurchase = typeof kotcPendingPurchasesTable.$inferSelect;
export type InsertKotcPendingPurchase = typeof kotcPendingPurchasesTable.$inferInsert;
