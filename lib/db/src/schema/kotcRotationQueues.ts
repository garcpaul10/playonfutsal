import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { kotcBattlesTable } from "./kotcBattles";
import { kotcTeamsTable } from "./kotcTeams";

export const kotcRotationQueuesTable = pgTable("kotc_rotation_queues", {
  id: serial("id").primaryKey(),
  battleId: integer("battle_id").notNull().references(() => kotcBattlesTable.id, { onDelete: "cascade" }),
  teamId: integer("team_id").notNull().references(() => kotcTeamsTable.id, { onDelete: "cascade" }),
  courtNumber: integer("court_number").notNull().default(1),
  position: integer("position").notNull(),
  status: text("status").notNull().default("queued"),
  graceStartedAt: timestamp("grace_started_at", { withTimezone: true }),
  graceExpiresAt: timestamp("grace_expires_at", { withTimezone: true }),
  bowedOutAt: timestamp("bowed_out_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type KotcRotationQueue = typeof kotcRotationQueuesTable.$inferSelect;
export type InsertKotcRotationQueue = typeof kotcRotationQueuesTable.$inferInsert;
