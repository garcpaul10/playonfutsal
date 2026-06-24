import { Router, type IRouter } from "express";
import { db, referralsTable, referralConfigTable, usersTable, accountCreditsTable } from "@workspace/db";
import { eq, and, isNull, isNotNull } from "drizzle-orm";
import { requireAuth, type AuthedRequest } from "../middlewares/auth";
import type { Request, Response } from "express";
import crypto from "crypto";

const router: IRouter = Router();

function makeCode(): string {
  return crypto.randomBytes(5).toString("hex").toUpperCase();
}

async function getDbUser(clerkId: string) {
  const [u] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  return u;
}

async function getConfig() {
  let [cfg] = await db.select().from(referralConfigTable).where(eq(referralConfigTable.id, 1));
  if (!cfg) {
    [cfg] = await db.insert(referralConfigTable).values({ id: 1 }).returning();
  }
  return cfg;
}

router.get("/referrals/config", async (_req: Request, res: Response): Promise<void> => {
  const cfg = await getConfig();
  res.json({ rewardCreditCents: cfg.rewardCreditCents, isEnabled: cfg.isEnabled });
});

router.post("/referrals/generate", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthedRequest;
  const user = await getDbUser(authed.clerkUserId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const cfg = await getConfig();
  if (!cfg.isEnabled) { res.status(400).json({ error: "Referral program is disabled" }); return; }

  const [anchor] = await db.select().from(referralsTable).where(
    and(eq(referralsTable.referrerId, user.id), isNull(referralsTable.referredUserId))
  );
  if (anchor) {
    res.json(anchor);
    return;
  }

  let code = makeCode();
  let tries = 0;
  while (tries < 5) {
    const conflict = await db.select().from(referralsTable).where(
      and(eq(referralsTable.code, code), isNull(referralsTable.referredUserId))
    );
    if (!conflict.length) break;
    code = makeCode();
    tries++;
  }

  const [ref] = await db.insert(referralsTable).values({
    code,
    referrerId: user.id,
    status: "pending",
    rewardCreditCents: cfg.rewardCreditCents,
  }).returning();

  res.status(201).json(ref);
});

router.get("/referrals/my", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthedRequest;
  const user = await getDbUser(authed.clerkUserId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const [anchor] = await db.select().from(referralsTable).where(
    and(eq(referralsTable.referrerId, user.id), isNull(referralsTable.referredUserId))
  );
  const events = await db.select().from(referralsTable).where(
    and(eq(referralsTable.referrerId, user.id), isNotNull(referralsTable.referredUserId))
  );
  const cfg = await getConfig();

  const code = anchor?.code ?? null;
  const link = code
    ? `${req.headers.origin ?? "https://playon.app"}/sign-up?ref=${code}`
    : null;

  res.json({
    code,
    link,
    rewardCreditCents: cfg.rewardCreditCents,
    isEnabled: cfg.isEnabled,
    referrals: events,
    completedCount: events.filter(r => r.status === "completed").length,
    pendingCount: anchor ? 1 : 0,
  });
});

router.post("/referrals/claim", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthedRequest;
  const { code } = req.body as { code?: string };
  if (!code) { res.status(400).json({ error: "code required" }); return; }

  const user = await getDbUser(authed.clerkUserId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const [anchor] = await db.select().from(referralsTable).where(
    and(eq(referralsTable.code, code), isNull(referralsTable.referredUserId))
  );
  if (!anchor) { res.status(404).json({ error: "Referral code not found" }); return; }
  if (anchor.referrerId === user.id) { res.status(400).json({ error: "Cannot claim your own referral" }); return; }

  const [alreadyClaimed] = await db.select().from(referralsTable).where(
    and(isNotNull(referralsTable.referredUserId), eq(referralsTable.referredUserId, user.id))
  );
  if (alreadyClaimed) { res.status(409).json({ error: "You have already used a referral code" }); return; }

  const cfg = await getConfig();
  if (!cfg.isEnabled) { res.status(400).json({ error: "Referral program is disabled" }); return; }

  const CLAIM_WINDOW_DAYS = 30;
  const accountAgeDays = (Date.now() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24);
  if (accountAgeDays > CLAIM_WINDOW_DAYS) {
    res.status(400).json({ error: "Referral codes can only be claimed within 30 days of account creation" });
    return;
  }

  const rewardCents = await db.transaction(async (tx) => {
    const existing = await tx.select().from(referralsTable).where(
      and(isNotNull(referralsTable.referredUserId), eq(referralsTable.referredUserId, user.id))
    );
    if (existing.length > 0) return null;

    await tx.insert(referralsTable).values({
      code: anchor.code,
      referrerId: anchor.referrerId,
      referredUserId: user.id,
      status: "completed",
      rewardCreditCents: cfg.rewardCreditCents,
      redeemedAt: new Date(),
    });

    const creditAmount = (cfg.rewardCreditCents / 100).toFixed(2);
    await tx.insert(accountCreditsTable).values({
      userId: anchor.referrerId,
      amount: creditAmount,
      remainingAmount: creditAmount,
      currency: "usd",
      reason: "referral",
      sourceEntityType: "referral",
      sourceEntityId: anchor.id,
      notes: `Referral reward — ${user.email ?? "new user"} signed up with code ${code}`,
    });

    return cfg.rewardCreditCents;
  });

  if (rewardCents === null) {
    res.status(409).json({ error: "You have already used a referral code" });
    return;
  }

  res.json({ success: true, rewardCreditCents: rewardCents });
});

export default router;
