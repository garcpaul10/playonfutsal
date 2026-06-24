import { pgTable, text, serial, integer, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const registrationsTable = pgTable("registrations", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(), // clerk user id
  programType: text("program_type").notNull(), // league | camp | drop_in | tournament
  programId: integer("program_id").notNull(),
  programName: text("program_name").notNull().default(""),
  teamId: integer("team_id"),
  status: text("status").notNull().default("pending"), // pending | confirmed | cancelled | waitlisted | pending_payment | expired
  waitlistPosition: integer("waitlist_position"), // FIFO position when status = "waitlisted"
  amountPaid: numeric("amount_paid", { precision: 10, scale: 2 }).notNull().default("0"),
  paymentStatus: text("payment_status").notNull().default("unpaid"), // unpaid | paid | refunded | partial | paid_inapp | paid_external
  expiresAt: timestamp("expires_at", { withTimezone: true }), // set for pending_payment registrations; cleared on confirmation
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertRegistrationSchema = createInsertSchema(registrationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRegistration = z.infer<typeof insertRegistrationSchema>;
export type Registration = typeof registrationsTable.$inferSelect;
