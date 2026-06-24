import { Router, type IRouter } from "express";
import { db, waiverTemplatesTable, waiverSignaturesTable, usersTable, guardiansTable } from "@workspace/db";
import { eq, desc, and, isNull } from "drizzle-orm";
import { requireAuth, requireAdmin, requirePermission, type AuthedRequest } from "../middlewares/auth";

const router: IRouter = Router();

const LIABILITY_TEXT_SEED = `RELEASE AND WAIVER OF LIABILITY, ASSUMPTION OF RISK, AND INDEMNITY AGREEMENT

In consideration of being permitted to participate in futsal, recreational soccer, and related athletic activities ("Activities") organized by PlayOn Sports / Alumni Center ("PlayOn"), I, the undersigned participant (or the parent or legal guardian signing on behalf of a minor), agree to the following:

1. ASSUMPTION OF RISK. I acknowledge that participation in the Activities involves inherent risks of physical injury, including but not limited to sprains, fractures, concussions, and other bodily harm. I voluntarily and knowingly assume all such risks.

2. RELEASE OF LIABILITY. To the fullest extent permitted by law, I hereby release, discharge, and covenant not to sue PlayOn, Alumni Center, their respective officers, directors, employees, volunteers, agents, and affiliates (collectively, "Released Parties") from any and all claims, demands, losses, damages, costs, and causes of action arising out of or related to my (or my child's) participation in the Activities, whether caused by the negligence of the Released Parties or otherwise.

3. INDEMNIFICATION. I agree to indemnify and hold harmless the Released Parties from any loss, liability, damage, or cost they may incur arising from my (or my child's) participation in the Activities.

4. MEDICAL AUTHORIZATION. In the event of an emergency, I authorize PlayOn personnel to secure medical treatment for me (or my child) and agree to be responsible for all related costs.

5. PHOTO/VIDEO CONSENT. I consent to the use of photographs and video footage taken during Activities for PlayOn's promotional and educational purposes, without compensation.

6. ACKNOWLEDGMENT. I have carefully read this Agreement, understand its terms, and sign it freely. I acknowledge this waiver is binding upon my heirs and legal assigns. This Agreement shall be governed by applicable state law.`;

async function getDbUser(clerkId: string) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  return user ?? null;
}

function addOneYear(date: Date): Date {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + 1);
  return d;
}

// ── Public: get active waiver template ───────────────────────────────────────

router.get("/waivers/active", async (_req, res): Promise<void> => {
  const [template] = await db
    .select()
    .from(waiverTemplatesTable)
    .where(eq(waiverTemplatesTable.isActive, true))
    .orderBy(desc(waiverTemplatesTable.version))
    .limit(1);

  if (!template) {
    res.status(404).json({ error: "No active waiver template found" });
    return;
  }

  res.json(template);
});

// ── Seed: ensure at least one active waiver exists (idempotent) ────────────────

export async function seedWaiver(): Promise<void> {
  const [existing] = await db
    .select()
    .from(waiverTemplatesTable)
    .orderBy(desc(waiverTemplatesTable.version))
    .limit(1);

  if (existing) return;

  await db
    .insert(waiverTemplatesTable)
    .values({
      name: "PlayOn Liability Waiver & Release",
      version: 1,
      body: LIABILITY_TEXT_SEED,
      applicableTo: "all",
      isActive: true,
    });
}

router.post("/waivers/seed", requireAdmin, async (_req, res): Promise<void> => {
  const [existing] = await db
    .select()
    .from(waiverTemplatesTable)
    .orderBy(desc(waiverTemplatesTable.version))
    .limit(1);

  if (existing) {
    res.json({ seeded: false, template: existing });
    return;
  }

  const [template] = await db
    .insert(waiverTemplatesTable)
    .values({
      name: "PlayOn Liability Waiver & Release",
      version: 1,
      body: LIABILITY_TEXT_SEED,
      applicableTo: "all",
      isActive: true,
    })
    .returning();

  res.status(201).json({ seeded: true, template });
});

// ── Authenticated: record a standalone waiver signature ───────────────────────
// Used when a user renews their waiver independently of a profile-create flow.
// If youthUserId is provided, the caller must be an approved guardian for that child.

router.post("/me/waiver-signature", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const body = req.body ?? {};
  const { templateId, signatureData, signatureType = "typed", youthUserId } = body;

  if (!templateId) {
    res.status(400).json({ error: "templateId is required" });
    return;
  }
  if (!signatureData) {
    res.status(400).json({ error: "signatureData is required" });
    return;
  }

  const dbUser = await getDbUser(authed.clerkUserId);
  if (!dbUser) {
    res.status(404).json({ error: "User not found — visit /api/me first" });
    return;
  }

  // If signing on behalf of a child, verify the caller is an approved guardian for that child
  let resolvedYouthUserId: number | null = null;
  if (youthUserId) {
    const youthId = Number(youthUserId);
    if (isNaN(youthId)) {
      res.status(400).json({ error: "Invalid youthUserId" });
      return;
    }
    const [guardianLink] = await db
      .select()
      .from(guardiansTable)
      .where(
        and(
          eq(guardiansTable.guardianUserId, dbUser.id),
          eq(guardiansTable.youthUserId, youthId),
          eq(guardiansTable.status, "approved"),
        ),
      );
    if (!guardianLink) {
      res.status(403).json({ error: "You are not an approved guardian for this child account" });
      return;
    }
    resolvedYouthUserId = youthId;
  }

  const [template] = await db
    .select()
    .from(waiverTemplatesTable)
    .where(eq(waiverTemplatesTable.id, Number(templateId)));

  if (!template) {
    res.status(404).json({ error: "Waiver template not found" });
    return;
  }

  const now = new Date();
  const expiresAt = addOneYear(now);

  const [signature] = await db
    .insert(waiverSignaturesTable)
    .values({
      templateId: template.id,
      userId: dbUser.id,
      youthUserId: resolvedYouthUserId,
      signedAt: now,
      expiresAt,
      signatureData,
      signatureType: signatureType === "drawn" ? "drawn" : "typed",
      ipAddress: req.ip ?? req.headers["x-forwarded-for"]?.toString() ?? null,
      userAgent: req.headers["user-agent"] ?? null,
    })
    .returning();

  res.status(201).json({ ...signature, expiresAt: signature.expiresAt?.toISOString() });
});

// ── Authenticated: get waiver status ───────────────────────────────────────────
// Without query params: returns status for the calling user's OWN signature
//   (youthUserId IS NULL — excludes signatures the user made for their children).
// With ?youthUserId=:id: returns status for that child, verifying the caller is
//   an approved guardian for that child.

router.get("/me/waiver-status", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const dbUser = await getDbUser(authed.clerkUserId);
  if (!dbUser) {
    res.json({ hasSigned: false, isExpired: true, signature: null });
    return;
  }

  const now = new Date();
  const rawYouthUserId = (req.query as any).youthUserId;

  if (rawYouthUserId != null) {
    // ── Guardian checking waiver coverage for a specific child ────────────────
    const youthId = Number(rawYouthUserId);
    if (isNaN(youthId)) {
      res.status(400).json({ error: "Invalid youthUserId" });
      return;
    }

    // Verify caller is an approved guardian for this child
    const [guardianLink] = await db
      .select()
      .from(guardiansTable)
      .where(
        and(
          eq(guardiansTable.guardianUserId, dbUser.id),
          eq(guardiansTable.youthUserId, youthId),
          eq(guardiansTable.status, "approved"),
        ),
      );
    if (!guardianLink) {
      res.status(403).json({ error: "You are not an approved guardian for this child account" });
      return;
    }

    // Find the most recent active guardian signature for this child
    const [sig] = await db
      .select()
      .from(waiverSignaturesTable)
      .where(
        and(
          eq(waiverSignaturesTable.userId, dbUser.id),
          eq(waiverSignaturesTable.youthUserId, youthId),
        ),
      )
      .orderBy(desc(waiverSignaturesTable.signedAt))
      .limit(1);

    if (!sig) {
      res.json({ hasSigned: false, isExpired: true, signature: null, youthUserId: youthId });
      return;
    }

    const isExpired = sig.expiresAt ? sig.expiresAt < now : false;
    res.json({ hasSigned: true, isExpired, signature: sig, youthUserId: youthId });
    return;
  }

  // ── Self-check: only signatures where youthUserId IS NULL ─────────────────
  const [sig] = await db
    .select()
    .from(waiverSignaturesTable)
    .where(
      and(
        eq(waiverSignaturesTable.userId, dbUser.id),
        isNull(waiverSignaturesTable.youthUserId),
      ),
    )
    .orderBy(desc(waiverSignaturesTable.signedAt))
    .limit(1);

  if (!sig) {
    res.json({ hasSigned: false, isExpired: true, signature: null });
    return;
  }

  const isExpired = sig.expiresAt ? sig.expiresAt < now : false;
  res.json({ hasSigned: true, isExpired, signature: sig });
});

// ── Admin: list all waiver templates ──────────────────────────────────────────

router.get("/admin/waivers", requirePermission("canManageUsers"), async (_req, res): Promise<void> => {
  const templates = await db
    .select()
    .from(waiverTemplatesTable)
    .orderBy(desc(waiverTemplatesTable.version));
  res.json(templates);
});

// ── Admin: create a new waiver version ────────────────────────────────────────
// Publishing a new version deactivates the old one but does not delete it.
// Existing signatures always reference the version they were signed against.

router.post("/admin/waivers", requirePermission("canManageUsers"), async (req, res): Promise<void> => {
  const { name, body, applicableTo = "all" } = req.body ?? {};
  if (!name || !body) {
    res.status(400).json({ error: "name and body are required" });
    return;
  }

  const [latest] = await db
    .select()
    .from(waiverTemplatesTable)
    .orderBy(desc(waiverTemplatesTable.version))
    .limit(1);

  const nextVersion = (latest?.version ?? 0) + 1;

  // Deactivate all existing templates
  await db
    .update(waiverTemplatesTable)
    .set({ isActive: false })
    .where(eq(waiverTemplatesTable.isActive, true));

  const [template] = await db
    .insert(waiverTemplatesTable)
    .values({ name, version: nextVersion, body, applicableTo, isActive: true })
    .returning();

  res.status(201).json(template);
});

// ── Admin: update non-body metadata only — templates are immutable once created ─
// The body is intentionally excluded from editable fields to preserve signature
// integrity: past signatures always reference the exact text that was signed.
// To revise the text, publish a new version via POST /admin/waivers.

router.patch("/admin/waivers/:id", requirePermission("canManageUsers"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { name, applicableTo, isActive } = req.body ?? {};

  const [existing] = await db
    .select()
    .from(waiverTemplatesTable)
    .where(eq(waiverTemplatesTable.id, id));

  if (!existing) {
    res.status(404).json({ error: "Waiver template not found" });
    return;
  }

  const updates: Record<string, any> = {};
  if (name !== undefined) updates.name = name;
  if (applicableTo !== undefined) updates.applicableTo = applicableTo;

  if (isActive === true && !existing.isActive) {
    // Re-publishing an archived version — deactivate all others first
    await db
      .update(waiverTemplatesTable)
      .set({ isActive: false })
      .where(eq(waiverTemplatesTable.isActive, true));
    updates.isActive = true;
  }

  const [updated] = await db
    .update(waiverTemplatesTable)
    .set(updates)
    .where(eq(waiverTemplatesTable.id, id))
    .returning();

  res.json(updated);
});

// ── Admin: list all signatures with user info ─────────────────────────────────

router.get("/admin/waivers/signatures", requirePermission("canManageUsers"), async (_req, res): Promise<void> => {
  const sigs = await db
    .select({
      id: waiverSignaturesTable.id,
      templateId: waiverSignaturesTable.templateId,
      userId: waiverSignaturesTable.userId,
      youthUserId: waiverSignaturesTable.youthUserId,
      signedAt: waiverSignaturesTable.signedAt,
      expiresAt: waiverSignaturesTable.expiresAt,
      signatureType: waiverSignaturesTable.signatureType,
      ipAddress: waiverSignaturesTable.ipAddress,
    })
    .from(waiverSignaturesTable)
    .orderBy(desc(waiverSignaturesTable.signedAt));

  const enriched = await Promise.all(sigs.map(async (s) => {
    let user = null;
    let youthUser = null;

    if (s.userId) {
      const [u] = await db
        .select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email })
        .from(usersTable)
        .where(eq(usersTable.id, s.userId));
      user = u ?? null;
    }
    if (s.youthUserId) {
      const [u] = await db
        .select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName })
        .from(usersTable)
        .where(eq(usersTable.id, s.youthUserId));
      youthUser = u ?? null;
    }

    const [tpl] = await db
      .select({ version: waiverTemplatesTable.version, name: waiverTemplatesTable.name })
      .from(waiverTemplatesTable)
      .where(eq(waiverTemplatesTable.id, s.templateId));

    const now = new Date();
    const isExpired = s.expiresAt ? s.expiresAt < now : false;

    return {
      ...s,
      user,
      youthUser,
      templateVersion: tpl?.version ?? null,
      templateName: tpl?.name ?? null,
      isExpired,
    };
  }));

  res.json(enriched);
});

export { addOneYear };
export default router;
