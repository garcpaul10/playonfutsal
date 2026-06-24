import { Router, type IRouter } from "express";
import { db, discountCodesTable, auditLogTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { requireAuth, requireSuperAdmin, requirePermission, hasPermission, type AuthedRequest } from "../middlewares/auth";
import type { Request } from "express";

const router: IRouter = Router();

// GET /admin/discount-codes — list all discount codes
router.get("/admin/discount-codes", requirePermission("canViewReports"), async (req, res): Promise<void> => {
  const { active } = req.query as Record<string, string>;
  let query = db.select().from(discountCodesTable).$dynamic();
  if (active === "true") query = query.where(eq(discountCodesTable.isActive, true));
  if (active === "false") query = query.where(eq(discountCodesTable.isActive, false));
  const codes = await query.orderBy(desc(discountCodesTable.createdAt));
  res.json(codes);
});

// POST /admin/discount-codes — create a discount code
router.post("/admin/discount-codes", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const body = req.body as Record<string, unknown>;

  if (!body.code || !body.discountType || body.discountValue == null) {
    res.status(400).json({ error: "code, discountType, and discountValue are required" });
    return;
  }

  const code = (body.code as string).toUpperCase().trim();
  const existing = await db.select().from(discountCodesTable).where(eq(discountCodesTable.code, code));
  if (existing.length > 0) {
    res.status(409).json({ error: "A discount code with this code already exists" });
    return;
  }

  if (!["percent", "amount"].includes(body.discountType as string)) {
    res.status(400).json({ error: "discountType must be 'percent' or 'amount'" });
    return;
  }

  const [dc] = await db.insert(discountCodesTable).values({
    code,
    description: (body.description as string) ?? null,
    discountType: body.discountType as string,
    discountValue: String(body.discountValue),
    applicableTo: (body.applicableTo as string) ?? "all",
    entityType: (body.entityType as string) ?? null,
    entityId: body.entityId != null ? Number(body.entityId) : null,
    maxUses: body.maxUses != null ? Number(body.maxUses) : null,
    minOrderAmount: body.minOrderAmount != null ? String(body.minOrderAmount) : null,
    validFrom: body.validFrom ? new Date(body.validFrom as string) : null,
    validUntil: body.validUntil ? new Date(body.validUntil as string) : null,
    isActive: body.isActive !== false,
  } as any).returning();

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "create",
    entityType: "discount_code",
    entityId: String(dc.id),
    after: JSON.stringify(dc),
  });

  res.status(201).json(dc);
});

// PATCH /admin/discount-codes/:id — update a discount code
router.patch("/admin/discount-codes/:id", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(discountCodesTable).where(eq(discountCodesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Discount code not found" }); return; }

  const body = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (body.description !== undefined) updates.description = body.description;
  if (body.discountType !== undefined) updates.discountType = body.discountType;
  if (body.discountValue !== undefined) updates.discountValue = String(body.discountValue);
  if (body.applicableTo !== undefined) updates.applicableTo = body.applicableTo;
  if (body.entityType !== undefined) updates.entityType = body.entityType;
  if (body.entityId !== undefined) updates.entityId = body.entityId != null ? Number(body.entityId) : null;
  if (body.maxUses !== undefined) updates.maxUses = body.maxUses != null ? Number(body.maxUses) : null;
  if (body.minOrderAmount !== undefined) updates.minOrderAmount = body.minOrderAmount != null ? String(body.minOrderAmount) : null;
  if (body.validFrom !== undefined) updates.validFrom = body.validFrom ? new Date(body.validFrom as string) : null;
  if (body.validUntil !== undefined) updates.validUntil = body.validUntil ? new Date(body.validUntil as string) : null;
  if (body.isActive !== undefined) updates.isActive = body.isActive;

  const [updated] = await db.update(discountCodesTable)
    .set(updates as any)
    .where(eq(discountCodesTable.id, id))
    .returning();

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "update",
    entityType: "discount_code",
    entityId: String(id),
    before: JSON.stringify(existing),
    after: JSON.stringify(updated),
  });

  res.json(updated);
});

// DELETE /admin/discount-codes/:id — deactivate (soft delete)
router.delete("/admin/discount-codes/:id", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(discountCodesTable).where(eq(discountCodesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Discount code not found" }); return; }

  await db.update(discountCodesTable)
    .set({ isActive: false, updatedAt: new Date() } as any)
    .where(eq(discountCodesTable.id, id));

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "deactivate",
    entityType: "discount_code",
    entityId: String(id),
    before: JSON.stringify(existing),
  });

  res.sendStatus(204);
});

export default router;
