import { Router, type IRouter } from "express";
import { db, staffProfilesTable, usersTable, auditLogTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireSuperAdmin, requireAdmin, requireAnyPermission, type AuthedRequest } from "../middlewares/auth";

const router: IRouter = Router();

const PERMISSION_FIELDS = [
  "canManageLeagues", "canManageCamps", "canManageDropins", "canManageTournaments",
  "canViewRegistrations", "canEditRegistrations", "canManageUsers",
  "canManageCourts", "canManageVenues", "canManageAgeGroups",
  "canViewReports", "canProcessRefunds", "canManagePayouts",
  "canManageSchedules", "canManageAssignments",
  "canManageAnnouncements", "canManageGameCards",
  "isActive",
] as const;

const PROFILE_FIELDS = [
  "title", "bio", "certifications", "backgroundCheckStatus",
  "backgroundCheckDate", "scopedPermissions", "notes",
] as const;

async function getDbUser(clerkId: string) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  return user ?? null;
}

router.get("/staff-profiles", requireSuperAdmin, async (_req, res): Promise<void> => {
  const rows = await db.select().from(staffProfilesTable).orderBy(staffProfilesTable.createdAt);
  res.json(rows);
});

router.get("/staff-profiles/me", requireAdmin, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const dbUser = await getDbUser(authed.clerkUserId);
  if (!dbUser) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const [profile] = await db.select().from(staffProfilesTable).where(eq(staffProfilesTable.userId, dbUser.id));
  if (!profile) {
    res.status(404).json({ error: "Staff profile not found" });
    return;
  }
  res.json(profile);
});

router.post("/staff-profiles", requireSuperAdmin, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const body = req.body;
  if (!body?.userId) {
    res.status(400).json({ error: "userId (db integer id) is required" });
    return;
  }
  const [profile] = await db.insert(staffProfilesTable).values({
    userId: body.userId,
    title: body.title ?? null,
    bio: body.bio ?? null,
    certifications: body.certifications ?? [],
    backgroundCheckStatus: body.backgroundCheckStatus ?? "pending",
    backgroundCheckDate: body.backgroundCheckDate ?? null,
    scopedPermissions: body.scopedPermissions ?? [],
    canManageLeagues: body.canManageLeagues ?? false,
    canManageCamps: body.canManageCamps ?? false,
    canManageDropins: body.canManageDropins ?? false,
    canManageTournaments: body.canManageTournaments ?? false,
    canViewRegistrations: body.canViewRegistrations ?? true,
    canEditRegistrations: body.canEditRegistrations ?? false,
    canManageUsers: body.canManageUsers ?? false,
    canManageCourts: body.canManageCourts ?? false,
    canManageVenues: body.canManageVenues ?? false,
    canManageAgeGroups: body.canManageAgeGroups ?? false,
    canViewReports: body.canViewReports ?? false,
    canProcessRefunds: body.canProcessRefunds ?? false,
    canManagePayouts: body.canManagePayouts ?? false,
    canManageSchedules: body.canManageSchedules ?? false,
    canManageAssignments: body.canManageAssignments ?? false,
    canManageAnnouncements: body.canManageAnnouncements ?? false,
    canManageGameCards: body.canManageGameCards ?? false,
    isActive: body.isActive ?? true,
    notes: body.notes ?? null,
  }).returning();

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "staff_profile.created",
    entityType: "staff_profile",
    entityId: String(profile.id),
    notes: JSON.stringify({ targetUserId: body.userId }),
  });

  res.status(201).json(profile);
});

router.patch("/staff-profiles/:id/profile", requireAnyPermission(["canManageUsers"]), async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body;
  const safeFields = ["title", "bio", "notes"] as const;
  const updates: Record<string, any> = { updatedAt: new Date() };
  for (const f of safeFields) {
    if (body[f] !== undefined) updates[f] = body[f];
  }
  const [profile] = await db.update(staffProfilesTable).set(updates as any).where(eq(staffProfilesTable.id, id)).returning();
  if (!profile) { res.status(404).json({ error: "Staff profile not found" }); return; }
  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "staff_profile.updated",
    entityType: "staff_profile",
    entityId: String(id),
    notes: JSON.stringify({ updatedFields: Object.keys(updates).filter((k) => k !== "updatedAt") }),
  });
  res.json(profile);
});

router.patch("/staff-profiles/:id", requireSuperAdmin, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const body = req.body;
  const updates: Record<string, any> = { updatedAt: new Date() };

  const changedPermissions: Record<string, any> = {};
  for (const f of PERMISSION_FIELDS) {
    if (body[f] !== undefined) {
      updates[f] = body[f];
      changedPermissions[f] = body[f];
    }
  }
  for (const f of PROFILE_FIELDS) {
    if (body[f] !== undefined) {
      updates[f] = body[f];
    }
  }

  const [profile] = await db.update(staffProfilesTable).set(updates as any).where(eq(staffProfilesTable.id, id)).returning();
  if (!profile) {
    res.status(404).json({ error: "Staff profile not found" });
    return;
  }

  const action = Object.keys(changedPermissions).length > 0
    ? "staff_profile.permissions_changed"
    : "staff_profile.updated";

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action,
    entityType: "staff_profile",
    entityId: String(id),
    notes: JSON.stringify(
      Object.keys(changedPermissions).length > 0
        ? { changedPermissions }
        : { updatedFields: Object.keys(updates).filter((k) => k !== "updatedAt") }
    ),
  });

  res.json(profile);
});

export default router;
