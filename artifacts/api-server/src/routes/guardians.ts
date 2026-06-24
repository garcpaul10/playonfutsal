import { Router, type IRouter } from "express";
import { db, guardiansTable, usersTable, playerProfilesTable, waiverTemplatesTable, waiverSignaturesTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, requirePermission, hasPermission, type AuthedRequest } from "../middlewares/auth";
import { randomUUID } from "crypto";

const router: IRouter = Router();

async function getDbUser(clerkId: string) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  return user ?? null;
}

// Current user: list their own guardian links (youth they are responsible for)
// Includes the child's participant-profile QR code for display on the QR page.
router.get("/me/guardian-links", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const guardian = await getDbUser(authed.clerkUserId);
  if (!guardian) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const youthUser = db
    .select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, dateOfBirth: usersTable.dateOfBirth, playonId: usersTable.playonId })
    .from(usersTable)
    .as("youth_user");
  const youthProfile = db
    .select({ userId: playerProfilesTable.userId, qrCode: playerProfilesTable.qrCode })
    .from(playerProfilesTable)
    .as("youth_profile");
  const rows = await db
    .select({
      id: guardiansTable.id,
      youthUserId: guardiansTable.youthUserId,
      relationship: guardiansTable.relationship,
      isPrimary: guardiansTable.isPrimary,
      canRegister: guardiansTable.canRegister,
      canPickup: guardiansTable.canPickup,
      status: guardiansTable.status,
      notes: guardiansTable.notes,
      createdAt: guardiansTable.createdAt,
      youthFirstName: youthUser.firstName,
      youthLastName: youthUser.lastName,
      youthDateOfBirth: youthUser.dateOfBirth,
      youthPlayonId: youthUser.playonId,
      youthQrCode: youthProfile.qrCode,
    })
    .from(guardiansTable)
    .leftJoin(youthUser, eq(guardiansTable.youthUserId, youthUser.id))
    .leftJoin(youthProfile, eq(youthProfile.userId, guardiansTable.youthUserId))
    .where(eq(guardiansTable.guardianUserId, guardian.id))
    .orderBy(guardiansTable.createdAt);
  res.json(rows);
});

// Admin list with guardian + youth name join (includes pending links for review)
router.get("/guardians", requirePermission("canManageUsers"), async (_req, res): Promise<void> => {
  const guardianUser = db
    .select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email })
    .from(usersTable)
    .as("guardian_user");

  const youthUser = db
    .select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName })
    .from(usersTable)
    .as("youth_user");

  const rows = await db
    .select({
      id: guardiansTable.id,
      guardianUserId: guardiansTable.guardianUserId,
      youthUserId: guardiansTable.youthUserId,
      relationship: guardiansTable.relationship,
      isPrimary: guardiansTable.isPrimary,
      canRegister: guardiansTable.canRegister,
      canPickup: guardiansTable.canPickup,
      status: guardiansTable.status,
      notes: guardiansTable.notes,
      createdAt: guardiansTable.createdAt,
      guardianFirstName: guardianUser.firstName,
      guardianLastName: guardianUser.lastName,
      guardianEmail: guardianUser.email,
      youthFirstName: youthUser.firstName,
      youthLastName: youthUser.lastName,
    })
    .from(guardiansTable)
    .leftJoin(guardianUser, eq(guardiansTable.guardianUserId, guardianUser.id))
    .leftJoin(youthUser, eq(guardiansTable.youthUserId, youthUser.id))
    .orderBy(guardiansTable.createdAt);

  res.json(rows);
});

// Create a new youth player account and link them to the authenticated guardian
// POST /api/youth — creates user + player_profile + guardian record in one transaction
router.post("/youth", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const body = req.body ?? {};

  const { firstName, lastName, dateOfBirth, gender, addressLine1, city, state, zip,
    emergencyContactName, emergencyContactPhone, emergencyContactRelationship,
    primaryPosition, relationship, guardianConsentGiven } = body;

  if (!firstName || !lastName) {
    res.status(400).json({ error: "firstName and lastName are required" });
    return;
  }
  if (!guardianConsentGiven) {
    res.status(400).json({ error: "Guardian consent is required" });
    return;
  }
  if (!body.signatureData || !body.templateId) {
    res.status(400).json({ error: "signatureData and templateId are required — guardian must sign the waiver on behalf of the child" });
    return;
  }

  const guardian = await getDbUser(authed.clerkUserId);
  if (!guardian) {
    res.status(404).json({ error: "Guardian user not found — visit /me first" });
    return;
  }

  // Waiver consent replaces the old ID-verification gate for creating youth profiles

  // Parse and validate DOB
  let parsedDob: string | null = null;
  if (dateOfBirth) {
    const parts = (dateOfBirth as string).split("/");
    if (parts.length === 3) {
      const [mm, dd, yyyy] = parts.map(Number);
      if (mm && dd && yyyy) {
        parsedDob = `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
      }
    } else {
      parsedDob = dateOfBirth;
    }
  }

  // Create a synthetic clerkId for youth accounts (they don't have a Clerk account)
  const syntheticClerkId = `youth_${randomUUID()}`;
  const syntheticEmail = `${syntheticClerkId}@youth.playon.local`;
  const playonId = `PO-YOUTH-${syntheticClerkId.slice(6, 14).toUpperCase()}`;

  try {
    const signatureData: string | undefined = body.signatureData;
    const signatureType: string = body.signatureType === "drawn" ? "drawn" : "typed";
    const templateId: number | undefined = body.templateId ? Number(body.templateId) : undefined;

    // Validate waiver template before starting the transaction
    const [waiverTemplate] = await db
      .select()
      .from(waiverTemplatesTable)
      .where(eq(waiverTemplatesTable.id, templateId!));
    if (!waiverTemplate) {
      res.status(400).json({ error: "Waiver template not found" });
      return;
    }

    const { youthUser, guardianLink } = await db.transaction(async (tx) => {
      // Create the youth user record
      const [youthUser] = await tx.insert(usersTable).values({
        clerkId: syntheticClerkId,
        email: syntheticEmail,
        firstName,
        lastName,
        dateOfBirth: parsedDob ?? undefined,
        role: "player",
        roles: [],
        playonId,
        qrCode: `playon:player:${syntheticClerkId}`,
        addressLine1: addressLine1 ?? null,
        city: city ?? null,
        state: state ?? null,
        zip: zip ?? null,
        emergencyContactName: emergencyContactName ?? null,
        emergencyContactPhone: emergencyContactPhone ?? null,
        idVerified: false,
      } as any).returning();

      // Create the player profile
      await tx.insert(playerProfilesTable).values({
        userId: youthUser.id,
        displayName: `${firstName} ${lastName}`,
        dateOfBirth: parsedDob ?? undefined,
        gender: gender ?? null,
        emergencyContactName: emergencyContactName ?? null,
        emergencyContactPhone: emergencyContactPhone ?? null,
        emergencyContactRelationship: emergencyContactRelationship ?? null,
        primaryPosition: primaryPosition ?? null,
        qrCode: `playon:player:${syntheticClerkId}`,
        isPublic: false,
      } as any);

      // Create the guardian link — auto-approved because the parent is
      // creating the child's account themselves and has given consent above.
      const [guardianLink] = await tx.insert(guardiansTable).values({
        guardianUserId: guardian.id,
        youthUserId: youthUser.id,
        relationship: relationship ?? "parent",
        isPrimary: true,
        canRegister: true,
        canPickup: true,
        status: "approved",
        notes: `Guardian consent given at ${new Date().toISOString()}`,
      }).returning();

      // Record waiver signature inside the transaction — if this fails, the
      // entire youth account creation is rolled back so no orphaned records exist.
      const now = new Date();
      const expiresAt = new Date(now);
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      await tx.insert(waiverSignaturesTable).values({
        templateId: waiverTemplate.id,
        userId: guardian.id,
        youthUserId: youthUser.id,
        signedAt: now,
        expiresAt,
        signatureData: signatureData!,
        signatureType,
        ipAddress: req.ip ?? req.headers["x-forwarded-for"]?.toString() ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      } as any);

      return { youthUser, guardianLink };
    });

    res.status(201).json({
      youth: {
        id: youthUser.id,
        firstName: youthUser.firstName,
        lastName: youthUser.lastName,
        playonId: youthUser.playonId,
      },
      guardianLink,
    });
  } catch (err: any) {
    console.error("[POST /youth]", err);
    res.status(500).json({ error: "Failed to create youth player account" });
  }
});

/**
 * POST /me/create-youth-account — RETIRED
 * This endpoint created a full Clerk login account for child players, which required
 * ID verification. The new flow uses POST /youth instead: children are stored as
 * linked participant profiles under the parent's account (no separate child login).
 */
router.post("/me/create-youth-account", requireAuth, async (_req: any, res): Promise<void> => {
  res.status(410).json({
    error: "This endpoint is retired. Use POST /api/youth to add a child participant profile under your account.",
  });
});


// PATCH /api/youth/:id — guardian updates a child's profile details
router.patch("/youth/:id", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const youthId = parseInt(req.params.id, 10);
  if (isNaN(youthId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const guardian = await getDbUser(authed.clerkUserId);
  if (!guardian) {
    res.status(404).json({ error: "Guardian user not found" });
    return;
  }

  // Verify caller has an approved guardian link to this child
  const [link] = await db
    .select()
    .from(guardiansTable)
    .where(
      and(
        eq(guardiansTable.guardianUserId, guardian.id),
        eq(guardiansTable.youthUserId, youthId),
        eq(guardiansTable.status, "approved")
      )
    );
  if (!link) {
    res.status(403).json({ error: "You do not have an approved guardian link to this child" });
    return;
  }

  const body = req.body ?? {};
  const {
    firstName,
    lastName,
    dateOfBirth,
    gender,
    emergencyContactName,
    emergencyContactPhone,
    emergencyContactRelationship,
    primaryPosition,
  } = body;

  // Parse DOB if provided
  let parsedDob: string | undefined;
  if (dateOfBirth) {
    const raw = (dateOfBirth as string).trim();
    if (raw.includes("/")) {
      const parts = raw.split("/");
      if (parts.length === 3) {
        const [mm, dd, yyyy] = parts.map(Number);
        if (mm && dd && yyyy) {
          parsedDob = `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
        }
      }
    } else {
      parsedDob = raw;
    }
    if (!parsedDob) {
      res.status(400).json({ error: "Invalid date of birth format. Use MM/DD/YYYY or YYYY-MM-DD." });
      return;
    }
  }

  try {
    await db.transaction(async (tx) => {
      // Update users table (name, DOB)
      const userUpdates: Record<string, any> = { updatedAt: new Date() };
      if (firstName !== undefined) userUpdates.firstName = firstName;
      if (lastName !== undefined) userUpdates.lastName = lastName;
      if (parsedDob !== undefined) userUpdates.dateOfBirth = parsedDob;

      await tx.update(usersTable).set(userUpdates).where(eq(usersTable.id, youthId));

      // Update player profile (all fields including emergency contact, position, gender)
      const profileUpdates: Record<string, any> = { updatedAt: new Date() };
      if (firstName !== undefined || lastName !== undefined) {
        const [updatedUser] = await tx.select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
          .from(usersTable).where(eq(usersTable.id, youthId));
        profileUpdates.displayName = `${updatedUser?.firstName ?? firstName ?? ""} ${updatedUser?.lastName ?? lastName ?? ""}`.trim();
      }
      if (parsedDob !== undefined) profileUpdates.dateOfBirth = parsedDob;
      if (gender !== undefined) profileUpdates.gender = gender;
      if (emergencyContactName !== undefined) profileUpdates.emergencyContactName = emergencyContactName;
      if (emergencyContactPhone !== undefined) profileUpdates.emergencyContactPhone = emergencyContactPhone;
      if (emergencyContactRelationship !== undefined) profileUpdates.emergencyContactRelationship = emergencyContactRelationship;
      if (primaryPosition !== undefined) profileUpdates.primaryPosition = primaryPosition;

      await tx.update(playerProfilesTable).set(profileUpdates).where(eq(playerProfilesTable.userId, youthId));
    });

    // Return updated child data
    const [updatedUser] = await db.select().from(usersTable).where(eq(usersTable.id, youthId));
    const [updatedProfile] = await db.select().from(playerProfilesTable).where(eq(playerProfilesTable.userId, youthId));

    res.json({
      id: updatedUser.id,
      firstName: updatedUser.firstName,
      lastName: updatedUser.lastName,
      dateOfBirth: updatedUser.dateOfBirth,
      gender: updatedProfile?.gender ?? null,
      emergencyContactName: updatedProfile?.emergencyContactName ?? null,
      emergencyContactPhone: updatedProfile?.emergencyContactPhone ?? null,
      emergencyContactRelationship: updatedProfile?.emergencyContactRelationship ?? null,
      primaryPosition: updatedProfile?.primaryPosition ?? null,
    });
  } catch (err: any) {
    console.error("[PATCH /youth/:id]", err);
    res.status(500).json({ error: "Failed to update child profile" });
  }
});

// Self-service: create a guardian link request (status starts as "pending", requires admin approval)
router.post("/guardians", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const body = req.body;
  if (!body?.youthUserId) {
    res.status(400).json({ error: "youthUserId is required" });
    return;
  }
  const guardian = await getDbUser(authed.clerkUserId);
  if (!guardian) {
    res.status(404).json({ error: "Guardian user not found — visit /me first" });
    return;
  }
  const youthId = parseInt(body.youthUserId, 10);
  if (isNaN(youthId)) {
    res.status(400).json({ error: "Invalid youthUserId" });
    return;
  }
  // Prevent self-linking
  if (guardian.id === youthId) {
    res.status(400).json({ error: "Cannot link your own account as a youth account" });
    return;
  }
  // Validate the youth account exists and is not a privileged user
  const [youthAccount] = await db.select().from(usersTable).where(eq(usersTable.id, youthId));
  if (!youthAccount) {
    res.status(404).json({ error: "Youth account not found" });
    return;
  }
  if (youthAccount.role === "admin" || youthAccount.role === "staff") {
    res.status(403).json({ error: "Cannot create a guardian link to a staff or admin account" });
    return;
  }
  // Check for existing link
  const [existing] = await db
    .select()
    .from(guardiansTable)
    .where(and(eq(guardiansTable.guardianUserId, guardian.id), eq(guardiansTable.youthUserId, youthId)));
  if (existing) {
    res.status(409).json({ error: "Guardian link already exists" });
    return;
  }
  const [row] = await db
    .insert(guardiansTable)
    .values({
      guardianUserId: guardian.id,
      youthUserId: youthId,
      relationship: body.relationship ?? "parent",
      isPrimary: body.isPrimary ?? true,
      canRegister: body.canRegister ?? true,
      canPickup: body.canPickup ?? true,
      status: "pending",
      notes: body.notes ?? null,
    })
    .returning();
  res.status(201).json(row);
});

// Get a single guardian link: owner (guardian or youth) always allowed;
// staff must have canManageUsers to access links they don't own.
router.get("/guardians/:id", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db.select().from(guardiansTable).where(eq(guardiansTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Guardian link not found" });
    return;
  }
  const dbUser = await getDbUser(authed.clerkUserId);
  const isOwner = dbUser && (dbUser.id === row.guardianUserId || dbUser.id === row.youthUserId);
  const canManage = await hasPermission(authed.clerkUserId, "canManageUsers");
  if (!isOwner && !canManage) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  res.json(row);
});

// Admin: approve or reject a pending guardian link
router.patch("/guardians/:id/status", requirePermission("canManageUsers"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const newStatus = req.body?.status;
  if (!["approved", "rejected"].includes(newStatus)) {
    res.status(400).json({ error: "status must be 'approved' or 'rejected'" });
    return;
  }
  const [row] = await db
    .update(guardiansTable)
    .set({ status: newStatus, updatedAt: new Date() })
    .where(eq(guardiansTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Guardian link not found" });
    return;
  }
  res.json(row);
});

// Delete a guardian link: owner (guardian side only) may delete their own link;
// staff must have canManageUsers to delete links they don't own.
router.delete("/guardians/:id", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db.select().from(guardiansTable).where(eq(guardiansTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Guardian link not found" });
    return;
  }
  const dbUser = await getDbUser(authed.clerkUserId);
  const isOwner = dbUser?.id === row.guardianUserId;
  const canManage = await hasPermission(authed.clerkUserId, "canManageUsers");
  if (!isOwner && !canManage) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  await db.delete(guardiansTable).where(eq(guardiansTable.id, id));
  res.sendStatus(204);
});

export default router;
