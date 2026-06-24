import { pgTable, serial, text, integer, boolean, time, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { courtsTable } from "./courts";

export const recurringScheduleRulesTable = pgTable("recurring_schedule_rules", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id"),
  courtId: integer("court_id").references(() => courtsTable.id, { onDelete: "set null" }),
  dayOfWeek: integer("day_of_week").notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  format: text("format"),
  maxParticipants: integer("max_participants"),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertRecurringScheduleRuleSchema = createInsertSchema(recurringScheduleRulesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRecurringScheduleRule = z.infer<typeof insertRecurringScheduleRuleSchema>;
export type RecurringScheduleRule = typeof recurringScheduleRulesTable.$inferSelect;
