import { Router, type IRouter } from "express";
import { db, registrationsTable, leaguesTable, campsTable, dropinsTable, tournamentsTable, activityTable, usersTable, guardiansTable } from "@workspace/db";
import { eq, and, ne, inArray, sql, asc } from "drizzle-orm";
import { sendNotificationWithPreferences, sendRegistrationConfirmationEmail } from "../services/notifications";
import {
  ListRegistrationsQueryParams,
  ListRegistrationsResponse,
  GetRegistrationParams,
  GetRegistrationResponse,
  CreateRegistrationBody,
  UpdateRegistrationParams,
  UpdateRegistrationBody,
  UpdateRegistrationResponse,
  CancelRegistrationParams,
} from "@workspace/api-zod";
import { requireAuth, requirePermission, hasPermission, type AuthedRequest } from "../middlewares/auth";

const router: IRouter = Router();

async function getProgramName(type: string, id: number): Promise<string> {
  if (type === "league") {
    const [l] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, id));
    return l?.name ?? "Unknown League";
  } else if (type === "camp") {
    const [c] = await db.select().from(campsTable).where(eq(campsTable.id, id));
    return c?.name ?? "Unknown Camp";
  } else if (type === "drop_in") {
    const [d] = await db.select().from(dropinsTable).where(eq(dropinsTable.id, id));
    return d?.name ?? "Unknown Drop-in";
  } else if (type === "tournament") {
    const [t] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, id));
    return t?.name ?? "Unknown Tournament";
  }
  return "Unknown Program";
}

async function getProgramBasePrice(type: string, id: number): Promise<number> {
  if (type === "league") {
    const [l] = await db.select({ price: leaguesTable.registrationPrice }).from(leaguesTable).where(eq(leaguesTable.id, id));
    return Number(l?.price ?? 0);
  } else if (type === "camp") {
    const [c] = await db.select({ price: campsTable.price }).from(campsTable).where(eq(campsTable.id, id));
    return Number(c?.price ?? 0);
  } else if (type === "drop_in") {
    const [d] = await db.select({ price: dropinsTable.price }).from(dropinsTable).where(eq(dropinsTable.id, id));
    return Number(d?.price ?? 0);
  } else if (type === "tournament") {
    const [t] = await db.select({ price: tournamentsTable.teamPrice }).from(tournamentsTable).where(eq(tournamentsTable.id, id));
    return Number(t?.price ?? 0);
  }
  return 0;
}

const parseReg = (r: any) => ({ ...r, amountPaid: Number(r.amountPaid) });

// List registrations: regular users see only their own; staff must have canViewRegistrations to see all.
router.get("/registrations", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const canView = await hasPermission(authed.clerkUserId, "canViewRegistrations");
  const query = ListRegistrationsQueryParams.safeParse(req.query);

  let regs = await db.select().from(registrationsTable).orderBy(registrationsTable.createdAt);

  if (!canView) {
    // Regular user: restrict to own registrations only
    regs = regs.filter((r) => r.userId === authed.clerkUserId);
  } else if (query.success && query.data.userId) {
    regs = regs.filter((r) => r.userId === query.data.userId);
  }

  if (query.success) {
    if (query.data.programType) regs = regs.filter((r) => r.programType === query.data.programType);
    if (query.data.status) regs = regs.filter((r) => r.status === query.data.status);
  }

  res.json(ListRegistrationsResponse.parse(regs.map(parseReg)));
});

// Create registration: any authenticated user registers themselves, or a guardian registers a linked child.
// Optional body field: targetPlayerClerkId — if provided and different from requester, validates guardian link.
// For paid events: sets status = 'pending_payment' with a 10-minute expiry window.
// For free events: confirms immediately.
router.post("/registrations", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const parsed = CreateRegistrationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const targetPlayerClerkId: string | undefined = req.body.targetPlayerClerkId;
  let effectiveClerkId = authed.clerkUserId;

  if (targetPlayerClerkId && targetPlayerClerkId !== authed.clerkUserId) {
    const [targetUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, targetPlayerClerkId));
    if (!targetUser) {
      res.status(404).json({ error: "Target player not found" });
      return;
    }

    const [guardian] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, authed.clerkUserId));
    if (!guardian) {
      res.status(401).json({ error: "Guardian not found" });
      return;
    }

    const [guardianLink] = await db
      .select()
      .from(guardiansTable)
      .where(
        and(
          eq(guardiansTable.guardianUserId, guardian.id),
          eq(guardiansTable.youthUserId, targetUser.id),
          eq(guardiansTable.status, "approved"),
        ),
      );

    if (!guardianLink) {
      res.status(403).json({ error: "You are not an approved guardian for this player" });
      return;
    }

    effectiveClerkId = targetPlayerClerkId;
  }

  const { programType, programId } = parsed.data;
  const programName = await getProgramName(programType, programId);

  // Capacity check: count confirmed AND pending_payment registrations (both hold a spot).
  // Expired and cancelled registrations do not count.
  let maxCapacity: number | null = null;
  if (programType === "camp") {
    const [c] = await db.select({ max: campsTable.maxParticipants }).from(campsTable).where(eq(campsTable.id, programId));
    maxCapacity = c?.max ?? null;
  } else if (programType === "league") {
    const [l] = await db.select({ max: leaguesTable.maxTeams }).from(leaguesTable).where(eq(leaguesTable.id, programId));
    maxCapacity = l?.max ?? null;
  } else if (programType === "tournament") {
    const [t] = await db.select({ max: tournamentsTable.maxTeams }).from(tournamentsTable).where(eq(tournamentsTable.id, programId));
    maxCapacity = t?.max ?? null;
  } else if (programType === "drop_in") {
    const [d] = await db.select({ max: dropinsTable.maxPlayers }).from(dropinsTable).where(eq(dropinsTable.id, programId));
    maxCapacity = d?.max ?? null;
  }

  const [{ confirmedCount }] = await db
    .select({ confirmedCount: sql<number>`count(*)::int` })
    .from(registrationsTable)
    .where(and(
      eq(registrationsTable.programType, programType),
      eq(registrationsTable.programId, programId),
      ne(registrationsTable.status, "cancelled"),
      ne(registrationsTable.status, "waitlisted"),
      ne(registrationsTable.status, "expired"),
    ));

  const isFull = maxCapacity !== null && (confirmedCount ?? 0) >= maxCapacity;

  let waitlistPosition: number | null = null;
  if (isFull) {
    const [{ wlCount }] = await db
      .select({ wlCount: sql<number>`count(*)::int` })
      .from(registrationsTable)
      .where(and(
        eq(registrationsTable.programType, programType),
        eq(registrationsTable.programId, programId),
        eq(registrationsTable.status, "waitlisted"),
      ));
    waitlistPosition = (wlCount ?? 0) + 1;
  }

  // Determine if the offering is paid to decide whether to require a payment window.
  // Waitlisted registrations are not affected — they confirm when promoted.
  const basePrice = await getProgramBasePrice(programType, programId);
  const isPaid = basePrice > 0;
  const needsPaymentWindow = isPaid && !isFull;

  const expiresAt = needsPaymentWindow
    ? new Date(Date.now() + 10 * 60 * 1000) // 10-minute payment window
    : null;

  const registrationStatus = isFull
    ? "waitlisted"
    : needsPaymentWindow
    ? "pending_payment"
    : "confirmed";

  const [reg] = await db.insert(registrationsTable).values({
    userId: effectiveClerkId,
    programType,
    programId,
    programName,
    teamId: parsed.data.teamId ?? null,
    status: registrationStatus,
    waitlistPosition: waitlistPosition ?? undefined,
    amountPaid: "0",
    paymentStatus: "unpaid",
    expiresAt,
  } as any).returning();

  await db.insert(activityTable).values({
    type: "registration",
    message: isFull
      ? `Joined waitlist for ${programName} (position #${waitlistPosition})`
      : needsPaymentWindow
      ? `Started registration for ${programName} — awaiting payment`
      : `Registered for ${programName}`,
    userId: effectiveClerkId,
    programName,
  });

  // Send registration confirmation email for free registrations (Stripe-less path)
  if (registrationStatus === "confirmed") {
    try {
      const [playerDbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, effectiveClerkId));
      if (playerDbUser) {
        // If a guardian registered on behalf of a child, send to the guardian but use child's QR
        const recipientClerkId = authed.clerkUserId;
        let recipientUserId = playerDbUser.id;
        if (recipientClerkId !== effectiveClerkId) {
          const [guardianDbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, recipientClerkId));
          if (guardianDbUser) recipientUserId = guardianDbUser.id;
        }
        await sendRegistrationConfirmationEmail({
          recipientUserId,
          playerUserId: playerDbUser.id,
          entityType: programType,
          entityId: programId,
          amountPaid: 0,
        });
      }
    } catch (emailErr) {
      console.error("[registrations] confirmation email failed:", emailErr);
    }
  }

  res.status(201).json(GetRegistrationResponse.parse(parseReg(reg)));
});

// Re-enrollment suggestions: returns one suggestion per unique program the authenticated user
// (or any of their approved dependents) has previously registered for.
router.get("/registrations/re-enrollment", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const [dbUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, req.clerkUserId));
    if (!dbUser) return res.status(401).json({ error: "User not found" });

    let clerkIds = [dbUser.clerkId];

    if (dbUser.role === "parent") {
      const children = await db
        .select({ clerkId: usersTable.clerkId })
        .from(guardiansTable)
        .innerJoin(usersTable, eq(guardiansTable.youthUserId, usersTable.id))
        .where(
          and(
            eq(guardiansTable.guardianUserId, dbUser.id),
            eq(guardiansTable.status, "approved"),
          ),
        );
      clerkIds = [...clerkIds, ...children.map((c) => c.clerkId)];
    }

    const pastRegs = await db
      .select()
      .from(registrationsTable)
      .where(
        and(
          inArray(registrationsTable.userId, clerkIds),
          ne(registrationsTable.status, "cancelled"),
        ),
      )
      .orderBy(registrationsTable.createdAt)
      .limit(20);

    const byProgram = new Map<string, typeof pastRegs[0]>();
    for (const reg of pastRegs) {
      const key = `${reg.programType}:${reg.programName}`;
      if (!byProgram.has(key)) byProgram.set(key, reg);
    }

    const suggestions = Array.from(byProgram.values()).map((r) => ({
      previousRegistrationId: r.id,
      userId: r.userId,
      playerClerkId: r.userId,
      programType: r.programType,
      programId: r.programId,
      programName: r.programName,
      lastRegisteredAt: r.createdAt,
      prefillHint: {
        programType: r.programType,
        programId: r.programId,
        teamId: r.teamId,
      },
    }));

    res.json(suggestions);
  } catch (err) {
    console.error("[re-enrollment] GET error:", err);
    res.status(500).json({ error: "Failed to load re-enrollment suggestions" });
  }
});

// Get single registration: owner always allowed; staff must have canViewRegistrations.
router.get("/registrations/:id", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const params = GetRegistrationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [reg] = await db.select().from(registrationsTable).where(eq(registrationsTable.id, params.data.id));
  if (!reg) {
    res.status(404).json({ error: "Registration not found" });
    return;
  }
  const isOwner = reg.userId === authed.clerkUserId;
  const canView = await hasPermission(authed.clerkUserId, "canViewRegistrations");
  if (!isOwner && !canView) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  res.json(GetRegistrationResponse.parse(parseReg(reg)));
});

// Update registration: requires canEditRegistrations (admin or scoped staff).
router.patch("/registrations/:id", requirePermission("canEditRegistrations"), async (req, res): Promise<void> => {
  const params = UpdateRegistrationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateRegistrationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [reg] = await db
    .update(registrationsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(registrationsTable.id, params.data.id))
    .returning();
  if (!reg) {
    res.status(404).json({ error: "Registration not found" });
    return;
  }
  res.json(UpdateRegistrationResponse.parse(parseReg(reg)));
});

// Cancel registration: owner may cancel their own; staff must have canEditRegistrations to cancel any.
router.delete("/registrations/:id", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const params = CancelRegistrationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [reg] = await db.select().from(registrationsTable).where(eq(registrationsTable.id, params.data.id));
  if (!reg) {
    res.status(404).json({ error: "Registration not found" });
    return;
  }
  const isOwner = reg.userId === authed.clerkUserId;
  const canEdit = await hasPermission(authed.clerkUserId, "canEditRegistrations");
  if (!isOwner && !canEdit) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const [updated] = await db
    .update(registrationsTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(registrationsTable.id, params.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Registration not found" });
    return;
  }

  // Auto-promote the next waitlisted registration if a confirmed (or pending_payment) slot was freed
  if (reg.status === "confirmed" || reg.status === "pending_payment") {
    const [next] = await db
      .select()
      .from(registrationsTable)
      .where(and(
        eq(registrationsTable.programType, reg.programType),
        eq(registrationsTable.programId, reg.programId),
        eq(registrationsTable.status, "waitlisted"),
      ))
      .orderBy(asc(registrationsTable.waitlistPosition), asc(registrationsTable.createdAt))
      .limit(1);

    if (next) {
      await db
        .update(registrationsTable)
        .set({ status: "confirmed", waitlistPosition: null, updatedAt: new Date() } as any)
        .where(eq(registrationsTable.id, next.id));

      // Renumber remaining waitlisted registrations
      const remaining = await db
        .select()
        .from(registrationsTable)
        .where(and(
          eq(registrationsTable.programType, reg.programType),
          eq(registrationsTable.programId, reg.programId),
          eq(registrationsTable.status, "waitlisted"),
        ))
        .orderBy(asc(registrationsTable.waitlistPosition as any), asc(registrationsTable.createdAt));
      for (let i = 0; i < remaining.length; i++) {
        await db
          .update(registrationsTable)
          .set({ waitlistPosition: i + 1, updatedAt: new Date() } as any)
          .where(eq(registrationsTable.id, remaining[i].id));
      }

      // Notify the promoted player
      const [promotedUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, next.userId));
      if (promotedUser) {
        await sendNotificationWithPreferences({
          userId: promotedUser.id,
          type: "waitlist_movement",
          subject: `You're off the waitlist for ${next.programName}!`,
          body: `A spot opened up and you've been confirmed for ${next.programName}. Check your dashboard for details.`,
        } as any).catch(() => {});
      }
    }
  }

  res.sendStatus(204);
});

export default router;
