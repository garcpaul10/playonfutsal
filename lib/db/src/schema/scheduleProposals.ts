import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const scheduleProposalsTable = pgTable("schedule_proposals", {
  id: serial("id").primaryKey(),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),

  // ── Status lifecycle: draft → ready → approved | rejected ─────────────────
  status: text("status").notNull().default("draft"),

  // ── Which offering this schedule is for ───────────────────────────────────
  entityType: text("entity_type"),
  entityId: integer("entity_id"),

  // ── Proposal payload (JSON serialized) ───────────────────────────────────
  proposalData: text("proposal_data"),
  conflictSummary: text("conflict_summary"),
  notes: text("notes"),

  // ── P9: AI metadata + re-optimization ─────────────────────────────────────
  aiModel: text("ai_model"),
  aiRawResponse: text("ai_raw_response"),
  reoptimizeRequest: text("reoptimize_request"),
  reoptimizeCount: integer("reoptimize_count").notNull().default(0),

  // ── Review ────────────────────────────────────────────────────────────────
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertScheduleProposalSchema = createInsertSchema(scheduleProposalsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertScheduleProposal = z.infer<typeof insertScheduleProposalSchema>;
export type ScheduleProposal = typeof scheduleProposalsTable.$inferSelect;
