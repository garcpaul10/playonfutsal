import { pgTable, serial, text, integer, numeric, boolean, date, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const pricingCategoryEnum = pgEnum("pricing_category", ["drop_in", "camp", "league", "tournament"]);

/**
 * PricingRule — admin-editable per-category pricing engine.
 * Each edit creates a NEW version row. The old row gets isLatest=false and supersededById set to the new row id.
 * Old versions are preserved for audit; never retroactively applied to past registrations.
 */
export const pricingRulesTable = pgTable("pricing_rules", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  category: pricingCategoryEnum("category").notNull(),
  version: integer("version").notNull().default(1),
  isLatest: boolean("is_latest").notNull().default(true),
  /** id of the NEWER version that replaced this one (null if this is the current version) */
  supersededById: integer("superseded_by_id"),

  // ── Shared ───────────────────────────────────────────────────────────────
  /** Base price per player / session / day — meaning varies by category */
  basePrice: numeric("base_price", { precision: 10, scale: 2 }),
  /** Discounted price for members */
  memberPrice: numeric("member_price", { precision: 10, scale: 2 }),
  /** Deposit to hold a spot (leagues, tournaments, camps) */
  depositAmount: numeric("deposit_amount", { precision: 10, scale: 2 }),
  depositRequired: boolean("deposit_required").default(false),
  /** Date balance is due in full */
  balanceDueDate: date("balance_due_date"),

  // ── Drop-in ──────────────────────────────────────────────────────────────
  /** JSON: { "beginner": "15.00", "intermediate": "18.00", "advanced": "20.00" } */
  skillTierPricing: text("skill_tier_pricing"),
  /** Sessions per pack (e.g. 5) */
  packSize: integer("pack_size"),
  /** Total price for the pack */
  packPrice: numeric("pack_price", { precision: 10, scale: 2 }),

  // ── Camp ─────────────────────────────────────────────────────────────────
  /** "per_camp" | "per_day" */
  pricingBasis: text("pricing_basis"),
  earlyBirdPrice: numeric("early_bird_price", { precision: 10, scale: 2 }),
  earlyBirdCutoff: date("early_bird_cutoff"),
  lateFee: numeric("late_fee", { precision: 10, scale: 2 }),
  /** % off per additional sibling, e.g. 10 = 10% */
  siblingDiscountPct: numeric("sibling_discount_pct", { precision: 5, scale: 2 }),

  // ── League ───────────────────────────────────────────────────────────────
  /** Fee per team (league registration) */
  teamFee: numeric("team_fee", { precision: 10, scale: 2 }),
  /** Fee per free-agent / individual player */
  playerFee: numeric("player_fee", { precision: 10, scale: 2 }),
  installmentPlan: boolean("installment_plan").default(false),
  installmentCount: integer("installment_count"),

  // ── Tournament ───────────────────────────────────────────────────────────
  /** Entry fee per team */
  teamEntryFee: numeric("team_entry_fee", { precision: 10, scale: 2 }),
  /** Optional additional per-player fee */
  perPlayerFee: numeric("per_player_fee", { precision: 10, scale: 2 }),

  // ── Metadata ─────────────────────────────────────────────────────────────
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdByClerkId: text("created_by_clerk_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPricingRuleSchema = createInsertSchema(pricingRulesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPricingRule = z.infer<typeof insertPricingRuleSchema>;
export type PricingRule = typeof pricingRulesTable.$inferSelect;
