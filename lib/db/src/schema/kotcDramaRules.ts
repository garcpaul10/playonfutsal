import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { kotcSeasonsTable } from "./kotcSeasons";

export const kotcDramaRulesTable = pgTable("kotc_drama_rules", {
  id: serial("id").primaryKey(),
  seasonId: integer("season_id").notNull().references(() => kotcSeasonsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  triggerType: text("trigger_type").notNull(),
  threshold: integer("threshold").notNull().default(1),
  rewardLives: integer("reward_lives").notNull().default(1),
  notificationMessage: text("notification_message").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type KotcDramaRule = typeof kotcDramaRulesTable.$inferSelect;
export type InsertKotcDramaRule = typeof kotcDramaRulesTable.$inferInsert;
