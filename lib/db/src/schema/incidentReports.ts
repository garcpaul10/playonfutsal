import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const incidentReportsTable = pgTable("incident_reports", {
  id: serial("id").primaryKey(),
  reportedByUserId: integer("reported_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  involvedUserIds: text("involved_user_ids").array().notNull().default([]),
  incidentType: text("incident_type").notNull().default("general"),
  severity: text("severity").notNull().default("low"),
  title: text("title").notNull(),
  description: text("description").notNull(),
  actionTaken: text("action_taken"),
  status: text("status").notNull().default("open"),
  isConfidential: boolean("is_confidential").notNull().default(false),
  occurredAt: timestamp("occurred_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  followUpRequired: boolean("follow_up_required").notNull().default(false),
  attachmentUrls: text("attachment_urls").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertIncidentReportSchema = createInsertSchema(incidentReportsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertIncidentReport = z.infer<typeof insertIncidentReportSchema>;
export type IncidentReport = typeof incidentReportsTable.$inferSelect;
