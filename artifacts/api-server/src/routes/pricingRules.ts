import { Router, type IRouter } from "express";
import { db, pricingRulesTable, auditLogTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requirePermission, requireSuperAdmin, type AuthedRequest } from "../middlewares/auth";
import type { Request } from "express";

const router: IRouter = Router();

// GET /admin/pricing-rules
router.get("/admin/pricing-rules", requirePermission("canViewReports"), async (req, res): Promise<void> => {
  const category = req.query.category as string | undefined;
  const latestOnly = req.query.latestOnly as string | undefined;
  let query = db.select().from(pricingRulesTable).$dynamic();
  const conditions = [];
  if (category) conditions.push(eq(pricingRulesTable.category, category as any));
  if (latestOnly !== "false") conditions.push(eq(pricingRulesTable.isLatest, true));
  if (conditions.length) query = query.where(and(...conditions));
  const rules = await query.orderBy(pricingRulesTable.category, pricingRulesTable.name);
  res.json(rules);
});

// GET /admin/pricing-rules/:id
router.get("/admin/pricing-rules/:id", requirePermission("canViewReports"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [rule] = await db.select().from(pricingRulesTable).where(eq(pricingRulesTable.id, id));
  if (!rule) { res.status(404).json({ error: "Not found" }); return; }
  res.json(rule);
});

// POST /admin/pricing-rules
router.post("/admin/pricing-rules", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const body = req.body as Record<string, unknown>;
  if (!body?.name || !body?.category) {
    res.status(400).json({ error: "name and category are required" });
    return;
  }
  const [rule] = await db.insert(pricingRulesTable).values({
    name: body.name as string,
    category: body.category as any,
    basePrice: body.basePrice != null ? String(body.basePrice) : null,
    memberPrice: body.memberPrice != null ? String(body.memberPrice) : null,
    depositAmount: body.depositAmount != null ? String(body.depositAmount) : null,
    depositRequired: body.depositRequired as boolean ?? false,
    balanceDueDate: body.balanceDueDate as string ?? null,
    skillTierPricing: body.skillTierPricing as string ?? null,
    packSize: body.packSize as number ?? null,
    packPrice: body.packPrice != null ? String(body.packPrice) : null,
    pricingBasis: body.pricingBasis as string ?? null,
    earlyBirdPrice: body.earlyBirdPrice != null ? String(body.earlyBirdPrice) : null,
    earlyBirdCutoff: body.earlyBirdCutoff as string ?? null,
    lateFee: body.lateFee != null ? String(body.lateFee) : null,
    siblingDiscountPct: body.siblingDiscountPct != null ? String(body.siblingDiscountPct) : null,
    teamFee: body.teamFee != null ? String(body.teamFee) : null,
    playerFee: body.playerFee != null ? String(body.playerFee) : null,
    installmentPlan: body.installmentPlan as boolean ?? false,
    installmentCount: body.installmentCount as number ?? null,
    teamEntryFee: body.teamEntryFee != null ? String(body.teamEntryFee) : null,
    perPlayerFee: body.perPlayerFee != null ? String(body.perPlayerFee) : null,
    notes: body.notes as string ?? null,
    createdByClerkId: authed.clerkUserId,
  } as any).returning();

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "create",
    entityType: "pricing_rule",
    entityId: String(rule.id),
    after: JSON.stringify(rule),
  });

  res.status(201).json(rule);
});

// PATCH /admin/pricing-rules/:id — creates a new version
router.patch("/admin/pricing-rules/:id", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(pricingRulesTable).where(eq(pricingRulesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (!existing.isLatest) {
    res.status(409).json({ error: "Only the latest version of a pricing rule can be edited" });
    return;
  }

  const body = req.body as Record<string, unknown>;

  // Create new version
  const [newRule] = await db.insert(pricingRulesTable).values({
    name: (body.name as string) ?? existing.name,
    category: existing.category,
    version: existing.version + 1,
    isLatest: true,
    basePrice: body.basePrice !== undefined ? (body.basePrice != null ? String(body.basePrice) : null) : existing.basePrice,
    memberPrice: body.memberPrice !== undefined ? (body.memberPrice != null ? String(body.memberPrice) : null) : existing.memberPrice,
    depositAmount: body.depositAmount !== undefined ? (body.depositAmount != null ? String(body.depositAmount) : null) : existing.depositAmount,
    depositRequired: body.depositRequired !== undefined ? (body.depositRequired as boolean) : existing.depositRequired,
    balanceDueDate: body.balanceDueDate !== undefined ? (body.balanceDueDate as string ?? null) : existing.balanceDueDate,
    skillTierPricing: body.skillTierPricing !== undefined ? (body.skillTierPricing as string ?? null) : existing.skillTierPricing,
    packSize: body.packSize !== undefined ? (body.packSize as number ?? null) : existing.packSize,
    packPrice: body.packPrice !== undefined ? (body.packPrice != null ? String(body.packPrice) : null) : existing.packPrice,
    pricingBasis: body.pricingBasis !== undefined ? (body.pricingBasis as string ?? null) : existing.pricingBasis,
    earlyBirdPrice: body.earlyBirdPrice !== undefined ? (body.earlyBirdPrice != null ? String(body.earlyBirdPrice) : null) : existing.earlyBirdPrice,
    earlyBirdCutoff: body.earlyBirdCutoff !== undefined ? (body.earlyBirdCutoff as string ?? null) : existing.earlyBirdCutoff,
    lateFee: body.lateFee !== undefined ? (body.lateFee != null ? String(body.lateFee) : null) : existing.lateFee,
    siblingDiscountPct: body.siblingDiscountPct !== undefined ? (body.siblingDiscountPct != null ? String(body.siblingDiscountPct) : null) : existing.siblingDiscountPct,
    teamFee: body.teamFee !== undefined ? (body.teamFee != null ? String(body.teamFee) : null) : existing.teamFee,
    playerFee: body.playerFee !== undefined ? (body.playerFee != null ? String(body.playerFee) : null) : existing.playerFee,
    installmentPlan: body.installmentPlan !== undefined ? (body.installmentPlan as boolean) : existing.installmentPlan,
    installmentCount: body.installmentCount !== undefined ? (body.installmentCount as number ?? null) : existing.installmentCount,
    teamEntryFee: body.teamEntryFee !== undefined ? (body.teamEntryFee != null ? String(body.teamEntryFee) : null) : existing.teamEntryFee,
    perPlayerFee: body.perPlayerFee !== undefined ? (body.perPlayerFee != null ? String(body.perPlayerFee) : null) : existing.perPlayerFee,
    notes: body.notes !== undefined ? (body.notes as string ?? null) : existing.notes,
    createdByClerkId: authed.clerkUserId,
  } as any).returning();

  // Mark old version as superseded
  await db.update(pricingRulesTable)
    .set({ isLatest: false, supersededById: newRule.id } as any)
    .where(eq(pricingRulesTable.id, id));

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "update",
    entityType: "pricing_rule",
    entityId: String(newRule.id),
    before: JSON.stringify(existing),
    after: JSON.stringify(newRule),
    notes: `Version bumped from ${existing.version} to ${newRule.version}`,
  });

  res.json(newRule);
});

// DELETE /admin/pricing-rules/:id — soft deactivate
router.delete("/admin/pricing-rules/:id", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(pricingRulesTable).where(eq(pricingRulesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  await db.update(pricingRulesTable).set({ isActive: false } as any).where(eq(pricingRulesTable.id, id));

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "deactivate",
    entityType: "pricing_rule",
    entityId: String(id),
    before: JSON.stringify(existing),
  });

  res.status(204).end();
});

export default router;
