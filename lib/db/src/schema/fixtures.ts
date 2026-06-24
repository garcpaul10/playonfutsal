import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { teamsTable } from "./teams";
import { courtsTable } from "./courts";

export const fixturesTable = pgTable("fixtures", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull().default("league"),
  entityId: integer("entity_id").notNull(),
  divisionId: integer("division_id"),
  homeTeamId: integer("home_team_id").references(() => teamsTable.id, { onDelete: "set null" }),
  awayTeamId: integer("away_team_id").references(() => teamsTable.id, { onDelete: "set null" }),
  courtId: integer("court_id").references(() => courtsTable.id, { onDelete: "set null" }),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  status: text("status").notNull().default("scheduled"),
  round: integer("round"),
  phase: text("phase").default("group"),
  refereeUserId: integer("referee_user_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertFixtureSchema = createInsertSchema(fixturesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFixture = z.infer<typeof insertFixtureSchema>;
export type Fixture = typeof fixturesTable.$inferSelect;
