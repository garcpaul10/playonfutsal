/**
 * Incident / injury report routes.
 * - Only staff/admin can FILE reports (requireAdmin gate: role admin | staff)
 * - Reports are IMMUTABLE after creation — core fields (title, description, severity, etc.) are never updated
 * - Admin review is append-only: POST /incident-reports/:id/reviews creates a review entry
 *   (status, notes) without touching the original report
 */
import { Router, type IRouter } from "express";
import { db, incidentReportsTable, incidentReportReviewsTable, usersTable, auditLogTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requirePermission, requireSuperAdmin, requireStaffOrRef, type AuthedRequest } from "../middlewares/auth";

const router: IRouter = Router();

/** GET /admin/incident-reports — list all reports (admin+staff), filterable by entityType/status */
router.get("/admin/incident-reports", requirePermission("canManageGameCards"), async (req: any, res): Promise<void> => {
  const entityType = req.query.entityType as string | undefined;
  const status = req.query.status as string | undefined;
  const limitStr = req.query.limit as string | undefined;
  const offsetStr = req.query.offset as string | undefined;
  const limit = Math.min(parseInt(limitStr ?? "50", 10), 200);
  const offset = parseInt(offsetStr ?? "0", 10);

  let rows = await db
    .select()
    .from(incidentReportsTable)
    .orderBy(desc(incidentReportsTable.occurredAt))
    .limit(limit)
    .offset(offset);

  if (entityType) rows = rows.filter((r) => r.entityType === entityType);

  // Attach latest review status for each report
  const reportIds = rows.map((r) => r.id);
  const reviews = reportIds.length > 0
    ? await db
        .select()
        .from(incidentReportReviewsTable)
        .orderBy(desc(incidentReportReviewsTable.createdAt))
    : [];

  const enriched = rows.map((r) => {
    const latestReview = reviews.find((rv) => rv.reportId === r.id);
    return { ...r, currentStatus: latestReview?.status ?? r.status, latestReview: latestReview ?? null };
  });

  const filtered = status ? enriched.filter((r) => r.currentStatus === status) : enriched;
  res.json(filtered);
});

/** GET /admin/incident-reports/:id — get single report with full review history (admin+staff) */
router.get("/admin/incident-reports/:id", requirePermission("canManageGameCards"), async (req: any, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.select().from(incidentReportsTable).where(eq(incidentReportsTable.id, id));
  if (!row) { res.status(404).json({ error: "Report not found" }); return; }

  const reviews = await db
    .select()
    .from(incidentReportReviewsTable)
    .where(eq(incidentReportReviewsTable.reportId, id))
    .orderBy(desc(incidentReportReviewsTable.createdAt));

  res.json({ ...row, reviews });
});

/**
 * POST /incident-reports — file a new incident report.
 * Accessible to: admin, staff, and referees (users with an active staffProfile regardless of user.role).
 * Reports are immutable once created — no updates to the core record are permitted.
 */
router.post("/incident-reports", requireStaffOrRef, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const body = req.body as {
    entityType?: string;
    entityId?: number;
    involvedUserIds?: string[];
    incidentType?: string;
    severity?: string;
    title: string;
    description: string;
    actionTaken?: string;
    isConfidential?: boolean;
    occurredAt?: string;
    followUpRequired?: boolean;
    attachmentUrls?: string[];
  };

  if (!body.title?.trim() || !body.description?.trim()) {
    res.status(400).json({ error: "title and description are required" });
    return;
  }

  const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!dbUser) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  const [report] = await db.insert(incidentReportsTable).values({
    reportedByUserId: dbUser.id,
    entityType: body.entityType ?? null,
    entityId: body.entityId ?? null,
    involvedUserIds: body.involvedUserIds ?? [],
    incidentType: body.incidentType ?? "general",
    severity: body.severity ?? "low",
    title: body.title,
    description: body.description,
    actionTaken: body.actionTaken ?? null,
    status: "open",
    isConfidential: body.isConfidential ?? false,
    occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
    followUpRequired: body.followUpRequired ?? false,
    attachmentUrls: body.attachmentUrls ?? [],
  }).returning();

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "incident_report_filed",
    entityType: body.entityType ?? "general",
    entityId: body.entityId ? String(body.entityId) : String(report.id),
    notes: JSON.stringify({ reportId: report.id, title: body.title, severity: body.severity }),
  });

  res.status(201).json(report);
});

/**
 * POST /admin/incident-reports/:id/reviews — append a review entry (status change, notes).
 * Immutability-preserving: never touches the original report record.
 * Restricted to super-admin only — review authority must not be delegated to staff.
 */
router.post("/admin/incident-reports/:id/reviews", requireSuperAdmin, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid report id" }); return; }

  const { status, notes } = req.body as { status: string; notes?: string };
  if (!status) {
    res.status(400).json({ error: "status is required" });
    return;
  }

  const [report] = await db.select().from(incidentReportsTable).where(eq(incidentReportsTable.id, id));
  if (!report) { res.status(404).json({ error: "Report not found" }); return; }

  const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));

  const [review] = await db.insert(incidentReportReviewsTable).values({
    reportId: id,
    reviewerUserId: dbUser?.id ?? null,
    status,
    notes: notes ?? null,
  }).returning();

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "incident_report_reviewed",
    entityType: "incident_report",
    entityId: String(id),
    notes: JSON.stringify({ reviewId: review.id, status, notes }),
  });

  res.status(201).json(review);
});

export default router;
