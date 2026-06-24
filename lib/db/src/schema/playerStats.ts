import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const playerStatsTable = pgTable("player_stats", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  seasonId: integer("season_id"),
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  goalsScored: integer("goals_scored").notNull().default(0),
  assists: integer("assists").notNull().default(0),
  gamesPlayed: integer("games_played").notNull().default(0),
  gamesAttended: integer("games_attended").notNull().default(0),
  attendanceStreak: integer("attendance_streak").notNull().default(0),
  bestAttendanceStreak: integer("best_attendance_streak").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPlayerStatSchema = createInsertSchema(playerStatsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPlayerStat = z.infer<typeof insertPlayerStatSchema>;
export type PlayerStat = typeof playerStatsTable.$inferSelect;
