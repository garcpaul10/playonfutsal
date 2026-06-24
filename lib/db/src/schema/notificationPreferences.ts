import { pgTable, serial, integer, boolean, text, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const NOTIFICATION_TYPES = [
  "waitlist_movement",
  "cancellation_rainout",
  "payment_receipt",
  "schedule_change",
  "upcoming_session",
  "payment_due",
  "balance_due",
  "announcement",
  "results_standings",
  "sub_ref_alert",
  "fa_match_proposal",
  "fa_match_response",
] as const;

export type NotificationType = typeof NOTIFICATION_TYPES[number];

export const notificationPreferencesTable = pgTable(
  "notification_preferences",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    notificationType: text("notification_type").notNull(),
    channelEmail: boolean("channel_email").notNull().default(true),
    channelSms: boolean("channel_sms").notNull().default(false),
    channelPush: boolean("channel_push").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [unique("uq_notif_pref_user_type").on(t.userId, t.notificationType)],
);

export const insertNotificationPreferenceSchema = createInsertSchema(notificationPreferencesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertNotificationPreference = z.infer<typeof insertNotificationPreferenceSchema>;
export type NotificationPreference = typeof notificationPreferencesTable.$inferSelect;
