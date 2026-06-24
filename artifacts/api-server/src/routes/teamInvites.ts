import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { teamInvitesTable, teamMembersTable, teamsTable, usersTable } from "@workspace/db";
import { eq, and, isNull, gt, sql as drizzleSql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { requireAuth, hasPermission, type AuthedRequest } from "../middlewares/auth";

const TEAM_MANAGING_ROLES = ["captain", "manager", "coach"] as const;

const router: IRouter = Router();

const TEAM_INVITE_ROLES = ["manager", "coach"] as const;
type TeamInviteRole = typeof TEAM_INVITE_ROLES[number];

async function getDbUser(clerkId: string) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  return user;
}

/** Check whether a clerk user is a managing member of a given team */
async function isTeamManager(clerkUserId: string, teamId: number): Promise<boolean> {
  const isAdmin = await hasPermission(clerkUserId, "canManageLeagues");
  if (isAdmin) return true;

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (team?.captainUserId === clerkUserId) return true;

  const [member] = await db.select().from(teamMembersTable).where(
    and(
      eq(teamMembersTable.teamId, teamId),
      eq(teamMembersTable.userId, clerkUserId),
      eq(teamMembersTable.status, "active"),
    ),
  );
  return !!member && (TEAM_MANAGING_ROLES as readonly string[]).includes(member.role);
}

/**
 * POST /teams/:teamId/invites
 * Captain or manager sends a team-level invite for a coach or manager role.
 */
router.post("/teams/:teamId/invites", requireAuth, async (req, res): Promise<void> => {
  const teamId = Number(req.params.teamId);
  const clerkUserId = (req as AuthedRequest).clerkUserId;
  const { email, role } = req.body ?? {};

  if (!email || typeof email !== "string") {
    res.status(400).json({ error: "email is required" });
    return;
  }
  if (!role || !(TEAM_INVITE_ROLES as readonly string[]).includes(role)) {
    res.status(400).json({ error: `role must be one of: ${TEAM_INVITE_ROLES.join(", ")}` });
    return;
  }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }

  const canManage = await isTeamManager(clerkUserId, teamId);
  if (!canManage) {
    res.status(403).json({ error: "Only team captains, managers, or coaches can send invites" });
    return;
  }

  const token = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [invite] = await db.insert(teamInvitesTable).values({
    token,
    email: email.toLowerCase().trim(),
    teamId,
    role,
    createdBy: clerkUserId,
    createdAt: now,
    expiresAt,
  }).returning();

  const appBase = (process.env.PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const inviteUrl = `${appBase}/sign-up?team_invite=${token}`;

  res.status(201).json({ ...invite, inviteUrl, teamName: team.name });
});

/**
 * GET /teams/:teamId/invites
 * List team invites (captain, manager, coach, or admin).
 */
router.get("/teams/:teamId/invites", requireAuth, async (req, res): Promise<void> => {
  const teamId = Number(req.params.teamId);
  const clerkUserId = (req as AuthedRequest).clerkUserId;

  const canManage = await isTeamManager(clerkUserId, teamId);
  if (!canManage) {
    res.status(403).json({ error: "Only team managers can view invites" });
    return;
  }

  const invites = await db.select().from(teamInvitesTable)
    .where(eq(teamInvitesTable.teamId, teamId))
    .orderBy(teamInvitesTable.createdAt);

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

/**
 * DELETE /teams/:teamId/invites/:id
 * Revoke a pending team invite.
 */
router.delete("/teams/:teamId/invites/:id", requireAuth, async (req, res): Promise<void> => {
  const teamId = Number(req.params.teamId);
  const inviteId = Number(req.params.id);
  const clerkUserId = (req as AuthedRequest).clerkUserId;

  const canManage = await isTeamManager(clerkUserId, teamId);
  if (!canManage) {
    res.status(403).json({ error: "Only team managers can revoke invites" });
    return;
  }

  const [invite] = await db.select().from(teamInvitesTable)
    .where(and(eq(teamInvitesTable.id, inviteId), eq(teamInvitesTable.teamId, teamId)));
  if (!invite) {
    res.status(404).json({ error: "Invite not found" });
    return;
  }
  if (invite.revokedAt || invite.usedAt) {
    res.status(409).json({ error: "Invite is already used or revoked" });
    return;
  }

  await db.update(teamInvitesTable).set({ revokedAt: new Date() })
    .where(eq(teamInvitesTable.id, inviteId));

  res.json({ success: true });
});

/**
 * GET /invites/team/:token — Public token validation for team invites.
 * Returns team name, email, and role for valid tokens.
 */
router.get("/invites/team/:token", async (req, res): Promise<void> => {
  const { token } = req.params;
  const now = new Date();

  const [invite] = await db.select().from(teamInvitesTable)
    .where(eq(teamInvitesTable.token, token));

  if (!invite) {
    res.status(404).json({ error: "This invite link is no longer valid." });
    return;
  }
  if (invite.revokedAt) {
    res.status(410).json({ error: "This invite has been revoked." });
    return;
  }
  if (invite.usedAt) {
    res.status(410).json({ error: "This invite has already been used." });
    return;
  }
  if (invite.expiresAt < now) {
    res.status(410).json({ error: "This invite link has expired. Please ask your team captain to send a new one." });
    return;
  }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, invite.teamId));

  res.json({ email: invite.email, role: invite.role, teamId: invite.teamId, teamName: team?.name ?? null });
});

/**
 * POST /me/claim-team-invite
 * Authenticated user claims a team invite, creating their team member record.
 * This is called after sign-up completes.
 */
router.post("/me/claim-team-invite", requireAuth, async (req, res): Promise<void> => {
  const clerkUserId = (req as AuthedRequest).clerkUserId;
  const { token } = req.body ?? {};

  if (!token || typeof token !== "string") {
    res.status(400).json({ error: "token is required" });
    return;
  }

  const now = new Date();
  const [invite] = await db.select().from(teamInvitesTable)
    .where(eq(teamInvitesTable.token, token));

  if (!invite || invite.revokedAt || invite.usedAt || invite.expiresAt < now) {
    res.status(410).json({ error: "This invite is invalid, used, or expired." });
    return;
  }

  // Verify email binding
  const dbUser = await getDbUser(clerkUserId);
  if (!dbUser) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const canonicalEmail = (dbUser.email ?? "").toLowerCase().trim();
  const inviteEmail = (invite.email ?? "").toLowerCase().trim();
  if (canonicalEmail !== inviteEmail) {
    res.status(403).json({ error: "This invite was issued to a different email address." });
    return;
  }

  await db.transaction(async (tx) => {
    const [consumed] = await tx.update(teamInvitesTable)
      .set({ usedAt: now, usedBy: clerkUserId })
      .where(
        and(
          eq(teamInvitesTable.token, token),
          isNull(teamInvitesTable.usedAt),
          isNull(teamInvitesTable.revokedAt),
          gt(teamInvitesTable.expiresAt, now),
        ),
      ).returning();

    if (!consumed) throw new Error("INVITE_CONSUMED");

    // Check if already a member
    const [existing] = await tx.select().from(teamMembersTable)
      .where(and(
        eq(teamMembersTable.teamId, invite.teamId),
        eq(teamMembersTable.userId, clerkUserId),
        eq(teamMembersTable.status, "active"),
      ));

    if (!existing) {
      await tx.insert(teamMembersTable).values({
        teamId: invite.teamId,
        userId: clerkUserId,
        role: invite.role,
        status: "active",
      } as any);
    }

    // Also update the user's platform roles array to include the relevant platform-level role.
    // `roles` is a migration-added text[] column, not in the Drizzle schema type, so we use raw SQL.
    const platformRole = invite.role === "coach" ? "team_coach" : "team_manager";
    await tx.execute(drizzleSql`
      UPDATE users
      SET roles = array_append(COALESCE(roles, ARRAY[]::text[]), ${platformRole}::text)
      WHERE clerk_id = ${clerkUserId}
        AND NOT (${platformRole}::text = ANY(COALESCE(roles, ARRAY[]::text[])))
    `);
  });

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, invite.teamId));

  res.json({ success: true, teamId: invite.teamId, teamName: team?.name ?? null, role: invite.role });
});

/**
 * GET /me/pending-team-invites
 * Returns pending team invites for the logged-in user's email address.
 */
router.get("/me/pending-team-invites", requireAuth, async (req, res): Promise<void> => {
  const clerkUserId = (req as AuthedRequest).clerkUserId;
  const dbUser = await getDbUser(clerkUserId);
  if (!dbUser) { res.status(401).json({ error: "Unauthorized" }); return; }

  const email = (dbUser.email ?? "").toLowerCase().trim();
  const now = new Date();

  const invites = await db.select().from(teamInvitesTable)
    .where(and(
      eq(teamInvitesTable.email, email),
      isNull(teamInvitesTable.usedAt),
      isNull(teamInvitesTable.revokedAt),
      gt(teamInvitesTable.expiresAt, now),
    ));

  const enriched = await Promise.all(invites.map(async (inv) => {
    const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, inv.teamId));
    return { ...inv, teamName: team?.name ?? null };
  }));

  res.json(enriched);
});

/**
 * POST /me/team-invites/:id/decline
 * Allows the invitee to decline (server-side revoke) a pending team invite.
 */
router.post("/me/team-invites/:id/decline", requireAuth, async (req, res): Promise<void> => {
  const clerkUserId = (req as AuthedRequest).clerkUserId;
  const inviteId = Number(req.params.id);

  const dbUser = await getDbUser(clerkUserId);
  if (!dbUser) { res.status(401).json({ error: "Unauthorized" }); return; }

  const email = (dbUser.email ?? "").toLowerCase().trim();
  const now = new Date();

  const [invite] = await db.select().from(teamInvitesTable)
    .where(and(
      eq(teamInvitesTable.id, inviteId),
      eq(teamInvitesTable.email, email),
      isNull(teamInvitesTable.usedAt),
      isNull(teamInvitesTable.revokedAt),
      gt(teamInvitesTable.expiresAt, now),
    ));

  if (!invite) {
    res.status(404).json({ error: "Invite not found or already used/expired" });
    return;
  }

  await db.update(teamInvitesTable)
    .set({ revokedAt: now })
    .where(eq(teamInvitesTable.id, inviteId));

  res.json({ success: true });
});

export default router;
