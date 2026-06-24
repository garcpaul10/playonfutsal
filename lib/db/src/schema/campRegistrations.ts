import { pgTable, serial, integer, text, boolean, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { campsTable } from "./camps";
import { usersTable } from "./users";
import { waiverTemplatesTable } from "./waivers";

export const campRegistrationsTable = pgTable("camp_registrations", {
  id: serial("id").primaryKey(),
  campId: integer("camp_id").notNull().references(() => campsTable.id, { onDelete: "cascade" }),
  /** The account holder who performed the registration (guardian or player) */
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  /** The actual camper (may equal userId for adult players; differs for youth) */
  playerUserId: integer("player_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  status: text("status").notNull().default("pending"), // pending | confirmed | cancelled | waitlisted
  paymentStatus: text("payment_status").notNull().default("unpaid"), // unpaid | paid_inapp | paid_external | refunded | waived
  pricePaid: numeric("price_paid", { precision: 10, scale: 2 }).notNull().default("0"),
  depositPaid: boolean("deposit_paid").notNull().default(false),
  depositAmount: numeric("deposit_amount", { precision: 10, scale: 2 }),
  balanceDue: numeric("balance_due", { precision: 10, scale: 2 }),
  /** Waiver signed by the player (or guardian for youth) */
  waiverSignedAt: timestamp("waiver_signed_at", { withTimezone: true }),
  waiverTemplateId: integer("waiver_template_id").references(() => waiverTemplatesTable.id, { onDelete: "set null" }),
  waiverVersion: integer("waiver_version"),
  /** Guardian waiver + photo consent (youth only) */
  guardianUserId: integer("guardian_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  guardianSignedAt: timestamp("guardian_signed_at", { withTimezone: true }),
  photoConsentGiven: boolean("photo_consent_given").notNull().default(false),
  /** 1 = first child (full price), 2+ = sibling discount applied */
  siblingNumber: integer("sibling_number").notNull().default(1),
  /** FIFO position on the waitlist; null when not waitlisted */
  waitlistPosition: integer("waitlist_position"),
  notes: text("notes"),
  /** Added via migration 0031 — not originally in Drizzle schema */
  skillLevel: text("skill_level"),
  shirtSize: text("shirt_size"),
  healthPacketJson: text("health_packet_json"),
  healthPacketSubmittedAt: timestamp("health_packet_submitted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCampRegistrationSchema = createInsertSchema(campRegistrationsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertCampRegistration = z.infer<typeof insertCampRegistrationSchema>;
export type CampRegistration = typeof campRegistrationsTable.$inferSelect;
