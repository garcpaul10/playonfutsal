import { pgTable, serial, integer, text, boolean, timestamp, numeric, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { dropinTemplatesTable } from "./dropinTemplates";

export interface EarlyBirdPricing {
  price: number;
  triggerType: "date" | "spots_taken";
  triggerDate?: string;
  triggerSpotsCount?: number;
}

export const dropinTemplatePoolsTable = pgTable("dropin_template_pools", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => dropinTemplatesTable.id, { onDelete: "cascade" }),
  courtId: integer("court_id").notNull(),
  cap: integer("cap").notNull().default(15),
  price: numeric("price", { precision: 10, scale: 2 }).notNull().default("0"),
  ageGroup: text("age_group").array().notNull().default(["adult"]),
  skillLevel: text("skill_level").notNull().default("all"),
  gender: text("gender"),
  earlyBirdPricing: jsonb("early_bird_pricing").$type<EarlyBirdPricing | null>(),
  cancellationPhaseOverrides: jsonb("cancellation_phase_overrides"),
  offerWindowMinutes: integer("offer_window_minutes").notNull().default(240),
  startTime: text("start_time"),
  durationMinutes: integer("duration_minutes"),
  sortOrder: integer("sort_order").notNull().default(0),
  simplifiedRegistration: boolean("simplified_registration").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertDropinTemplatePoolSchema = createInsertSchema(dropinTemplatePoolsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDropinTemplatePool = z.infer<typeof insertDropinTemplatePoolSchema>;
export type DropinTemplatePool = typeof dropinTemplatePoolsTable.$inferSelect;
