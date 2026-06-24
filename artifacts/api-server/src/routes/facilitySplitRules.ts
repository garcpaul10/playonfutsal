import { Router, type IRouter } from "express";
import { db, facilitySplitRulesTable, auditLogTable, serviceFeeConfigsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requirePermission, requireSuperAdmin, type AuthedRequest } from "../middlewares/auth";
import type { Request } from "express";

const router: IRouter = Router();

// GET /admin/facility-split-rules
router.get("/admin/facility-split-rules", requirePermission("canViewReports"), async (req, res): Promise<void> => {
  const venueId = req.query.venueId as string | undefined;
  const offeringType = req.query.offeringType as string | undefined;
  const offeringId = req.query.offeringId as string | undefined;
  const latestOnly = req.query.latestOnly as string | undefined;
  let query = db.select().from(facilitySplitRulesTable).$dynamic();
  const conditions = [];
  if (venueId) conditions.push(eq(facilitySplitRulesTable.venueId, parseInt(venueId, 10)));
  if (offeringType) conditions.push(eq(facilitySplitRulesTable.offeringType, offeringType));
  if (offeringId) conditions.push(eq(facilitySplitRulesTable.offeringId, parseInt(offeringId, 10)));
  if (latestOnly !== "false") conditions.push(eq(facilitySplitRulesTable.isLatest, true));
  if (conditions.length) query = query.where(and(...conditions));
  const rules = await query.orderBy(facilitySplitRulesTable.name);
  res.json(rules);
});

// GET /admin/facility-split-rules/:id
router.get("/admin/facility-split-rules/:id", requirePermission("canViewReports"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [rule] = await db.select().from(facilitySplitRulesTable).where(eq(facilitySplitRulesTable.id, id));
  if (!rule) { res.status(404).json({ error: "Not found" }); return; }
  res.json(rule);
});

// POST /admin/facility-split-rules/preview — stateless payout preview (no DB writes)
router.post("/admin/facility-split-rules/preview", requirePermission("canViewReports"), async (req: Request, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;
  const grossAmount = Number(body.grossAmount);
  if (!grossAmount || grossAmount <= 0) {
    res.status(400).json({ error: "grossAmount must be a positive number" });
    return;
  }
  const paymentMethod = (body.paymentMethod as string) === "external" ? "external" : "card";

  // Compute facility amount from inline rule fields
  const splitType = body.splitType as string | undefined;
  const facilityPct = body.facilityPct != null ? Number(body.facilityPct) : 0;
  const flatFee = body.flatFee != null ? Number(body.flatFee) : 0;
  let facilityAmount = 0;
  if (splitType === "percentage") {
    facilityAmount = grossAmount * (facilityPct / 100);
  } else if (splitType === "flat") {
    facilityAmount = Math.min(flatFee, grossAmount);
  } else if (splitType === "hybrid") {
    facilityAmount = Math.min(flatFee + (grossAmount - flatFee) * (facilityPct / 100), grossAmount);
  }
  facilityAmount = Math.max(0, Math.round(facilityAmount * 100) / 100);

  // Fetch active service fee config
  const [feeConfig] = await db.select().from(serviceFeeConfigsTable)
    .where(eq(serviceFeeConfigsTable.isActive, true));
  let serviceFeeAmount = 0;
  if (feeConfig) {
    const applies = paymentMethod === "card" ? feeConfig.appliesToCard : feeConfig.appliesToExternal;
    if (applies) {
      serviceFeeAmount = grossAmount * (Number(feeConfig.feePercent) / 100);
      if (feeConfig.minFeeAmount != null) serviceFeeAmount = Math.max(serviceFeeAmount, Number(feeConfig.minFeeAmount));
      if (feeConfig.maxFeeAmount != null) serviceFeeAmount = Math.min(serviceFeeAmount, Number(feeConfig.maxFeeAmount));
      serviceFeeAmount = Math.round(serviceFeeAmount * 100) / 100;
    }
  }

  const playonNet = Math.round((grossAmount - facilityAmount) * 100) / 100;

  res.json({ grossAmount, facilityAmount, serviceFeeAmount, playonNet });
});

// POST /admin/facility-split-rules
router.post("/admin/facility-split-rules", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const body = req.body as Record<string, unknown>;
  if (!body?.name || !body?.splitType) {
    res.status(400).json({ error: "name and splitType are required" });
    return;
  }
  const splitType = body.splitType as string;
  if (splitType === "percentage" && body.facilityPct == null) {
    res.status(400).json({ error: "facilityPct is required for percentage split type" });
    return;
  }
  if ((splitType === "flat" || splitType === "hybrid") && body.flatFee == null) {
    res.status(400).json({ error: "flatFee is required for flat/hybrid split type" });
    return;
  }

  const [rule] = await db.insert(facilitySplitRulesTable).values({
    name: body.name as string,
    venueId: body.venueId as number ?? null,
    offeringType: body.offeringType as string ?? null,
    offeringId: body.offeringId as number ?? null,
    splitType: splitType as any,
    facilityPct: body.facilityPct != null ? String(body.facilityPct) : null,
    flatFee: body.flatFee != null ? String(body.flatFee) : null,
    flatFeeUnit: body.flatFeeUnit as string ?? null,
    notes: body.notes as string ?? null,
    createdByClerkId: authed.clerkUserId,
  } as any).returning();

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "create",
    entityType: "facility_split_rule",
    entityId: String(rule.id),
    after: JSON.stringify(rule),
  });

  res.status(201).json(rule);
});

// PATCH /admin/facility-split-rules/:id — creates a new version
router.patch("/admin/facility-split-rules/:id", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(facilitySplitRulesTable).where(eq(facilitySplitRulesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (!existing.isLatest) {
    res.status(409).json({ error: "Only the latest version of a split rule can be edited" });
    return;
  }

  const body = req.body as Record<string, unknown>;

  // Validate that the resolved splitType still has its required numeric fields
  const resolvedSplitType = body.splitType !== undefined ? (body.splitType as string) : existing.splitType;
  const resolvedFacilityPct = body.facilityPct !== undefined ? body.facilityPct : existing.facilityPct;
  const resolvedFlatFee = body.flatFee !== undefined ? body.flatFee : existing.flatFee;
  if (resolvedSplitType === "percentage" && resolvedFacilityPct == null) {
    res.status(400).json({ error: "facilityPct is required for percentage split type" });
    return;
  }
  if ((resolvedSplitType === "flat" || resolvedSplitType === "hybrid") && resolvedFlatFee == null) {
    res.status(400).json({ error: "flatFee is required for flat/hybrid split type" });
    return;
  }

  const [newRule] = await db.insert(facilitySplitRulesTable).values({
    name: (body.name as string) ?? existing.name,
    venueId: body.venueId !== undefined ? (body.venueId as number ?? null) : existing.venueId,
    offeringType: body.offeringType !== undefined ? (body.offeringType as string ?? null) : existing.offeringType,
    offeringId: body.offeringId !== undefined ? (body.offeringId as number ?? null) : existing.offeringId,
    splitType: body.splitType !== undefined ? (body.splitType as any) : existing.splitType,
    facilityPct: body.facilityPct !== undefined ? (body.facilityPct != null ? String(body.facilityPct) : null) : existing.facilityPct,
    flatFee: body.flatFee !== undefined ? (body.flatFee != null ? String(body.flatFee) : null) : existing.flatFee,
    flatFeeUnit: body.flatFeeUnit !== undefined ? (body.flatFeeUnit as string ?? null) : existing.flatFeeUnit,
    notes: body.notes !== undefined ? (body.notes as string ?? null) : existing.notes,
    version: existing.version + 1,
    isLatest: true,
    createdByClerkId: authed.clerkUserId,
  } as any).returning();

  await db.update(facilitySplitRulesTable)
    .set({ isLatest: false, supersededById: newRule.id } as any)
    .where(eq(facilitySplitRulesTable.id, id));

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "update",
    entityType: "facility_split_rule",
    entityId: String(newRule.id),
    before: JSON.stringify(existing),
    after: JSON.stringify(newRule),
    notes: `Version bumped from ${existing.version} to ${newRule.version}`,
  });

  res.json(newRule);
});

// DELETE /admin/facility-split-rules/:id — soft deactivate
router.delete("/admin/facility-split-rules/:id", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(facilitySplitRulesTable).where(eq(facilitySplitRulesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  await db.update(facilitySplitRulesTable).set({ isActive: false } as any).where(eq(facilitySplitRulesTable.id, id));

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "deactivate",
    entityType: "facility_split_rule",
    entityId: String(id),
    before: JSON.stringify(existing),
  });

  res.status(204).end();
});

export default router;
