import { pgTable, text, serial, boolean, integer, numeric, timestamp, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const campsTable = pgTable("camps", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  ageGroup: text("age_group").array().notNull().default(["adult"]),
  courtId: integer("court_id").notNull(),
  status: text("status").notNull().default("upcoming"), // upcoming | active | completed | cancelled
  price: numeric("price", { precision: 10, scale: 2 }).notNull().default("0"),
  maxParticipants: integer("max_participants").notNull().default(20),
  participantsRegistered: integer("participants_registered").notNull().default(0),
  registrationOpen: boolean("registration_open").notNull().default(false),
  registrationDeadline: timestamp("registration_deadline", { withTimezone: true }),
  startDate: date("start_date"),
  endDate: date("end_date"),
  description: text("description"),
  imageUrl: text("image_url"),
  coachName: text("coach_name"),
  pricingRuleId: integer("pricing_rule_id"),
  gender: text("gender"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  activeOverride: text("active_override"),
  isPublished: boolean("is_published").notNull().default(true),
  isFeatured: boolean("is_featured").notNull().default(false),
  showOnMobile: boolean("show_on_mobile").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCampSchema = createInsertSchema(campsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCamp = z.infer<typeof insertCampSchema>;
export type Camp = typeof campsTable.$inferSelect;
