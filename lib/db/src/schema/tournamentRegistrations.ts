import { pgTable, serial, integer, text, boolean, numeric, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tournamentsTable } from "./tournaments";
import { teamsTable } from "./teams";
import { usersTable } from "./users";

export const tournamentRegistrationsTable = pgTable(
  "tournament_registrations",
  {
    id: serial("id").primaryKey(),
    tournamentId: integer("tournament_id")
      .notNull()
      .references(() => tournamentsTable.id, { onDelete: "cascade" }),
    teamId: integer("team_id").references(() => teamsTable.id, { onDelete: "set null" }),
    registeredByUserId: integer("registered_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    depositAmount: numeric("deposit_amount", { precision: 10, scale: 2 }).notNull().default("0"),
    depositPaid: boolean("deposit_paid").notNull().default(false),
    depositPaidAt: timestamp("deposit_paid_at", { withTimezone: true }),
    totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).notNull().default("0"),
    amountPaid: numeric("amount_paid", { precision: 10, scale: 2 }).notNull().default("0"),
    balanceDueDate: timestamp("balance_due_date", { withTimezone: true }),
    paymentStatus: text("payment_status").notNull().default("unpaid"),
    paymentMethod: text("payment_method"),
    status: text("status").notNull().default("active"),
    balanceOverriddenByAdmin: boolean("balance_overridden_by_admin").notNull().default(false),
    waiverSigned: boolean("waiver_signed").notNull().default(false),
    waiverSignedAt: timestamp("waiver_signed_at", { withTimezone: true }),
    waiverTemplateId: integer("waiver_template_id"),
    selfCheckinConfirmed: boolean("self_checkin_confirmed").notNull().default(false),
    selfCheckinConfirmedAt: timestamp("self_checkin_confirmed_at", { withTimezone: true }),
    selfCheckinRosterJson: text("self_checkin_roster_json"),
    playBlocked: boolean("play_blocked").notNull().default(false),
    playBlockOverrideBy: text("play_block_override_by"),
    waitlistPosition: integer("waitlist_position"),
    divisionId: integer("division_id"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("uniq_tourney_reg_team").on(t.tournamentId, t.teamId)],
);

export const insertTournamentRegistrationSchema = createInsertSchema(
  tournamentRegistrationsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTournamentRegistration = z.infer<typeof insertTournamentRegistrationSchema>;
export type TournamentRegistration = typeof tournamentRegistrationsTable.$inferSelect;
