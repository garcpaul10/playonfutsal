import { Router, type IRouter } from "express";
import {
  db, dropinsTable, dropinCourtPoolsTable, sessionTemplatesTable,
  spotsTable, checkInsTable, auditLogTable, usersTable,
  waiverSignaturesTable, courtsTable, notificationsTable,
  pricingRulesTable, guardiansTable, ageGroupWaiversTable, isEventActive, getEventWindow,
  paymentsTable, refundCreditPoliciesTable, accountCreditsTable, discountCodesTable,
} from "@workspace/db";
import { checkUsysAgeEligibility } from "../lib/usysAgeEligibility";
import { eq, and, isNull, desc, asc, inArray, sql, or, ne, gt } from "drizzle-orm";
import { restoreReservedCredits } from "../lib/creditUtils";
import { requireAuth, requirePermission, requireAdmin, AuthedRequest, hasPermission } from "../middlewares/auth";
import { sendMultiChannelNotification, sendRegistrationConfirmationEmail } from "../services/notifications";
import { getUncachableStripeClient } from "../lib/stripe";
import { computeRevenueSplit } from "../services/revenueComputation";
import { reconcileSpotFromStripe } from "../services/reconcileSpot";
import { getAuth } from "@clerk/express";

const router: IRouter = Router();

/** Parse pool: normalize ageGroup array and price to number. */
const parsePool = (p: any) => ({
  ...p,
  price: Number(p.price ?? 0),
  ageGroup: Array.isArray(p.ageGroup) ? p.ageGroup : p.ageGroup ? [p.ageGroup] : ["adult"],
});

/** Parse dropin session: normalize ageGroup. */
const parseDropin = (d: any) => ({
  ...d,
  ageGroup: Array.isArray(d.ageGroup) ? d.ageGroup : d.ageGroup ? [d.ageGroup] : ["adult"],
});

/** Coerce an ageGroup value (string or string[]) to a non-empty string[]. */
function normalizeAgeGroup(raw: unknown): string[] | null {
  if (Array.isArray(raw)) return raw.filter((v) => typeof v === "string" && v.length > 0);
  if (typeof raw === "string" && raw.length > 0) return [raw];
  return null;
}

// ─── Age eligibility ──────────────────────────────────────────────────────────

async function getPlayerWaivedGroups(playerUserId: number): Promise<string[]> {
  const waivers = await db.select().from(ageGroupWaiversTable).where(
    and(eq(ageGroupWaiversTable.playerId, playerUserId), eq(ageGroupWaiversTable.status, "approved"))
  );
  return waivers.map((w) => w.ageGroup);
}

// ─── Pool-level active check ───────────────────────────────────────────────────

const ACTIVE_BUFFER_MS = 30 * 60 * 1000;

function isPoolActive(pool: any): boolean {
  if (pool.activeOverride === "active") return true;
  if (pool.activeOverride === "closed") return false;
  if (!pool.startsAt) return false;
  const start = new Date(pool.startsAt).getTime();
  const end = start + (Number(pool.durationMinutes) || 120) * 60 * 1000;
  const now = Date.now();
  return now >= start - ACTIVE_BUFFER_MS && now <= end + ACTIVE_BUFFER_MS;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

async function batchDropinAggregates(dropinIds: number[]): Promise<Map<number, { spotsTotal: number; spotsTaken: number }>> {
  const result = new Map<number, { spotsTotal: number; spotsTaken: number }>();
  if (!dropinIds.length) return result;

  const pools = await db
    .select({ id: dropinCourtPoolsTable.id, dropinId: dropinCourtPoolsTable.dropinId, cap: dropinCourtPoolsTable.cap })
    .from(dropinCourtPoolsTable)
    .where(inArray(dropinCourtPoolsTable.dropinId, dropinIds));

  if (!pools.length) return result;

  const poolIds = pools.map((p) => p.id);
  const spotRows = await db
    .select({ poolId: spotsTable.poolId, count: sql<number>`count(*)` })
    .from(spotsTable)
    .where(
      and(
        inArray(spotsTable.poolId, poolIds),
        eq(spotsTable.status, "reserved"),
        eq(spotsTable.waitlisted, false),
        ne(spotsTable.paymentStatus, "payment_pending"),
      )
    )
    .groupBy(spotsTable.poolId);

  const spotsByPool = new Map<number, number>();
  for (const row of spotRows) spotsByPool.set(row.poolId!, Number(row.count));

  for (const pool of pools) {
    const did = pool.dropinId!;
    const existing = result.get(did) ?? { spotsTotal: 0, spotsTaken: 0 };
    existing.spotsTotal += pool.cap ?? 0;
    existing.spotsTaken += spotsByPool.get(pool.id) ?? 0;
    result.set(did, existing);
  }

  return result;
}

async function getDbUserFromClerk(clerkId: string) {
  const [u] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  return u;
}

async function poolSpotCounts(poolIds: number[], opts?: { excludePaymentPending?: boolean }) {
  if (!poolIds.length) return {} as Record<number, { spotsTaken: number; waitlistCount: number }>;
  const conditions: any[] = [
    inArray(spotsTable.poolId, poolIds),
    eq(spotsTable.status, "reserved"),
  ];
  if (opts?.excludePaymentPending) {
    conditions.push(sql`${(spotsTable as any).paymentStatus} != 'payment_pending'`);
  }
  const rows = await db
    .select({
      poolId: spotsTable.poolId,
      waitlisted: spotsTable.waitlisted,
      count: sql<number>`count(*)`,
    })
    .from(spotsTable)
    .where(and(...conditions))
    .groupBy(spotsTable.poolId, spotsTable.waitlisted);

  const out: Record<number, { spotsTaken: number; waitlistCount: number }> = {};
  for (const row of rows) {
    const pid = row.poolId!;
    if (!out[pid]) out[pid] = { spotsTaken: 0, waitlistCount: 0 };
    if (row.waitlisted) out[pid].waitlistCount += Number(row.count);
    else out[pid].spotsTaken += Number(row.count);
  }
  return out;
}

async function enrichPool(pool: any, counts?: { spotsTaken: number; waitlistCount: number }) {
  return {
    ...parsePool(pool),
    spotsTaken: counts?.spotsTaken ?? 0,
    waitlistCount: counts?.waitlistCount ?? 0,
  };
}

async function enrichSpot(spot: any) {
  let user: any = null;
  if (spot.userId) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, spot.userId));
    user = u;
  }
  let checkedIn = false;
  let checkedInAt: string | null = null;
  let checkinMethod: string | null = null;
  let checkinId: number | null = null;
  if (spot.entityId && spot.entityType) {
    if (spot.userId) {
      // Normal user check-in: match by userId
      const [ci] = await db
        .select()
        .from(checkInsTable)
        .where(
          and(
            eq(checkInsTable.entityType, spot.entityType),
            eq(checkInsTable.entityId, spot.entityId),
            eq(checkInsTable.userId, spot.userId),
            sql`${checkInsTable.voidedAt} IS NULL`,
          )
        )
        .orderBy(desc(checkInsTable.checkedInAt))
        .limit(1);
      if (ci) { checkedIn = true; checkedInAt = ci.checkedInAt.toISOString(); checkinMethod = ci.method; checkinId = ci.id; }
    } else {
      // Guest spot: look for check-in by synthetic admin key or QR JSON payload
      const syntheticKey = `admin:guest:spot:${spot.id}`;
      const candidates = await db
        .select()
        .from(checkInsTable)
        .where(
          and(
            eq(checkInsTable.entityType, spot.entityType),
            eq(checkInsTable.entityId, spot.entityId),
            isNull(checkInsTable.userId),
            sql`${checkInsTable.voidedAt} IS NULL`,
          )
        )
        .orderBy(desc(checkInsTable.checkedInAt))
        .limit(20);
      const ci = candidates.find((c) => {
        if (c.qrCodeScanned === syntheticKey) return true;
        if (c.qrCodeScanned) {
          try {
            const parsed = JSON.parse(c.qrCodeScanned);
            return parsed.spotId === spot.id;
          } catch { /* not JSON */ }
        }
        return false;
      });
      if (ci) { checkedIn = true; checkedInAt = ci.checkedInAt.toISOString(); checkinMethod = ci.method; checkinId = ci.id; }
    }
  }
  let waiverSigned = false;
  if (spot.userId) {
    const [ws] = await db
      .select()
      .from(waiverSignaturesTable)
      .where(and(
        eq(waiverSignaturesTable.userId, spot.userId),
        isNull(waiverSignaturesTable.youthUserId),
      ))
      .limit(1);
    waiverSigned = !!ws;
  }
  return {
    ...spot,
    userFirstName: user?.firstName ?? null,
    userLastName: user?.lastName ?? null,
    userEmail: user?.email ?? null,
    userQrCode: user?.qrCode ?? null,
    guestName: spot.guestName ?? null,
    guestEmail: spot.guestEmail ?? null,
    checkedIn,
    checkedInAt,
    checkinMethod,
    checkinId,
    waiverSigned,
  };
}

async function writeAuditLog(params: {
  actorClerkId?: string | null;
  actorUserId?: number | null;
  action: string;
  entityType: string;
  entityId: string | number;
  before?: any;
  after?: any;
  notes?: string;
}) {
  await db.insert(auditLogTable).values({
    actorClerkId: params.actorClerkId ?? null,
    actorUserId: params.actorUserId ?? null,
    action: params.action,
    entityType: params.entityType,
    entityId: String(params.entityId),
    before: params.before ? JSON.stringify(params.before) : null,
    after: params.after ? JSON.stringify(params.after) : null,
    notes: params.notes ?? null,
  });
}

export async function promoteNextWaitlisted(
  poolId: number,
  dropinId: number,
  actorClerkId?: string
): Promise<any | null> {
  const [nextWaiting] = await db
    .select()
    .from(spotsTable)
    .where(
      and(
        eq(spotsTable.poolId, poolId),
        eq(spotsTable.entityType, "dropin"),
        eq(spotsTable.entityId, dropinId),
        eq(spotsTable.waitlisted, true),
        eq(spotsTable.status, "reserved"),
      )
    )
    .orderBy(asc(spotsTable.waitlistPosition))
    .limit(1);

  if (!nextWaiting) return null;

  const [promoted] = await db
    .update(spotsTable)
    .set({
      waitlisted: false,
      waitlistPosition: null,
      promotedFromWaitlist: true,
      confirmedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(spotsTable.id, nextWaiting.id))
    .returning();

  await db.execute(
    sql`UPDATE spots
        SET waitlist_position = waitlist_position - 1
        WHERE pool_id = ${poolId}
          AND entity_type = 'dropin'
          AND entity_id = ${dropinId}
          AND waitlisted = true
          AND status = 'reserved'
          AND waitlist_position > ${nextWaiting.waitlistPosition ?? 1}`
  );

  await writeAuditLog({
    actorClerkId,
    action: "waitlist_promoted",
    entityType: "dropin_spot",
    entityId: promoted.id,
    after: { poolId, promotedUserId: promoted.userId },
    notes: "Auto-promoted from waitlist",
  });

  if (promoted.userId) {
    const [dropin] = await db.select().from(dropinsTable).where(eq(dropinsTable.id, dropinId));
    if (dropin) {
      await sendMultiChannelNotification(["in_app", "email"], {
        userId: promoted.userId,
        type: "registration_confirmed",
        subject: `You're in! Spot confirmed for ${dropin.name}`,
        body: `A spot opened up and you've been moved from the waitlist! Your spot for ${dropin.name} is now confirmed.`,
        metadata: { dropinId, poolId },
      });
    }
  }

  return promoted;
}

/**
 * Dispatch a time-limited payment offer to the next N waitlisted player(s) in a paid pool.
 * Pre-creates a Stripe Checkout session so the session's native expiry drives queue advancement
 * via the checkout.session.expired webhook — even if the player never opens the payment page.
 * Stamps offerSentAt + offerExpiresAt + stripeCheckoutSessionId on the spot and notifies.
 */
export async function dispatchWaitlistOffer(
  poolId: number,
  dropinId: number,
  openedCount: number = 1,
  actorClerkId?: string
): Promise<any[]> {
  const [pool] = await db.select().from(dropinCourtPoolsTable).where(eq(dropinCourtPoolsTable.id, poolId));
  if (!pool) return [];

  const offerWindowMinutes = (pool as any).offerWindowMinutes ?? 240;
  const now = new Date();
  const offerExpiresAt = new Date(now.getTime() + offerWindowMinutes * 60 * 1000);

  const candidates = await db
    .select()
    .from(spotsTable)
    .where(
      and(
        eq(spotsTable.poolId, poolId),
        eq(spotsTable.entityType, "dropin"),
        eq(spotsTable.entityId, dropinId),
        eq(spotsTable.waitlisted, true),
        eq(spotsTable.status, "reserved"),
        sql`${(spotsTable as any).offer_sent_at} IS NULL`,
      )
    )
    .orderBy(asc(spotsTable.waitlistPosition))
    .limit(openedCount);

  if (candidates.length === 0) return [];

  const [dropin] = await db.select().from(dropinsTable).where(eq(dropinsTable.id, dropinId));
  const appUrl = (process.env.PUBLIC_APP_URL ?? "https://playonfutsal.vercel.app").replace(/\/$/, "");

  const poolPrice = Number(pool.price ?? 0);
  let serviceFeeAmount = 0;
  if (poolPrice > 0) {
    try {
      const feeSplit = await computeRevenueSplit({
        entityType: "drop_in",
        entityId: dropinId,
        category: "drop_in",
        grossAmount: poolPrice,
        paymentMethod: "card",
      });
      serviceFeeAmount = feeSplit.serviceFeeAmount;
    } catch {}
  }

  const stripe = await getUncachableStripeClient();

  const dispatched: any[] = [];
  for (const candidate of candidates) {
    // Look up user email + real Clerk ID for Stripe session metadata
    let userEmail: string | undefined;
    let userClerkId: string | undefined;
    if (candidate.userId) {
      const [u] = await db
        .select({ email: usersTable.email, clerkId: usersTable.clerkId })
        .from(usersTable)
        .where(eq(usersTable.id, candidate.userId));
      userEmail = u?.email ?? undefined;
      userClerkId = u?.clerkId ?? undefined;
    }

    // Build Stripe checkout session — pre-created so Stripe owns the expiry clock
    const sharedMeta: Record<string, string> = {
      programType: "drop_in",
      programId: String(dropinId),
      poolId: String(poolId),
      spotId: String(candidate.id),
      basePrice: String(poolPrice),
      serviceFeeAmount: String(serviceFeeAmount),
      category: "drop_in",
      waitlistOffer: "true",
      waitlistSpotId: String(candidate.id),
      ...(userClerkId ? { clerkUserId: userClerkId } : {}),
    };
    if (candidate.guardianUserId) {
      sharedMeta.guardianUserId = String(candidate.guardianUserId);
      sharedMeta.playerUserId = String(candidate.userId);
    }

    const lineItems: any[] = [{
      price_data: { currency: "usd", product_data: { name: dropin?.name ?? "Drop-in" }, unit_amount: Math.round(poolPrice * 100) },
      quantity: 1,
    }];
    if (serviceFeeAmount > 0) {
      lineItems.push({
        price_data: { currency: "usd", product_data: { name: "Processing fee" }, unit_amount: Math.round(serviceFeeAmount * 100) },
        quantity: 1,
      });
    }

    // Stripe requires expires_at to be between 30 min and 24 h from now
    const minExpiry = Date.now() + 30 * 60 * 1000;
    const maxExpiry = Date.now() + 24 * 60 * 60 * 1000;
    const stripeExpiresAt = Math.floor(Math.min(Math.max(offerExpiresAt.getTime(), minExpiry), maxExpiry) / 1000);

    let stripeSessionId: string | null = null;
    try {
      const session = await (stripe.checkout.sessions.create as any)({
        mode: "payment",
        ui_mode: "custom",
        return_url: `${appUrl}/checkout/complete?session_id={CHECKOUT_SESSION_ID}`,
        line_items: lineItems,
        metadata: sharedMeta,
        customer_email: userEmail,
        payment_intent_data: { receipt_email: userEmail, metadata: sharedMeta },
        expires_at: stripeExpiresAt,
      });
      stripeSessionId = session.id;
    } catch (stripeErr) {
      console.error("[dispatchWaitlistOffer] Stripe session creation failed for spot", candidate.id, stripeErr);
      // Proceed without session — offer is still dispatched but expiry relies on scheduler (future task)
    }

    const [updated] = await db
      .update(spotsTable)
      .set({
        offerSentAt: now,
        offerExpiresAt,
        stripeCheckoutSessionId: stripeSessionId,
        updatedAt: new Date(),
      } as any)
      .where(eq(spotsTable.id, candidate.id))
      .returning();

    dispatched.push(updated);

    if (candidate.userId && dropin) {
      const expiresStr = offerExpiresAt.toLocaleString("en-US", {
        month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit", hour12: true,
        timeZone: "America/New_York",
      });
      const payLink = `${appUrl}/dropins/${dropinId}?offer_spot=${candidate.id}`;
      await sendMultiChannelNotification(["in_app", "email", "web_push"], {
        userId: candidate.userId,
        type: "spot_offer",
        subject: `A spot opened for ${dropin.name}!`,
        body: `Great news — a spot opened in ${dropin.name}! Complete payment by ${expiresStr} to secure it: ${payLink}`,
        metadata: { dropinId, poolId, spotId: candidate.id, offerExpiresAt: offerExpiresAt.toISOString(), payLink },
      });
    }

    await writeAuditLog({
      actorClerkId,
      action: "waitlist_offer_dispatched",
      entityType: "dropin_spot",
      entityId: candidate.id,
      after: { poolId, offerSentAt: now.toISOString(), offerExpiresAt: offerExpiresAt.toISOString(), stripeSessionId },
      notes: "Waitlist offer dispatched",
    });
  }

  return dispatched;
}

// ─── Drop-in CRUD ──────────────────────────────────────────────────────────────

/**
 * GET /dropins
 * For non-admins: returns sessions that have at least one upcoming pool, with pools embedded.
 * For admins: returns all non-cancelled sessions with pools embedded.
 */
router.get("/dropins", async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req as any);
  const isAdmin = clerkId ? await hasPermission(clerkId, "canManageDropins") : false;
  const { includeCancelled, from, to, courtId: courtIdQ, skillLevel: skillLevelQ, ageGroup: ageGroupQ } = req.query as Record<string, string>;

  // Exclude dropins that were materialized from a dropin_template occurrence —
  // they are already surfaced via GET /dropin-occurrences and would show as duplicates.
  const matResult = await db.execute(sql`
    SELECT materialized_dropin_id FROM dropin_occurrences WHERE materialized_dropin_id IS NOT NULL
  `);
  const matRows = Array.isArray(matResult) ? matResult : (matResult as any).rows ?? [];
  const materializedDropinIds = new Set<number>(matRows.map((r: any) => Number(r.materialized_dropin_id)));

  let dropins = await db.select().from(dropinsTable).$dynamic()
    .orderBy(asc(dropinsTable.createdAt))
    .then(async (rows) => {
      // Exclude template-materialized sessions (shown in the template occurrence list instead)
      rows = rows.filter(d => !materializedDropinIds.has(d.id));
      // Apply status filter
      if (!isAdmin) {
        rows = rows.filter(d => !["completed", "cancelled"].includes(d.status));
      } else if (includeCancelled !== "true") {
        rows = rows.filter(d => d.status !== "cancelled");
      }
      return rows;
    });

  // Fetch all pools for these sessions
  if (!dropins.length) { res.json([]); return; }
  const dropinIds = dropins.map(d => d.id);
  const allPools = await db
    .select()
    .from(dropinCourtPoolsTable)
    .where(inArray(dropinCourtPoolsTable.dropinId, dropinIds))
    .orderBy(asc(dropinCourtPoolsTable.startsAt), asc(dropinCourtPoolsTable.id));

  const poolIds = allPools.map(p => p.id);
  const counts = await poolSpotCounts(poolIds, { excludePaymentPending: true });
  const enrichedPools = await Promise.all(allPools.map(p => enrichPool(p, counts[p.id])));

  const poolsByDropin = new Map<number, any[]>();
  for (const pool of enrichedPools) {
    const arr = poolsByDropin.get(pool.dropinId) ?? [];
    arr.push(pool);
    poolsByDropin.set(pool.dropinId, arr);
  }

  // Apply query filters based on pool attributes (courtId, skillLevel, ageGroup, from, to)
  if (courtIdQ || skillLevelQ || ageGroupQ || from || to) {
    const fromMs = from ? new Date(from).getTime() : null;
    const toMs = to ? new Date(to).getTime() : null;
    dropins = dropins.filter(d => {
      const pools = poolsByDropin.get(d.id) ?? [];
      return pools.some(p => {
        if (courtIdQ && String(p.courtId) !== courtIdQ) return false;
        if (skillLevelQ && p.skillLevel !== skillLevelQ) return false;
        if (ageGroupQ && !((p.ageGroup ?? []) as string[]).includes(ageGroupQ)) return false;
        if (fromMs && p.startsAt && new Date(p.startsAt).getTime() < fromMs) return false;
        if (toMs && p.startsAt && new Date(p.startsAt).getTime() > toMs) return false;
        return true;
      });
    });
  }

  // For non-admins, filter sessions to those with at least one upcoming pool
  if (!isAdmin) {
    const now = Date.now() - 30 * 60 * 1000; // 30-min buffer
    dropins = dropins.filter(d => {
      const pools = poolsByDropin.get(d.id) ?? [];
      // Show if has upcoming pool or (no pools but session-level startsAt still upcoming)
      const hasUpcomingPool = pools.some(p => {
        if (!p.startsAt) return false;
        const end = new Date(p.startsAt).getTime() + (p.durationMinutes || 120) * 60 * 1000;
        return end > now;
      });
      if (hasUpcomingPool) return true;
      // Fallback for sessions without pool startsAt but with session startsAt
      if (pools.length === 0 && (d as any).startsAt) {
        const end = new Date((d as any).startsAt).getTime() + ((d as any).durationMinutes || 120) * 60 * 1000;
        return end > now;
      }
      return false;
    });

    // Cap recurring series to 3 upcoming sessions per templateId
    const templateCounts = new Map<number, number>();
    dropins = dropins.filter((d) => {
      if (!d.templateId) return true;
      const seen = templateCounts.get(d.templateId) ?? 0;
      if (seen >= 3) return false;
      templateCounts.set(d.templateId, seen + 1);
      return true;
    });
  }

  // Sort by earliest pool startsAt ascending (closest upcoming first)
  dropins.sort((a, b) => {
    const aPoolsArr = poolsByDropin.get(a.id) ?? [];
    const bPoolsArr = poolsByDropin.get(b.id) ?? [];
    const aEarliest = aPoolsArr.reduce((min: number, p: any) => {
      const t = p.startsAt ? new Date(p.startsAt).getTime() : Infinity;
      return t < min ? t : min;
    }, (a as any).startsAt ? new Date((a as any).startsAt).getTime() : Infinity);
    const bEarliest = bPoolsArr.reduce((min: number, p: any) => {
      const t = p.startsAt ? new Date(p.startsAt).getTime() : Infinity;
      return t < min ? t : min;
    }, (b as any).startsAt ? new Date((b as any).startsAt).getTime() : Infinity);
    return aEarliest - bEarliest;
  });

  res.json(dropins.map(d => {
    const pools = poolsByDropin.get(d.id) ?? [];
    const spotsTotal = pools.reduce((sum, p) => sum + (p.cap ?? 0), 0);
    const spotsTaken = pools.reduce((sum, p) => sum + (p.spotsTaken ?? 0), 0);
    return {
      ...parseDropin(d),
      pools,
      spotsTotal,
      spotsTaken,
      spotsAvailable: Math.max(0, spotsTotal - spotsTaken),
      hasPools: pools.length > 0,
    };
  }));
});

/**
 * POST /dropins
 * Creates a session container. Only name, description, and visibility are required.
 * All logistics (time, price, registration) belong on pools.
 */
router.post("/dropins", requirePermission("canManageDropins"), async (req, res): Promise<void> => {
  const { name, description, imageUrl, isPublished, isFeatured, showOnMobile, pools } = req.body;
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  // Assign a default court (required by schema) from first available
  const [firstCourt] = await db.select({ id: courtsTable.id }).from(courtsTable).orderBy(asc(courtsTable.id)).limit(1);
  if (!firstCourt) {
    res.status(400).json({ error: "No courts configured — create a court before adding drop-in sessions" });
    return;
  }
  const [dropin] = await db.insert(dropinsTable).values({
    name,
    ageGroup: ["adult"],
    courtId: firstCourt.id,
    startsAt: new Date(), // placeholder; logistics now live on pools
    durationMinutes: 120,
    price: "0",
    registrationOpen: false,
    cancellationWindowMinutes: 120,
    description: description ?? null,
    imageUrl: imageUrl ?? null,
    isPublished: isPublished !== false,
    isFeatured: isFeatured === true,
    showOnMobile: showOnMobile !== false,
  } as typeof dropinsTable.$inferInsert).returning();

  // Inline pool creation for one-time sessions
  if (Array.isArray(pools) && pools.length > 0) {
    for (const p of pools) {
      const ageGroupArr = normalizeAgeGroup(p.ageGroup) ?? ["adult"];
      await db.insert(dropinCourtPoolsTable).values({
        dropinId: dropin.id,
        courtId: Number(p.courtId ?? firstCourt.id),
        ageGroup: ageGroupArr,
        skillLevel: p.skillLevel ?? "all",
        cap: Number(p.cap ?? 15),
        isClosed: false,
        notes: null,
        startsAt: p.startsAt ? new Date(p.startsAt) : null,
        durationMinutes: Number(p.durationMinutes ?? 120),
        price: String(p.price ?? "0"),
        cancellationWindowMinutes: Number(p.cancellationWindowMinutes ?? 120),
        offerWindowMinutes: 240,
        registrationOpen: false,
        gender: p.gender ?? null,
      } as typeof dropinCourtPoolsTable.$inferInsert);
    }
  }

  res.status(201).json(parseDropin(dropin));
});

// ─── Session Templates ──────────────────────────────────────────────────────────
// NOTE: Must be registered before /dropins/:id to prevent "templates" being captured as :id

router.get("/dropins/templates", requirePermission("canManageDropins"), async (req, res): Promise<void> => {
  const templates = await db.select().from(sessionTemplatesTable).orderBy(asc(sessionTemplatesTable.dayOfWeek), asc(sessionTemplatesTable.startTime));
  const { resolvePoolsConfig } = await import("../services/dropinRecurrenceScheduler");

  // Fetch the earliest existing session date per template so the edit form
  // can pre-fill the Start Date field correctly instead of defaulting to today.
  const firstSessionMap = new Map<number, string>();
  if (templates.length > 0) {
    const templateIds = templates.map(t => t.id);
    const rows = await db
      .select({
        templateId: dropinsTable.templateId,
        firstSessionDate: sql<string>`min(${dropinsTable.startsAt})`,
      })
      .from(dropinsTable)
      .where(inArray(dropinsTable.templateId as any, templateIds))
      .groupBy(dropinsTable.templateId);
    for (const row of rows) {
      if (row.templateId != null && row.firstSessionDate) {
        const dateStr = String(row.firstSessionDate).split("T")[0];
        firstSessionMap.set(row.templateId, dateStr);
      }
    }
  }

  res.json(templates.map(t => ({
    ...t,
    poolsConfig: resolvePoolsConfig(t),
    firstSessionDate: firstSessionMap.get(t.id) ?? null,
  })));
});

router.post("/dropins/templates", requirePermission("canManageDropins"), async (req, res): Promise<void> => {
  const {
    name, poolsConfig,
    // legacy flat fields — accepted for backward compat and synthesised from poolsConfig if absent
    dayOfWeek, startTime, durationMinutes, ageGroup, courtId, defaultCap,
    cancellationWindowMinutes, description, isActive, skillLevel, endsAt, price, gender,
    recurrenceInterval, recurrenceUnit,
    startFrom,
  } = req.body;

  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  // Resolve primary fields from poolsConfig (first pool) or from legacy flat fields
  const firstPool = Array.isArray(poolsConfig) && poolsConfig.length > 0 ? poolsConfig[0] : null;
  const resolvedDayOfWeek   = Number(firstPool?.dayOfWeek   ?? dayOfWeek   ?? 5);
  const resolvedStartTime   = firstPool?.startTime           ?? startTime   ?? "17:30";
  const resolvedAgeGroup    = firstPool?.ageGroup             ?? ageGroup   ?? "adult";
  const resolvedSkillLevel  = firstPool?.skillLevel           ?? skillLevel ?? "all";
  const resolvedDuration    = Number(firstPool?.durationMinutes ?? durationMinutes ?? 120);
  const resolvedCancelWin   = Number(firstPool?.cancellationWindowMinutes ?? cancellationWindowMinutes ?? 120);
  const resolvedPrice       = String(firstPool?.price ?? price ?? "0");
  const resolvedGender      = firstPool?.gender ?? gender ?? null;
  const resolvedEndsAt      = firstPool?.endsAt ?? endsAt ?? null;
  const resolvedCap         = Number(firstPool?.cap ?? defaultCap ?? 15);

  let resolvedCourtId: number;
  if (firstPool?.courtId) {
    resolvedCourtId = Number(firstPool.courtId);
  } else if (courtId) {
    resolvedCourtId = Number(courtId);
  } else {
    const [firstCourt] = await db.select({ id: courtsTable.id }).from(courtsTable).orderBy(asc(courtsTable.id)).limit(1);
    if (!firstCourt) { res.status(400).json({ error: "No courts configured — create a court before adding session templates" }); return; }
    resolvedCourtId = firstCourt.id;
  }

  const [template] = await db.insert(sessionTemplatesTable).values({
    name,
    dayOfWeek: resolvedDayOfWeek,
    startTime: resolvedStartTime,
    ageGroup: Array.isArray(resolvedAgeGroup) ? resolvedAgeGroup[0] : resolvedAgeGroup,
    skillLevel: resolvedSkillLevel,
    courtId: resolvedCourtId,
    durationMinutes: resolvedDuration,
    defaultCap: resolvedCap,
    cancellationWindowMinutes: resolvedCancelWin,
    price: resolvedPrice,
    gender: resolvedGender,
    description: description ?? null,
    isActive: isActive !== false,
    endsAt: resolvedEndsAt ? new Date(resolvedEndsAt) : null,
    poolsConfig: Array.isArray(poolsConfig) && poolsConfig.length > 0 ? poolsConfig : null,
    recurrenceInterval: recurrenceInterval !== undefined ? Number(recurrenceInterval) : 1,
    recurrenceUnit: recurrenceUnit ?? "week",
  } as typeof sessionTemplatesTable.$inferInsert).returning();

  const { generateRollingForTemplate } = await import("../services/dropinRecurrenceScheduler");
  let startFromDate: Date | undefined;
  if (startFrom) {
    startFromDate = new Date(startFrom);
    if (isNaN(startFromDate.getTime())) {
      res.status(400).json({ error: "Invalid startFrom date" });
      return;
    }
  }
  const generation = await generateRollingForTemplate(template.id, undefined, startFromDate).catch(() => ({ created: 0, skipped: 0 }));

  const { resolvePoolsConfig } = await import("../services/dropinRecurrenceScheduler");
  res.status(201).json({ ...template, poolsConfig: resolvePoolsConfig(template), _generated: generation });
});

router.get("/dropins/templates/:id", requirePermission("canManageDropins"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [template] = await db.select().from(sessionTemplatesTable).where(eq(sessionTemplatesTable.id, id));
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  const { resolvePoolsConfig } = await import("../services/dropinRecurrenceScheduler");
  res.json({ ...template, poolsConfig: resolvePoolsConfig(template) });
});

router.patch("/dropins/templates/:id", requirePermission("canManageDropins"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const allowed = ["name", "dayOfWeek", "startTime", "durationMinutes", "ageGroup", "skillLevel", "courtId", "defaultCap", "cancellationWindowMinutes", "description", "isActive", "endsAt", "price", "gender", "recurrenceInterval", "recurrenceUnit"];
  const patch: Record<string, any> = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) {
      if (["dayOfWeek", "durationMinutes", "courtId", "defaultCap", "cancellationWindowMinutes", "recurrenceInterval"].includes(k)) patch[k] = Number(req.body[k]);
      else if (k === "endsAt") patch[k] = req.body[k] ? new Date(req.body[k]) : null;
      else patch[k] = req.body[k];
    }
  }

  // Accept poolsConfig — also sync legacy top-level fields from the first pool
  if (Array.isArray(req.body.poolsConfig) && req.body.poolsConfig.length > 0) {
    patch.poolsConfig = req.body.poolsConfig;
    const fp = req.body.poolsConfig[0];
    if (fp.dayOfWeek !== undefined)              patch.dayOfWeek              = Number(fp.dayOfWeek);
    if (fp.startTime)                            patch.startTime              = fp.startTime;
    if (fp.durationMinutes !== undefined)        patch.durationMinutes        = Number(fp.durationMinutes);
    if (fp.cancellationWindowMinutes !== undefined) patch.cancellationWindowMinutes = Number(fp.cancellationWindowMinutes);
    if (fp.endsAt !== undefined)                 patch.endsAt                 = fp.endsAt ? new Date(fp.endsAt) : null;
    if (fp.courtId !== undefined)                patch.courtId                = Number(fp.courtId);
    if (fp.ageGroup !== undefined)               patch.ageGroup               = Array.isArray(fp.ageGroup) ? fp.ageGroup[0] : fp.ageGroup;
    if (fp.skillLevel !== undefined)             patch.skillLevel             = fp.skillLevel;
    if (fp.cap !== undefined)                    patch.defaultCap             = Number(fp.cap);
    if (fp.price !== undefined)                  patch.price                  = String(fp.price);
    if (fp.gender !== undefined)                 patch.gender                 = fp.gender || null;
  } else if (req.body.poolsConfig === null) {
    patch.poolsConfig = null;
  }

  const recurrenceFields = ["dayOfWeek", "startTime", "endsAt", "poolsConfig", "recurrenceInterval", "recurrenceUnit"];
  const recurrenceChanged = recurrenceFields.some(f => req.body[f] !== undefined);
  if (recurrenceChanged) patch.lastGeneratedAt = null;

  const [template] = await db.update(sessionTemplatesTable).set({ ...patch, updatedAt: new Date() } as Partial<typeof sessionTemplatesTable.$inferInsert>).where(eq(sessionTemplatesTable.id, id)).returning();
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }

  const { resolvePoolsConfig } = await import("../services/dropinRecurrenceScheduler");
  if (template.isActive) {
    const { generateRollingForTemplate } = await import("../services/dropinRecurrenceScheduler");
    const generation = await generateRollingForTemplate(template.id).catch(() => ({ created: 0, skipped: 0 }));
    res.json({ ...template, poolsConfig: resolvePoolsConfig(template), _generated: generation });
  } else {
    res.json({ ...template, poolsConfig: resolvePoolsConfig(template) });
  }
});

router.delete("/dropins/templates/:id", requirePermission("canManageDropins"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [deleted] = await db.delete(sessionTemplatesTable).where(eq(sessionTemplatesTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Template not found" }); return; }
  res.sendStatus(204);
});

router.delete("/dropins/templates/:id/series", requirePermission("canManageDropins"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { userId: clerkId } = getAuth(req as any);

  const [template] = await db.select().from(sessionTemplatesTable).where(eq(sessionTemplatesTable.id, id));
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }

  const futureSessionResult = await db.execute<{ id: number }>(sql`
    SELECT id FROM dropins
    WHERE template_id = ${id}
      AND starts_at >= NOW()
  `);
  const futureSessionRows: any[] = Array.isArray(futureSessionResult) ? futureSessionResult : (futureSessionResult as any).rows ?? [];
  const futureIds: number[] = futureSessionRows.map((r: any) => r.id);

  let deletedCount = 0;
  if (futureIds.length > 0) {
    await db.execute(sql`
      DELETE FROM spots
      WHERE entity_type = 'dropin'
        AND entity_id = ANY(${sql`ARRAY[${sql.raw(futureIds.join(","))}]::int[]`})
    `);
    await db.execute(sql`
      DELETE FROM dropin_court_pools
      WHERE dropin_id = ANY(${sql`ARRAY[${sql.raw(futureIds.join(","))}]::int[]`})
    `);
    const deletedResult = await db.execute<{ id: number }>(sql`
      DELETE FROM dropins
      WHERE id = ANY(${sql`ARRAY[${sql.raw(futureIds.join(","))}]::int[]`})
      RETURNING id
    `);
    const deletedRows: any[] = Array.isArray(deletedResult) ? deletedResult : (deletedResult as any).rows ?? [];
    deletedCount = deletedRows.length;
  }

  const pastResult = await db.execute<{ id: number }>(sql`
    UPDATE dropins
    SET status = 'cancelled', registration_open = false, updated_at = NOW()
    WHERE template_id = ${id}
      AND status != 'cancelled'
      AND starts_at < NOW()
    RETURNING id
  `);
  const pastRows: any[] = Array.isArray(pastResult) ? pastResult : (pastResult as any).rows ?? [];
  const archivedCount = pastRows.length;

  await db.delete(sessionTemplatesTable).where(eq(sessionTemplatesTable.id, id));

  await writeAuditLog({
    actorClerkId: clerkId ?? null,
    action: "series_deleted",
    entityType: "session_template",
    entityId: id,
    before: { name: template.name, isActive: template.isActive },
    notes: `Series deleted: template ${id} (${template.name}), ${deletedCount} future session(s) hard-deleted, ${archivedCount} past session(s) archived`,
  });

  res.json({ deleted: true, templateId: id, deletedSessions: deletedCount, archivedSessions: archivedCount });
});

// Generate sessions from template (manual date list)
router.post("/dropins/templates/:id/generate", requirePermission("canManageDropins"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { dates, price, registrationOpen } = req.body;
  if (!Array.isArray(dates) || !dates.length) {
    res.status(400).json({ error: "dates[] is required" });
    return;
  }
  const [template] = await db.select().from(sessionTemplatesTable).where(eq(sessionTemplatesTable.id, id));
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }

  const { resolvePoolsConfig } = await import("../services/dropinRecurrenceScheduler");
  const poolsConfig = resolvePoolsConfig(template);

  // Global fallback price: explicit request body → active pricing rule
  let globalFallbackPrice: number = price !== undefined && price !== null ? Number(price) : 0;
  if (!globalFallbackPrice) {
    const [pricingRule] = await db
      .select()
      .from(pricingRulesTable)
      .where(and(eq(pricingRulesTable.category, "drop_in"), eq(pricingRulesTable.isLatest, true)))
      .orderBy(desc(pricingRulesTable.createdAt))
      .limit(1);
    if (pricingRule?.basePrice) globalFallbackPrice = Number(pricingRule.basePrice);
  }

  function resolvePoolPrice(pc: any): number {
    const p = pc.price !== undefined && pc.price !== null ? Number(pc.price) : null;
    return p !== null && !isNaN(p) && p > 0 ? p : globalFallbackPrice;
  }

  function toEasternUtc(year: number, month: number, day: number, h: number, m: number): Date {
    const pad = (n: number) => String(n).padStart(2, "0");
    const isoStr = `${String(year).padStart(4,"0")}-${pad(month)}-${pad(day)}T${pad(h)}:${pad(m)}:00`;
    const utcRef = new Date(isoStr + "Z");
    const easternAtUtcRef = new Date(utcRef.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const offsetMs = utcRef.getTime() - easternAtUtcRef.getTime();
    return new Date(utcRef.getTime() + offsetMs);
  }

  const anchorPool = poolsConfig[0];
  const sessions: any[] = [];

  for (const dateStr of dates) {
    const [year, month, day] = (dateStr as string).split("-").map(Number);
    const [ah, am] = anchorPool.startTime.split(":").map(Number);
    const anchorStartsAt = toEasternUtc(year, month, day, ah, am);

    const [dropin] = await db.insert(dropinsTable).values({
      name: template.name,
      ageGroup: normalizeAgeGroup(anchorPool.ageGroup) ?? [anchorPool.ageGroup],
      skillLevel: anchorPool.skillLevel,
      courtId: anchorPool.courtId,
      startsAt: anchorStartsAt,
      durationMinutes: anchorPool.durationMinutes,
      price: String(resolvePoolPrice(anchorPool)),
      registrationOpen: false,
      cancellationWindowMinutes: anchorPool.cancellationWindowMinutes,
      templateId: template.id,
      description: template.description ?? null,
    } as typeof dropinsTable.$inferInsert).returning();

    for (const pc of poolsConfig) {
      // Skip pool if its own endsAt has passed for this date
      if (pc.endsAt) {
        const poolEnd = new Date(pc.endsAt);
        if (poolEnd < anchorStartsAt) continue;
      }

      const [ph, pm] = pc.startTime.split(":").map(Number);
      const poolStartsAt = toEasternUtc(year, month, day, ph, pm);

      await db.insert(dropinCourtPoolsTable).values({
        dropinId: dropin.id,
        courtId: Number(pc.courtId),
        ageGroup: normalizeAgeGroup(pc.ageGroup) ?? [pc.ageGroup],
        skillLevel: pc.skillLevel,
        cap: Number(pc.cap),
        isClosed: false,
        templateId: template.id,
        startsAt: poolStartsAt,
        durationMinutes: pc.durationMinutes,
        price: String(resolvePoolPrice(pc)),
        cancellationWindowMinutes: pc.cancellationWindowMinutes,
        registrationOpen: Boolean(registrationOpen),
        gender: pc.gender ?? null,
      } as typeof dropinCourtPoolsTable.$inferInsert);
    }

    sessions.push(parseDropin(dropin));
  }

  res.status(201).json({ sessions });
});

// Rolling generation
router.post("/dropins/templates/:id/generate-rolling", requirePermission("canManageDropins"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const horizonDays = req.body?.horizonDays ? Number(req.body.horizonDays) : 28;

  try {
    const { generateRollingForTemplate } = await import("../services/dropinRecurrenceScheduler");
    const result = await generateRollingForTemplate(id, horizonDays);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Generation failed" });
  }
});

// ─── Drop-in session by ID ─────────────────────────────────────────────────────

router.get("/dropins/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [dropin] = await db.select().from(dropinsTable).where(eq(dropinsTable.id, id));
  if (!dropin) { res.status(404).json({ error: "Drop-in session not found" }); return; }

  const pools = await db
    .select()
    .from(dropinCourtPoolsTable)
    .where(eq(dropinCourtPoolsTable.dropinId, id))
    .orderBy(asc(dropinCourtPoolsTable.startsAt), asc(dropinCourtPoolsTable.id));

  const poolIds = pools.map(p => p.id);
  const counts = await poolSpotCounts(poolIds, { excludePaymentPending: true });
  const enrichedPools = await Promise.all(pools.map(p => enrichPool(p, counts[p.id])));

  const spotsTotal = enrichedPools.reduce((sum, p) => sum + (p.cap ?? 0), 0);
  const spotsTaken = enrichedPools.reduce((sum, p) => sum + (p.spotsTaken ?? 0), 0);

  res.json({
    ...parseDropin(dropin),
    pools: enrichedPools,
    spotsTotal,
    spotsTaken,
    spotsAvailable: Math.max(0, spotsTotal - spotsTaken),
    hasPools: pools.length > 0,
  });
});

/**
 * PATCH /dropins/:id
 * Only allows editing session-level fields: name, description, status, visibility.
 * Logistics (time, price, etc.) are now pool-level.
 * When status is set to "cancelled", all waitlisted spots across every pool are
 * cancelled and their holders are notified.
 */
router.patch("/dropins/:id", requirePermission("canManageDropins"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const clerkId = (req as any).clerkUserId;
  const scope: "single" | "series" = req.body.scope === "series" ? "series" : "single";
  const allowed = ["name", "description", "status", "isPublished", "isFeatured", "showOnMobile", "imageUrl", "maxPlayers"];
  const patch: Record<string, any> = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) patch[k] = req.body[k];
  }
  const [dropin] = await db.update(dropinsTable).set({ ...patch, updatedAt: new Date() } as Partial<typeof dropinsTable.$inferInsert>).where(eq(dropinsTable.id, id)).returning();
  if (!dropin) { res.status(404).json({ error: "Drop-in session not found" }); return; }

  // When a session is cancelled, bulk-cancel all waitlisted spots and notify players
  if (patch.status === "cancelled") {
    try {
      const waitlistedSpots = await db
        .select()
        .from(spotsTable)
        .where(
          and(
            eq(spotsTable.entityType, "dropin"),
            eq(spotsTable.entityId, id),
            eq(spotsTable.waitlisted, true),
            sql`${spotsTable.status} != 'cancelled'`,
          )
        );

      if (waitlistedSpots.length > 0) {
        // Cancel all waitlisted spots
        await db.update(spotsTable)
          .set({ status: "cancelled", cancelledAt: new Date(), cancellationReason: "session_cancelled", updatedAt: new Date() } as Partial<typeof spotsTable.$inferInsert>)
          .where(
            and(
              eq(spotsTable.entityType, "dropin"),
              eq(spotsTable.entityId, id),
              eq(spotsTable.waitlisted, true),
              sql`${spotsTable.status} != 'cancelled'`,
            )
          );

        // Expire any pre-created Stripe sessions and notify affected players
        const stripe = await getUncachableStripeClient();
        const uniqueUserIds = [...new Set(waitlistedSpots.map((s: any) => s.userId).filter(Boolean))];
        for (const spot of waitlistedSpots) {
          const sessionId: string | null = (spot as any).stripeCheckoutSessionId ?? null;
          if (sessionId) {
            try { await (stripe.checkout.sessions.expire as any)(sessionId); } catch {}
          }
        }
        for (const userId of uniqueUserIds) {
          try {
            await sendMultiChannelNotification(["in_app", "email"], {
              userId: userId as number,
              type: "session_cancelled",
              subject: `${dropin.name} has been cancelled`,
              body: `Unfortunately, ${dropin.name} has been cancelled. Your waitlist spot has been removed.`,
              metadata: { dropinId: id },
            });
          } catch {}
        }

        await writeAuditLog({
          actorClerkId: clerkId,
          action: "waitlist_spots_cancelled_on_session_cancel",
          entityType: "dropin",
          entityId: id,
          after: { cancelledWaitlistSpots: waitlistedSpots.length },
          notes: `${waitlistedSpots.length} waitlisted spot(s) cancelled with session`,
        });
      }
    } catch (cleanupErr) {
      console.error("[PATCH /dropins/:id] Waitlist cleanup failed:", cleanupErr);
    }
  }

  // ── Series cascade for session-level fields ────────────────────────────────
  const cascadeAllowed = ["name", "description", "imageUrl", "isPublished", "isFeatured", "showOnMobile"];
  const cascadePatch: Record<string, any> = {};
  for (const k of cascadeAllowed) {
    if (patch[k] !== undefined) cascadePatch[k] = patch[k];
  }

  if (scope === "series" && (dropin as any).templateId && Object.keys(cascadePatch).length > 0) {
    const now = new Date();
    const result = await db.update(dropinsTable)
      .set({ ...cascadePatch, updatedAt: new Date() } as Partial<typeof dropinsTable.$inferInsert>)
      .where(and(
        eq(dropinsTable.templateId, (dropin as any).templateId),
        sql`${dropinsTable.startsAt} >= ${now}`,
        sql`${dropinsTable.id} != ${id}`,
        sql`${dropinsTable.status} NOT IN ('completed', 'cancelled')`,
      ))
      .returning({ id: dropinsTable.id });
    res.json({ session: parseDropin(dropin), cascaded: { count: result.length } });
    return;
  }

  res.json(parseDropin(dropin));
});

/**
 * PATCH /dropins/:id/cancel
 * Cancels a legacy drop-in session: sets status='cancelled' and registrationOpen=false.
 * Also cancels all active spots and notifies registered players.
 * Returns { dropin, activeSpotCount } so the frontend can display a summary.
 */
router.patch("/dropins/:id/cancel", requirePermission("canManageDropins"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const clerkId = (req as any).clerkUserId;

  const [dropin] = await db.select().from(dropinsTable).where(eq(dropinsTable.id, id));
  if (!dropin) { res.status(404).json({ error: "Drop-in session not found" }); return; }
  if (dropin.status === "cancelled") { res.status(409).json({ error: "Session is already cancelled" }); return; }

  // Count active (non-cancelled) spots so the response can inform the caller
  const activeSpotRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(spotsTable)
    .where(and(
      eq(spotsTable.entityType, "dropin"),
      eq(spotsTable.entityId, id),
      sql`${spotsTable.status} != 'cancelled'`,
    ));
  const activeSpotCount = Number(activeSpotRows[0]?.count ?? 0);

  const [updated] = await db
    .update(dropinsTable)
    .set({ status: "cancelled", registrationOpen: false, updatedAt: new Date() } as any)
    .where(eq(dropinsTable.id, id))
    .returning();

  // Cancel all active spots and notify players
  try {
    const activeSpots = await db
      .select()
      .from(spotsTable)
      .where(and(
        eq(spotsTable.entityType, "dropin"),
        eq(spotsTable.entityId, id),
        sql`${spotsTable.status} != 'cancelled'`,
      ));

    if (activeSpots.length > 0) {
      await db.update(spotsTable)
        .set({ status: "cancelled", cancelledAt: new Date(), cancellationReason: "session_cancelled", updatedAt: new Date() } as Partial<typeof spotsTable.$inferInsert>)
        .where(and(
          eq(spotsTable.entityType, "dropin"),
          eq(spotsTable.entityId, id),
          sql`${spotsTable.status} != 'cancelled'`,
        ));

      const stripe = await getUncachableStripeClient();
      const uniqueUserIds = [...new Set(activeSpots.map((s: any) => s.userId).filter(Boolean))];
      for (const spot of activeSpots) {
        const stripeSessionId: string | null = (spot as any).stripeCheckoutSessionId ?? null;
        if (stripeSessionId) {
          try { await (stripe.checkout.sessions.expire as any)(stripeSessionId); } catch {}
        }
      }
      for (const userId of uniqueUserIds) {
        try {
          await sendMultiChannelNotification(["in_app", "email"], {
            userId: userId as number,
            type: "session_cancelled",
            subject: `${dropin.name} has been cancelled`,
            body: `Unfortunately, ${dropin.name} has been cancelled. Your spot has been removed.`,
            metadata: { dropinId: id },
          });
        } catch {}
      }
    }
  } catch (cleanupErr) {
    console.error("[PATCH /dropins/:id/cancel] Spot cleanup failed:", cleanupErr);
  }

  await writeAuditLog({
    actorClerkId: clerkId ?? null,
    action: "legacy_session_cancelled",
    entityType: "dropin",
    entityId: id,
    before: { status: dropin.status },
    after: { status: "cancelled" },
    notes: `Legacy session cancelled with ${activeSpotCount} active spot(s)`,
  });

  res.json({ dropin: parseDropin(updated), activeSpotCount });
});

router.delete("/dropins/:id", requirePermission("canManageDropins"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);

  const [dropin] = await db.select().from(dropinsTable).where(eq(dropinsTable.id, id));
  if (!dropin) { res.status(404).json({ error: "Drop-in session not found" }); return; }

  // Block delete if there are confirmed (reserved, non-waitlisted) spots
  const confirmedRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(spotsTable)
    .where(and(
      eq(spotsTable.entityType, "dropin"),
      eq(spotsTable.entityId, id),
      eq(spotsTable.status, "reserved"),
      eq(spotsTable.waitlisted, false),
    ));
  const confirmedCount = Number(confirmedRows[0]?.count ?? 0);

  if (confirmedCount > 0) {
    res.status(409).json({
      error: "Cannot delete a session with confirmed registrations. Cancel it first to remove spots.",
      confirmedSpotCount: confirmedCount,
    });
    return;
  }

  // Explicitly clean up spots and pools before deleting the session
  await db.delete(spotsTable).where(and(
    eq(spotsTable.entityType, "dropin"),
    eq(spotsTable.entityId, id),
  ));
  const pools = await db.select({ id: dropinCourtPoolsTable.id }).from(dropinCourtPoolsTable).where(eq(dropinCourtPoolsTable.dropinId, id));
  if (pools.length > 0) {
    const poolIds = pools.map(p => p.id);
    await db.delete(spotsTable).where(inArray(spotsTable.poolId, poolIds));
    await db.delete(dropinCourtPoolsTable).where(eq(dropinCourtPoolsTable.dropinId, id));
  }

  const [deleted] = await db.delete(dropinsTable).where(eq(dropinsTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Drop-in session not found" }); return; }
  res.sendStatus(204);
});

/**
 * POST /dropins/:id/skip
 * Mark a single occurrence as skipped.
 */
router.post("/dropins/:id/skip", requirePermission("canManageDropins"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { userId: clerkId } = getAuth(req as any);

  const [dropin] = await db.select().from(dropinsTable).where(eq(dropinsTable.id, id));
  if (!dropin) { res.status(404).json({ error: "Drop-in session not found" }); return; }
  if (!dropin.templateId) { res.status(400).json({ error: "This session is not part of a recurring series" }); return; }
  if (dropin.status === "cancelled") { res.status(409).json({ error: "Session is already cancelled" }); return; }

  const easternWallClock = new Date(dropin.startsAt.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const pad = (n: number) => String(n).padStart(2, "0");
  const easternDateStr = `${easternWallClock.getFullYear()}-${pad(easternWallClock.getMonth() + 1)}-${pad(easternWallClock.getDate())}`;

  const [cancelled] = await db
    .update(dropinsTable)
    .set({ status: "cancelled", registrationOpen: false, updatedAt: new Date() } as any)
    .where(eq(dropinsTable.id, id))
    .returning();

  await db.execute(
    sql`UPDATE session_templates
        SET skipped_dates = array_append(skipped_dates, ${easternDateStr}),
            updated_at    = NOW()
        WHERE id = ${dropin.templateId}
          AND NOT (${easternDateStr} = ANY(skipped_dates))`
  );

  await writeAuditLog({
    actorClerkId: clerkId ?? null,
    action: "occurrence_skipped",
    entityType: "dropin",
    entityId: id,
    before: { status: dropin.status },
    after: { status: "cancelled", skippedDate: easternDateStr, templateId: dropin.templateId },
    notes: `Occurrence skipped for template ${dropin.templateId} on ${easternDateStr}`,
  });

  res.json({ ...parseDropin(cancelled), skippedDate: easternDateStr });
});

/**
 * POST /dropins/:id/rsvp
 * Fallback for sessions with no pools.
 */
router.post("/dropins/:id/rsvp", requireAuth, async (req, res): Promise<void> => {
  const dropinId = Number(req.params.id);
  const clerkId = (req as AuthedRequest).clerkUserId;
  const user = await getDbUserFromClerk(clerkId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const [poolExists] = await db
    .select({ id: dropinCourtPoolsTable.id })
    .from(dropinCourtPoolsTable)
    .where(eq(dropinCourtPoolsTable.dropinId, dropinId))
    .limit(1);
  if (poolExists) {
    res.status(400).json({ error: "This session has court pools — select a specific pool to register", hasPools: true });
    return;
  }

  const [dropin] = await db.select().from(dropinsTable).where(eq(dropinsTable.id, dropinId));
  if (!dropin) { res.status(404).json({ error: "Session not found" }); return; }
  if (dropin.status === "completed" || dropin.status === "cancelled") {
    res.status(409).json({ error: "Session has already ended and is no longer accepting registrations" }); return;
  }
  if (!isEventActive(dropin)) { res.status(403).json({ error: "Event is not currently active" }); return; }
  if (!dropin.registrationOpen) { res.status(409).json({ error: "Registration is not open for this session" }); return; }

  if (dropin.maxPlayers !== null) {
    const [{ flatCount }] = await db
      .select({ flatCount: sql<number>`count(*)` })
      .from(spotsTable)
      .where(and(
        eq(spotsTable.entityType, "dropin"),
        eq(spotsTable.entityId, dropinId),
        isNull(spotsTable.poolId),
        eq(spotsTable.status, "reserved"),
        eq(spotsTable.waitlisted, false),
      ));
    if (Number(flatCount) >= dropin.maxPlayers) {
      res.status(409).json({ error: "Session is full" }); return;
    }
  }

  const [existing] = await db.select().from(spotsTable).where(
    and(
      eq(spotsTable.entityType, "dropin"),
      eq(spotsTable.entityId, dropinId),
      eq(spotsTable.userId, user.id),
      eq(spotsTable.status, "reserved"),
      isNull(spotsTable.poolId),
    )
  );
  if (existing) { res.status(409).json({ error: "already_registered", message: "You already have an active spot for this session" }); return; }

  let spot: any;
  try {
    [spot] = await db.insert(spotsTable).values({
      entityType: "dropin",
      entityId: dropinId,
      poolId: null,
      userId: user.id,
      status: "reserved",
      paymentStatus: "unpaid",
      waitlisted: false,
      waitlistPosition: null,
      confirmedAt: new Date(),
    } as typeof spotsTable.$inferInsert).returning();
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "already_registered", message: "You already have an active spot for this session" });
      return;
    }
    throw err;
  }

  await writeAuditLog({
    actorClerkId: clerkId,
    actorUserId: user.id,
    action: "spot_rsvp_flat",
    entityType: "dropin_spot",
    entityId: spot.id,
    after: { dropinId, userId: user.id },
    notes: "RSVP via flat-path fallback (no pools)",
  });

  // Send registration confirmation email (free drop-in RSVP — no Stripe)
  sendRegistrationConfirmationEmail({
    recipientUserId: user.id,
    playerUserId: user.id,
    entityType: "drop_in",
    entityId: dropinId,
    poolId: null,
    amountPaid: 0,
  }).catch((err) => console.error("[dropins] flat RSVP confirmation email failed:", err));

  res.status(201).json(await enrichSpot(spot));
});

// Legacy override endpoint (kept for backward compat, redirects to PATCH)
router.patch("/dropins/:id/override", requirePermission("canManageDropins"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { activeOverride } = req.body;
  if (activeOverride !== null && activeOverride !== "active" && activeOverride !== "closed") {
    res.status(400).json({ error: "activeOverride must be 'active', 'closed', or null" }); return;
  }
  const [dropin] = await db.update(dropinsTable).set({ activeOverride: activeOverride ?? null, updatedAt: new Date() } as Partial<typeof dropinsTable.$inferInsert>).where(eq(dropinsTable.id, id)).returning();
  if (!dropin) { res.status(404).json({ error: "Drop-in session not found" }); return; }
  res.json(parseDropin(dropin));
});

// ─── Court Pools ───────────────────────────────────────────────────────────────

router.get("/dropins/:id/pools", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const pools = await db
    .select()
    .from(dropinCourtPoolsTable)
    .where(eq(dropinCourtPoolsTable.dropinId, id))
    .orderBy(asc(dropinCourtPoolsTable.startsAt), asc(dropinCourtPoolsTable.id));
  const poolIds = pools.map((p) => p.id);
  const counts = await poolSpotCounts(poolIds, { excludePaymentPending: true });
  const enriched = pools.map((p) => enrichPool(p, counts[p.id]));
  res.json(await Promise.all(enriched));
});

/**
 * POST /dropins/:id/pools
 * Create a pool with full logistics (startsAt, durationMinutes, price, etc.).
 */
router.post("/dropins/:id/pools", requirePermission("canManageDropins"), async (req, res): Promise<void> => {
  const dropinId = Number(req.params.id);
  const { courtId, skillLevel, cap, notes, startsAt, durationMinutes, price, cancellationWindowMinutes, refundPolicyId, registrationOpen, activeOverride, gender, cancellationPhaseOverrides } = req.body;
  const ageGroupArr = normalizeAgeGroup(req.body.ageGroup);
  if (!courtId || !ageGroupArr || !ageGroupArr.length) {
    res.status(400).json({ error: "courtId and ageGroup (at least one) are required" });
    return;
  }
  if (activeOverride !== undefined && activeOverride !== null && activeOverride !== "active" && activeOverride !== "closed") {
    res.status(400).json({ error: "activeOverride must be 'active', 'closed', or null" }); return;
  }
  const { offerWindowMinutes } = req.body;
  const scopeRaw = req.body.scope;
  const scope: "single" | "series" = scopeRaw === "series" ? "series" : "single";

  const poolValues = {
    dropinId,
    courtId: Number(courtId),
    ageGroup: ageGroupArr,
    skillLevel: skillLevel ?? "all",
    cap: Number(cap ?? 15),
    isClosed: false,
    notes: notes ?? null,
    startsAt: startsAt ? new Date(startsAt) : null,
    durationMinutes: Number(durationMinutes ?? 120),
    price: String(price ?? "0"),
    cancellationWindowMinutes: Number(cancellationWindowMinutes ?? 120),
    offerWindowMinutes: offerWindowMinutes != null ? Number(offerWindowMinutes) : 240,
    refundPolicyId: refundPolicyId != null ? Number(refundPolicyId) : null,
    cancellationPhaseOverrides: Array.isArray(cancellationPhaseOverrides) ? cancellationPhaseOverrides : null,
    registrationOpen: Boolean(registrationOpen),
    activeOverride: activeOverride ?? null,
    gender: gender ?? null,
  };

  const [pool] = await db.insert(dropinCourtPoolsTable).values(poolValues as any).returning();
  const enrichedPool = await enrichPool(pool, { spotsTaken: 0, waitlistCount: 0 });

  if (scope !== "series") {
    res.status(201).json(enrichedPool);
    return;
  }

  // ── Series cascade ────────────────────────────────────────────────────────
  const [session] = await db.select({ templateId: dropinsTable.templateId })
    .from(dropinsTable).where(eq(dropinsTable.id, dropinId));
  const templateId = session?.templateId;

  if (!templateId) {
    res.status(201).json({ pool: enrichedPool, cascaded: { count: 0 } });
    return;
  }

  // Fetch template first — needed for dayOfWeek and startTime fallback in poolsConfig entry
  const [template] = await db.select().from(sessionTemplatesTable).where(eq(sessionTemplatesTable.id, templateId));

  const now = new Date();
  const futureSessions = await db.select({ id: dropinsTable.id, startsAt: dropinsTable.startsAt })
    .from(dropinsTable)
    .where(and(
      eq(dropinsTable.templateId, templateId),
      sql`${dropinsTable.startsAt} >= ${now}`,
      sql`${dropinsTable.id} != ${dropinId}`,
      sql`${dropinsTable.status} NOT IN ('completed', 'cancelled')`,
    ));

  let cascadeCount = 0;

  if (futureSessions.length > 0) {
    const insertRows = futureSessions.map((s: any) => ({
      ...poolValues,
      dropinId: s.id,
      startsAt: poolValues.startsAt && s.startsAt
        ? (() => {
            const sourceEastern = _toEasternWallClock(new Date(poolValues.startsAt as any));
            const targetEastern = _toEasternWallClock(new Date(s.startsAt));
            return _easternLocalToUtc(
              targetEastern.getFullYear(), targetEastern.getMonth() + 1, targetEastern.getDate(),
              sourceEastern.getHours(), sourceEastern.getMinutes(),
            );
          })()
        : poolValues.startsAt,
    }));
    await db.insert(dropinCourtPoolsTable).values(insertRows as any[]);
    cascadeCount = futureSessions.length;
  }

  // Append to template's poolsConfig so future auto-generated sessions include this pool
  if (template) {
    const pad = (n: number) => String(n).padStart(2, "0");
    const existingConfig: any[] = Array.isArray(template.poolsConfig) ? template.poolsConfig as any[] : [];

    // Derive startTime: from submitted startsAt (Eastern wall-clock HH:MM), or fall back to template's startTime
    let resolvedStartTime: string = (template as any).startTime ?? "17:30";
    if (poolValues.startsAt) {
      const eastern = _toEasternWallClock(new Date(poolValues.startsAt as any));
      resolvedStartTime = `${pad(eastern.getHours())}:${pad(eastern.getMinutes())}`;
    }

    // dayOfWeek: use template's recurrence day so the scheduler places this pool on the right weekday
    const resolvedDayOfWeek: number = Number((template as any).dayOfWeek ?? 5);

    const newPoolConfig: any = {
      courtId: Number(courtId),
      ageGroup: ageGroupArr,
      skillLevel: skillLevel ?? "all",
      cap: Number(cap ?? 15),
      dayOfWeek: resolvedDayOfWeek,
      startTime: resolvedStartTime,
      durationMinutes: Number(durationMinutes ?? 120),
      cancellationWindowMinutes: Number(cancellationWindowMinutes ?? 120),
      price: String(price ?? "0"),
      gender: gender ?? null,
    };

    await db.update(sessionTemplatesTable)
      .set({ poolsConfig: [...existingConfig, newPoolConfig], updatedAt: new Date() } as Partial<typeof sessionTemplatesTable.$inferInsert>)
      .where(eq(sessionTemplatesTable.id, templateId));
  }

  res.status(201).json({ pool: enrichedPool, cascaded: { count: cascadeCount } });
});

// ── Eastern timezone helpers (used for startsAt cascade) ──────────────────────
function _toEasternWallClock(utc: Date): Date {
  return new Date(utc.toLocaleString("en-US", { timeZone: "America/New_York" }));
}
function _easternLocalToUtc(year: number, month: number, day: number, h: number, m: number): Date {
  const pad = (n: number) => String(n).padStart(2, "0");
  const isoStr = `${year}-${pad(month)}-${pad(day)}T${pad(h)}:${pad(m)}:00`;
  const utcRef = new Date(isoStr + "Z");
  const easternAtUtcRef = new Date(utcRef.toLocaleString("en-US", { timeZone: "America/New_York" }));
  return new Date(utcRef.getTime() + (utcRef.getTime() - easternAtUtcRef.getTime()));
}

/**
 * PATCH /dropins/:id/pools/:poolId
 * Update pool — including all logistics fields.
 * Accepts optional `scope: "single" | "series"` (body or query param).
 * When scope=series, cascades logistics changes to all matching future pools
 * in the same template series and updates the template's poolsConfig.
 * Returns { pool, cascaded: { count } } when scope=series.
 */
router.patch("/dropins/:id/pools/:poolId", requirePermission("canManageDropins"), async (req, res): Promise<void> => {
  const dropinId = Number(req.params.id);
  const poolId = Number(req.params.poolId);
  const scopeRaw = req.body.scope ?? req.query.scope;
  const scope: "single" | "series" = scopeRaw === "series" ? "series" : "single";

  const allowed = ["cap", "courtId", "isClosed", "ageGroup", "skillLevel", "notes", "startsAt", "durationMinutes", "price", "cancellationWindowMinutes", "offerWindowMinutes", "refundPolicyId", "registrationOpen", "activeOverride", "gender", "cancellationPhaseOverrides", "simplifiedRegistration"];
  const patch: Record<string, any> = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) {
      if (k === "cap" || k === "durationMinutes" || k === "cancellationWindowMinutes" || k === "offerWindowMinutes") patch[k] = Number(req.body[k]);
      else if (k === "refundPolicyId") patch[k] = req.body[k] != null ? Number(req.body[k]) : null;
      else if (k === "price") patch[k] = String(req.body[k]);
      else if (k === "startsAt") patch[k] = req.body[k] ? new Date(req.body[k]) : null;
      else if (k === "ageGroup") {
        const arr = normalizeAgeGroup(req.body[k]);
        if (arr && arr.length > 0) patch[k] = arr;
      } else if (k === "cancellationPhaseOverrides") {
        patch[k] = Array.isArray(req.body[k]) ? req.body[k] : null;
      } else patch[k] = req.body[k];
    }
  }

  // Guard: simplified registration cannot be enabled on paid pools
  if (patch.simplifiedRegistration === true) {
    const priceInPatch = patch.price !== undefined ? Number(patch.price) : null;
    if (priceInPatch === null) {
      const [checkPool] = await db.select({ price: dropinCourtPoolsTable.price }).from(dropinCourtPoolsTable).where(eq(dropinCourtPoolsTable.id, poolId));
      if (checkPool && Number(checkPool.price) > 0) {
        res.status(400).json({ error: "Simplified registration can only be enabled on free ($0) pools" }); return;
      }
    } else if (priceInPatch > 0) {
      res.status(400).json({ error: "Simplified registration can only be enabled on free ($0) pools" }); return;
    }
  }

  // Read original pool BEFORE patching so we can match future pools by original courtId/ageGroup
  const [originalPool] = await db.select().from(dropinCourtPoolsTable)
    .where(and(eq(dropinCourtPoolsTable.id, poolId), eq(dropinCourtPoolsTable.dropinId, dropinId)));
  if (!originalPool) { res.status(404).json({ error: "Pool not found" }); return; }

  const [pool] = await db.update(dropinCourtPoolsTable).set({ ...patch, updatedAt: new Date() } as Partial<typeof dropinCourtPoolsTable.$inferInsert>)
    .where(and(eq(dropinCourtPoolsTable.id, poolId), eq(dropinCourtPoolsTable.dropinId, dropinId)))
    .returning();
  if (!pool) { res.status(404).json({ error: "Pool not found" }); return; }
  const counts = await poolSpotCounts([pool.id]);
  const enrichedPool = await enrichPool(pool, counts[pool.id]);

  // When a pool is closed, cancel all waitlisted spots and notify players
  if (patch.isClosed === true) {
    try {
      const waitlistedSpots = await db.select().from(spotsTable).where(
        and(
          eq(spotsTable.poolId, poolId),
          eq(spotsTable.entityType, "dropin"),
          eq(spotsTable.waitlisted, true),
          sql`${spotsTable.status} != 'cancelled'`,
        )
      );
      if (waitlistedSpots.length > 0) {
        await db.update(spotsTable)
          .set({ status: "cancelled", cancelledAt: new Date(), cancellationReason: "pool_closed", updatedAt: new Date() } as Partial<typeof spotsTable.$inferInsert>)
          .where(
            and(
              eq(spotsTable.poolId, poolId),
              eq(spotsTable.entityType, "dropin"),
              eq(spotsTable.waitlisted, true),
              sql`${spotsTable.status} != 'cancelled'`,
            )
          );
        const stripeClient = await getUncachableStripeClient();
        const [dropinForNotif] = await db.select({ name: dropinsTable.name }).from(dropinsTable).where(eq(dropinsTable.id, dropinId));
        const uniqueUserIds = [...new Set(waitlistedSpots.map((s: any) => s.userId).filter(Boolean))];
        for (const spot of waitlistedSpots) {
          const sid: string | null = (spot as any).stripeCheckoutSessionId ?? null;
          if (sid) { try { await (stripeClient.checkout.sessions.expire as any)(sid); } catch {} }
        }
        for (const uid of uniqueUserIds) {
          try {
            await sendMultiChannelNotification(["in_app", "email"], {
              userId: uid as number,
              type: "session_cancelled",
              subject: `${dropinForNotif?.name ?? "Drop-in"} pool has closed`,
              body: `The ${dropinForNotif?.name ?? "drop-in"} pool you were waitlisted for is no longer accepting players. Your waitlist spot has been removed.`,
              metadata: { dropinId, poolId },
            });
          } catch {}
        }
      }
    } catch (cleanupErr) {
      console.error("[PATCH /pools/:poolId] Waitlist cleanup on close failed:", cleanupErr);
    }
  }

  if (scope !== "series" || !pool.templateId) {
    res.json(enrichedPool);
    return;
  }

  // ── Series cascade ─────────────────────────────────────────────────────────
  const templateId = pool.templateId;
  const matchCourtId = originalPool.courtId;
  const matchAgeGroup: string[] = Array.isArray(originalPool.ageGroup) ? originalPool.ageGroup : [originalPool.ageGroup as string];

  // Extract new time-of-day from patched startsAt (used for per-pool startsAt cascade)
  let newEasternH: number | null = null;
  let newEasternM: number | null = null;
  if (patch.startsAt) {
    const eastern = _toEasternWallClock(new Date(patch.startsAt));
    newEasternH = eastern.getHours();
    newEasternM = eastern.getMinutes();
  }

  // Find all future dropin sessions in the same template series (excluding current session)
  const now = new Date();
  const futureSessions = await db.select({ id: dropinsTable.id })
    .from(dropinsTable)
    .where(and(
      eq(dropinsTable.templateId, templateId),
      sql`${dropinsTable.startsAt} >= ${now}`,
      sql`${dropinsTable.id} != ${dropinId}`,
      sql`${dropinsTable.status} NOT IN ('completed', 'cancelled')`,
    ));

  let cascadeCount = 0;

  if (futureSessions.length > 0 && matchAgeGroup.length === 0) {
    res.json({ ...enrichedPool, cascadeCount: 0, cascadeWarning: "ageGroup is empty — future pool cascade skipped to avoid unintended matches" });
    return;
  }

  if (futureSessions.length > 0) {
    const futureSessionIds = futureSessions.map(s => s.id);

    // Find matching pools: same courtId + ageGroup
    const futurePools = await db.select()
      .from(dropinCourtPoolsTable)
      .where(and(
        inArray(dropinCourtPoolsTable.dropinId, futureSessionIds),
        eq(dropinCourtPoolsTable.courtId, matchCourtId),
        sql`${dropinCourtPoolsTable.ageGroup} = ARRAY[${sql.join(matchAgeGroup.map((a: string) => sql`${a}`), sql`, `)}]::text[]`,
      ));

    // Logistics fields that cascade directly (courtId excluded per spec)
    const directFields = ["cap", "isClosed", "ageGroup", "skillLevel", "notes", "durationMinutes", "price", "cancellationWindowMinutes", "cancellationPhaseOverrides", "registrationOpen", "activeOverride", "gender"];
    const cascadeBase: Record<string, any> = { updatedAt: new Date() };
    for (const k of directFields) {
      if (patch[k] !== undefined) cascadeBase[k] = patch[k];
    }

    for (const fp of futurePools) {
      const fpPatch: Record<string, any> = { ...cascadeBase };

      // Cascade startsAt: keep this pool's date, apply new time-of-day
      if (newEasternH !== null && fp.startsAt) {
        const fpEastern = _toEasternWallClock(new Date(fp.startsAt));
        fpPatch.startsAt = _easternLocalToUtc(
          fpEastern.getFullYear(), fpEastern.getMonth() + 1, fpEastern.getDate(),
          newEasternH!, newEasternM!,
        );
      }

      await db.update(dropinCourtPoolsTable)
        .set(fpPatch as any)
        .where(eq(dropinCourtPoolsTable.id, fp.id));
      cascadeCount++;
    }
  }

  // Update matching entry in template's poolsConfig so newly generated sessions inherit changes
  const [template] = await db.select().from(sessionTemplatesTable).where(eq(sessionTemplatesTable.id, templateId));
  if (template?.poolsConfig && Array.isArray(template.poolsConfig) && template.poolsConfig.length > 0) {
    const updatedPoolsConfig = (template.poolsConfig as any[]).map((pc: any) => {
      const pcAge: string[] = Array.isArray(pc.ageGroup) ? pc.ageGroup : [pc.ageGroup];
      const ageMatch = JSON.stringify([...pcAge].sort()) === JSON.stringify([...matchAgeGroup].sort());
      if (pc.courtId !== matchCourtId || !ageMatch) return pc;
      const updated: any = { ...pc };
      if (patch.cap !== undefined) updated.cap = patch.cap;
      if (patch.skillLevel !== undefined) updated.skillLevel = patch.skillLevel;
      if (patch.ageGroup !== undefined) updated.ageGroup = patch.ageGroup;
      if (patch.gender !== undefined) updated.gender = patch.gender;
      if (patch.durationMinutes !== undefined) updated.durationMinutes = patch.durationMinutes;
      if (patch.price !== undefined) updated.price = patch.price;
      if (patch.cancellationWindowMinutes !== undefined) updated.cancellationWindowMinutes = patch.cancellationWindowMinutes;
      if (newEasternH !== null) {
        const pad = (n: number) => String(n).padStart(2, "0");
        updated.startTime = `${pad(newEasternH!)}:${pad(newEasternM!)}`;
      }
      return updated;
    });
    await db.update(sessionTemplatesTable)
      .set({ poolsConfig: updatedPoolsConfig, updatedAt: new Date() } as Partial<typeof sessionTemplatesTable.$inferInsert>)
      .where(eq(sessionTemplatesTable.id, templateId));
  }

  res.json({ pool: enrichedPool, cascaded: { count: cascadeCount } });
});

router.delete("/dropins/:id/pools/:poolId", requirePermission("canManageDropins"), async (req, res): Promise<void> => {
  const dropinId = Number(req.params.id);
  const poolId = Number(req.params.poolId);
  const [deleted] = await db.delete(dropinCourtPoolsTable)
    .where(and(eq(dropinCourtPoolsTable.id, poolId), eq(dropinCourtPoolsTable.dropinId, dropinId)))
    .returning();
  if (!deleted) { res.status(404).json({ error: "Pool not found" }); return; }
  res.sendStatus(204);
});

// ─── RSVP / Spots ──────────────────────────────────────────────────────────────

/**
 * POST /dropins/pools/:poolId/rsvp
 * Registration for a specific pool. Reads logistics (registrationOpen, activeOverride, startsAt) from the pool.
 */
router.post("/dropins/pools/:poolId/rsvp", requireAuth, async (req, res): Promise<void> => {
  const poolId = Number(req.params.poolId);
  const clerkId = (req as AuthedRequest).clerkUserId;
  const user = await getDbUserFromClerk(clerkId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const [pool] = await db.select().from(dropinCourtPoolsTable).where(eq(dropinCourtPoolsTable.id, poolId));
  if (!pool) { res.status(404).json({ error: "Pool not found" }); return; }
  if (pool.isClosed) { res.status(400).json({ error: "Pool is closed" }); return; }

  const [dropin] = await db.select().from(dropinsTable).where(eq(dropinsTable.id, pool.dropinId));
  if (!dropin) { res.status(404).json({ error: "Session not found" }); return; }
  if (dropin.status === "completed" || dropin.status === "cancelled") {
    res.status(409).json({ error: "Session has already ended and is no longer accepting registrations" }); return;
  }

  // Use pool-level registrationOpen and activeOverride
  if (!pool.registrationOpen) { res.status(409).json({ error: "Registration is not open for this pool" }); return; }

  // Optional: guardian registering a child
  const rawPlayerUserId = req.body?.playerUserId;
  const playerUserId = rawPlayerUserId ? Number(rawPlayerUserId) : null;
  let targetUserId = user.id;
  let guardianUserIdForSpot: number | null = null;

  if (playerUserId && playerUserId !== user.id) {
    const [link] = await db.select().from(guardiansTable).where(
      and(
        eq(guardiansTable.guardianUserId, user.id),
        eq(guardiansTable.youthUserId, playerUserId),
        eq(guardiansTable.status, "approved" as any),
        eq(guardiansTable.canRegister, true),
      )
    );
    if (!link) {
      res.status(403).json({ error: "No approved guardian relationship found for this player" }); return;
    }
    const [playerUser] = await db.select().from(usersTable).where(eq(usersTable.id, playerUserId));
    if (!playerUser) { res.status(422).json({ error: "Player not found" }); return; }
    // Use pool.startsAt for age eligibility
    const ageCheckDate = pool.startsAt ?? dropin.startsAt;
    const waivedGroups = await getPlayerWaivedGroups(playerUserId);
    const ageError = checkUsysAgeEligibility(pool.ageGroup, playerUser.dateOfBirth, ageCheckDate, waivedGroups);
    if (ageError) { res.status(422).json({ error: ageError }); return; }
    targetUserId = playerUserId;
    guardianUserIdForSpot = user.id;
  }

  const [existing] = await db.select().from(spotsTable).where(
    and(
      eq(spotsTable.poolId, poolId),
      eq(spotsTable.userId, targetUserId),
      eq(spotsTable.entityType, "dropin"),
      eq(spotsTable.entityId, pool.dropinId),
      eq(spotsTable.status, "reserved"),
    )
  );
  if (existing) { res.status(409).json({ error: "already_registered", message: "This player already has an active spot for this pool" }); return; }

  // Belt-and-suspenders: also block if a guest spot (user_id IS NULL) exists for this user's email.
  // This handles the window before GET /me has had a chance to link the spot.
  if (user.email && !user.email.endsWith("@playon.local")) {
    const [existingGuest] = await db.select({ id: spotsTable.id }).from(spotsTable).where(
      and(
        eq(spotsTable.poolId, poolId),
        sql`user_id IS NULL`,
        sql`LOWER(guest_email) = ${user.email}`,
        eq(spotsTable.entityType, "dropin"),
        eq(spotsTable.entityId, pool.dropinId),
        eq(spotsTable.status, "reserved"),
      )
    );
    if (existingGuest) { res.status(409).json({ error: "already_registered", message: "This player already has an active spot for this pool" }); return; }
  }

  const counts = await poolSpotCounts([poolId]);
  const { spotsTaken, waitlistCount } = counts[poolId] ?? { spotsTaken: 0, waitlistCount: 0 };
  const isFull = spotsTaken >= pool.cap;

  let waitlistPosition: number | null = null;
  if (isFull) {
    waitlistPosition = waitlistCount + 1;
  }

  let spot: any;
  try {
    [spot] = await db.insert(spotsTable).values({
      entityType: "dropin",
      entityId: pool.dropinId,
      poolId,
      userId: targetUserId,
      guardianUserId: guardianUserIdForSpot,
      status: "reserved",
      paymentStatus: "unpaid",
      waitlisted: isFull,
      waitlistPosition: waitlistPosition ?? null,
      confirmedAt: isFull ? null : new Date(),
    } as typeof spotsTable.$inferInsert).returning();
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "already_registered", message: "This player already has an active spot for this pool" });
      return;
    }
    throw err;
  }

  // Send confirmation email for free, non-waitlisted spots (Stripe-less path)
  const poolPrice = Number(pool.price ?? 0);
  if (!isFull && poolPrice <= 0) {
    const recipientUserId = guardianUserIdForSpot ?? targetUserId;
    sendRegistrationConfirmationEmail({
      recipientUserId,
      playerUserId: targetUserId,
      entityType: "drop_in",
      entityId: pool.dropinId,
      poolId,
      amountPaid: 0,
    }).catch((err) => console.error("[dropins] pool RSVP confirmation email failed:", err));
  }

  res.status(201).json(await enrichSpot(spot));
});

/**
 * POST /dropins/pools/:poolId/rsvp/guest
 * Unauthenticated registration for pools with simplified_registration=true and price=0.
 * Accepts { name, email }. Creates a reserved spot with guest_name/guest_email and sends
 * a confirmation email with a QR code.
 */
router.post("/dropins/pools/:poolId/rsvp/guest", async (req, res): Promise<void> => {
  const poolId = Number(req.params.poolId);
  const { name, email } = req.body ?? {};

  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "Name is required" }); return;
  }
  if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    res.status(400).json({ error: "A valid email address is required" }); return;
  }

  const guestName = name.trim();
  const guestEmail = email.trim().toLowerCase();

  const [pool] = await db.select().from(dropinCourtPoolsTable).where(eq(dropinCourtPoolsTable.id, poolId));
  if (!pool) { res.status(404).json({ error: "Pool not found" }); return; }

  if (!(pool as any).simplifiedRegistration) {
    res.status(403).json({ error: "This pool does not allow simplified guest registration" }); return;
  }
  if (Number(pool.price ?? 0) > 0) {
    res.status(403).json({ error: "Simplified registration is only available for free pools" }); return;
  }
  if (pool.isClosed) { res.status(400).json({ error: "Pool is closed" }); return; }
  if (!pool.registrationOpen) { res.status(409).json({ error: "Registration is not open for this pool" }); return; }

  const [dropin] = await db.select().from(dropinsTable).where(eq(dropinsTable.id, pool.dropinId));
  if (!dropin) { res.status(404).json({ error: "Session not found" }); return; }
  if (dropin.status === "completed" || dropin.status === "cancelled") {
    res.status(409).json({ error: "Session is no longer accepting registrations" }); return;
  }

  // Check capacity
  const counts = await poolSpotCounts([poolId]);
  const { spotsTaken } = counts[poolId] ?? { spotsTaken: 0, waitlistCount: 0 };
  if (spotsTaken >= pool.cap) {
    res.status(409).json({ error: "This pool is full" }); return;
  }

  // Check for duplicate guest registration by email on this pool
  const _guestCheckResult = await db.execute(sql`
    SELECT id FROM spots
    WHERE pool_id = ${poolId}
      AND entity_type = 'dropin'
      AND entity_id = ${pool.dropinId}
      AND status = 'reserved'
      AND guest_email = ${guestEmail}
    LIMIT 1
  `);
  const _guestCheckRows = Array.isArray(_guestCheckResult) ? _guestCheckResult : (_guestCheckResult as any).rows ?? [];
  const existingGuest = _guestCheckRows[0];
  if (existingGuest) {
    res.status(409).json({ error: "already_registered", message: "This email is already registered for this pool" }); return;
  }

  const [spot] = await db.insert(spotsTable).values({
    entityType: "dropin",
    entityId: pool.dropinId,
    poolId,
    userId: null,
    status: "reserved",
    paymentStatus: "unpaid",
    waitlisted: false,
    confirmedAt: new Date(),
  } as typeof spotsTable.$inferInsert).returning();

  // Store guest fields via raw SQL since Drizzle types don't reflect new columns yet
  await db.execute(sql`
    UPDATE spots SET guest_name = ${guestName}, guest_email = ${guestEmail}
    WHERE id = ${spot.id}
  `);

  // Send confirmation email with QR code
  try {
    const { renderEmail } = await import("../services/emailTemplate");
    const { sendEmail } = await import("../services/email");
    const { generateQrDataUri } = await import("../services/qr");

    const qrPayload = JSON.stringify({ spotId: spot.id, dropinId: dropin.id, sessionName: dropin.name, poolId });
    const qrDataUri = await generateQrDataUri(qrPayload);

    const appUrl = (process.env.PUBLIC_APP_URL ?? "https://playonfutsal.vercel.app").replace(/\/$/, "");
    const eventDate = dropin.startsAt ? new Date(dropin.startsAt).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : "See event page";

    const { html, text } = renderEmail({
      subject: `You're in! Your spot for ${dropin.name}`,
      preheader: `Your guest spot is confirmed. Show this QR code at check-in.`,
      heading: `You're registered for ${dropin.name}!`,
      bodyParagraphs: [
        `Hi ${guestName},`,
        `Your spot is confirmed for ${dropin.name} on ${eventDate}. Show the QR code below at check-in.`,
        `Spot #${spot.id} · Guest registration`,
      ],
      cta: { label: "View Event", url: `${appUrl}/dropins/${dropin.id}` },
    });

    // Embed QR code image inline after HTML body — append before closing </body>
    const qrBlock = `<div style="text-align:center;padding:24px 0;"><p style="margin:0 0 12px;font-size:13px;color:#64748b;font-family:sans-serif;">Your check-in QR code</p><img src="${qrDataUri}" width="180" height="180" alt="Check-in QR code" style="border-radius:12px;" /></div>`;
    const htmlWithQr = html.replace("</body>", `${qrBlock}</body>`);

    await sendEmail({ to: guestEmail, subject: `You're in! Your spot for ${dropin.name}`, html: htmlWithQr, text: `${text}\n\nSpot #${spot.id} (Guest). Show the QR code at check-in.` });
  } catch (emailErr) {
    console.error("[guest-rsvp] confirmation email failed:", emailErr);
  }

  // Return the spot with guest details and QR payload for immediate display
  const qrPayload = JSON.stringify({ spotId: spot.id, dropinId: dropin.id, sessionName: dropin.name, poolId });
  res.status(201).json({ ...spot, guestName, guestEmail, qrPayload });
});

/**
 * POST /dropins/pools/:poolId/waitlist
 * Explicitly join the waitlist for a full pool (paid or free).
 * Returns 409 if the pool is not full (use /checkout or /rsvp instead).
 */
router.post("/dropins/pools/:poolId/waitlist", requireAuth, async (req, res): Promise<void> => {
  const poolId = Number(req.params.poolId);
  const clerkId = (req as AuthedRequest).clerkUserId;
  const user = await getDbUserFromClerk(clerkId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const [pool] = await db.select().from(dropinCourtPoolsTable).where(eq(dropinCourtPoolsTable.id, poolId));
  if (!pool) { res.status(404).json({ error: "Pool not found" }); return; }
  if (pool.isClosed) { res.status(400).json({ error: "Pool is closed" }); return; }

  const [dropin] = await db.select().from(dropinsTable).where(eq(dropinsTable.id, pool.dropinId));
  if (!dropin) { res.status(404).json({ error: "Session not found" }); return; }
  if (dropin.status === "completed" || dropin.status === "cancelled") {
    res.status(409).json({ error: "Session has already ended" }); return;
  }
  if (!pool.registrationOpen) { res.status(409).json({ error: "Registration is not open for this pool" }); return; }

  const rawPlayerUserId = req.body?.playerUserId;
  const playerUserId = rawPlayerUserId ? Number(rawPlayerUserId) : null;
  let targetUserId = user.id;
  let guardianUserIdForSpot: number | null = null;

  if (playerUserId && playerUserId !== user.id) {
    const [link] = await db.select().from(guardiansTable).where(
      and(
        eq(guardiansTable.guardianUserId, user.id),
        eq(guardiansTable.youthUserId, playerUserId),
        eq(guardiansTable.status, "approved" as any),
        eq(guardiansTable.canRegister, true),
      )
    );
    if (!link) { res.status(403).json({ error: "No approved guardian relationship found" }); return; }
    targetUserId = playerUserId;
    guardianUserIdForSpot = user.id;
  }

  const [existing] = await db.select().from(spotsTable).where(
    and(
      eq(spotsTable.poolId, poolId),
      eq(spotsTable.userId, targetUserId),
      eq(spotsTable.entityType, "dropin"),
      eq(spotsTable.entityId, pool.dropinId),
      eq(spotsTable.status, "reserved"),
    )
  );
  if (existing) { res.status(409).json({ error: "already_registered", message: "Already has an active spot for this pool" }); return; }

  // Belt-and-suspenders: also block if a guest spot (user_id IS NULL) exists for this user's email.
  // This handles the window before GET /me has had a chance to link the spot.
  if (user.email && !user.email.endsWith("@playon.local")) {
    const [existingGuest] = await db.select({ id: spotsTable.id }).from(spotsTable).where(
      and(
        eq(spotsTable.poolId, poolId),
        sql`user_id IS NULL`,
        sql`LOWER(guest_email) = ${user.email}`,
        eq(spotsTable.entityType, "dropin"),
        eq(spotsTable.entityId, pool.dropinId),
        eq(spotsTable.status, "reserved"),
      )
    );
    if (existingGuest) { res.status(409).json({ error: "already_registered", message: "Already has an active spot for this pool" }); return; }
  }

  const counts = await poolSpotCounts([poolId]);
  const { spotsTaken, waitlistCount } = counts[poolId] ?? { spotsTaken: 0, waitlistCount: 0 };
  if (spotsTaken < pool.cap) {
    res.status(409).json({ error: "pool_has_spots", message: "Pool has open spots — use checkout or rsvp instead" }); return;
  }

  const waitlistPosition = waitlistCount + 1;
  let spot: any;
  try {
    [spot] = await db.insert(spotsTable).values({
      entityType: "dropin",
      entityId: pool.dropinId,
      poolId,
      userId: targetUserId,
      guardianUserId: guardianUserIdForSpot,
      status: "reserved",
      paymentStatus: "unpaid",
      waitlisted: true,
      waitlistPosition,
      confirmedAt: null,
    } as typeof spotsTable.$inferInsert).returning();
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "already_registered", message: "Already has an active spot for this pool" });
      return;
    }
    throw err;
  }

  await writeAuditLog({
    actorClerkId: clerkId,
    actorUserId: user.id,
    action: "spot_waitlisted",
    entityType: "dropin_spot",
    entityId: spot.id,
    after: { poolId, dropinId: pool.dropinId, waitlistPosition },
    notes: "Joined waitlist via /waitlist endpoint",
  });

  res.status(201).json(await enrichSpot(spot));
});

/**
 * POST /dropins/pools/:poolId/checkout
 * Inline Stripe payment for paid pools. Reads price and registration checks from the pool.
 */
router.post("/dropins/pools/:poolId/checkout", requireAuth, async (req, res): Promise<void> => {
  const poolId = Number(req.params.poolId);
  const clerkId = (req as AuthedRequest).clerkUserId;
  const user = await getDbUserFromClerk(clerkId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const [pool] = await db.select().from(dropinCourtPoolsTable).where(eq(dropinCourtPoolsTable.id, poolId));
  if (!pool) { res.status(404).json({ error: "Pool not found" }); return; }
  if (pool.isClosed) { res.status(400).json({ error: "Pool is closed" }); return; }

  const [dropin] = await db.select().from(dropinsTable).where(eq(dropinsTable.id, pool.dropinId));
  if (!dropin) { res.status(404).json({ error: "Session not found" }); return; }
  if (dropin.status === "completed" || dropin.status === "cancelled") {
    res.status(409).json({ error: "Session has already ended and is no longer accepting registrations" }); return;
  }

  // Use pool-level checks
  if (!pool.registrationOpen) { res.status(409).json({ error: "Registration is not open for this pool" }); return; }

  // Price comes from the pool
  const poolPrice = Number(pool.price ?? 0);
  if (poolPrice <= 0) { res.status(400).json({ error: "Use the RSVP endpoint for free pools" }); return; }

  // Optional: guardian registering a child
  const rawPlayerUserId = req.body?.playerUserId;
  const playerUserId = rawPlayerUserId ? Number(rawPlayerUserId) : null;
  let targetUserId = user.id;
  let guardianUserIdForSpot: number | null = null;

  if (playerUserId && playerUserId !== user.id) {
    const [link] = await db.select().from(guardiansTable).where(
      and(
        eq(guardiansTable.guardianUserId, user.id),
        eq(guardiansTable.youthUserId, playerUserId),
        eq(guardiansTable.status, "approved" as any),
        eq(guardiansTable.canRegister, true),
      )
    );
    if (!link) {
      res.status(403).json({ error: "No approved guardian relationship found for this player" }); return;
    }
    const [playerUser] = await db.select().from(usersTable).where(eq(usersTable.id, playerUserId));
    if (!playerUser) { res.status(422).json({ error: "Player not found" }); return; }
    const ageCheckDate = pool.startsAt ?? dropin.startsAt;
    const waivedGroups2 = await getPlayerWaivedGroups(playerUserId);
    const ageError = checkUsysAgeEligibility(pool.ageGroup, playerUser.dateOfBirth, ageCheckDate, waivedGroups2);
    if (ageError) { res.status(422).json({ error: ageError }); return; }
    targetUserId = playerUserId;
    guardianUserIdForSpot = user.id;
  }

  const counts = await poolSpotCounts([poolId], { excludePaymentPending: true });
  const { spotsTaken } = counts[poolId] ?? { spotsTaken: 0 };
  if (spotsTaken >= pool.cap) { res.status(409).json({ error: "Pool is full" }); return; }

  const existingSpots = await db.select().from(spotsTable).where(
    and(eq(spotsTable.poolId, poolId), eq(spotsTable.userId, targetUserId), eq(spotsTable.entityType, "dropin"), eq(spotsTable.entityId, pool.dropinId))
  );
  if (existingSpots.some((s: any) => s.status !== "cancelled")) {
    res.status(409).json({ error: "already_registered", message: "This player already has an active spot for this pool" }); return;
  }

  // Belt-and-suspenders: also block if a guest spot (user_id IS NULL) exists for this user's email.
  // This handles the window before GET /me has had a chance to link the spot.
  if (user.email && !user.email.endsWith("@playon.local")) {
    const [existingGuest] = await db.select({ id: spotsTable.id }).from(spotsTable).where(
      and(
        eq(spotsTable.poolId, poolId),
        sql`user_id IS NULL`,
        sql`LOWER(guest_email) = ${user.email}`,
        eq(spotsTable.entityType, "dropin"),
        eq(spotsTable.entityId, pool.dropinId),
        eq(spotsTable.status, "reserved"),
      )
    );
    if (existingGuest) { res.status(409).json({ error: "already_registered", message: "This player already has an active spot for this pool" }); return; }
  }

  // Re-compute effective price at purchase time if pool was materialized from a dropin_template.
  // This ensures spot-count and date-triggered early-bird transitions are honoured even if
  // pool.price was set when fewer spots had been taken.
  const finalPrice = await (async (): Promise<number> => {
    const tpResult = await db.execute(sql`
      SELECT tp.early_bird_pricing, tp.price AS base_price
      FROM dropin_template_pools tp
      JOIN dropin_occurrences occ ON occ.template_id = tp.template_id
      WHERE occ.materialized_dropin_id = ${dropin.id}
        AND tp.court_id = ${pool.courtId}
      LIMIT 1
    `);
    const tpRows = Array.isArray(tpResult) ? tpResult : (tpResult as any).rows ?? [];
    const tp = tpRows[0];
    if (!tp || !tp.early_bird_pricing) return poolPrice;

    const eb = typeof tp.early_bird_pricing === "string"
      ? JSON.parse(tp.early_bird_pricing)
      : tp.early_bird_pricing;
    const basePrice = Number(tp.base_price ?? poolPrice);
    const now = new Date();

    if (eb.triggerType === "date" && eb.triggerDate) {
      if (now <= new Date(eb.triggerDate + "T23:59:59Z")) return Number(eb.price);
    } else if (eb.triggerType === "spots_taken" && eb.triggerSpotsCount != null) {
      const remaining = (pool.cap ?? 15) - spotsTaken;
      if (remaining >= Number(eb.triggerSpotsCount)) return Number(eb.price);
    }
    return basePrice;
  })();

  // Atomically keep pool.price current so webhooks and admin views reflect reality
  if (finalPrice !== poolPrice) {
    await db.execute(sql`UPDATE dropin_court_pools SET price = ${finalPrice} WHERE id = ${poolId}`);
  }

  const stripe = await getUncachableStripeClient();
  const { getStripePublishableKey } = await import("../lib/stripe");

  // ── Discount code — canonical validation matching /checkout/session ───────────
  const rawDiscountCode = (req.body?.discountCode ?? "").trim().toUpperCase();
  const rawUseCredits: boolean = req.body?.useCredits === true;

  let discountCodeId: number | null = null;
  let discountAmount = 0;
  if (rawDiscountCode) {
    const [dc] = await db.select().from(discountCodesTable).where(
      and(eq(discountCodesTable.code, rawDiscountCode), eq(discountCodesTable.isActive, true))
    );
    if (!dc) { res.status(422).json({ error: "Invalid or inactive discount code" }); return; }
    const now = new Date();
    if (dc.maxUses != null && (dc as any).timesUsed >= dc.maxUses) {
      res.status(422).json({ error: "Discount code has reached its usage limit" }); return;
    }
    if ((dc as any).validFrom && new Date((dc as any).validFrom) > now) {
      res.status(422).json({ error: "Discount code is not yet active" }); return;
    }
    if ((dc as any).validUntil && new Date((dc as any).validUntil) < now) {
      res.status(422).json({ error: "Discount code has expired" }); return;
    }
    if ((dc as any).minOrderAmount && finalPrice < Number((dc as any).minOrderAmount)) {
      res.status(422).json({ error: `Minimum order amount of $${(dc as any).minOrderAmount} required` }); return;
    }
    // applicableTo gate: "all" | "league" | "camp" | "drop_in" | "tournament" | "specific"
    if (dc.applicableTo !== "all") {
      const typeGates = ["league", "camp", "drop_in", "tournament"];
      if (typeGates.includes(dc.applicableTo as string) && dc.applicableTo !== "drop_in") {
        res.status(422).json({ error: `Discount code is only valid for ${(dc.applicableTo as string).replace("_", " ")} registrations` }); return;
      }
      if (dc.applicableTo === "specific") {
        if ((dc as any).entityType && (dc as any).entityType !== "drop_in") {
          res.status(422).json({ error: "Discount code not applicable to this offering type" }); return;
        }
        if ((dc as any).entityId && (dc as any).entityId !== pool.dropinId) {
          res.status(422).json({ error: "Discount code not applicable to this specific offering" }); return;
        }
      }
    }
    discountCodeId = dc.id;
    if (dc.discountType === "percent") {
      discountAmount = finalPrice * (Number(dc.discountValue) / 100);
    } else {
      discountAmount = Math.min(Number(dc.discountValue ?? 0), finalPrice);
    }
    discountAmount = Math.round(discountAmount * 100) / 100;
  }
  const priceAfterDiscount = Math.max(0, finalPrice - discountAmount);

  // ── Account credits (remainingAmount-based, race-safe CAS pattern) ───────────
  let creditApplied = 0;
  const reservedCreditIds: Array<{ id: number; consumed: number }> = [];
  if (rawUseCredits && priceAfterDiscount > 0) {
    const creditsNow = new Date();
    const credits = await db.select().from(accountCreditsTable).where(
      and(
        eq(accountCreditsTable.userId, user.id),
        or(isNull(accountCreditsTable.expiresAt), gt(accountCreditsTable.expiresAt, creditsNow)),
        sql`${accountCreditsTable.remainingAmount} > 0`,
      )
    );
    let toApply = priceAfterDiscount;
    for (const credit of credits) {
      if (toApply <= 0) break;
      const avail = Number(credit.remainingAmount);
      if (avail <= 0) continue;
      const consume = Math.min(avail, toApply);
      const updated = await db.update(accountCreditsTable)
        .set({ remainingAmount: String(avail - consume), usedAt: new Date(), updatedAt: new Date() } as Partial<typeof accountCreditsTable.$inferInsert>)
        .where(and(
          eq(accountCreditsTable.id, credit.id),
          sql`${accountCreditsTable.remainingAmount} >= ${String(consume)}`,
        ))
        .returning();
      if (updated.length > 0) {
        reservedCreditIds.push({ id: credit.id, consumed: consume });
        creditApplied += consume;
        toApply -= consume;
      }
    }
  }
  const priceAfterCredits = Math.max(0, priceAfterDiscount - creditApplied);

  // Service fee is computed on the post-discount, post-credit price so that
  // credit-only paths correctly yield totalAmount = 0 and Stripe is skipped.
  const feeSplit = await computeRevenueSplit({
    entityType: "drop_in",
    entityId: pool.dropinId,
    category: "drop_in",
    grossAmount: priceAfterCredits,
    paymentMethod: "card",
  });
  const serviceFeeAmount = feeSplit.serviceFeeAmount;
  const totalAmount = priceAfterCredits + serviceFeeAmount;

  const sharedMeta: Record<string, string> = {
    clerkUserId: clerkId,
    programType: "drop_in",
    programId: String(pool.dropinId),
    poolId: String(poolId),
    basePrice: String(priceAfterCredits),
    serviceFeeAmount: String(serviceFeeAmount),
    category: "drop_in",
  };
  if (discountCodeId) sharedMeta.discountCodeId = String(discountCodeId);
  if (creditApplied > 0) sharedMeta.creditApplied = String(creditApplied);
  if (reservedCreditIds.length > 0) sharedMeta.reservedCreditIds = JSON.stringify(reservedCreditIds);
  if (guardianUserIdForSpot) {
    sharedMeta.guardianUserId = String(guardianUserIdForSpot);
    sharedMeta.playerUserId = String(targetUserId);
  }

  // ── Credit-only path (no Stripe needed) ──────────────────────────────────────
  if (totalAmount <= 0) {
    try {
      await db.insert(spotsTable).values({
        entityType: "dropin",
        entityId: pool.dropinId,
        poolId,
        userId: targetUserId,
        guardianUserId: guardianUserIdForSpot,
        status: "reserved",
        paymentStatus: "paid_inapp",
        waitlisted: false,
        waitlistPosition: null,
        confirmedAt: new Date(),
        notes: discountCodeId ? `dc:${discountCodeId}` : undefined,
      } as typeof spotsTable.$inferInsert);
    } catch (err: any) {
      if (reservedCreditIds.length > 0) await restoreReservedCredits(JSON.stringify(reservedCreditIds)).catch(() => {});
      if (err?.code === "23505") { res.status(409).json({ error: "already_registered" }); return; }
      throw err;
    }
    res.json({ paid: true, inApp: true, amount: 0, basePrice: priceAfterCredits, serviceFeeAmount: 0 });
    return;
  }

  // ── Stripe checkout path ──────────────────────────────────────────────────────
  const lineItems: any[] = [{
    price_data: {
      currency: "usd",
      product_data: { name: dropin.name },
      unit_amount: Math.round(priceAfterCredits * 100),
    },
    quantity: 1,
  }];
  if (serviceFeeAmount > 0) {
    lineItems.push({
      price_data: {
        currency: "usd",
        product_data: { name: "Processing fee" },
        unit_amount: Math.round(serviceFeeAmount * 100),
      },
      quantity: 1,
    });
  }

  const dropinOrigin = (req.headers.origin ?? req.headers.referer ?? "https://playonfutsal.vercel.app").replace(/\/$/, "");
  let session: any;
  let clientSecret: string;
  try {
    session = await (stripe.checkout.sessions.create as any)({
      mode: "payment",
      ui_mode: "custom",
      return_url: `${dropinOrigin}/checkout/complete?session_id={CHECKOUT_SESSION_ID}`,
      line_items: lineItems,
      metadata: sharedMeta,
      customer_email: user.email ?? undefined,
      payment_intent_data: { receipt_email: user.email ?? undefined, metadata: sharedMeta },
    });
    clientSecret = session.client_secret as string;
    if (!clientSecret) throw new Error("Checkout session did not return a client secret");

    await db.insert(paymentsTable).values({
      userId: user.id,
      entityType: "drop_in",
      entityId: pool.dropinId,
      amount: String(totalAmount),
      currency: "usd",
      status: "pending",
      provider: "stripe",
      providerPaymentId: session.id,
      paymentMethod: "card",
      serviceFeeAmount: String(serviceFeeAmount),
      metadata: JSON.stringify({ checkoutSessionId: session.id, discountCodeId, creditApplied, reservedCreditIds }),
    } as typeof paymentsTable.$inferInsert);
  } catch (stripeErr: any) {
    if (reservedCreditIds.length > 0) await restoreReservedCredits(JSON.stringify(reservedCreditIds)).catch(() => {});
    throw stripeErr;
  }

  try {
    await db.insert(spotsTable).values({
      entityType: "dropin",
      entityId: pool.dropinId,
      poolId,
      userId: targetUserId,
      guardianUserId: guardianUserIdForSpot,
      status: "reserved",
      paymentStatus: "payment_pending",
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      waitlisted: false,
      waitlistPosition: null,
      confirmedAt: null,
      notes: `cs:${session.id}${discountCodeId ? ` dc:${discountCodeId}` : ""}`,
    } as typeof spotsTable.$inferInsert);
  } catch (err: any) {
    // Race: another request already created a spot — restore credits and void the session
    if (reservedCreditIds.length > 0) await restoreReservedCredits(JSON.stringify(reservedCreditIds)).catch(() => {});
    try { await (stripe.checkout.sessions.expire as any)(session.id); } catch { /* best-effort */ }
    await db.update(paymentsTable).set({ status: "failed" } as Partial<typeof paymentsTable.$inferInsert>).where(eq(paymentsTable.providerPaymentId, session.id));
    if (err?.code === "23505") { res.status(409).json({ error: "already_registered", message: "This player already has an active spot for this pool" }); return; }
    throw err;
  }

  res.json({
    clientSecret,
    publishableKey: await getStripePublishableKey(),
    checkoutSessionId: session.id,
    amount: totalAmount,
    basePrice: priceAfterCredits,
    serviceFeeAmount,
  });
});

/**
 * POST /dropins/spots/:spotId/pay
 * Create a Stripe checkout session to pay for an existing unpaid drop-in spot.
 * Used when a player already has a reserved/payment_pending spot and needs to complete payment.
 * Bypasses the "already registered" guard in the pool checkout endpoint.
 */
router.post("/dropins/spots/:spotId/pay", requireAuth, async (req, res): Promise<void> => {
  const spotId = Number(req.params.spotId);
  const clerkId = (req as AuthedRequest).clerkUserId;
  const user = await getDbUserFromClerk(clerkId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const [spot] = await db.select().from(spotsTable).where(eq(spotsTable.id, spotId));
  if (!spot) { res.status(404).json({ error: "Spot not found" }); return; }

  const isOwner = spot.userId === user.id;
  let isGuardian = false;
  if (!isOwner && spot.userId) {
    const [link] = await db.select().from(guardiansTable).where(
      and(
        eq(guardiansTable.guardianUserId, user.id),
        eq(guardiansTable.youthUserId, spot.userId),
        eq(guardiansTable.status, "approved" as any),
      )
    );
    isGuardian = !!link;
  }
  if (!isOwner && !isGuardian) { res.status(403).json({ error: "Forbidden" }); return; }
  if (spot.paymentStatus === "paid_inapp" || spot.paymentStatus === "paid_external") {
    res.status(409).json({ error: "already_paid", message: "This spot has already been paid." }); return;
  }
  if (spot.status === "cancelled") { res.status(409).json({ error: "Spot is cancelled" }); return; }

  // Reconcile against Stripe before creating a new session — prevents double-charge
  // when the webhook hasn't arrived yet but the checkout session is already paid.
  if (spot.paymentStatus === "payment_pending") {
    const alreadyPaid = await reconcileSpotFromStripe(spot);
    if (alreadyPaid) {
      res.status(409).json({ error: "already_paid", message: "Your payment was already received — your spot is confirmed!" }); return;
    }
  }

  // ── Notify-then-pay contract enforcement ─────────────────────────────────────
  // Waitlisted players may only proceed to payment after receiving a time-limited
  // spot offer. Reject any payment attempt without an active (non-expired) offer.
  if (spot.waitlisted) {
    const offerSentAt = (spot as any).offerSentAt ?? null;
    if (!offerSentAt) {
      res.status(403).json({ error: "no_offer_active", message: "You cannot pay for a waitlisted spot until you have been offered a place. You will be notified when a spot becomes available." });
      return;
    }
    const offerExpiresAt: Date | null = (spot as any).offerExpiresAt ?? null;
    if (offerExpiresAt && new Date(offerExpiresAt) < new Date()) {
      res.status(410).json({ error: "offer_expired", message: "Your payment window for this spot has expired. You are still on the waitlist and will be notified when the next spot becomes available." });
      return;
    }
  }
  const isWaitlistOffer = spot.waitlisted && (spot as any).offerSentAt;

  const poolId = spot.poolId;
  if (!poolId) { res.status(400).json({ error: "Spot has no pool" }); return; }
  const [pool] = await db.select().from(dropinCourtPoolsTable).where(eq(dropinCourtPoolsTable.id, poolId));
  if (!pool) { res.status(404).json({ error: "Pool not found" }); return; }
  const [dropin] = await db.select().from(dropinsTable).where(eq(dropinsTable.id, pool.dropinId));
  if (!dropin) { res.status(404).json({ error: "Session not found" }); return; }

  const poolPrice = Number(pool.price ?? 0);
  if (poolPrice <= 0) { res.status(400).json({ error: "This spot has no price to pay" }); return; }

  const { getStripePublishableKey } = await import("../lib/stripe");
  const stripe = await getUncachableStripeClient();

  // ── Reuse pre-created offer session if one exists ────────────────────────────
  const preCreatedSessionId: string | null = (spot as any).stripeCheckoutSessionId ?? null;
  if (isWaitlistOffer && preCreatedSessionId) {
    try {
      const existingSession = await (stripe.checkout.sessions.retrieve as any)(preCreatedSessionId);
      if (existingSession.status === "complete") {
        res.status(409).json({ error: "already_paid", message: "Your payment was already received — your spot is confirmed!" }); return;
      }
      if (existingSession.status === "expired") {
        res.status(410).json({ error: "offer_expired", message: "Your payment window has expired. You remain on the waitlist." }); return;
      }
      // Session still open — return its client_secret directly
      const clientSecret = existingSession.client_secret as string;
      if (clientSecret) {
        const feeSplit = await computeRevenueSplit({
          entityType: "drop_in", entityId: pool.dropinId, category: "drop_in",
          grossAmount: poolPrice, paymentMethod: "card",
        });
        res.json({
          clientSecret,
          publishableKey: await getStripePublishableKey(),
          checkoutSessionId: existingSession.id,
          amount: poolPrice + feeSplit.serviceFeeAmount,
          basePrice: poolPrice,
          serviceFeeAmount: feeSplit.serviceFeeAmount,
        });
        return;
      }
    } catch (retrieveErr) {
      console.error("[spots/pay] Could not retrieve pre-created session:", retrieveErr);
      // Fall through to create a fresh session
    }
  }

  const feeSplit = await computeRevenueSplit({
    entityType: "drop_in",
    entityId: pool.dropinId,
    category: "drop_in",
    grossAmount: poolPrice,
    paymentMethod: "card",
  });
  const serviceFeeAmount = feeSplit.serviceFeeAmount;

  const sharedMeta: Record<string, string> = {
    clerkUserId: clerkId,
    programType: "drop_in",
    programId: String(pool.dropinId),
    poolId: String(poolId),
    spotId: String(spotId),
    basePrice: String(poolPrice),
    serviceFeeAmount: String(serviceFeeAmount),
    category: "drop_in",
  };
  if (spot.guardianUserId) {
    sharedMeta.guardianUserId = String(spot.guardianUserId);
    sharedMeta.playerUserId = String(spot.userId);
  }
  if (isWaitlistOffer) {
    sharedMeta.waitlistOffer = "true";
    sharedMeta.waitlistSpotId = String(spotId);
  }

  const lineItems: any[] = [{
    price_data: { currency: "usd", product_data: { name: dropin.name }, unit_amount: Math.round(poolPrice * 100) },
    quantity: 1,
  }];
  if (serviceFeeAmount > 0) {
    lineItems.push({
      price_data: { currency: "usd", product_data: { name: "Processing fee" }, unit_amount: Math.round(serviceFeeAmount * 100) },
      quantity: 1,
    });
  }

  const origin = (req.headers.origin ?? req.headers.referer ?? "https://playonfutsal.vercel.app").replace(/\/$/, "");
  const sessionParams: any = {
    mode: "payment",
    ui_mode: "custom",
    return_url: `${origin}/checkout/complete?session_id={CHECKOUT_SESSION_ID}`,
    line_items: lineItems,
    metadata: sharedMeta,
    customer_email: user.email ?? undefined,
    payment_intent_data: { receipt_email: user.email ?? undefined, metadata: sharedMeta },
  };

  // Align Stripe session expiry to offer deadline for new sessions
  if (isWaitlistOffer && (spot as any).offerExpiresAt) {
    const offerExpMs = new Date((spot as any).offerExpiresAt).getTime();
    const minExpiry = Date.now() + 30 * 60 * 1000;
    const maxExpiry = Date.now() + 24 * 60 * 60 * 1000;
    sessionParams.expires_at = Math.floor(Math.min(Math.max(offerExpMs, minExpiry), maxExpiry) / 1000);
  }

  const session = await (stripe.checkout.sessions.create as any)(sessionParams);
  const clientSecret = session.client_secret as string;
  if (!clientSecret) throw new Error("Checkout session did not return a client secret");

  // Store the new session ID on the spot (for future reuse)
  if (isWaitlistOffer) {
    await db.update(spotsTable)
      .set({ stripeCheckoutSessionId: session.id, updatedAt: new Date() } as Partial<typeof spotsTable.$inferInsert>)
      .where(eq(spotsTable.id, spotId));
  }

  res.json({
    clientSecret,
    publishableKey: await getStripePublishableKey(),
    checkoutSessionId: session.id,
    amount: poolPrice + serviceFeeAmount,
    basePrice: poolPrice,
    serviceFeeAmount,
  });
});

/**
 * DELETE /dropins/spots/:spotId
 * Cancel a spot. Reads cancellationWindowMinutes from pool (not session).
 */
router.delete("/dropins/spots/:spotId", requireAuth, async (req, res): Promise<void> => {
  const spotId = Number(req.params.spotId);
  const clerkId = (req as AuthedRequest).clerkUserId;
  const user = await getDbUserFromClerk(clerkId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const [spot] = await db.select().from(spotsTable).where(eq(spotsTable.id, spotId));
  if (!spot) { res.status(404).json({ error: "Spot not found" }); return; }

  const isOwner = spot.userId === user.id;
  const isStaff = user.role === "admin" || user.role === "staff";
  if (!isOwner && !isStaff) { res.status(403).json({ error: "Forbidden" }); return; }
  if (spot.status === "cancelled") { res.status(400).json({ error: "Spot already cancelled" }); return; }

  // Enforce cancellation window for non-staff.
  // Effective window = tightest (smallest) phase boundary from pool's cancellationPhaseOverrides
  // if overrides are set; otherwise falls back to the tightest global drop_in policy windowMinutes.
  if (isOwner && !isStaff) {
    let windowMinutes: number | null = null;
    let sessionStartsAt: Date | null = null;
    let poolPhaseOverrides: Array<{ policyId: number; windowMinutes: number }> | null = null;

    if (spot.poolId) {
      const [poolForCancel] = await db.select().from(dropinCourtPoolsTable).where(eq(dropinCourtPoolsTable.id, spot.poolId));
      if (poolForCancel) {
        sessionStartsAt = poolForCancel.startsAt ?? null;
        poolPhaseOverrides = Array.isArray((poolForCancel as any).cancellationPhaseOverrides)
          ? (poolForCancel as any).cancellationPhaseOverrides
          : null;
      }
    }

    if (!sessionStartsAt) {
      const [sessionForCancel] = await db.select().from(dropinsTable).where(eq(dropinsTable.id, spot.entityId));
      if (sessionForCancel) sessionStartsAt = sessionForCancel.startsAt;
    }

    // Derive effective cancel window by merging global drop_in policies with per-pool overrides.
    // Override-first / global-fallback: for each active global tier that has a windowMinutes,
    // use the pool's overridden value if one exists for that policyId, otherwise use the
    // global windowMinutes. The tightest (smallest) resolved value is the effective cutoff.
    // This handles partial override lists (only edited tiers present) correctly.
    {
      const globalPolicies = await db.select().from(refundCreditPoliciesTable)
        .where(and(eq(refundCreditPoliciesTable.isActive, true), eq(refundCreditPoliciesTable.entityType, "drop_in")));
      const overridesMap = new Map(
        (poolPhaseOverrides ?? []).map((o) => [o.policyId, o.windowMinutes]),
      );
      const windows = globalPolicies
        .map((p: any) => {
          const globalW = p.windowMinutes != null ? Number(p.windowMinutes) : null;
          if (globalW === null) return null;
          return overridesMap.has(p.id) ? overridesMap.get(p.id)! : globalW;
        })
        .filter((w): w is number => w !== null);
      windowMinutes = windows.length > 0 ? Math.min(...windows) : null;
    }

    if (sessionStartsAt && windowMinutes !== null) {
      const minutesUntilStart = (new Date(sessionStartsAt).getTime() - Date.now()) / 60000;
      if (minutesUntilStart < windowMinutes) {
        res.status(409).json({
          error: `Cancellation window has closed. You must cancel at least ${windowMinutes} minutes before the session starts.`,
        });
        return;
      }
    }
  }

  const reason = req.body?.reason ?? null;

  const [cancelled] = await db.update(spotsTable).set({
    status: "cancelled",
    cancelledAt: new Date(),
    cancellationReason: reason,
    updatedAt: new Date(),
  } as Partial<typeof spotsTable.$inferInsert>).where(
    and(eq(spotsTable.id, spotId), sql`${spotsTable.status} != 'cancelled'`)
  ).returning();

  if (!cancelled) {
    res.status(400).json({ error: "Spot already cancelled" });
    return;
  }

  await writeAuditLog({
    actorClerkId: clerkId,
    actorUserId: user.id,
    action: "spot_cancelled",
    entityType: "dropin_spot",
    entityId: spotId,
    before: { status: spot.status },
    after: { status: "cancelled", reason },
  });

  // Auto-refund: only attempt if the spot was paid
  let refundOutcome: any = null;
  const isPaid = spot.paymentStatus === "paid_inapp" || spot.paymentStatus === "paid_external";
  if (isPaid && spot.userId) {
    try {
      // Fetch pool to get startsAt, refundPolicyId, and cancellationPhaseOverrides
      let poolStartsAt: Date | null = null;
      let poolRefundPolicyId: number | null = null;
      let poolCancellationPhaseOverrides: Array<{ policyId: number; windowMinutes: number }> | null = null;
      if (spot.poolId) {
        const [pool] = await db.select().from(dropinCourtPoolsTable).where(eq(dropinCourtPoolsTable.id, spot.poolId));
        if (pool) {
          poolStartsAt = pool.startsAt ?? null;
          poolRefundPolicyId = (pool as any).refundPolicyId ?? null;
          poolCancellationPhaseOverrides = Array.isArray((pool as any).cancellationPhaseOverrides)
            ? (pool as any).cancellationPhaseOverrides
            : null;
        }
      }

      const minutesUntilEvent = poolStartsAt
        ? Math.max(0, (new Date(poolStartsAt).getTime() - Date.now()) / 60000)
        : 0;

      // Find the most recent paid, uncompensated payment for this spot
      const payerIds = [spot.userId];
      if ((spot as any).guardianUserId && (spot as any).guardianUserId !== spot.userId) {
        payerIds.push((spot as any).guardianUserId);
      }
      const candidates = await db.select().from(paymentsTable).where(
        and(
          eq(paymentsTable.entityType, "drop_in"),
          eq(paymentsTable.entityId, spot.entityId),
          inArray(paymentsTable.userId, payerIds),
          eq(paymentsTable.status, "paid"),
        ),
      ).orderBy(sql`${paymentsTable.createdAt} DESC`);

      // Two-pass match mirrors admin bulk cancellation logic:
      // 1. Prefer uncompensated payment whose metadata.playerUserId === spot.userId
      //    (guardian paying for multiple children — each spot maps to its own payment)
      // 2. Fall back to any uncompensated candidate (self-paid or missing metadata)
      const matchesPlayer = (p: any) => {
        if (!p.metadata) return false;
        try {
          const meta = JSON.parse(p.metadata);
          return meta.playerUserId != null && Number(meta.playerUserId) === spot.userId;
        } catch {
          return false;
        }
      };
      const payment =
        candidates.find((p: any) => matchesPlayer(p) && p.compensationStatus == null) ??
        candidates.find((p: any) => p.compensationStatus == null) ??
        null;

      if (payment) {
        const { applyPolicy } = await import("./cancellationEngine");
        refundOutcome = await applyPolicy({
          paymentId: payment.id,
          programType: "drop_in",
          daysUntilEvent: 0,
          minutesUntilEvent,
          cancellationReason: reason,
          actorClerkId: clerkId,
          policyIdOverride: poolRefundPolicyId,
          cancellationPhaseOverrides: poolCancellationPhaseOverrides,
        });
      }
    } catch (e: any) {
      console.error("[drop-in cancel] refund error:", e?.message ?? e);
      refundOutcome = { action: "none", error: e?.message ?? "Refund failed" };
    }
  }

  // Notify the player
  if (!isOwner && cancelled.userId) {
    const [dropin] = await db.select().from(dropinsTable).where(eq(dropinsTable.id, cancelled.entityId));
    if (dropin) {
      const refundNote = refundOutcome?.refundAmount > 0
        ? ` A refund of $${Number(refundOutcome.refundAmount).toFixed(2)} will appear on your card within 5–10 business days.`
        : "";
      await sendMultiChannelNotification(["in_app", "email"], {
        userId: cancelled.userId,
        type: "registration_cancelled",
        subject: `Drop-in spot cancelled`,
        body: `Your spot for ${dropin.name} has been cancelled${reason ? `: ${reason}` : "."}${refundNote}`,
      });
    }
  } else if (isOwner && cancelled.userId && refundOutcome?.refundAmount > 0) {
    const [dropin] = await db.select().from(dropinsTable).where(eq(dropinsTable.id, cancelled.entityId));
    if (dropin) {
      await sendMultiChannelNotification(["in_app", "email"], {
        userId: cancelled.userId,
        type: "registration_cancelled",
        subject: `Drop-in spot cancelled — refund issued`,
        body: `Your spot for ${dropin.name} has been cancelled. A refund of $${Number(refundOutcome.refundAmount).toFixed(2)} will appear on your card within 5–10 business days.`,
      });
    }
  }

  let promoted: any = null;
  if (!spot.waitlisted && spot.poolId) {
    const [cancelPool] = await db.select().from(dropinCourtPoolsTable).where(eq(dropinCourtPoolsTable.id, spot.poolId));
    if (cancelPool && Number(cancelPool.price) > 0) {
      const dispatched = await dispatchWaitlistOffer(spot.poolId, spot.entityId, 1, clerkId);
      promoted = dispatched[0] ?? null;
    } else {
      promoted = await promoteNextWaitlisted(spot.poolId, spot.entityId, clerkId);
    }
  }

  res.json({ spot: await enrichSpot(cancelled), promoted: promoted ? await enrichSpot(promoted) : null, refundOutcome });
});

// ─── Spot management (admin) ───────────────────────────────────────────────────

/**
 * POST /dropins/spots/:spotId/send-offer
 * Admin: dispatch a waitlist payment offer to a specific waitlisted player.
 * Implements queue semantics: cancels any existing in-flight offer at position #1,
 * promotes selected player to position #1, shifts others down, then dispatches offer
 * (pre-creates Stripe checkout session so expiry is deterministic via webhook).
 */
router.post("/dropins/spots/:spotId/send-offer", requirePermission("canManageDropins"), async (req, res): Promise<void> => {
  const spotId = Number(req.params.spotId);
  const clerkId = (req as any).clerkUserId;

  const [spot] = await db.select().from(spotsTable).where(eq(spotsTable.id, spotId));
  if (!spot) { res.status(404).json({ error: "Spot not found" }); return; }
  if (!spot.waitlisted) { res.status(400).json({ error: "Spot is not on the waitlist" }); return; }
  if (spot.status === "cancelled") { res.status(400).json({ error: "Spot is cancelled" }); return; }
  if (!spot.poolId) { res.status(400).json({ error: "Spot has no associated pool" }); return; }
  if ((spot as any).offerSentAt) { res.status(409).json({ error: "An offer is already in-flight for this spot" }); return; }

  const [pool] = await db.select().from(dropinCourtPoolsTable).where(eq(dropinCourtPoolsTable.id, spot.poolId));
  if (!pool) { res.status(404).json({ error: "Pool not found" }); return; }
  if (Number(pool.price) <= 0) { res.status(400).json({ error: "Only paid pools support offer dispatch" }); return; }

  // ── Capacity guard: ensure there is an available seat to offer ────────────
  // confirmedCount = non-waitlisted, non-cancelled spots (real seats taken)
  // inFlightOffers = waitlisted spots that already have an offer in progress
  // An admin can dispatch if: (openSeats > inFlightOffers) OR (reassigning
  // an existing in-flight offer from position #1 to a different player).
  const [countRows] = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE NOT waitlisted AND status != 'cancelled') AS confirmed,
      COUNT(*) FILTER (WHERE waitlisted AND offer_sent_at IS NOT NULL AND status != 'cancelled') AS in_flight
    FROM spots
    WHERE pool_id = ${spot.poolId} AND entity_type = 'dropin'
  `);
  const confirmedCount = Number((countRows as any).confirmed ?? 0);
  const inFlightOffers = Number((countRows as any).in_flight ?? 0);
  const cap = Number(pool.cap ?? Infinity);
  const openSeats = Math.max(0, cap - confirmedCount);
  const selectedPosition = spot.waitlistPosition ?? 1;
  // Reassignment: admin is sending offer to a non-#1 player when there's
  // already an in-flight offer at #1 (one offer slot remains, just changing who holds it).
  const isReassignment = selectedPosition !== 1 && inFlightOffers > 0;
  if (openSeats <= 0 && !isReassignment) {
    res.status(409).json({
      error: "no_open_seat",
      message: `No available seat to offer in this pool (cap: ${cap}, confirmed: ${confirmedCount}, in-flight offers: ${inFlightOffers}). Wait for a cancellation before sending an offer.`,
    });
    return;
  }

  const stripe = await getUncachableStripeClient();

  // ── Cancel any existing in-flight offer for the current #1 player ──────────
  if (selectedPosition !== 1) {
    const [currentTop] = await db
      .select()
      .from(spotsTable)
      .where(
        and(
          eq(spotsTable.poolId, spot.poolId),
          eq(spotsTable.entityType, "dropin"),
          eq(spotsTable.waitlisted, true),
          eq(spotsTable.status, "reserved"),
          eq(spotsTable.waitlistPosition, 1),
          sql`${(spotsTable as any).offer_sent_at} IS NOT NULL`,
        )
      )
      .limit(1);

    if (currentTop) {
      // Expire their Stripe checkout session if one was pre-created
      const topSessionId: string | null = (currentTop as any).stripeCheckoutSessionId ?? null;
      if (topSessionId) {
        try {
          await (stripe.checkout.sessions.expire as any)(topSessionId);
        } catch (expireErr: any) {
          // Session may already be expired/completed — ignore
          if (!String(expireErr?.message ?? "").includes("already expired") && expireErr?.statusCode !== 410) {
            console.error("[send-offer] Could not expire Stripe session for displaced player:", expireErr?.message);
          }
        }
      }
      // Clear their offer fields
      await db.update(spotsTable)
        .set({ offerSentAt: null, offerExpiresAt: null, stripeCheckoutSessionId: null, updatedAt: new Date() } as Partial<typeof spotsTable.$inferInsert>)
        .where(eq(spotsTable.id, currentTop.id));
    }

    // ── Shift all spots at positions 1 through (selectedPosition-1) down by 1 ──
    await db.execute(
      sql`UPDATE spots
          SET waitlist_position = waitlist_position + 1
          WHERE pool_id = ${spot.poolId}
            AND entity_type = 'dropin'
            AND waitlisted = true
            AND status = 'reserved'
            AND id != ${spotId}
            AND waitlist_position IS NOT NULL
            AND waitlist_position < ${selectedPosition}`
    );

    // ── Promote selected spot to position #1 ────────────────────────────────
    await db.update(spotsTable)
      .set({ waitlistPosition: 1, updatedAt: new Date() } as Partial<typeof spotsTable.$inferInsert>)
      .where(eq(spotsTable.id, spotId));
  }

  // ── Dispatch offer (pre-creates Stripe session) ───────────────────────────
  const dispatched = await dispatchWaitlistOffer(spot.poolId, spot.entityId, 1, clerkId);
  // dispatchWaitlistOffer selects the #1 spot (which is now our selected spot)
  const result = dispatched[0] ?? null;

  await writeAuditLog({
    actorClerkId: clerkId,
    action: "waitlist_offer_dispatched_admin",
    entityType: "dropin_spot",
    entityId: spotId,
    after: { promotedToPosition: 1, selectedFrom: selectedPosition },
    notes: "Offer dispatched manually by admin with queue promotion",
  });

  res.json(result ? await enrichSpot(result) : await enrichSpot(spot));
});

router.patch("/dropins/spots/:spotId/payment", requirePermission("canManageDropins"), async (req, res): Promise<void> => {
  const spotId = Number(req.params.spotId);
  const { paymentStatus, notes } = req.body;
  const VALID = ["unpaid", "paid_inapp", "paid_external", "refunded", "waived"];
  if (!paymentStatus || !VALID.includes(paymentStatus)) {
    res.status(400).json({ error: "Invalid paymentStatus" });
    return;
  }
  const [before] = await db.select().from(spotsTable).where(eq(spotsTable.id, spotId));
  if (!before) { res.status(404).json({ error: "Spot not found" }); return; }
  const [spot] = await db.update(spotsTable).set({ paymentStatus, notes: notes ?? before.notes, updatedAt: new Date() } as Partial<typeof spotsTable.$inferInsert>).where(eq(spotsTable.id, spotId)).returning();
  await writeAuditLog({
    action: "payment_status_updated",
    entityType: "dropin_spot",
    entityId: spotId,
    before: { paymentStatus: before.paymentStatus },
    after: { paymentStatus },
  });
  res.json(await enrichSpot(spot));
});

router.patch("/dropins/spots/:spotId/noshow", requirePermission("canManageDropins"), async (req, res): Promise<void> => {
  const spotId = Number(req.params.spotId);
  const promote = req.body?.promote === true;

  const [spot] = await db.select().from(spotsTable).where(eq(spotsTable.id, spotId));
  if (!spot) { res.status(404).json({ error: "Spot not found" }); return; }

  const [updated] = await db.update(spotsTable).set({ noShow: true, updatedAt: new Date() } as Partial<typeof spotsTable.$inferInsert>).where(eq(spotsTable.id, spotId)).returning();

  await writeAuditLog({
    action: "no_show_marked",
    entityType: "dropin_spot",
    entityId: spotId,
  });

  let promoted: any = null;
  if (promote && spot.poolId) {
    promoted = await promoteNextWaitlisted(spot.poolId, spot.entityId);
  }

  res.json({ spot: await enrichSpot(updated), promoted: promoted ? await enrichSpot(promoted) : null });
});

router.post("/dropins/:id/spots", requirePermission("canManageDropins"), async (req, res): Promise<void> => {
  const dropinId = Number(req.params.id);
  const { poolId, userId, waitlisted, paymentStatus, notes } = req.body;
  if (!poolId || !userId) { res.status(400).json({ error: "poolId and userId are required" }); return; }

  const [dropin] = await db.select().from(dropinsTable).where(eq(dropinsTable.id, dropinId));
  if (!dropin) { res.status(404).json({ error: "Drop-in not found" }); return; }

  let waitlistPosition: number | null = null;
  if (waitlisted) {
    const counts = await poolSpotCounts([Number(poolId)]);
    waitlistPosition = (counts[Number(poolId)]?.waitlistCount ?? 0) + 1;
  }

  const [spot] = await db.insert(spotsTable).values({
    entityType: "dropin",
    entityId: dropinId,
    poolId: Number(poolId),
    userId: Number(userId),
    status: "reserved",
    paymentStatus: paymentStatus ?? "unpaid",
    waitlisted: Boolean(waitlisted),
    waitlistPosition,
    confirmedAt: waitlisted ? null : new Date(),
    notes: notes ?? null,
  } as typeof spotsTable.$inferInsert).returning();

  await writeAuditLog({
    action: "spot_admin_added",
    entityType: "dropin_spot",
    entityId: spot.id,
    after: { dropinId, poolId, userId },
  });

  res.status(201).json(await enrichSpot(spot));
});

router.post("/dropins/spots/admin-add", requirePermission("canManageDropins"), async (req, res): Promise<void> => {
  const { poolId, email, dropinId } = req.body;
  if (!poolId || !email || !dropinId) {
    res.status(400).json({ error: "poolId, email, and dropinId are required" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, String(email).toLowerCase().trim()));
  if (!user) { res.status(404).json({ error: `No account found for email: ${email}` }); return; }

  const [pool] = await db.select().from(dropinCourtPoolsTable).where(eq(dropinCourtPoolsTable.id, Number(poolId)));
  if (!pool) { res.status(404).json({ error: "Pool not found" }); return; }

  const [existing] = await db.select().from(spotsTable).where(
    and(eq(spotsTable.poolId, Number(poolId)), eq(spotsTable.userId, user.id), eq(spotsTable.entityType, "dropin"))
  );
  if (existing) { res.status(409).json({ error: "Player already has a spot in this pool" }); return; }

  const counts = await poolSpotCounts([Number(poolId)]);
  const { spotsTaken } = counts[Number(poolId)] ?? { spotsTaken: 0, waitlistCount: 0 };
  const waitlisted = spotsTaken >= pool.cap;
  const waitlistPosition = waitlisted ? (counts[Number(poolId)]?.waitlistCount ?? 0) + 1 : null;

  const [spot] = await db.insert(spotsTable).values({
    entityType: "dropin",
    entityId: Number(dropinId),
    poolId: Number(poolId),
    userId: user.id,
    status: "reserved",
    paymentStatus: "unpaid",
    waitlisted,
    waitlistPosition,
    confirmedAt: waitlisted ? null : new Date(),
  } as typeof spotsTable.$inferInsert).returning();

  await writeAuditLog({
    action: "spot_admin_added",
    entityType: "dropin_spot",
    entityId: spot.id,
    after: { dropinId, poolId, userId: user.id, email },
  });

  res.status(201).json(await enrichSpot(spot));
});

// ─── Manual waitlist promotion (admin) ────────────────────────────────────────

router.post("/dropins/spots/:spotId/promote", requirePermission("canManageDropins"), async (req, res): Promise<void> => {
  const spotId = Number(req.params.spotId);
  const clerkId = (req as AuthedRequest).clerkUserId;

  const [spot] = await db.select().from(spotsTable).where(eq(spotsTable.id, spotId));
  if (!spot) { res.status(404).json({ error: "Spot not found" }); return; }
  if (!spot.waitlisted) { res.status(400).json({ error: "Spot is not waitlisted" }); return; }
  if (spot.status !== "reserved") { res.status(400).json({ error: "Spot is not in reserved status" }); return; }

  if (spot.entityType === "dropin") {
    const [dropinForPromote] = await db.select().from(dropinsTable).where(eq(dropinsTable.id, spot.entityId));
    if (dropinForPromote && (dropinForPromote.status === "completed" || dropinForPromote.status === "cancelled")) {
      res.status(409).json({ error: "Session has already ended — waitlist promotion is no longer allowed" }); return;
    }
  }

  if (spot.poolId) {
    const [pool] = await db.select().from(dropinCourtPoolsTable).where(eq(dropinCourtPoolsTable.id, spot.poolId));
    if (pool) {
      const counts = await poolSpotCounts([spot.poolId]);
      const taken = counts[spot.poolId]?.spotsTaken ?? 0;
      if (taken >= pool.cap) {
        res.status(409).json({ error: "Pool is full — cannot promote. Remove another player first." });
        return;
      }
    }
  }

  const [promoted] = await db.update(spotsTable).set({
    waitlisted: false,
    waitlistPosition: null,
    promotedFromWaitlist: true,
    confirmedAt: new Date(),
    updatedAt: new Date(),
  } as Partial<typeof spotsTable.$inferInsert>).where(eq(spotsTable.id, spotId)).returning();

  if (spot.poolId) {
    await db.execute(
      sql`UPDATE spots SET waitlist_position = waitlist_position - 1
          WHERE pool_id = ${spot.poolId}
            AND entity_type = 'dropin'
            AND entity_id = ${spot.entityId}
            AND waitlisted = true
            AND status = 'reserved'
            AND waitlist_position > ${spot.waitlistPosition ?? 1}`
    );
  }

  await writeAuditLog({
    actorClerkId: clerkId,
    action: "waitlist_manually_promoted",
    entityType: "dropin_spot",
    entityId: spotId,
    after: { poolId: spot.poolId, userId: spot.userId },
    notes: "Manual promotion by admin",
  });

  if (promoted.userId) {
    const [dropin] = await db.select().from(dropinsTable).where(eq(dropinsTable.id, promoted.entityId));
    if (dropin) {
      await sendMultiChannelNotification(["in_app", "email"], {
        userId: promoted.userId,
        type: "registration_confirmed",
        subject: `Spot confirmed for ${dropin.name}`,
        body: `Your spot for ${dropin.name} has been promoted from the waitlist!`,
        metadata: { dropinId: promoted.entityId, poolId: spot.poolId },
      });
    }
  }

  res.json(await enrichSpot(promoted));
});

// ─── My spots (player-safe) ────────────────────────────────────────────────────

router.get("/dropins/:id/my-spots", requireAuth, async (req, res): Promise<void> => {
  const dropinId = Number(req.params.id);
  const clerkId = (req as AuthedRequest).clerkUserId;
  const user = await getDbUserFromClerk(clerkId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const spots = await db.select().from(spotsTable).where(
    and(
      eq(spotsTable.entityType, "dropin"),
      eq(spotsTable.entityId, dropinId),
      eq(spotsTable.status, "reserved"),
      or(
        eq(spotsTable.userId, user.id),
        and(
          sql`user_id IS NULL`,
          sql`LOWER(guest_email) = ${user.email}`,
        ),
      ),
    )
  ).orderBy(asc(spotsTable.poolId));

  res.json(spots);
});

// ─── Roster (admin) ────────────────────────────────────────────────────────────

router.get("/dropins/:id/roster", requirePermission("canManageDropins"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const pools = await db.select().from(dropinCourtPoolsTable).where(eq(dropinCourtPoolsTable.dropinId, id)).orderBy(asc(dropinCourtPoolsTable.startsAt), asc(dropinCourtPoolsTable.id));
  const poolIds = pools.map((p) => p.id);
  const counts = await poolSpotCounts(poolIds);

  const allSpots = poolIds.length
    ? await db.select().from(spotsTable).where(
        and(
          inArray(spotsTable.poolId, poolIds),
          eq(spotsTable.entityType, "dropin"),
          eq(spotsTable.entityId, id),
          eq(spotsTable.status, "reserved"),
        )
      ).orderBy(asc(spotsTable.waitlisted), asc(spotsTable.waitlistPosition), asc(spotsTable.createdAt))
    : [];

  const poolsWithSpots = await Promise.all(
    pools.map(async (pool) => {
      const poolSpots = allSpots.filter((s) => s.poolId === pool.id);
      const enrichedSpots = await Promise.all(poolSpots.map(enrichSpot));
      return {
        pool: await enrichPool(pool, counts[pool.id]),
        spots: enrichedSpots,
      };
    })
  );

  res.json({ dropinId: id, pools: poolsWithSpots });
});

// ─── Day-of Check-in ──────────────────────────────────────────────────────────

router.get("/dropins/:id/checkin", requirePermission("canManageDropins"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [dropin] = await db.select().from(dropinsTable).where(eq(dropinsTable.id, id));
  if (!dropin) { res.status(404).json({ error: "Drop-in not found" }); return; }

  const pools = await db.select().from(dropinCourtPoolsTable).where(eq(dropinCourtPoolsTable.dropinId, id)).orderBy(asc(dropinCourtPoolsTable.startsAt), asc(dropinCourtPoolsTable.id));
  const poolIds = pools.map((p) => p.id);
  const counts = await poolSpotCounts(poolIds);

  const allSpots = poolIds.length
    ? await db.select().from(spotsTable).where(
        and(
          inArray(spotsTable.poolId, poolIds),
          eq(spotsTable.entityType, "dropin"),
          eq(spotsTable.entityId, id),
          eq(spotsTable.status, "reserved"),
        )
      ).orderBy(asc(spotsTable.waitlisted), asc(spotsTable.waitlistPosition), asc(spotsTable.createdAt))
    : [];

  const poolsWithSpots = await Promise.all(
    pools.map(async (pool) => {
      const poolSpots = allSpots.filter((s) => s.poolId === pool.id);
      const enrichedSpots = await Promise.all(poolSpots.map(enrichSpot));
      return {
        pool: await enrichPool(pool, counts[pool.id]),
        spots: enrichedSpots,
      };
    })
  );

  res.json({ dropin: parseDropin(dropin), pools: poolsWithSpots });
});

router.post("/dropins/:id/checkin", requirePermission("canManageDropins"), async (req, res): Promise<void> => {
  const dropinId = Number(req.params.id);
  const { qrCode, userId, spotId: bodySpotId, poolId, method } = req.body;
  const clerkId = (req as AuthedRequest).clerkUserId;

  const [dropinSession] = await db.select().from(dropinsTable).where(eq(dropinsTable.id, dropinId));
  if (!dropinSession) {
    res.status(404).json({ error: "Drop-in session not found" });
    return;
  }
  if (dropinSession.status === "completed" || dropinSession.status === "cancelled") {
    res.status(409).json({ error: "Session has already ended and check-in is no longer available" });
    return;
  }

  // For check-in activity check, use pool-level active override if poolId provided
  let isActive = false;
  if (poolId) {
    const [checkPool] = await db.select().from(dropinCourtPoolsTable).where(eq(dropinCourtPoolsTable.id, Number(poolId)));
    if (checkPool) {
      isActive = isPoolActive(checkPool);
    }
  }
  if (!isActive) {
    isActive = isEventActive(dropinSession);
  }
  if (!isActive) {
    const win = getEventWindow(dropinSession);
    const notYetActive = win ? new Date() < win.windowStart : true;
    res.status(403).json({
      error: "This drop-in session is not currently active",
      notYetActive,
      windowStart: win?.windowStart.toISOString() ?? null,
    });
    return;
  }

  // ── Guest spot manual check-in (spotId provided, no userId) ─────────────────
  // Admin taps "Check In" on a guest row — userId is null so we use spotId.
  if (!userId && !qrCode && bodySpotId) {
    const [guestSpot] = await db.select().from(spotsTable).where(
      and(
        eq(spotsTable.id, Number(bodySpotId)),
        eq(spotsTable.entityType, "dropin"),
        eq(spotsTable.entityId, dropinId),
        eq(spotsTable.status, "reserved"),
        eq(spotsTable.waitlisted, false),
      )
    );

    if (!guestSpot) {
      res.status(409).json({ error: "no_active_spot", message: "Guest spot not found or not active in this session" });
      return;
    }

    const syntheticQr = `admin:guest:spot:${guestSpot.id}`;

    // Idempotency: check for existing non-voided check-in for this guest spot
    const existingCandidates = await db.select().from(checkInsTable).where(
      and(
        eq(checkInsTable.entityType, "dropin"),
        eq(checkInsTable.entityId, dropinId),
        isNull(checkInsTable.userId),
        sql`${checkInsTable.voidedAt} IS NULL`,
      )
    );
    const alreadyCheckedIn = existingCandidates.find((c) => {
      if (c.qrCodeScanned === syntheticQr) return true;
      if (c.qrCodeScanned) {
        try { return JSON.parse(c.qrCodeScanned).spotId === guestSpot.id; } catch { /* not JSON */ }
      }
      return false;
    });
    if (alreadyCheckedIn) {
      res.json({
        checkinId: alreadyCheckedIn.id,
        guestName: guestSpot.guestName ?? "Guest",
        guestEmail: guestSpot.guestEmail ?? null,
        spotId: guestSpot.id,
        poolId: guestSpot.poolId,
        method: alreadyCheckedIn.method,
        alreadyCheckedIn: true,
      });
      return;
    }

    const [ci] = await db.insert(checkInsTable).values({
      entityType: "dropin",
      entityId: dropinId,
      userId: null,
      method: method ?? "manual",
      qrCodeScanned: syntheticQr,
      isManual: true,
      checkedInAt: new Date(),
      checkedInByClerkId: clerkId ?? null,
    } as typeof checkInsTable.$inferInsert).returning();

    await writeAuditLog({
      actorClerkId: clerkId,
      action: "checkin",
      entityType: "dropin",
      entityId: dropinId,
      after: { guestName: guestSpot.guestName, guestEmail: guestSpot.guestEmail, spotId: guestSpot.id, checkinId: ci.id, method: method ?? "manual" },
    });

    res.json({
      checkinId: ci.id,
      guestName: guestSpot.guestName ?? "Guest",
      guestEmail: guestSpot.guestEmail ?? null,
      spotId: guestSpot.id,
      poolId: guestSpot.poolId,
      method: ci.method,
    });
    return;
  }

  if (!qrCode && !userId) {
    res.status(400).json({ error: "Provide qrCode, userId, or spotId for a guest" });
    return;
  }

  // Resolve player
  let dbUser: any = null;
  if (qrCode) {
    [dbUser] = await db.select().from(usersTable).where(eq(usersTable.qrCode, qrCode));
    if (!dbUser) {
      const { playerProfilesTable } = await import("@workspace/db");
      const [pp] = await db.select().from(playerProfilesTable).where(eq(playerProfilesTable.qrCode, qrCode));
      if (pp) {
        [dbUser] = await db.select().from(usersTable).where(eq(usersTable.id, pp.userId));
      }
    }
  } else if (userId) {
    [dbUser] = await db.select().from(usersTable).where(eq(usersTable.id, Number(userId)));
  }

  if (!dbUser) {
    res.status(404).json({ error: "Player not found" });
    return;
  }

  // Find a reserved (non-waitlisted) spot for this player in this session
  // If poolId is provided, scope to that specific pool; otherwise accept any pool under this session.
  const spotConditions = [
    eq(spotsTable.entityType, "dropin"),
    eq(spotsTable.entityId, dropinId),
    eq(spotsTable.userId, dbUser.id),
    eq(spotsTable.status, "reserved"),
    eq(spotsTable.waitlisted, false),
  ];
  if (poolId) {
    spotConditions.push(eq(spotsTable.poolId, Number(poolId)));
  }

  const [spot] = await db.select().from(spotsTable).where(and(...spotConditions)).limit(1);

  if (!spot) {
    res.status(409).json({ error: "no_active_spot", message: "No active reservation found for this player in the requested pool" });
    return;
  }

  // Record check-in
  const [ci] = await db.insert(checkInsTable).values({
    entityType: "dropin",
    entityId: dropinId,
    userId: dbUser.id,
    method: method ?? "manual",
    checkedInAt: new Date(),
    checkedInByClerkId: clerkId ?? null,
    spotId: spot?.id ?? null,
  } as typeof checkInsTable.$inferInsert).returning();

  await writeAuditLog({
    actorClerkId: clerkId,
    action: "checkin",
    entityType: "dropin",
    entityId: dropinId,
    after: { userId: dbUser.id, checkinId: ci.id, method: method ?? "manual" },
  });

  res.json({
    checkinId: ci.id,
    userId: dbUser.id,
    userFirstName: dbUser.firstName,
    userLastName: dbUser.lastName,
    spotId: spot?.id ?? null,
    poolId: spot?.poolId ?? null,
    method: ci.method,
  });
});

// ─── Attendance history (admin) ────────────────────────────────────────────────

router.get("/dropins/:id/attendance", requirePermission("canManageDropins"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const checkins = await db
    .select()
    .from(checkInsTable)
    .where(
      and(
        eq(checkInsTable.entityType, "dropin"),
        eq(checkInsTable.entityId, id),
        sql`${checkInsTable.voidedAt} IS NULL`,
      )
    )
    .orderBy(desc(checkInsTable.checkedInAt));

  const enriched = await Promise.all(checkins.map(async (ci) => {
    let u: any = null;
    if (ci.userId) {
      [u] = await db.select().from(usersTable).where(eq(usersTable.id, ci.userId));
    }
    return {
      ...ci,
      userFirstName: u?.firstName ?? null,
      userLastName: u?.lastName ?? null,
      userEmail: u?.email ?? null,
    };
  }));

  res.json(enriched);
});

export default router;
