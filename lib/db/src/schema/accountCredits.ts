import { pgTable, serial, integer, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const accountCreditsTable = pgTable("account_credits", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  remainingAmount: numeric("remaining_amount", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("usd"),
  reason: text("reason").notNull().default("refund"),
  sourceEntityType: text("source_entity_type"),
  sourceEntityId: integer("source_entity_id"),
  sourcePaymentId: integer("source_payment_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  usedAt: timestamp("used_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAccountCreditSchema = createInsertSchema(accountCreditsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAccountCredit = z.infer<typeof insertAccountCreditSchema>;
export type AccountCredit = typeof accountCreditsTable.$inferSelect;
