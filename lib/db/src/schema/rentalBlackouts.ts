import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const rentalBlackoutsTable = pgTable("rental_blackouts", {
  id: serial("id").primaryKey(),
  courtNumber: integer("court_number"), // null = all courts
  date: text("date").notNull(), // YYYY-MM-DD
  startTime: text("start_time"), // HH:MM, null = all day
  endTime: text("end_time"), // HH:MM, null = all day
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertRentalBlackoutSchema = createInsertSchema(rentalBlackoutsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRentalBlackout = z.infer<typeof insertRentalBlackoutSchema>;
export type RentalBlackout = typeof rentalBlackoutsTable.$inferSelect;
