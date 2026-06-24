import { pgTable, serial, text, numeric, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const payoutRateConfigsTable = pgTable("payout_rate_configs", {
  id: serial("id").primaryKey(),
  role: text("role").notNull(),
  eventType: text("event_type").notNull(),
  rateType: text("rate_type").notNull().default("flat_per_game"),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdByClerkId: text("created_by_clerk_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPayoutRateConfigSchema = createInsertSchema(payoutRateConfigsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPayoutRateConfig = z.infer<typeof insertPayoutRateConfigSchema>;
export type PayoutRateConfig = typeof payoutRateConfigsTable.$inferSelect;
