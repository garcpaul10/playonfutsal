import { pgTable, text, serial, integer, numeric, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const rentalPricingTable = pgTable("rental_pricing", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(), // e.g. "1 Hour", "Half Day (4 hrs)", "Full Day (8 hrs)"
  durationMinutes: integer("duration_minutes").notNull(),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertRentalPricingSchema = createInsertSchema(rentalPricingTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRentalPricing = z.infer<typeof insertRentalPricingSchema>;
export type RentalPricing = typeof rentalPricingTable.$inferSelect;
