import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const broadcastMessagesTable = pgTable("broadcast_messages", {
  id: serial("id").primaryKey(),
  createdBy: integer("created_by")
    .notNull()
    .references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  channels: text("channels").array().notNull().default([]),
  offeringType: text("offering_type"),
  eventId: integer("event_id"),
  poolId: integer("pool_id"),
  statusFilter: text("status_filter"),
  recipientCount: integer("recipient_count").notNull().default(0),
});

export type BroadcastMessage = typeof broadcastMessagesTable.$inferSelect;
