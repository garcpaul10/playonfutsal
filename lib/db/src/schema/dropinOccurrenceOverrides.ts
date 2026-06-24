import { pgTable, serial, integer, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { dropinOccurrencesTable } from "./dropinOccurrences";
import { dropinTemplatePoolsTable } from "./dropinTemplatePools";

export const dropinOccurrenceOverridesTable = pgTable("dropin_occurrence_overrides", {
  id: serial("id").primaryKey(),
  occurrenceId: integer("occurrence_id").notNull().references(() => dropinOccurrencesTable.id, { onDelete: "cascade" }),
  templatePoolId: integer("template_pool_id").references(() => dropinTemplatePoolsTable.id, { onDelete: "cascade" }),
  field: text("field").notNull(),
  value: jsonb("value"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDropinOccurrenceOverrideSchema = createInsertSchema(dropinOccurrenceOverridesTable).omit({ id: true, createdAt: true });
export type InsertDropinOccurrenceOverride = z.infer<typeof insertDropinOccurrenceOverrideSchema>;
export type DropinOccurrenceOverride = typeof dropinOccurrenceOverridesTable.$inferSelect;
