import { Router, type IRouter } from "express";
import { db, usersTable, registrationsTable, leaguesTable, campsTable, dropinsTable, tournamentsTable, activityTable, auditLogTable, staffProfilesTable, teamsTable, teamMembersTable, spotsTable, leagueFreeAgentsTable, campRegistrationsTable, tournamentRegistrationsTable } from "@workspace/db";
import { count, sum, desc, eq, and, or, lte, isNull, ne, inArray, gte, sql as drizzleSql } from "drizzle-orm";
import { GetAdminStatsResponse, ListAdminActivityQueryParams, ListAdminActivityResponse, GetUserResponse } from "@workspace/api-zod";
import { requireAdmin, requireSuperAdmin, type AuthedRequest } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/admin/stats", requireAdmin, async (_req, res): Promise<void> => {
  const [totalUsersResult] = await db.select({ count: count() }).from(usersTable);
  const [totalRegistrationsResult] = await db.select({ count: count() }).from(registrationsTable);
  const [activeLeaguesResult] = await db.select({ count: count() }).from(leaguesTable);
  const [activeCampsResult] = await db.select({ count: count() }).from(campsTable);
  const [upcomingDropinsResult] = await db.select({ count: count() }).from(dropinsTable);
  const [upcomingTournamentsResult] = await db.select({ count: count() }).from(tournamentsTable);
  const [revenueResult] = await db.select({ total: sum(registrationsTable.amountPaid) }).from(registrationsTable);

  const allRegs = await db.select().from(registrationsTable);

  // Build a true deduped union count of drop-in participants across registrations + spots.
  // registrations.userId is a clerkId (string); spots.userId is an integer DB id.
  // We normalise both to a "clerkId-entityId" key so each real participant is counted once.
  const dropinRegs = allRegs.filter((r) => r.programType === "drop_in");
  const dropinParticipantKeys = new Set<string>(
    dropinRegs.map((r) => `${r.userId}-${r.programId}`),
  );

  const dropinSpots = await db
    .select({ userId: spotsTable.userId, entityId: spotsTable.entityId })
    .from(spotsTable)
    .where(
      and(
        eq(spotsTable.entityType, "dropin"),
        eq(spotsTable.status, "reserved"),
        eq(spotsTable.waitlisted, false),
      ),
    );

  if (dropinSpots.length > 0) {
    const spotUserIdInts = [...new Set(dropinSpots.map((s) => s.userId).filter((id): id is number => id != null))];
    if (spotUserIdInts.length > 0) {
      const spotUsers = await db
        .select({ id: usersTable.id, clerkId: usersTable.clerkId })
        .from(usersTable)
        .where(inArray(usersTable.id, spotUserIdInts));
      const spotUserClerkMap = new Map(spotUsers.map((u) => [u.id, u.clerkId]));
      for (const spot of dropinSpots) {
        if (!spot.userId) continue;
        const clerkId = spotUserClerkMap.get(spot.userId);
        if (clerkId) dropinParticipantKeys.add(`${clerkId}-${spot.entityId}`);
      }
    }
  }

  const byType = {
    league: allRegs.filter((r) => r.programType === "league").length,
    camp: allRegs.filter((r) => r.programType === "camp").length,
    drop_in: dropinParticipantKeys.size,
    tournament: allRegs.filter((r) => r.programType === "tournament").length,
  };

  const stats = {
    totalUsers: totalUsersResult.count,
    totalRegistrations: totalRegistrationsResult.count,
    activeLeagues: activeLeaguesResult.count,
    activeCamps: activeCampsResult.count,
    upcomingDropins: upcomingDropinsResult.count,
    upcomingTournaments: upcomingTournamentsResult.count,
    totalRevenue: Number(revenueResult.total ?? 0),
    registrationsByType: byType,
  };

  res.json(GetAdminStatsResponse.parse(stats));
});

router.get("/admin/activity", requireAdmin, async (req, res): Promise<void> => {
  const query = ListAdminActivityQueryParams.safeParse(req.query);
  const limit = query.success && query.data.limit ? query.data.limit : 20;
  const items = await db
    .select()
    .from(activityTable)
    .orderBy(desc(activityTable.createdAt))
    .limit(limit);
  res.json(ListAdminActivityResponse.parse(items));
});

/**
 * POST /admin/users/:id/approve-id
 * Manually approves ID verification for a user whose barcode scan failed
 * (e.g. old or damaged license). Requires super-admin. Writes audit log.
 * :id is the user's clerkId.
 */
router.post("/admin/users/:id/approve-id", requireSuperAdmin, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const clerkId = req.params.id as string;

  if (!clerkId) {
    res.status(400).json({ error: "User ID is required" });
    return;
  }

  const [before] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (!before) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (before.idVerified) {
    res.status(409).json({ error: "User is already ID verified" });
    return;
  }

  const now = new Date();
  const [user] = await db
    .update(usersTable)
    .set({ idVerified: true, idVerifiedAt: now, updatedAt: now })
    .where(eq(usersTable.clerkId, clerkId))
    .returning();

  try {
    await db.insert(auditLogTable).values({
      actorClerkId: authed.clerkUserId,
      action: "user.id_manually_approved",
      entityType: "user",
      entityId: String(user.id),
      before: JSON.stringify({ idVerified: false, idVerifiedAt: null }),
      after: JSON.stringify({ idVerified: true, idVerifiedAt: now }),
    });
  } catch {
    // Non-blocking audit log failure
  }

  res.json(GetUserResponse.parse(user));
});

/**
 * PATCH /admin/users/:id/admin-level
 * Change an admin user's adminLevel between "super" and "scoped".
 * Only callable by super-admins.
 * When downgrading to "scoped": auto-creates a staff_profiles row (all permissions off) if not already present.
 * When upgrading to "super": simply updates the field (confirmation is enforced on the frontend).
 * :id is the user's clerkId.
 */
router.patch("/admin/users/:id/admin-level", requireSuperAdmin, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const clerkId = req.params.id as string;

  const { adminLevel } = req.body ?? {};
  if (adminLevel !== "super" && adminLevel !== "scoped") {
    res.status(400).json({ error: "adminLevel must be 'super' or 'scoped'" });
    return;
  }

  const [target] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (target.role !== "admin") {
    res.status(400).json({ error: "User is not an admin" });
    return;
  }

  const before = { adminLevel: (target as any).adminLevel };

  const [updated] = await db
    .update(usersTable)
    .set({ adminLevel, updatedAt: new Date() } as any)
    .where(eq(usersTable.clerkId, clerkId))
    .returning();

  // When downgrading to scoped: ensure a staff_profiles row exists (all permissions default to false)
  if (adminLevel === "scoped") {
    const [existing] = await db.select().from(staffProfilesTable).where(eq(staffProfilesTable.userId, target.id));
    if (!existing) {
      await db.insert(staffProfilesTable).values({
        userId: target.id,
        isActive: true,
        canViewRegistrations: false,
      });
    }
  }

  try {
    await db.insert(auditLogTable).values({
      actorClerkId: authed.clerkUserId,
      action: "user.admin_level_changed",
      entityType: "user",
      entityId: String(target.id),
      before: JSON.stringify(before),
      after: JSON.stringify({ adminLevel }),
    });
  } catch {
    // Non-blocking
  }

  res.json({ id: updated.id, clerkId: updated.clerkId, adminLevel: (updated as any).adminLevel });
});

/**
 * GET /admin/dashboard-alerts
 * Returns counts for the three new attention-strip alert types:
 * - Free agents stuck in queue > 48 hours
 * - Camp registrations missing health packets with < 7 days until camp start
 * - Tournament registrations with incomplete rosters that are past their start date
 */
router.get("/admin/dashboard-alerts", requireAdmin, async (_req, res): Promise<void> => {
  try {
    const now = new Date();
    const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const nowDateStr = now.toISOString().split("T")[0];
    const sevenDaysStr = sevenDaysFromNow.toISOString().split("T")[0];

    const stuckFreeAgents = await db
      .select({ count: drizzleSql<number>`count(*)::int` })
      .from(leagueFreeAgentsTable)
      .where(
        and(
          ne(leagueFreeAgentsTable.status, "assigned"),
          or(
            and(
              eq(leagueFreeAgentsTable.matchStatus, "unmatched"),
              lte(leagueFreeAgentsTable.createdAt, fortyEightHoursAgo),
            ),
            and(
              inArray(leagueFreeAgentsTable.matchStatus, ["team_reviewing", "player_reviewing"]),
              lte(leagueFreeAgentsTable.proposedAt, fortyEightHoursAgo),
            ),
          ),
        ),
      );

    const missingHealthPackets = await db
      .select({ count: drizzleSql<number>`count(*)::int` })
      .from(campRegistrationsTable)
      .innerJoin(campsTable, eq(campRegistrationsTable.campId, campsTable.id))
      .where(
        and(
          eq(campRegistrationsTable.status, "confirmed"),
          isNull(campRegistrationsTable.healthPacketSubmittedAt),
          gte(campsTable.startDate, nowDateStr),
          lte(campsTable.startDate, sevenDaysStr),
        ),
      );

    const incompleteRosters = await db
      .select({ count: drizzleSql<number>`count(*)::int` })
      .from(tournamentRegistrationsTable)
      .innerJoin(tournamentsTable, eq(tournamentRegistrationsTable.tournamentId, tournamentsTable.id))
      .where(
        and(
          eq(tournamentRegistrationsTable.status, "active"),
          or(
            eq(tournamentRegistrationsTable.waiverSigned, false),
            isNull(tournamentRegistrationsTable.selfCheckinRosterJson),
          ),
          lte(tournamentsTable.startDate, nowDateStr),
        ),
      );

    res.json({
      stuckFreeAgentsCount: stuckFreeAgents[0]?.count ?? 0,
      missingHealthPacketsCount: missingHealthPackets[0]?.count ?? 0,
      incompleteRostersCount: incompleteRosters[0]?.count ?? 0,
    });
  } catch (err) {
    console.error("[dashboardAlerts] error:", err);
    res.status(500).json({ error: "Failed to load dashboard alerts" });
  }
});

/**
 * GET /admin/tournaments/:id/roster-status
 * Returns per-team roster completeness for a tournament (active member counts).
 */
router.get("/admin/tournaments/:id/roster-status", requireAdmin, async (req, res): Promise<void> => {
  const tournamentId = Number(req.params.id);

  const allRegs = await db.select().from(tournamentRegistrationsTable)
    .where(eq(tournamentRegistrationsTable.tournamentId, tournamentId));

  if (!allRegs.length) { res.json([]); return; }

  const regsWithTeams = allRegs.filter((r) => r.teamId !== null) as Array<typeof allRegs[number] & { teamId: number }>;
  const teamIds = regsWithTeams.map((r) => r.teamId);

  const [members, teams] = await Promise.all([
    teamIds.length > 0
      ? db.select().from(teamMembersTable).where(and(inArray(teamMembersTable.teamId, teamIds), eq(teamMembersTable.status, "active")))
      : [],
    teamIds.length > 0
      ? db.select().from(teamsTable).where(inArray(teamsTable.id, teamIds))
      : [],
  ]);

  const teamMap: Record<number, any> = Object.fromEntries((teams as any[]).map((t) => [t.id, t]));
  const membersByTeam: Record<number, any[]> = (members as any[]).reduce((acc: Record<number, any[]>, m) => {
    if (!acc[m.teamId]) acc[m.teamId] = [];
    acc[m.teamId].push(m);
    return acc;
  }, {});

  const result = regsWithTeams.map((reg) => {
    const teamMembers = membersByTeam[reg.teamId] ?? [];
    const playerCount = teamMembers.filter((m: any) => ["player", "captain"].includes(m.role)).length;
    const coachCount  = teamMembers.filter((m: any) => m.role === "coach").length;
    return {
      teamId: reg.teamId,
      teamName: teamMap[reg.teamId]?.name ?? `Team #${reg.teamId}`,
      playerCount,
      coachCount,
      totalCount: teamMembers.length,
      isComplete: playerCount >= 5,
    };
  });

  res.json(result);
});

/**
 * GET /admin/users/:clerkId/managed-teams
 * Returns teams that a user manages (captain, manager, or coach role).
 */
router.get("/admin/users/:clerkId/managed-teams", requireAdmin, async (req, res): Promise<void> => {
  const clerkId = String(req.params.clerkId);

  const [memberships, captainTeamRows] = await Promise.all([
    db.select().from(teamMembersTable).where(
      and(
        eq(teamMembersTable.userId, clerkId),
        eq(teamMembersTable.status, "active"),
        inArray(teamMembersTable.role, ["captain", "manager", "coach"]),
      ),
    ),
    db.select().from(teamsTable).where(eq(teamsTable.captainUserId, clerkId)),
  ]);

  const teamIds = [...new Set([
    ...memberships.map((m) => m.teamId),
    ...captainTeamRows.map((t) => t.id),
  ])];

  if (!teamIds.length) { res.json([]); return; }

  const teams = await db.select().from(teamsTable).where(inArray(teamsTable.id, teamIds));

  res.json(teams.map((t) => ({
    id: t.id,
    name: t.name,
    role: memberships.find((m) => m.teamId === t.id)?.role
      ?? (captainTeamRows.find((ct) => ct.id === t.id) ? "captain" : "manager"),
  })));
});

/**
 * POST /admin/users/:id/grant-admin
 * Atomically promotes a non-admin user to admin with the specified level.
 * Sets role="admin" and adminLevel in a single DB transaction.
 * When adminLevel="scoped", auto-creates a staff_profiles row (all permissions off) if absent.
 * Writes audit log and sends in-app notification.
 * Requires super-admin. :id is the user's clerkId.
 */
router.post("/admin/users/:id/grant-admin", requireSuperAdmin, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const clerkId = req.params.id as string;
  const { adminLevel } = req.body ?? {};

  if (adminLevel !== "super" && adminLevel !== "scoped") {
    res.status(400).json({ error: "adminLevel must be 'super' or 'scoped'" });
    return;
  }

  const [target] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (target.role === "admin") {
    res.status(409).json({ error: "User is already an admin" });
    return;
  }

  const before = { role: target.role, adminLevel: (target as any).adminLevel ?? null };

  try {
    let updated: typeof target;
    await db.transaction(async (tx) => {
      const [u] = await tx
        .update(usersTable)
        .set({ role: "admin", adminLevel, updatedAt: new Date() } as any)
        .where(eq(usersTable.clerkId, clerkId))
        .returning();
      updated = u;

      if (adminLevel === "scoped") {
        const [existing] = await tx.select().from(staffProfilesTable).where(eq(staffProfilesTable.userId, target.id));
        if (!existing) {
          await tx.insert(staffProfilesTable).values({
            userId: target.id,
            isActive: true,
            canViewRegistrations: false,
          });
        }
      }
    });

    try {
      await db.insert(auditLogTable).values({
        actorClerkId: authed.clerkUserId,
        action: "user.admin_granted",
        entityType: "user",
        entityId: String(target.id),
        before: JSON.stringify(before),
        after: JSON.stringify({ role: "admin", adminLevel }),
      });
    } catch {
      // Non-blocking
    }

    const { sendNotification } = await import("../services/notifications");
    await sendNotification({
      userId: target.id,
      channel: "in_app",
      type: "role_changed",
      subject: "Your role has been updated",
      body: `Your account role was changed from ${before.role} to admin (${adminLevel === "super" ? "Super Admin" : "Scoped Admin"}).`,
      metadata: { changedBy: authed.clerkUserId },
    });

    res.json({ id: updated!.id, clerkId: updated!.clerkId, role: updated!.role, adminLevel: (updated! as any).adminLevel });
  } catch (err: any) {
    console.error("[grant-admin] error:", err);
    res.status(500).json({ error: "Failed to grant admin access" });
  }
});

/**
 * DELETE /admin/users/:clerkId
 * Permanently deletes a user from Clerk and the local database.
 * Restricted to Super Admins only.
 */
router.delete("/admin/users/:clerkId", requireSuperAdmin, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const clerkId = req.params.clerkId as string;

  if (!clerkId) {
    res.status(400).json({ error: "User ID is required" });
    return;
  }

  if (clerkId === authed.clerkUserId) {
    res.status(400).json({ error: "You cannot delete your own account" });
    return;
  }

  const [target] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  try {
    await db.delete(usersTable).where(eq(usersTable.clerkId, clerkId));
  } catch (err: any) {
    console.error("[delete-user] DB deletion failed:", err);
    res.status(500).json({ error: "Failed to delete user from database" });
    return;
  }

  try {
    const { clerkClient } = await import("@clerk/express");
    await (clerkClient as any).users.deleteUser(clerkId);
  } catch (err: any) {
    console.error("[delete-user] Clerk deletion failed (DB row already removed):", err);
    res.status(502).json({ error: "Failed to delete user from authentication provider" });
    return;
  }

  try {
    await db.insert(auditLogTable).values({
      actorClerkId: authed.clerkUserId,
      action: "user.deleted",
      entityType: "user",
      entityId: String(target.id),
      before: JSON.stringify({ clerkId: target.clerkId, email: target.email, role: target.role }),
      after: JSON.stringify(null),
    });
  } catch {
    // Non-blocking
  }

  res.json({ success: true });
});

/**
 * GET /admin/users/search
 * Searches users by partial name or email.
 * Requires super-admin. Returns up to 10 matching results.
 * Query params:
 *   q (required, min 2 chars)
 *   all (optional, "1" to include admin users — used by the Role Manager)
 */
router.get("/admin/users/search", requireSuperAdmin, async (req, res): Promise<void> => {
  const q = String(req.query.q ?? "").trim().toLowerCase();
  const includeAll = req.query.all === "1";

  if (q.length < 2) {
    res.status(400).json({ error: "Search query must be at least 2 characters" });
    return;
  }

  try {
    const allUsers = await db
      .select({
        id: usersTable.id,
        clerkId: usersTable.clerkId,
        email: usersTable.email,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        role: usersTable.role,
        roles: usersTable.roles,
        adminLevel: usersTable.adminLevel,
      })
      .from(usersTable);

    const matches = allUsers
      .filter((u) => includeAll || u.role !== "admin")
      .filter(
        (u) =>
          u.email.toLowerCase().includes(q) ||
          (u.firstName ?? "").toLowerCase().includes(q) ||
          (u.lastName ?? "").toLowerCase().includes(q) ||
          `${u.firstName ?? ""} ${u.lastName ?? ""}`.toLowerCase().includes(q),
      )
      .slice(0, 10);

    res.json(matches);
  } catch (err) {
    console.error("[admin/users/search] error:", err);
    res.status(500).json({ error: "Failed to search users" });
  }
});

/**
 * PATCH /admin/users/:userId/roles
 * Set the full roles array (and optional adminLevel) for any user.
 * Protected by requireSuperAdmin — scoped admins cannot call this.
 *
 * Body:
 *   roles: string[]       — full desired roles array (validated against VALID_ROLES)
 *   adminLevel?: string   — "super" | "scoped" (only relevant when "admin" is in roles)
 *
 * Side-effects:
 *   - Updates users.roles to the supplied array
 *   - Derives users.role (primary role) from the array for backward-compat
 *   - Sets users.adminLevel when the admin role is present
 *   - Writes an audit log entry for every call
 */
const VALID_ROLES = ["player", "parent", "ref", "coach", "scorekeeper", "staff", "admin"] as const;

router.patch("/admin/users/:userId/roles", requireSuperAdmin, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const userId = Number(req.params.userId);

  if (isNaN(userId)) {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }

  const { roles, adminLevel } = req.body ?? {};

  if (!Array.isArray(roles)) {
    res.status(400).json({ error: "roles must be an array" });
    return;
  }

  const invalidRoles = roles.filter((r: string) => !(VALID_ROLES as readonly string[]).includes(r));
  if (invalidRoles.length > 0) {
    res.status(400).json({ error: `Invalid roles: ${invalidRoles.join(", ")}. Valid roles: ${VALID_ROLES.join(", ")}` });
    return;
  }

  if (adminLevel !== undefined && adminLevel !== "super" && adminLevel !== "scoped") {
    res.status(400).json({ error: "adminLevel must be 'super' or 'scoped'" });
    return;
  }

  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Derive the primary "role" field for backward compat:
  // admin > staff > scorekeeper > coach > ref > parent > player
  const ROLE_PRIORITY = ["admin", "staff", "scorekeeper", "coach", "ref", "parent", "player"];
  const primaryRole = ROLE_PRIORITY.find((r) => roles.includes(r)) ?? "player";

  const beforeRoles = (target as any).roles ?? [];
  const beforeRole = target.role;
  const beforeAdminLevel = (target as any).adminLevel ?? null;

  const updatePayload: Record<string, any> = {
    roles,
    role: primaryRole,
    updatedAt: new Date(),
  };

  if (primaryRole === "admin") {
    updatePayload.adminLevel = adminLevel ?? beforeAdminLevel ?? "super";
  } else {
    // Removing admin role — clear adminLevel
    updatePayload.adminLevel = null;
  }

  // If moving to admin+scoped, ensure a staff_profiles row exists
  const effectiveAdminLevel = updatePayload.adminLevel;

  // Guard: prevent removing/downgrading the last super admin
  const targetIsCurrentlySuperAdmin =
    Array.isArray((target as any).roles) &&
    (target as any).roles.includes("admin") &&
    (target as any).adminLevel === "super";

  const changeRemovesSuperAdmin =
    targetIsCurrentlySuperAdmin &&
    (updatePayload.adminLevel !== "super" || !roles.includes("admin"));

  if (changeRemovesSuperAdmin) {
    const otherSuperAdmins = await db
      .select()
      .from(usersTable)
      .where(
        and(
          ne(usersTable.id, userId),
          eq((usersTable as any).adminLevel, "super")
        )
      );

    if (otherSuperAdmins.length === 0) {
      res.status(409).json({
        error:
          "Cannot remove or downgrade the last super admin. Promote another user to super admin first.",
      });
      return;
    }
  }

  await db.update(usersTable).set(updatePayload).where(eq(usersTable.id, userId));

  if (primaryRole === "admin" && effectiveAdminLevel === "scoped") {
    const [existing] = await db.select().from(staffProfilesTable).where(eq(staffProfilesTable.userId, userId));
    if (!existing) {
      await db.insert(staffProfilesTable).values({
        userId,
        isActive: true,
        canViewRegistrations: false,
      });
    }
  }

  try {
    await db.insert(auditLogTable).values({
      actorClerkId: authed.clerkUserId,
      action: "user.roles_changed",
      entityType: "user",
      entityId: String(userId),
      before: JSON.stringify({ role: beforeRole, roles: beforeRoles, adminLevel: beforeAdminLevel }),
      after: JSON.stringify({ role: primaryRole, roles, adminLevel: effectiveAdminLevel }),
    });
  } catch {
    // Non-blocking
  }

  const [updated] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  res.json({
    id: updated.id,
    clerkId: updated.clerkId,
    role: updated.role,
    roles: (updated as any).roles,
    adminLevel: (updated as any).adminLevel,
  });
});

/**
 * GET /admin/users/:id/id-photo
 * Streams the user's ID photo through the API server (no signed URL needed).
 * Restricted to super-admin only. :id is the user's clerkId.
 */
router.get("/admin/users/:id/id-photo", requireSuperAdmin, async (req, res): Promise<void> => {
  const clerkId = req.params.id as string;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const idPhotoUrl = (user as any).idPhotoUrl;
  if (!idPhotoUrl) {
    res.status(404).json({ error: "No ID photo on file for this user" });
    return;
  }

  try {
    const { downloadIdPhoto } = await import("../lib/idPhotoStorage");
    const { buffer, contentType } = await downloadIdPhoto(idPhotoUrl);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } catch (err: any) {
    console.error("[admin/users/:id/id-photo] Failed to stream ID photo:", err?.message ?? err);
    res.status(500).json({ error: "Failed to load ID photo" });
  }
});

export default router;
