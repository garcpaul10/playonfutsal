import { Router, type IRouter } from "express";
import { db, revenueRecordsTable, facilitySplitRulesTable } from "@workspace/db";
import { eq, gte, lte, and, sql } from "drizzle-orm";
import { requirePermission, requireSuperAdmin, type AuthedRequest } from "../middlewares/auth";
import type { Request } from "express";
import { recordRevenue, computeRevenueSplit } from "../services/revenueComputation";

const router: IRouter = Router();

// GET /admin/revenue — list revenue records with computed totals
router.get("/admin/revenue", requirePermission("canViewReports"), async (req, res): Promise<void> => {
  const { category, from, to, limit: limitStr } = req.query as Record<string, string>;
  const limit = Math.min(parseInt(limitStr ?? "50", 10), 200);

  const conditions = [];
  if (category) conditions.push(eq(revenueRecordsTable.category, category));
  if (from) conditions.push(gte(revenueRecordsTable.revenueDate, from));
  if (to) conditions.push(lte(revenueRecordsTable.revenueDate, to));

  // Join with facility_split_rules to include tier info (event-specific vs venue-default)
  let query = db
    .select({
      id: revenueRecordsTable.id,
      entityType: revenueRecordsTable.entityType,
      entityId: revenueRecordsTable.entityId,
      paymentId: revenueRecordsTable.paymentId,
      splitRuleId: revenueRecordsTable.splitRuleId,
      category: revenueRecordsTable.category,
      grossAmount: revenueRecordsTable.grossAmount,
      facilityAmount: revenueRecordsTable.facilityAmount,
      serviceFeeAmount: revenueRecordsTable.serviceFeeAmount,
      playonNet: revenueRecordsTable.playonNet,
      revenueDate: revenueRecordsTable.revenueDate,
      description: revenueRecordsTable.description,
      createdAt: revenueRecordsTable.createdAt,
      ruleOfferingType: facilitySplitRulesTable.offeringType,
      ruleOfferingId: facilitySplitRulesTable.offeringId,
      ruleName: facilitySplitRulesTable.name,
    })
    .from(revenueRecordsTable)
    .leftJoin(facilitySplitRulesTable, eq(revenueRecordsTable.splitRuleId, facilitySplitRulesTable.id))
    .$dynamic();
  if (conditions.length) query = query.where(and(...conditions));
  const records = await query.limit(limit).orderBy(revenueRecordsTable.revenueDate);

  // Annotate each record with a ruleTier: "event" | "venue" | null
  const annotated = records.map(r => ({
    ...r,
    ruleTier: r.splitRuleId == null
      ? null
      : (r.ruleOfferingType != null && r.ruleOfferingId != null)
        ? "event"
        : "venue",
  }));

  // Compute totals
  let totalsQuery = db
    .select({
      grossAmount: sql<string>`COALESCE(SUM(gross_amount), 0)`,
      facilityAmount: sql<string>`COALESCE(SUM(facility_amount), 0)`,
      serviceFeeAmount: sql<string>`COALESCE(SUM(service_fee_amount), 0)`,
      playonNet: sql<string>`COALESCE(SUM(playon_net), 0)`,
    })
    .from(revenueRecordsTable)
    .$dynamic();
  if (conditions.length) totalsQuery = totalsQuery.where(and(...conditions));
  const [totalsRow] = await totalsQuery;

  res.json({
    records: annotated,
    totals: {
      grossAmount: Number(totalsRow?.grossAmount ?? 0),
      facilityAmount: Number(totalsRow?.facilityAmount ?? 0),
      serviceFeeAmount: Number(totalsRow?.serviceFeeAmount ?? 0),
      playonNet: Number(totalsRow?.playonNet ?? 0),
    },
  });
});

// POST /admin/revenue/compute — preview split without persisting
router.post("/admin/revenue/compute", requirePermission("canViewReports"), async (req: Request, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;
  const grossAmount = Number(body?.grossAmount);
  if (!body?.grossAmount || isNaN(grossAmount) || grossAmount <= 0) {
    res.status(400).json({ error: "grossAmount must be a positive number" });
    return;
  }
  const paymentMethod = (body.paymentMethod as string) === "external" ? "external" : "card";
  const result = await computeRevenueSplit({
    entityType: (body.entityType as string) ?? "manual",
    entityId: body.entityId != null ? Number(body.entityId) : null,
    category: (body.category as string) ?? "drop_in",
    grossAmount,
    paymentMethod,
    splitRuleId: body.splitRuleId != null ? Number(body.splitRuleId) : null,
    venueId: body.venueId != null ? Number(body.venueId) : null,
    offeringType: (body.offeringType as string) ?? null,
    offeringId: body.offeringId != null ? Number(body.offeringId) : null,
  });
  res.json(result);
});

// POST /admin/revenue — create a revenue record using the computation engine
router.post("/admin/revenue", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const body = req.body as Record<string, unknown>;

  const grossAmount = Number(body?.grossAmount);
  if (!body?.grossAmount || isNaN(grossAmount) || grossAmount <= 0) {
    res.status(400).json({ error: "grossAmount must be a positive number" });
    return;
  }
  if (!body?.entityType || !body?.category) {
    res.status(400).json({ error: "entityType and category are required" });
    return;
  }
  const validCategories = ["drop_in", "camp", "league", "tournament"];
  if (!validCategories.includes(body.category as string)) {
    res.status(400).json({ error: `category must be one of: ${validCategories.join(", ")}` });
    return;
  }
  const paymentMethod = (body.paymentMethod as string) === "external" ? "external" : "card";

  const record = await recordRevenue({
    entityType: body.entityType as string,
    entityId: body.entityId != null ? Number(body.entityId) : null,
    category: body.category as string,
    grossAmount,
    paymentMethod,
    splitRuleId: body.splitRuleId != null ? Number(body.splitRuleId) : null,
    venueId: body.venueId != null ? Number(body.venueId) : null,
    offeringType: (body.offeringType as string) ?? null,
    offeringId: body.offeringId != null ? Number(body.offeringId) : null,
    description: (body.description as string) ?? null,
    revenueDate: (body.revenueDate as string) ?? null,
    actorClerkId: authed.clerkUserId,
  });

  res.status(201).json(record);
});

export default router;
