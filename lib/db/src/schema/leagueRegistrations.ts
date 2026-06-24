import { pgTable, serial, integer, text, numeric, boolean, date, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { leaguesTable } from "./leagues";
import { teamsTable } from "./teams";

export const leagueRegistrationsTable = pgTable("league_registrations", {
  id: serial("id").primaryKey(),
  leagueId: integer("league_id").notNull().references(() => leaguesTable.id, { onDelete: "cascade" }),
  teamId: integer("team_id").references(() => teamsTable.id, { onDelete: "set null" }),
  registeredByUserId: text("registered_by_user_id").notNull(),
  depositAmount: numeric("deposit_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  depositPaid: boolean("deposit_paid").notNull().default(false),
  depositPaidAt: timestamp("deposit_paid_at", { withTimezone: true }),
  totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  amountPaid: numeric("amount_paid", { precision: 10, scale: 2 }).notNull().default("0"),
  balanceDue: numeric("balance_due", { precision: 10, scale: 2 }).notNull().default("0"),
  balanceDueDate: date("balance_due_date"),
  paymentStatus: text("payment_status").notNull().default("unpaid"),
  paymentMethod: text("payment_method"),
  status: text("status").notNull().default("pending"),
  balanceOverriddenByAdmin: boolean("balance_overridden_by_admin").notNull().default(false),
  waiverSigned: boolean("waiver_signed").notNull().default(false),
  waiverSignedAt: timestamp("waiver_signed_at", { withTimezone: true }),
  waiverTemplateId: integer("waiver_template_id"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  playBlocked: boolean("play_blocked").notNull().default(false),
  playBlockOverrideBy: text("play_block_override_by"),
  waitlistPosition: integer("waitlist_position"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertLeagueRegistrationSchema = createInsertSchema(leagueRegistrationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLeagueRegistration = z.infer<typeof insertLeagueRegistrationSchema>;
export type LeagueRegistration = typeof leagueRegistrationsTable.$inferSelect;
