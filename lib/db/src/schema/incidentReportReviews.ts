import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { incidentReportsTable } from "./incidentReports";
import { usersTable } from "./users";

export const incidentReportReviewsTable = pgTable("incident_report_reviews", {
  id: serial("id").primaryKey(),
  reportId: integer("report_id").notNull().references(() => incidentReportsTable.id, { onDelete: "cascade" }),
  reviewerUserId: integer("reviewer_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  status: text("status").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertIncidentReportReviewSchema = createInsertSchema(incidentReportReviewsTable).omit({ id: true, createdAt: true });
export type InsertIncidentReportReview = z.infer<typeof insertIncidentReportReviewSchema>;
export type IncidentReportReview = typeof incidentReportReviewsTable.$inferSelect;
