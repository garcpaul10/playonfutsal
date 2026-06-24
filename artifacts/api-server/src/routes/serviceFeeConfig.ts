import { Router, type IRouter } from "express";
import { db, serviceFeeConfigsTable, auditLogTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requirePermission, requireSuperAdmin, type AuthedRequest } from "../middlewares/auth";
import type { Request } from "express";

const router: IRouter = Router();

// GET /admin/service-fee-config — returns active config, or seeds a default
router.get("/admin/service-fee-config", requirePermission("canViewReports"), async (_req, res): Promise<void> => {
  const [config] = await db
    .select()
    .from(serviceFeeConfigsTable)
    .where(eq(serviceFeeConfigsTable.isActive, true))
    .orderBy(desc(serviceFeeConfigsTable.createdAt))
    .limit(1);

  if (config) {
    res.json(config);
    return;
  }

  // Seed a default on first access
  const [defaultConfig] = await db.insert(serviceFeeConfigsTable).values({
    name: "Default Service Fee",
    feePercent: "3.00",
    appliesToCard: true,
    appliesToExternal: false,
    nonRefundable: true,
    notes: "Default 3% service fee on in-app card payments to cover processing costs.",
  } as any).returning();

  res.json(defaultConfig);
});

// PATCH /admin/service-fee-config — creates a new config row (preserves history)
router.patch("/admin/service-fee-config", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const body = req.body as Record<string, unknown>;

  const [existing] = await db
    .select()
    .from(serviceFeeConfigsTable)
    .where(eq(serviceFeeConfigsTable.isActive, true))
    .orderBy(desc(serviceFeeConfigsTable.createdAt))
    .limit(1);

  // Deactivate current
  if (existing) {
    await db.update(serviceFeeConfigsTable)
      .set({ isActive: false } as any)
      .where(eq(serviceFeeConfigsTable.id, existing.id));
  }

  const [newConfig] = await db.insert(serviceFeeConfigsTable).values({
    name: (body.name as string) ?? existing?.name ?? "Service Fee",
    feePercent: body.feePercent != null ? String(body.feePercent) : (existing?.feePercent ?? "3.00"),
    maxFeeAmount: body.maxFeeAmount != null ? String(body.maxFeeAmount) : existing?.maxFeeAmount ?? null,
    minFeeAmount: body.minFeeAmount != null ? String(body.minFeeAmount) : existing?.minFeeAmount ?? null,
    appliesToCard: body.appliesToCard !== undefined ? (body.appliesToCard as boolean) : (existing?.appliesToCard ?? true),
    appliesToExternal: body.appliesToExternal !== undefined ? (body.appliesToExternal as boolean) : (existing?.appliesToExternal ?? false),
    nonRefundable: true,
    isActive: true,
    notes: body.notes !== undefined ? (body.notes as string ?? null) : existing?.notes ?? null,
    createdByClerkId: authed.clerkUserId,
  } as any).returning();

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "update",
    entityType: "service_fee_config",
    entityId: String(newConfig.id),
    before: existing ? JSON.stringify(existing) : null,
    after: JSON.stringify(newConfig),
  });

  res.json(newConfig);
});

export default router;
