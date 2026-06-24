import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { kotcBattlesTable } from "./kotcBattles";
import { kotcTeamsTable } from "./kotcTeams";

export const kotcWaitlistTable = pgTable("kotc_waitlist", {
  id: serial("id").primaryKey(),
  battleId: integer("battle_id").notNull().references(() => kotcBattlesTable.id, { onDelete: "cascade" }),
  teamId: integer("team_id").notNull().references(() => kotcTeamsTable.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  status: text("status").notNull().default("waiting"),
  carryForward: boolean("carry_forward").notNull().default(false),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
  responseDeadline: timestamp("response_deadline", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type KotcWaitlist = typeof kotcWaitlistTable.$inferSelect;
export type InsertKotcWaitlist = typeof kotcWaitlistTable.$inferInsert;
