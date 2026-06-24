import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const referralConfigTable = pgTable("referral_config", {
  id: serial("id").primaryKey(),
  rewardCreditCents: integer("reward_credit_cents").notNull().default(1000),
  isEnabled: boolean("is_enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const referralsTable = pgTable("referrals", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  referrerId: integer("referrer_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  referredUserId: integer("referred_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  status: text("status").notNull().default("pending"),
  rewardCreditCents: integer("reward_credit_cents").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
});

export const insertReferralSchema = createInsertSchema(referralsTable).omit({ id: true, createdAt: true });
export type Referral = typeof referralsTable.$inferSelect;
export type ReferralConfig = typeof referralConfigTable.$inferSelect;
export type InsertReferral = z.infer<typeof insertReferralSchema>;
