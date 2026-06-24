import { pgTable, serial, integer, text, boolean, date, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const playerProfilesTable = pgTable("player_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .unique()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  displayName: text("display_name"),
  dateOfBirth: date("date_of_birth"),
  gender: text("gender"),
  dominantFoot: text("dominant_foot").default("right"),
  primaryPosition: text("primary_position"),
  secondaryPosition: text("secondary_position"),
  jerseyNumber: text("jersey_number"),
  heightCm: integer("height_cm"),
  weightKg: integer("weight_kg"),
  bio: text("bio"),
  profilePhotoUrl: text("profile_photo_url"),
  qrCode: text("qr_code").unique(),
  emergencyContactName: text("emergency_contact_name"),
  emergencyContactPhone: text("emergency_contact_phone"),
  emergencyContactRelationship: text("emergency_contact_relationship"),
  medicalConditions: text("medical_conditions"),
  allergies: text("allergies"),
  fitnessLevel: text("fitness_level").default("recreational"),
  isPublic: boolean("is_public").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPlayerProfileSchema = createInsertSchema(playerProfilesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPlayerProfile = z.infer<typeof insertPlayerProfileSchema>;
export type PlayerProfile = typeof playerProfilesTable.$inferSelect;
