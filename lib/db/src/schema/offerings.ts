import { pgTable, serial, text, integer, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const offeringTypeEnum = pgEnum("offering_type", ["league", "camp", "drop_in", "tournament"]);

/**
 * Offering — polymorphic program reference.
 * Normalizes leagues/camps/dropins/tournaments into a single addressable entity
 * for use in registrations, pricing rules, discount codes, and reporting.
 * programId references the concrete program table keyed by programType.
 */
export const offeringsTable = pgTable("offerings", {
  id: serial("id").primaryKey(),
  programType: offeringTypeEnum("program_type").notNull(),
  programId: integer("program_id").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Offering = typeof offeringsTable.$inferSelect;
export type InsertOffering = typeof offeringsTable.$inferInsert;
