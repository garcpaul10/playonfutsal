import { Router, type IRouter } from "express";
import { db, playerProfilesTable, usersTable, auditLogTable, waiverTemplatesTable, waiverSignaturesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth, requireAdmin, requirePermission, type AuthedRequest } from "../middlewares/auth";
import { randomUUID } from "crypto";

const router: IRouter = Router();

function generateQrCode(userId: number, clerkId: string): string {
  return `PLAYON:${userId}:${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
}

async function writeAuditLog(actorClerkId: string, action: string, entityType: string, entityId: string, before: any, after: any) {
  try {
    await db.insert(auditLogTable).values({ actorClerkId, action, entityType, entityId, before: JSON.stringify(before), after: JSON.stringify(after) });
  } catch { /* non-blocking */ }
}

function addOneYear(date: Date): Date {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + 1);
  return d;
}

// GET /me/player-profile — authenticated user's own profile
router.get("/me/player-profile", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  const [profile] = await db.select().from(playerProfilesTable).where(eq(playerProfilesTable.userId, user.id));
  if (!profile) { res.status(404).json({ error: "Player profile not found" }); return; }

  // Attach waiver status
  const [latestSig] = await db
    .select()
    .from(waiverSignaturesTable)
    .where(eq(waiverSignaturesTable.userId, user.id))
    .orderBy(desc(waiverSignaturesTable.signedAt))
    .limit(1);

  const now = new Date();
  const waiverSigned = !!latestSig;
  const waiverExpired = latestSig?.expiresAt ? latestSig.expiresAt < now : true;

  res.json({
    ...profile,
    waiverSigned,
    waiverExpired,
    waiverExpiresAt: latestSig?.expiresAt ?? null,
    waiverSignedAt: latestSig?.signedAt ?? null,
  });
});

// POST /me/player-profile — create profile (auto-generates QR code)
// Requires signatureData and templateId — waiver must be signed at profile creation.
router.post("/me/player-profile", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const body = req.body ?? {};

  // Require waiver signature at profile creation
  if (!body.signatureData || !body.templateId) {
    res.status(400).json({ error: "signatureData and templateId are required to create a player profile" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!user) { res.status(404).json({ error: "User not found — visit /api/me first" }); return; }

  const [existing] = await db.select().from(playerProfilesTable).where(eq(playerProfilesTable.userId, user.id));
  if (existing) { res.status(409).json({ error: "Player profile already exists", profile: existing }); return; }

  // Validate the template exists before creating anything
  const [template] = await db
    .select()
    .from(waiverTemplatesTable)
    .where(eq(waiverTemplatesTable.id, Number(body.templateId)));
  if (!template) {
    res.status(400).json({ error: "Waiver template not found" });
    return;
  }

  const qrCode = generateQrCode(user.id, authed.clerkUserId);

  // Create profile and waiver signature together
  const profile = await db.transaction(async (tx) => {
    const [p] = await tx.insert(playerProfilesTable).values({
      userId: user.id,
      displayName: body.displayName ?? ([user.firstName, user.lastName].filter(Boolean).join(" ") || null),
      dateOfBirth: body.dateOfBirth ?? null,
      gender: body.gender ?? null,
      dominantFoot: body.dominantFoot ?? "right",
      primaryPosition: body.primaryPosition ?? null,
      secondaryPosition: body.secondaryPosition ?? null,
      jerseyNumber: body.jerseyNumber ?? null,
      heightCm: body.heightCm ?? null,
      weightKg: body.weightKg ?? null,
      bio: body.bio ?? null,
      profilePhotoUrl: body.profilePhotoUrl ?? null,
      qrCode,
      emergencyContactName: body.emergencyContactName ?? null,
      emergencyContactPhone: body.emergencyContactPhone ?? null,
      emergencyContactRelationship: body.emergencyContactRelationship ?? null,
      medicalConditions: body.medicalConditions ?? null,
      allergies: body.allergies ?? null,
      fitnessLevel: body.fitnessLevel ?? "recreational",
      isPublic: body.isPublic ?? true,
    }).returning();

    const now = new Date();
    await tx.insert(waiverSignaturesTable).values({
      templateId: template.id,
      userId: user.id,
      youthUserId: null,
      signedAt: now,
      expiresAt: addOneYear(now),
      signatureData: body.signatureData,
      signatureType: body.signatureType === "drawn" ? "drawn" : "typed",
      ipAddress: req.ip ?? req.headers["x-forwarded-for"]?.toString() ?? null,
      userAgent: req.headers["user-agent"] ?? null,
    });

    return p;
  });

  await writeAuditLog(authed.clerkUserId, "player_profile.created", "player_profile", String(profile.id), null, { userId: user.id, qrCode });
  res.status(201).json(profile);
});

// PATCH /me/player-profile — update own profile
router.patch("/me/player-profile", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  const [existing] = await db.select().from(playerProfilesTable).where(eq(playerProfilesTable.userId, user.id));
  if (!existing) { res.status(404).json({ error: "Player profile not found" }); return; }

  const body = req.body ?? {};
  const allowed = ["displayName","dateOfBirth","gender","dominantFoot","primaryPosition","secondaryPosition","jerseyNumber","heightCm","weightKg","bio","profilePhotoUrl","emergencyContactName","emergencyContactPhone","emergencyContactRelationship","medicalConditions","allergies","fitnessLevel","isPublic"];
  const updates: Record<string, any> = { updatedAt: new Date() };
  for (const f of allowed) { if (body[f] !== undefined) updates[f] = body[f]; }

  const [profile] = await db.update(playerProfilesTable).set(updates).where(eq(playerProfilesTable.userId, user.id)).returning();
  res.json(profile);
});

// Staff with canManageUsers: list all player profiles (includes sensitive fields)
router.get("/player-profiles", requirePermission("canManageUsers"), async (_req, res): Promise<void> => {
  const profiles = await db.select().from(playerProfilesTable).orderBy(playerProfilesTable.createdAt);
  res.json(profiles);
});

// Staff with canManageUsers: get a specific player profile by userId
router.get("/player-profiles/user/:userId", requirePermission("canManageUsers"), async (req, res): Promise<void> => {
  const uid = parseInt(req.params.userId as string, 10);
  if (isNaN(uid)) { res.status(400).json({ error: "Invalid userId" }); return; }
  const [profile] = await db.select().from(playerProfilesTable).where(eq(playerProfilesTable.userId, uid));
  if (!profile) { res.status(404).json({ error: "Player profile not found" }); return; }
  res.json(profile);
});

// Staff with canViewRegistrations: QR scan for check-in (minimal profile fields returned)
router.get("/player-profiles/qr/:code", requirePermission("canViewRegistrations"), async (req, res): Promise<void> => {
  const [profile] = await db.select().from(playerProfilesTable).where(eq(playerProfilesTable.qrCode, req.params.code as string));
  if (!profile) { res.status(404).json({ error: "QR code not found" }); return; }
  res.json({ id: profile.id, userId: profile.userId, displayName: profile.displayName, qrCode: profile.qrCode, isPublic: profile.isPublic });
});

// Admin-only: update any player profile
router.patch("/player-profiles/:id", requirePermission("canManageUsers"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body ?? {};
  const allowed = ["displayName","dateOfBirth","gender","dominantFoot","primaryPosition","secondaryPosition","jerseyNumber","heightCm","weightKg","bio","profilePhotoUrl","emergencyContactName","emergencyContactPhone","emergencyContactRelationship","medicalConditions","allergies","fitnessLevel","isPublic"];
  const updates: Record<string, any> = { updatedAt: new Date() };
  for (const f of allowed) { if (body[f] !== undefined) updates[f] = body[f]; }
  const [profile] = await db.update(playerProfilesTable).set(updates as any).where(eq(playerProfilesTable.id, id)).returning();
  if (!profile) { res.status(404).json({ error: "Not found" }); return; }
  res.json(profile);
});

export default router;
