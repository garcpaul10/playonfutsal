import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { courtsTable } from "./courts";
import { usersTable } from "./users";

export const courtAvailabilityTable = pgTable("court_availability", {
  id: serial("id").primaryKey(),
  courtId: integer("court_id").notNull().references(() => courtsTable.id, { onDelete: "cascade" }),
  blockedByUserId: integer("blocked_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  reason: text("reason"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCourtAvailabilitySchema = createInsertSchema(courtAvailabilityTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCourtAvailability = z.infer<typeof insertCourtAvailabilitySchema>;
export type CourtAvailability = typeof courtAvailabilityTable.$inferSelect;
