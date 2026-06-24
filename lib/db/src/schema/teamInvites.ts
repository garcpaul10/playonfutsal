import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";

/**
 * Team-level invites sent by captains or managers to onboard new coaches or managers.
 * Distinct from staff_invites (which are platform-level PlayOn staff roles).
 *
 * role: "manager" | "coach"  — team-level role that will be assigned on acceptance
 */
export const teamInvitesTable = pgTable("team_invites", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  email: text("email").notNull(),
  teamId: integer("team_id").notNull(),
  role: text("role").notNull(), // manager | coach
  createdBy: text("created_by").notNull(), // clerk user id of inviter (captain or manager)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  usedBy: text("used_by"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export type TeamInvite = typeof teamInvitesTable.$inferSelect;
export type InsertTeamInvite = typeof teamInvitesTable.$inferInsert;
