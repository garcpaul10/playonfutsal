import { pgTable, serial, integer, text, numeric, date, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";

/**
 * RevenueRecord — computed revenue split per offering registration or payment event.
 * grossAmount = what player paid (before facility cut).
 * facilityAmount = facility's share computed from the FacilitySplitRule.
 * serviceFeeAmount = service fee collected.
 * playonNet = grossAmount − facilityAmount.
 *
 * Unique constraint: revenue_records_payment_id_uq — partial unique index on
 * payment_id WHERE payment_id IS NOT NULL. Declared here for Drizzle schema awareness
 * and enforced in Postgres via the migration (CREATE UNIQUE INDEX IF NOT EXISTS …).
 * recordRevenue() relies on ON CONFLICT (payment_id) WHERE payment_id IS NOT NULL
 * to ensure exactly-once insertion under concurrent webhook retries.
 */
export const revenueRecordsTable = pgTable("revenue_records", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id"),
  paymentId: integer("payment_id"),
  splitRuleId: integer("split_rule_id"),
  pricingRuleId: integer("pricing_rule_id"),

  /** Total amount collected from the player */
  grossAmount: numeric("gross_amount", { precision: 10, scale: 2 }).notNull(),
  /** Facility's share per the split rule */
  facilityAmount: numeric("facility_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  /** Service fee collected */
  serviceFeeAmount: numeric("service_fee_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  /** PlayOn's net: gross − facility (service fee is stored separately but not deducted) */
  playonNet: numeric("playon_net", { precision: 10, scale: 2 }).notNull(),

  currency: text("currency").notNull().default("usd"),
  revenueDate: date("revenue_date").notNull(),
  /** "drop_in" | "camp" | "league" | "tournament" */
  category: text("category").notNull().default("registration"),
  description: text("description"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  // Partial unique index — enforces exactly-once revenue per payment.
  // Declared here so Drizzle is aware; the actual index is created via migration.
  index("revenue_records_payment_id_uq").on(t.paymentId).where(sql`${t.paymentId} IS NOT NULL`),
]);

export const insertRevenueRecordSchema = createInsertSchema(revenueRecordsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertRevenueRecord = z.infer<typeof insertRevenueRecordSchema>;
export type RevenueRecord = typeof revenueRecordsTable.$inferSelect;
