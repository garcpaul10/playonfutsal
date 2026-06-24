import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

export const staffInvitesTable = pgTable("staff_invites", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  email: text("email").notNull(),
  role: text("role").notNull(), // ref | coach | scorekeeper
  createdBy: text("created_by").notNull(), // clerk user id of admin
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  usedBy: text("used_by"), // clerk user id of invitee after registration
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export type StaffInvite = typeof staffInvitesTable.$inferSelect;
export type InsertStaffInvite = typeof staffInvitesTable.$inferInsert;
