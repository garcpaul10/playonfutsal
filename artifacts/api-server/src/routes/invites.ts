import { Router, type IRouter } from "express";
import { db, staffInvitesTable } from "@workspace/db";
import { eq, and, isNull, gt } from "drizzle-orm";
import { randomUUID } from "crypto";
import { requireAdmin, type AuthedRequest } from "../middlewares/auth";
import { sendInviteEmail } from "../services/notifications";

const router: IRouter = Router();

const PRIVILEGED_ROLES = ["ref", "coach", "scorekeeper", "staff"];

/** POST /admin/invites — Create a staff invite (admin only) */
router.post("/admin/invites", requireAdmin, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const { email, role } = req.body ?? {};

  if (!email || typeof email !== "string") {
    res.status(400).json({ error: "email is required" });
    return;
  }
  if (!role || !PRIVILEGED_ROLES.includes(role)) {
    res.status(400).json({ error: `role must be one of: ${PRIVILEGED_ROLES.join(", ")}` });
    return;
  }

  const token = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [invite] = await db
    .insert(staffInvitesTable)
    .values({ token, email, role, createdBy: authed.clerkUserId, createdAt: now, expiresAt })
    .returning();

  const appBase = (process.env.PUBLIC_APP_URL ?? "https://playonfutsal.com").replace(/\/$/, "");
  const inviteUrl = `${appBase}/sign-up?invite=${token}`;

  const emailResult = await sendInviteEmail(email, role, inviteUrl);

  if (!emailResult.sent) {
    res.status(201).json({
      ...invite,
      inviteUrl,
      emailWarning: `Invite created but the email could not be delivered (${emailResult.error ?? "unknown error"}). Share the invite link manually or use the Resend button.`,
    });
    return;
  }

  res.status(201).json({ ...invite, inviteUrl });
});

/** GET /admin/invites — List all invites with computed status (admin only) */
router.get("/admin/invites", requireAdmin, async (_req, res): Promise<void> => {
  const invites = await db.select().from(staffInvitesTable).orderBy(staffInvitesTable.createdAt);
  const now = new Date();

  const result = invites.map((inv) => {
    let status: "pending" | "accepted" | "expired" | "revoked";
    if (inv.revokedAt) status = "revoked";
    else if (inv.usedAt) status = "accepted";
    else if (inv.expiresAt < now) status = "expired";
    else status = "pending";
    return { ...inv, status };
  });

  res.json(result);
});

/** DELETE /admin/invites/:id — Revoke a pending invite (admin only) */
router.delete("/admin/invites/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid invite id" });
    return;
  }

  const [invite] = await db.select().from(staffInvitesTable).where(eq(staffInvitesTable.id, id));
  if (!invite) {
    res.status(404).json({ error: "Invite not found" });
    return;
  }
  if (invite.revokedAt || invite.usedAt) {
    res.status(409).json({ error: "Invite is already used or revoked" });
    return;
  }

  await db
    .update(staffInvitesTable)
    .set({ revokedAt: new Date() })
    .where(eq(staffInvitesTable.id, id));

  res.json({ success: true });
});

/** POST /admin/invites/:id/resend — Resend an invite email (admin only) */
router.post("/admin/invites/:id/resend", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid invite id" });
    return;
  }

  const [invite] = await db.select().from(staffInvitesTable).where(eq(staffInvitesTable.id, id));
  if (!invite) {
    res.status(404).json({ error: "Invite not found" });
    return;
  }
  if (invite.revokedAt || invite.usedAt) {
    res.status(409).json({ error: "Cannot resend a used or revoked invite" });
    return;
  }

  const appBase = (process.env.PUBLIC_APP_URL ?? "https://playonfutsal.com").replace(/\/$/, "");
  const inviteUrl = `${appBase}/sign-up?invite=${invite.token}`;

  const emailResult = await sendInviteEmail(invite.email, invite.role, inviteUrl);

  if (!emailResult.sent) {
    res.json({
      success: true,
      inviteUrl,
      emailWarning: `Invite link is valid but the email could not be delivered (${emailResult.error ?? "unknown error"}). Share the invite link manually.`,
    });
    return;
  }

  res.json({ success: true, inviteUrl });
});

/**
 * GET /invites/:token — Public token validation (no auth required).
 * Returns the role and email for valid tokens; 404/410 for invalid/expired/used/revoked.
 */
router.get("/invites/:token", async (req, res): Promise<void> => {
  const { token } = req.params;
  const now = new Date();

  const [invite] = await db
    .select()
    .from(staffInvitesTable)
    .where(eq(staffInvitesTable.token, token));

  if (!invite) {
    res.status(404).json({ error: "This invite link is no longer valid." });
    return;
  }
  if (invite.revokedAt) {
    res.status(410).json({ error: "This invite has been revoked by an admin." });
    return;
  }
  if (invite.usedAt) {
    res.status(410).json({ error: "This invite has already been used." });
    return;
  }
  if (invite.expiresAt < now) {
    res.status(410).json({ error: "This invite link has expired. Please ask an admin to send a new one." });
    return;
  }

  res.json({ email: invite.email, role: invite.role });
});

export default router;
