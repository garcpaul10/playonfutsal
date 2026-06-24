import { pgTable, serial, integer, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export interface DropinPoolPresetConfig {
  courtId: number;
  cap: number;
  price: string;
  ageGroup: string[];
  skillLevel: string;
  gender: string | null;
  offerWindowMinutes?: number;
}

export const dropinPoolPresetsTable = pgTable("dropin_pool_presets", {
  id: serial("id").primaryKey(),
  createdByUserId: integer("created_by_user_id"),
  name: text("name").notNull(),
  config: jsonb("config").$type<DropinPoolPresetConfig>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertDropinPoolPresetSchema = createInsertSchema(dropinPoolPresetsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDropinPoolPreset = z.infer<typeof insertDropinPoolPresetSchema>;
export type DropinPoolPreset = typeof dropinPoolPresetsTable.$inferSelect;
