import { pgTable, serial, text, numeric, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * ServiceFeeConfig — admin-editable pass-through service fee for in-app card payments.
 * Only one config row is active at a time (isActive=true). Editing creates a new row; old rows preserved.
 * Default: ~3% on in-app card payments only. Non-refundable (covers Stripe's processing cost).
 */
export const serviceFeeConfigsTable = pgTable("service_fee_configs", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),

  /** Percentage value, e.g. 3.00 = 3% */
  feePercent: numeric("fee_percent", { precision: 5, scale: 2 }).notNull().default("3.00"),
  /** Optional cap on the fee amount */
  maxFeeAmount: numeric("max_fee_amount", { precision: 10, scale: 2 }),
  /** Optional floor on the fee amount */
  minFeeAmount: numeric("min_fee_amount", { precision: 10, scale: 2 }),

  /** Whether the fee applies to in-app card payments (always true by default) */
  appliesToCard: boolean("applies_to_card").notNull().default(true),
  /** Whether the fee also applies to cash/external payments (default false) */
  appliesToExternal: boolean("applies_to_external").notNull().default(false),
  /** Non-refundable: service fee is never returned on refunds */
  nonRefundable: boolean("non_refundable").notNull().default(true),

  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdByClerkId: text("created_by_clerk_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertServiceFeeConfigSchema = createInsertSchema(serviceFeeConfigsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertServiceFeeConfig = z.infer<typeof insertServiceFeeConfigSchema>;
export type ServiceFeeConfig = typeof serviceFeeConfigsTable.$inferSelect;
