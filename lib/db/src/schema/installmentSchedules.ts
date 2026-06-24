import { pgTable, serial, integer, text, numeric, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { paymentsTable } from "./payments";

export const installmentSchedulesTable = pgTable("installment_schedules", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  registrationId: integer("registration_id"),
  totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).notNull(),
  paidAmount: numeric("paid_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  installmentCount: integer("installment_count").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const installmentPaymentsTable = pgTable("installment_payments", {
  id: serial("id").primaryKey(),
  scheduleId: integer("schedule_id").notNull().references(() => installmentSchedulesTable.id, { onDelete: "cascade" }),
  installmentNumber: integer("installment_number").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  dueDate: timestamp("due_date", { withTimezone: true }).notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  paymentId: integer("payment_id").references(() => paymentsTable.id, { onDelete: "set null" }),
  status: text("status").notNull().default("pending"),
  reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertInstallmentScheduleSchema = createInsertSchema(installmentSchedulesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertInstallmentPaymentSchema = createInsertSchema(installmentPaymentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InstallmentSchedule = typeof installmentSchedulesTable.$inferSelect;
export type InstallmentPayment = typeof installmentPaymentsTable.$inferSelect;
