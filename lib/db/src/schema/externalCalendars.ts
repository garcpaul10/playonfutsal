import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const externalCalendarsTable = pgTable("external_calendars", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("google"),
  calendarId: text("calendar_id"),
  accessTokenEncrypted: text("access_token_encrypted"),
  refreshTokenEncrypted: text("refresh_token_encrypted"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  syncEnabled: boolean("sync_enabled").notNull().default(true),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastSyncError: text("last_sync_error"),
  webhookChannel: text("webhook_channel"),
  webhookExpiry: timestamp("webhook_expiry", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertExternalCalendarSchema = createInsertSchema(externalCalendarsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertExternalCalendar = z.infer<typeof insertExternalCalendarSchema>;
export type ExternalCalendar = typeof externalCalendarsTable.$inferSelect;
