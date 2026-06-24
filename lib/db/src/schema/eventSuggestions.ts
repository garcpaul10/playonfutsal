import { pgTable, serial, integer, text, timestamp, date, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const eventSuggestionsTable = pgTable("event_suggestions", {
  id: serial("id").primaryKey(),
  submittedByUserId: integer("submitted_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),

  // ── Core suggestion ──────────────────────────────────────────────────────
  entityType: text("entity_type").notNull().default("drop_in"),
  title: text("title").notNull(),
  description: text("description"),

  // ── Original basic date field ─────────────────────────────────────────────
  suggestedDate: date("suggested_date"),
  suggestedAgeGroup: text("suggested_age_group"),
  suggestedFormat: text("suggested_format"),

  // ── P9: extended AI-suggested scheduling details ──────────────────────────
  suggestedStartDate: date("suggested_start_date"),
  suggestedEndDate: date("suggested_end_date"),
  suggestedCourtId: integer("suggested_court_id"),
  suggestedCapacity: integer("suggested_capacity"),
  suggestedDurationWeeks: integer("suggested_duration_weeks"),
  suggestedFee: numeric("suggested_fee", { precision: 10, scale: 2 }),
  pricingRuleId: integer("pricing_rule_id"),
  seasonAlignment: text("season_alignment"),
  aiModel: text("ai_model"),
  aiRawResponse: text("ai_raw_response"),

  // ── Admin gate ───────────────────────────────────────────────────────────
  status: text("status").notNull().default("pending"),
  reviewNotes: text("review_notes"),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),

  // ── Post-gate: admin adjustments + locked offering ────────────────────────
  adjustedDetails: text("adjusted_details"),
  lockedOfferingType: text("locked_offering_type"),
  lockedOfferingId: integer("locked_offering_id"),
  lockedAt: timestamp("locked_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertEventSuggestionSchema = createInsertSchema(eventSuggestionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEventSuggestion = z.infer<typeof insertEventSuggestionSchema>;
export type EventSuggestion = typeof eventSuggestionsTable.$inferSelect;
