import { pgTable, serial, integer, text, numeric, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  registrationId: integer("registration_id"),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("usd"),
  status: text("status").notNull().default("pending"),
  provider: text("provider").notNull().default("stripe"),
  providerPaymentId: text("provider_payment_id"),
  providerChargeId: text("provider_charge_id"),
  providerCustomerId: text("provider_customer_id"),
  paymentMethod: text("payment_method"),
  receiptUrl: text("receipt_url"),
  failureReason: text("failure_reason"),
  serviceFeeAmount: numeric("service_fee_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  refunded: boolean("refunded").notNull().default(false),
  refundedAt: timestamp("refunded_at", { withTimezone: true }),
  refundAmount: numeric("refund_amount", { precision: 10, scale: 2 }),
  /**
   * Compensation status — null means uncompensated (refundable/creditable).
   * Set atomically to "refunded" or "credited" to prevent duplicate issuance.
   * Use a CAS update (WHERE compensation_status IS NULL) before acting.
   */
  compensationStatus: text("compensation_status"),
  /**
   * Dispute tracking — populated when Stripe fires charge.dispute.* events.
   * disputeStatus: needs_response | under_review | won | lost | warning_needs_response | warning_under_review | warning_closed
   */
  disputeStatus: text("dispute_status"),
  disputedAt: timestamp("disputed_at", { withTimezone: true }),
  metadata: text("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;
