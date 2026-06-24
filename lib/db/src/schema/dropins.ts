import { pgTable, text, serial, boolean, integer, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const dropinsTable = pgTable("dropins", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  ageGroup: text("age_group").array().notNull().default(["adult"]), // text[]: u8 | u9 | … | u18 | adult
  skillLevel: text("skill_level").notNull().default("all"), // all | beginner | intermediate | advanced
  courtId: integer("court_id").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(120),
  price: numeric("price", { precision: 10, scale: 2 }).notNull().default("0"),
  maxPlayers: integer("max_players"),
  registrationOpen: boolean("registration_open").notNull().default(false),
  status: text("status").notNull().default("upcoming"), // upcoming | active | completed | cancelled
  cancellationWindowMinutes: integer("cancellation_window_minutes").notNull().default(120),
  templateId: integer("template_id"),
  description: text("description"),
  gender: text("gender"),
  activeOverride: text("active_override"),
  imageUrl: text("image_url"),
  isPublished: boolean("is_published").notNull().default(true),
  isFeatured: boolean("is_featured").notNull().default(false),
  showOnMobile: boolean("show_on_mobile").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertDropinSchema = createInsertSchema(dropinsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDropin = z.infer<typeof insertDropinSchema>;
export type Dropin = typeof dropinsTable.$inferSelect;
