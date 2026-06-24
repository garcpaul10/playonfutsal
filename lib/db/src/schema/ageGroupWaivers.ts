import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const ageGroupWaiversTable = pgTable("age_group_waivers", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  requestedBy: integer("requested_by")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  ageGroup: text("age_group").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("pending"),
  adminNote: text("admin_note"),
  reviewedBy: integer("reviewed_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AgeGroupWaiver = typeof ageGroupWaiversTable.$inferSelect;
export type InsertAgeGroupWaiver = typeof ageGroupWaiversTable.$inferInsert;
