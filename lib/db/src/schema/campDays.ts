import { pgTable, serial, integer, text, date, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { campsTable } from "./camps";

export const campDaysTable = pgTable("camp_days", {
  id: serial("id").primaryKey(),
  campId: integer("camp_id").notNull().references(() => campsTable.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  startTime: text("start_time").notNull().default("09:00"),
  endTime: text("end_time").notNull().default("12:00"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCampDaySchema = createInsertSchema(campDaysTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCampDay = z.infer<typeof insertCampDaySchema>;
export type CampDay = typeof campDaysTable.$inferSelect;
