import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const seasonRecapsTable = pgTable("season_recaps", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  seasonLabel: text("season_label").notNull(),
  gamesPlayed: integer("games_played").notNull().default(0),
  gamesAttended: integer("games_attended").notNull().default(0),
  attendanceRate: text("attendance_rate"),
  coachNote: text("coach_note"),
  positiveHighlight: text("positive_highlight"),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  deliveryChannel: text("delivery_channel").default("email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSeasonRecapSchema = createInsertSchema(seasonRecapsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSeasonRecap = z.infer<typeof insertSeasonRecapSchema>;
export type SeasonRecap = typeof seasonRecapsTable.$inferSelect;
