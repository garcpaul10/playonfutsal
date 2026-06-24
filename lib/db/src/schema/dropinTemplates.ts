import { pgTable, text, serial, boolean, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export interface RecurrenceRule {
  type: "one_time" | "recurring";
  startDate: string;
  startTime: string;
  durationMinutes: number;
  dayOfWeek?: number;
  intervalNum?: number;
  intervalUnit?: "week" | "month";
  endCondition?: "never" | "on_date" | "after_n";
  endDate?: string | null;
  endAfterN?: number | null;
  skippedDates?: string[];
}

export const dropinTemplatesTable = pgTable("dropin_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  sport: text("sport").notNull().default("basketball"),
  venueId: integer("venue_id"),
  description: text("description"),
  imageUrl: text("image_url"),
  recurrenceRule: jsonb("recurrence_rule").$type<RecurrenceRule>().notNull(),
  isDraft: boolean("is_draft").notNull().default(true),
  isPublished: boolean("is_published").notNull().default(false),
  isFeatured: boolean("is_featured").notNull().default(false),
  showOnMobile: boolean("show_on_mobile").notNull().default(false),
  publishAt: timestamp("publish_at", { withTimezone: true }),
  staffUserId: integer("staff_user_id"),
  autoCancelThreshold: integer("auto_cancel_threshold"),
  registrationCutoffMinutes: integer("registration_cutoff_minutes"),
  registrationOpens: text("registration_opens").notNull().default("immediately"),
  registrationOpensAt: timestamp("registration_opens_at", { withTimezone: true }),
  waitlistEnabled: boolean("waitlist_enabled").notNull().default(true),
  autoPromoteEnabled: boolean("auto_promote_enabled").notNull().default(false),
  createdByClerkId: text("created_by_clerk_id"),
  legacySessionTemplateId: integer("legacy_session_template_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertDropinTemplateSchema = createInsertSchema(dropinTemplatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDropinTemplate = z.infer<typeof insertDropinTemplateSchema>;
export type DropinTemplate = typeof dropinTemplatesTable.$inferSelect;
