import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { ageGroupsTable } from "./ageGroups";
import { courtsTable } from "./courts";

export const ageGroupMappingsTable = pgTable("age_group_mappings", {
  id: serial("id").primaryKey(),
  ageGroupId: integer("age_group_id")
    .notNull()
    .references(() => ageGroupsTable.id, { onDelete: "cascade" }),
  defaultCourtId: integer("default_court_id")
    .references(() => courtsTable.id, { onDelete: "set null" }),
  defaultFormat: text("default_format").notNull().default("5v5"),
  defaultDurationMinutes: integer("default_duration_minutes").notNull().default(60),
  timebandStart: text("timeband_start"),
  timebandEnd: text("timeband_end"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAgeGroupMappingSchema = createInsertSchema(ageGroupMappingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAgeGroupMapping = z.infer<typeof insertAgeGroupMappingSchema>;
export type AgeGroupMapping = typeof ageGroupMappingsTable.$inferSelect;
