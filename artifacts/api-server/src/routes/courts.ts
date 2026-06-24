import { Router, type IRouter } from "express";
import { db, courtsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { GetCourtParams, ListCourtsResponse, GetCourtResponse } from "@workspace/api-zod";
import { requirePermission } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/courts", async (_req, res): Promise<void> => {
  const courts = await db.select().from(courtsTable).orderBy(courtsTable.id);
  res.json(ListCourtsResponse.parse(courts));
});

router.post("/courts", requirePermission("canManageCourts"), async (req, res): Promise<void> => {
  const body = req.body;
  if (!body?.name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const [court] = await db.insert(courtsTable).values({
    name: body.name,
    type: body.type ?? "full",
    description: body.description ?? null,
    availableForScheduling: body.availableForScheduling ?? true,
    maxPlayers: body.maxPlayers ?? 10,
    venueId: body.venueId ?? null,
  }).returning();
  res.status(201).json(GetCourtResponse.parse(court));
});

router.get("/courts/:id", async (req, res): Promise<void> => {
  const params = GetCourtParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [court] = await db.select().from(courtsTable).where(eq(courtsTable.id, params.data.id));
  if (!court) {
    res.status(404).json({ error: "Court not found" });
    return;
  }
  res.json(GetCourtResponse.parse(court));
});

router.patch("/courts/:id", requirePermission("canManageCourts"), async (req, res): Promise<void> => {
  const params = GetCourtParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = req.body;
  const updates: Record<string, any> = { updatedAt: new Date() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.type !== undefined) updates.type = body.type;
  if (body.description !== undefined) updates.description = body.description;
  if (body.availableForScheduling !== undefined) updates.availableForScheduling = body.availableForScheduling;
  if (body.maxPlayers !== undefined) updates.maxPlayers = body.maxPlayers;
  if (body.venueId !== undefined) updates.venueId = body.venueId ?? null;

  const [court] = await db
    .update(courtsTable)
    .set(updates)
    .where(eq(courtsTable.id, params.data.id))
    .returning();
  if (!court) {
    res.status(404).json({ error: "Court not found" });
    return;
  }
  res.json(GetCourtResponse.parse(court));
});

router.delete("/courts/:id", requirePermission("canManageCourts"), async (req, res): Promise<void> => {
  const params = GetCourtParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db.delete(courtsTable).where(eq(courtsTable.id, params.data.id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Court not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
