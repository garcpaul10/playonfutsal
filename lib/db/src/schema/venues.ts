import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const venuesTable = pgTable("venues", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  city: text("city").notNull().default("Lexington"),
  state: text("state").notNull().default("KY"),
  zip: text("zip"),
  phone: text("phone"),
  website: text("website"),
  notes: text("notes"),
  insuranceProvider: text("insurance_provider"),
  insurancePolicyNumber: text("insurance_policy_number"),
  insuranceExpiry: text("insurance_expiry"),
  /** Stripe Connect Express account ID for facility payout splits */
  stripeConnectAccountId: text("stripe_connect_account_id"),
  /** Stripe Connect onboarding status: "none" | "invited" | "onboarded" | "restricted" */
  stripeConnectOnboardingStatus: text("stripe_connect_onboarding_status").notNull().default("none"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertVenueSchema = createInsertSchema(venuesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVenue = z.infer<typeof insertVenueSchema>;
export type Venue = typeof venuesTable.$inferSelect;
