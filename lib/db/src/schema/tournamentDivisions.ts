import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tournamentsTable } from "./tournaments";

export const tournamentDivisionsTable = pgTable("tournament_divisions", {
  id: serial("id").primaryKey(),
  tournamentId: integer("tournament_id")
    .notNull()
    .references(() => tournamentsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  ageGroups: text("age_groups").array().notNull().default([]),
  bracketFormat: text("bracket_format"),
  hasGroupStage: boolean("has_group_stage"),
  divisionOrder: integer("division_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertTournamentDivisionSchema = createInsertSchema(tournamentDivisionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTournamentDivision = z.infer<typeof insertTournamentDivisionSchema>;
export type TournamentDivision = typeof tournamentDivisionsTable.$inferSelect;
