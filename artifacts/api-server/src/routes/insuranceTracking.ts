/**
 * Insurance and clearance tracking.
 * - Venue-level facility insurance (policy number, provider, expiry)
 * - Staff/coach background-check and certification expiry warnings
 */
import { Router, type IRouter } from "express";
import { db, venuesTable, staffProfilesTable, usersTable, auditLogTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin, requireSuperAdmin, type AuthedRequest } from "../middlewares/auth";

const router: IRouter = Router();

const EXPIRY_WARNING_DAYS = 60;

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.floor((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function expiryBadge(days: number | null): "ok" | "warning" | "expired" | "unknown" {
  if (days === null) return "unknown";
  if (days < 0) return "expired";
  if (days <= EXPIRY_WARNING_DAYS) return "warning";
  return "ok";
}

/** GET /admin/insurance — overview: venue insurance + all staff clearance status */
router.get("/admin/insurance", requireAdmin, async (_req, res): Promise<void> => {
  const [venues, staffRows] = await Promise.all([
    db.select().from(venuesTable).orderBy(venuesTable.name),
    db
      .select({
        profileId: staffProfilesTable.id,
        userId: staffProfilesTable.userId,
        title: staffProfilesTable.title,
        backgroundCheckStatus: staffProfilesTable.backgroundCheckStatus,
        backgroundCheckDate: staffProfilesTable.backgroundCheckDate,
        backgroundCheckExpiry: (staffProfilesTable as any).backgroundCheckExpiry,
        certificationExpiry: (staffProfilesTable as any).certificationExpiry,
        certifications: staffProfilesTable.certifications,
        isActive: staffProfilesTable.isActive,
        userFirstName: usersTable.firstName,
        userLastName: usersTable.lastName,
        userEmail: usersTable.email,
      })
      .from(staffProfilesTable)
      .innerJoin(usersTable, eq(staffProfilesTable.userId, usersTable.id))
      .orderBy(usersTable.firstName),
  ]);

  const venuesWithStatus = venues.map((v: any) => {
    const days = daysUntil(v.insuranceExpiry);
    return { ...v, insuranceExpiryDays: days, insuranceBadge: expiryBadge(days) };
  });

  const staffWithStatus = staffRows.map((s: any) => {
    const bgDays = daysUntil(s.backgroundCheckExpiry);
    const certDays = daysUntil(s.certificationExpiry);
    return {
      ...s,
      backgroundCheckExpiryDays: bgDays,
      backgroundCheckBadge: expiryBadge(bgDays),
      certificationExpiryDays: certDays,
      certificationBadge: expiryBadge(certDays),
    };
  });

  const warnings = [
    ...venuesWithStatus.filter((v: any) => v.insuranceBadge !== "ok" && v.insuranceBadge !== "unknown"),
    ...staffWithStatus.filter((s: any) => s.backgroundCheckBadge !== "ok" || s.certificationBadge !== "ok"),
  ];

  res.json({ venues: venuesWithStatus, staff: staffWithStatus, warnings });
});

/** PATCH /admin/venues/:id/insurance — update a venue's insurance info */
router.patch("/admin/venues/:id/insurance", requireSuperAdmin, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid venue id" }); return; }

  const { insuranceProvider, insurancePolicyNumber, insuranceExpiry } = req.body as {
    insuranceProvider?: string;
    insurancePolicyNumber?: string;
    insuranceExpiry?: string;
  };

  const [before] = await db.select().from(venuesTable).where(eq(venuesTable.id, id));
  if (!before) { res.status(404).json({ error: "Venue not found" }); return; }

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (insuranceProvider !== undefined) updates.insuranceProvider = insuranceProvider;
  if (insurancePolicyNumber !== undefined) updates.insurancePolicyNumber = insurancePolicyNumber;
  if (insuranceExpiry !== undefined) updates.insuranceExpiry = insuranceExpiry;

  const [updated] = await db.update(venuesTable).set(updates).where(eq(venuesTable.id, id)).returning();

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "venue_insurance_updated",
    entityType: "venue",
    entityId: String(id),
    before: JSON.stringify({ insuranceProvider: (before as any).insuranceProvider, insurancePolicyNumber: (before as any).insurancePolicyNumber, insuranceExpiry: (before as any).insuranceExpiry }),
    after: JSON.stringify({ insuranceProvider, insurancePolicyNumber, insuranceExpiry }),
  });

  res.json(updated);
});

/** PATCH /admin/staff-profiles/:id/clearance — update background check and certification expiry */
router.patch("/admin/staff-profiles/:id/clearance", requireSuperAdmin, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid profile id" }); return; }

  const { backgroundCheckStatus, backgroundCheckDate, backgroundCheckExpiry, certificationExpiry, certifications } = req.body as {
    backgroundCheckStatus?: string;
    backgroundCheckDate?: string;
    backgroundCheckExpiry?: string;
    certificationExpiry?: string;
    certifications?: string[];
  };

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (backgroundCheckStatus !== undefined) updates.backgroundCheckStatus = backgroundCheckStatus;
  if (backgroundCheckDate !== undefined) updates.backgroundCheckDate = backgroundCheckDate;
  if (backgroundCheckExpiry !== undefined) updates.backgroundCheckExpiry = backgroundCheckExpiry;
  if (certificationExpiry !== undefined) updates.certificationExpiry = certificationExpiry;
  if (certifications !== undefined) updates.certifications = certifications;

  const [updated] = await db.update(staffProfilesTable).set(updates).where(eq(staffProfilesTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Staff profile not found" }); return; }

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "staff_clearance_updated",
    entityType: "staff_profile",
    entityId: String(id),
    notes: JSON.stringify({ backgroundCheckStatus, backgroundCheckExpiry, certificationExpiry }),
  });

  res.json(updated);
});

export default router;
