import { Router, type IRouter } from "express";
import { db, accountCreditsTable, usersTable, auditLogTable } from "@workspace/db";
import { eq, desc, and, gt, or, isNull } from "drizzle-orm";
import { requireAuth, requireSuperAdmin, requirePermission, hasPermission, type AuthedRequest } from "../middlewares/auth";
import type { Request } from "express";

const router: IRouter = Router();

// GET /account-credits — list credits for the authenticated user (or all for admin)
router.get("/account-credits", requireAuth, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const isAdmin = await hasPermission(authed.clerkUserId, "canViewReports");
  const { userId: queryUserId } = req.query as Record<string, string>;

  const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));

  if (isAdmin && queryUserId) {
    // Admin looking up a specific user's credits
    const targetUser = await db.select().from(usersTable).where(eq(usersTable.clerkId, queryUserId));
    if (!targetUser[0]) { res.json([]); return; }
    const credits = await db.select().from(accountCreditsTable)
      .where(eq(accountCreditsTable.userId, targetUser[0].id))
      .orderBy(desc(accountCreditsTable.createdAt));
    res.json(credits);
    return;
  }

  if (!dbUser) { res.json([]); return; }

  // Own credits only — filter out expired ones
  const now = new Date();
  const credits = await db.select().from(accountCreditsTable)
    .where(and(
      eq(accountCreditsTable.userId, dbUser.id),
      or(isNull(accountCreditsTable.expiresAt), gt(accountCreditsTable.expiresAt, now)),
    ))
    .orderBy(desc(accountCreditsTable.createdAt));
  res.json(credits);
});

// POST /admin/account-credits — manually issue a credit (admin)
router.post("/admin/account-credits", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const body = req.body as Record<string, unknown>;

  if (!body.clerkUserId || body.amount == null) {
    res.status(400).json({ error: "clerkUserId and amount are required" });
    return;
  }

  const [targetUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, body.clerkUserId as string));
  if (!targetUser) { res.status(404).json({ error: "User not found" }); return; }

  const amount = Number(body.amount);
  if (isNaN(amount) || amount <= 0) {
    res.status(400).json({ error: "amount must be a positive number" });
    return;
  }

  let expiresAt: Date | null = null;
  if (body.expiryDays != null) {
    expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + Number(body.expiryDays));
  } else if (body.expiresAt) {
    expiresAt = new Date(body.expiresAt as string);
  }

  const [credit] = await db.insert(accountCreditsTable).values({
    userId: targetUser.id,
    amount: String(amount),
    remainingAmount: String(amount),
    currency: "usd",
    reason: (body.reason as string) ?? "manual_credit",
    sourceEntityType: (body.sourceEntityType as string) ?? null,
    sourceEntityId: body.sourceEntityId != null ? Number(body.sourceEntityId) : null,
    expiresAt,
    notes: (body.notes as string) ?? null,
  } as any).returning();

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "issue_credit",
    entityType: "account_credit",
    entityId: String(credit.id),
    after: JSON.stringify(credit),
    notes: `Issued $${amount} credit to user ${body.clerkUserId}`,
  });

  res.status(201).json(credit);
});

// DELETE /admin/account-credits/:id — revoke a credit
router.delete("/admin/account-credits/:id", requireSuperAdmin, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [credit] = await db.select().from(accountCreditsTable).where(eq(accountCreditsTable.id, id));
  if (!credit) { res.status(404).json({ error: "Credit not found" }); return; }

  // Zero out remaining amount to revoke
  await db.update(accountCreditsTable)
    .set({ remainingAmount: "0", usedAt: new Date(), updatedAt: new Date() } as any)
    .where(eq(accountCreditsTable.id, id));

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "revoke_credit",
    entityType: "account_credit",
    entityId: String(id),
    before: JSON.stringify(credit),
  });

  res.sendStatus(204);
});

export default router;
