import { pgTable, text, serial, integer, numeric, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const rentalsTable = pgTable("rentals", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  courtNumber: integer("court_number").notNull(), // 1 or 2
  date: text("date").notNull(), // YYYY-MM-DD
  startTime: text("start_time").notNull(), // HH:MM 24h
  endTime: text("end_time").notNull(), // HH:MM 24h
  durationMinutes: integer("duration_minutes").notNull(),
  pricingTierId: integer("pricing_tier_id"),
  totalPrice: numeric("total_price", { precision: 10, scale: 2 }).notNull(),
  status: text("status").notNull().default("pending"), // pending | confirmed | cancelled
  paymentStatus: text("payment_status").notNull().default("unpaid"), // unpaid | paid | refunded
  stripeSessionId: text("stripe_session_id"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  notes: text("notes"),
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertRentalSchema = createInsertSchema(rentalsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRental = z.infer<typeof insertRentalSchema>;
export type Rental = typeof rentalsTable.$inferSelect;
