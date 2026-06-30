import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const rentalSettingsTable = pgTable("rental_settings", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  enabledCourts: text("enabled_courts").notNull().default("1,2"), // comma-separated court numbers
  openTime: text("open_time").notNull().default("08:00"),
  closeTime: text("close_time").notNull().default("22:00"),
  advanceBookingDays: integer("advance_booking_days").notNull().default(30),
  minDurationMinutes: integer("min_duration_minutes").notNull().default(60),
  slotIncrementMinutes: integer("slot_increment_minutes").notNull().default(30),
  cancellationHours: integer("cancellation_hours").notNull().default(24),
  requiresApproval: boolean("requires_approval").notNull().default(false),
  isPublished: boolean("is_published").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
