import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { rentalsTable } from "./rentals";

export const rentalParticipantsTable = pgTable("rental_participants", {
  id: serial("id").primaryKey(),
  rentalId: integer("rental_id").notNull().references(() => rentalsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  signedWaiver: boolean("signed_waiver").notNull().default(false),
  waiverSignedAt: timestamp("waiver_signed_at", { withTimezone: true }),
  waiverTemplateId: integer("waiver_template_id"),
  signatureData: text("signature_data"),
  signatureType: text("signature_type").notNull().default("typed"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RentalParticipant = typeof rentalParticipantsTable.$inferSelect;
