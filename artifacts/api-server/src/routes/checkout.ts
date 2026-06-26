import { Router, type IRouter } from "express";
import {
  db, registrationsTable, leaguesTable, campsTable, dropinsTable, tournamentsTable,
  discountCodesTable, paymentsTable, usersTable, accountCreditsTable, pricingRulesTable,
  leagueRegistrationsTable, tournamentRegistrationsTable,
  campRegistrationsTable, guardiansTable, userMembershipsTable,
} from "@workspace/db";
import { eq, and, gt, or, isNull, gte, sql, count } from "drizzle-orm";
import { requireAuth, type AuthedRequest } from "../middlewares/auth";
import { getUncachableStripeClient, getStripePublishableKey } from "../lib/stripe";
import { computeRevenueSplit } from "../services/revenueComputation";
import { applyPricingRuleModifiers as sharedApplyPricingRuleModifiers } from "../services/pricingPipeline";
import { restoreReservedCredits } from "../lib/creditUtils";
import type { Request } from "express";

const router: IRouter = Router();

async function getOfferingPrice(programType: string, programId: number): Promise<{
  name: string;
  basePrice: number;
  depositAmount: number | null;
  depositRequired: boolean;
  category: string;
  pricingRuleId?: number | null;
}> {
  if (programType === "league") {
    const [l] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, programId));
    if (!l) throw new Error("League not found");
    return { name: l.name, basePrice: Number(l.registrationPrice ?? 0), depositAmount: null, depositRequired: false, category: "league", pricingRuleId: l.pricingRuleId };
  } else if (programType === "camp") {
    const [c] = await db.select().from(campsTable).where(eq(campsTable.id, programId));
    if (!c) throw new Error("Camp not found");
    return { name: c.name, basePrice: Number(c.price ?? 0), depositAmount: null, depositRequired: false, category: "camp", pricingRuleId: c.pricingRuleId };
  } else if (programType === "drop_in") {
    const [d] = await db.select().from(dropinsTable).where(eq(dropinsTable.id, programId));
    if (!d) throw new Error("Drop-in not found");
    return { name: d.name, basePrice: Number(d.price ?? 0), depositAmount: null, depositRequired: false, category: "drop_in" };
  } else if (programType === "tournament") {
    const [t] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, programId));
    if (!t) throw new Error("Tournament not found");
    const depositAmount = t.depositAmount != null ? Number(t.depositAmount) : null;
    const depositRequired = depositAmount != null && depositAmount > 0;
    return { name: t.name, basePrice: Number(t.teamPrice ?? 0), depositAmount, depositRequired, category: "tournament" };
  }
  throw new Error(`Unknown program type: ${programType}`);
}

/**
 * Derive the server-authoritative sibling number for a camp registration.
 *
 * @param guardianDbUserId  DB user id of the logged-in guardian making the purchase.
 * @param campId            The camp being registered for.
 * @param playerDbUserId    DB user id of the actual camper (youth). May equal guardianDbUserId
 *                          for adult self-registrations; null if not yet known.
 *
 * Algorithm:
 *  1. Fetch all youth users linked to this guardian (approved + canRegister).
 *  2. Count existing confirmed/pending camp registrations in the same camp for
 *     any of those youth users, EXCLUDING the current player (to avoid counting
 *     a re-checkout of the same player as a "prior sibling").
 *  3. siblingNumber = prior_sibling_count + 1
 *     (1 = first child at full price, 2+ = sibling discount applies)
 */
async function deriveSiblingNumber(
  guardianDbUserId: number,
  campId: number,
  playerDbUserId: number | null,
): Promise<number> {
  // All youth users managed by this guardian
  const guardianLinks = await db
    .select({ youthUserId: guardiansTable.youthUserId })
    .from(guardiansTable)
    .where(and(
      eq(guardiansTable.guardianUserId, guardianDbUserId),
      eq(guardiansTable.status, "approved"),
      eq(guardiansTable.canRegister, true),
    ));

  if (guardianLinks.length === 0) return 1;

  const siblingUserIds = guardianLinks.map(g => g.youthUserId);

  // Count prior registrations in the same camp for OTHER siblings
  // (exclude the current player to avoid double-counting a re-checkout)
  const whereConditions: any[] = [
    eq(campRegistrationsTable.campId, campId),
    sql`${campRegistrationsTable.playerUserId} = ANY(ARRAY[${sql.join(siblingUserIds.map(id => sql`${id}::int`), sql`, `)}])`,
    sql`${campRegistrationsTable.status} IN ('confirmed', 'pending')`,
  ];
  if (playerDbUserId != null) {
    // Exclude the current camper's own existing registration
    whereConditions.push(sql`${campRegistrationsTable.playerUserId} != ${playerDbUserId}`);
  }

  const priorRows = await db
    .select({ id: campRegistrationsTable.id })
    .from(campRegistrationsTable)
    .where(and(...whereConditions));

  // siblingNumber = prior siblings already registered + 1 (this registration)
  return priorRows.length + 1;
}

async function applyDiscount(code: string, basePrice: number, programType: string, programId: number): Promise<{ discountAmount: number; discountCodeId: number }> {
  const [dc] = await db.select().from(discountCodesTable).where(
    and(eq(discountCodesTable.code, code.toUpperCase()), eq(discountCodesTable.isActive, true))
  );
  if (!dc) throw new Error("Invalid or inactive discount code");
  if (dc.maxUses != null && dc.timesUsed >= dc.maxUses) throw new Error("Discount code has reached its usage limit");
  const now = new Date();
  if (dc.validFrom && new Date(dc.validFrom) > now) throw new Error("Discount code is not yet active");
  if (dc.validUntil && new Date(dc.validUntil) < now) throw new Error("Discount code has expired");
  if (dc.minOrderAmount && basePrice < Number(dc.minOrderAmount)) throw new Error(`Minimum order amount of $${dc.minOrderAmount} required`);
  // applicableTo is the primary gate. Values: "all" | "league" | "camp" | "drop_in" | "tournament" | "specific"
  // entityType/entityId are secondary filters for narrowing to a specific program.
  if (dc.applicableTo !== "all") {
    // If applicableTo is a type name (league, camp, etc.) enforce it regardless of entityType field
    const typeGates = ["league", "camp", "drop_in", "tournament"];
    if (typeGates.includes(dc.applicableTo) && dc.applicableTo !== programType) {
      throw new Error(`Discount code is only valid for ${dc.applicableTo.replace("_", " ")} registrations`);
    }
    // "specific" — both entityType and entityId must match
    if (dc.applicableTo === "specific") {
      if (dc.entityType && dc.entityType !== programType) throw new Error("Discount code not applicable to this offering type");
      if (dc.entityId && dc.entityId !== programId) throw new Error("Discount code not applicable to this specific offering");
    }
  }
  let discountAmount = 0;
  if (dc.discountType === "percent") {
    discountAmount = basePrice * (Number(dc.discountValue) / 100);
  } else {
    discountAmount = Math.min(Number(dc.discountValue), basePrice);
  }
  return { discountAmount: Math.round(discountAmount * 100) / 100, discountCodeId: dc.id };
}

// POST /checkout/fee-preview — returns service fee for a given amount (no admin required)
// Used by checkout UI to show accurate fee/total before submitting.
router.post("/checkout/fee-preview", requireAuth, async (req: Request, res): Promise<void> => {
  const body = req.body as { grossAmount?: number; programType?: string; programId?: number };
  const grossAmount = Number(body.grossAmount);
  if (!grossAmount || isNaN(grossAmount) || grossAmount <= 0) {
    res.json({ serviceFeeAmount: 0, totalAmount: 0 });
    return;
  }
  try {
    const split = await computeRevenueSplit({
      entityType: body.programType ?? "league",
      entityId: body.programId ?? null,
      category: body.programType ?? "league",
      grossAmount,
      paymentMethod: "card",
    });
    res.json({ serviceFeeAmount: split.serviceFeeAmount, totalAmount: grossAmount + split.serviceFeeAmount });
  } catch (_) {
    res.json({ serviceFeeAmount: 0, totalAmount: grossAmount });
  }
});

// GET /checkout/session-status?session_id=cs_xxx
// Returns the Stripe session's payment status so the /checkout/complete page
// can show an accurate success / pending / failed state after a redirect.
router.get("/checkout/session-status", requireAuth, async (req: Request, res): Promise<void> => {
  const sessionId = (req.query.session_id ?? "") as string;
  if (!sessionId.startsWith("cs_")) {
    res.status(400).json({ error: "session_id is required" });
    return;
  }
  try {
    const stripe = await getUncachableStripeClient();
    const session = await (stripe.checkout.sessions.retrieve as any)(sessionId, {
      expand: ["line_items"],
    });
    const meta: Record<string, string> = (session.metadata as any) ?? {};
    res.json({
      status: session.status as string,
      paymentStatus: session.payment_status as string,
      programType: meta.programType ?? null,
      programId: meta.programId ? Number(meta.programId) : null,
      offeringName: (session.line_items?.data?.[0] as any)?.description ?? null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Failed to retrieve session" });
  }
});

// GET /checkout/publishable-key
router.get("/checkout/publishable-key", async (_req, res): Promise<void> => {
  try {
    const key = await getStripePublishableKey();
    res.json({ publishableKey: key });
  } catch (_) {
    res.status(503).json({ error: "Stripe not configured" });
  }
});

// POST /checkout/session
router.post("/checkout/session", requireAuth, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const body = req.body as {
    registrationId?: number;
    programType?: string;
    programId?: number;
    discountCode?: string;
    useCredits?: boolean;
    /** DB user id of the camper (youth) being registered — used for server-side sibling derivation. Ignored for non-camp programs. */
    playerUserId?: number;
    /** ID of the campRegistrationsTable row — included in Stripe metadata so the webhook can update campRegistrationsTable.paymentStatus after payment. */
    campRegId?: number;
    successUrl?: string;
    cancelUrl?: string;
  };

  if (!body.programType || !body.programId) {
    res.status(400).json({ error: "programType and programId are required" });
    return;
  }

  try {
    // ── 1. Look up user ───────────────────────────────────────────────────────
    const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));

    // ── 2. Verify registrationId ownership ───────────────────────────────────
    if (body.registrationId != null) {
      const [reg] = await db.select().from(registrationsTable).where(eq(registrationsTable.id, body.registrationId));
      if (!reg) {
        res.status(404).json({ error: "Registration not found" });
        return;
      }
      const isSelfRegistration = reg.userId === authed.clerkUserId;
      if (!isSelfRegistration) {
        // Guardian paying on behalf of a child — verify the logged-in user is an approved guardian
        // of the registration owner. registrationsTable.userId is a Clerk ID; look up the youth's DB row.
        let guardianAllowed = false;
        if (dbUser) {
          const [youthUser] = await db
            .select({ id: usersTable.id })
            .from(usersTable)
            .where(eq(usersTable.clerkId, reg.userId));
          if (youthUser) {
            const [link] = await db
              .select()
              .from(guardiansTable)
              .where(
                and(
                  eq(guardiansTable.guardianUserId, dbUser.id),
                  eq(guardiansTable.youthUserId, youthUser.id),
                  eq(guardiansTable.status, "approved" as any),
                )
              );
            guardianAllowed = !!link;
          }
        }
        if (!guardianAllowed) {
          res.status(403).json({ error: "You do not have access to this registration" });
          return;
        }
      }
      if (reg.programType !== body.programType || reg.programId !== body.programId) {
        res.status(400).json({ error: "registrationId does not match programType/programId" });
        return;
      }
      if (reg.paymentStatus === "paid_inapp" || reg.paymentStatus === "paid_external") {
        res.status(409).json({ error: "Registration is already paid" });
        return;
      }
      if (reg.status === "expired") {
        res.status(410).json({ error: "Your registration has expired. Please register again to secure a spot.", expired: true });
        return;
      }
    }

    // ── 2b. Verify campRegId ownership + consistency ──────────────────────────
    if (body.campRegId != null) {
      const [campReg] = await db
        .select()
        .from(campRegistrationsTable)
        .where(eq(campRegistrationsTable.id, body.campRegId));
      if (!campReg) {
        res.status(404).json({ error: "Camp registration not found" });
        return;
      }
      // Ownership: payer must be self or an approved guardian of the registrant
      const isSelf = campReg.userId === dbUser?.id || campReg.playerUserId === dbUser?.id;
      let isGuardian = false;
      if (!isSelf && campReg.playerUserId && dbUser) {
        const [link] = await db
          .select()
          .from(guardiansTable)
          .where(
            and(
              eq(guardiansTable.guardianUserId, dbUser.id),
              eq(guardiansTable.youthUserId, campReg.playerUserId),
              eq(guardiansTable.status, "approved" as any),
            )
          );
        isGuardian = !!link;
      }
      if (!isSelf && !isGuardian) {
        res.status(403).json({ error: "You do not have access to this camp registration" });
        return;
      }
      // Consistency: campRegId must match the programId being checked out
      if (campReg.campId !== body.programId) {
        res.status(400).json({ error: "campRegId does not match programId" });
        return;
      }
      if (campReg.paymentStatus === "paid_inapp" || campReg.paymentStatus === "paid_external") {
        res.status(409).json({ error: "Camp registration is already paid" });
        return;
      }
      if (campReg.status === "cancelled") {
        res.status(409).json({ error: "Camp registration is cancelled" });
        return;
      }
    }

    // ── 3. Get offering price ─────────────────────────────────────────────────
    const offering = await getOfferingPrice(body.programType, body.programId);
    let basePrice = offering.basePrice;

    if (basePrice <= 0) {
      res.status(400).json({ error: "This offering has no price configured" });
      return;
    }

    // ── 4. Apply PricingRule modifiers (early-bird, late fee, sibling) ────────
    // Derive sibling number server-side from guardian relationships — do NOT trust client-supplied value.
    // body.playerUserId is the DB id of the camper (youth); guardianDbUserId is the logged-in account holder.
    let serverSiblingNumber = 1;
    if (offering.category === "camp" && dbUser) {
      const playerDbUserId = body.playerUserId != null ? body.playerUserId : dbUser.id;
      serverSiblingNumber = await deriveSiblingNumber(dbUser.id, body.programId, playerDbUserId);
    }

    const { adjustedPrice, modifiers } = await sharedApplyPricingRuleModifiers({
      basePrice,
      pricingRuleId: offering.pricingRuleId,
      category: offering.category,
      serverSiblingNumber,
    });
    basePrice = adjustedPrice;

    // ── 4b. Apply member pricing — if user has an active membership and the
    //        PricingRule has a memberPrice lower than the current basePrice,
    //        substitute the member rate and record the applied discount label.
    if (dbUser && offering.pricingRuleId) {
      const today = new Date().toISOString().slice(0, 10);
      const [activeMem] = await db
        .select()
        .from(userMembershipsTable)
        .where(
          and(
            eq(userMembershipsTable.userId, dbUser.id),
            eq(userMembershipsTable.status, "active"),
            // endDate NULL = no expiry; endDate >= today = still within billing period
            or(isNull(userMembershipsTable.endDate), gte(userMembershipsTable.endDate, today)),
          ),
        )
        .limit(1);

      if (activeMem) {
        const [rule] = await db.select().from(pricingRulesTable)
          .where(eq(pricingRulesTable.id, offering.pricingRuleId));
        const memberPrice = rule?.memberPrice ? Number(rule.memberPrice) : null;
        if (memberPrice !== null && memberPrice < basePrice) {
          const savings = (basePrice - memberPrice).toFixed(2);
          modifiers.push(`Member rate applied (save $${savings})`);
          basePrice = memberPrice;
        }
      }
    }

    // ── 5. Apply discount code ────────────────────────────────────────────────
    let discountAmount = 0;
    let discountCodeId: number | null = null;
    if (body.discountCode) {
      try {
        const result = await applyDiscount(body.discountCode, basePrice, body.programType, body.programId);
        discountAmount = result.discountAmount;
        discountCodeId = result.discountCodeId;
      } catch (e: any) {
        res.status(400).json({ error: e.message });
        return;
      }
    }
    const discountedPrice = Math.max(0, basePrice - discountAmount);

    // ── 6. Reserve account credits with conditional DB updates ────────────────
    //   Each credit row is decremented only if its current remaining_amount
    //   still covers the intended consume amount at the moment of update.
    //   This prevents concurrent sessions from over-allocating the same credits
    //   without requiring a serializable transaction.
    //   Credits are reserved now (pre-Stripe). On session expiry or creation
    //   failure, the restoreReservedCredits() compensating function is called.
    let creditApplied = 0;
    const reservedCreditIds: Array<{ id: number; consumed: number }> = [];

    if (body.useCredits && dbUser) {
      const now = new Date();
      const credits = await db.select().from(accountCreditsTable)
        .where(and(
          eq(accountCreditsTable.userId, dbUser.id),
          or(isNull(accountCreditsTable.expiresAt), gt(accountCreditsTable.expiresAt, now)),
          sql`${accountCreditsTable.remainingAmount} > 0`,
        ));
      let toApply = discountedPrice;
      for (const credit of credits) {
        if (toApply <= 0) break;
        const avail = Number(credit.remainingAmount);
        if (avail <= 0) continue;
        const consume = Math.min(avail, toApply);
        // Conditional update: only succeeds if remaining_amount hasn't changed
        // since we read it. If another session consumed it first, this is a no-op.
        const updated = await db.update(accountCreditsTable)
          .set({ remainingAmount: String(avail - consume), usedAt: new Date(), updatedAt: new Date() } as any)
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
        // If updated.length === 0, another session won the race — skip this credit
      }
    }

    const priceAfterCredits = Math.max(0, discountedPrice - creditApplied);

    // ── 7. Compute service fee ─────────────────────────────────────────────────
    const split = await computeRevenueSplit({
      entityType: body.programType,
      entityId: body.programId,
      category: offering.category,
      grossAmount: priceAfterCredits,
      paymentMethod: "card",
    });
    const serviceFeeAmount = split.serviceFeeAmount;
    const totalAmount = priceAfterCredits + serviceFeeAmount;

    // ── 8. Credits-only path (no Stripe needed) ───────────────────────────────
    if (totalAmount <= 0 && creditApplied > 0) {
      const [paymentRecord] = await db.insert(paymentsTable).values({
        userId: dbUser?.id ?? null,
        entityType: body.programType,
        entityId: body.programId,
        registrationId: body.registrationId ?? null,
        amount: String(creditApplied),
        currency: "usd",
        status: "paid",
        provider: "credit",
        paymentMethod: "account_credit",
        serviceFeeAmount: "0",
        metadata: JSON.stringify({ creditApplied, discountCodeId }),
      } as any).returning();

      if (body.registrationId) {
        await db.update(registrationsTable)
          .set({ paymentStatus: "paid_inapp", amountPaid: String(creditApplied), updatedAt: new Date() } as any)
          .where(eq(registrationsTable.id, body.registrationId));
      }

      res.json({ creditOnly: true, paymentId: paymentRecord.id });
      return;
    }

    // ── 9. Create Stripe Checkout Session + pending record ────────────────────
    //   Uses ui_mode:"custom" so the session client_secret drives the
    //   CheckoutElementsProvider on the frontend (checkout.confirm() API).
    //   checkout.session.completed in the webhook handles fulfilment;
    //   sessions auto-expire (no manual cleanup needed).
    //   If anything fails here we must restore pre-reserved credits so they
    //   aren't stranded (no webhook will fire for a session that was never created).
    let checkoutSessionId: string;
    let clientSecret: string;
    try {
      const stripe = await getUncachableStripeClient();

      const sharedMeta = {
        clerkUserId: authed.clerkUserId,
        programType: body.programType,
        programId: String(body.programId),
        registrationId: body.registrationId != null ? String(body.registrationId) : "",
        campRegId: body.campRegId != null ? String(body.campRegId) : "",
        discountCodeId: discountCodeId != null ? String(discountCodeId) : "",
        creditApplied: String(creditApplied),
        reservedCreditIds: JSON.stringify(reservedCreditIds),
        basePrice: String(priceAfterCredits),
        serviceFeeAmount: String(serviceFeeAmount),
        category: offering.category,
      };

      const origin = (req.headers.origin ?? req.headers.referer ?? "https://playonfutsal.vercel.app").replace(/\/$/, "");
      const session = await (stripe.checkout.sessions.create as any)({
        mode: "payment",
        ui_mode: "custom",
        return_url: `${origin}/checkout/complete?session_id={CHECKOUT_SESSION_ID}`,
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: { name: offering.name },
            unit_amount: Math.round(totalAmount * 100),
          },
          quantity: 1,
        }],
        metadata: sharedMeta,
        customer_email: dbUser?.email || undefined,
        payment_intent_data: {
          receipt_email: dbUser?.email || undefined,
          metadata: sharedMeta,
        },
      });

      checkoutSessionId = session.id as string;
      clientSecret = session.client_secret as string;
      if (!clientSecret) throw new Error("Checkout session did not return a client secret");

      await db.insert(paymentsTable).values({
        userId: dbUser?.id ?? null,
        entityType: body.programType,
        entityId: body.programId,
        registrationId: body.registrationId ?? null,
        amount: String(totalAmount),
        currency: "usd",
        status: "pending",
        provider: "stripe",
        providerPaymentId: checkoutSessionId,
        paymentMethod: "card",
        serviceFeeAmount: String(serviceFeeAmount),
        metadata: JSON.stringify({ checkoutSessionId, discountCodeId, creditApplied, reservedCreditIds }),
      } as any);
    } catch (stripeErr: any) {
      if (reservedCreditIds.length > 0) {
        await restoreReservedCredits(JSON.stringify(reservedCreditIds)).catch(() => {});
      }
      throw stripeErr;
    }

    res.json({ clientSecret, checkoutSessionId, publishableKey: await getStripePublishableKey(), amount: totalAmount, serviceFeeAmount, basePrice: priceAfterCredits });
  } catch (err: any) {
    console.error("Checkout session error:", err);
    res.status(500).json({ error: err.message ?? "Failed to create checkout session" });
  }
});

// POST /checkout/cancel-intent
// Expires a pending Checkout Session (or cancels a legacy PaymentIntent) and
// restores any pre-reserved account credits. Called by the frontend when the user
// clicks "Go back" from the embedded payment form.
// Accepts either checkoutSessionId (cs_xxx) or paymentIntentId (pi_xxx, legacy).
router.post("/checkout/cancel-intent", requireAuth, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const body = req.body as { checkoutSessionId?: string; paymentIntentId?: string };
  const providerId = body.checkoutSessionId ?? body.paymentIntentId;
  if (!providerId) {
    res.status(400).json({ error: "checkoutSessionId is required" });
    return;
  }

  const isSession = providerId.startsWith("cs_");

  try {
    const [paymentRow] = await db.select().from(paymentsTable)
      .where(eq(paymentsTable.providerPaymentId, providerId));

    if (!paymentRow) {
      res.json({ cancelled: true });
      return;
    }

    const stripe = await getUncachableStripeClient();

    if (isSession) {
      // ── Checkout Session path ────────────────────────────────────────────
      const session = await stripe.checkout.sessions.retrieve(providerId);
      const sessionClerkUserId = (session.metadata as any)?.clerkUserId ?? "";
      if (sessionClerkUserId !== authed.clerkUserId) {
        res.status(403).json({ error: "You do not have access to this payment" });
        return;
      }

      if (session.status === "complete") {
        res.json({ cancelled: false, alreadySucceeded: true });
        return;
      }

      if (session.status !== "expired") {
        try { await stripe.checkout.sessions.expire(providerId); } catch (_) {}
      }

      const [freshPaymentRow] = await db.select().from(paymentsTable)
        .where(eq(paymentsTable.providerPaymentId, providerId));

      if (freshPaymentRow?.status === "paid") {
        res.json({ cancelled: false, alreadySucceeded: true });
        return;
      }

      if (freshPaymentRow) {
        await db.update(paymentsTable)
          .set({ status: "failed", updatedAt: new Date() } as any)
          .where(and(
            eq(paymentsTable.providerPaymentId, providerId),
            sql`${paymentsTable.status} != 'paid'`,
          ));
      }

      const reservedJson = (session.metadata as any)?.reservedCreditIds;
      if (reservedJson) {
        const [creditRow] = await db.select({ id: paymentsTable.id, status: paymentsTable.status, metadata: paymentsTable.metadata })
          .from(paymentsTable).where(eq(paymentsTable.providerPaymentId, providerId));
        if (creditRow && creditRow.status !== "paid") {
          const meta = creditRow.metadata
            ? (() => { try { return JSON.parse(creditRow.metadata as string); } catch { return {}; } })()
            : {};
          const flagged = await db.update(paymentsTable)
            .set({ metadata: JSON.stringify({ ...meta, creditsRestored: true }), updatedAt: new Date() } as any)
            .where(and(
              eq(paymentsTable.id, creditRow.id),
              sql`${paymentsTable.status} != 'paid'`,
              sql`(metadata::jsonb->>'creditsRestored')::boolean IS NOT TRUE`,
            ))
            .returning({ id: paymentsTable.id });
          if (flagged.length > 0) {
            await restoreReservedCredits(reservedJson);
          }
        }
      }
    } else {
      // ── Legacy PaymentIntent path (backward compat for in-flight pi_ payments) ─
      const pi = await stripe.paymentIntents.retrieve(providerId);
      const piClerkUserId = (pi.metadata as any)?.clerkUserId ?? "";
      if (piClerkUserId !== authed.clerkUserId) {
        res.status(403).json({ error: "You do not have access to this payment" });
        return;
      }

      if (pi.status === "succeeded") {
        res.json({ cancelled: false, alreadySucceeded: true });
        return;
      }

      if (pi.status !== "canceled") {
        await stripe.paymentIntents.cancel(providerId);
      }

      const [freshPaymentRow] = await db.select().from(paymentsTable)
        .where(eq(paymentsTable.providerPaymentId, providerId));

      if (freshPaymentRow?.status === "paid") {
        res.json({ cancelled: false, alreadySucceeded: true });
        return;
      }

      if (freshPaymentRow) {
        await db.update(paymentsTable)
          .set({ status: "failed", updatedAt: new Date() } as any)
          .where(and(
            eq(paymentsTable.providerPaymentId, providerId),
            sql`${paymentsTable.status} != 'paid'`,
          ));
      }

      const reservedJson = (pi.metadata as any)?.reservedCreditIds;
      if (reservedJson) {
        const [creditRow] = await db.select({ id: paymentsTable.id, status: paymentsTable.status, metadata: paymentsTable.metadata })
          .from(paymentsTable).where(eq(paymentsTable.providerPaymentId, providerId));
        if (creditRow && creditRow.status !== "paid") {
          const meta = creditRow.metadata
            ? (() => { try { return JSON.parse(creditRow.metadata as string); } catch { return {}; } })()
            : {};
          const flagged = await db.update(paymentsTable)
            .set({ metadata: JSON.stringify({ ...meta, creditsRestored: true }), updatedAt: new Date() } as any)
            .where(and(
              eq(paymentsTable.id, creditRow.id),
              sql`${paymentsTable.status} != 'paid'`,
              sql`(metadata::jsonb->>'creditsRestored')::boolean IS NOT TRUE`,
            ))
            .returning({ id: paymentsTable.id });
          if (flagged.length > 0) {
            await restoreReservedCredits(reservedJson);
          }
        }
      }
    }

    res.json({ cancelled: true });
  } catch (err: any) {
    console.error("Cancel intent error:", err);
    res.status(500).json({ error: err.message ?? "Failed to cancel payment" });
  }
});

// POST /checkout/validate-discount
router.post("/checkout/validate-discount", requireAuth, async (req: Request, res): Promise<void> => {
  const body = req.body as { code?: string; programType?: string; programId?: number; basePrice?: number };
  if (!body.code || !body.programType || !body.programId) {
    res.status(400).json({ error: "code, programType, and programId are required" });
    return;
  }
  try {
    const offering = body.basePrice != null
      ? { basePrice: body.basePrice }
      : await getOfferingPrice(body.programType, body.programId);

    const result = await applyDiscount(body.code, offering.basePrice, body.programType, body.programId);
    res.json({
      valid: true,
      discountAmount: result.discountAmount,
      finalPrice: Math.max(0, offering.basePrice - result.discountAmount),
    });
  } catch (e: any) {
    res.status(400).json({ valid: false, error: e.message });
  }
});

export default router;
