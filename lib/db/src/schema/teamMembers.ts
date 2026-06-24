import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { teamsTable } from "./teams";

/**
 * Valid team-level roles:
 *   player   — standard roster player
 *   captain  — player who registered the team; inherits all management permissions
 *   manager  — Team Manager: handles admin only, NOT on the player/coach roster
 *   coach    — Team Coach: on the bench/field, appears on the official tournament roster
 *
 * Note: "coach" here is the team-level Team Coach role and is entirely separate from
 * the platform-level "coach" role assigned to PlayOn staff coaches.
 */
export const TEAM_MEMBER_ROLES = ["player", "captain", "manager", "coach"] as const;
export type TeamMemberRole = typeof TEAM_MEMBER_ROLES[number];

/** Roles that carry team management permissions (register team, invite players, approve free agents) */
export const TEAM_MANAGING_ROLES: TeamMemberRole[] = ["captain", "manager", "coach"];

export const teamMembersTable = pgTable("team_members", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull().references(() => teamsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  role: text("role").notNull().default("player"),
  status: text("status").notNull().default("active"),
  waiverSigned: boolean("waiver_signed").notNull().default(false),
  waiverSignedAt: timestamp("waiver_signed_at", { withTimezone: true }),
  waiverTemplateId: integer("waiver_template_id"),
  jerseyNumber: integer("jersey_number"),
  notes: text("notes"),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTeamMemberSchema = createInsertSchema(teamMembersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTeamMember = z.infer<typeof insertTeamMemberSchema>;
export type TeamMember = typeof teamMembersTable.$inferSelect;
