import { Router, type IRouter } from "express";
import { db, ageGroupMappingsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requireAdmin, requireSuperAdmin } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/age-group-mappings", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db.select().from(ageGroupMappingsTable).orderBy(asc(ageGroupMappingsTable.ageGroupId));
  res.json(rows);
});

router.post("/age-group-mappings", requireSuperAdmin, async (req, res): Promise<void> => {
  const body = req.body;
  if (!body?.ageGroupId || !body?.defaultFormat) {
    res.status(400).json({ error: "ageGroupId and defaultFormat are required" });
    return;
  }
  const [row] = await db.insert(ageGroupMappingsTable).values({
    ageGroupId: body.ageGroupId,
    defaultCourtId: body.defaultCourtId ?? null,
    defaultFormat: body.defaultFormat,
    defaultDurationMinutes: body.defaultDurationMinutes ?? 60,
    timebandStart: body.timebandStart ?? null,
    timebandEnd: body.timebandEnd ?? null,
    notes: body.notes ?? null,
  }).returning();
  res.status(201).json(row);
});

router.get("/age-group-mappings/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.select().from(ageGroupMappingsTable).where(eq(ageGroupMappingsTable.id, id));
  if (!row) { res.status(404).json({ error: "Mapping not found" }); return; }
  res.json(row);
});

router.patch("/age-group-mappings/:id", requireSuperAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body;
  const updates: Record<string, any> = { updatedAt: new Date() };
  for (const f of ["defaultCourtId", "defaultFormat", "defaultDurationMinutes", "timebandStart", "timebandEnd", "notes"]) {
    if (body[f] !== undefined) updates[f] = body[f];
  }
  const [row] = await db.update(ageGroupMappingsTable).set(updates as any).where(eq(ageGroupMappingsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Mapping not found" }); return; }
  res.json(row);
});

router.delete("/age-group-mappings/:id", requireSuperAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [deleted] = await db.delete(ageGroupMappingsTable).where(eq(ageGroupMappingsTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Mapping not found" }); return; }
  res.sendStatus(204);
});

export default router;
