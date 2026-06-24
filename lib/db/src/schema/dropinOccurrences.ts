import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { dropinTemplatesTable } from "./dropinTemplates";

export const dropinOccurrencesTable = pgTable("dropin_occurrences", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => dropinTemplatesTable.id, { onDelete: "cascade" }),
  forkedFromTemplateId: integer("forked_from_template_id"),
  occurrenceDate: text("occurrence_date").notNull(),
  status: text("status").notNull().default("upcoming"),
  cancelledReason: text("cancelled_reason"),
  materializedDropinId: integer("materialized_dropin_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertDropinOccurrenceSchema = createInsertSchema(dropinOccurrencesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDropinOccurrence = z.infer<typeof insertDropinOccurrenceSchema>;
export type DropinOccurrence = typeof dropinOccurrencesTable.$inferSelect;
