import { pgTable, serial, integer, text, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const guardianStatusEnum = pgEnum("guardian_status", ["pending", "approved", "rejected"]);

export const guardiansTable = pgTable("guardians", {
  id: serial("id").primaryKey(),
  guardianUserId: integer("guardian_user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  youthUserId: integer("youth_user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  relationship: text("relationship").notNull().default("parent"),
  isPrimary: boolean("is_primary").notNull().default(true),
  canRegister: boolean("can_register").notNull().default(true),
  canPickup: boolean("can_pickup").notNull().default(true),
  status: guardianStatusEnum("status").notNull().default("pending"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertGuardianSchema = createInsertSchema(guardiansTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertGuardian = z.infer<typeof insertGuardianSchema>;
export type Guardian = typeof guardiansTable.$inferSelect;
