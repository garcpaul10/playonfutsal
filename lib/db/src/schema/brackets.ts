import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const bracketsTable = pgTable("brackets", {
  id: serial("id").primaryKey(),
  tournamentId: integer("tournament_id").notNull(),
  name: text("name").notNull(),
  bracketType: text("bracket_type").notNull().default("single_elimination"),
  ageGroup: text("age_group"),
  totalTeams: integer("total_teams"),
  currentRound: integer("current_round").notNull().default(1),
  totalRounds: integer("total_rounds"),
  status: text("status").notNull().default("draft"),
  isLocked: boolean("is_locked").notNull().default(false),
  bracketData: text("bracket_data"),
  notes: text("notes"),
  divisionId: integer("division_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBracketSchema = createInsertSchema(bracketsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBracket = z.infer<typeof insertBracketSchema>;
export type Bracket = typeof bracketsTable.$inferSelect;
