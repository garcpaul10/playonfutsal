import { Router, type IRouter } from "express";
import { db, seasonsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  ListSeasonsQueryParams,
  ListSeasonsResponse,
  GetSeasonParams,
  GetSeasonResponse,
  CreateSeasonBody,
  UpdateSeasonParams,
  UpdateSeasonBody,
  UpdateSeasonResponse,
} from "@workspace/api-zod";
import { requirePermission } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/seasons", async (req, res): Promise<void> => {
  const query = ListSeasonsQueryParams.safeParse(req.query);
  let seasons = await db.select().from(seasonsTable).orderBy(seasonsTable.startDate);
  if (query.success && query.data.active !== undefined) {
    seasons = seasons.filter((s) => s.isActive === query.data.active);
  }
  res.json(ListSeasonsResponse.parse(seasons));
});

router.post("/seasons", requirePermission("canManageSchedules"), async (req, res): Promise<void> => {
  const parsed = CreateSeasonBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [season] = await db.insert(seasonsTable).values(parsed.data as any).returning();
  res.status(201).json(GetSeasonResponse.parse(season));
});

router.get("/seasons/:id", async (req, res): Promise<void> => {
  const params = GetSeasonParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [season] = await db.select().from(seasonsTable).where(eq(seasonsTable.id, params.data.id));
  if (!season) {
    res.status(404).json({ error: "Season not found" });
    return;
  }
  res.json(GetSeasonResponse.parse(season));
});

router.patch("/seasons/:id", requirePermission("canManageSchedules"), async (req, res): Promise<void> => {
  const params = UpdateSeasonParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateSeasonBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [season] = await db
    .update(seasonsTable)
    .set({ ...parsed.data, updatedAt: new Date() } as any)
    .where(eq(seasonsTable.id, params.data.id))
    .returning();
  if (!season) {
    res.status(404).json({ error: "Season not found" });
    return;
  }
  res.json(UpdateSeasonResponse.parse(season));
});

export default router;
