import { Router, type IRouter } from "express";
import {
  db, campsTable, campDaysTable, campRegistrationsTable,
  assignmentsTable, staffProfilesTable, usersTable,
  waiverTemplatesTable, pricingRulesTable, checkInsTable, auditLogTable,
  guardiansTable, ageGroupWaiversTable, isEventActive,
} from "@workspace/db";
import { checkUsysAgeEligibility } from "../lib/usysAgeEligibility";
import { eq, and, desc, asc, sql, isNotNull } from "drizzle-orm";
import { checkCourtConflict, easternToUtc } from "../services/courtConflict.js";
import { sendNotificationWithPreferences } from "../services/notifications";
import { requireAuth, requirePermission, requireAdmin, requireSuperAdmin, hasPermission, AuthedRequest } from "../middlewares/auth";
import { getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";

const router: IRouter = Router();

const normalizeAgeGroup = (raw: unknown): string[] => {
  if (Array.isArray(raw)) return (raw as string[]).filter((v) => typeof v === "string" && v.length > 0);
  if (typeof raw === "string" && raw.length > 0) return [raw];
  return ["adult"];
};
const parseCamp = (c: any) => ({ ...c, price: Number(c.price), ageGroup: normalizeAgeGroup(c.ageGroup) });

async function getDbUserFromClerk(clerkId: string) {
  const [u] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  return u ?? null;
}

async function writeAuditLog(entry: { action: string; entityType: string; entityId: number; before?: any; after?: any; notes?: string }) {
  await db.insert(auditLogTable).values({ ...entry, createdAt: new Date() } as typeof auditLogTable.$inferInsert).catch(() => {});
}

// ─── Age eligibility ──────────────────────────────────────────────────────────

function isYouthCamp(ageGroups: string[]) {
  return ageGroups.some(ag => ag !== "adult");
}

async function getPlayerWaivedGroups(playerUserId: number): Promise<string[]> {
  const waivers = await db.select().from(ageGroupWaiversTable).where(
    and(eq(ageGroupWaiversTable.playerId, playerUserId), eq(ageGroupWaiversTable.status, "approved"))
  );
  return waivers.map((w) => w.ageGroup);
}

// ─── Pricing ──────────────────────────────────────────────────────────────────

function resolveCampPrice(camp: any, pricingRule: any | null, registeredAt: Date, siblingNumber: number): number {
  if (!pricingRule) return Number(camp.price);

  let base = Number(pricingRule.basePrice ?? camp.price);

  if (pricingRule.earlyBirdPrice && pricingRule.earlyBirdCutoff) {
    const cutoff = new Date(pricingRule.earlyBirdCutoff);
    if (registeredAt <= cutoff) base = Number(pricingRule.earlyBirdPrice);
  }

  if (pricingRule.lateFee && camp.registrationDeadline) {
    const deadline = new Date(camp.registrationDeadline);
    if (registeredAt > deadline) base += Number(pricingRule.lateFee);
  }

  if (siblingNumber > 1 && pricingRule.siblingDiscountPct) {
    const discountPct = Number(pricingRule.siblingDiscountPct) / 100;
    base = base * (1 - discountPct);
  }

  return Math.max(0, Math.round(base * 100) / 100);
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

/** Guard allowing admin, canManageCamps staff, or an assigned coach for campId. */
async function requireCampStaffOrCoach(campId: number, req: Request, res: Response, next: NextFunction): Promise<void> {
  const clerkId = (req as AuthedRequest).clerkUserId;
  if (!clerkId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  // Super-admin passes always
  if (user.role === "admin") {
    (req as AuthedRequest).dbUser = user;
    next();
    return;
  }

  // Staff with canManageCamps permission
  if (user.role === "staff") {
    const permitted = await hasPermission(clerkId, "canManageCamps");
    if (permitted) {
      (req as AuthedRequest).dbUser = user;
      next();
      return;
    }
  }

  // Assigned coach for this specific camp
  const [assignment] = await db.select().from(assignmentsTable).where(
    and(
      eq(assignmentsTable.entityType, "camp"),
      eq(assignmentsTable.entityId, campId),
      eq(assignmentsTable.staffUserId, user.id),
    )
  );
  if (assignment) {
    (req as AuthedRequest).dbUser = user;
    next();
    return;
  }

  res.status(403).json({ error: "Forbidden: requires camp staff or assigned coach access" });
}

function enrichReg(r: any) {
  return {
    ...r,
    pricePaid: Number(r.pricePaid),
    depositAmount: r.depositAmount != null ? Number(r.depositAmount) : null,
    balanceDue: r.balanceDue != null ? Number(r.balanceDue) : null,
  };
}

// ─── Waitlist auto-promotion helper ──────────────────────────────────────────
// Finds the lowest-position waitlisted registration for a camp, promotes it to
// confirmed, renumbers remaining waitlisted entries, and sends a notification.
async function promoteNextWaitlistedCamp(campId: number): Promise<any | null> {
  const [next] = await db
    .select()
    .from(campRegistrationsTable)
    .where(
      and(
        eq(campRegistrationsTable.campId, campId),
        eq(campRegistrationsTable.status, "waitlisted"),
        isNotNull(campRegistrationsTable.waitlistPosition),
      )
    )
    .orderBy(asc(campRegistrationsTable.waitlistPosition))
    .limit(1);

  if (!next) return null;

  const promotedPosition = next.waitlistPosition ?? 0;

  const [promoted] = await db
    .update(campRegistrationsTable)
    .set({ status: "confirmed", waitlistPosition: null, updatedAt: new Date() } as Partial<typeof campRegistrationsTable.$inferInsert>)
    .where(eq(campRegistrationsTable.id, next.id))
    .returning();

  // Increment participantsRegistered
  await db.update(campsTable).set({
    participantsRegistered: sql`${campsTable.participantsRegistered} + 1`,
    updatedAt: new Date(),
  } as Partial<typeof campsTable.$inferInsert>).where(eq(campsTable.id, campId));

  // Renumber remaining waitlisted entries
  await db.execute(sql`
    UPDATE camp_registrations
    SET waitlist_position = waitlist_position - 1
    WHERE camp_id = ${campId}
      AND status = 'waitlisted'
      AND waitlist_position > ${promotedPosition}
  `);

  // Notify the promoted player
  const [camp] = await db.select().from(campsTable).where(eq(campsTable.id, campId));
  if (camp && promoted.userId) {
    await sendNotificationWithPreferences({
      userId: promoted.userId,
      type: "waitlist_movement",
      subject: `You're off the waitlist for ${camp.name}!`,
      body: `A spot opened up and you've been confirmed for ${camp.name}. Check your dashboard for details.`,
    }).catch(() => {});
  }

  return enrichReg(promoted);
}

/** Redact PII for non-admin users. Coaches/staff see name only (not email/DOB). */
function redactPlayerForRole(player: any, requestingRole: string): any {
  if (!player) return null;
  if (requestingRole === "admin") return player; // full PII
  // Coaches and staff: name + qrCode only — no email/DOB/phone
  return {
    id: player.id,
    firstName: player.firstName,
    lastName: player.lastName,
    qrCode: player.qrCode,
  };
}

// ─── Camp Wizard Drafts (in-memory, no schema change) ─────────────────────────
// Drafts are stored server-side in memory so they survive page navigations but
// are intentionally ephemeral (cleared on API restart). localStorage is the
// primary persistence; this is a best-effort cross-device fallback.

interface CampDraftEntry {
  data: any;
  updatedAt: Date;
  /** When set, the scheduler will auto-publish this draft at this time. */
  scheduledPublishAt?: Date;
}

const campDraftStore = new Map<string, CampDraftEntry>();

function generateDraftId(): string {
  return `cdraft_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/** Publish a draft camp from the store (used by scheduler and manual publish). */
async function publishDraftCamp(id: string, draft: CampDraftEntry): Promise<void> {
  const data = draft.data;
  if (!data?.name || !data?.courtId) throw new Error("Draft missing required fields");
  const ageGroupArr = normalizeAgeGroup(data.ageGroup);
  const sortedDays = [...(data.days ?? [])].sort((a: any, b: any) => a.date.localeCompare(b.date));
  const startDate = sortedDays[0]?.date ?? null;
  const endDate = sortedDays[sortedDays.length - 1]?.date ?? null;

  const [camp] = await db.insert(campsTable).values({
    name: data.name,
    ageGroup: ageGroupArr,
    gender: data.gender || null,
    courtId: Number(data.courtId),
    status: "upcoming",
    price: String(data.price ?? "0"),
    maxParticipants: Number(data.maxParticipants ?? 20),
    registrationOpen: Boolean(data.registrationOpen ?? true),
    registrationDeadline: data.registrationDeadline ? new Date(data.registrationDeadline) : null,
    startDate,
    endDate,
    startsAt: startDate && sortedDays[0]?.startTime ? new Date(`${startDate}T${sortedDays[0].startTime}:00`) : null,
    endsAt: endDate && sortedDays[sortedDays.length - 1]?.endTime ? new Date(`${endDate}T${sortedDays[sortedDays.length - 1].endTime}:00`) : null,
    description: data.description || null,
    imageUrl: data.imageUrl || null,
  } as typeof campsTable.$inferInsert).returning();

  if (camp && Array.isArray(data.days) && data.days.length > 0) {
    await Promise.all(data.days.map((d: any) =>
      db.insert(campDaysTable).values({
        campId: camp.id,
        date: d.date,
        startTime: d.startTime,
        endTime: d.endTime,
        notes: d.notes || null,
      }).catch(() => {})
    ));
  }

  // Persist staff assignments — matches the immediate-publish path (POST /camps/:id/coaches):
  // assignmentsTable uses entityType + entityId, not a campId column.
  if (camp && Array.isArray(data.coaches) && data.coaches.length > 0) {
    const coachErrors: Error[] = [];
    await Promise.all(data.coaches.map((c: any) =>
      db.insert(assignmentsTable).values({
        staffUserId: Number(c.staffUserId),
        entityType: "camp",
        entityId: camp.id,
        role: c.role ?? "coach",
        compensationAmount: c.compensationAmount ? String(c.compensationAmount) : null,
      } as typeof assignmentsTable.$inferInsert).catch((e: Error) => { coachErrors.push(e); })
    ));
    if (coachErrors.length > 0) {
      throw new Error(`Camp published but ${coachErrors.length} coach assignment(s) failed: ${coachErrors[0].message}`);
    }
  }

  campDraftStore.delete(id);
}

// Scheduler: every 30s, auto-publish any drafts whose scheduledPublishAt has passed
setInterval(async () => {
  const now = new Date();
  for (const [id, draft] of campDraftStore.entries()) {
    if (!draft.scheduledPublishAt || draft.scheduledPublishAt > now) continue;
    await publishDraftCamp(id, draft).catch(() => {
      // Leave in store for retry on next tick
    });
  }
}, 30_000);

router.post("/camps/drafts", requirePermission("canManageCamps"), async (req, res): Promise<void> => {
  const id = generateDraftId();
  const { scheduledPublishAt, ...data } = req.body;
  const entry: CampDraftEntry = {
    data,
    updatedAt: new Date(),
    ...(scheduledPublishAt ? { scheduledPublishAt: new Date(scheduledPublishAt) } : {}),
  };
  campDraftStore.set(id, entry);
  res.status(201).json({ id, data, scheduledPublishAt: entry.scheduledPublishAt ?? null });
});

router.get("/camps/drafts/:id", requirePermission("canManageCamps"), async (req, res): Promise<void> => {
  const draft = campDraftStore.get(req.params.id);
  if (!draft) { res.status(404).json({ error: "Draft not found or expired" }); return; }
  res.json({ id: req.params.id, data: draft.data, updatedAt: draft.updatedAt, scheduledPublishAt: draft.scheduledPublishAt ?? null });
});

router.patch("/camps/drafts/:id", requirePermission("canManageCamps"), async (req, res): Promise<void> => {
  const { scheduledPublishAt, ...patchData } = req.body;
  if (!campDraftStore.has(req.params.id)) {
    // Auto-create if missing (e.g. server restarted)
    const entry: CampDraftEntry = {
      data: patchData,
      updatedAt: new Date(),
      ...(scheduledPublishAt ? { scheduledPublishAt: new Date(scheduledPublishAt) } : {}),
    };
    campDraftStore.set(req.params.id, entry);
    res.json({ id: req.params.id, data: patchData, scheduledPublishAt: entry.scheduledPublishAt ?? null });
    return;
  }
  const existing = campDraftStore.get(req.params.id)!;
  const updated: CampDraftEntry = {
    data: { ...existing.data, ...patchData },
    updatedAt: new Date(),
    scheduledPublishAt: scheduledPublishAt ? new Date(scheduledPublishAt) : existing.scheduledPublishAt,
  };
  campDraftStore.set(req.params.id, updated);
  res.json({ id: req.params.id, data: updated.data, updatedAt: updated.updatedAt, scheduledPublishAt: updated.scheduledPublishAt ?? null });
});

router.delete("/camps/drafts/:id", requirePermission("canManageCamps"), async (req, res): Promise<void> => {
  campDraftStore.delete(req.params.id);
  res.sendStatus(204);
});

// ─── Camp CRUD ────────────────────────────────────────────────────────────────

router.get("/camps", async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req as any);
  const isAdmin = clerkId ? await hasPermission(clerkId, "canManageCamps") : false;
  let camps = await db.select().from(campsTable).orderBy(asc(campsTable.startDate));
  if (req.query.ageGroup) camps = camps.filter((c) => normalizeAgeGroup(c.ageGroup).includes(req.query.ageGroup as string));
  if (req.query.status) camps = camps.filter((c) => c.status === req.query.status);
  if (!isAdmin) camps = camps.filter((c) => isEventActive(c));
  res.json(camps.map(parseCamp));
});

router.post("/camps", requirePermission("canManageCamps"), async (req, res): Promise<void> => {
  const { name, gender, courtId, status, price, maxParticipants, registrationOpen, registrationDeadline, startDate, endDate, startsAt, endsAt, activeOverride, description, imageUrl, coachName, pricingRuleId } = req.body;
  const ageGroupArr = normalizeAgeGroup(req.body.ageGroup);
  if (!name || !ageGroupArr.length || !courtId) { res.status(400).json({ error: "name, ageGroup (at least one), courtId required" }); return; }
  const [camp] = await db.insert(campsTable).values({
    name, ageGroup: ageGroupArr, gender: gender ?? null, courtId: Number(courtId), status: status ?? "upcoming",
    price: String(price ?? "0"), maxParticipants: Number(maxParticipants ?? 20),
    registrationOpen: Boolean(registrationOpen),
    registrationDeadline: registrationDeadline ? new Date(registrationDeadline) : null,
    startDate: startDate ?? null, endDate: endDate ?? null,
    startsAt: startsAt ? new Date(startsAt) : null,
    endsAt: endsAt ? new Date(endsAt) : null,
    activeOverride: activeOverride ?? null,
    description: description ?? null, imageUrl: imageUrl ?? null,
    coachName: coachName ?? null, pricingRuleId: pricingRuleId ? Number(pricingRuleId) : null,
  } as typeof campsTable.$inferInsert).returning();
  res.status(201).json(parseCamp(camp));
});

router.get("/camps/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [camp] = await db.select().from(campsTable).where(eq(campsTable.id, id));
  if (!camp) { res.status(404).json({ error: "Camp not found" }); return; }
  res.json(parseCamp(camp));
});

router.patch("/camps/:id", requirePermission("canManageCamps"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const allowed = ["name","ageGroup","gender","courtId","status","price","maxParticipants","registrationOpen","registrationDeadline","startDate","endDate","startsAt","endsAt","activeOverride","description","imageUrl","coachName","pricingRuleId"];
  const patch: Record<string, any> = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) {
      if (k === "price") patch[k] = String(req.body[k]);
      else if (["courtId","maxParticipants","pricingRuleId"].includes(k)) patch[k] = Number(req.body[k]);
      else if (k === "registrationOpen") patch[k] = Boolean(req.body[k]);
      else if (k === "registrationDeadline") patch[k] = req.body[k] ? new Date(req.body[k]) : null;
      else if (k === "startsAt") patch[k] = req.body[k] ? new Date(req.body[k]) : null;
      else if (k === "endsAt") patch[k] = req.body[k] ? new Date(req.body[k]) : null;
      else patch[k] = req.body[k];
    }
  }
  const [camp] = await db.update(campsTable).set({ ...patch, updatedAt: new Date() } as Partial<typeof campsTable.$inferInsert>).where(eq(campsTable.id, id)).returning();
  if (!camp) { res.status(404).json({ error: "Camp not found" }); return; }
  res.json(parseCamp(camp));
});

router.delete("/camps/:id", requirePermission("canManageCamps"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [deleted] = await db.delete(campsTable).where(eq(campsTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Camp not found" }); return; }
  res.sendStatus(204);
});

router.patch("/camps/:id/override", requirePermission("canManageCamps"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { activeOverride } = req.body;
  if (activeOverride !== null && activeOverride !== "active" && activeOverride !== "closed") {
    res.status(400).json({ error: "activeOverride must be 'active', 'closed', or null" }); return;
  }
  const [camp] = await db.update(campsTable).set({ activeOverride: activeOverride ?? null, updatedAt: new Date() } as Partial<typeof campsTable.$inferInsert>).where(eq(campsTable.id, id)).returning();
  if (!camp) { res.status(404).json({ error: "Camp not found" }); return; }
  res.json(parseCamp(camp));
});

// ─── Camp Days ────────────────────────────────────────────────────────────────

router.get("/camps/:id/days", async (req, res): Promise<void> => {
  const campId = Number(req.params.id);
  const days = await db.select().from(campDaysTable).where(eq(campDaysTable.campId, campId)).orderBy(asc(campDaysTable.date));
  res.json(days);
});

router.post("/camps/:id/days", requirePermission("canManageCamps"), async (req, res): Promise<void> => {
  const campId = Number(req.params.id);
  const { date, startTime, endTime, notes } = req.body;
  if (!date) { res.status(400).json({ error: "date is required" }); return; }

  const effectiveStart = startTime ?? "09:00";
  const effectiveEnd   = endTime   ?? "12:00";

  const [camp] = await db.select({ courtId: campsTable.courtId }).from(campsTable).where(eq(campsTable.id, campId));
  if (camp?.courtId) {
    const { conflict, reason } = await checkCourtConflict(
      camp.courtId,
      easternToUtc(date, effectiveStart),
      easternToUtc(date, effectiveEnd),
    );
    if (conflict) {
      res.status(409).json({ error: `Cannot add camp day: ${reason}` });
      return;
    }
  }

  const [day] = await db.insert(campDaysTable).values({ campId, date, startTime: effectiveStart, endTime: effectiveEnd, notes: notes ?? null } as typeof campDaysTable.$inferInsert).returning();
  res.status(201).json(day);
});

router.patch("/camps/:id/days/:dayId", requirePermission("canManageCamps"), async (req, res): Promise<void> => {
  const campId = Number(req.params.id);
  const dayId = Number(req.params.dayId);
  const { date, startTime, endTime, notes } = req.body;
  const patch: Record<string, any> = { updatedAt: new Date() };
  if (date !== undefined) patch.date = date;
  if (startTime !== undefined) patch.startTime = startTime;
  if (endTime !== undefined) patch.endTime = endTime;
  if (notes !== undefined) patch.notes = notes;
  const [day] = await db.update(campDaysTable).set(patch as any).where(and(eq(campDaysTable.id, dayId), eq(campDaysTable.campId, campId))).returning();
  if (!day) { res.status(404).json({ error: "Camp day not found" }); return; }
  res.json(day);
});

router.delete("/camps/:id/days/:dayId", requirePermission("canManageCamps"), async (req, res): Promise<void> => {
  const campId = Number(req.params.id);
  const dayId = Number(req.params.dayId);
  const [deleted] = await db.delete(campDaysTable).where(and(eq(campDaysTable.id, dayId), eq(campDaysTable.campId, campId))).returning();
  if (!deleted) { res.status(404).json({ error: "Camp day not found" }); return; }
  res.sendStatus(204);
});

// ─── Price Resolution ─────────────────────────────────────────────────────────

router.get("/camps/:id/price", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const siblingNumber = Number(req.query.siblingNumber ?? 1);
  const [camp] = await db.select().from(campsTable).where(eq(campsTable.id, id));
  if (!camp) { res.status(404).json({ error: "Camp not found" }); return; }

  let pricingRule = null;
  if (camp.pricingRuleId) {
    const [rule] = await db.select().from(pricingRulesTable).where(eq(pricingRulesTable.id, camp.pricingRuleId));
    pricingRule = rule ?? null;
  }
  const resolvedPrice = resolveCampPrice(camp, pricingRule, new Date(), siblingNumber);
  const depositAmount = pricingRule?.depositAmount ? Number(pricingRule.depositAmount) : null;
  const depositRequired = pricingRule?.depositRequired ?? false;
  res.json({
    basePrice: Number(camp.price),
    resolvedPrice,
    earlyBirdPrice: pricingRule?.earlyBirdPrice ? Number(pricingRule.earlyBirdPrice) : null,
    earlyBirdCutoff: pricingRule?.earlyBirdCutoff ?? null,
    lateFee: pricingRule?.lateFee ? Number(pricingRule.lateFee) : null,
    siblingDiscountPct: pricingRule?.siblingDiscountPct ? Number(pricingRule.siblingDiscountPct) : null,
    depositAmount,
    depositRequired,
    installmentPlan: pricingRule?.installmentPlan ?? false,
    installmentCount: pricingRule?.installmentCount ?? null,
  });
});

// ─── Camp Registration ────────────────────────────────────────────────────────
//
// Rules:
//   1. waiverSigned: true is REQUIRED — registration blocked if not signed
//   2. Youth camps (u8_u11, u12_u15): guardianUserId REQUIRED; player may differ from registrant
//   3. Age eligibility: player DOB validated against camp ageGroup + camp start date
//   4. photoConsentGiven: must be explicitly set for youth (may be false = declined)

router.post("/camps/:id/register", requireAuth, async (req, res): Promise<void> => {
  const campId = Number(req.params.id);
  const clerkId = (req as AuthedRequest).clerkUserId;
  const registrant = await getDbUserFromClerk(clerkId);
  if (!registrant) { res.status(401).json({ error: "User not found" }); return; }

  const [camp] = await db.select().from(campsTable).where(eq(campsTable.id, campId));
  if (!camp) { res.status(404).json({ error: "Camp not found" }); return; }
  if (!isEventActive(camp)) { res.status(403).json({ error: "Event is not currently active" }); return; }
  if (!camp.registrationOpen) { res.status(409).json({ error: "Registration is not open for this camp" }); return; }
  const isFull = (camp.participantsRegistered ?? 0) >= camp.maxParticipants;

  const {
    playerUserId,   // optional — supply when registering a child (youth camps)
    guardianUserId, // required for youth camps
    photoConsentGiven,
    siblingNumber,
    waiverSigned,
    notes,
  } = req.body;

  // ── 1. Waiver gate ────────────────────────────────────────────────────────
  if (!waiverSigned) {
    res.status(422).json({ error: "You must read and accept the liability waiver to register" });
    return;
  }

  // ── 2. Youth compliance gate ──────────────────────────────────────────────
  const youth = isYouthCamp(normalizeAgeGroup(camp.ageGroup as any));
  if (youth) {
    // guardianUserId required and must match the authenticated registrant (no impersonation)
    if (!guardianUserId) {
      res.status(422).json({ error: "A guardian user ID is required for youth camp registrations" });
      return;
    }
    if (Number(guardianUserId) !== registrant.id) {
      res.status(403).json({ error: "Guardian identity mismatch: the signed-in account must be the guardian on record" });
      return;
    }
    // playerUserId is mandatory for youth camps — the guardian cannot register themselves as the camper
    if (!playerUserId) {
      res.status(422).json({ error: "playerUserId is required for youth camps — please select the child being registered" });
      return;
    }
    if (Number(playerUserId) === registrant.id) {
      res.status(422).json({ error: "A guardian cannot register themselves as a youth camper — please select the child's account" });
      return;
    }
    // photoConsentGiven must be explicitly provided (can be false, but must be declared)
    if (photoConsentGiven === undefined || photoConsentGiven === null) {
      res.status(422).json({ error: "Photo/media consent must be explicitly declared for youth registrations" });
      return;
    }
  }

  // ── 3. Resolve the actual player (for age check and record) ───────────────
  // Adult camps: always the authenticated user (playerUserId from request is ignored).
  // Youth camps: must be the child (playerUserId required and validated above).
  const targetPlayerId = youth ? Number(playerUserId) : registrant.id;
  const [player] = await db.select().from(usersTable).where(eq(usersTable.id, targetPlayerId));
  if (!player) { res.status(422).json({ error: "Player user not found" }); return; }

  // ── 4. Age eligibility ────────────────────────────────────────────────────
  const campAgeGroups = normalizeAgeGroup(camp.ageGroup as any);
  const campEventDate = camp.startDate ? new Date(camp.startDate + "T12:00:00") : new Date();
  const waivedGroups = await getPlayerWaivedGroups(targetPlayerId);
  const ageError = checkUsysAgeEligibility(campAgeGroups, player.dateOfBirth, campEventDate, waivedGroups);
  if (ageError) {
    res.status(422).json({ error: ageError });
    return;
  }

  // ── 4b. Guardian-child relationship verification (youth camps — always enforced) ──────────
  if (youth) {
    // Unconditionally verify an approved guardian link exists between registrant and the child.
    // This check is NOT gated on playerUserId presence — it runs for every youth registration.
    const [link] = await db.select().from(guardiansTable).where(
      and(
        eq(guardiansTable.guardianUserId, registrant.id),
        eq(guardiansTable.youthUserId, targetPlayerId),
        eq(guardiansTable.status, "approved" as any),
        eq(guardiansTable.canRegister, true),
      )
    );
    if (!link) {
      res.status(403).json({
        error: "No approved guardian relationship found. Please add and verify your child's account first under Guardian → Children.",
      });
      return;
    }
  }

  // ── 5. Idempotency — reject duplicate active registration ─────────────────
  const [existing] = await db.select().from(campRegistrationsTable).where(
    and(eq(campRegistrationsTable.campId, campId), eq(campRegistrationsTable.playerUserId, targetPlayerId))
  );
  if (existing && existing.status !== "cancelled") {
    res.status(409).json({ error: "already_registered", message: "This player is already registered for this camp" });
    return;
  }

  // ── 6. Pricing ────────────────────────────────────────────────────────────
  let pricingRule = null;
  if (camp.pricingRuleId) {
    const [rule] = await db.select().from(pricingRulesTable).where(eq(pricingRulesTable.id, camp.pricingRuleId));
    pricingRule = rule ?? null;
  }
  const sib = Number(siblingNumber ?? 1);
  const resolvedPrice = resolveCampPrice(camp, pricingRule, new Date(), sib);
  const depositAmount = pricingRule?.depositRequired ? Number(pricingRule.depositAmount ?? 0) : null;
  // balanceDue = what the player still owes at registration time:
  //   - deposit system: full price minus deposit paid now
  //   - no deposit: full resolved price (entire amount pending)
  const balanceDue = depositAmount !== null ? resolvedPrice - depositAmount : resolvedPrice;

  // ── 7. Waiver record ──────────────────────────────────────────────────────
  // waiverSigned has been validated true above; we now require an active versioned template.
  const [activeWaiver] = await db.select().from(waiverTemplatesTable)
    .where(eq(waiverTemplatesTable.isActive, true))
    .orderBy(desc(waiverTemplatesTable.version))
    .limit(1);

  if (!activeWaiver) {
    res.status(422).json({ error: "No active waiver template is on file. Please contact the Alumni Center before registering." });
    return;
  }

  const waiverTemplateId: number = activeWaiver.id;
  const waiverVersion: number = activeWaiver.version;
  const waiverSignedAt = new Date();
  const guardianSignedAt = youth && guardianUserId ? new Date() : null;

  // ── 8. Insert registration (confirmed or waitlisted) ────────────────────
  // If the camp is full, add to FIFO waitlist instead of blocking with 409.
  let waitlistPosition: number | null = null;
  if (isFull) {
    const [maxRow] = await db
      .select({ max: sql<number>`COALESCE(MAX(${campRegistrationsTable.waitlistPosition}), 0)` })
      .from(campRegistrationsTable)
      .where(
        and(
          eq(campRegistrationsTable.campId, campId),
          eq(campRegistrationsTable.status, "waitlisted"),
        )
      );
    waitlistPosition = (maxRow?.max ?? 0) + 1;
  }

  let reg: any;
  try {
    [reg] = await db.insert(campRegistrationsTable).values({
      campId,
      userId: registrant.id,
      playerUserId: targetPlayerId,
      guardianUserId: guardianUserId ? Number(guardianUserId) : null,
      status: isFull ? "waitlisted" : "confirmed",
      paymentStatus: "unpaid",
      pricePaid: isFull ? "0" : String(resolvedPrice),
      depositPaid: false,
      depositAmount: isFull ? null : (depositAmount !== null ? String(depositAmount) : null),
      balanceDue: isFull ? "0" : String(balanceDue),
      waiverSignedAt,
      waiverTemplateId,
      waiverVersion,
      guardianSignedAt,
      photoConsentGiven: youth ? Boolean(photoConsentGiven) : false,
      siblingNumber: sib,
      waitlistPosition,
      notes: notes ?? null,
      skill_level: (req.body.skillLevel ?? null) as any,
      shirt_size: (req.body.shirtSize ?? null) as any,
    } as any).returning();
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "already_registered", message: "This player is already registered for this camp" });
      return;
    }
    throw err;
  }

  // Only count confirmed registrations toward the capacity counter
  if (!isFull) {
    await db.update(campsTable).set({
      participantsRegistered: sql`${campsTable.participantsRegistered} + 1`,
      updatedAt: new Date(),
    } as Partial<typeof campsTable.$inferInsert>).where(eq(campsTable.id, campId));
  }

  await writeAuditLog({
    action: isFull ? "camp_waitlisted" : "camp_registration",
    entityType: "camp_registration",
    entityId: reg.id,
    after: { campId, registrantId: registrant.id, playerUserId: targetPlayerId, waiverVersion, youth, waitlistPosition },
  });

  res.status(201).json({ ...enrichReg(reg), waitlisted: isFull, waitlistPosition });
});

// Player: view own registrations (returns all regs where userId = self)
router.get("/camps/:id/register/my", requireAuth, async (req, res): Promise<void> => {
  const campId = Number(req.params.id);
  const clerkId = (req as AuthedRequest).clerkUserId;
  const user = await getDbUserFromClerk(clerkId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }
  // A player sees regs where they are the registrant OR the player
  const regs = await db.select().from(campRegistrationsTable).where(
    and(
      eq(campRegistrationsTable.campId, campId),
      sql`(${campRegistrationsTable.userId} = ${user.id} OR ${campRegistrationsTable.playerUserId} = ${user.id})`,
    )
  );
  res.json(regs.map(enrichReg));
});

// ─── Roster (admin) ───────────────────────────────────────────────────────────

router.get("/camps/:id/roster", requirePermission("canViewRegistrations"), async (req, res): Promise<void> => {
  const campId = Number(req.params.id);
  const requestingRole = (req as AuthedRequest).dbUser?.role ?? "staff";

  const regRows = await db.select().from(campRegistrationsTable)
    .where(eq(campRegistrationsTable.campId, campId))
    .orderBy(asc(campRegistrationsTable.createdAt));

  // Collect all unique user IDs (registrant + playerUserId)
  const allIds = [...new Set([
    ...regRows.map(r => r.userId),
    ...regRows.map(r => r.playerUserId).filter(Boolean) as number[],
  ])];

  const players = allIds.length > 0
    ? await db.select().from(usersTable).where(sql`${usersTable.id} = ANY(${sql.raw(`ARRAY[${allIds.join(",")}]`)})`)
    : [];
  const playerMap: Record<number, any> = {};
  for (const p of players) playerMap[p.id] = p;

  const enriched = regRows.map(r => ({
    ...enrichReg(r),
    // Always use playerUserId as the camper identity
    player: redactPlayerForRole(playerMap[r.playerUserId ?? r.userId] ?? null, requestingRole),
    registrant: requestingRole === "admin" ? (playerMap[r.userId] ?? null) : undefined,
  }));
  res.json(enriched);
});

router.patch("/camps/:id/roster/:regId", requirePermission("canManageCamps"), async (req, res): Promise<void> => {
  const campId = Number(req.params.id);
  const regId = Number(req.params.regId);
  const allowed = ["status","paymentStatus","depositPaid","balanceDue","notes","photoConsentGiven"];
  const patch: Record<string, any> = {};
  for (const k of allowed) { if (req.body[k] !== undefined) patch[k] = req.body[k]; }
  const [reg] = await db.update(campRegistrationsTable).set({ ...patch, updatedAt: new Date() } as Partial<typeof campRegistrationsTable.$inferInsert>)
    .where(and(eq(campRegistrationsTable.id, regId), eq(campRegistrationsTable.campId, campId))).returning();
  if (!reg) { res.status(404).json({ error: "Registration not found" }); return; }
  await writeAuditLog({ action: "camp_registration_updated", entityType: "camp_registration", entityId: regId, after: patch });
  res.json(enrichReg(reg));
});

router.delete("/camps/:id/roster/:regId", requirePermission("canManageCamps"), async (req, res): Promise<void> => {
  const campId = Number(req.params.id);
  const regId = Number(req.params.regId);

  // Fetch current state before cancelling so we know whether to decrement + promote
  const [before] = await db.select().from(campRegistrationsTable)
    .where(and(eq(campRegistrationsTable.id, regId), eq(campRegistrationsTable.campId, campId)));
  if (!before) { res.status(404).json({ error: "Registration not found" }); return; }

  const [reg] = await db.update(campRegistrationsTable)
    .set({ status: "cancelled", waitlistPosition: null, updatedAt: new Date() } as Partial<typeof campRegistrationsTable.$inferInsert>)
    .where(and(eq(campRegistrationsTable.id, regId), eq(campRegistrationsTable.campId, campId)))
    .returning();
  if (!reg) { res.status(404).json({ error: "Registration not found" }); return; }

  const wasConfirmed = before.status === "confirmed" || before.status === "pending";
  const wasWaitlisted = before.status === "waitlisted";

  if (wasConfirmed) {
    // Free up the spot and auto-promote from waitlist
    await db.update(campsTable).set({
      participantsRegistered: sql`GREATEST(0, ${campsTable.participantsRegistered} - 1)`,
      updatedAt: new Date(),
    } as Partial<typeof campsTable.$inferInsert>).where(eq(campsTable.id, campId));
    await promoteNextWaitlistedCamp(campId);
  } else if (wasWaitlisted && before.waitlistPosition != null) {
    // Renumber remaining waitlisted entries to close the gap
    await db.execute(sql`
      UPDATE camp_registrations
      SET waitlist_position = waitlist_position - 1
      WHERE camp_id = ${campId}
        AND status = 'waitlisted'
        AND waitlist_position > ${before.waitlistPosition}
    `);
  }

  await writeAuditLog({ action: "camp_registration_cancelled", entityType: "camp_registration", entityId: regId });
  res.sendStatus(204);
});

// ─── Waitlist admin routes ────────────────────────────────────────────────────

// List all waitlisted registrations in FIFO order
router.get("/camps/:id/waitlist", requirePermission("canViewRegistrations"), async (req, res): Promise<void> => {
  const campId = Number(req.params.id);

  const regRows = await db.select().from(campRegistrationsTable)
    .where(and(eq(campRegistrationsTable.campId, campId), eq(campRegistrationsTable.status, "waitlisted")))
    .orderBy(asc(campRegistrationsTable.waitlistPosition));

  const allIds = [...new Set([
    ...regRows.map(r => r.userId),
    ...regRows.map(r => r.playerUserId).filter(Boolean) as number[],
  ])];
  const players = allIds.length > 0
    ? await db.select().from(usersTable).where(sql`${usersTable.id} = ANY(${sql.raw(`ARRAY[${allIds.join(",")}]`)})`)
    : [];
  const playerMap: Record<number, any> = {};
  for (const p of players) playerMap[p.id] = p;

  const enriched = regRows.map(r => ({
    ...enrichReg(r),
    player: playerMap[r.playerUserId ?? r.userId] ?? null,
  }));
  res.json(enriched);
});

// Admin: manually promote a specific waitlisted registration
router.post("/camps/:id/waitlist/:regId/promote", requirePermission("canManageCamps"), async (req, res): Promise<void> => {
  const campId = Number(req.params.id);
  const regId = Number(req.params.regId);

  const [reg] = await db.select().from(campRegistrationsTable)
    .where(and(eq(campRegistrationsTable.id, regId), eq(campRegistrationsTable.campId, campId)));
  if (!reg) { res.status(404).json({ error: "Registration not found" }); return; }
  if (reg.status !== "waitlisted") { res.status(409).json({ error: "Registration is not waitlisted" }); return; }

  const promotedPosition = reg.waitlistPosition ?? 0;

  const [promoted] = await db.update(campRegistrationsTable)
    .set({ status: "confirmed", waitlistPosition: null, updatedAt: new Date() } as Partial<typeof campRegistrationsTable.$inferInsert>)
    .where(eq(campRegistrationsTable.id, regId))
    .returning();

  // Increment participantsRegistered (even if over capacity — admin is force-promoting)
  await db.update(campsTable).set({
    participantsRegistered: sql`${campsTable.participantsRegistered} + 1`,
    updatedAt: new Date(),
  } as Partial<typeof campsTable.$inferInsert>).where(eq(campsTable.id, campId));

  // Renumber remaining waitlisted entries
  if (promotedPosition > 0) {
    await db.execute(sql`
      UPDATE camp_registrations
      SET waitlist_position = waitlist_position - 1
      WHERE camp_id = ${campId}
        AND status = 'waitlisted'
        AND waitlist_position > ${promotedPosition}
    `);
  }

  // Send notification
  const [camp] = await db.select().from(campsTable).where(eq(campsTable.id, campId));
  if (camp && promoted.userId) {
    await sendNotificationWithPreferences({
      userId: promoted.userId,
      type: "waitlist_movement",
      subject: `You've been confirmed for ${camp.name}!`,
      body: `An admin has moved you off the waitlist for ${camp.name}. You're now confirmed!`,
    }).catch(() => {});
  }

  await writeAuditLog({ action: "camp_waitlist_promoted", entityType: "camp_registration", entityId: regId, after: { campId, promotedBy: "admin" } });
  res.json(enrichReg(promoted));
});

// Roster CSV export — super-admin only (full PII)
router.get("/camps/:id/roster/export", requireSuperAdmin, async (req, res): Promise<void> => {
  const campId = Number(req.params.id);

  const [camp] = await db.select().from(campsTable).where(eq(campsTable.id, campId));
  if (!camp) { res.status(404).json({ error: "Camp not found" }); return; }

  const regRows = await db.select().from(campRegistrationsTable)
    .where(eq(campRegistrationsTable.campId, campId))
    .orderBy(asc(campRegistrationsTable.createdAt));

  const allIds = [...new Set([...regRows.map(r => r.userId), ...regRows.map(r => r.playerUserId).filter(Boolean) as number[]])];
  const players = allIds.length > 0
    ? await db.select().from(usersTable).where(sql`${usersTable.id} = ANY(${sql.raw(`ARRAY[${allIds.join(",")}]`)})`)
    : [];
  const playerMap: Record<number, any> = {};
  for (const p of players) playerMap[p.id] = p;

  const header = "ID,Player First,Player Last,Player Email,Date of Birth,Registrant Email,Status,Payment,Price Paid,Balance Due,Waiver Signed,Waiver Version,Photo Consent,Guardian ID,Sibling #,Registered At\n";
  const rows = regRows.map(r => {
    const player = playerMap[r.playerUserId ?? r.userId] ?? {};
    const registrant = playerMap[r.userId] ?? {};
    return [
      r.id,
      player.firstName ?? "", player.lastName ?? "", player.email ?? "", player.dateOfBirth ?? "",
      registrant.email ?? "",
      r.status, r.paymentStatus,
      Number(r.pricePaid).toFixed(2),
      r.balanceDue != null ? Number(r.balanceDue).toFixed(2) : "0.00",
      r.waiverSignedAt ? "Yes" : "No",
      r.waiverVersion ?? "",
      r.photoConsentGiven ? "Yes" : "No",
      r.guardianUserId ?? "",
      r.siblingNumber,
      r.createdAt.toISOString(),
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(",");
  }).join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="camp-${campId}-roster.csv"`);
  res.send(header + rows);
});

// ─── Coach Assignment ─────────────────────────────────────────────────────────

router.get("/camps/:id/coaches", async (req, res): Promise<void> => {
  const campId = Number(req.params.id);
  const rows = await db.select().from(assignmentsTable)
    .where(and(eq(assignmentsTable.entityType, "camp"), eq(assignmentsTable.entityId, campId)));

  const staffIds = rows.map(a => a.staffUserId);
  const staffUsers = staffIds.length > 0
    ? await db.select().from(usersTable).where(sql`${usersTable.id} = ANY(${sql.raw(`ARRAY[${staffIds.join(",")}]`)})`)
    : [];
  const staffMap: Record<number, any> = {};
  for (const u of staffUsers) staffMap[u.id] = u;

  const profiles = staffIds.length > 0
    ? await db.select().from(staffProfilesTable).where(sql`${staffProfilesTable.userId} = ANY(${sql.raw(`ARRAY[${staffIds.join(",")}]`)})`)
    : [];
  const profileMap: Record<number, any> = {};
  for (const p of profiles) profileMap[p.userId] = p;

  const enriched = rows.map(a => {
    const u = staffMap[a.staffUserId];
    return {
      ...a,
      user: u ? { id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email } : null,
      staffProfile: profileMap[a.staffUserId] ?? null,
    };
  });
  res.json(enriched);
});

router.post("/camps/:id/coaches", requirePermission("canManageCamps"), async (req, res): Promise<void> => {
  const campId = Number(req.params.id);
  const { staffUserId, role, compensationAmount, notes } = req.body;
  if (!staffUserId) { res.status(400).json({ error: "staffUserId required" }); return; }
  const [assignment] = await db.insert(assignmentsTable).values({
    staffUserId: Number(staffUserId), entityType: "camp", entityId: campId,
    role: role ?? "coach", compensationAmount: compensationAmount ? String(compensationAmount) : null,
    notes: notes ?? null, status: "assigned",
  } as typeof assignmentsTable.$inferInsert).returning();
  res.status(201).json(assignment);
});

router.delete("/camps/:id/coaches/:assignmentId", requirePermission("canManageCamps"), async (req, res): Promise<void> => {
  const campId = Number(req.params.id);
  const assignmentId = Number(req.params.assignmentId);
  const [deleted] = await db.delete(assignmentsTable).where(
    and(eq(assignmentsTable.id, assignmentId), eq(assignmentsTable.entityType, "camp"), eq(assignmentsTable.entityId, campId))
  ).returning();
  if (!deleted) { res.status(404).json({ error: "Assignment not found" }); return; }
  res.sendStatus(204);
});

// ─── Per-day Check-in ────────────────────────────────────────────────────────
// Access: admin, canManageCamps staff, OR assigned coach for this camp

router.get("/camps/:id/days/:dayId/checkin", requireAuth, async (req, res): Promise<void> => {
  const campId = Number(req.params.id);
  const dayId = Number(req.params.dayId);
  // Auth guard: admin, staff with canManageCamps, or assigned coach
  await requireCampStaffOrCoach(campId, req, res, async () => {
    const requestingRole = (req as AuthedRequest).dbUser?.role ?? "staff";

    const [day] = await db.select().from(campDaysTable).where(and(eq(campDaysTable.id, dayId), eq(campDaysTable.campId, campId)));
    if (!day) { res.status(404).json({ error: "Camp day not found" }); return; }

    const [camp] = await db.select().from(campsTable).where(eq(campsTable.id, campId));

    // All confirmed registrations for this camp — keyed by playerUserId
    const regRows = await db.select().from(campRegistrationsTable).where(
      and(eq(campRegistrationsTable.campId, campId), sql`${campRegistrationsTable.status} != 'cancelled'`)
    );

    const playerIds = [...new Set(regRows.map(r => r.playerUserId).filter(Boolean) as number[])];
    const players = playerIds.length > 0
      ? await db.select().from(usersTable).where(sql`${usersTable.id} = ANY(${sql.raw(`ARRAY[${playerIds.join(",")}]`)})`)
      : [];
    const playerMap: Record<number, any> = {};
    for (const p of players) playerMap[p.id] = p;

    // Check-ins for this specific day — active (non-voided) keyed by userId
    const checkIns = await db.select().from(checkInsTable).where(
      and(
        eq(checkInsTable.entityType, "camp_day"),
        eq(checkInsTable.entityId, dayId),
        sql`${checkInsTable.voidedAt} IS NULL`,
      )
    );
    const checkinByPlayer = new Map(checkIns.map(c => [c.userId!, c]));

    const roster = regRows.map(r => {
      const pid = r.playerUserId ?? r.userId;
      const ci = checkinByPlayer.get(pid);
      return {
        registrationId: r.id,
        playerUserId: pid,
        registrantUserId: r.userId,
        status: r.status,
        paymentStatus: r.paymentStatus,
        balanceDue: r.balanceDue != null ? Number(r.balanceDue) : 0,
        waiverSigned: !!r.waiverSignedAt,
        photoConsentGiven: r.photoConsentGiven,
        checkedIn: !!ci,
        checkinId: ci?.id ?? null,
        player: redactPlayerForRole(playerMap[pid] ?? null, requestingRole),
      };
    });

    res.json({
      camp: parseCamp(camp),
      day,
      roster,
      checkedInCount: roster.filter(r => r.checkedIn).length,
      totalCampers: regRows.length,
    });
  });
});

router.post("/camps/:id/days/:dayId/checkin", requireAuth, async (req, res): Promise<void> => {
  const campId = Number(req.params.id);
  const dayId = Number(req.params.dayId);

  const [campRecord] = await db.select().from(campsTable).where(eq(campsTable.id, campId));
  if (!campRecord || !isEventActive(campRecord)) {
    res.status(403).json({ error: "This camp is not currently active" });
    return;
  }

  await requireCampStaffOrCoach(campId, req, res, async () => {
    const staffUser = (req as AuthedRequest).dbUser;

    const [day] = await db.select().from(campDaysTable).where(and(eq(campDaysTable.id, dayId), eq(campDaysTable.campId, campId)));
    if (!day) { res.status(404).json({ error: "Camp day not found" }); return; }

    const { userId, qrCode, method } = req.body;

    // Resolve the player user from QR or userId
    let targetUser: any = null;
    if (qrCode) {
      [targetUser] = await db.select().from(usersTable).where(eq(usersTable.qrCode, qrCode));
    } else if (userId) {
      [targetUser] = await db.select().from(usersTable).where(eq(usersTable.id, Number(userId)));
    }
    if (!targetUser) { res.status(404).json({ error: "Player not found" }); return; }

    // Verify the player has an active registration — match on playerUserId
    const [reg] = await db.select().from(campRegistrationsTable).where(
      and(
        eq(campRegistrationsTable.campId, campId),
        eq(campRegistrationsTable.playerUserId, targetUser.id),
        sql`${campRegistrationsTable.status} != 'cancelled'`,
      )
    );
    if (!reg) { res.status(409).json({ error: "Player is not registered for this camp" }); return; }

    // Idempotent — return existing active (non-voided) check-in if already done
    const [existing] = await db.select().from(checkInsTable).where(
      and(
        eq(checkInsTable.entityType, "camp_day"),
        eq(checkInsTable.entityId, dayId),
        eq(checkInsTable.userId, targetUser.id),
        sql`${checkInsTable.voidedAt} IS NULL`,
      )
    );
    if (existing) {
      res.json({
        checkIn: existing,
        alreadyCheckedIn: true,
        player: { id: targetUser.id, firstName: targetUser.firstName, lastName: targetUser.lastName },
        reg: enrichReg(reg),
      });
      return;
    }

    const [checkIn] = await db.insert(checkInsTable).values({
      entityType: "camp_day",
      entityId: dayId,
      userId: targetUser.id,
      checkedInByUserId: staffUser?.id ?? null,
      method: method ?? (qrCode ? "qr" : "manual"),
      qrCodeScanned: qrCode ?? null,
      isManual: !qrCode,
    } as typeof checkInsTable.$inferInsert).returning();

    await writeAuditLog({
      action: "camp_day_checkin",
      entityType: "camp_day",
      entityId: dayId,
      after: { playerUserId: targetUser.id, campId, dayId, method: checkIn.method, checkedInBy: staffUser?.id },
    });

    res.status(201).json({
      checkIn,
      alreadyCheckedIn: false,
      player: { id: targetUser.id, firstName: targetUser.firstName, lastName: targetUser.lastName },
      reg: enrichReg(reg),
    });
  });
});

// ─── Health Packet ────────────────────────────────────────────────────────────

// GET /camps/:id/health-packet — fetch own health packet for this camp
router.get("/camps/:id/health-packet", requireAuth, async (req, res): Promise<void> => {
  const campId = Number(req.params.id);
  const clerkId = (req as AuthedRequest).clerkUserId;
  const user = await getDbUserFromClerk(clerkId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  // Only the account holder who performed the registration (guardian or adult self-registrant)
  // may access the health packet. Restricting to userId prevents child accounts from reading
  // sensitive medical data entered by their guardian.
  const [reg] = await db.select().from(campRegistrationsTable).where(
    and(
      eq(campRegistrationsTable.campId, campId),
      eq(campRegistrationsTable.userId, user.id),
      sql`${campRegistrationsTable.status} != 'cancelled'`,
    )
  );
  if (!reg) { res.status(404).json({ error: "No active registration found for this camp" }); return; }

  let packet: any = null;
  try { if ((reg as any).health_packet_json) packet = JSON.parse((reg as any).health_packet_json); } catch {}
  res.json({
    regId: reg.id,
    campId: reg.campId,
    submittedAt: (reg as any).health_packet_submitted_at ?? null,
    packet,
  });
});

// PUT /camps/:id/health-packet — submit/update health packet
router.put("/camps/:id/health-packet", requireAuth, async (req, res): Promise<void> => {
  const campId = Number(req.params.id);
  const clerkId = (req as AuthedRequest).clerkUserId;
  const user = await getDbUserFromClerk(clerkId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  // Only the account holder who performed the registration (guardian or adult self-registrant)
  // may read/update the health packet. Restricting to userId prevents child accounts from
  // modifying sensitive medical data entered by a guardian.
  const [reg] = await db.select().from(campRegistrationsTable).where(
    and(
      eq(campRegistrationsTable.campId, campId),
      eq(campRegistrationsTable.userId, user.id),
      sql`${campRegistrationsTable.status} != 'cancelled'`,
    )
  );
  if (!reg) { res.status(404).json({ error: "No active registration found for this camp" }); return; }

  const {
    emergencyContactName, emergencyContactPhone, emergencyContactRelationship,
    medicalConditions, allergies, medications,
    physicianName, physicianPhone,
    insuranceProvider, insurancePolicyNumber,
    additionalNotes,
    authorizedPickupPersons,
    mediaConsent,
    returningCamper,
  } = req.body;

  const packet = {
    emergencyContactName, emergencyContactPhone, emergencyContactRelationship,
    medicalConditions, allergies, medications,
    physicianName, physicianPhone,
    insuranceProvider, insurancePolicyNumber,
    additionalNotes,
    authorizedPickupPersons: authorizedPickupPersons ?? null,
    mediaConsent: !!mediaConsent,
    returningCamper: !!returningCamper,
  };

  await db.execute(sql`
    UPDATE camp_registrations
    SET health_packet_json = ${JSON.stringify(packet)},
        health_packet_submitted_at = NOW()
    WHERE id = ${reg.id}
  `);

  await writeAuditLog({
    action: "camp_health_packet_submitted",
    entityType: "camp_registration",
    entityId: reg.id,
    after: { campId, userId: user.id },
  });

  res.json({ success: true, regId: reg.id, submittedAt: new Date() });
});

// GET /camps/:id/health-packets (admin) — all health packets for a camp
router.get("/camps/:id/health-packets", requirePermission("canViewRegistrations"), async (req, res): Promise<void> => {
  const campId = Number(req.params.id);
  const regs = await db.execute(sql`
    SELECT cr.id, cr.player_user_id, cr.user_id,
           u.first_name, u.last_name,
           cr.health_packet_json, cr.health_packet_submitted_at
    FROM camp_registrations cr
    LEFT JOIN users u ON u.id = cr.player_user_id
    WHERE cr.camp_id = ${campId}
      AND cr.status != 'cancelled'
      AND cr.health_packet_json IS NOT NULL
    ORDER BY cr.created_at
  `);

  res.json(regs.rows.map((r: any) => ({
    regId: r.id,
    playerName: [r.first_name, r.last_name].filter(Boolean).join(" "),
    submittedAt: r.health_packet_submitted_at,
    packet: (() => { try { return JSON.parse(r.health_packet_json); } catch { return null; } })(),
  })));
});

export default router;
