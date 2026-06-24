import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const assistantConversationsTable = pgTable("assistant_conversations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  title: text("title"),
  messages: text("messages").notNull().default("[]"),
  context: text("context"),
  model: text("model").notNull().default("gpt-4o"),
  isActive: boolean("is_active").notNull().default(true),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAssistantConversationSchema = createInsertSchema(assistantConversationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAssistantConversation = z.infer<typeof insertAssistantConversationSchema>;
export type AssistantConversation = typeof assistantConversationsTable.$inferSelect;
