import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const checkInsTable = pgTable("check_ins", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  checkedInByUserId: integer("checked_in_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  method: text("method").notNull().default("qr"),
  qrCodeScanned: text("qr_code_scanned"),
  isManual: boolean("is_manual").notNull().default(false),
  notes: text("notes"),
  checkedInAt: timestamp("checked_in_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  voidedByUserId: integer("voided_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
});

export const insertCheckInSchema = createInsertSchema(checkInsTable).omit({ id: true, createdAt: true });
export type InsertCheckIn = z.infer<typeof insertCheckInSchema>;
export type CheckIn = typeof checkInsTable.$inferSelect;
