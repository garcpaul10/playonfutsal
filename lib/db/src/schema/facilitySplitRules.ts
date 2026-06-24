import { pgTable, serial, integer, text, numeric, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { venuesTable } from "./venues";

export const splitTypeEnum = pgEnum("split_type", ["percentage", "flat", "hybrid"]);

/**
 * FacilitySplitRule — admin-editable revenue split between PlayOn and the venue.
 * Versioned: edits create new rows; old rows preserved with isLatest=false.
 * Applies to a venue (venueId required). offeringType + offeringId optionally scope to one offering.
 */
export const facilitySplitRulesTable = pgTable("facility_split_rules", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  venueId: integer("venue_id").references(() => venuesTable.id, { onDelete: "cascade" }),

  /** Optional: scope to one offering type, e.g. "league" */
  offeringType: text("offering_type"),
  /** Optional: scope to one specific offering id (requires offeringType) */
  offeringId: integer("offering_id"),

  /**
   * percentage — facility takes facilityPct % of gross revenue.
   * flat       — facility charges flatFee per flatFeeUnit.
   * hybrid     — flatFee first, then facilityPct on the remainder.
   */
  splitType: splitTypeEnum("split_type").notNull().default("percentage"),
  /** Facility's percentage share, e.g. 20.00 = 20% */
  facilityPct: numeric("facility_pct", { precision: 5, scale: 2 }),
  /** Flat fee amount in USD */
  flatFee: numeric("flat_fee", { precision: 10, scale: 2 }),
  /** "per_session" | "per_event" | "per_hour" */
  flatFeeUnit: text("flat_fee_unit"),

  // ── Versioning ───────────────────────────────────────────────────────────
  version: integer("version").notNull().default(1),
  isLatest: boolean("is_latest").notNull().default(true),
  supersededById: integer("superseded_by_id"),

  // ── Metadata ─────────────────────────────────────────────────────────────
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdByClerkId: text("created_by_clerk_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertFacilitySplitRuleSchema = createInsertSchema(facilitySplitRulesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertFacilitySplitRule = z.infer<typeof insertFacilitySplitRuleSchema>;
export type FacilitySplitRule = typeof facilitySplitRulesTable.$inferSelect;
