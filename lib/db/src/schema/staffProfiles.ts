import { pgTable, serial, integer, text, boolean, date, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const staffProfilesTable = pgTable("staff_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .unique()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  title: text("title"),
  bio: text("bio"),
  certifications: text("certifications").array().notNull().default([]),
  backgroundCheckStatus: text("background_check_status").notNull().default("pending"),
  backgroundCheckDate: date("background_check_date"),
  backgroundCheckExpiry: date("background_check_expiry"),
  certificationExpiry: date("certification_expiry"),
  scopedPermissions: text("scoped_permissions").array().notNull().default([]),
  // Program management
  canManageLeagues: boolean("can_manage_leagues").notNull().default(false),
  canManageCamps: boolean("can_manage_camps").notNull().default(false),
  canManageDropins: boolean("can_manage_dropins").notNull().default(false),
  canManageTournaments: boolean("can_manage_tournaments").notNull().default(false),
  // Registration & user management
  canViewRegistrations: boolean("can_view_registrations").notNull().default(true),
  canEditRegistrations: boolean("can_edit_registrations").notNull().default(false),
  canManageUsers: boolean("can_manage_users").notNull().default(false),
  // Facility management
  canManageCourts: boolean("can_manage_courts").notNull().default(false),
  canManageVenues: boolean("can_manage_venues").notNull().default(false),
  canManageAgeGroups: boolean("can_manage_age_groups").notNull().default(false),
  // Finance
  canViewReports: boolean("can_view_reports").notNull().default(false),
  canProcessRefunds: boolean("can_process_refunds").notNull().default(false),
  canManagePayouts: boolean("can_manage_payouts").notNull().default(false),
  // Scheduling & Operations
  canManageSchedules: boolean("can_manage_schedules").notNull().default(false),
  canManageAssignments: boolean("can_manage_assignments").notNull().default(false),
  // Announcements
  canManageAnnouncements: boolean("can_manage_announcements").notNull().default(false),
  // Game cards / Disciplinary
  canManageGameCards: boolean("can_manage_game_cards").notNull().default(false),
  /** Rules training completion timestamp — set when all required sections are passed */
  trainingCompletedAt: timestamp("training_completed_at", { withTimezone: true }),
  /** Per-section training progress JSON — { "1": { passed, score, total, completedAt }, ... } */
  trainingProgress: jsonb("training_progress"),
  /** Stripe Connect connected account ID — set after onboarding completes */
  connectAccountId: text("connect_account_id"),
  /** Stripe Connect onboarding status: "pending" | "onboarding" | "complete" | "restricted" */
  connectOnboardingStatus: text("connect_onboarding_status").notNull().default("pending"),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertStaffProfileSchema = createInsertSchema(staffProfilesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertStaffProfile = z.infer<typeof insertStaffProfileSchema>;
export type StaffProfile = typeof staffProfilesTable.$inferSelect;
