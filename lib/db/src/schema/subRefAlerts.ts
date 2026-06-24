import { pgTable, serial, integer, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const subRefAlertStatusEnum = pgEnum("sub_ref_alert_status", ["open", "claimed", "filled", "cancelled"]);

/**
 * SubRefAlert — substitute referee request/alert.
 * Created when a scheduled referee is unavailable for a fixture.
 * Notifies eligible substitute referees; first to claim fills the slot.
 * Links to the requesting staff member, optional fixture, and claimed referee.
 */
export const subRefAlertsTable = pgTable("sub_ref_alerts", {
  id: serial("id").primaryKey(),
  requestedByUserId: integer("requested_by_user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  claimedByUserId: integer("claimed_by_user_id")
    .references(() => usersTable.id, { onDelete: "set null" }),
  fixtureId: integer("fixture_id"),
  gameDate: timestamp("game_date", { withTimezone: true }),
  notes: text("notes"),
  status: subRefAlertStatusEnum("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type SubRefAlert = typeof subRefAlertsTable.$inferSelect;
export type InsertSubRefAlert = typeof subRefAlertsTable.$inferInsert;
