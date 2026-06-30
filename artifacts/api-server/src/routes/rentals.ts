import { Router, type IRouter } from "express";
import { db, rentalsTable, rentalPricingTable, rentalBlackoutsTable, dropinCourtPoolsTable, dropinsTable, usersTable } from "@workspace/db";
import { eq, and, ne, inArray, or, isNull } from "drizzle-orm";
import { requireAuth, requireAdmin, requirePermission } from "../middlewares/auth.js";
import type { AuthedRequest } from "../middlewares/auth.js";
import { getUncachableStripeClient } from "../lib/stripe.js";
import { sendNotificationWithPreferences } from "../services/notifications.js";

const router: IRouter = Router();

const APP_URL = (process.env.PUBLIC_APP_URL ?? "https://playonfutsal.vercel.app").replace(/\/$/, "");

// ── Helpers ────────────────────────────────────────────────────────────────────

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m ?? 0);
}

function minutesToTime(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function slotsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

// Returns true if the given court/date/startMin/endMin conflicts with any existing booking,
// dropin session, or blackout.
async function hasConflict(
  courtNumber: number,
  date: string,
  startMin: number,
  endMin: number,
  excludeRentalId?: number,
): Promise<boolean> {
  // 1. Check existing confirmed/pending rentals on this court+date
  const existingRentals = await db
    .select({ id: rentalsTable.id, startTime: rentalsTable.startTime, endTime: rentalsTable.endTime })
    .from(rentalsTable)
    .where(
      and(
        eq(rentalsTable.courtNumber, courtNumber),
        eq(rentalsTable.date, date),
        ne(rentalsTable.status, "cancelled"),
      )
    );

  for (const r of existingRentals) {
    if (excludeRentalId && r.id === excludeRentalId) continue;
    if (slotsOverlap(startMin, endMin, timeToMinutes(r.startTime), timeToMinutes(r.endTime))) return true;
  }

  // 2. Check dropin sessions on this court on this date
  // dropin_court_pools has startsAt + durationMinutes; dropin has courtId
  const dateStart = new Date(`${date}T00:00:00Z`);
  const dateEnd = new Date(`${date}T23:59:59Z`);

  const courtDropins = await db
    .select({
      startsAt: dropinCourtPoolsTable.startsAt,
      durationMinutes: dropinsTable.durationMinutes,
    })
    .from(dropinCourtPoolsTable)
    .innerJoin(dropinsTable, eq(dropinCourtPoolsTable.dropinId, dropinsTable.id))
    .where(
      and(
        eq(dropinsTable.courtId, courtNumber),
        ne(dropinsTable.status, "cancelled"),
      )
    );

  for (const d of courtDropins) {
    if (!d.startsAt) continue;
    const t = new Date(d.startsAt);
    if (t < dateStart || t > dateEnd) continue;
    const dStartMin = t.getHours() * 60 + t.getMinutes();
    const dEndMin = dStartMin + (d.durationMinutes ?? 120);
    if (slotsOverlap(startMin, endMin, dStartMin, dEndMin)) return true;
  }

  // 3. Check blackouts
  const blackouts = await db
    .select()
    .from(rentalBlackoutsTable)
    .where(
      and(
        eq(rentalBlackoutsTable.date, date),
        or(isNull(rentalBlackoutsTable.courtNumber), eq(rentalBlackoutsTable.courtNumber, courtNumber)),
      )
    );

  for (const b of blackouts) {
    if (!b.startTime || !b.endTime) return true; // all-day blackout
    if (slotsOverlap(startMin, endMin, timeToMinutes(b.startTime), timeToMinutes(b.endTime))) return true;
  }

  return false;
}

// ── Public: Get pricing tiers ─────────────────────────────────────────────────

router.get("/rentals/pricing", async (_req, res): Promise<void> => {
  const tiers = await db
    .select()
    .from(rentalPricingTable)
    .where(eq(rentalPricingTable.isActive, true))
    .orderBy(rentalPricingTable.sortOrder, rentalPricingTable.durationMinutes);
  res.json(tiers);
});

// ── Public: Get availability for a date + duration ────────────────────────────
// Returns { court: 1 | 2, availableSlots: string[] } for each court

router.get("/rentals/availability", async (req, res): Promise<void> => {
  const { date, durationMinutes } = req.query;
  if (!date || !durationMinutes) {
    res.status(400).json({ error: "date and durationMinutes are required" });
    return;
  }
  const dur = Number(durationMinutes);
  if (!dur || dur < 30) {
    res.status(400).json({ error: "invalid durationMinutes" });
    return;
  }

  // Business hours: 8 AM – 10 PM in 30-min increments
  const OPEN = 8 * 60;
  const CLOSE = 22 * 60;
  const COURTS = [1, 2];

  const result: { courtNumber: number; availableSlots: string[] }[] = [];

  for (const court of COURTS) {
    const slots: string[] = [];
    for (let start = OPEN; start + dur <= CLOSE; start += 30) {
      const end = start + dur;
      const conflict = await hasConflict(court, date as string, start, end);
      if (!conflict) slots.push(minutesToTime(start));
    }
    result.push({ courtNumber: court, availableSlots: slots });
  }

  res.json(result);
});

// ── Authed: Create rental + Stripe checkout session ───────────────────────────

router.post("/rentals/checkout", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const { date, startTime, pricingTierId, courtNumber } = req.body ?? {};

  if (!date || !startTime || !pricingTierId || !courtNumber) {
    res.status(400).json({ error: "date, startTime, pricingTierId, and courtNumber are required" });
    return;
  }

  const [tier] = await db.select().from(rentalPricingTable).where(eq(rentalPricingTable.id, Number(pricingTierId)));
  if (!tier || !tier.isActive) {
    res.status(404).json({ error: "Pricing tier not found" });
    return;
  }

  const startMin = timeToMinutes(startTime);
  const endMin = startMin + tier.durationMinutes;
  if (endMin > 22 * 60) {
    res.status(400).json({ error: "Booking extends past closing time (10 PM)" });
    return;
  }
  const endTime = minutesToTime(endMin);

  const conflict = await hasConflict(Number(courtNumber), date, startMin, endMin);
  if (conflict) {
    res.status(409).json({ error: "That time slot is no longer available. Please choose another." });
    return;
  }

  const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!dbUser) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Create rental in pending state
  const [rental] = await db.insert(rentalsTable).values({
    userId: dbUser.id,
    courtNumber: Number(courtNumber),
    date,
    startTime,
    endTime,
    durationMinutes: tier.durationMinutes,
    pricingTierId: tier.id,
    totalPrice: tier.price,
    status: "pending",
    paymentStatus: "unpaid",
  }).returning();

  const stripe = await getUncachableStripeClient();

  const session = await (stripe.checkout.sessions.create as any)({
    mode: "payment",
    ui_mode: "custom",
    return_url: `${APP_URL}/checkout/complete?session_id={CHECKOUT_SESSION_ID}`,
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: Math.round(Number(tier.price) * 100),
          product_data: {
            name: `Court ${courtNumber} Rental — ${tier.name}`,
            description: `${date} · ${startTime}–${endTime}`,
          },
        },
        quantity: 1,
      },
    ],
    metadata: {
      type: "rental",
      rentalId: String(rental.id),
      clerkUserId: authed.clerkUserId,
    },
    customer_email: dbUser.email ?? undefined,
    payment_intent_data: {
      receipt_email: dbUser.email ?? undefined,
      metadata: {
        type: "rental",
        rentalId: String(rental.id),
        clerkUserId: authed.clerkUserId,
      },
    },
  });

  await db.update(rentalsTable)
    .set({ stripeSessionId: session.id, updatedAt: new Date() })
    .where(eq(rentalsTable.id, rental.id));

  res.json({ clientSecret: session.client_secret, rentalId: rental.id });
});

// ── Authed: Get my rentals ─────────────────────────────────────────────────────

router.get("/rentals/my", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!dbUser) { res.json([]); return; }

  const rentals = await db
    .select()
    .from(rentalsTable)
    .where(eq(rentalsTable.userId, dbUser.id))
    .orderBy(rentalsTable.date);

  res.json(rentals);
});

// ── Admin: List all rentals ────────────────────────────────────────────────────

router.get("/admin/rentals", requireAdmin, async (req, res): Promise<void> => {
  const { date, status } = req.query;
  let query = db.select({
    rental: rentalsTable,
    userName: usersTable.firstName,
    userLastName: usersTable.lastName,
    userEmail: usersTable.email,
  }).from(rentalsTable)
    .leftJoin(usersTable, eq(rentalsTable.userId, usersTable.id))
    .$dynamic();

  const conditions = [];
  if (date) conditions.push(eq(rentalsTable.date, date as string));
  if (status) conditions.push(eq(rentalsTable.status, status as string));
  if (conditions.length) query = query.where(and(...conditions)) as any;

  const rows = await (query as any).orderBy(rentalsTable.date, rentalsTable.startTime);

  const result = rows.map((r: any) => ({
    ...r.rental,
    userName: r.userName ? `${r.userName} ${r.userLastName ?? ""}`.trim() : null,
    userEmail: r.userEmail,
  }));

  res.json(result);
});

// ── Admin: Create rental directly (no Stripe) ─────────────────────────────────

router.post("/admin/rentals", requireAdmin, async (req, res): Promise<void> => {
  const { courtNumber, date, startTime, pricingTierId, customerName, customerEmail, customerPhone, notes, adminNotes, paymentStatus = "unpaid" } = req.body ?? {};

  if (!courtNumber || !date || !startTime || !pricingTierId) {
    res.status(400).json({ error: "courtNumber, date, startTime, and pricingTierId are required" });
    return;
  }

  const [tier] = await db.select().from(rentalPricingTable).where(eq(rentalPricingTable.id, Number(pricingTierId)));
  if (!tier) {
    res.status(404).json({ error: "Pricing tier not found" });
    return;
  }

  const startMin = timeToMinutes(startTime);
  const endMin = startMin + tier.durationMinutes;
  if (endMin > 22 * 60) {
    res.status(400).json({ error: "Booking extends past closing time (10 PM)" });
    return;
  }
  const endTime = minutesToTime(endMin);

  const conflict = await hasConflict(Number(courtNumber), date, startMin, endMin);
  if (conflict) {
    res.status(409).json({ error: "That time slot is not available" });
    return;
  }

  // Try to find or create a user record for the customer
  let userId = 1; // fallback to first user (admin placeholder)
  if (customerEmail) {
    const [existingUser] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, customerEmail));
    if (existingUser) userId = existingUser.id;
  }

  const [rental] = await db.insert(rentalsTable).values({
    userId,
    courtNumber: Number(courtNumber),
    date,
    startTime,
    endTime,
    durationMinutes: tier.durationMinutes,
    pricingTierId: tier.id,
    totalPrice: tier.price,
    status: "confirmed",
    paymentStatus: paymentStatus as "paid" | "unpaid",
    notes: notes ?? null,
    adminNotes: adminNotes ? `${customerName ?? ""} ${customerEmail ?? ""} ${customerPhone ?? ""} — ${adminNotes}`.trim() : [customerName, customerEmail, customerPhone].filter(Boolean).join(" · ") || null,
  }).returning();

  res.json(rental);
});

// ── Admin: Update rental status ────────────────────────────────────────────────

router.patch("/admin/rentals/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { status, adminNotes } = req.body ?? {};
  const patch: any = { updatedAt: new Date() };
  if (status) patch.status = status;
  if (adminNotes !== undefined) patch.adminNotes = adminNotes;

  const [updated] = await db.update(rentalsTable).set(patch).where(eq(rentalsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

// ── Admin: Cancel rental + optional refund ─────────────────────────────────────

router.post("/admin/rentals/:id/cancel", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { refund = false } = req.body ?? {};

  const [rental] = await db.select().from(rentalsTable).where(eq(rentalsTable.id, id));
  if (!rental) { res.status(404).json({ error: "Not found" }); return; }

  if (refund && rental.stripePaymentIntentId) {
    try {
      const stripe = await getUncachableStripeClient();
      await (stripe.refunds.create as any)({ payment_intent: rental.stripePaymentIntentId });
      await db.update(rentalsTable).set({ status: "cancelled", paymentStatus: "refunded", updatedAt: new Date() }).where(eq(rentalsTable.id, id));
    } catch (err: any) {
      res.status(500).json({ error: "Refund failed: " + err.message });
      return;
    }
  } else {
    await db.update(rentalsTable).set({ status: "cancelled", updatedAt: new Date() }).where(eq(rentalsTable.id, id));
  }

  res.json({ ok: true });
});

// ── Admin: Pricing tiers CRUD ─────────────────────────────────────────────────

router.get("/admin/rental-pricing", requireAdmin, async (_req, res): Promise<void> => {
  const tiers = await db.select().from(rentalPricingTable).orderBy(rentalPricingTable.sortOrder, rentalPricingTable.durationMinutes);
  res.json(tiers);
});

router.post("/admin/rental-pricing", requireAdmin, async (req, res): Promise<void> => {
  const { name, durationMinutes, price, isActive = true, sortOrder = 0 } = req.body ?? {};
  if (!name || !durationMinutes || price == null) {
    res.status(400).json({ error: "name, durationMinutes, and price are required" });
    return;
  }
  const [tier] = await db.insert(rentalPricingTable).values({ name, durationMinutes: Number(durationMinutes), price: String(price), isActive, sortOrder }).returning();
  res.json(tier);
});

router.patch("/admin/rental-pricing/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { name, durationMinutes, price, isActive, sortOrder } = req.body ?? {};
  const patch: any = { updatedAt: new Date() };
  if (name !== undefined) patch.name = name;
  if (durationMinutes !== undefined) patch.durationMinutes = Number(durationMinutes);
  if (price !== undefined) patch.price = String(price);
  if (isActive !== undefined) patch.isActive = isActive;
  if (sortOrder !== undefined) patch.sortOrder = sortOrder;
  const [updated] = await db.update(rentalPricingTable).set(patch).where(eq(rentalPricingTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

router.delete("/admin/rental-pricing/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  await db.delete(rentalPricingTable).where(eq(rentalPricingTable.id, id));
  res.json({ ok: true });
});

// ── Admin: Blackouts CRUD ─────────────────────────────────────────────────────

router.get("/admin/rental-blackouts", requireAdmin, async (_req, res): Promise<void> => {
  const blackouts = await db.select().from(rentalBlackoutsTable).orderBy(rentalBlackoutsTable.date, rentalBlackoutsTable.startTime);
  res.json(blackouts);
});

router.post("/admin/rental-blackouts", requireAdmin, async (req, res): Promise<void> => {
  const { courtNumber, date, startTime, endTime, reason } = req.body ?? {};
  if (!date) { res.status(400).json({ error: "date is required" }); return; }
  const [blackout] = await db.insert(rentalBlackoutsTable).values({
    courtNumber: courtNumber ? Number(courtNumber) : null,
    date,
    startTime: startTime ?? null,
    endTime: endTime ?? null,
    reason: reason ?? null,
  }).returning();
  res.json(blackout);
});

router.delete("/admin/rental-blackouts/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  await db.delete(rentalBlackoutsTable).where(eq(rentalBlackoutsTable.id, id));
  res.json({ ok: true });
});

// ── Webhook handler (called from stripeWebhook.ts) ────────────────────────────

export async function handleRentalPayment(session: any): Promise<void> {
  const rentalId = Number(session.metadata?.rentalId);
  if (!rentalId) return;

  const piId: string = session.payment_intent ?? "";

  const [rental] = await db.select().from(rentalsTable).where(eq(rentalsTable.id, rentalId));
  if (!rental) return;

  await db.update(rentalsTable).set({
    status: "confirmed",
    paymentStatus: "paid",
    stripePaymentIntentId: piId || rental.stripePaymentIntentId,
    updatedAt: new Date(),
  }).where(eq(rentalsTable.id, rentalId));

  // Send confirmation email
  try {
    await sendNotificationWithPreferences({
      userId: rental.userId,
      type: "payment_receipt",
      subject: "Rental Confirmed — PlayOn",
      body: `Your Court ${rental.courtNumber} rental is confirmed for ${rental.date} from ${rental.startTime} to ${rental.endTime}. See you there!`,
      metadata: { rentalId: rental.id },
    });
  } catch (err) {
    console.error("[rentals] confirmation notification failed:", err);
  }
}

export default router;
