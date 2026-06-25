import { Router, type IRouter } from "express";
import multer from "multer";
import { db, usersTable, auditLogTable, staffInvitesTable, waiverSignaturesTable, campRegistrationsTable, campsTable } from "@workspace/db";
import { leagueRegistrationsTable, leaguesTable, tournamentRegistrationsTable, tournamentsTable, teamsTable } from "@workspace/db";
import { spotsTable, dropinsTable, dropinCourtPoolsTable, guardiansTable, courtsTable, venuesTable, teamMembersTable } from "@workspace/db";
import { eq, sql, and, isNull, gt, desc, inArray, or, ne, gte } from "drizzle-orm";
import { activeSpotCondition, activeCampRegCondition, activeLeagueRegCondition, activeTournamentRegCondition } from "../lib/activeConditions";
import {
  GetMyProfileResponse,
  UpdateMyProfileBody,
  ListUsersQueryParams,
  ListUsersResponse,
  GetUserParams,
  GetUserResponse,
  UpdateUserBody,
} from "@workspace/api-zod";
import { requireAuth, requirePermission, requireSuperAdmin, type AuthedRequest } from "../middlewares/auth";
import { sendNotification } from "../services/notifications";
import { clerkClient } from "@clerk/express";
import { createSign, randomBytes } from "crypto";
import { decryptOrNull } from "../lib/encrypt";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/** Extracts the deepest available PostgreSQL error detail from a Drizzle-wrapped error. */
function pgErrorDetail(err: any): string {
  // Drizzle wraps the raw pg error in err.cause; unwrap the chain for diagnostics
  const cause = err?.cause ?? err;
  const parts: string[] = [];
  if (err?.message && err.message !== cause?.message) parts.push(`drizzle: ${err.message}`);
  if (cause?.message) parts.push(`pg: ${cause.message}`);
  if (cause?.code)    parts.push(`code=${cause.code}`);
  if (cause?.detail)  parts.push(`detail=${cause.detail}`);
  if (cause?.table)   parts.push(`table=${cause.table}`);
  if (cause?.column)  parts.push(`column=${cause.column}`);
  return parts.join(" | ") || String(err);
}

async function getOrCreateUser(clerkId: string, email?: string, phone?: string): Promise<any> {
  let existing: any;
  try {
    [existing] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  } catch (err: any) {
    logger.error({ clerkId, detail: pgErrorDetail(err) }, "[getOrCreateUser] SELECT failed");
    throw err;
  }
  if (existing) return existing;

  // No match by Clerk ID — try to re-link an existing account so the user keeps all their history.
  // Auth provider migration: old instance used email, new instance uses phone number.
  // Try email first, then phone as fallback.

  if (email && !email.endsWith('@playon.local')) {
    try {
      const [byEmail] = await db.select().from(usersTable).where(eq(usersTable.email, email));
      if (byEmail) {
        const [relinked] = await db.update(usersTable)
          .set({ clerkId })
          .where(eq(usersTable.id, byEmail.id))
          .returning();
        logger.info({ oldClerkId: byEmail.clerkId, newClerkId: clerkId, email }, "[getOrCreateUser] Re-linked account to new Clerk ID via email");
        return relinked ?? byEmail;
      }
    } catch (err: any) {
      logger.warn({ email, detail: pgErrorDetail(err) }, "[getOrCreateUser] Email re-link lookup failed — will try phone");
    }
  }

  // Phone-based re-link: normalize to E.164 digits only for comparison
  if (phone) {
    const normalizedPhone = phone.replace(/\D/g, "");
    try {
      const allWithPhone = await db.select().from(usersTable).where(sql`phone IS NOT NULL`);
      const byPhone = allWithPhone.find((u: any) => u.phone?.replace(/\D/g, "") === normalizedPhone);
      if (byPhone) {
        const [relinked] = await db.update(usersTable)
          .set({ clerkId })
          .where(eq(usersTable.id, byPhone.id))
          .returning();
        logger.info({ oldClerkId: byPhone.clerkId, newClerkId: clerkId, phone }, "[getOrCreateUser] Re-linked account to new Clerk ID via phone");
        return relinked ?? byPhone;
      }
    } catch (err: any) {
      logger.warn({ phone, detail: pgErrorDetail(err) }, "[getOrCreateUser] Phone re-link lookup failed — will create new user");
    }
  }

  // Strip the 'user_' prefix so we use the random portion of the Clerk ID (36^8 ≈ 2.8T values).
  const baseRandomPart = clerkId.replace(/^user_/, '');
  const MAX_ATTEMPTS = 5;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // First attempt: deterministic 8-char slice of the random portion.
    // Retries: first 5 chars of random portion + 3 crypto-random hex chars to escape the collision.
    const suffix = attempt === 0
      ? baseRandomPart.slice(0, 8)
      : baseRandomPart.slice(0, 5) + randomBytes(2).toString('hex').slice(0, 3);
    const playonId = `PO-${suffix.toUpperCase()}`;

    try {
      // onConflictDoNothing scoped to clerkId — silently drops same-user concurrent inserts.
      // playon_id conflicts (different user, same 8-char prefix) are NOT suppressed here
      // and will throw 23505, which we catch below for retry.
      const [created] = await db.insert(usersTable).values({
        clerkId,
        email: email ?? `${clerkId}@playon.local`,
        playonId,
        qrCode: `playon:player:${clerkId}`,
      } as any).onConflictDoNothing({ target: usersTable.clerkId }).returning();

      if (created) return created;

      // Insert was silently dropped → same clerkId already exists (concurrent request won the race).
      const [byClerk] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
      if (byClerk) return byClerk;
      // Guard: shouldn't happen — onConflictDoNothing only fires when clerkId already exists.
      throw new Error(`getOrCreateUser: insert suppressed but no existing row found for clerkId ${clerkId}`);
    } catch (err: any) {
      // Drizzle may wrap the raw PG error — check both err.code and err.cause.code.
      const pgCode: string | undefined = err?.code ?? err?.cause?.code;
      if (pgCode === '23505') {
        // Determine whether this is a same-user race (clerkId conflict) or a playon_id collision.
        const [byClerk] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
        if (byClerk) return byClerk; // Same-user race — return the already-created row.
        // playon_id collision with a different user — retry with a new suffix.
        logger.warn({ clerkId, attempt, playonId }, "[getOrCreateUser] playon_id collision — retrying");
        continue;
      }
      logger.error({ clerkId, detail: pgErrorDetail(err) }, "[getOrCreateUser] INSERT failed");
      throw err;
    }
  }

  throw new Error(`getOrCreateUser: could not create user after ${MAX_ATTEMPTS} attempts for clerkId ${clerkId}`);
}

export async function runQrBackfill(): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE users
      SET qr_code = 'playon:player:' || clerk_id
      WHERE qr_code IS NULL
    `);
  } catch (err) {
    console.error("[QR backfill] failed:", err);
  }
}

async function writeAuditLog(actorClerkId: string, action: string, entityType: string, entityId: string, before: any, after: any) {
  try {
    await db.insert(auditLogTable).values({
      actorClerkId,
      action,
      entityType,
      entityId,
      before: JSON.stringify(before),
      after: JSON.stringify(after),
    });
  } catch {
    // Non-blocking
  }
}

router.get("/me", requireAuth, async (req: any, res): Promise<void> => {
  const clerkUserId = (req as AuthedRequest).clerkUserId;
  // Fetch Clerk user up front so we can pass email + phone to getOrCreateUser for re-linking.
  // This handles migration from email-based auth (old Clerk instance) to phone-based auth (new instance).
  let clerkUser: any = null;
  try {
    clerkUser = await (clerkClient as any).users.getUser(clerkUserId);
  } catch (err) {
    logger.warn({ err }, "[GET /me] Clerk user fetch failed — proceeding without Clerk data");
  }

  const emailAddresses: Array<{ id: string; emailAddress: string }> = clerkUser?.emailAddresses ?? [];
  const primaryEmailId: string | null = clerkUser?.primaryEmailAddressId ?? null;
  const clerkEmail: string | null = primaryEmailId
    ? (emailAddresses.find((e) => e.id === primaryEmailId)?.emailAddress ?? null)
    : (emailAddresses[0]?.emailAddress ?? null);
  const normalizedClerkEmail = clerkEmail ? clerkEmail.trim().toLowerCase() : null;

  const phoneNumbers: Array<{ id: string; phoneNumber: string }> = clerkUser?.phoneNumbers ?? [];
  const primaryPhoneId: string | null = clerkUser?.primaryPhoneNumberId ?? null;
  const clerkPhone: string | null = primaryPhoneId
    ? (phoneNumbers.find((p) => p.id === primaryPhoneId)?.phoneNumber ?? null)
    : (phoneNumbers[0]?.phoneNumber ?? null);

  let user: any;
  try {
    user = await getOrCreateUser(clerkUserId, normalizedClerkEmail ?? undefined, clerkPhone ?? undefined);
  } catch (err: any) {
    logger.error({ detail: pgErrorDetail(err) }, "[GET /me] getOrCreateUser failed");
    res.status(500).json({ error: "Failed to load profile. Please contact support." });
    return;
  }

  // Backfill Clerk profile data on first access (only when firstName has never been set).
  // Strict null check — an empty string means the user deliberately cleared the field.
  if (user.firstName === null) {
    try {
      const firstName = clerkUser?.firstName ?? null;
      const lastName = clerkUser?.lastName ?? null;
      const avatarUrl = clerkUser?.imageUrl ?? null;

      const updates: Record<string, any> = {};
      if (firstName !== null) updates.firstName = firstName;
      if (lastName !== null) updates.lastName = lastName;
      if (avatarUrl !== null) updates.avatarUrl = avatarUrl;
      // Overwrite placeholder email with the real Clerk email
      if (normalizedClerkEmail && (!user.email || user.email.endsWith("@playon.local"))) {
        updates.email = normalizedClerkEmail;
      }

      if (Object.keys(updates).length > 0) {
        await db.update(usersTable)
          .set(updates)
          .where(eq(usersTable.clerkId, clerkUserId));
        // Re-read the updated row so the response includes the seeded values
        [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkUserId));
      }
    } catch (err) {
      logger.warn({ err }, "[GET /me] Clerk profile backfill failed — proceeding with existing data");
    }
  }

  // Link any guest spots registered under this email — runs unconditionally on every GET /me
  // so spots created after onboarding (when firstName is already set) are still picked up.
  // Skipped only for internal placeholder accounts (@playon.local).
  const linkEmail = user.email && !user.email.endsWith("@playon.local") ? user.email.trim().toLowerCase() : null;
  if (linkEmail && user?.id) {
    try {
      const result = await db.execute(sql`
        UPDATE spots
        SET user_id = ${user.id}, updated_at = NOW()
        WHERE LOWER(guest_email) = ${linkEmail}
          AND user_id IS NULL
          AND status = 'reserved'
      `);
      const count = (result as any).rowCount ?? 0;
      if (count > 0) {
        logger.info({ userId: user.id, email: linkEmail, count }, "[GET /me] Linked guest spots to account");
      }
    } catch (linkErr) {
      logger.warn({ linkErr }, "[GET /me] Guest spot linking failed — non-blocking");
    }
  }

  const normalized = normalizeForProfileResponse(user);
  let profileResponse: any;
  try {
    profileResponse = GetMyProfileResponse.parse(normalized);
  } catch (err) {
    logger.error({ err }, "[GET /me] GetMyProfileResponse.parse failed");
    res.status(500).json({ error: "Failed to load profile. Please contact support." });
    return;
  }

  // Attach waiver status — not in the Zod schema but appended so frontend can gate on expiry
  try {
    const now = new Date();
    const [latestSig] = await db
      .select()
      .from(waiverSignaturesTable)
      .where(eq(waiverSignaturesTable.userId, user.id))
      .orderBy(desc(waiverSignaturesTable.signedAt))
      .limit(1);

    profileResponse = {
      ...profileResponse,
      waiverSigned: !!latestSig,
      waiverExpired: latestSig?.expiresAt ? (latestSig.expiresAt as Date) < now : !latestSig,
      waiverExpiresAt: latestSig?.expiresAt ?? null,
      waiverSignedAt: latestSig?.signedAt ?? null,
    };
  } catch {
    // Non-blocking — attach defaults so frontend doesn't crash
    profileResponse = { ...profileResponse, waiverSigned: false, waiverExpired: true, waiverExpiresAt: null, waiverSignedAt: null };
  }

  res.json(profileResponse);
});

const PRIVILEGED_ROLES = ["ref", "coach", "scorekeeper", "staff"];

const VALID_ADMIN_LEVELS = ["super", "scoped"] as const;

/**
 * Normalises a raw DB user row into the shape expected by GetMyProfileResponse.
 *
 * Guarantees:
 *   - `role`  (string, singular) is trimmed — kept for backward compatibility, DEPRECATED.
 *   - `roles` (string[]) is always populated: it merges the legacy `role` field with any
 *             existing `roles` array so callers only need to check `roles`.
 */
function normalizeForProfileResponse(user: any): any {
  const role = typeof user.role === "string" ? user.role.trim() : user.role;
  const existingRoles: string[] = Array.isArray(user.roles) ? user.roles : [];
  const roles = [...new Set(role ? [role, ...existingRoles] : existingRoles)];
  return {
    ...user,
    role,   // @deprecated — prefer roles[]
    roles,
    adminLevel: VALID_ADMIN_LEVELS.includes(user.adminLevel) ? user.adminLevel : undefined,
    idPhotoUrl: (user as any).idPhotoUrl ?? null,
  };
}

router.patch("/me", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const parsed = UpdateMyProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Ensure user row exists, then fetch current state (needed for admin bypass check)
  let callerUser: any;
  try {
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
    if (!existing) await getOrCreateUser(authed.clerkUserId);
    [callerUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
  } catch (err: any) {
    logger.error({ detail: pgErrorDetail(err) }, "[PATCH /me] DB lookup/create failed");
    res.status(500).json({ error: "Failed to load profile. Please contact support." });
    return;
  }
  const isAdmin = callerUser?.role === "admin";

  const updateData: any = { ...parsed.data, updatedAt: new Date() };
  delete updateData.role;        // Players cannot self-escalate via this field
  delete updateData.adminLevel;  // Players cannot self-assign an admin level
  delete updateData.idVerified;  // Must be set via POST /me/verify-id (server-side verification only)
  delete updateData.idVerifiedAt;

  // Block self-assignment of privileged roles unless caller is admin or has a valid invite token
  const requestedRoles: string[] = Array.isArray(updateData.roles) ? updateData.roles : [];
  const hasPrivilegedRole = requestedRoles.some((r: string) => PRIVILEGED_ROLES.includes(r));

  if (hasPrivilegedRole && !isAdmin) {
    const { inviteToken } = req.body ?? {};
    if (!inviteToken || typeof inviteToken !== "string") {
      res.status(403).json({ error: "This role requires an admin invite." });
      return;
    }

    // Pre-fetch invite to validate email binding before touching anything
    const [pendingInvite] = await db
      .select()
      .from(staffInvitesTable)
      .where(eq(staffInvitesTable.token, inviteToken));

    if (!pendingInvite) {
      res.status(403).json({ error: "The invite token is invalid, already used, or has expired." });
      return;
    }

    // Fetch canonical email from Clerk (DB row may hold a placeholder like clerkId@playon.local
    // if created before Clerk sync). This is the source of truth for identity binding.
    let canonicalEmail = "";
    try {
      const clerkUser = await (clerkClient as any).users.getUser(authed.clerkUserId);
      const primary = clerkUser?.emailAddresses?.find(
        (e: any) => e.id === clerkUser.primaryEmailAddressId,
      );
      canonicalEmail = (primary?.emailAddress ?? "").toLowerCase().trim();
    } catch {
      // If Clerk lookup fails, fall back to DB email
      canonicalEmail = (callerUser?.email ?? "").toLowerCase().trim();
    }

    // Enforce that the invite was issued to this user's email address
    const inviteEmail = pendingInvite.email.toLowerCase().trim();
    if (!canonicalEmail || canonicalEmail !== inviteEmail) {
      res.status(403).json({ error: "This invite was issued to a different email address." });
      return;
    }

    const now = new Date();
    let finalUser: typeof callerUser;

    try {
      await db.transaction(async (tx) => {
        // Atomically consume the invite inside the transaction.
        // Conditional WHERE prevents double-use even under concurrent requests.
        const [consumed] = await tx
          .update(staffInvitesTable)
          .set({ usedAt: now, usedBy: authed.clerkUserId })
          .where(
            and(
              eq(staffInvitesTable.token, inviteToken),
              isNull(staffInvitesTable.usedAt),
              isNull(staffInvitesTable.revokedAt),
              gt(staffInvitesTable.expiresAt, now),
            ),
          )
          .returning();

        if (!consumed) {
          throw new Error("INVITE_INVALID");
        }

        // Strip any privileged roles the invite does not grant
        const sanitizedRoles = requestedRoles.filter(
          (r: string) => !PRIVILEGED_ROLES.includes(r) || r === consumed.role,
        );

        const [u] = await tx
          .update(usersTable)
          .set({ ...updateData, roles: sanitizedRoles })
          .where(eq(usersTable.clerkId, authed.clerkUserId))
          .returning();

        finalUser = u;
      });
    } catch (err: any) {
      if (err.message === "INVITE_INVALID") {
        res.status(403).json({ error: "The invite token is invalid, already used, or has expired." });
      } else {
        res.status(500).json({ error: "Failed to apply invite. Please try again." });
      }
      return;
    }

    const n = finalUser!;
    const normalizedInvite = normalizeForProfileResponse(n);
    try {
      res.json(GetMyProfileResponse.parse(normalizedInvite));
    } catch (err) {
      console.error("[PATCH /me] GetMyProfileResponse.parse failed (invite path):", err);
      res.status(500).json({ error: "Profile updated but response serialization failed." });
    }
    return;
  }

  const [user] = await db
    .update(usersTable)
    .set(updateData)
    .where(eq(usersTable.clerkId, authed.clerkUserId))
    .returning();
  const normalizedUser = normalizeForProfileResponse(user);
  try {
    res.json(GetMyProfileResponse.parse(normalizedUser));
  } catch (err) {
    console.error("[PATCH /me] GetMyProfileResponse.parse failed:", err);
    res.status(500).json({ error: "Profile updated but response serialization failed." });
  }
});

/**
 * POST /me/verify-id
 * Accepts either:
 *   (a) { barcodeData: string } — raw AAMVA PDF417 barcode string (mobile path)
 *   (b) { firstName, lastName, dob, addressLine1?, city?, state?, zip? } — manual entry (web path)
 * Validates the bearer is ≥18 and sets idVerified=true on their profile.
 * This is the ONLY way to set idVerified — PATCH /me strips the field.
 */
router.post("/me/verify-id", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const body = req.body ?? {};

  const { isAdult, isAtLeast13 } = await import("../lib/aamva");

  let firstName: string;
  let lastName: string;
  let dateOfBirth: Date;
  let addressLine1: string | undefined;
  let city: string | undefined;
  let state: string | undefined;
  let zip: string | undefined;

  if (body.barcodeData && typeof body.barcodeData === "string") {
    // ── Path A: AAMVA barcode (mobile) ──────────────────────────────
    const { parseAamvaBarcode } = await import("../lib/aamva");
    const result = parseAamvaBarcode(body.barcodeData);
    if (!result.success) {
      res.status(422).json({ error: `Barcode parse failed: ${result.error}` });
      return;
    }
    ({ firstName, lastName, dateOfBirth, addressLine1, city, state, zip } = result.data);
  } else if (body.firstName && body.lastName && body.dob) {
    // ── Path B: manual structured fields (web) ───────────────────────
    const dobDate = new Date(body.dob);
    if (isNaN(dobDate.getTime())) {
      res.status(400).json({ error: "Invalid date of birth." });
      return;
    }
    if (body.zip && !/^\d{5}$/.test(String(body.zip).trim())) {
      res.status(400).json({ error: "ZIP code must be 5 digits." });
      return;
    }
    firstName = String(body.firstName).trim();
    lastName = String(body.lastName).trim();
    dateOfBirth = dobDate;
    if (body.addressLine1) addressLine1 = String(body.addressLine1).trim();
    if (body.city) city = String(body.city).trim();
    if (body.state) state = String(body.state).trim().toUpperCase().slice(0, 2);
    if (body.zip) zip = String(body.zip).trim();
  } else {
    res.status(400).json({ error: "Provide either barcodeData or firstName/lastName/dob." });
    return;
  }

  // Determine minimum age — 13 for valid staff invitees, 18 for everyone else
  let minimumAge = 18;
  const rawInviteToken = typeof body.inviteToken === "string" ? body.inviteToken.trim() : null;
  if (rawInviteToken) {
    const inviteCheckNow = new Date();
    const invite = await db
      .select()
      .from(staffInvitesTable)
      .where(
        and(
          eq(staffInvitesTable.token, rawInviteToken),
          isNull(staffInvitesTable.revokedAt),
          isNull(staffInvitesTable.usedAt),
          gt(staffInvitesTable.expiresAt, inviteCheckNow),
        )
      )
      .limit(1);
    if (invite.length > 0) {
      minimumAge = 13;
    }
  }

  if (minimumAge === 13 ? !isAtLeast13(dateOfBirth) : !isAdult(dateOfBirth)) {
    res.status(403).json({
      error: `Identity verification failed: must be ${minimumAge} or older to create an account.`,
    });
    return;
  }

  const now = new Date();
  // Ensure the user row exists (new accounts are created lazily)
  try {
    await getOrCreateUser(authed.clerkUserId);
  } catch (err: any) {
    console.error("[POST /me/verify-id] getOrCreateUser failed:", err?.message ?? err);
    res.status(500).json({ error: "Failed to create user record. Please contact support." });
    return;
  }

  const dobString = dateOfBirth.toISOString().split("T")[0];

  const updateFields: Record<string, any> = {
    idVerified: true,
    idVerifiedAt: now,
    firstName,
    lastName,
    dateOfBirth: dobString,
    updatedAt: now,
  };
  if (addressLine1 !== undefined) updateFields.addressLine1 = addressLine1;
  if (city !== undefined) updateFields.city = city;
  if (state !== undefined) updateFields.state = state;
  if (zip !== undefined) updateFields.zip = zip;

  const [user] = await db
    .update(usersTable)
    .set(updateFields as any)
    .where(eq(usersTable.clerkId, authed.clerkUserId))
    .returning();

  if (!user) {
    res.status(500).json({ error: "Failed to update user record" });
    return;
  }

  const normalized = { ...user, role: typeof user.role === "string" ? user.role.trim() : user.role };
  res.json(GetMyProfileResponse.parse(normalized));
});

/**
 * GET /me/id-data
 * Returns the decrypted identity data extracted from the user's verified driver's license.
 * Supports waiver auto-fill and profile pre-population.
 * Returns hasIdData:false with null fields when no ID has been scanned.
 */
router.get("/me/id-data", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!user) {
    res.json({ hasIdData: false });
    return;
  }

  const hasIdData = !!(user as any).idFirstName;
  if (!hasIdData) {
    res.json({ hasIdData: false });
    return;
  }

  res.json({
    hasIdData: true,
    firstName: decryptOrNull((user as any).idFirstName),
    lastName: decryptOrNull((user as any).idLastName),
    dateOfBirth: decryptOrNull((user as any).idDob),
    addressLine1: decryptOrNull((user as any).idAddress),
  });
});

/**
 * POST /me/id-photo
 * Accepts a multipart/form-data photo upload, stores it in the private GCS bucket,
 * and writes the resulting GCS object name to id_photo_url on the user record.
 * Only JPEG and PNG images are accepted. Max 10 MB.
 */
const idPhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (["image/jpeg", "image/png"].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPEG and PNG images are accepted for ID photos."));
    }
  },
});

router.post(
  "/me/id-photo",
  requireAuth,
  idPhotoUpload.single("photo"),
  async (req: any, res): Promise<void> => {
    const authed = req as AuthedRequest;
    if (!req.file) {
      res.status(400).json({ error: "No photo file provided. Send a JPEG or PNG as 'photo'." });
      return;
    }

    let objectName: string;
    try {
      const { uploadIdPhoto } = await import("../lib/idPhotoStorage");
      objectName = await uploadIdPhoto(req.file.buffer, req.file.mimetype);
    } catch (err: any) {
      logger.error({ err }, "[POST /me/id-photo] GCS upload failed");
      res.status(500).json({ error: "Failed to upload ID photo. Please try again." });
      return;
    }

    // Fetch current row to delete old photo if one exists
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
    const oldPhotoUrl = (existing as any)?.idPhotoUrl;

    await db
      .update(usersTable)
      .set({ idPhotoUrl: objectName, updatedAt: new Date() } as any)
      .where(eq(usersTable.clerkId, authed.clerkUserId));

    // Clean up old photo asynchronously (non-blocking)
    if (oldPhotoUrl && oldPhotoUrl !== objectName) {
      import("../lib/idPhotoStorage").then(({ deleteIdPhoto }) => deleteIdPhoto(oldPhotoUrl)).catch(() => {});
    }

    res.json({ success: true, idPhotoUrl: objectName });
  },
);

/**
 * DELETE /me/id-data
 * Clears all encrypted ID data from the user's record (GDPR/CCPA right to erasure).
 * Also deletes the stored ID photo from GCS.
 * Does NOT affect idVerified status — the user remains verified, just without stored data.
 */
router.delete("/me/id-data", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;

  // Fetch current photo URL before clearing so we can delete from GCS
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
  const photoUrl = (existing as any)?.idPhotoUrl;

  await db
    .update(usersTable)
    .set({
      idFirstName: null,
      idLastName: null,
      idDob: null,
      idAddress: null,
      idPhotoUrl: null,
      updatedAt: new Date(),
    } as any)
    .where(eq(usersTable.clerkId, authed.clerkUserId));

  // Delete the stored photo from GCS (non-blocking)
  if (photoUrl) {
    import("../lib/idPhotoStorage").then(({ deleteIdPhoto }) => deleteIdPhoto(photoUrl)).catch(() => {});
  }

  res.json({ success: true, message: "ID data deleted. Your verified status is retained." });
});

router.get("/me/registrations", requireAuth, async (req: any, res): Promise<void> => {
  const { registrationsTable } = await import("@workspace/db");
  const authed = req as AuthedRequest;
  const regs = await db.select().from(registrationsTable).where(eq(registrationsTable.userId, authed.clerkUserId));
  res.json(regs.map((r: any) => ({ ...r, amountPaid: Number(r.amountPaid) })));
});

// Return all camp registrations for the currently signed-in user, including waitlist position.
// Used by the player dashboard and mobile schedule to show waitlisted camps.
router.get("/me/camp-registrations", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const regs = await db
    .select()
    .from(campRegistrationsTable)
    .where(
      and(
        eq(campRegistrationsTable.userId, user.id),
        activeCampRegCondition,
      )
    )
    .orderBy(desc(campRegistrationsTable.createdAt));

  // Also pick up regs where this user is the player but not the registrant
  const playerRegs = await db
    .select()
    .from(campRegistrationsTable)
    .where(
      and(
        eq(campRegistrationsTable.playerUserId, user.id),
        activeCampRegCondition,
      )
    )
    .orderBy(desc(campRegistrationsTable.createdAt));

  // Merge and deduplicate
  const allIds = new Set(regs.map((r: any) => r.id));
  const merged = [...regs, ...playerRegs.filter((r: any) => !allIds.has(r.id))];

  // Fetch camp names
  const campIds = [...new Set(merged.map((r: any) => r.campId))];
  const camps = campIds.length > 0
    ? await db.select({ id: campsTable.id, name: campsTable.name, startDate: campsTable.startDate })
        .from(campsTable)
        .where(sql`${campsTable.id} = ANY(${sql.raw(`ARRAY[${campIds.join(",")}]`)})`)
    : [];
  const campMap: Record<number, any> = {};
  for (const c of camps) campMap[c.id] = c;

  const result = merged.map((r: any) => ({
    id: r.id,
    campId: r.campId,
    campName: campMap[r.campId]?.name ?? null,
    campStartDate: campMap[r.campId]?.startDate ?? null,
    status: r.status,
    paymentStatus: r.paymentStatus,
    waitlistPosition: r.waitlistPosition ?? null,
    pricePaid: Number(r.pricePaid),
    balanceDue: r.balanceDue != null ? Number(r.balanceDue) : null,
    createdAt: r.createdAt,
  }));

  res.json(result);
});

// Return all league registrations for the currently signed-in user, including waitlist position.
router.get("/me/league-registrations", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const regs = await db
    .select()
    .from(leagueRegistrationsTable)
    .where(and(eq(leagueRegistrationsTable.registeredByUserId, authed.clerkUserId), activeLeagueRegCondition))
    .orderBy(desc(leagueRegistrationsTable.createdAt));

  const leagueIds = [...new Set(regs.map((r: any) => r.leagueId))];
  const leagues = leagueIds.length > 0
    ? await db.select({ id: leaguesTable.id, name: leaguesTable.name, startDate: leaguesTable.startDate })
        .from(leaguesTable)
        .where(inArray(leaguesTable.id, leagueIds as number[]))
    : [];
  const leagueMap: Record<number, any> = {};
  for (const l of leagues) leagueMap[l.id] = l;

  const teamIds = regs.filter((r: any) => r.teamId).map((r: any) => r.teamId as number);
  const teams = teamIds.length > 0
    ? await db.select({ id: teamsTable.id, name: teamsTable.name }).from(teamsTable).where(inArray(teamsTable.id, teamIds))
    : [];
  const teamMap: Record<number, any> = {};
  for (const t of teams) teamMap[t.id] = t;

  const result = regs.map((r: any) => ({
    id: r.id,
    leagueId: r.leagueId,
    leagueName: leagueMap[r.leagueId]?.name ?? null,
    leagueStartDate: leagueMap[r.leagueId]?.startDate ?? null,
    teamId: r.teamId,
    teamName: r.teamId ? (teamMap[r.teamId]?.name ?? null) : null,
    status: r.status,
    paymentStatus: r.paymentStatus,
    waitlistPosition: r.waitlistPosition ?? null,
    programType: "league",
    createdAt: r.createdAt,
  }));

  res.json(result);
});

// Return all tournament registrations for the currently signed-in user, including waitlist position.
router.get("/me/tournament-registrations", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const regs = await db
    .select()
    .from(tournamentRegistrationsTable)
    .where(and(eq(tournamentRegistrationsTable.registeredByUserId, user.id), activeTournamentRegCondition))
    .orderBy(desc(tournamentRegistrationsTable.createdAt));

  const tournamentIds = [...new Set(regs.map((r: any) => r.tournamentId))];
  const tournaments = tournamentIds.length > 0
    ? await db.select({ id: tournamentsTable.id, name: tournamentsTable.name, startDate: tournamentsTable.startDate })
        .from(tournamentsTable)
        .where(inArray(tournamentsTable.id, tournamentIds as number[]))
    : [];
  const tournamentMap: Record<number, any> = {};
  for (const t of tournaments) tournamentMap[t.id] = t;

  const teamIds = regs.filter((r: any) => r.teamId).map((r: any) => r.teamId as number);
  const teams = teamIds.length > 0
    ? await db.select({ id: teamsTable.id, name: teamsTable.name }).from(teamsTable).where(inArray(teamsTable.id, teamIds))
    : [];
  const teamMap: Record<number, any> = {};
  for (const t of teams) teamMap[t.id] = t;

  const result = regs.map((r: any) => ({
    id: r.id,
    tournamentId: r.tournamentId,
    tournamentName: tournamentMap[r.tournamentId]?.name ?? null,
    tournamentStartDate: tournamentMap[r.tournamentId]?.startDate ?? null,
    teamId: r.teamId,
    teamName: r.teamId ? (teamMap[r.teamId]?.name ?? null) : null,
    status: r.status,
    paymentStatus: r.paymentStatus,
    waitlistPosition: r.waitlistPosition ?? null,
    programType: "tournament",
    createdAt: r.createdAt,
  }));

  res.json(result);
});

// Return upcoming drop-in spots for the signed-in adult player.
// Spots in the `spots` table are keyed by integer userId (DB id), not clerkId.
router.get("/me/dropin-spots", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const now = new Date();

  const rows = await db
    .select({
      id: spotsTable.id,
      poolId: spotsTable.poolId,
      status: spotsTable.status,
      waitlisted: spotsTable.waitlisted,
      waitlistPosition: spotsTable.waitlistPosition,
      paymentStatus: spotsTable.paymentStatus,
      createdAt: spotsTable.createdAt,
      dropinId: dropinsTable.id,
      dropinName: dropinsTable.name,
      dropinStartsAt: dropinsTable.startsAt,
      poolStartsAt: dropinCourtPoolsTable.startsAt,
      poolDurationMinutes: dropinCourtPoolsTable.durationMinutes,
      poolPrice: dropinCourtPoolsTable.price,
    })
    .from(spotsTable)
    .innerJoin(
      dropinsTable,
      and(
        eq(spotsTable.entityId, dropinsTable.id),
        eq(spotsTable.entityType, "dropin"),
      ),
    )
    .leftJoin(
      dropinCourtPoolsTable,
      eq(spotsTable.poolId, dropinCourtPoolsTable.id),
    )
    .where(
      and(
        eq(spotsTable.userId, user.id),
        activeSpotCondition,
        gte(sql`COALESCE(${dropinCourtPoolsTable.startsAt}, ${dropinsTable.startsAt})`, now),
      ),
    )
    .orderBy(sql`COALESCE(${dropinCourtPoolsTable.startsAt}, ${dropinsTable.startsAt})`);

  res.json(rows.map((s) => {
    const startsAt = s.poolStartsAt ?? s.dropinStartsAt;
    const durationMinutes = s.poolDurationMinutes ?? null;
    const endsAt = startsAt && durationMinutes
      ? new Date(startsAt.getTime() + durationMinutes * 60_000).toISOString()
      : null;
    return {
      id: s.id,
      dropinId: s.dropinId,
      dropinName: s.dropinName,
      poolId: s.poolId,
      startsAt: startsAt.toISOString(),
      endsAt,
      status: s.status,
      waitlisted: s.waitlisted,
      waitlistPosition: s.waitlistPosition,
      paymentStatus: s.paymentStatus,
      poolPrice: Number(s.poolPrice ?? 0),
      programType: "drop_in" as const,
      createdAt: s.createdAt,
    };
  }));
});

// Return active payment_pending drop-in spots for the signed-in player.
// Used by the dashboard to display expiry countdown warnings.
router.get("/me/pending-dropin-spots", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const now = new Date();
  const rows = await db
    .select({
      spotId: spotsTable.id,
      poolId: spotsTable.poolId,
      entityId: spotsTable.entityId,
      paymentStatus: spotsTable.paymentStatus,
      expiresAt: (spotsTable as any).expiresAt,
      createdAt: spotsTable.createdAt,
      dropinName: dropinsTable.name,
    })
    .from(spotsTable)
    .innerJoin(
      dropinsTable,
      and(
        eq(spotsTable.entityId, dropinsTable.id),
        eq(spotsTable.entityType, "dropin"),
      ),
    )
    .where(
      and(
        eq(spotsTable.userId, user.id),
        eq(spotsTable.paymentStatus, "payment_pending"),
        eq(spotsTable.status, "reserved"),
        or(isNull((spotsTable as any).expiresAt), gt((spotsTable as any).expiresAt, now)),
      ),
    )
    .orderBy(desc(spotsTable.createdAt));

  res.json(rows);
});

// ── Apple Wallet ──────────────────────────────────────────────────────────────
// Minimal 1×1 maroon PNG — serves as a placeholder icon when no branded asset is embedded.
// Replace with a proper icon.png (29×29, 58×58 @2x) for production.
const PLACEHOLDER_ICON_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADklEQVQI12P4z8BQDwAEgAF/QualIQAAAABJRU5ErkJggg==",
  "base64",
);

router.get("/me/wallet/apple", requireAuth, async (req: any, res): Promise<void> => {
  const CERT = process.env["APPLE_WALLET_CERT"];
  const KEY = process.env["APPLE_WALLET_KEY"];
  const WWDR = process.env["APPLE_WALLET_WWDR"];
  const PASS_TYPE_ID = process.env["APPLE_WALLET_PASS_TYPE_ID"];
  const TEAM_ID = process.env["APPLE_WALLET_TEAM_ID"];

  if (!CERT || !KEY || !WWDR || !PASS_TYPE_ID || !TEAM_ID) {
    res.status(503).json({ error: "Apple Wallet not configured" });
    return;
  }

  const user = await getOrCreateUser((req as AuthedRequest).clerkUserId);

  try {
    const { PKPass } = await import("passkit-generator");
    const qrPayload = user.qrCode ?? `playon:player:${user.clerkId}`;
    const playerName = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "PlayOn Player";

    const passJson = {
      formatVersion: 1,
      passTypeIdentifier: PASS_TYPE_ID,
      serialNumber: user.clerkId,
      teamIdentifier: TEAM_ID,
      organizationName: "PlayOn",
      description: "PlayOn Player ID",
      foregroundColor: "rgb(250, 249, 249)",
      backgroundColor: "rgb(116, 13, 42)",
      labelColor: "rgb(153, 161, 163)",
      generic: {
        primaryFields: [
          { key: "name", label: "PLAYER", value: playerName },
        ],
        secondaryFields: [
          { key: "id", label: "PLAYON ID", value: user.playonId ?? user.clerkId.slice(0, 8).toUpperCase() },
        ],
      },
      barcodes: [
        {
          message: qrPayload,
          format: "PKBarcodeFormatQR",
          messageEncoding: "iso-8859-1",
        },
      ],
    };

    const pass = new PKPass(
      {
        "pass.json": Buffer.from(JSON.stringify(passJson)),
        "icon.png": PLACEHOLDER_ICON_PNG,
        "icon@2x.png": PLACEHOLDER_ICON_PNG,
      },
      {
        wwdr: Buffer.from(WWDR, "base64"),
        signerCert: Buffer.from(CERT, "base64"),
        signerKey: Buffer.from(KEY, "base64"),
      },
    );

    const buf = pass.getAsBuffer();
    res.setHeader("Content-Type", "application/vnd.apple.pkpass");
    res.setHeader("Content-Disposition", `attachment; filename="playon-pass.pkpass"`);
    res.send(buf);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to generate Apple Wallet pass", detail: err?.message });
  }
});

// ── Google Wallet ─────────────────────────────────────────────────────────────
function signGoogleJwt(claims: object, privateKey: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const sigInput = `${header}.${body}`;
  const signer = createSign("RSA-SHA256");
  signer.update(sigInput);
  const sig = signer.sign(privateKey, "base64url");
  return `${sigInput}.${sig}`;
}

router.get("/me/wallet/google", requireAuth, async (req: any, res): Promise<void> => {
  const SA_JSON = process.env["GOOGLE_WALLET_SERVICE_ACCOUNT_JSON"];
  // GOOGLE_WALLET_ISSUER_ID is the numeric issuer ID from the Google Wallet Business Console
  // (distinct from the service account client_id).
  const ISSUER_ID = process.env["GOOGLE_WALLET_ISSUER_ID"];

  if (!SA_JSON || !ISSUER_ID) {
    res.status(503).json({ error: "Google Wallet not configured" });
    return;
  }

  const user = await getOrCreateUser((req as AuthedRequest).clerkUserId);

  try {
    const sa = JSON.parse(SA_JSON);
    const classId = `${ISSUER_ID}.PlayOnPlayerClass`;
    const objectId = `${ISSUER_ID}.playon_player_${user.id}`;
    const qrPayload = user.qrCode ?? `playon:player:${user.clerkId}`;
    const playerName = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "PlayOn Player";
    const now = Math.floor(Date.now() / 1000);

    const claims = {
      iss: sa.client_email,
      aud: "google",
      origins: [] as string[],
      iat: now,
      exp: now + 3600,
      typ: "savetowallet",
      payload: {
        genericObjects: [
          {
            id: objectId,
            classId,
            genericType: "GENERIC_TYPE_UNSPECIFIED",
            hexBackgroundColor: "#740D2A",
            header: { defaultValue: { language: "en-US", value: playerName } },
            subheader: { defaultValue: { language: "en-US", value: "PlayOn Player ID" } },
            textModulesData: [
              { id: "playon_id", header: "PLAYON ID", body: user.playonId ?? user.clerkId.slice(0, 8).toUpperCase() },
            ],
            barcode: {
              type: "QR_CODE",
              value: qrPayload,
              alternateText: "",
            },
            cardTitle: { defaultValue: { language: "en-US", value: "PlayOn" } },
          },
        ],
      },
    };

    const token = signGoogleJwt(claims, sa.private_key);
    const saveUrl = `https://pay.google.com/gp/v/save/${token}`;
    res.json({ saveUrl });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to generate Google Wallet pass", detail: err?.message });
  }
});

// Scoped: staff need canManageUsers to list/view users
router.get("/users", requirePermission("canManageUsers"), async (req, res): Promise<void> => {
  const query = ListUsersQueryParams.safeParse(req.query);
  let users = await db.select().from(usersTable).orderBy(usersTable.createdAt);
  if (query.success) {
    if (query.data.role) users = users.filter((u) => u.role === query.data.role);
    if (query.data.q) {
      const q = query.data.q.toLowerCase();
      users = users.filter(
        (u) =>
          u.email.toLowerCase().includes(q) ||
          (u.firstName ?? "").toLowerCase().includes(q) ||
          (u.lastName ?? "").toLowerCase().includes(q),
      );
    }
  }
  res.json(ListUsersResponse.parse(users));
});

router.get("/users/:id", requirePermission("canManageUsers"), async (req, res): Promise<void> => {
  const params = GetUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, params.data.id));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(GetUserResponse.parse(user));
});

/**
 * PATCH /users/:id
 * - Role mutation: requires super-admin; writes audit log + role_changed notification
 * - Other field mutations: requires canManageUsers permission
 * - Staff without canManageUsers: blocked at requirePermission gate
 */
router.patch("/users/:id", requirePermission("canManageUsers"), async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const params = GetUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: any = { ...parsed.data, updatedAt: new Date() };
  if (typeof req.body.email === "string" && req.body.email.trim()) {
    updateData.email = req.body.email.toLowerCase().trim();
  }
  const isRoleMutation = parsed.data.role !== undefined;

  if (isRoleMutation) {
    const actor = authed.dbUser;
    if (!actor || actor.role !== "admin" || (actor as any).adminLevel !== "super") {
      res.status(403).json({ error: "Forbidden: role changes require super-admin" });
      return;
    }
  }

  const [before] = await db.select().from(usersTable).where(eq(usersTable.clerkId, params.data.id));
  if (!before) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const [user] = await db
    .update(usersTable)
    .set(updateData)
    .where(eq(usersTable.clerkId, params.data.id))
    .returning();

  if (isRoleMutation) {
    await writeAuditLog(authed.clerkUserId, "user.role_changed", "user", String(user.id), { role: before.role }, { role: user.role });
    if (user.id) {
      await sendNotification({ userId: user.id, channel: "in_app", type: "role_changed", subject: "Your role has been updated", body: `Your account role was changed from ${before.role} to ${user.role}.`, metadata: { changedBy: authed.clerkUserId } });
    }
  }

  if (!isRoleMutation) {
    await writeAuditLog(authed.clerkUserId, "user.profile_updated", "user", String(user.id), before, user);
  }

  res.json(GetUserResponse.parse(user));
});

/**
 * GET /me/registration-history
 * Returns past registrations (leagues, camps, tournaments, drop-ins) for the
 * authenticated user, or a youth player if `youthUserId` is supplied and the
 * caller is an approved guardian of that youth.
 *
 * Query params:
 *   youthUserId  — integer DB user id of a child (guardian check enforced)
 *   page         — 1-indexed page number (default: 1)
 *   limit        — results per page, max 50 (default: 20)
 */
router.get("/me/registration-history", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const page  = Math.max(1, parseInt((req.query.page  as string) || "1",  10));
  const limit = Math.min(50, Math.max(1, parseInt((req.query.limit as string) || "20", 10)));
  const offset = (page - 1) * limit;
  const youthUserIdStr = req.query.youthUserId as string | undefined;

  const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!dbUser) { res.status(401).json({ error: "User not found" }); return; }

  let targetDbUserId: number = dbUser.id;
  let targetClerkId: string  = authed.clerkUserId;

  if (youthUserIdStr) {
    const youthUserId = parseInt(youthUserIdStr, 10);
    if (isNaN(youthUserId)) { res.status(400).json({ error: "Invalid youthUserId" }); return; }

    const [guardianRow] = await db.select().from(guardiansTable).where(
      and(
        eq(guardiansTable.guardianUserId, dbUser.id),
        eq(guardiansTable.youthUserId, youthUserId),
        eq(guardiansTable.status, "approved"),
      )
    );
    if (!guardianRow) { res.status(403).json({ error: "Not authorized to view this player's history" }); return; }

    const [childUser] = await db
      .select({ id: usersTable.id, clerkId: usersTable.clerkId })
      .from(usersTable)
      .where(eq(usersTable.id, youthUserId));
    if (!childUser) { res.status(404).json({ error: "Youth player not found" }); return; }

    targetDbUserId = childUser.id;
    targetClerkId  = childUser.clerkId;
  }

  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  // ── Resolve team membership ───────────────────────────────────────────────
  // teamMembersTable.userId is the player's clerk ID (text).
  // This gives us the team IDs the player is a member of — used to surface
  // league and tournament registrations even when a parent/admin registered
  // on the player's behalf.
  const memberTeamRows = await db
    .select({ teamId: teamMembersTable.teamId })
    .from(teamMembersTable)
    .where(
      and(
        eq(teamMembersTable.userId, targetClerkId),
        eq(teamMembersTable.status, "active"),
      )
    );
  const memberTeamIds = memberTeamRows.map((r) => r.teamId);

  // ── 1. Past league registrations ─────────────────────────────────────────
  // A player's history includes any league registration for a team they are on,
  // even if someone else submitted the registration.
  const leaguePlayerFilter = memberTeamIds.length > 0
    ? or(
        eq(leagueRegistrationsTable.registeredByUserId, targetClerkId),
        inArray(leagueRegistrationsTable.teamId, memberTeamIds),
      )
    : eq(leagueRegistrationsTable.registeredByUserId, targetClerkId);

  const leagueRows = await db
    .select({
      regId:        leagueRegistrationsTable.id,
      status:       leagueRegistrationsTable.status,
      paymentStatus:leagueRegistrationsTable.paymentStatus,
      createdAt:    leagueRegistrationsTable.createdAt,
      teamId:       leagueRegistrationsTable.teamId,
      teamName:     teamsTable.name,
      eventId:      leaguesTable.id,
      eventName:    leaguesTable.name,
      startDate:    leaguesTable.startDate,
      endDate:      leaguesTable.endDate,
      venueName:    venuesTable.name,
    })
    .from(leagueRegistrationsTable)
    .innerJoin(leaguesTable, eq(leagueRegistrationsTable.leagueId, leaguesTable.id))
    .leftJoin(courtsTable,  eq(leaguesTable.courtId, courtsTable.id))
    .leftJoin(venuesTable,  eq(courtsTable.venueId,  venuesTable.id))
    .leftJoin(teamsTable,   eq(leagueRegistrationsTable.teamId, teamsTable.id))
    .where(
      and(
        leaguePlayerFilter,
        or(
          sql`${leaguesTable.endDate} IS NOT NULL AND ${leaguesTable.endDate} < ${today}::date`,
          sql`${leaguesTable.endDate} IS NULL AND ${leaguesTable.startDate} IS NOT NULL AND ${leaguesTable.startDate} < ${today}::date`,
          inArray(leagueRegistrationsTable.status, ["completed", "cancelled"]),
        ),
      )
    );

  // ── 2. Past camp registrations ────────────────────────────────────────────
  const campRows = await db
    .select({
      regId:        campRegistrationsTable.id,
      status:       campRegistrationsTable.status,
      paymentStatus:campRegistrationsTable.paymentStatus,
      createdAt:    campRegistrationsTable.createdAt,
      eventId:      campsTable.id,
      eventName:    campsTable.name,
      startDate:    campsTable.startDate,
      endDate:      campsTable.endDate,
      venueName:    venuesTable.name,
    })
    .from(campRegistrationsTable)
    .innerJoin(campsTable,  eq(campRegistrationsTable.campId, campsTable.id))
    .leftJoin(courtsTable,  eq(campsTable.courtId,  courtsTable.id))
    .leftJoin(venuesTable,  eq(courtsTable.venueId, venuesTable.id))
    .where(
      and(
        or(
          eq(campRegistrationsTable.userId, targetDbUserId),
          eq(campRegistrationsTable.playerUserId, targetDbUserId),
        ),
        or(
          sql`${campsTable.endDate} IS NOT NULL AND ${campsTable.endDate} < ${today}::date`,
          sql`${campsTable.endDate} IS NULL AND ${campsTable.startDate} IS NOT NULL AND ${campsTable.startDate} < ${today}::date`,
          inArray(campRegistrationsTable.status, ["completed", "cancelled"]),
        ),
      )
    );
  // Deduplicate (a user can appear as both userId and playerUserId)
  const seenCampRegIds = new Set<number>();
  const dedupedCampRows = campRows.filter((r) => { if (seenCampRegIds.has(r.regId)) return false; seenCampRegIds.add(r.regId); return true; });

  // ── 3. Past tournament registrations ─────────────────────────────────────
  // A player's history includes any tournament registration for a team they are
  // on, even if someone else (parent, admin, captain) submitted the registration.
  const tournamentPlayerFilter = memberTeamIds.length > 0
    ? or(
        eq(tournamentRegistrationsTable.registeredByUserId, targetDbUserId),
        inArray(tournamentRegistrationsTable.teamId, memberTeamIds),
      )
    : eq(tournamentRegistrationsTable.registeredByUserId, targetDbUserId);

  const tournamentRows = await db
    .select({
      regId:        tournamentRegistrationsTable.id,
      status:       tournamentRegistrationsTable.status,
      paymentStatus:tournamentRegistrationsTable.paymentStatus,
      createdAt:    tournamentRegistrationsTable.createdAt,
      teamId:       tournamentRegistrationsTable.teamId,
      teamName:     teamsTable.name,
      eventId:      tournamentsTable.id,
      eventName:    tournamentsTable.name,
      startDate:    tournamentsTable.startDate,
      endDate:      tournamentsTable.endDate,
      venueName:    venuesTable.name,
    })
    .from(tournamentRegistrationsTable)
    .innerJoin(tournamentsTable, eq(tournamentRegistrationsTable.tournamentId, tournamentsTable.id))
    .leftJoin(courtsTable,  eq(tournamentsTable.courtId, courtsTable.id))
    .leftJoin(venuesTable,  eq(courtsTable.venueId,      venuesTable.id))
    .leftJoin(teamsTable,   eq(tournamentRegistrationsTable.teamId, teamsTable.id))
    .where(
      and(
        tournamentPlayerFilter,
        or(
          sql`${tournamentsTable.endDate} IS NOT NULL AND ${tournamentsTable.endDate} < ${today}::date`,
          sql`${tournamentsTable.endDate} IS NULL AND ${tournamentsTable.startDate} IS NOT NULL AND ${tournamentsTable.startDate} < ${today}::date`,
          inArray(tournamentRegistrationsTable.status, ["completed", "cancelled"]),
        ),
      )
    );

  // ── 4. Past drop-in spots ─────────────────────────────────────────────────
  const spotRows = await db
    .select({
      regId:        spotsTable.id,
      status:       spotsTable.status,
      paymentStatus:spotsTable.paymentStatus,
      createdAt:    spotsTable.createdAt,
      eventId:      dropinsTable.id,
      eventName:    dropinsTable.name,
      startsAt:     dropinsTable.startsAt,
      venueName:    venuesTable.name,
    })
    .from(spotsTable)
    .innerJoin(dropinsTable, and(
      eq(spotsTable.entityId,   dropinsTable.id),
      eq(spotsTable.entityType, "dropin"),
    ))
    .leftJoin(courtsTable, eq(dropinsTable.courtId, courtsTable.id))
    .leftJoin(venuesTable, eq(courtsTable.venueId,  venuesTable.id))
    .where(
      and(
        eq(spotsTable.userId, targetDbUserId),
        or(
          sql`${dropinsTable.startsAt} < NOW()`,
          eq(spotsTable.status, "cancelled"),
        ),
      )
    );

  // ── Normalize into a unified list ─────────────────────────────────────────
  type HistoryItem = {
    id:           string;
    type:         "league" | "camp" | "tournament" | "dropin";
    eventId:      number;
    eventName:    string | null;
    startDate:    string | null;
    endDate:      string | null;
    venueName:    string | null;
    teamId:       number | null;
    teamName:     string | null;
    status:       string;
    paymentStatus:string;
    createdAt:    Date;
  };

  const items: HistoryItem[] = [
    ...leagueRows.map((r) => ({
      id:           `league-${r.regId}`,
      type:         "league" as const,
      eventId:      r.eventId,
      eventName:    r.eventName,
      startDate:    r.startDate,
      endDate:      r.endDate,
      venueName:    r.venueName ?? null,
      teamId:       r.teamId ?? null,
      teamName:     r.teamName ?? null,
      status:       r.status,
      paymentStatus:r.paymentStatus,
      createdAt:    r.createdAt,
    })),
    ...dedupedCampRows.map((r) => ({
      id:           `camp-${r.regId}`,
      type:         "camp" as const,
      eventId:      r.eventId,
      eventName:    r.eventName,
      startDate:    r.startDate,
      endDate:      r.endDate,
      venueName:    r.venueName ?? null,
      teamId:       null,
      teamName:     null,
      status:       r.status,
      paymentStatus:r.paymentStatus,
      createdAt:    r.createdAt,
    })),
    ...tournamentRows.map((r) => ({
      id:           `tournament-${r.regId}`,
      type:         "tournament" as const,
      eventId:      r.eventId,
      eventName:    r.eventName,
      startDate:    r.startDate,
      endDate:      r.endDate,
      venueName:    r.venueName ?? null,
      teamId:       r.teamId ?? null,
      teamName:     r.teamName ?? null,
      status:       r.status,
      paymentStatus:r.paymentStatus,
      createdAt:    r.createdAt,
    })),
    ...spotRows.map((r) => ({
      id:           `dropin-${r.regId}`,
      type:         "dropin" as const,
      eventId:      r.eventId,
      eventName:    r.eventName,
      startDate:    r.startsAt ? r.startsAt.toISOString().split("T")[0] : null,
      endDate:      null,
      venueName:    r.venueName ?? null,
      teamId:       null,
      teamName:     null,
      status:       r.status,
      paymentStatus:r.paymentStatus,
      createdAt:    r.createdAt,
    })),
  ];

  // Sort newest-first by the event's start date, fallback to createdAt
  items.sort((a, b) => {
    const aDate = a.startDate ? new Date(a.startDate).getTime() : a.createdAt.getTime();
    const bDate = b.startDate ? new Date(b.startDate).getTime() : b.createdAt.getTime();
    return bDate - aDate;
  });

  const total = items.length;
  const paged = items.slice(offset, offset + limit);

  res.json({ total, page, limit, items: paged });
});

export default router;
