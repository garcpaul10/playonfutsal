import { Router, type IRouter } from "express";
import { db, auditLogTable, usersTable } from "@workspace/db";
import { desc, eq, and, gte, lte, sql } from "drizzle-orm";
import { requireSuperAdmin } from "../middlewares/auth";

const router: IRouter = Router();

function buildAuditFilters(query: Record<string, any>) {
  const conditions: any[] = [];
  if (query.entityType) conditions.push(eq(auditLogTable.entityType, query.entityType));
  if (query.action) conditions.push(eq(auditLogTable.action, query.action));
  if (query.actorClerkId) conditions.push(eq(auditLogTable.actorClerkId, query.actorClerkId));
  if (query.entityId) conditions.push(eq(auditLogTable.entityId, query.entityId));
  if (query.startDate) conditions.push(gte(auditLogTable.createdAt, new Date(query.startDate)));
  if (query.endDate) {
    const end = new Date(query.endDate);
    end.setHours(23, 59, 59, 999);
    conditions.push(lte(auditLogTable.createdAt, end));
  }
  return conditions;
}

function buildSummary(action: string, entityType: string, entityId: string | null, before: any, after: any, notes: string | null): string {
  const eid = entityId ? ` #${entityId}` : "";
  const tryField = (obj: any, ...keys: string[]) => {
    for (const k of keys) {
      if (obj?.[k] !== undefined && obj?.[k] !== null) return String(obj[k]);
    }
    return null;
  };

  switch (action) {
    case "user.role_changed": {
      const from = tryField(before, "role") ?? "?";
      const to = tryField(after, "role") ?? "?";
      return `Changed user${eid} role from ${from} → ${to}`;
    }
    case "user.admin_level_changed": {
      const from = tryField(before, "adminLevel") ?? "?";
      const to = tryField(after, "adminLevel") ?? "?";
      return `Changed user${eid} admin level from ${from} → ${to}`;
    }
    case "user.id_manually_approved":
      return `Manually approved ID verification for user${eid}`;
    case "user.profile_updated":
      return `Updated profile for user${eid}`;
    case "create":
      return `Created ${entityType}${eid}`;
    case "update":
      return `Updated ${entityType}${eid}`;
    case "delete":
      return `Deleted ${entityType}${eid}`;
    case "deactivate":
      return `Deactivated ${entityType}${eid}`;
    case "approve":
      return `Approved ${entityType}${eid}`;
    case "reject":
      return `Rejected ${entityType}${eid}`;
    case "execute":
      return `Executed payout${eid}`;
    case "retry":
      return `Retried payout${eid}`;
    case "refund": {
      const amt = tryField(after, "amount", "refundAmount");
      return amt ? `Processed $${(Number(amt) / 100).toFixed(2)} refund on payment${eid}` : `Processed refund on payment${eid}`;
    }
    case "fixture_cancelled":
      return `Cancelled fixture${eid}`;
    case "fixture_rescheduled":
      return `Rescheduled fixture${eid}`;
    case "court_block_created":
      return `Created court block on court${eid}`;
    case "court_block_deleted":
      return `Deleted court block on court${eid}`;
    case "incident_report_filed":
      return `Filed incident report${eid}`;
    case "incident_report_reviewed":
      return `Reviewed incident report${eid}`;
    case "venue_insurance_updated":
      return `Updated venue insurance for venue${eid}`;
    case "staff_clearance_updated":
      return `Updated staff clearance for staff${eid}`;
    case "youth_pii_exported":
      return `Exported youth PII data`;
    case "youth_pii_anonymized":
      return `Anonymized youth PII for user${eid}`;
    case "youth_pii_deletion_requested":
      return `Requested PII deletion for user${eid}`;
    case "youth_pii_list_accessed":
      return `Accessed youth PII list`;
    case "youth_player_roster_accessed":
      return `Accessed youth player roster${eid}`;
    case "auto_policy_apply":
      return `Applied auto cancellation policy${eid}`;
    case "weather_cancellation_credits":
      return `Issued weather cancellation credits for fixture${eid}`;
    case "issue_credit": {
      const amt = tryField(after, "amount");
      return amt ? `Issued $${(Number(amt) / 100).toFixed(2)} account credit to user${eid}` : `Issued account credit to user${eid}`;
    }
    case "revoke_credit":
      return `Revoked account credit${eid}`;
    case "membership_granted":
      return `Granted membership${eid}`;
    case "membership_manual_grant":
      return `Manually granted membership${eid}`;
    case "membership_subscribed":
      return `User subscribed to membership plan${eid}`;
    case "membership_cancelled":
      return `Cancelled membership${eid}`;
    case "membership_admin_cancelled":
      return `Admin cancelled membership${eid}`;
    case "membership_cancel_scheduled":
      return `Scheduled membership cancellation${eid}`;
    case "membership_admin_override":
      return `Admin override on membership${eid}`;
    case "membership_plan_created":
      return `Created membership plan${eid}`;
    case "membership_plan_updated":
      return `Updated membership plan${eid}`;
    case "spot_admin_added":
      return `Admin added player to drop-in spot${eid}`;
    case "spot_cancelled":
      return `Cancelled drop-in spot${eid}`;
    case "waitlist_promoted":
      return `Player auto-promoted from waitlist for drop-in${eid}`;
    case "waitlist_manually_promoted":
      return `Admin manually promoted player from waitlist for drop-in${eid}`;
    case "payment_status_updated":
      return `Updated payment status on ${entityType}${eid}`;
    case "player_checked_in":
      return `Player checked in to ${entityType}${eid}`;
    case "no_show_marked":
      return `Marked player as no-show on ${entityType}${eid}`;
    case "mark_paid_external":
      return `Marked payment as paid externally on ${entityType}${eid}`;
    case "staff_profile.created":
      return `Created staff profile${eid}`;
    case "camp_registration":
      return `Player registered for camp${eid}`;
    case "camp_registration_cancelled":
      return `Cancelled camp registration${eid}`;
    case "camp_registration_updated":
      return `Updated camp registration${eid}`;
    case "camp_day_checkin":
      return `Checked in to camp day${eid}`;
    default: {
      const readable = action.replace(/_/g, " ");
      if (notes) return `${readable} — ${notes}`;
      return `${readable} on ${entityType}${eid}`;
    }
  }
}

async function fetchAuditRows(conditions: any[], limit: number, offset: number) {
  const actorAlias = usersTable;
  let q = db
    .select({
      id: auditLogTable.id,
      actorClerkId: auditLogTable.actorClerkId,
      actorFirstName: usersTable.firstName,
      actorLastName: usersTable.lastName,
      actorEmail: usersTable.email,
      action: auditLogTable.action,
      entityType: auditLogTable.entityType,
      entityId: auditLogTable.entityId,
      before: auditLogTable.before,
      after: auditLogTable.after,
      ipAddress: auditLogTable.ipAddress,
      notes: auditLogTable.notes,
      createdAt: auditLogTable.createdAt,
    })
    .from(auditLogTable)
    .leftJoin(usersTable, eq(usersTable.clerkId, auditLogTable.actorClerkId))
    .$dynamic();

  if (conditions.length) q = q.where(and(...conditions));
  const rows = await q.orderBy(desc(auditLogTable.createdAt)).limit(limit).offset(offset);
  return rows.map(row => {
    let beforeParsed: any = null;
    let afterParsed: any = null;
    try { beforeParsed = row.before ? JSON.parse(row.before) : null; } catch {}
    try { afterParsed = row.after ? JSON.parse(row.after) : null; } catch {}
    const actorName = [row.actorFirstName, row.actorLastName].filter(Boolean).join(" ") || row.actorEmail || row.actorClerkId || "System";
    const summary = buildSummary(row.action, row.entityType, row.entityId, beforeParsed, afterParsed, row.notes);
    return { ...row, actorName, summary };
  });
}

function toCsv(rows: any[]): string {
  const headers = ["timestamp", "actor_name", "action", "entity_type", "entity_id", "summary", "ip_address"];
  const escape = (v: any) => {
    const s = v == null ? "" : String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push([
      escape(new Date(row.createdAt).toISOString()),
      escape(row.actorName),
      escape(row.action),
      escape(row.entityType),
      escape(row.entityId),
      escape(row.summary),
      escape(row.ipAddress),
    ].join(","));
  }
  return lines.join("\n");
}

// Legacy path — super-admin only
router.get("/audit-log", requireSuperAdmin, async (req, res): Promise<void> => {
  const limit = Math.min(parseInt((req.query.limit as string) ?? "50", 10), 1000);
  const offset = parseInt((req.query.offset as string) ?? "0", 10);
  const conditions = buildAuditFilters(req.query);
  const rows = await fetchAuditRows(conditions, limit, offset);
  if (req.query.format === "csv") {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="audit-log.csv"`);
    res.send(toCsv(rows));
    return;
  }
  res.json(rows);
});

// Main admin path — super-admin only
router.get("/admin/audit-log", requireSuperAdmin, async (req, res): Promise<void> => {
  const limit = Math.min(parseInt((req.query.limit as string) ?? "50", 10), 1000);
  const offset = parseInt((req.query.offset as string) ?? "0", 10);
  const conditions = buildAuditFilters(req.query);
  const rows = await fetchAuditRows(conditions, limit, offset);
  if (req.query.format === "csv") {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="audit-log.csv"`);
    res.send(toCsv(rows));
    return;
  }
  res.json(rows);
});

export default router;
