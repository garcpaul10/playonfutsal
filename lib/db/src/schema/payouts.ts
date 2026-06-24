import { pgTable, serial, integer, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const payoutsTable = pgTable("payouts", {
  id: serial("id").primaryKey(),
  recipientUserId: integer("recipient_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  /** The assignment this payout covers (nullable for manual/bulk payouts) */
  assignmentId: integer("assignment_id"),
  /** The venue this payout covers (nullable for staff payouts) */
  venueId: integer("venue_id"),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("usd"),
  /**
   * Payout status lifecycle:
   *   pending → approved → processing → paid
   *                      ↘ failed (retryable)
   */
  status: text("status").notNull().default("pending"),
  payoutType: text("payout_type").notNull().default("referee_fee"),
  provider: text("provider").default("stripe_connect"),
  /** Stripe Connect connected account ID of recipient */
  connectAccountId: text("connect_account_id"),
  /** Stripe Transfer ID returned on successful execution */
  providerTransferId: text("provider_transfer_id"),
  /** Deprecated — kept for backwards compat */
  providerPayoutId: text("provider_payout_id"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedByUserId: integer("approved_by_user_id"),
  failureReason: text("failure_reason"),
  periodStart: timestamp("period_start", { withTimezone: true }),
  periodEnd: timestamp("period_end", { withTimezone: true }),
  description: text("description"),
  notes: text("notes"),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPayoutSchema = createInsertSchema(payoutsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPayout = z.infer<typeof insertPayoutSchema>;
export type Payout = typeof payoutsTable.$inferSelect;
