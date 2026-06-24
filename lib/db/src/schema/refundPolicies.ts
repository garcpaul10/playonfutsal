import { pgTable, serial, integer, text, numeric, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const refundCreditPoliciesTable = pgTable("refund_credit_policies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  entityType: text("entity_type").notNull().default("all"),
  refundType: text("refund_type").notNull().default("credit"),
  windowDays: integer("window_days").notNull().default(7),
  windowMinutes: integer("window_minutes"),
  refundPercent: numeric("refund_percent", { precision: 5, scale: 2 }).notNull().default("100.00"),
  creditPercent: numeric("credit_percent", { precision: 5, scale: 2 }).notNull().default("100.00"),
  nonRefundableAmount: numeric("non_refundable_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  allowPartialRefund: boolean("allow_partial_refund").notNull().default(true),
  requiresAdminApproval: boolean("requires_admin_approval").notNull().default(false),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertRefundCreditPolicySchema = createInsertSchema(refundCreditPoliciesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRefundCreditPolicy = z.infer<typeof insertRefundCreditPolicySchema>;
export type RefundCreditPolicy = typeof refundCreditPoliciesTable.$inferSelect;
