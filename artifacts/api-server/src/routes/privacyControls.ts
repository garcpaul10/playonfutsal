/**
 * Minor-data privacy controls.
 * - Guardian can request data export/deletion for their linked child
 * - Admin (superAdmin) can export/anonymize/delete youth PII — full PII access
 * - Staff (admin role) can view youth player roster — PII scrubbed per data minimization policy
 * - All access to youth PII is logged in AuditLog
 *
 * Data minimization policy:
 *   - Sensitive fields (email, phone, dateOfBirth, address) are only returned to:
 *     a) Super-admins (role === "admin")
 *     b) Approved guardians of the specific youth player
 *   - Staff/coaches/refs get only non-sensitive fields (name, role, playonId, ageGroup)
 *   - This principle is enforced via `sanitizeUserForRole()` exported below.
 */
import { Router, type IRouter } from "express";
import { db, usersTable, guardiansTable, campRegistrationsTable, registrationsTable, auditLogTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireAdmin, requireSuperAdmin, type AuthedRequest } from "../middlewares/auth";

const router: IRouter = Router();

/**
 * Strips sensitive PII from a user record based on the requester's role.
 * Must be applied to any endpoint that returns youth player data to non-guardian callers.
 *
 * @param user   - Full user record from DB
 * @param role   - Calling user's role: "admin" (super-admin), "staff", "player", etc.
 * @param isGuardianOfUser - Whether the caller is an approved guardian of this specific user
 */
export function sanitizeUserForRole(
  user: Record<string, any>,
  role: string,
  isGuardianOfUser = false,
): Record<string, any> {
  if (role === "admin" || isGuardianOfUser) {
    return user;
  }
  const { email, phone, dateOfBirth, address, clerkId, ...safeFields } = user;
  return safeFields;
}

/** GET /admin/privacy/youth-players — list all youth players with PII summary (admin) */
router.get("/admin/privacy/youth-players", requireSuperAdmin, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const players = await db
    .select({
      id: usersTable.id,
      clerkId: usersTable.clerkId,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      email: usersTable.email,
      dateOfBirth: usersTable.dateOfBirth,
      role: usersTable.role,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(eq(usersTable.role, "player"));

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "youth_pii_list_accessed",
    entityType: "user",
    entityId: "all_youth",
    notes: `Admin accessed youth player list (${players.length} records)`,
  });

  res.json(players);
});

/**
 * GET /admin/privacy/youth-player-roster — list youth players for operational use (staff accessible).
 * Returns role-scrubbed data: sensitive PII (email, phone, dateOfBirth) is stripped for staff callers.
 * Only super-admins (role==="admin") receive the full record.
 */
router.get("/admin/privacy/youth-player-roster", requireAdmin, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const [requester] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!requester) { res.status(401).json({ error: "User not found" }); return; }

  const players = await db
    .select({
      id: usersTable.id,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      email: usersTable.email,
      phone: usersTable.phone,
      dateOfBirth: usersTable.dateOfBirth,
      role: usersTable.role,
      playonId: usersTable.playonId,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(eq(usersTable.role, "player"));

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "youth_player_roster_accessed",
    entityType: "user",
    entityId: "all_youth",
    notes: `Role ${requester.role} accessed youth player roster (${players.length} records, PII scrubbed: ${requester.role !== "admin"})`,
  });

  // Data minimization: scrub sensitive PII for non-super-admin callers
  const sanitized = players.map((p) => sanitizeUserForRole(p as Record<string, any>, requester.role));
  res.json(sanitized);
});

/** GET /admin/privacy/export/:userId — export all PII for a user (admin only) */
router.get("/admin/privacy/export/:userId", requireSuperAdmin, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const userId = parseInt(req.params.userId);
  if (isNaN(userId)) { res.status(400).json({ error: "Invalid user id" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const [guardians, campRegs, regs] = await Promise.all([
    db.select().from(guardiansTable).where(eq(guardiansTable.youthUserId, userId)),
    db.select().from(campRegistrationsTable).where(eq(campRegistrationsTable.playerUserId, userId)),
    db.select().from(registrationsTable).where(eq(registrationsTable.userId, user.clerkId)),
  ]);

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "youth_pii_exported",
    entityType: "user",
    entityId: String(userId),
    notes: `PII export for user ${user.firstName} ${user.lastName}`,
  });

  res.json({
    user: {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      dateOfBirth: user.dateOfBirth,
      role: user.role,
      createdAt: user.createdAt,
    },
    guardians,
    campRegistrations: campRegs,
    registrations: regs,
    exportedAt: new Date().toISOString(),
  });
});

/** POST /admin/privacy/anonymize/:userId — anonymize/minimize youth PII on request */
router.post("/admin/privacy/anonymize/:userId", requireSuperAdmin, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const userId = parseInt(req.params.userId);
  if (isNaN(userId)) { res.status(400).json({ error: "Invalid user id" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const { reason } = req.body as { reason?: string };

  const before = {
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone,
    dateOfBirth: user.dateOfBirth,
  };

  await db.update(usersTable).set({
    firstName: "[ANONYMIZED]",
    lastName: "[ANONYMIZED]",
    email: `anonymized_${userId}@playon.internal`,
    phone: null,
    dateOfBirth: null,
    updatedAt: new Date(),
  } as any).where(eq(usersTable.id, userId));

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "youth_pii_anonymized",
    entityType: "user",
    entityId: String(userId),
    before: JSON.stringify(before),
    after: JSON.stringify({ firstName: "[ANONYMIZED]", lastName: "[ANONYMIZED]" }),
    notes: reason ?? "Guardian data deletion request",
  });

  res.json({ message: "User PII anonymized", userId });
});

/**
 * POST /privacy/request-deletion — guardian requests data deletion for their child.
 * Creates an audit log entry; admin processes it manually (or admin can auto-anonymize).
 */
router.post("/privacy/request-deletion", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const { childUserId, reason } = req.body as { childUserId: number; reason?: string };

  if (!childUserId) {
    res.status(400).json({ error: "childUserId is required" });
    return;
  }

  const [guardian] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!guardian) { res.status(401).json({ error: "Guardian not found" }); return; }

  const [link] = await db
    .select()
    .from(guardiansTable)
    .where(
      and(
        eq(guardiansTable.guardianUserId, guardian.id),
        eq(guardiansTable.youthUserId, childUserId),
        eq(guardiansTable.status, "approved"),
      ),
    );

  if (!link) {
    res.status(403).json({ error: "You are not an approved guardian for this player" });
    return;
  }

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "youth_pii_deletion_requested",
    entityType: "user",
    entityId: String(childUserId),
    notes: `Guardian requested data deletion for child userId=${childUserId}. Reason: ${reason ?? "not provided"}`,
  });

  res.json({
    message: "Deletion request received. An admin will process it within 30 days per applicable privacy law.",
    requestedAt: new Date().toISOString(),
  });
});

export default router;
