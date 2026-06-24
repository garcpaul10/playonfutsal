import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const spotsTable = pgTable("spots", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull().default("dropin"),
  entityId: integer("entity_id").notNull(),
  poolId: integer("pool_id"), // FK to dropin_court_pools.id — null for non-pool spots
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("reserved"), // reserved | cancelled | promoted
  paymentStatus: text("payment_status").notNull().default("unpaid"), // unpaid | paid_inapp | paid_external | refunded | waived
  waitlisted: boolean("waitlisted").notNull().default(false),
  waitlistPosition: integer("waitlist_position"),
  noShow: boolean("no_show").notNull().default(false),
  promotedFromWaitlist: boolean("promoted_from_waitlist").notNull().default(false),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancellationReason: text("cancellation_reason"),
  guardianUserId: integer("guardian_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  notes: text("notes"),
  // Waitlist offer tracking (paid pools: offer dispatched, player has window to pay)
  offerSentAt: timestamp("offer_sent_at", { withTimezone: true }),
  offerExpiresAt: timestamp("offer_expires_at", { withTimezone: true }),
  stripeCheckoutSessionId: text("stripe_checkout_session_id"),
  guestName: text("guest_name"),
  guestEmail: text("guest_email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSpotSchema = createInsertSchema(spotsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSpot = z.infer<typeof insertSpotSchema>;
export type Spot = typeof spotsTable.$inferSelect;
