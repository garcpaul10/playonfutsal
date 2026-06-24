import { Router, type IRouter } from "express";
import { db, ageGroupWaiversTable, guardiansTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requirePermission, type AuthedRequest } from "../middlewares/auth";

const router: IRouter = Router();

async function getDbUser(clerkId: string) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  return user;
}

router.post("/age-group-waivers", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as AuthedRequest).clerkUserId;
  const requestingUser = await getDbUser(clerkId);
  if (!requestingUser) { res.status(404).json({ error: "User not found" }); return; }

  const { playerId, ageGroup, reason } = req.body;
  if (!playerId || !ageGroup || !reason) {
    res.status(400).json({ error: "playerId, ageGroup, and reason are required" });
    return;
  }

  const playerIdNum = Number(playerId);
  if (isNaN(playerIdNum)) { res.status(400).json({ error: "Invalid playerId" }); return; }

  if (playerIdNum !== requestingUser.id) {
    const [guardianLink] = await db.select().from(guardiansTable).where(
      and(
        eq(guardiansTable.guardianUserId, requestingUser.id),
        eq(guardiansTable.youthUserId, playerIdNum),
        eq(guardiansTable.status, "approved" as any),
      )
    );
    if (!guardianLink) {
      res.status(403).json({ error: "You do not have an approved guardian relationship with this player" });
      return;
    }
  }

  const [player] = await db.select().from(usersTable).where(eq(usersTable.id, playerIdNum));
  if (!player) { res.status(404).json({ error: "Player not found" }); return; }

  const [waiver] = await db.insert(ageGroupWaiversTable).values({
    playerId: playerIdNum,
    requestedBy: requestingUser.id,
    ageGroup: String(ageGroup).toLowerCase(),
    reason: String(reason).trim(),
    status: "pending",
  } as any).returning();

  res.status(201).json(waiver);
});

router.get("/age-group-waivers", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as AuthedRequest).clerkUserId;
  const requestingUser = await getDbUser(clerkId);
  if (!requestingUser) { res.status(404).json({ error: "User not found" }); return; }

  const { status, playerId } = req.query as Record<string, string>;

  let waivers = await db.select().from(ageGroupWaiversTable);

  if (status) waivers = waivers.filter((w) => w.status === status);
  if (playerId) waivers = waivers.filter((w) => w.playerId === Number(playerId));

  const enriched = await Promise.all(waivers.map(async (w) => {
    const [player] = await db.select({
      id: usersTable.id,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      dateOfBirth: usersTable.dateOfBirth,
    }).from(usersTable).where(eq(usersTable.id, w.playerId));

    const [requester] = await db.select({
      id: usersTable.id,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      email: usersTable.email,
    }).from(usersTable).where(eq(usersTable.id, w.requestedBy));

    return { ...w, player: player ?? null, requester: requester ?? null };
  }));

  res.json(enriched);
});

router.get("/age-group-waivers/player/:playerId", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as AuthedRequest).clerkUserId;
  const requestingUser = await getDbUser(clerkId);
  if (!requestingUser) { res.status(404).json({ error: "User not found" }); return; }

  const playerIdNum = Number(req.params.playerId);
  if (isNaN(playerIdNum)) { res.status(400).json({ error: "Invalid playerId" }); return; }

  if (playerIdNum !== requestingUser.id) {
    const [guardianLink] = await db.select().from(guardiansTable).where(
      and(
        eq(guardiansTable.guardianUserId, requestingUser.id),
        eq(guardiansTable.youthUserId, playerIdNum),
        eq(guardiansTable.status, "approved" as any),
      )
    );
    if (!guardianLink) {
      res.status(403).json({ error: "Not authorized to view waivers for this player" });
      return;
    }
  }

  const waivers = await db.select().from(ageGroupWaiversTable)
    .where(eq(ageGroupWaiversTable.playerId, playerIdNum));

  res.json(waivers);
});

router.patch("/age-group-waivers/:id", requirePermission("canManageAgeGroups"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const clerkId = (req as AuthedRequest).clerkUserId;
  const reviewer = await getDbUser(clerkId);
  if (!reviewer) { res.status(404).json({ error: "Reviewer not found" }); return; }

  const { status, adminNote } = req.body;
  if (!status || !["approved", "denied"].includes(status)) {
    res.status(400).json({ error: "status must be 'approved' or 'denied'" });
    return;
  }

  const [existing] = await db.select().from(ageGroupWaiversTable).where(eq(ageGroupWaiversTable.id, id));
  if (!existing) { res.status(404).json({ error: "Waiver request not found" }); return; }

  const [updated] = await db.update(ageGroupWaiversTable).set({
    status,
    adminNote: adminNote ?? null,
    reviewedBy: reviewer.id,
    updatedAt: new Date(),
  } as any).where(eq(ageGroupWaiversTable.id, id)).returning();

  res.json(updated);
});

export default router;
