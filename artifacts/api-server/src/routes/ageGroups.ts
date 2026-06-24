import { Router, type IRouter } from "express";
import { db, ageGroupsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requirePermission } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/age-groups", async (_req, res): Promise<void> => {
  const groups = await db.select().from(ageGroupsTable).orderBy(asc(ageGroupsTable.displayOrder));
  res.json(groups);
});

router.post("/age-groups", requirePermission("canManageAgeGroups"), async (req, res): Promise<void> => {
  const body = req.body;
  if (!body?.label) {
    res.status(400).json({ error: "label is required" });
    return;
  }
  const [group] = await db.insert(ageGroupsTable).values({
    label: body.label,
    minAge: body.minAge ?? null,
    maxAge: body.maxAge ?? null,
    division: body.division ?? "youth",
    displayOrder: body.displayOrder ?? 0,
    notes: body.notes ?? null,
  }).returning();
  res.status(201).json(group);
});

router.get("/age-groups/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [group] = await db.select().from(ageGroupsTable).where(eq(ageGroupsTable.id, id));
  if (!group) {
    res.status(404).json({ error: "Age group not found" });
    return;
  }
  res.json(group);
});

router.patch("/age-groups/:id", requirePermission("canManageAgeGroups"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const body = req.body;
  const updates: Record<string, any> = { updatedAt: new Date() };
  if (body.label !== undefined) updates.label = body.label;
  if (body.minAge !== undefined) updates.minAge = body.minAge;
  if (body.maxAge !== undefined) updates.maxAge = body.maxAge;
  if (body.division !== undefined) updates.division = body.division;
  if (body.displayOrder !== undefined) updates.displayOrder = body.displayOrder;
  if (body.notes !== undefined) updates.notes = body.notes;

  const [group] = await db.update(ageGroupsTable).set(updates as any).where(eq(ageGroupsTable.id, id)).returning();
  if (!group) {
    res.status(404).json({ error: "Age group not found" });
    return;
  }
  res.json(group);
});

router.delete("/age-groups/:id", requirePermission("canManageAgeGroups"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [deleted] = await db.delete(ageGroupsTable).where(eq(ageGroupsTable.id, id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Age group not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
