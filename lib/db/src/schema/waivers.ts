import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const waiverTemplatesTable = pgTable("waiver_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  version: integer("version").notNull().default(1),
  body: text("body").notNull(),
  applicableTo: text("applicable_to").notNull().default("all"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const waiverSignaturesTable = pgTable("waiver_signatures", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => waiverTemplatesTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  youthUserId: integer("youth_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  signatureData: text("signature_data"),
  signatureType: text("signature_type").notNull().default("typed"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWaiverTemplateSchema = createInsertSchema(waiverTemplatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertWaiverSignatureSchema = createInsertSchema(waiverSignaturesTable).omit({ id: true, createdAt: true });
export type InsertWaiverTemplate = z.infer<typeof insertWaiverTemplateSchema>;
export type WaiverTemplate = typeof waiverTemplatesTable.$inferSelect;
export type InsertWaiverSignature = z.infer<typeof insertWaiverSignatureSchema>;
export type WaiverSignature = typeof waiverSignaturesTable.$inferSelect;
