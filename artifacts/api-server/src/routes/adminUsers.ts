import { Router, type IRouter } from "express";
import {
  db, usersTable, guardiansTable, paymentsTable,
  leagueRegistrationsTable, leaguesTable, teamsTable, standingsTable,
  tournamentRegistrationsTable, tournamentsTable,
  campRegistrationsTable, campsTable,
  spotsTable, dropinsTable, auditLogTable, playerProfilesTable,
} from "@workspace/db";
import { eq, or, and, inArray, desc, asc, sql, isNotNull } from "drizzle-orm";
import { requireSuperAdmin, type AuthedRequest } from "../middlewares/auth";
import { clerkClient } from "@clerk/express";
import { getUncachableStripeClient } from "../lib/stripe";
import { sendNotificationWithPreferences, sendMultiChannelNotification } from "../services/notifications";

const router: IRouter = Router();

/**
 * GET /admin/clerk-users
 * List users from the local DB with optional search by name or email.
 * Paginated; super-admin only.
 */
router.get("/admin/clerk-users", requireSuperAdmin, async (req, res): Promise<void> => {
  try {
    const q = String(req.query.q ?? "").trim().toLowerCase();
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? "25"), 10)));
    const offset = (page - 1) * limit;

    const allUsers = await db
      .select({
        id: usersTable.id,
        clerkId: usersTable.clerkId,
        email: usersTable.email,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        phone: usersTable.phone,
        role: usersTable.role,
        roles: usersTable.roles,
        adminLevel: usersTable.adminLevel,
        idVerified: usersTable.idVerified,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .orderBy(desc(usersTable.createdAt));

    const filtered = q
      ? allUsers.filter(
          (u) =>
            u.email.toLowerCase().includes(q) ||
            (u.firstName ?? "").toLowerCase().includes(q) ||
            (u.lastName ?? "").toLowerCase().includes(q) ||
            `${u.firstName ?? ""} ${u.lastName ?? ""}`.toLowerCase().includes(q),
        )
      : allUsers;

    const total = filtered.length;
    const items = filtered.slice(offset, offset + limit);

    res.json({ items, total, page, limit });
  } catch (err) {
    console.error("[GET /admin/clerk-users] error:", err);
    res.status(500).json({ error: "Failed to list users" });
  }
});

/**
 * GET /admin/clerk-users/:clerkId
 * Get a single user's full profile from local DB + Clerk + playerProfile.
 */
router.get("/admin/clerk-users/:clerkId", requireSuperAdmin, async (req, res): Promise<void> => {
  const clerkId = req.params.clerkId;
  try {
    const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
    if (!dbUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Load player profile (may not exist)
    const [playerProfile] = await db
      .select()
      .from(playerProfilesTable)
      .where(eq(playerProfilesTable.userId, dbUser.id));

    let clerkUser: any = null;
    try {
      clerkUser = await (clerkClient as any).users.getUser(clerkId);
    } catch {
      // Non-blocking — Clerk may not have this user if deleted externally
    }

    // Compute ID verification status + rejection reason + approver (use any-cast since some fields may not be in compiled type)
    const dbUserAny = dbUser as any;

    let idVerificationStatus: string;
    let idVerifiedByName: string | null = null;
    let idVerifiedByClerkId: string | null = null;
    let idRejectionReason: string | null = null;

    if (dbUserAny.idVerified) {
      idVerificationStatus = "approved";
    } else {
      // Check audit log for a rejection action (may have been set by a future reject endpoint)
      // Action: "user.id_rejected" — forward-compatible, no DB column required
      try {
        const [rejectionLog] = await db
          .select({ actorClerkId: auditLogTable.actorClerkId, after: auditLogTable.after })
          .from(auditLogTable)
          .where(
            and(
              eq(auditLogTable.action, "user.id_rejected"),
              eq(auditLogTable.entityType, "user"),
              eq(auditLogTable.entityId, String(dbUser.id)),
            )
          )
          .orderBy(desc(auditLogTable.createdAt))
          .limit(1);

        if (rejectionLog) {
          idVerificationStatus = "rejected";
          try {
            const parsed = JSON.parse(rejectionLog.after ?? "{}");
            idRejectionReason = parsed?.reason ?? null;
          } catch { /* non-blocking */ }
        } else {
          idVerificationStatus = dbUserAny.idPhotoUrl ? "pending" : "not_submitted";
        }
      } catch {
        idVerificationStatus = dbUserAny.idPhotoUrl ? "pending" : "not_submitted";
      }
    }

    // Look up who approved the ID (from audit log) when status is approved
    if (dbUserAny.idVerified && dbUserAny.idVerifiedAt) {
      try {
        const [approvalLog] = await db
          .select({ actorClerkId: auditLogTable.actorClerkId })
          .from(auditLogTable)
          .where(
            and(
              eq(auditLogTable.action, "user.id_manually_approved"),
              eq(auditLogTable.entityType, "user"),
              eq(auditLogTable.entityId, String(dbUser.id)),
            )
          )
          .orderBy(desc(auditLogTable.createdAt))
          .limit(1);

        if (approvalLog?.actorClerkId) {
          idVerifiedByClerkId = approvalLog.actorClerkId;
          const [approver] = await db
            .select({ firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email })
            .from(usersTable)
            .where(eq(usersTable.clerkId, approvalLog.actorClerkId));
          if (approver) {
            idVerifiedByName =
              [approver.firstName, approver.lastName].filter(Boolean).join(" ") || approver.email;
          }
        }
      } catch {
        // Non-blocking — audit log lookup failure should not fail the main request
      }
    }

    res.json({
      ...dbUser,
      idVerificationStatus,
      idVerifiedByName,
      idVerifiedByClerkId,
      idRejectionReason,
      // Player profile fields (read-only from player's own profile)
      // fitnessLevel maps to "skill level"; primaryPosition/secondaryPosition map to "sport preferences"
      skillLevel: playerProfile?.fitnessLevel ?? null,
      primaryPosition: playerProfile?.primaryPosition ?? null,
      secondaryPosition: playerProfile?.secondaryPosition ?? null,
      profileGender: playerProfile?.gender ?? null,
      // Clerk data
      clerkEmail: clerkUser?.emailAddresses?.find((e: any) => e.id === clerkUser.primaryEmailAddressId)?.emailAddress ?? null,
      clerkFirstName: clerkUser?.firstName ?? null,
      clerkLastName: clerkUser?.lastName ?? null,
      lastActiveAt: clerkUser?.lastActiveAt ?? null,
      lastSignInAt: clerkUser?.lastSignInAt ?? null,
    });
  } catch (err) {
    console.error("[GET /admin/clerk-users/:clerkId] error:", err);
    res.status(500).json({ error: "Failed to get user" });
  }
});

/**
 * PATCH /admin/clerk-users/:clerkId
 * Update a user's first name, last name, email, phone, and/or dateOfBirth in both the local DB and Clerk.
 */
router.patch("/admin/clerk-users/:clerkId", requireSuperAdmin, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const clerkId = req.params.clerkId;
  const { firstName, lastName, email, phone, dateOfBirth } = req.body ?? {};

  if (!firstName && !lastName && !email && phone === undefined && dateOfBirth === undefined) {
    res.status(400).json({ error: "At least one field is required" });
    return;
  }

  try {
    const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
    if (!dbUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const before = { firstName: dbUser.firstName, lastName: dbUser.lastName, email: dbUser.email, phone: dbUser.phone, dateOfBirth: dbUser.dateOfBirth };
    const updates: Record<string, any> = { updatedAt: new Date() };
    if (firstName !== undefined) updates.firstName = firstName;
    if (lastName !== undefined) updates.lastName = lastName;
    if (email !== undefined) updates.email = email;
    if (phone !== undefined) updates.phone = phone || null;
    if (dateOfBirth !== undefined) updates.dateOfBirth = dateOfBirth || null;

    const clerkWarnings: string[] = [];

    // Update name in Clerk
    if (firstName !== undefined || lastName !== undefined) {
      const clerkUpdates: Record<string, any> = {};
      if (firstName !== undefined) clerkUpdates.firstName = firstName;
      if (lastName !== undefined) clerkUpdates.lastName = lastName;
      try {
        await (clerkClient as any).users.updateUser(clerkId, clerkUpdates);
      } catch (err: any) {
        const msg = `Clerk name sync failed: ${err.message ?? "unknown error"}`;
        console.warn("[PATCH /admin/clerk-users/:clerkId]", msg);
        clerkWarnings.push(msg);
      }
    }

    // Update email in Clerk separately (create as primary+verified, then delete old)
    if (email !== undefined && email !== dbUser.email) {
      try {
        let clerkUser: any = null;
        try { clerkUser = await (clerkClient as any).users.getUser(clerkId); } catch {}
        const oldEmailId = clerkUser?.primaryEmailAddressId ?? null;
        await (clerkClient as any).emailAddresses.createEmailAddress({
          userId: clerkId,
          emailAddress: email,
          primary: true,
          verified: true,
        });
        if (oldEmailId) {
          try { await (clerkClient as any).emailAddresses.deleteEmailAddress(oldEmailId); } catch {}
        }
      } catch (err: any) {
        const msg = `Clerk email sync failed: ${err.message ?? "unknown error"}`;
        console.warn("[PATCH /admin/clerk-users/:clerkId]", msg);
        clerkWarnings.push(msg);
      }
    }

    // Always persist local DB updates so the admin's changes are recorded
    const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.clerkId, clerkId)).returning();

    try {
      await db.insert(auditLogTable).values({
        actorClerkId: authed.clerkUserId,
        action: "user.profile_updated_by_admin",
        entityType: "user",
        entityId: String(dbUser.id),
        before: JSON.stringify(before),
        after: JSON.stringify(updates),
      });
    } catch {}

    res.json({ ...updated, clerkWarnings: clerkWarnings.length > 0 ? clerkWarnings : undefined });
  } catch (err) {
    console.error("[PATCH /admin/clerk-users/:clerkId] error:", err);
    res.status(500).json({ error: "Failed to update user" });
  }
});

/**
 * POST /admin/clerk-users/:clerkId/reset-password
 * Creates a Clerk sign-in token for the user and returns a login URL
 * that the admin can email to the user to regain account access.
 */
router.post("/admin/clerk-users/:clerkId/reset-password", requireSuperAdmin, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const clerkId = req.params.clerkId;

  try {
    const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
    if (!dbUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const signInToken = await (clerkClient as any).signInTokens.createSignInToken({
      userId: clerkId,
      expiresInSeconds: 86400,
    });

    try {
      await db.insert(auditLogTable).values({
        actorClerkId: authed.clerkUserId,
        action: "user.password_reset_issued",
        entityType: "user",
        entityId: String(dbUser.id),
        before: JSON.stringify({}),
        after: JSON.stringify({ issuedAt: new Date().toISOString() }),
      });
    } catch {}

    res.json({ token: signInToken.token, url: signInToken.url ?? null });
  } catch (err: any) {
    console.error("[POST /admin/clerk-users/:clerkId/reset-password] error:", err);
    res.status(500).json({ error: err?.message ?? "Failed to create sign-in token" });
  }
});

/**
 * GET /admin/clerk-users/:clerkId/family
 * Returns all family links for a user (both as guardian and as youth member).
 */
router.get("/admin/clerk-users/:clerkId/family", requireSuperAdmin, async (req, res): Promise<void> => {
  const clerkId = req.params.clerkId;
  try {
    const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
    if (!dbUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const linkedUserAlias = db
      .select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email, dateOfBirth: usersTable.dateOfBirth, clerkId: usersTable.clerkId })
      .from(usersTable)
      .as("linked_user");

    const familySelectShape = {
      id: guardiansTable.id,
      relationship: guardiansTable.relationship,
      status: guardiansTable.status,
      isPrimary: guardiansTable.isPrimary,
      canRegister: guardiansTable.canRegister,
      canPickup: guardiansTable.canPickup,
      createdAt: guardiansTable.createdAt,
      linkedUserId: linkedUserAlias.id,
      linkedClerkId: linkedUserAlias.clerkId,
      linkedFirstName: linkedUserAlias.firstName,
      linkedLastName: linkedUserAlias.lastName,
      linkedEmail: linkedUserAlias.email,
      linkedDateOfBirth: linkedUserAlias.dateOfBirth,
    };

    const [asGuardian, asYouth] = await Promise.all([
      db.select(familySelectShape)
        .from(guardiansTable)
        .leftJoin(linkedUserAlias, eq(guardiansTable.youthUserId, linkedUserAlias.id))
        .where(eq(guardiansTable.guardianUserId, dbUser.id)),
      db.select(familySelectShape)
        .from(guardiansTable)
        .leftJoin(linkedUserAlias, eq(guardiansTable.guardianUserId, linkedUserAlias.id))
        .where(eq(guardiansTable.youthUserId, dbUser.id)),
    ]);

    const guardianLinks = asGuardian.map((r) => ({
      id: r.id,
      direction: "guardian" as const,
      relationship: r.relationship,
      status: r.status,
      isPrimary: r.isPrimary,
      canRegister: r.canRegister,
      canPickup: r.canPickup,
      createdAt: r.createdAt,
      linkedUserId: r.linkedUserId,
      linkedClerkId: r.linkedClerkId,
      linkedFirstName: r.linkedFirstName,
      linkedLastName: r.linkedLastName,
      linkedEmail: r.linkedEmail,
      linkedDateOfBirth: r.linkedDateOfBirth,
    }));
    const youthLinks = asYouth.map((r) => ({
      id: r.id,
      direction: "child" as const,
      relationship: r.relationship,
      status: r.status,
      isPrimary: r.isPrimary,
      canRegister: r.canRegister,
      canPickup: r.canPickup,
      createdAt: r.createdAt,
      linkedUserId: r.linkedUserId,
      linkedClerkId: r.linkedClerkId,
      linkedFirstName: r.linkedFirstName,
      linkedLastName: r.linkedLastName,
      linkedEmail: r.linkedEmail,
      linkedDateOfBirth: r.linkedDateOfBirth,
    }));

    res.json([...guardianLinks, ...youthLinks]);
  } catch (err) {
    console.error("[GET /admin/clerk-users/:clerkId/family] error:", err);
    res.status(500).json({ error: "Failed to get family links" });
  }
});

/**
 * DELETE /admin/clerk-users/:clerkId/family/:linkId
 * Remove a guardian link (unlink, not delete users).
 */
router.delete("/admin/clerk-users/:clerkId/family/:linkId", requireSuperAdmin, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const clerkId = req.params.clerkId;
  const linkId = parseInt(req.params.linkId, 10);

  if (isNaN(linkId)) {
    res.status(400).json({ error: "Invalid link ID" });
    return;
  }

  try {
    const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
    if (!dbUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const [link] = await db.select().from(guardiansTable).where(
      and(
        eq(guardiansTable.id, linkId),
        or(
          eq(guardiansTable.guardianUserId, dbUser.id),
          eq(guardiansTable.youthUserId, dbUser.id),
        ),
      ),
    );

    if (!link) {
      res.status(404).json({ error: "Family link not found" });
      return;
    }

    await db.delete(guardiansTable).where(eq(guardiansTable.id, linkId));

    try {
      await db.insert(auditLogTable).values({
        actorClerkId: authed.clerkUserId,
        action: "user.family_link_removed",
        entityType: "guardian",
        entityId: String(linkId),
        before: JSON.stringify(link),
        after: JSON.stringify(null),
      });
    } catch {}

    res.json({ success: true });
  } catch (err) {
    console.error("[DELETE /admin/clerk-users/:clerkId/family/:linkId] error:", err);
    res.status(500).json({ error: "Failed to remove family link" });
  }
});

/**
 * GET /admin/clerk-users/:clerkId/registrations
 * Returns all registrations for this user and their family members,
 * grouped by person (userId), across all program types.
 */
router.get("/admin/clerk-users/:clerkId/registrations", requireSuperAdmin, async (req, res): Promise<void> => {
  const clerkId = req.params.clerkId;
  try {
    const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
    if (!dbUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Find family member IDs (as guardian or as youth)
    const [asGuardian, asYouth] = await Promise.all([
      db.select({ youthUserId: guardiansTable.youthUserId }).from(guardiansTable)
        .where(and(eq(guardiansTable.guardianUserId, dbUser.id), eq(guardiansTable.status, "approved"))),
      db.select({ guardianUserId: guardiansTable.guardianUserId }).from(guardiansTable)
        .where(and(eq(guardiansTable.youthUserId, dbUser.id), eq(guardiansTable.status, "approved"))),
    ]);

    const familyDbIds = [
      ...asGuardian.map((r) => r.youthUserId),
      ...asYouth.map((r) => r.guardianUserId),
    ];

    // Collect all userIds whose registrations we care about
    const allUserDbIds = [dbUser.id, ...familyDbIds];

    // Fetch user details for each
    const familyUsers = familyDbIds.length > 0
      ? await db.select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email, clerkId: usersTable.clerkId })
          .from(usersTable).where(inArray(usersTable.id, familyDbIds))
      : [];

    const userMap: Record<number, { id: number; firstName: string | null; lastName: string | null; email: string; clerkId: string }> = {
      [dbUser.id]: { id: dbUser.id, firstName: dbUser.firstName, lastName: dbUser.lastName, email: dbUser.email, clerkId: dbUser.clerkId },
    };
    for (const u of familyUsers) userMap[u.id] = u;

    // Build clerkId → dbUserId map for league registrations (stored by Clerk ID)
    const clerkIdToDbId: Record<string, number> = { [dbUser.clerkId]: dbUser.id };
    for (const u of familyUsers) clerkIdToDbId[u.clerkId] = u.id;
    const allClerkIds = Object.keys(clerkIdToDbId);

    // Query all registration types in parallel
    const [leagueRegs, tournamentRegs, campRegs] = await Promise.all([
      db.select({
        id: leagueRegistrationsTable.id,
        leagueId: leagueRegistrationsTable.leagueId,
        registeredByClerkId: leagueRegistrationsTable.registeredByUserId,
        status: leagueRegistrationsTable.status,
        paymentStatus: leagueRegistrationsTable.paymentStatus,
        amountPaid: leagueRegistrationsTable.amountPaid,
        createdAt: leagueRegistrationsTable.createdAt,
        leagueName: leaguesTable.name,
        leagueStartDate: leaguesTable.startDate,
        leagueEndDate: leaguesTable.endDate,
      })
        .from(leagueRegistrationsTable)
        .leftJoin(leaguesTable, eq(leagueRegistrationsTable.leagueId, leaguesTable.id))
        .where(inArray(leagueRegistrationsTable.registeredByUserId, allClerkIds))
        .orderBy(desc(leagueRegistrationsTable.createdAt)),
      db.select({
        id: tournamentRegistrationsTable.id,
        tournamentId: tournamentRegistrationsTable.tournamentId,
        registeredByUserId: tournamentRegistrationsTable.registeredByUserId,
        status: tournamentRegistrationsTable.status,
        paymentStatus: tournamentRegistrationsTable.paymentStatus,
        amountPaid: tournamentRegistrationsTable.amountPaid,
        createdAt: tournamentRegistrationsTable.createdAt,
        tournamentName: tournamentsTable.name,
        tournamentStartDate: tournamentsTable.startDate,
        tournamentEndDate: tournamentsTable.endDate,
      })
        .from(tournamentRegistrationsTable)
        .leftJoin(tournamentsTable, eq(tournamentRegistrationsTable.tournamentId, tournamentsTable.id))
        .where(inArray(tournamentRegistrationsTable.registeredByUserId, allUserDbIds))
        .orderBy(desc(tournamentRegistrationsTable.createdAt)),
      db.select({
        id: campRegistrationsTable.id,
        campId: campRegistrationsTable.campId,
        userId: campRegistrationsTable.userId,
        playerUserId: campRegistrationsTable.playerUserId,
        status: campRegistrationsTable.status,
        paymentStatus: campRegistrationsTable.paymentStatus,
        pricePaid: campRegistrationsTable.pricePaid,
        createdAt: campRegistrationsTable.createdAt,
        campName: campsTable.name,
        campStartDate: campsTable.startDate,
        campEndDate: campsTable.endDate,
      })
        .from(campRegistrationsTable)
        .leftJoin(campsTable, eq(campRegistrationsTable.campId, campsTable.id))
        .where(inArray(campRegistrationsTable.userId, allUserDbIds))
        .orderBy(desc(campRegistrationsTable.createdAt)),
    ]);

    // Dropin spots
    const dropinSpots = await db.select({
      id: spotsTable.id,
      entityId: spotsTable.entityId,
      userId: spotsTable.userId,
      status: spotsTable.status,
      paymentStatus: spotsTable.paymentStatus,
      waitlisted: spotsTable.waitlisted,
      createdAt: spotsTable.createdAt,
      dropinName: dropinsTable.name,
      dropinDate: dropinsTable.startsAt,
    })
      .from(spotsTable)
      .leftJoin(dropinsTable, eq(spotsTable.entityId, dropinsTable.id))
      .where(
        and(
          inArray(spotsTable.userId, allUserDbIds),
          eq(spotsTable.entityType, "dropin"),
        ),
      )
      .orderBy(desc(spotsTable.createdAt));

    // Build result grouped by userId
    const result: Record<number, any> = {};
    function ensureUser(userId: number) {
      if (!result[userId]) {
        const u = userMap[userId];
        result[userId] = {
          userId,
          firstName: u?.firstName ?? null,
          lastName: u?.lastName ?? null,
          email: u?.email ?? "",
          clerkId: u?.clerkId ?? "",
          registrations: [],
        };
      }
    }

    for (const r of leagueRegs) {
      const uid = clerkIdToDbId[r.registeredByClerkId];
      if (uid == null) continue;
      ensureUser(uid);
      result[uid].registrations.push({
        id: r.id,
        type: "league",
        eventName: r.leagueName ?? `League #${r.leagueId}`,
        startDate: r.leagueStartDate,
        endDate: r.leagueEndDate,
        status: r.status,
        paymentStatus: r.paymentStatus,
        amountPaid: Number(r.amountPaid ?? 0),
        createdAt: r.createdAt,
        eventId: r.leagueId,
        eventPath: `/admin/leagues?highlight=${r.leagueId}`,
      });
    }
    for (const r of tournamentRegs) {
      const uid = r.registeredByUserId;
      if (!uid || !allUserDbIds.includes(uid)) continue;
      ensureUser(uid);
      result[uid].registrations.push({
        id: r.id,
        type: "tournament",
        eventName: r.tournamentName ?? `Tournament #${r.tournamentId}`,
        startDate: r.tournamentStartDate,
        endDate: r.tournamentEndDate,
        status: r.status,
        paymentStatus: r.paymentStatus,
        amountPaid: Number(r.amountPaid ?? 0),
        createdAt: r.createdAt,
        eventId: r.tournamentId,
        eventPath: `/admin/tournaments?highlight=${r.tournamentId}`,
      });
    }
    for (const r of campRegs) {
      const uid = r.userId;
      if (!allUserDbIds.includes(uid)) continue;
      ensureUser(uid);
      result[uid].registrations.push({
        id: r.id,
        type: "camp",
        eventName: r.campName ?? `Camp #${r.campId}`,
        startDate: r.campStartDate,
        endDate: r.campEndDate,
        status: r.status,
        paymentStatus: r.paymentStatus,
        amountPaid: Number(r.pricePaid ?? 0),
        createdAt: r.createdAt,
        eventId: r.campId,
        eventPath: `/admin/camps?highlight=${r.campId}`,
        playerUserId: r.playerUserId,
      });
    }
    for (const s of dropinSpots) {
      const uid = s.userId;
      if (!uid || !allUserDbIds.includes(uid)) continue;
      ensureUser(uid);
      result[uid].registrations.push({
        id: s.id,
        type: "dropin",
        eventName: s.dropinName ?? `Drop-in #${s.entityId}`,
        startDate: s.dropinDate,
        endDate: s.dropinDate,
        status: s.status === "cancelled" ? "cancelled" : s.waitlisted ? "waitlisted" : "active",
        paymentStatus: s.paymentStatus,
        amountPaid: 0,
        createdAt: s.createdAt,
        eventId: s.entityId,
        eventPath: `/admin/dropins?highlight=${s.entityId}`,
      });
    }

    res.json(Object.values(result));
  } catch (err) {
    console.error("[GET /admin/clerk-users/:clerkId/registrations] error:", err);
    res.status(500).json({ error: "Failed to get registrations" });
  }
});

/**
 * DELETE /admin/registrations/:type/:registrationId
 * Cancel an active registration by type (league | tournament | camp | dropin).
 * Frees the spot and marks the registration as cancelled.
 */
router.delete("/admin/registrations/:type/:registrationId", requireSuperAdmin, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const type = req.params.type as string;
  const regId = parseInt(req.params.registrationId, 10);

  if (isNaN(regId)) {
    res.status(400).json({ error: "Invalid registration ID" });
    return;
  }
  if (!["league", "tournament", "camp", "dropin"].includes(type)) {
    res.status(400).json({ error: "Invalid registration type" });
    return;
  }

  try {
    const now = new Date();
    let result: any = null;

    if (type === "league") {
      const [reg] = await db.select().from(leagueRegistrationsTable).where(eq(leagueRegistrationsTable.id, regId));
      if (!reg) { res.status(404).json({ error: "Registration not found" }); return; }
      if (reg.status === "cancelled") { res.status(400).json({ error: "Already cancelled" }); return; }

      [result] = await db.update(leagueRegistrationsTable)
        .set({ status: "cancelled", updatedAt: now } as any)
        .where(eq(leagueRegistrationsTable.id, regId))
        .returning();

      // Mirror cancellation side-effects from leagues.ts:
      // Only decrement + promote if the registration previously occupied a counted slot.
      const priorStatusCounted = ["active", "confirmed", "pending"].includes(String(reg.status));
      const wasWaitlisted = reg.status === "waitlisted";
      const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, reg.leagueId));

      if (priorStatusCounted && reg.teamId) {
        await db.update(teamsTable)
          .set({ leagueId: null, status: "inactive", updatedAt: now } as any)
          .where(eq(teamsTable.id, reg.teamId));
        await db.update(leaguesTable)
          .set({ teamsRegistered: sql`GREATEST(${leaguesTable.teamsRegistered} - 1, 0)`, updatedAt: now } as any)
          .where(eq(leaguesTable.id, reg.leagueId));

        // Promote first waitlisted team (FIFO)
        const [waitlisted] = await db.select().from(leagueRegistrationsTable)
          .where(and(eq(leagueRegistrationsTable.leagueId, reg.leagueId), eq(leagueRegistrationsTable.status as any, "waitlisted")))
          .orderBy(asc(leagueRegistrationsTable.waitlistPosition as any), asc(leagueRegistrationsTable.createdAt))
          .limit(1);

        if (waitlisted && waitlisted.teamId) {
          await db.update(leagueRegistrationsTable)
            .set({ status: "pending", waitlistPosition: null, updatedAt: now } as any)
            .where(eq(leagueRegistrationsTable.id, waitlisted.id));
          await db.update(teamsTable)
            .set({ leagueId: reg.leagueId, status: "pending", updatedAt: now } as any)
            .where(eq(teamsTable.id, waitlisted.teamId));
          await db.update(leaguesTable)
            .set({ teamsRegistered: sql`${leaguesTable.teamsRegistered} + 1`, updatedAt: now } as any)
            .where(eq(leaguesTable.id, reg.leagueId));
          await db.insert(standingsTable)
            .values({ leagueId: reg.leagueId, seasonId: league?.seasonId, teamId: waitlisted.teamId } as any)
            .onConflictDoNothing();

          // Renumber remaining waitlisted regs for this league
          const remaining = await db.select().from(leagueRegistrationsTable)
            .where(and(eq(leagueRegistrationsTable.leagueId, reg.leagueId), eq(leagueRegistrationsTable.status as any, "waitlisted")))
            .orderBy(asc(leagueRegistrationsTable.waitlistPosition as any), asc(leagueRegistrationsTable.createdAt));
          for (let i = 0; i < remaining.length; i++) {
            await db.update(leagueRegistrationsTable)
              .set({ waitlistPosition: i + 1, updatedAt: now } as any)
              .where(eq(leagueRegistrationsTable.id, remaining[i].id));
          }

          // Notify promoted team captain
          const [promotedTeam] = await db.select().from(teamsTable).where(eq(teamsTable.id, waitlisted.teamId));
          if (promotedTeam?.captainUserId) {
            const [captainUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, promotedTeam.captainUserId));
            if (captainUser) {
              await sendNotificationWithPreferences({
                userId: captainUser.id,
                type: "waitlist_movement",
                subject: `Your team is off the waitlist for ${league?.name ?? "the league"}!`,
                body: `Your team "${promotedTeam.name}" has moved off the waitlist and is now registered for ${league?.name ?? "the league"}.`,
              } as any).catch(() => {});
            }
          }
        }
      } else if (wasWaitlisted && (reg as any).waitlistPosition != null) {
        // Cancelled a waitlisted league reg — just renumber remaining
        const remaining = await db.select().from(leagueRegistrationsTable)
          .where(and(eq(leagueRegistrationsTable.leagueId, reg.leagueId), eq(leagueRegistrationsTable.status as any, "waitlisted")))
          .orderBy(asc(leagueRegistrationsTable.waitlistPosition as any), asc(leagueRegistrationsTable.createdAt));
        for (let i = 0; i < remaining.length; i++) {
          await db.update(leagueRegistrationsTable)
            .set({ waitlistPosition: i + 1, updatedAt: now } as any)
            .where(eq(leagueRegistrationsTable.id, remaining[i].id));
        }
      }

    } else if (type === "tournament") {
      const [reg] = await db.select().from(tournamentRegistrationsTable).where(eq(tournamentRegistrationsTable.id, regId));
      if (!reg) { res.status(404).json({ error: "Registration not found" }); return; }
      if (reg.status === "cancelled") { res.status(400).json({ error: "Already cancelled" }); return; }
      [result] = await db.update(tournamentRegistrationsTable)
        .set({ status: "cancelled", updatedAt: now } as any)
        .where(eq(tournamentRegistrationsTable.id, regId))
        .returning();

    } else if (type === "camp") {
      const [reg] = await db.select().from(campRegistrationsTable).where(eq(campRegistrationsTable.id, regId));
      if (!reg) { res.status(404).json({ error: "Registration not found" }); return; }
      if (reg.status === "cancelled") { res.status(400).json({ error: "Already cancelled" }); return; }

      [result] = await db.update(campRegistrationsTable)
        .set({ status: "cancelled", waitlistPosition: null, updatedAt: now } as any)
        .where(eq(campRegistrationsTable.id, regId))
        .returning();

      const wasConfirmed = reg.status === "confirmed" || reg.status === "pending";
      const wasWaitlisted = reg.status === "waitlisted";

      if (wasConfirmed) {
        // Decrement participant count then promote next waitlisted
        await db.update(campsTable).set({
          participantsRegistered: sql`GREATEST(0, ${campsTable.participantsRegistered} - 1)`,
          updatedAt: now,
        } as any).where(eq(campsTable.id, reg.campId));

        // Inline promoteNextWaitlistedCamp logic
        const [next] = await db.select().from(campRegistrationsTable)
          .where(and(
            eq(campRegistrationsTable.campId, reg.campId),
            eq(campRegistrationsTable.status, "waitlisted"),
            isNotNull(campRegistrationsTable.waitlistPosition),
          ))
          .orderBy(asc(campRegistrationsTable.waitlistPosition))
          .limit(1);

        if (next) {
          const promotedPosition = next.waitlistPosition ?? 0;
          const [promoted] = await db.update(campRegistrationsTable)
            .set({ status: "confirmed", waitlistPosition: null, updatedAt: now } as any)
            .where(eq(campRegistrationsTable.id, next.id))
            .returning();
          await db.update(campsTable).set({
            participantsRegistered: sql`${campsTable.participantsRegistered} + 1`,
            updatedAt: now,
          } as any).where(eq(campsTable.id, reg.campId));
          await db.execute(sql`
            UPDATE camp_registrations
            SET waitlist_position = waitlist_position - 1
            WHERE camp_id = ${reg.campId}
              AND status = 'waitlisted'
              AND waitlist_position > ${promotedPosition}
          `);
          const [camp] = await db.select().from(campsTable).where(eq(campsTable.id, reg.campId));
          if (camp && promoted.userId) {
            await sendNotificationWithPreferences({
              userId: promoted.userId,
              type: "waitlist_movement",
              subject: `You're off the waitlist for ${camp.name}!`,
              body: `A spot opened up and you've been confirmed for ${camp.name}. Check your dashboard for details.`,
            }).catch(() => {});
          }
        }
      } else if (wasWaitlisted && reg.waitlistPosition != null) {
        // Renumber remaining waitlisted entries for this camp
        await db.execute(sql`
          UPDATE camp_registrations
          SET waitlist_position = waitlist_position - 1
          WHERE camp_id = ${reg.campId}
            AND status = 'waitlisted'
            AND waitlist_position > ${reg.waitlistPosition}
        `);
      }

    } else if (type === "dropin") {
      const [spot] = await db.select().from(spotsTable).where(eq(spotsTable.id, regId));
      if (!spot) { res.status(404).json({ error: "Registration not found" }); return; }
      if (spot.status === "cancelled") { res.status(400).json({ error: "Already cancelled" }); return; }

      [result] = await db.update(spotsTable)
        .set({ status: "cancelled", cancelledAt: now, updatedAt: now } as any)
        .where(and(eq(spotsTable.id, regId), sql`${spotsTable.status} != 'cancelled'`))
        .returning();
      if (!result) { res.status(400).json({ error: "Spot already cancelled" }); return; }

      // Notify the player
      if (spot.userId) {
        const [dropin] = await db.select().from(dropinsTable).where(eq(dropinsTable.id, spot.entityId));
        if (dropin) {
          await sendMultiChannelNotification(["in_app", "email"], {
            userId: spot.userId,
            type: "registration_cancelled",
            subject: `Drop-in spot cancelled`,
            body: `Your spot for ${dropin.name} has been cancelled by an admin.`,
          }).catch(() => {});
        }
      }

      // Promote next waitlisted player if this was not itself waitlisted
      if (!spot.waitlisted && spot.poolId) {
        // Inline promoteNextWaitlisted logic
        const [nextWaiting] = await db.select().from(spotsTable)
          .where(and(
            eq(spotsTable.poolId, spot.poolId),
            eq(spotsTable.entityType, "dropin"),
            eq(spotsTable.entityId, spot.entityId),
            eq(spotsTable.waitlisted, true),
            eq(spotsTable.status, "reserved"),
          ))
          .orderBy(asc(spotsTable.waitlistPosition))
          .limit(1);

        if (nextWaiting) {
          const [promoted] = await db.update(spotsTable)
            .set({ waitlisted: false, waitlistPosition: null, promotedFromWaitlist: true, confirmedAt: now, updatedAt: now })
            .where(eq(spotsTable.id, nextWaiting.id))
            .returning();
          await db.execute(
            sql`UPDATE spots
                SET waitlist_position = waitlist_position - 1
                WHERE pool_id = ${spot.poolId}
                  AND entity_type = 'dropin'
                  AND entity_id = ${spot.entityId}
                  AND waitlisted = true
                  AND status = 'reserved'
                  AND waitlist_position > ${nextWaiting.waitlistPosition ?? 1}`
          );
          if (promoted.userId) {
            const [dropin] = await db.select().from(dropinsTable).where(eq(dropinsTable.id, spot.entityId));
            if (dropin) {
              await sendMultiChannelNotification(["in_app", "email"], {
                userId: promoted.userId,
                type: "registration_confirmed",
                subject: `You're in! Spot confirmed for ${dropin.name}`,
                body: `A spot opened up and you've been moved from the waitlist! Your spot for ${dropin.name} is now confirmed.`,
                metadata: { dropinId: spot.entityId, poolId: spot.poolId },
              }).catch(() => {});
            }
          }
        }
      }
    }

    try {
      await db.insert(auditLogTable).values({
        actorClerkId: authed.clerkUserId,
        action: `registration.cancelled_by_admin`,
        entityType: type,
        entityId: String(regId),
        before: JSON.stringify({ status: "active" }),
        after: JSON.stringify({ status: "cancelled" }),
      });
    } catch {}

    res.json({ success: true, result });
  } catch (err) {
    console.error("[DELETE /admin/registrations/:type/:registrationId] error:", err);
    res.status(500).json({ error: "Failed to cancel registration" });
  }
});

/**
 * GET /admin/clerk-users/:clerkId/payments
 * Returns the full payment history for a user and their family members.
 */
router.get("/admin/clerk-users/:clerkId/payments", requireSuperAdmin, async (req, res): Promise<void> => {
  const clerkId = req.params.clerkId;
  try {
    const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
    if (!dbUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const [asGuardianRows, asYouthRows] = await Promise.all([
      db.select({ youthUserId: guardiansTable.youthUserId }).from(guardiansTable)
        .where(and(eq(guardiansTable.guardianUserId, dbUser.id), eq(guardiansTable.status, "approved"))),
      db.select({ guardianUserId: guardiansTable.guardianUserId }).from(guardiansTable)
        .where(and(eq(guardiansTable.youthUserId, dbUser.id), eq(guardiansTable.status, "approved"))),
    ]);

    const familyDbIds = [
      ...asGuardianRows.map((r) => r.youthUserId),
      ...asYouthRows.map((r) => r.guardianUserId),
    ].filter((id, i, arr) => arr.indexOf(id) === i); // deduplicate
    const allUserDbIds = [dbUser.id, ...familyDbIds];

    // Get family user info for labelling
    const familyUsers = familyDbIds.length > 0
      ? await db.select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName })
          .from(usersTable).where(inArray(usersTable.id, familyDbIds))
      : [];
    const userNameMap: Record<number, string> = {
      [dbUser.id]: [dbUser.firstName, dbUser.lastName].filter(Boolean).join(" ") || dbUser.email,
    };
    for (const u of familyUsers) {
      userNameMap[u.id] = [u.firstName, u.lastName].filter(Boolean).join(" ") || "Family member";
    }

    const payments = await db.select().from(paymentsTable)
      .where(inArray(paymentsTable.userId, allUserDbIds))
      .orderBy(desc(paymentsTable.createdAt));

    // Resolve event names per entityType — batch by unique IDs to avoid N+1
    const byType: Record<string, number[]> = {};
    for (const p of payments) {
      if (!p.entityType || p.entityId == null) continue;
      if (!byType[p.entityType]) byType[p.entityType] = [];
      if (!byType[p.entityType].includes(p.entityId)) byType[p.entityType].push(p.entityId);
    }
    const eventNameMap: Record<string, Record<number, string>> = {};
    await Promise.all(
      Object.entries(byType).map(async ([etype, ids]) => {
        eventNameMap[etype] = {};
        if (etype === "league") {
          const rows = await db.select({ id: leaguesTable.id, name: leaguesTable.name }).from(leaguesTable).where(inArray(leaguesTable.id, ids));
          for (const r of rows) eventNameMap[etype][r.id] = r.name ?? `League #${r.id}`;
        } else if (etype === "tournament") {
          const rows = await db.select({ id: tournamentsTable.id, name: tournamentsTable.name }).from(tournamentsTable).where(inArray(tournamentsTable.id, ids));
          for (const r of rows) eventNameMap[etype][r.id] = r.name ?? `Tournament #${r.id}`;
        } else if (etype === "camp") {
          const rows = await db.select({ id: campsTable.id, name: campsTable.name }).from(campsTable).where(inArray(campsTable.id, ids));
          for (const r of rows) eventNameMap[etype][r.id] = r.name ?? `Camp #${r.id}`;
        } else if (etype === "dropin") {
          const rows = await db.select({ id: dropinsTable.id, name: dropinsTable.name }).from(dropinsTable).where(inArray(dropinsTable.id, ids));
          for (const r of rows) eventNameMap[etype][r.id] = r.name ?? `Drop-in #${r.id}`;
        }
      })
    );

    res.json(payments.map((p) => {
      const eventName = (p.entityType && p.entityId != null)
        ? (eventNameMap[p.entityType]?.[p.entityId] ?? `${p.entityType} #${p.entityId}`)
        : null;
      return {
        ...p,
        amount: Number(p.amount),
        refundAmount: p.refundAmount != null ? Number(p.refundAmount) : null,
        serviceFeeAmount: Number(p.serviceFeeAmount),
        personName: p.userId != null ? (userNameMap[p.userId] ?? "Unknown") : "Unknown",
        eventName,
      };
    }));
  } catch (err) {
    console.error("[GET /admin/clerk-users/:clerkId/payments] error:", err);
    res.status(500).json({ error: "Failed to get payment history" });
  }
});

/**
 * POST /admin/payments/:paymentId/refund
 * Issue a full or partial Stripe refund on a specific payment.
 * Body: { amount: number (in dollars), reason: string }
 */
router.post("/admin/payments/:paymentId/refund", requireSuperAdmin, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const paymentId = parseInt(req.params.paymentId, 10);

  if (isNaN(paymentId)) {
    res.status(400).json({ error: "Invalid payment ID" });
    return;
  }

  const { amount, reason } = req.body ?? {};
  if (!amount || typeof amount !== "number" || amount <= 0) {
    res.status(400).json({ error: "amount (in dollars, positive number) is required" });
    return;
  }
  if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
    res.status(400).json({ error: "reason is required" });
    return;
  }

  try {
    const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, paymentId));
    if (!payment) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }
    if (payment.provider === "external") {
      res.status(400).json({ error: "Cannot refund external (non-Stripe) payments" });
      return;
    }
    if (payment.refunded) {
      res.status(409).json({ error: "Payment has already been fully refunded" });
      return;
    }
    if (!payment.providerChargeId) {
      res.status(400).json({ error: "No Stripe charge ID recorded for this payment. Issue a credit manually." });
      return;
    }

    const grossPaid = Number(payment.amount);
    const alreadyRefunded = payment.refundAmount != null ? Number(payment.refundAmount) : 0;
    const remainingRefundable = grossPaid - alreadyRefunded;
    if (amount > remainingRefundable + 0.01) {
      res.status(400).json({
        error: `Refund amount ($${amount.toFixed(2)}) exceeds remaining refundable amount ($${remainingRefundable.toFixed(2)})`,
      });
      return;
    }

    const stripe = await getUncachableStripeClient();
    const stripeRefund = await stripe.refunds.create({
      charge: payment.providerChargeId,
      amount: Math.round(amount * 100),
      reason: "requested_by_customer",
      metadata: { adminClerkId: authed.clerkUserId, adminReason: reason.trim().slice(0, 500) },
    });

    // Cumulative refund total after this refund
    const newRefundTotal = alreadyRefunded + amount;
    const isFullRefund = remainingRefundable - amount <= 0.01;
    const now = new Date();

    const [updated] = await db.update(paymentsTable)
      .set({
        refunded: isFullRefund,
        refundAmount: String(newRefundTotal.toFixed(2)),
        refundedAt: now,
        compensationStatus: "refunded",
        updatedAt: now,
      } as any)
      .where(eq(paymentsTable.id, paymentId))
      .returning();

    try {
      await db.insert(auditLogTable).values({
        actorClerkId: authed.clerkUserId,
        action: "payment.refunded_by_admin",
        entityType: "payment",
        entityId: String(paymentId),
        before: JSON.stringify({ refunded: false }),
        after: JSON.stringify({ refunded: isFullRefund, refundAmount: amount, stripeRefundId: stripeRefund.id, reason }),
      });
    } catch {}

    res.json({
      success: true,
      stripeRefundId: stripeRefund.id,
      amount,
      isFullRefund,
      payment: {
        ...updated,
        amount: Number(updated.amount),
        refundAmount: updated.refundAmount != null ? Number(updated.refundAmount) : null,
        serviceFeeAmount: Number(updated.serviceFeeAmount),
      },
    });
  } catch (err: any) {
    console.error("[POST /admin/payments/:paymentId/refund] error:", err);
    res.status(500).json({ error: err?.message ?? "Failed to process refund" });
  }
});

/**
 * POST /admin/users/reconcile
 * Dry-run or execute orphan reconciliation between Clerk and the local DB.
 * Body: { execute?: boolean }  (default false → dry run)
 * Super-admin only.
 */
router.post("/admin/users/reconcile", requireSuperAdmin, async (req, res): Promise<void> => {
  const execute = req.body?.execute === true;

  const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
  if (!CLERK_SECRET_KEY) {
    res.status(500).json({ error: "CLERK_SECRET_KEY is not configured" });
    return;
  }

  try {
    // Fetch all Clerk users (paginated)
    const clerkUsers: Array<{ id: string; email_addresses?: Array<{ email_address: string }> }> = [];
    let offset = 0;
    const pageSize = 500;
    while (true) {
      const url = `https://api.clerk.com/v1/users?limit=${pageSize}&offset=${offset}`;
      const clerkRes = await fetch(url, {
        headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
      });
      if (!clerkRes.ok) {
        const text = await clerkRes.text();
        throw new Error(`Clerk API error ${clerkRes.status}: ${text}`);
      }
      const data = await clerkRes.json() as typeof clerkUsers;
      if (!Array.isArray(data) || data.length === 0) break;
      clerkUsers.push(...data);
      if (data.length < pageSize) break;
      offset += pageSize;
    }

    const clerkIdSet = new Set(clerkUsers.map((u) => u.id));

    // Fetch all DB users
    const dbUsers = await db
      .select({
        id: usersTable.id,
        clerkId: usersTable.clerkId,
        email: usersTable.email,
        role: usersTable.role,
      })
      .from(usersTable);

    const dbClerkIdSet = new Set(dbUsers.map((u) => u.clerkId));

    // Orphaned DB rows: in DB but no matching Clerk account
    const orphanedDbRows = dbUsers
      .filter((u) => !clerkIdSet.has(u.clerkId))
      .map((u) => ({ id: u.id, clerkId: u.clerkId, email: u.email ?? null, role: u.role }));

    // Orphaned Clerk accounts: in Clerk but no DB row
    const orphanedClerkAccounts = clerkUsers
      .filter((u) => !dbClerkIdSet.has(u.id))
      .map((u) => ({
        clerkId: u.id,
        email: u.email_addresses?.[0]?.email_address ?? null,
      }));

    if (!execute) {
      res.json({
        dryRun: true,
        orphanedDbRows,
        orphanedClerkAccounts,
        counts: {
          orphanedDbRows: orphanedDbRows.length,
          orphanedClerkAccounts: orphanedClerkAccounts.length,
        },
      });
      return;
    }

    // Execute: delete orphaned DB rows
    let dbRowsRemoved = 0;
    for (const row of orphanedDbRows) {
      await db.delete(usersTable).where(eq(usersTable.clerkId, row.clerkId));
      dbRowsRemoved++;
    }

    // Execute: delete orphaned Clerk accounts
    let clerkAccountsRemoved = 0;
    const clerkErrors: string[] = [];
    for (const u of orphanedClerkAccounts) {
      const delRes = await fetch(`https://api.clerk.com/v1/users/${u.clerkId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
      });
      if (delRes.ok) {
        clerkAccountsRemoved++;
      } else {
        const text = await delRes.text();
        clerkErrors.push(`${u.clerkId}: ${delRes.status} ${text}`);
      }
    }

    res.json({
      dryRun: false,
      dbRowsRemoved,
      clerkAccountsRemoved,
      clerkErrors,
      counts: { orphanedDbRows: dbRowsRemoved, orphanedClerkAccounts: clerkAccountsRemoved },
    });
  } catch (err: any) {
    console.error("[POST /admin/users/reconcile] error:", err);
    res.status(500).json({ error: err?.message ?? "Reconciliation failed" });
  }
});

export default router;
