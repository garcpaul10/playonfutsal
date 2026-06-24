import { Router, type IRouter } from "express";
import { db, venuesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requirePermission } from "../middlewares/auth";

const router: IRouter = Router();

type VenueFields = {
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  website?: string;
  notes?: string;
};

router.get("/venues", async (_req, res): Promise<void> => {
  const venues = await db.select().from(venuesTable).orderBy(venuesTable.name);
  res.json(venues);
});

router.post("/venues", requirePermission("canManageVenues"), async (req, res): Promise<void> => {
  const body = req.body as VenueFields;
  if (!body?.name || !body?.address) {
    res.status(400).json({ error: "name and address are required" });
    return;
  }
  const [venue] = await db.insert(venuesTable).values({
    name: body.name,
    address: body.address,
    city: body.city ?? "Lexington",
    state: body.state ?? "KY",
    zip: body.zip ?? undefined,
    phone: body.phone ?? undefined,
    website: body.website ?? undefined,
    notes: body.notes ?? undefined,
  }).returning();
  res.status(201).json(venue);
});

router.get("/venues/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid venue id" });
    return;
  }
  const [venue] = await db.select().from(venuesTable).where(eq(venuesTable.id, id));
  if (!venue) {
    res.status(404).json({ error: "Venue not found" });
    return;
  }
  res.json(venue);
});

router.patch("/venues/:id", requirePermission("canManageVenues"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid venue id" });
    return;
  }
  const body = req.body as VenueFields;
  const updates: Record<string, any> = { updatedAt: new Date() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.address !== undefined) updates.address = body.address;
  if (body.city !== undefined) updates.city = body.city;
  if (body.state !== undefined) updates.state = body.state;
  if (body.zip !== undefined) updates.zip = body.zip;
  if (body.phone !== undefined) updates.phone = body.phone;
  if (body.website !== undefined) updates.website = body.website;
  if (body.notes !== undefined) updates.notes = body.notes;

  const [venue] = await db
    .update(venuesTable)
    .set(updates as any)
    .where(eq(venuesTable.id, id))
    .returning();
  if (!venue) {
    res.status(404).json({ error: "Venue not found" });
    return;
  }
  res.json(venue);
});

router.delete("/venues/:id", requirePermission("canManageVenues"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid venue id" });
    return;
  }
  const [deleted] = await db.delete(venuesTable).where(eq(venuesTable.id, id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Venue not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
