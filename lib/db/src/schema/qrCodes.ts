import { pgTable, serial, text, integer, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const qrCodeScopeEnum = pgEnum("qr_code_scope", ["check_in", "registration", "event", "membership", "kotc_captain"]);

/**
 * QRCode — standalone QR code tracking table.
 * Player profile qrCode field (in playerProfiles) is a shorthand for check-in.
 * This table supports multi-scope QR codes (event access, membership, etc.)
 * and provides audit/revocation capability.
 */
export const qrCodesTable = pgTable("qr_codes", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  scope: qrCodeScopeEnum("scope").notNull().default("check_in"),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  isActive: boolean("is_active").notNull().default(true),
  scannedAt: timestamp("scanned_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type QrCode = typeof qrCodesTable.$inferSelect;
export type InsertQrCode = typeof qrCodesTable.$inferInsert;
