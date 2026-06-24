import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ageGroupsTable = pgTable("age_groups", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
  minAge: integer("min_age"),
  maxAge: integer("max_age"),
  division: text("division").notNull().default("youth"),
  displayOrder: integer("display_order").notNull().default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAgeGroupSchema = createInsertSchema(ageGroupsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAgeGroup = z.infer<typeof insertAgeGroupSchema>;
export type AgeGroup = typeof ageGroupsTable.$inferSelect;
