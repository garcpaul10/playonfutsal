import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { leaguesTable } from "./leagues";

export const leagueDivisionsTable = pgTable("league_divisions", {
  id: serial("id").primaryKey(),
  leagueId: integer("league_id").notNull().references(() => leaguesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  ageGroups: text("age_groups").array().notNull().default([]),
  format: text("format"),
  divisionOrder: integer("division_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertLeagueDivisionSchema = createInsertSchema(leagueDivisionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLeagueDivision = z.infer<typeof insertLeagueDivisionSchema>;
export type LeagueDivision = typeof leagueDivisionsTable.$inferSelect;
