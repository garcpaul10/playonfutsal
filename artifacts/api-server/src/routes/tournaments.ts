import { Router, type IRouter } from "express";
import {
  db,
  tournamentsTable,
  tournamentRegistrationsTable,
  tournamentSeedsTable,
  tournamentDivisionsTable,
  fixturesTable,
  teamsTable,
  teamMembersTable,
  usersTable,
  checkInsTable,
  bracketsTable,
  isEventActive,
} from "@workspace/db";
import { ensureGameCard, ensureGameCardsForEntity } from "../services/gameCardService";
import { runAIPlacement } from "../services/teamPlacement";
import { eq, and, asc, desc, inArray, sql } from "drizzle-orm";
import {
  ListTournamentsQueryParams,
  ListTournamentsResponse,
  GetTournamentParams,
  GetTournamentResponse,
  CreateTournamentBody,
  UpdateTournamentParams,
  UpdateTournamentBody,
  UpdateTournamentResponse,
  DeleteTournamentParams,
} from "@workspace/api-zod";
import { requirePermission, requireAuth, hasPermission } from "../middlewares/auth";
import type { AuthedRequest } from "../middlewares/auth";
import { getAuth } from "@clerk/express";
import { nextPowerOf2, generateSingleElimBracket, generateDoubleElimBracket, generateGroupStageBracket } from "../lib/bracketGenerators";
import { getUncachableStripeClient } from "../lib/stripe";
import { sendNotificationWithPreferences } from "../services/notifications";

const router: IRouter = Router();

const normalizeAgeGroup = (raw: unknown): string[] => {
  if (Array.isArray(raw)) return (raw as string[]).filter((v) => typeof v === "string" && v.length > 0);
  if (typeof raw === "string" && raw.length > 0) return [raw];
  return ["adult"];
};

const parseTournament = (t: any) => ({
  ...t,
  teamPrice: Number(t.teamPrice),
  ageGroup: normalizeAgeGroup(t.ageGroup),
  prizePot: t.prizePot != null ? Number(t.prizePot) : null,
  depositAmount: t.depositAmount != null ? Number(t.depositAmount) : null,
});

const parseReg = (r: any) => ({
  ...r,
  depositAmount: Number(r.depositAmount),
  totalAmount: Number(r.totalAmount),
  amountPaid: Number(r.amountPaid),
});

// ─── Bracket generation functions are imported from ../lib/bracketGenerators ──

// ─── Basic CRUD ───────────────────────────────────────────────────────────────

router.get("/tournaments", async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req as any);
  const isAdmin = clerkId ? await hasPermission(clerkId, "canManageTournaments") : false;
  const query = ListTournamentsQueryParams.safeParse(req.query);
  let tournaments = await db.select().from(tournamentsTable).orderBy(asc(tournamentsTable.startDate));
  if (query.success) {
    if (query.data.ageGroup) tournaments = tournaments.filter((t) => normalizeAgeGroup(t.ageGroup).includes(query.data.ageGroup!));
    if (query.data.status) tournaments = tournaments.filter((t) => t.status === query.data.status);
  }
  if (!isAdmin) tournaments = tournaments.filter((t) => isEventActive(t));
  res.json(ListTournamentsResponse.parse(tournaments.map(parseTournament)));
});

router.post("/tournaments", requirePermission("canManageTournaments"), async (req, res): Promise<void> => {
  const parsed = CreateTournamentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [tournament] = await db.insert(tournamentsTable).values(parsed.data as any).returning();
  res.status(201).json(GetTournamentResponse.parse(parseTournament(tournament)));
});

router.get("/tournaments/:id", async (req, res): Promise<void> => {
  const params = GetTournamentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [tournament] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, params.data.id));
  if (!tournament) {
    res.status(404).json({ error: "Tournament not found" });
    return;
  }
  res.json(GetTournamentResponse.parse(parseTournament(tournament)));
});

router.patch("/tournaments/:id", requirePermission("canManageTournaments"), async (req, res): Promise<void> => {
  const params = UpdateTournamentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateTournamentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [tournament] = await db
    .update(tournamentsTable)
    .set({ ...parsed.data, updatedAt: new Date() } as any)
    .where(eq(tournamentsTable.id, params.data.id))
    .returning();
  if (!tournament) {
    res.status(404).json({ error: "Tournament not found" });
    return;
  }
  res.json(UpdateTournamentResponse.parse(parseTournament(tournament)));
});

router.delete("/tournaments/:id", requirePermission("canManageTournaments"), async (req, res): Promise<void> => {
  const params = DeleteTournamentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db.delete(tournamentsTable).where(eq(tournamentsTable.id, params.data.id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Tournament not found" });
    return;
  }
  res.sendStatus(204);
});

router.patch("/tournaments/:id/override", requirePermission("canManageTournaments"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { activeOverride } = req.body;
  if (activeOverride !== null && activeOverride !== "active" && activeOverride !== "closed") {
    res.status(400).json({ error: "activeOverride must be 'active', 'closed', or null" }); return;
  }
  const [tournament] = await db.update(tournamentsTable).set({ activeOverride: activeOverride ?? null, updatedAt: new Date() } as Partial<typeof tournamentsTable.$inferInsert>).where(eq(tournamentsTable.id, id)).returning();
  if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }
  res.json(parseTournament(tournament));
});

// ─── Registrations ────────────────────────────────────────────────────────────

router.get("/tournaments/:id/registrations", requireAuth, async (req, res): Promise<void> => {
  const tournamentId = Number(req.params.id);
  if (!tournamentId) { res.status(400).json({ error: "Invalid id" }); return; }

  const [tournament] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, tournamentId));
  if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }

  const clerkUserId = (req as AuthedRequest).clerkUserId;
  const isAdmin = await hasPermission(clerkUserId, "canManageTournaments");

  let regs = await db.select().from(tournamentRegistrationsTable)
    .where(eq(tournamentRegistrationsTable.tournamentId, tournamentId))
    .orderBy(asc(tournamentRegistrationsTable.createdAt));

  // Non-admins only see their own team's registration(s)
  if (!isAdmin) {
    const memberships = await db.select().from(teamMembersTable)
      .where(eq(teamMembersTable.userId, clerkUserId));
    const myTeamIds = new Set(memberships.map((m) => m.teamId));
    regs = regs.filter((r) => r.teamId != null && myTeamIds.has(r.teamId));
  }

  const teamIds = regs.map((r) => r.teamId).filter(Boolean) as number[];
  const teams = teamIds.length
    ? await db.select().from(teamsTable).where(inArray(teamsTable.id, teamIds))
    : [];
  const teamMap = Object.fromEntries(teams.map((t) => [t.id, t]));

  res.json(regs.map((r) => ({ ...parseReg(r), team: r.teamId ? teamMap[r.teamId] : null })));
});

router.post("/tournaments/:id/registrations", requireAuth, async (req, res): Promise<void> => {
  const tournamentId = Number(req.params.id);
  if (!tournamentId) { res.status(400).json({ error: "Invalid id" }); return; }

  const [tournament] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, tournamentId));
  if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }
  if (!isEventActive(tournament)) { res.status(403).json({ error: "Event is not currently active" }); return; }
  if (!tournament.registrationOpen) { res.status(400).json({ error: "Registration is closed" }); return; }
  const isFull = tournament.teamsRegistered >= tournament.maxTeams;

  const clerkUserId = (req as AuthedRequest).clerkUserId;
  const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkUserId));
  if (!dbUser) { res.status(404).json({ error: "User not found" }); return; }

  const { teamId, paymentMethod, notes, divisionId: rawDivisionId } = req.body;
  if (!teamId) { res.status(400).json({ error: "teamId required" }); return; }

  // Resolve division: validate supplied divisionId or auto-assign the only division
  const divisions = await db.select().from(tournamentDivisionsTable)
    .where(eq(tournamentDivisionsTable.tournamentId, tournamentId))
    .orderBy(asc(tournamentDivisionsTable.id));
  let resolvedDivisionId: number | null = null;
  if (rawDivisionId != null) {
    const div = divisions.find((d) => d.id === Number(rawDivisionId));
    if (!div) { res.status(400).json({ error: "divisionId does not belong to this tournament" }); return; }
    resolvedDivisionId = div.id;
  } else if (divisions.length === 1) {
    resolvedDivisionId = divisions[0].id;
  } else if (divisions.length > 1) {
    res.status(400).json({ error: "This tournament has multiple divisions — please supply a divisionId" }); return;
  }

  // Verify user is an active member of the team they want to register (or is admin)
  const isAdmin = await hasPermission(clerkUserId, "canManageTournaments");
  if (!isAdmin) {
    const [teamMembership] = await db.select().from(teamMembersTable)
      .where(and(
        eq(teamMembersTable.teamId, teamId),
        eq(teamMembersTable.userId, clerkUserId),
        eq(teamMembersTable.status, "active"),
      ));
    if (!teamMembership) {
      res.status(403).json({ error: "You must be an active member of this team to register it" });
      return;
    }
  }

  const existing = await db.select().from(tournamentRegistrationsTable)
    .where(and(
      eq(tournamentRegistrationsTable.tournamentId, tournamentId),
      eq(tournamentRegistrationsTable.teamId, teamId),
      sql`${tournamentRegistrationsTable.status} != 'cancelled'`,
    ));
  if (existing.length > 0) { res.status(409).json({ error: "already_registered", message: "This team is already registered for this tournament" }); return; }

  const totalAmount = Number(tournament.teamPrice);
  const depositAmount = tournament.depositAmount != null
    ? Number(tournament.depositAmount)
    : totalAmount;

  // Compute waitlist position if tournament is full
  let waitlistPosition: number | null = null;
  if (isFull) {
    const [{ wlCount }] = await db.select({ wlCount: sql<number>`count(*)::int` })
      .from(tournamentRegistrationsTable)
      .where(and(eq(tournamentRegistrationsTable.tournamentId, tournamentId), eq(tournamentRegistrationsTable.status, "waitlisted")));
    waitlistPosition = (wlCount ?? 0) + 1;
  }

  let reg: any;
  try {
    [reg] = await db.insert(tournamentRegistrationsTable).values({
      tournamentId,
      teamId,
      divisionId: resolvedDivisionId,
      registeredByUserId: dbUser.id,
      depositAmount: String(depositAmount),
      totalAmount: String(totalAmount),
      amountPaid: "0",
      paymentStatus: "unpaid",
      paymentMethod: paymentMethod || null,
      balanceDueDate: tournament.balanceDueDate,
      waitlistPosition: waitlistPosition ?? undefined,
      notes: isFull
        ? `Waitlisted — tournament at capacity (${tournament.teamsRegistered}/${tournament.maxTeams}). ${notes || ""}`.trim()
        : (notes || null),
      status: isFull ? "waitlisted" : "active",
    } as typeof tournamentRegistrationsTable.$inferInsert).returning();
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "already_registered", message: "This team is already registered for this tournament" });
      return;
    }
    throw err;
  }

  if (!isFull) {
    await db.update(tournamentsTable)
      .set({ teamsRegistered: tournament.teamsRegistered + 1, updatedAt: new Date() })
      .where(eq(tournamentsTable.id, tournamentId));
  }

  const [registeredTeam] = await db.select({ name: teamsTable.name }).from(teamsTable).where(eq(teamsTable.id, teamId));
  const placement = await runAIPlacement({
    teamId,
    teamName: registeredTeam?.name ?? String(teamId),
    offeringId: tournamentId,
    offeringName: tournament.name,
    offeringType: "tournament",
    currentCount: tournament.teamsRegistered,
    maxTeams: tournament.maxTeams,
    ageGroup: Array.isArray(tournament.ageGroup) ? (tournament.ageGroup as string[]).join(",") : (tournament.ageGroup ?? null),
    format: tournament.bracketFormat ?? null,
  });

  res.status(201).json({ ...parseReg(reg), waitlisted: isFull, placement });
});

/** POST /tournaments/:id/deposit-checkout
 *  Creates a Stripe checkout session for the tournament deposit.
 *  Must be called after the registration is created (provides registrationId).
 *  On payment success, stripeWebhook.ts reconcileDepositOrBalance marks depositPaid.
 */
router.post("/tournaments/:id/deposit-checkout", requireAuth, async (req, res): Promise<void> => {
  const tournamentId = Number(req.params.id);
  if (!tournamentId) { res.status(400).json({ error: "Invalid tournament id" }); return; }

  const { registrationId } = req.body;
  if (!registrationId) { res.status(400).json({ error: "registrationId is required" }); return; }

  const clerkUserId = (req as AuthedRequest).clerkUserId;
  const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkUserId));
  if (!dbUser) { res.status(401).json({ error: "User not found" }); return; }

  const [tournament] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, tournamentId));
  if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }

  const [reg] = await db.select().from(tournamentRegistrationsTable).where(
    and(
      eq(tournamentRegistrationsTable.id, Number(registrationId)),
      eq(tournamentRegistrationsTable.tournamentId, tournamentId),
      eq(tournamentRegistrationsTable.registeredByUserId, dbUser.id),
    )
  );
  if (!reg) { res.status(404).json({ error: "Registration not found or not yours" }); return; }
  if (reg.depositPaid) { res.status(409).json({ error: "Deposit already paid" }); return; }

  const depositAmount = Number(reg.depositAmount ?? tournament.depositAmount ?? 0);
  if (depositAmount <= 0) { res.status(400).json({ error: "No deposit required for this tournament" }); return; }

  const stripe = await getUncachableStripeClient();
  const { getStripePublishableKey } = await import("../lib/stripe");

  const sharedMeta = {
    clerkUserId,
    programType: "tournament",
    programId: String(tournamentId),
    depositFor: "tournament_registration",
    depositRegistrationId: String(reg.id),
    depositType: "deposit",
    basePrice: String(depositAmount),
    serviceFeeAmount: "0",
    category: "tournament",
  };

  const tournOrigin = (req.headers.origin ?? req.headers.referer ?? "https://playonfutsal.vercel.app").replace(/\/$/, "");
  const session = await (stripe.checkout.sessions.create as any)({
    mode: "payment",
    ui_mode: "custom",
    return_url: `${tournOrigin}/checkout/complete?session_id={CHECKOUT_SESSION_ID}`,
    line_items: [{
      price_data: {
        currency: "usd",
        product_data: { name: `${tournament.name} — deposit` },
        unit_amount: Math.round(depositAmount * 100),
      },
      quantity: 1,
    }],
    metadata: sharedMeta,
    customer_email: dbUser.email ?? undefined,
    payment_intent_data: {
      receipt_email: dbUser.email ?? undefined,
      metadata: sharedMeta,
    },
  });

  const clientSecret = session.client_secret as string;
  if (!clientSecret) throw new Error("Checkout session did not return a client secret");

  res.json({
    clientSecret,
    publishableKey: await getStripePublishableKey(),
    checkoutSessionId: session.id,
    amount: depositAmount,
  });
});

router.patch("/tournaments/:id/registrations/:regId", requirePermission("canManageTournaments"), async (req, res): Promise<void> => {
  const tournamentId = Number(req.params.id);
  const regId = Number(req.params.regId);
  if (!tournamentId || !regId) { res.status(400).json({ error: "Invalid id" }); return; }

  const { paymentStatus, paymentMethod, amountPaid, depositPaid, depositPaidAt, balanceOverriddenByAdmin, waiverSigned, status, notes } = req.body;

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (paymentStatus !== undefined) updates.paymentStatus = paymentStatus;
  if (paymentMethod !== undefined) updates.paymentMethod = paymentMethod;
  if (amountPaid !== undefined) updates.amountPaid = String(amountPaid);
  if (depositPaid !== undefined) {
    updates.depositPaid = depositPaid;
    if (depositPaid) updates.depositPaidAt = depositPaidAt || new Date();
  }
  if (balanceOverriddenByAdmin !== undefined) updates.balanceOverriddenByAdmin = balanceOverriddenByAdmin;
  if (waiverSigned !== undefined) {
    updates.waiverSigned = waiverSigned;
    if (waiverSigned) updates.waiverSignedAt = new Date();
  }
  if (status !== undefined) updates.status = status;
  if (notes !== undefined) updates.notes = notes;

  const [updated] = await db.update(tournamentRegistrationsTable)
    .set(updates)
    .where(and(
      eq(tournamentRegistrationsTable.id, regId),
      eq(tournamentRegistrationsTable.tournamentId, tournamentId),
    ))
    .returning();

  if (!updated) { res.status(404).json({ error: "Registration not found" }); return; }

  res.json(parseReg(updated));
});

router.delete("/tournaments/:id/registrations/:regId", requirePermission("canManageTournaments"), async (req, res): Promise<void> => {
  const tournamentId = Number(req.params.id);
  const regId = Number(req.params.regId);

  const [reg] = await db.select().from(tournamentRegistrationsTable)
    .where(and(eq(tournamentRegistrationsTable.id, regId), eq(tournamentRegistrationsTable.tournamentId, tournamentId)));
  if (!reg) { res.status(404).json({ error: "Registration not found" }); return; }

  await db.delete(tournamentRegistrationsTable)
    .where(eq(tournamentRegistrationsTable.id, regId));

  const [tournament] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, tournamentId));

  // Only mutate teamsRegistered when removing a counted (active) slot
  const wasActive = reg.status === "active";
  if (wasActive && tournament && tournament.teamsRegistered > 0) {
    await db.update(tournamentsTable)
      .set({ teamsRegistered: tournament.teamsRegistered - 1, updatedAt: new Date() })
      .where(eq(tournamentsTable.id, tournamentId));
  }

  // FIFO auto-promotion: only if the removed registration was an active (counted) slot
  if (wasActive && tournament) {
    const [waitlisted] = await db.select().from(tournamentRegistrationsTable)
      .where(and(
        eq(tournamentRegistrationsTable.tournamentId, tournamentId),
        eq(tournamentRegistrationsTable.status, "waitlisted" as string),
      ))
      .orderBy(asc(tournamentRegistrationsTable.waitlistPosition), asc(tournamentRegistrationsTable.createdAt))
      .limit(1);
    if (waitlisted) {
      await db.update(tournamentRegistrationsTable)
        .set({ status: "active", waitlistPosition: null, updatedAt: new Date() } as Partial<typeof tournamentRegistrationsTable.$inferInsert>)
        .where(eq(tournamentRegistrationsTable.id, waitlisted.id));
      // Net change: -1 (deleted active) +1 (promoted) = 0 → count stays the same
      // But we already decremented above; increment back now
      await db.update(tournamentsTable)
        .set({ teamsRegistered: tournament.teamsRegistered, updatedAt: new Date() })
        .where(eq(tournamentsTable.id, tournamentId));

      // Renumber remaining waitlisted regs
      const remaining = await db.select().from(tournamentRegistrationsTable)
        .where(and(eq(tournamentRegistrationsTable.tournamentId, tournamentId), eq(tournamentRegistrationsTable.status, "waitlisted" as string)))
        .orderBy(asc(tournamentRegistrationsTable.waitlistPosition), asc(tournamentRegistrationsTable.createdAt));
      for (let i = 0; i < remaining.length; i++) {
        await db.update(tournamentRegistrationsTable)
          .set({ waitlistPosition: i + 1, updatedAt: new Date() } as Partial<typeof tournamentRegistrationsTable.$inferInsert>)
          .where(eq(tournamentRegistrationsTable.id, remaining[i].id));
      }

      // Notify promoted team captain
      if (waitlisted.teamId) {
        const [promotedTeam] = await db.select().from(teamsTable).where(eq(teamsTable.id, waitlisted.teamId));
        if (promotedTeam?.captainUserId) {
          const [captainUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, promotedTeam.captainUserId));
          if (captainUser) {
            await sendNotificationWithPreferences({
              userId: captainUser.id,
              type: "waitlist_movement",
              subject: `Your team is off the waitlist for ${tournament.name}!`,
              body: `Great news! Your team "${promotedTeam.name}" has moved off the waitlist and is now registered for ${tournament.name}.`,
            } as Partial<typeof tournamentRegistrationsTable.$inferInsert>);
          }
        }
      }
    }
  }

  res.sendStatus(204);
});

// Admin: list waitlisted registrations for a tournament
router.get("/tournaments/:id/waitlist", requirePermission("canManageTournaments"), async (req, res): Promise<void> => {
  const tournamentId = Number(req.params.id);
  const regs = await db.select().from(tournamentRegistrationsTable)
    .where(and(eq(tournamentRegistrationsTable.tournamentId, tournamentId), eq(tournamentRegistrationsTable.status, "waitlisted" as string)))
    .orderBy(asc(tournamentRegistrationsTable.waitlistPosition), asc(tournamentRegistrationsTable.createdAt));
  const enriched = await Promise.all(regs.map(async (r) => {
    const [team] = r.teamId ? await db.select().from(teamsTable).where(eq(teamsTable.id, r.teamId)) : [null];
    return { ...r, team: team ?? null };
  }));
  res.json(enriched);
});

// Admin: manually promote a specific waitlisted tournament registration
router.post("/tournaments/:id/waitlist/:regId/promote", requirePermission("canManageTournaments"), async (req, res): Promise<void> => {
  const tournamentId = Number(req.params.id);
  const regId = Number(req.params.regId);

  const [reg] = await db.select().from(tournamentRegistrationsTable)
    .where(and(eq(tournamentRegistrationsTable.id, regId), eq(tournamentRegistrationsTable.tournamentId, tournamentId), eq(tournamentRegistrationsTable.status, "waitlisted" as string)));
  if (!reg) { res.status(404).json({ error: "Waitlisted registration not found" }); return; }

  const [tournament] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, tournamentId));

  await db.update(tournamentRegistrationsTable)
    .set({ status: "active", waitlistPosition: null, updatedAt: new Date() } as Partial<typeof tournamentRegistrationsTable.$inferInsert>)
    .where(eq(tournamentRegistrationsTable.id, regId));
  await db.update(tournamentsTable)
    .set({ teamsRegistered: (tournament?.teamsRegistered ?? 0) + 1, updatedAt: new Date() })
    .where(eq(tournamentsTable.id, tournamentId));

  // Renumber remaining waitlisted regs
  const remaining = await db.select().from(tournamentRegistrationsTable)
    .where(and(eq(tournamentRegistrationsTable.tournamentId, tournamentId), eq(tournamentRegistrationsTable.status, "waitlisted" as string)))
    .orderBy(asc(tournamentRegistrationsTable.waitlistPosition), asc(tournamentRegistrationsTable.createdAt));
  for (let i = 0; i < remaining.length; i++) {
    await db.update(tournamentRegistrationsTable)
      .set({ waitlistPosition: i + 1, updatedAt: new Date() } as Partial<typeof tournamentRegistrationsTable.$inferInsert>)
      .where(eq(tournamentRegistrationsTable.id, remaining[i].id));
  }

  // Notify promoted team captain
  if (reg.teamId) {
    const [promotedTeam] = await db.select().from(teamsTable).where(eq(teamsTable.id, reg.teamId));
    if (promotedTeam?.captainUserId) {
      const [captainUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, promotedTeam.captainUserId));
      if (captainUser) {
        await sendNotificationWithPreferences({
          userId: captainUser.id,
          type: "waitlist_movement",
          subject: `Your team is off the waitlist for ${tournament?.name ?? "the tournament"}!`,
          body: `Great news! Your team "${promotedTeam.name}" has moved off the waitlist and is now registered for ${tournament?.name ?? "the tournament"}.`,
        } as Partial<typeof tournamentRegistrationsTable.$inferInsert>);
      }
    }
  }

  const [updated] = await db.select().from(tournamentRegistrationsTable).where(eq(tournamentRegistrationsTable.id, regId));
  res.json(updated);
});

// ─── Overdue balance list ─────────────────────────────────────────────────────

router.get("/tournaments/:id/registrations/overdue", requirePermission("canManageTournaments"), async (req, res): Promise<void> => {
  const tournamentId = Number(req.params.id);
  const now = new Date();
  const regs = await db.select().from(tournamentRegistrationsTable)
    .where(and(
      eq(tournamentRegistrationsTable.tournamentId, tournamentId),
      eq(tournamentRegistrationsTable.status, "active"),
    ));

  const overdue = regs.filter((r) => {
    if (r.paymentStatus === "paid") return false;
    if (r.balanceOverriddenByAdmin) return false;
    if (!r.balanceDueDate) return false;
    return new Date(r.balanceDueDate) < now;
  });
  res.json(overdue.map(parseReg));
});

// ─── Seeding ──────────────────────────────────────────────────────────────────

router.get("/tournaments/:id/seeds", async (req, res): Promise<void> => {
  const tournamentId = Number(req.params.id);
  const divisionId = req.query.divisionId ? Number(req.query.divisionId) : null;

  const whereClause = divisionId
    ? and(eq(tournamentSeedsTable.tournamentId, tournamentId), eq(tournamentSeedsTable.divisionId as any, divisionId))
    : eq(tournamentSeedsTable.tournamentId, tournamentId);

  const seeds = await db.select().from(tournamentSeedsTable)
    .where(whereClause)
    .orderBy(asc(tournamentSeedsTable.seed));

  const teamIds = seeds.map((s) => s.teamId);
  const teams = teamIds.length
    ? await db.select().from(teamsTable).where(inArray(teamsTable.id, teamIds))
    : [];
  const teamMap = Object.fromEntries(teams.map((t) => [t.id, t]));

  res.json(seeds.map((s) => ({ ...s, team: teamMap[s.teamId] || null })));
});

router.post("/tournaments/:id/seeds", requirePermission("canManageTournaments"), async (req, res): Promise<void> => {
  const tournamentId = Number(req.params.id);
  const { seeds, divisionId } = req.body as { seeds: { teamId: number; seed: number; groupName?: string }[]; divisionId?: number };

  if (!Array.isArray(seeds)) { res.status(400).json({ error: "seeds array required" }); return; }

  // Validate divisionId belongs to this tournament
  if (divisionId != null) {
    const [div] = await db.select().from(tournamentDivisionsTable)
      .where(and(eq(tournamentDivisionsTable.id, divisionId), eq(tournamentDivisionsTable.tournamentId, tournamentId)));
    if (!div) { res.status(400).json({ error: "divisionId does not belong to this tournament" }); return; }
  }

  // Delete existing seeds for the given division (or all if no divisionId)
  if (divisionId) {
    await db.delete(tournamentSeedsTable).where(
      and(eq(tournamentSeedsTable.tournamentId, tournamentId), eq(tournamentSeedsTable.divisionId as any, divisionId))
    );
  } else {
    await db.delete(tournamentSeedsTable).where(eq(tournamentSeedsTable.tournamentId, tournamentId));
  }

  if (seeds.length > 0) {
    await db.insert(tournamentSeedsTable).values(
      seeds.map((s) => ({
        tournamentId,
        teamId: s.teamId,
        seed: s.seed,
        groupName: s.groupName || null,
        divisionId: divisionId || null,
      } as typeof tournamentSeedsTable.$inferInsert)),
    );
  }

  const whereClause = divisionId
    ? and(eq(tournamentSeedsTable.tournamentId, tournamentId), eq(tournamentSeedsTable.divisionId as any, divisionId))
    : eq(tournamentSeedsTable.tournamentId, tournamentId);

  const updated = await db.select().from(tournamentSeedsTable)
    .where(whereClause)
    .orderBy(asc(tournamentSeedsTable.seed));
  res.json(updated);
});

// ─── Bracket generation ───────────────────────────────────────────────────────

router.post("/tournaments/:id/brackets/generate", requirePermission("canManageTournaments"), async (req, res): Promise<void> => {
  const tournamentId = Number(req.params.id);
  if (!tournamentId) { res.status(400).json({ error: "Invalid id" }); return; }

  const [tournament] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, tournamentId));
  if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }

  const divisionId: number | null = req.body?.divisionId ? Number(req.body.divisionId) : null;

  // If divisionId provided, validate it belongs to this tournament and get its overrides
  let division: any = null;
  if (divisionId) {
    [division] = await db.select().from(tournamentDivisionsTable)
      .where(and(eq(tournamentDivisionsTable.id, divisionId), eq(tournamentDivisionsTable.tournamentId, tournamentId)));
    if (!division) { res.status(404).json({ error: "Division not found for this tournament" }); return; }
  }

  // Use division overrides when available, fall back to tournament defaults
  const effectiveBracketFormat = (division?.bracketFormat ?? null) || tournament.bracketFormat;
  const effectiveHasGroupStage = division?.hasGroupStage ?? tournament.hasGroupStage;

  const seedsWhereClause = divisionId
    ? and(eq(tournamentSeedsTable.tournamentId, tournamentId), eq(tournamentSeedsTable.divisionId as any, divisionId))
    : eq(tournamentSeedsTable.tournamentId, tournamentId);

  const seeds = await db.select().from(tournamentSeedsTable)
    .where(seedsWhereClause)
    .orderBy(asc(tournamentSeedsTable.seed));

  if (seeds.length < 2) {
    res.status(400).json({ error: "Need at least 2 seeded teams to generate bracket" });
    return;
  }

  // Delete existing tournament fixtures (scoped to division if provided)
  const fixtureWhereClause = divisionId
    ? and(eq(fixturesTable.entityType, "tournament"), eq(fixturesTable.entityId, tournamentId), eq(fixturesTable.divisionId as any, divisionId))
    : and(eq(fixturesTable.entityType, "tournament"), eq(fixturesTable.entityId, tournamentId));
  await db.delete(fixturesTable).where(fixtureWhereClause);

  let fixtures: any[];

  if (effectiveHasGroupStage) {
    const groupCount = Math.ceil(seeds.length / 4);
    const groups: { name: string; teamIds: number[] }[] = [];
    const letters = "ABCDEFGH";
    for (let g = 0; g < groupCount; g++) {
      const groupSeeds = seeds.filter((_, i) => i % groupCount === g);
      groups.push({ name: letters[g], teamIds: groupSeeds.map((s) => s.teamId) });
    }
    fixtures = generateGroupStageBracket(tournamentId, groups, divisionId);

    const playoffTeams = tournament.playoffTeams || groupCount * 2;
    const n = nextPowerOf2(playoffTeams);
    const rounds = Math.log2(n);
    for (let round = 1; round <= rounds; round++) {
      const count = n / Math.pow(2, round);
      for (let i = 0; i < count; i++) {
        fixtures.push({
          entityType: "tournament",
          entityId: tournamentId,
          homeTeamId: null,
          awayTeamId: null,
          status: "pending",
          round,
          phase: "playoff",
          durationMinutes: 60,
          ...(divisionId ? { divisionId } : {}),
        });
      }
    }
    if (tournament.consolationEnabled && rounds >= 2) {
      fixtures.push({
        entityType: "tournament",
        entityId: tournamentId,
        homeTeamId: null,
        awayTeamId: null,
        status: "pending",
        round: rounds,
        phase: "consolation",
        durationMinutes: 60,
        notes: "3rd Place Match",
        ...(divisionId ? { divisionId } : {}),
      });
    }
  } else if (effectiveBracketFormat === "double_elimination") {
    fixtures = generateDoubleElimBracket(
      tournamentId,
      seeds.map((s) => ({ teamId: s.teamId, seed: s.seed })),
      divisionId,
    );
  } else {
    fixtures = generateSingleElimBracket(
      tournamentId,
      seeds.map((s) => ({ teamId: s.teamId, seed: s.seed })),
      tournament.consolationEnabled,
      divisionId,
    );
  }

  const inserted = await db.insert(fixturesTable).values(fixtures).returning();

  // Auto-advance byes (division-scoped so byes in one division don't touch another's bracket)
  const byeFixtures = inserted.filter((f: any) => f.status === "bye");
  for (const byeFix of byeFixtures) {
    const advancingTeam = byeFix.homeTeamId ?? byeFix.awayTeamId;
    if (advancingTeam == null) continue;
    if (byeFix.phase === "playoff") {
      await advanceSingleElimPhase(byeFix.id, tournamentId, byeFix.round ?? 1, "playoff", advancingTeam, divisionId);
    } else if (byeFix.phase === "winners") {
      await advanceSingleElimPhase(byeFix.id, tournamentId, byeFix.round ?? 1, "winners", advancingTeam, divisionId);
    }
  }

  // Create/update bracket record (scoped to division if provided)
  if (divisionId) {
    await db.delete(bracketsTable).where(
      and(eq(bracketsTable.tournamentId, tournamentId), eq(bracketsTable.divisionId as any, divisionId))
    );
  } else {
    await db.delete(bracketsTable).where(eq(bracketsTable.tournamentId, tournamentId));
  }
  const slots = nextPowerOf2(seeds.length);
  const totalRounds = Math.log2(slots);
  await db.insert(bracketsTable).values({
    tournamentId,
    name: division ? `${tournament.name} — ${division.name}` : tournament.name,
    bracketType: effectiveBracketFormat,
    totalTeams: seeds.length,
    totalRounds,
    status: "draft",
    isLocked: false,
    ...(divisionId ? { divisionId } : {}),
  } as typeof bracketsTable.$inferInsert);

  await ensureGameCardsForEntity("tournament", tournamentId).catch((err) => { console.error("[game-card] failed to generate cards for tournament", tournamentId, err?.message); });
  res.status(201).json({ fixtures: inserted });
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

router.get("/tournaments/:id/fixtures", async (req, res): Promise<void> => {
  const tournamentId = Number(req.params.id);
  const divisionId = req.query.divisionId ? Number(req.query.divisionId) : null;

  const whereClause = divisionId
    ? and(eq(fixturesTable.entityType, "tournament"), eq(fixturesTable.entityId, tournamentId), eq(fixturesTable.divisionId as any, divisionId))
    : and(eq(fixturesTable.entityType, "tournament"), eq(fixturesTable.entityId, tournamentId));

  const fixtures = await db.select().from(fixturesTable)
    .where(whereClause)
    .orderBy(asc(fixturesTable.round), asc(fixturesTable.id));

  const teamIds = [
    ...fixtures.map((f) => f.homeTeamId),
    ...fixtures.map((f) => f.awayTeamId),
  ].filter(Boolean) as number[];
  const teams = teamIds.length
    ? await db.select().from(teamsTable).where(inArray(teamsTable.id, teamIds))
    : [];
  const teamMap = Object.fromEntries(teams.map((t) => [t.id, t]));

  res.json(fixtures.map((f) => ({
    ...f,
    homeTeam: f.homeTeamId ? teamMap[f.homeTeamId] || null : null,
    awayTeam: f.awayTeamId ? teamMap[f.awayTeamId] || null : null,
  })));
});

router.patch("/tournaments/:id/fixtures/:fid", requirePermission("canManageTournaments"), async (req, res): Promise<void> => {
  const tournamentId = Number(req.params.id);
  const fixtureId = Number(req.params.fid);

  const [fixture] = await db.select().from(fixturesTable)
    .where(and(eq(fixturesTable.id, fixtureId), eq(fixturesTable.entityType, "tournament"), eq(fixturesTable.entityId, tournamentId)));
  if (!fixture) { res.status(404).json({ error: "Fixture not found" }); return; }

  const { scheduledAt, courtId, homeTeamId, awayTeamId, refereeUserId, notes, durationMinutes } = req.body;
  const updates: Record<string, any> = { updatedAt: new Date() };
  if (scheduledAt !== undefined) updates.scheduledAt = scheduledAt ? new Date(scheduledAt) : null;
  if (courtId !== undefined) updates.courtId = courtId;
  if (homeTeamId !== undefined) updates.homeTeamId = homeTeamId;
  if (awayTeamId !== undefined) updates.awayTeamId = awayTeamId;
  if (refereeUserId !== undefined) updates.refereeUserId = refereeUserId;
  if (notes !== undefined) updates.notes = notes;
  if (durationMinutes !== undefined) updates.durationMinutes = durationMinutes;

  const [updated] = await db.update(fixturesTable).set(updates).where(eq(fixturesTable.id, fixtureId)).returning();
  ensureGameCard(fixtureId).catch((err) => { console.error("[game-card] failed to update card for fixture", fixtureId, err?.message); });
  res.json(updated);
});

// ─── Format-aware progression engine ─────────────────────────────────────────

/**
 * Fill one slot of a target fixture and compute new status.
 * Checks the OTHER slot to decide if "scheduled" after this update.
 */
async function fillBracketSlot(
  targetFixtureId: number,
  isHome: boolean,
  teamId: number | null,
) {
  const [current] = await db.select().from(fixturesTable).where(eq(fixturesTable.id, targetFixtureId));
  if (!current) return;
  const otherFilled = isHome ? current.awayTeamId != null : current.homeTeamId != null;
  const bothFilled = otherFilled && teamId != null;
  await db.update(fixturesTable)
    .set({
      ...(isHome ? { homeTeamId: teamId } : { awayTeamId: teamId }),
      status: bothFilled ? "scheduled" : "pending",
      updatedAt: new Date(),
    })
    .where(eq(fixturesTable.id, targetFixtureId));
  if (bothFilled) {
    ensureGameCard(targetFixtureId).catch((err) => { console.error("[game-card] failed to update card for fixture", targetFixtureId, err?.message); });
  }
}

/**
 * Advance winner through a single-elimination–style phase (playoff / winners).
 * Returns { slotIndex, isLastRound } so callers can act on the loser (consolation / double-elim LB drop).
 */
async function advanceSingleElimPhase(
  fixtureId: number,
  tournamentId: number,
  fixtureRound: number,
  phase: string,
  winnerId: number | null,
  divisionId?: number | null,
): Promise<{ slotIndex: number; isLastRound: boolean }> {
  const baseConditions = [
    eq(fixturesTable.entityType, "tournament"),
    eq(fixturesTable.entityId, tournamentId),
    eq(fixturesTable.phase, phase),
    ...(divisionId != null ? [eq(fixturesTable.divisionId, divisionId)] : []),
  ];
  const allPhase = await db.select().from(fixturesTable)
    .where(and(...baseConditions as [any, ...any[]]))
    .orderBy(asc(fixturesTable.round), asc(fixturesTable.id));

  const thisRound = allPhase.filter((f) => f.round === fixtureRound);
  const nextRound = allPhase.filter((f) => f.round === fixtureRound + 1);
  const slotIndex = thisRound.findIndex((f) => f.id === fixtureId);

  if (nextRound.length > 0) {
    const nextSlot = Math.floor(slotIndex / 2);
    if (nextSlot < nextRound.length) {
      const isHome = slotIndex % 2 === 0;
      await fillBracketSlot(nextRound[nextSlot].id, isHome, winnerId);
    }
    return { slotIndex, isLastRound: false };
  }
  return { slotIndex, isLastRound: true };
}

/**
 * Drop a double-elim loser from the WB into the correct LB round/slot.
 * WB round R → LB round (2R-1); slot assignment mirrors the WB slot index.
 */
async function dropToLosers(
  tournamentId: number,
  wbRound: number,
  wbSlotIndex: number,
  loserId: number | null,
  divisionId?: number | null,
) {
  const targetLBRound = 2 * wbRound - 1;
  const lbConditions = [
    eq(fixturesTable.entityType, "tournament"),
    eq(fixturesTable.entityId, tournamentId),
    eq(fixturesTable.phase, "losers"),
    eq(fixturesTable.round, targetLBRound),
    ...(divisionId != null ? [eq(fixturesTable.divisionId, divisionId)] : []),
  ];
  const lbFixtures = await db.select().from(fixturesTable)
    .where(and(...lbConditions as [any, ...any[]]))
    .orderBy(asc(fixturesTable.id));

  if (lbFixtures.length === 0) return;
  const targetSlot = Math.min(wbSlotIndex, lbFixtures.length - 1);
  const lbFix = lbFixtures[targetSlot];
  // Even WB slots fill home, odd fill away in the LB
  const isHome = wbSlotIndex % 2 === 0;
  await fillBracketSlot(lbFix.id, isHome, loserId);
}

// ─── Shared bracket progression (used by result handler + game card completion) ─

/**
 * Run tournament bracket advancement after a result is recorded.
 * Only executes when `wasAlreadyCompleted` is false (first-time result).
 */
export async function runTournamentBracketProgression(
  fixtureId: number,
  tournamentId: number,
  fixture: { phase: string | null; round: number | null; homeTeamId: number | null; awayTeamId: number | null; status: string | null; divisionId?: number | null },
  homeScore: number,
  awayScore: number,
): Promise<void> {
  const wasAlreadyCompleted = fixture.status === "completed" || fixture.status === "forfeited";
  if (wasAlreadyCompleted) return;

  const divId = fixture.divisionId ?? null;
  const winnerId = homeScore > awayScore ? fixture.homeTeamId : fixture.awayTeamId;
  const loserId = homeScore > awayScore ? fixture.awayTeamId : fixture.homeTeamId;

  // Build a helper to scope grand_final / consolation queries to the same division
  const divisionConditions = divId != null ? [eq(fixturesTable.divisionId, divId)] : [];

  if (fixture.phase === "playoff" && fixture.round != null) {
    const [tournament] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, tournamentId));
    const { slotIndex, isLastRound } = await advanceSingleElimPhase(fixtureId, tournamentId, fixture.round, "playoff", winnerId, divId);
    if (!isLastRound && tournament?.consolationEnabled && loserId) {
      const seedsWhere = divId != null
        ? and(eq(tournamentSeedsTable.tournamentId, tournamentId), eq(tournamentSeedsTable.divisionId, divId))
        : eq(tournamentSeedsTable.tournamentId, tournamentId);
      const seeds = await db.select().from(tournamentSeedsTable).where(seedsWhere);
      const totalRounds = Math.log2(nextPowerOf2(seeds.length));
      if (fixture.round === totalRounds - 1) {
        const [consolation] = await db.select().from(fixturesTable)
          .where(and(eq(fixturesTable.entityType, "tournament"), eq(fixturesTable.entityId, tournamentId), eq(fixturesTable.phase, "consolation"), ...divisionConditions));
        if (consolation) await fillBracketSlot(consolation.id, consolation.homeTeamId == null, loserId);
      }
    }
  }

  if (fixture.phase === "winners" && fixture.round != null) {
    const { slotIndex, isLastRound } = await advanceSingleElimPhase(fixtureId, tournamentId, fixture.round, "winners", winnerId, divId);
    if (loserId) await dropToLosers(tournamentId, fixture.round, slotIndex, loserId, divId);
    if (isLastRound && winnerId) {
      const [grandFinal] = await db.select().from(fixturesTable)
        .where(and(eq(fixturesTable.entityType, "tournament"), eq(fixturesTable.entityId, tournamentId), eq(fixturesTable.phase, "grand_final"), ...divisionConditions));
      if (grandFinal) await fillBracketSlot(grandFinal.id, true, winnerId);
    }
  }

  if (fixture.phase === "losers" && fixture.round != null) {
    const lbConditions = [
      eq(fixturesTable.entityType, "tournament"),
      eq(fixturesTable.entityId, tournamentId),
      eq(fixturesTable.phase, "losers"),
      ...divisionConditions,
    ];
    const allLB = await db.select().from(fixturesTable)
      .where(and(...lbConditions as [any, ...any[]]))
      .orderBy(asc(fixturesTable.round), asc(fixturesTable.id));
    const maxLBRound = Math.max(...allLB.map((f) => f.round ?? 0));
    if (fixture.round === maxLBRound) {
      if (winnerId) {
        const [grandFinal] = await db.select().from(fixturesTable)
          .where(and(eq(fixturesTable.entityType, "tournament"), eq(fixturesTable.entityId, tournamentId), eq(fixturesTable.phase, "grand_final"), ...divisionConditions));
        if (grandFinal) await fillBracketSlot(grandFinal.id, false, winnerId);
      }
    } else {
      await advanceSingleElimPhase(fixtureId, tournamentId, fixture.round, "losers", winnerId, divId);
    }
  }
}

// ─── Result entry + auto-advance ─────────────────────────────────────────────

router.post("/tournaments/:id/fixtures/:fid/result", requirePermission("canManageTournaments"), async (req, res): Promise<void> => {
  const tournamentId = Number(req.params.id);
  const fixtureId = Number(req.params.fid);

  const [fixture] = await db.select().from(fixturesTable)
    .where(and(eq(fixturesTable.id, fixtureId), eq(fixturesTable.entityType, "tournament"), eq(fixturesTable.entityId, tournamentId)));
  if (!fixture) { res.status(404).json({ error: "Fixture not found" }); return; }

  const { homeScore, awayScore } = req.body;
  if (homeScore == null || awayScore == null) { res.status(400).json({ error: "homeScore and awayScore required" }); return; }

  const knockoutPhases = ["playoff", "winners", "losers", "grand_final"];
  if (knockoutPhases.includes(fixture.phase ?? "") && Number(homeScore) === Number(awayScore)) {
    res.status(400).json({ error: "Ties are not allowed in elimination rounds. A winner must be declared." });
    return;
  }

  await db.update(fixturesTable)
    .set({ homeScore, awayScore, status: "completed", updatedAt: new Date() })
    .where(eq(fixturesTable.id, fixtureId));

  await runTournamentBracketProgression(fixtureId, tournamentId, fixture, Number(homeScore), Number(awayScore));

  const [updated] = await db.select().from(fixturesTable).where(eq(fixturesTable.id, fixtureId));
  res.json(updated);
});

router.post("/tournaments/:id/fixtures/:fid/forfeit", requirePermission("canManageTournaments"), async (req, res): Promise<void> => {
  const tournamentId = Number(req.params.id);
  const fixtureId = Number(req.params.fid);
  const { forfeitingTeamId } = req.body;

  const [fixture] = await db.select().from(fixturesTable)
    .where(and(eq(fixturesTable.id, fixtureId), eq(fixturesTable.entityType, "tournament"), eq(fixturesTable.entityId, tournamentId)));
  if (!fixture) { res.status(404).json({ error: "Fixture not found" }); return; }

  const homeScore = fixture.homeTeamId === forfeitingTeamId ? 0 : 3;
  const awayScore = fixture.awayTeamId === forfeitingTeamId ? 0 : 3;

  await db.update(fixturesTable)
    .set({ homeScore, awayScore, status: "forfeited", updatedAt: new Date(), notes: `Forfeit by team ${forfeitingTeamId}` })
    .where(eq(fixturesTable.id, fixtureId));

  const [updatedFixture] = await db.select().from(fixturesTable).where(eq(fixturesTable.id, fixtureId));

  // Advance bracket using the shared progression engine (division-scoped via fixture.divisionId)
  await runTournamentBracketProgression(fixtureId, tournamentId, fixture, homeScore, awayScore);

  res.json(updatedFixture);
});

// ─── Bracket info ─────────────────────────────────────────────────────────────

router.get("/tournaments/:id/brackets", async (req, res): Promise<void> => {
  const tournamentId = Number(req.params.id);
  const divisionId = req.query.divisionId ? Number(req.query.divisionId) : null;
  const whereClause = divisionId != null
    ? and(eq(bracketsTable.tournamentId, tournamentId), eq(bracketsTable.divisionId, divisionId))
    : eq(bracketsTable.tournamentId, tournamentId);
  const [bracket] = await db.select().from(bracketsTable).where(whereClause);
  res.json(bracket || null);
});

router.patch("/tournaments/:id/brackets/lock", requirePermission("canManageTournaments"), async (req, res): Promise<void> => {
  const tournamentId = Number(req.params.id);
  const { isLocked } = req.body;
  const [bracket] = await db.select().from(bracketsTable).where(eq(bracketsTable.tournamentId, tournamentId));
  if (!bracket) { res.status(404).json({ error: "Bracket not found" }); return; }
  const [updated] = await db.update(bracketsTable)
    .set({ isLocked: !!isLocked, updatedAt: new Date() })
    .where(eq(bracketsTable.id, bracket.id))
    .returning();
  res.json(updated);
});

// ─── Group standings + tiebreaker + advance to knockout ───────────────────────

type TeamStat = {
  teamId: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  points: number;
};

/**
 * Parse tiebreakerRules (comma-separated) and sort team stats.
 * Supported criteria: goal_difference, goals_for, goals_against (asc), wins, head_to_head.
 * head_to_head requires the raw fixtures to compute H2H results.
 */
function sortByTiebreakers(
  teams: TeamStat[],
  rules: string[],
  fixtures: any[],
): TeamStat[] {
  return [...teams].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    for (const rule of rules) {
      if (rule === "goal_difference") {
        const diff = (b.gf - b.ga) - (a.gf - a.ga);
        if (diff !== 0) return diff;
      } else if (rule === "goals_for") {
        if (b.gf !== a.gf) return b.gf - a.gf;
      } else if (rule === "goals_against") {
        if (a.ga !== b.ga) return a.ga - b.ga; // lower is better
      } else if (rule === "wins") {
        if (b.w !== a.w) return b.w - a.w;
      } else if (rule === "head_to_head") {
        const h2h = fixtures.find(
          (f) =>
            f.status === "completed" &&
            ((f.homeTeamId === a.teamId && f.awayTeamId === b.teamId) ||
              (f.homeTeamId === b.teamId && f.awayTeamId === a.teamId)),
        );
        if (h2h) {
          const aIsHome = h2h.homeTeamId === a.teamId;
          const aScore = aIsHome ? h2h.homeScore : h2h.awayScore;
          const bScore = aIsHome ? h2h.awayScore : h2h.homeScore;
          if (bScore !== aScore) return bScore - aScore;
        }
      }
    }
    return 0;
  });
}

function computeGroupStandings(
  groupFixtures: any[],
  tiebreakerRules?: string | null,
): Record<string, TeamStat[]> {
  const defaultRules = ["goal_difference", "goals_for", "wins"];
  const rules = tiebreakerRules
    ? tiebreakerRules.split(",").map((r) => r.trim()).filter(Boolean)
    : defaultRules;

  // Extract group name from fixture notes ("Group A" → "A")
  const getGroup = (f: any): string =>
    (f.notes?.replace(/^Group\s+/i, "") ?? "A").trim() || "A";

  const groupMap: Record<string, Record<number, TeamStat>> = {};

  for (const f of groupFixtures) {
    if (f.homeTeamId == null || f.awayTeamId == null) continue;
    const g = getGroup(f);
    if (!groupMap[g]) groupMap[g] = {};

    for (const teamId of [f.homeTeamId, f.awayTeamId]) {
      if (!groupMap[g][teamId]) {
        groupMap[g][teamId] = { teamId, w: 0, d: 0, l: 0, gf: 0, ga: 0, points: 0 };
      }
    }

    if (f.status !== "completed") continue;
    const hs = Number(f.homeScore ?? 0);
    const as_ = Number(f.awayScore ?? 0);
    groupMap[g][f.homeTeamId].gf += hs;
    groupMap[g][f.homeTeamId].ga += as_;
    groupMap[g][f.awayTeamId].gf += as_;
    groupMap[g][f.awayTeamId].ga += hs;

    if (hs > as_) {
      groupMap[g][f.homeTeamId].w++;
      groupMap[g][f.homeTeamId].points += 3;
      groupMap[g][f.awayTeamId].l++;
    } else if (hs < as_) {
      groupMap[g][f.awayTeamId].w++;
      groupMap[g][f.awayTeamId].points += 3;
      groupMap[g][f.homeTeamId].l++;
    } else {
      groupMap[g][f.homeTeamId].d++;
      groupMap[g][f.homeTeamId].points++;
      groupMap[g][f.awayTeamId].d++;
      groupMap[g][f.awayTeamId].points++;
    }
  }

  const sorted: Record<string, TeamStat[]> = {};
  for (const [groupName, teamMap] of Object.entries(groupMap)) {
    const groupFixs = groupFixtures.filter((f) => getGroup(f) === groupName);
    sorted[groupName] = sortByTiebreakers(Object.values(teamMap), rules, groupFixs);
  }
  return sorted;
}

router.get("/tournaments/:id/groups/standings", async (req, res): Promise<void> => {
  const tournamentId = Number(req.params.id);
  if (!tournamentId) { res.status(400).json({ error: "Invalid id" }); return; }

  const [tournament] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, tournamentId));
  if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }

  const groupFixtures = await db.select().from(fixturesTable)
    .where(and(
      eq(fixturesTable.entityType, "tournament"),
      eq(fixturesTable.entityId, tournamentId),
      eq(fixturesTable.phase, "group"),
    ))
    .orderBy(asc(fixturesTable.round), asc(fixturesTable.id));

  const standings = computeGroupStandings(groupFixtures, tournament.tiebreakerRules);

  // Enrich with team names
  const allTeamIds = Object.values(standings).flatMap((ts) => ts.map((t) => t.teamId));
  const teams = allTeamIds.length
    ? await db.select().from(teamsTable).where(inArray(teamsTable.id, allTeamIds))
    : [];
  const teamMap = Object.fromEntries(teams.map((t) => [t.id, t]));

  const enriched: Record<string, any[]> = {};
  for (const [group, stats] of Object.entries(standings)) {
    enriched[group] = stats.map((s, i) => ({
      ...s,
      position: i + 1,
      gd: s.gf - s.ga,
      team: teamMap[s.teamId] || null,
    }));
  }

  res.json({
    groups: enriched,
    tiebreakerRules: tournament.tiebreakerRules || "goal_difference,goals_for,wins",
    allGroupsComplete: Object.values(enriched).every((ts) => {
      const total = ts.length;
      const expectedMatches = (total * (total - 1)) / 2;
      const completedMatches = groupFixtures.filter(
        (f) => f.status === "completed" &&
          ts.some((t) => t.teamId === f.homeTeamId || t.teamId === f.awayTeamId),
      ).length;
      return completedMatches >= expectedMatches;
    }),
  });
});

router.post("/tournaments/:id/groups/advance", requirePermission("canManageTournaments"), async (req, res): Promise<void> => {
  const tournamentId = Number(req.params.id);
  if (!tournamentId) { res.status(400).json({ error: "Invalid id" }); return; }

  const [tournament] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, tournamentId));
  if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }

  const groupFixtures = await db.select().from(fixturesTable)
    .where(and(
      eq(fixturesTable.entityType, "tournament"),
      eq(fixturesTable.entityId, tournamentId),
      eq(fixturesTable.phase, "group"),
    ))
    .orderBy(asc(fixturesTable.round), asc(fixturesTable.id));

  const standings = computeGroupStandings(groupFixtures, tournament.tiebreakerRules);
  const groupNames = Object.keys(standings).sort();
  const groupCount = groupNames.length;

  // Determine how many teams advance per group
  const totalAdvancing = tournament.playoffTeams || groupCount * 2;
  const perGroup = Math.ceil(totalAdvancing / groupCount);

  // Standard seeding pattern: A1, B1, A2, B2, ... (alternating groups)
  const advancingSeeds: { teamId: number; seed: number; groupName: string }[] = [];
  let seedNum = 1;
  for (let rank = 0; rank < perGroup; rank++) {
    for (const groupName of groupNames) {
      const groupTeams = standings[groupName];
      if (groupTeams && rank < groupTeams.length) {
        advancingSeeds.push({
          teamId: groupTeams[rank].teamId,
          seed: seedNum++,
          groupName,
        });
      }
    }
  }

  // Assign advancing teams to pending playoff round-1 fixtures
  const playoffR1 = await db.select().from(fixturesTable)
    .where(and(
      eq(fixturesTable.entityType, "tournament"),
      eq(fixturesTable.entityId, tournamentId),
      eq(fixturesTable.phase, "playoff"),
      eq(fixturesTable.round, 1),
    ))
    .orderBy(asc(fixturesTable.id));

  const slots = nextPowerOf2(advancingSeeds.length);
  const seededIds: (number | null)[] = Array(slots).fill(null);
  advancingSeeds.forEach((s, i) => { seededIds[i] = s.teamId; });

  // Standard bracket seeding (1 vs N, 2 vs N-1, ...)
  const assignments: { fixtureId: number; homeTeamId: number | null; awayTeamId: number | null }[] = [];
  for (let i = 0; i < playoffR1.length && i < slots / 2; i++) {
    assignments.push({
      fixtureId: playoffR1[i].id,
      homeTeamId: seededIds[i],
      awayTeamId: seededIds[slots - 1 - i],
    });
  }

  await Promise.all(
    assignments.map((a) =>
      db.update(fixturesTable)
        .set({
          homeTeamId: a.homeTeamId,
          awayTeamId: a.awayTeamId,
          status: a.homeTeamId != null && a.awayTeamId != null ? "scheduled" : "pending",
          updatedAt: new Date(),
        })
        .where(eq(fixturesTable.id, a.fixtureId)),
    ),
  );

  const fullyAssigned = assignments.filter((a) => a.homeTeamId != null && a.awayTeamId != null);
  for (const a of fullyAssigned) {
    ensureGameCard(a.fixtureId).catch((err) => { console.error("[game-card] failed to update card for fixture", a.fixtureId, err?.message); });
  }

  res.json({
    message: `${advancingSeeds.length} teams advanced to playoff bracket`,
    advancing: advancingSeeds,
    assignments,
  });
});

// ─── Self check-in (captain confirms team day-before) ─────────────────────────

router.post("/tournaments/:id/self-checkin", requireAuth, async (req, res): Promise<void> => {
  const tournamentId = Number(req.params.id);
  const clerkUserId = (req as AuthedRequest).clerkUserId;
  const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkUserId));
  if (!dbUser) { res.status(404).json({ error: "User not found" }); return; }

  const { teamId, rosterPlayerIds } = req.body;
  if (!teamId) { res.status(400).json({ error: "teamId required" }); return; }

  const [tournament] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, tournamentId));
  if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }
  const isAdmin = await hasPermission(clerkUserId, "canManageTournaments");
  if (!isAdmin && !isEventActive(tournament)) { res.status(403).json({ error: "Event is not currently active" }); return; }

  // Verify user is on this team (teamMembers.userId stores Clerk IDs)
  const [member] = await db.select().from(teamMembersTable)
    .where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.userId, clerkUserId)));
  if (!member && !isAdmin) { res.status(403).json({ error: "Not a member of this team" }); return; }

  const [reg] = await db.select().from(tournamentRegistrationsTable)
    .where(and(
      eq(tournamentRegistrationsTable.tournamentId, tournamentId),
      eq(tournamentRegistrationsTable.teamId, teamId),
    ));
  if (!reg) { res.status(404).json({ error: "Team not registered for this tournament" }); return; }

  const [updated] = await db.update(tournamentRegistrationsTable)
    .set({
      selfCheckinConfirmed: true,
      selfCheckinConfirmedAt: new Date(),
      selfCheckinRosterJson: rosterPlayerIds ? JSON.stringify(rosterPlayerIds) : reg.selfCheckinRosterJson,
      updatedAt: new Date(),
    })
    .where(eq(tournamentRegistrationsTable.id, reg.id))
    .returning();

  res.json(parseReg(updated));
});

router.get("/tournaments/:id/self-checkin", requirePermission("canManageTournaments"), async (req, res): Promise<void> => {
  const tournamentId = Number(req.params.id);
  const regs = await db.select().from(tournamentRegistrationsTable)
    .where(and(
      eq(tournamentRegistrationsTable.tournamentId, tournamentId),
      eq(tournamentRegistrationsTable.status, "active"),
    ))
    .orderBy(asc(tournamentRegistrationsTable.createdAt));

  const teamIds = regs.map((r) => r.teamId).filter(Boolean) as number[];
  const teams = teamIds.length
    ? await db.select().from(teamsTable).where(inArray(teamsTable.id, teamIds))
    : [];
  const teamMap = Object.fromEntries(teams.map((t) => [t.id, t]));

  res.json(regs.map((r) => ({
    ...parseReg(r),
    team: r.teamId ? teamMap[r.teamId] || null : null,
    rosterConfirmed: r.selfCheckinConfirmed,
    roster: r.selfCheckinRosterJson ? JSON.parse(r.selfCheckinRosterJson) : [],
  })));
});

// ─── Event-day fixture check-in ───────────────────────────────────────────────

// GET check-in status for a fixture (admin; fixtureId=0 bypass for direct fixture access)
router.get("/tournaments/:id/fixtures/:fid/checkin", requirePermission("canManageTournaments"), async (req, res): Promise<void> => {
  const tournamentId = Number(req.params.id);
  const fixtureId = Number(req.params.fid);

  // If fid=0, we're loading the checkin for the tournament as a whole (all players across all fixtures)
  // but typically we load per-fixture check-ins
  const whereClause = fixtureId > 0
    ? and(eq(checkInsTable.entityType, "tournament"), eq(checkInsTable.entityId, fixtureId))
    : and(eq(checkInsTable.entityType, "tournament_event"), eq(checkInsTable.entityId, tournamentId));

  const checkins = await db.select().from(checkInsTable).where(whereClause as any);

  // Get fixture info
  let fixture = null;
  if (fixtureId > 0) {
    [fixture] = await db.select().from(fixturesTable).where(eq(fixturesTable.id, fixtureId));
  }

  // Get registered players via team members of registered teams
  const regs = await db.select().from(tournamentRegistrationsTable)
    .where(and(
      eq(tournamentRegistrationsTable.tournamentId, tournamentId),
      eq(tournamentRegistrationsTable.status, "active"),
    ));

  const teamIds = regs.map((r) => r.teamId).filter(Boolean) as number[];

  // Filter to teams in this fixture if fixtureId > 0
  let relevantTeamIds = teamIds;
  if (fixture && fixtureId > 0) {
    relevantTeamIds = [fixture.homeTeamId, fixture.awayTeamId].filter(Boolean) as number[];
  }

  // Two-step query: teamMembers.userId is a Clerk ID (text), cannot join to users.id (integer)
  const rawMembers = relevantTeamIds.length
    ? await db.select().from(teamMembersTable)
        .where(inArray(teamMembersTable.teamId, relevantTeamIds))
    : [];

  const clerkIds = rawMembers.map((m) => m.userId);
  const memberUsers = clerkIds.length
    ? await db.select().from(usersTable).where(inArray(usersTable.clerkId, clerkIds))
    : [];
  const usersByClerkId = Object.fromEntries(memberUsers.map((u) => [u.clerkId, u]));

  // checkins.userId is an integer DB user ID
  const checkinMap = new Set(checkins.map((c) => String(c.userId)));
  const paymentMap = Object.fromEntries(regs.map((r) => [r.teamId, r.paymentStatus]));

  const players = rawMembers
    .map((m) => {
      const user = usersByClerkId[m.userId];
      return {
        userId: user?.id ?? null,
        teamId: m.teamId,
        role: m.role,
        firstName: user?.firstName ?? null,
        lastName: user?.lastName ?? null,
        email: user?.email ?? null,
        qrCode: user?.qrCode ?? null,
        checkedIn: user ? checkinMap.has(String(user.id)) : false,
        paymentStatus: paymentMap[m.teamId] || "unpaid",
        paymentBlocked: paymentMap[m.teamId] !== "paid" && paymentMap[m.teamId] !== "waived",
      };
    })
    .filter((p) => p.userId != null);

  const teams = relevantTeamIds.length
    ? await db.select().from(teamsTable).where(inArray(teamsTable.id, relevantTeamIds))
    : [];

  res.json({
    fixture,
    teams,
    players,
    checkins,
    stats: {
      total: players.length,
      checkedIn: players.filter((p) => p.checkedIn).length,
      unpaid: players.filter((p) => p.paymentBlocked).length,
    },
  });
});

router.post("/tournaments/:id/fixtures/:fid/checkin", requirePermission("canManageTournaments"), async (req, res): Promise<void> => {
  const tournamentId = Number(req.params.id);
  const fixtureId = Number(req.params.fid);

  if (tournamentId > 0) {
    const [tournamentRecord] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, tournamentId));
    if (!tournamentRecord || !isEventActive(tournamentRecord)) {
      res.status(403).json({ error: "This tournament is not currently active" });
      return;
    }
  }

  const { userId, qrCode, method } = req.body;

  let resolvedUserId = userId;

  if (qrCode && !resolvedUserId) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.qrCode, qrCode));
    if (!user) { res.status(404).json({ error: "QR code not recognized" }); return; }
    resolvedUserId = user.id;
  }

  if (!resolvedUserId) { res.status(400).json({ error: "userId or qrCode required" }); return; }

  // Verify user is on a registered team for this tournament
  const regs = await db.select().from(tournamentRegistrationsTable)
    .where(and(
      eq(tournamentRegistrationsTable.tournamentId, tournamentId),
      eq(tournamentRegistrationsTable.status, "active"),
    ));
  const teamIds = regs.map((r) => r.teamId).filter(Boolean) as number[];

  let relevantTeamIds = teamIds;
  if (fixtureId > 0) {
    const [fixture] = await db.select().from(fixturesTable).where(eq(fixturesTable.id, fixtureId));
    if (fixture) {
      relevantTeamIds = [fixture.homeTeamId, fixture.awayTeamId].filter(Boolean) as number[];
    }
  }

  // teamMembers.userId stores Clerk IDs — need to look up clerkId for resolvedUserId (integer)
  const [resolvedUser] = await db.select().from(usersTable).where(eq(usersTable.id, resolvedUserId));
  if (!resolvedUser) { res.status(404).json({ error: "User not found" }); return; }

  const [membership] = relevantTeamIds.length
    ? await db.select().from(teamMembersTable)
      .where(and(
        eq(teamMembersTable.userId, resolvedUser.clerkId),
        inArray(teamMembersTable.teamId, relevantTeamIds),
      ))
    : [undefined];

  if (!membership) { res.status(403).json({ error: "Player not on a team in this fixture" }); return; }

  // Check payment status
  const reg = regs.find((r) => r.teamId === membership.teamId);
  if (reg && reg.paymentStatus !== "paid" && reg.paymentStatus !== "waived" && !reg.balanceOverriddenByAdmin) {
    res.status(400).json({ error: "Team has an outstanding balance — payment required before check-in" });
    return;
  }

  // Check existing check-in
  const entityId = fixtureId > 0 ? fixtureId : tournamentId;
  const entityType = fixtureId > 0 ? "tournament" : "tournament_event";

  const existing = await db.select().from(checkInsTable)
    .where(and(
      eq(checkInsTable.entityType, entityType),
      eq(checkInsTable.entityId, entityId),
      eq(checkInsTable.userId, resolvedUserId),
    ));
  if (existing.length > 0) { res.status(409).json({ error: "Player already checked in" }); return; }

  const [checkin] = await db.insert(checkInsTable).values({
    entityType,
    entityId,
    userId: resolvedUserId,
    method: method || "manual",
    checkedInAt: new Date(),
  } as typeof checkInsTable.$inferInsert).returning();

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, resolvedUserId));
  res.status(201).json({ checkin, user });
});

// Quick-add walk-in player to fixture check-in
router.post("/tournaments/:id/fixtures/:fid/checkin/quickadd", requirePermission("canManageTournaments"), async (req, res): Promise<void> => {
  const tournamentId = Number(req.params.id);
  const fixtureId = Number(req.params.fid);

  if (tournamentId > 0) {
    const [tournamentRecord] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, tournamentId));
    if (!tournamentRecord || !isEventActive(tournamentRecord)) {
      res.status(403).json({ error: "This tournament is not currently active" });
      return;
    }
  }

  const { firstName, lastName, email } = req.body;

  if (!firstName || !lastName) { res.status(400).json({ error: "firstName and lastName required" }); return; }

  let [user] = email
    ? await db.select().from(usersTable).where(eq(usersTable.email, email))
    : [undefined];

  if (!user && email) {
    [user] = await db.insert(usersTable).values({
      email,
      firstName,
      lastName,
      clerkId: `walkin_${Date.now()}`,
      role: "player",
    } as typeof usersTable.$inferInsert).returning();
  }

  if (!user) { res.status(400).json({ error: "Email required to create walk-in player" }); return; }

  const entityId = fixtureId > 0 ? fixtureId : tournamentId;
  const entityType = fixtureId > 0 ? "tournament" : "tournament_event";

  const [checkin] = await db.insert(checkInsTable).values({
    entityType,
    entityId,
    userId: user.id,
    method: "walk_in",
    checkedInAt: new Date(),
  } as typeof checkInsTable.$inferInsert).returning();

  res.status(201).json({ checkin, user });
});

router.get("/tournaments/:id/is-registered", async (req, res): Promise<void> => {
  const tournamentId = Number(req.params.id);
  const auth = getAuth(req);

  if (!auth?.userId) {
    res.json({ isRegistered: false });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, auth.userId));
  if (user?.role === "admin" || user?.role === "staff") {
    res.json({ isRegistered: true });
    return;
  }

  const userTeams = await db.select().from(teamsTable)
    .innerJoin(teamMembersTable, eq(teamMembersTable.teamId, teamsTable.id))
    .where(and(eq(teamMembersTable.userId, auth.userId), eq(teamMembersTable.status, "active")));

  if (!userTeams.length) {
    res.json({ isRegistered: false });
    return;
  }

  const teamIds = userTeams.map((r) => r.teams.id);
  const [reg] = await db.select().from(tournamentRegistrationsTable)
    .where(and(
      eq(tournamentRegistrationsTable.tournamentId, tournamentId),
      inArray(tournamentRegistrationsTable.teamId, teamIds),
    ));

  res.json({ isRegistered: !!reg });
});

// ─── Tournament Divisions CRUD ────────────────────────────────────────────────

router.get("/tournaments/:id/divisions", async (req, res): Promise<void> => {
  const tournamentId = Number(req.params.id);
  if (!tournamentId) { res.status(400).json({ error: "Invalid id" }); return; }

  const divisions = await db.select().from(tournamentDivisionsTable)
    .where(eq(tournamentDivisionsTable.tournamentId, tournamentId))
    .orderBy(asc(tournamentDivisionsTable.divisionOrder), asc(tournamentDivisionsTable.id));

  // Count teams from registrations (the source of truth for division assignment)
  const teamCounts = await db.select({
    divisionId: tournamentRegistrationsTable.divisionId,
    count: sql<number>`count(*)::int`,
  }).from(tournamentRegistrationsTable)
    .where(and(
      eq(tournamentRegistrationsTable.tournamentId, tournamentId),
      sql`${tournamentRegistrationsTable.divisionId} IS NOT NULL`,
      sql`${tournamentRegistrationsTable.status} != 'cancelled'`,
    ))
    .groupBy(tournamentRegistrationsTable.divisionId);

  const countMap = Object.fromEntries(teamCounts.map((r) => [r.divisionId, r.count]));
  res.json(divisions.map((d) => ({ ...d, teamCount: countMap[d.id] ?? 0 })));
});

router.post("/tournaments/:id/divisions", requirePermission("canManageTournaments"), async (req, res): Promise<void> => {
  const tournamentId = Number(req.params.id);
  if (!tournamentId) { res.status(400).json({ error: "Invalid id" }); return; }

  const { name, ageGroups, bracketFormat, hasGroupStage, divisionOrder } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }

  const [division] = await db.insert(tournamentDivisionsTable).values({
    tournamentId,
    name: name.trim(),
    ageGroups: Array.isArray(ageGroups) ? ageGroups : [],
    bracketFormat: bracketFormat || null,
    hasGroupStage: hasGroupStage != null ? Boolean(hasGroupStage) : null,
    divisionOrder: divisionOrder ?? 0,
  }).returning();

  res.status(201).json({ ...division, teamCount: 0 });
});

router.patch("/tournaments/:id/divisions/:divId", requirePermission("canManageTournaments"), async (req, res): Promise<void> => {
  const tournamentId = Number(req.params.id);
  const divId = Number(req.params.divId);
  if (!tournamentId || !divId) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(tournamentDivisionsTable)
    .where(and(eq(tournamentDivisionsTable.id, divId), eq(tournamentDivisionsTable.tournamentId, tournamentId)));
  if (!existing) { res.status(404).json({ error: "Division not found" }); return; }

  const updates: Record<string, any> = { updatedAt: new Date() };
  const { name, ageGroups, bracketFormat, hasGroupStage, divisionOrder } = req.body;
  if (name !== undefined) updates.name = name.trim();
  if (ageGroups !== undefined) updates.ageGroups = Array.isArray(ageGroups) ? ageGroups : [];
  if (bracketFormat !== undefined) updates.bracketFormat = bracketFormat || null;
  if (hasGroupStage !== undefined) updates.hasGroupStage = hasGroupStage != null ? Boolean(hasGroupStage) : null;
  if (divisionOrder !== undefined) updates.divisionOrder = Number(divisionOrder);

  const [updated] = await db.update(tournamentDivisionsTable)
    .set(updates)
    .where(eq(tournamentDivisionsTable.id, divId))
    .returning();

  res.json(updated);
});

router.delete("/tournaments/:id/divisions/:divId", requirePermission("canManageTournaments"), async (req, res): Promise<void> => {
  const tournamentId = Number(req.params.id);
  const divId = Number(req.params.divId);
  if (!tournamentId || !divId) { res.status(400).json({ error: "Invalid id" }); return; }

  const allDivisions = await db.select().from(tournamentDivisionsTable)
    .where(eq(tournamentDivisionsTable.tournamentId, tournamentId));
  if (allDivisions.length <= 1) {
    res.status(400).json({ error: "Cannot delete the last division. A tournament must have at least one division." });
    return;
  }

  const [existing] = allDivisions.filter((d) => d.id === divId);
  if (!existing) { res.status(404).json({ error: "Division not found" }); return; }

  await db.delete(tournamentDivisionsTable).where(eq(tournamentDivisionsTable.id, divId));
  res.sendStatus(204);
});

export default router;
