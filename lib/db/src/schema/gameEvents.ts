import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { fixturesTable } from "./fixtures";
import { teamsTable } from "./teams";

export const gameEventsTable = pgTable("game_events", {
  id: serial("id").primaryKey(),
  fixtureId: integer("fixture_id")
    .notNull()
    .references(() => fixturesTable.id, { onDelete: "cascade" }),
  teamId: integer("team_id")
    .references(() => teamsTable.id, { onDelete: "set null" }),
  eventType: text("event_type").notNull(), // score | foul | timeout
  playerId: integer("player_id")
    .references(() => usersTable.id, { onDelete: "set null" }),
  value: integer("value").notNull().default(1),
  recordedByUserId: integer("recorded_by_user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertGameEventSchema = createInsertSchema(gameEventsTable).omit({ id: true, createdAt: true });
export type InsertGameEvent = z.infer<typeof insertGameEventSchema>;
export type GameEvent = typeof gameEventsTable.$inferSelect;
