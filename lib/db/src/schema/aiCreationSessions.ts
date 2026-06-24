import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const aiCreationSessionsTable = pgTable("ai_creation_sessions", {
  id: serial("id").primaryKey(),
  adminUserId: integer("admin_user_id").references(() => usersTable.id, { onDelete: "cascade" }),

  entityType: text("entity_type").notNull().default("unknown"),
  thread: text("thread").notNull().default("[]"),
  partialEntity: text("partial_entity").notNull().default("{}"),
  status: text("status").notNull().default("drafting"),

  createdEntityId: integer("created_entity_id"),
  createdEntityType: text("created_entity_type"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiCreationSessionSchema = createInsertSchema(aiCreationSessionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiCreationSession = z.infer<typeof insertAiCreationSessionSchema>;
export type AiCreationSession = typeof aiCreationSessionsTable.$inferSelect;
