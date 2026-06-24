import { pgTable, serial, integer, text, boolean, timestamp, numeric, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { dropinsTable } from "./dropins";
import { sessionTemplatesTable } from "./sessionTemplates";

export const dropinCourtPoolsTable = pgTable("dropin_court_pools", {
  id: serial("id").primaryKey(),
  dropinId: integer("dropin_id").notNull().references(() => dropinsTable.id, { onDelete: "cascade" }),
  courtId: integer("court_id").notNull(),
  ageGroup: text("age_group").array().notNull(), // text[]: u8 | u9 | … | u18 | adult
  skillLevel: text("skill_level").notNull().default("all"),
  cap: integer("cap").notNull().default(15),
  isClosed: boolean("is_closed").notNull().default(false),
  templateId: integer("template_id").references(() => sessionTemplatesTable.id, { onDelete: "set null" }),
  // Links this row to the specific dropin_template_pools entry it was materialized from.
  // Used as the canonical pool identity bridge (unique per dropin_id + dropin_template_pool_id).
  dropinTemplatePoolId: integer("dropin_template_pool_id"),
  notes: text("notes"),
  // ── Pool-level logistics (moved from Session) ──────────────────────────────
  startsAt: timestamp("starts_at", { withTimezone: true }),
  durationMinutes: integer("duration_minutes").notNull().default(120),
  price: numeric("price", { precision: 10, scale: 2 }).notNull().default("0"),
  cancellationWindowMinutes: integer("cancellation_window_minutes").notNull().default(120),
  refundPolicyId: integer("refund_policy_id"),
  registrationOpen: boolean("registration_open").notNull().default(false),
  activeOverride: text("active_override"),
  gender: text("gender"),
  // ── Per-pool cancellation phase overrides (JSONB) ───────────────────────────
  // Array of { policyId: number, windowMinutes: number } — one entry per global
  // drop_in tier with an overridden minute threshold for this pool.
  // Null = use global policy windows unchanged.
  cancellationPhaseOverrides: jsonb("cancellation_phase_overrides"),
  // ── Waitlist offer window ────────────────────────────────────────────────────
  offerWindowMinutes: integer("offer_window_minutes").notNull().default(240),
  simplifiedRegistration: boolean("simplified_registration").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertDropinCourtPoolSchema = createInsertSchema(dropinCourtPoolsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDropinCourtPool = z.infer<typeof insertDropinCourtPoolSchema>;
export type DropinCourtPool = typeof dropinCourtPoolsTable.$inferSelect;
