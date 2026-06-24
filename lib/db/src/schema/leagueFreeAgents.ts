import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { leaguesTable } from "./leagues";
import { teamsTable } from "./teams";

export const leagueFreeAgentsTable = pgTable("league_free_agents", {
  id: serial("id").primaryKey(),
  leagueId: integer("league_id").notNull().references(() => leaguesTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  teamId: integer("team_id").references(() => teamsTable.id, { onDelete: "set null" }),
  status: text("status").notNull().default("pending"),
  waiverSigned: boolean("waiver_signed").notNull().default(false),
  waiverSignedAt: timestamp("waiver_signed_at", { withTimezone: true }),
  waiverTemplateId: integer("waiver_template_id"),
  notes: text("notes"),
  registeredAt: timestamp("registered_at", { withTimezone: true }).notNull().defaultNow(),
  assignedAt: timestamp("assigned_at", { withTimezone: true }),
  /** Positions player can play: stored as JSON array e.g. '["goalkeeper","defender"]' */
  positions: text("positions"),
  /** Player-reported skill level */
  skillLevel: text("skill_level"),
  /** Availability stored as JSON e.g. '{"days":["monday","wednesday"],"timePreference":"evenings"}' */
  availability: text("availability"),
  /** AI matching workflow state */
  matchStatus: text("match_status").default("unmatched"),
  /** Team that the AI has proposed as a match (pending two-way confirmation) */
  proposedTeamId: integer("proposed_team_id").references(() => teamsTable.id, { onDelete: "set null" }),
  /** When the current proposal was made */
  proposedAt: timestamp("proposed_at", { withTimezone: true }),
  /** AI reasoning for the match */
  matchReasoning: text("match_reasoning"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertLeagueFreeAgentSchema = createInsertSchema(leagueFreeAgentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLeagueFreeAgent = z.infer<typeof insertLeagueFreeAgentSchema>;
export type LeagueFreeAgent = typeof leagueFreeAgentsTable.$inferSelect;
