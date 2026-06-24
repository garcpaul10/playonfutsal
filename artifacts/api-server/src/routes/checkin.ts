import { Router, type IRouter } from "express";
import {
  db, usersTable, playerProfilesTable, checkInsTable,
  spotsTable, dropinsTable, dropinCourtPoolsTable,
  dropinTemplatesTable, dropinTemplatePoolsTable, dropinOccurrencesTable,
  campRegistrationsTable, campDaysTable, campsTable,
  fixturesTable, teamsTable, teamMembersTable, leagueRegistrationsTable,
  guardiansTable, assignmentsTable, gameCardsTable,
  isEventActive, getEventWindow,
} from "@workspace/db";
import { eq, and, inArray, sql, or } from "drizzle-orm";
import {
  computeOccurrenceDates,
  occurrenceDateToUtc,
  toEasternDateString,
} from "../services/dropinOccurrenceService";
import type { RecurrenceRule } from "@workspace/db";
import { requireAuth, hasPermission, type AuthedRequest } from "../middlewares/auth";

const router: IRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolvePlayerByQr(qrCode: string) {
  // Prefer participant-profile QR (PLAYON:{id}:{random}) — canonical format for all new accounts
  const [pp] = await db.select().from(playerProfilesTable).where(eq(playerProfilesTable.qrCode, qrCode));
  if (pp) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, pp.userId));
    if (user) return user;
  }
  // Legacy fallback: account-level QR stored on users table (playon:player:{clerkId})
  const [user] = await db.select().from(usersTable).where(eq(usersTable.qrCode, qrCode));
  return user ?? null;
}

function todayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function todayDateStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

/** Verify the caller has access to scan the given session (role + assignment check). */
async function canScanSession(
  dbUser: any,
  sessionType: string,
  sessionEntityId: number,
  campId?: number,
): Promise<{ allowed: boolean; reason?: string }> {
  // Admin and staff can scan anything
  if (dbUser.role === "admin" || dbUser.role === "staff") {
    return { allowed: true };
  }
  // Scope canManage* permission checks to the matching session type only.
  // A user with drop-in permission must NOT be able to scan league or camp sessions.
  if (sessionType === "dropin" && (await hasPermission(dbUser.clerkId, "canManageDropins"))) {
    return { allowed: true };
  }
  if (sessionType === "league_fixture" && (await hasPermission(dbUser.clerkId, "canManageLeagues"))) {
    return { allowed: true };
  }
  if (sessionType === "camp_day" && (await hasPermission(dbUser.clerkId, "canManageCamps"))) {
    return { allowed: true };
  }

  if (dbUser.role === "ref" || dbUser.role === "coach" || dbUser.role === "scorekeeper") {
    // Refs/coaches/scorekeepers must have an assignment to the specific entity
    const entityType = sessionType === "league_fixture" ? "fixture"
      : sessionType === "camp_day" ? "camp"
      : "dropin";
    const entityId = sessionType === "camp_day" ? (campId ?? sessionEntityId) : sessionEntityId;

    const [assignment] = await db.select().from(assignmentsTable).where(
      and(
        eq(assignmentsTable.staffUserId, dbUser.id),
        eq(assignmentsTable.entityType, entityType),
        eq(assignmentsTable.entityId, entityId),
      )
    );
    if (assignment) return { allowed: true };
    return { allowed: false, reason: "You are not assigned to this event" };
  }

  return { allowed: false, reason: "Insufficient role to operate scanner. Refs, coaches, and scorekeepers must be assigned to the event." };
}

// ─── GET /scanner/active-sessions ─────────────────────────────────────────────

router.get("/scanner/active-sessions", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!dbUser) { res.status(401).json({ error: "User not found" }); return; }

  const isAdmin = dbUser.role === "admin";
  const isStaff = dbUser.role === "staff";
  const isRef = dbUser.role === "ref";
  const isCoach = dbUser.role === "coach";
  const isScorekeeper = dbUser.role === "scorekeeper";

  const hasDropinPerm = await hasPermission(authed.clerkUserId, "canManageDropins");
  const hasLeaguePerm = await hasPermission(authed.clerkUserId, "canManageLeagues");
  const hasCampPerm = await hasPermission(authed.clerkUserId, "canManageCamps");

  const isPrivileged = isAdmin || isStaff || hasDropinPerm || hasLeaguePerm || hasCampPerm;
  const isFieldStaff = isRef || isCoach || isScorekeeper;

  if (!isPrivileged && !isFieldStaff) {
    res.status(403).json({ error: "Scanner access requires staff, ref, coach, or scorekeeper role" });
    return;
  }

  const { start, end } = todayRange();
  const sessions: any[] = [];

  // ── League fixtures today ──────────────────────────────────────────────────
  let fixtureRows: any[] = [];
  if (isPrivileged) {
    fixtureRows = await db.select().from(fixturesTable)
      .where(and(
        sql`${fixturesTable.scheduledAt} >= ${start}`,
        sql`${fixturesTable.scheduledAt} <= ${end}`,
      ));
  } else if (isFieldStaff) {
    const assignments = await db.select().from(assignmentsTable)
      .where(and(
        eq(assignmentsTable.staffUserId, dbUser.id),
        eq(assignmentsTable.entityType, "fixture"),
      ));
    const fixtureIds = assignments.map(a => a.entityId);
    if (fixtureIds.length > 0) {
      fixtureRows = await db.select().from(fixturesTable)
        .where(and(
          inArray(fixturesTable.id, fixtureIds),
          sql`${fixturesTable.scheduledAt} >= ${start}`,
          sql`${fixturesTable.scheduledAt} <= ${end}`,
        ));
    }
  }

  for (const fx of fixtureRows) {
    const homeTeam = fx.homeTeamId
      ? (await db.select({ name: teamsTable.name }).from(teamsTable).where(eq(teamsTable.id, fx.homeTeamId)))[0]
      : null;
    const awayTeam = fx.awayTeamId
      ? (await db.select({ name: teamsTable.name }).from(teamsTable).where(eq(teamsTable.id, fx.awayTeamId)))[0]
      : null;
    sessions.push({
      type: "league_fixture",
      id: fx.id,
      name: [homeTeam?.name, awayTeam?.name].filter(Boolean).join(" vs ") || `Fixture #${fx.id}`,
      startsAt: fx.scheduledAt,
      meta: { fixtureId: fx.id, homeTeam: homeTeam?.name, awayTeam: awayTeam?.name, leagueId: fx.entityId },
    });
  }

  // ── Drop-in sessions today ─────────────────────────────────────────────────
  // Use pool startsAt (two-tier model) — shell startsAt is just a template fallback
  if (isPrivileged) {
    const poolsToday = await db.select().from(dropinCourtPoolsTable)
      .where(and(
        sql`${dropinCourtPoolsTable.startsAt} >= ${start}`,
        sql`${dropinCourtPoolsTable.startsAt} <= ${end}`,
      ));
    const dropinIdsToday = [...new Set(poolsToday.map((p) => p.dropinId))];
    if (dropinIdsToday.length > 0) {
      const dropins = await db.select().from(dropinsTable)
        .where(and(
          inArray(dropinsTable.id, dropinIdsToday),
          sql`${dropinsTable.status} NOT IN ('cancelled', 'completed')`,
        ));
      for (const d of dropins) {
        const dropin_pools = poolsToday
          .filter((p) => p.dropinId === d.id)
          .sort((a, b) => new Date(a.startsAt!).getTime() - new Date(b.startsAt!).getTime());
        const firstPoolStart = dropin_pools[0]?.startsAt;
        sessions.push({
          type: "dropin",
          id: d.id,
          name: d.name,
          startsAt: firstPoolStart ?? d.startsAt,
          meta: { dropinId: d.id, maxPlayers: d.maxPlayers },
        });
      }
    }

    // ── Template occurrences today (walk-up materialization) ──────────────────
    // Discover active templates whose recurrence rule fires today but whose
    // dropin_court_pools haven't been materialized yet (no first RSVP yet).
    const seenDropinIds = new Set(dropinIdsToday);
    const todayEastern = toEasternDateString(new Date());
    const allTemplates = await db.select().from(dropinTemplatesTable)
      .where(sql`${dropinTemplatesTable.isPublished} = true AND ${dropinTemplatesTable.isDraft} = false`);

    for (const tmpl of allTemplates) {
      try {
        const rule = tmpl.recurrenceRule as RecurrenceRule;
        const dayStart = occurrenceDateToUtc(todayEastern, "00:00");
        const dayEnd = new Date(dayStart.getTime() + 86_400_000 - 1);
        const dates = computeOccurrenceDates(rule, { from: dayStart, to: dayEnd, limit: 1 });
        if (!dates.length) continue;

        // Check whether a dropin already exists for this template today
        const [existingDropin] = await db.select({ id: dropinsTable.id, name: dropinsTable.name, startsAt: dropinsTable.startsAt })
          .from(dropinsTable)
          .where(and(
            eq(dropinsTable.templateId, tmpl.id),
            sql`starts_at >= ${dayStart.toISOString()}::timestamptz`,
            sql`starts_at <= ${dayEnd.toISOString()}::timestamptz`,
            sql`${dropinsTable.status} NOT IN ('cancelled', 'completed')`,
          ));

        if (existingDropin && seenDropinIds.has(existingDropin.id)) continue;

        // Template fires today but no materialized pools yet — show it so scanners
        // can admit walk-ups (the RSVP endpoint will materialize on first scan)
        const tmplPools = await db.select().from(dropinTemplatePoolsTable)
          .where(eq(dropinTemplatePoolsTable.templateId, tmpl.id));
        const occDate = dates[0];
        // Compute a representative startsAt from the first pool's time info
        const firstPool = tmplPools[0] as any;
        const poolStartTime: string = firstPool?.startTime ?? (rule as any).startTime ?? "00:00";
        const representativeStartsAt = occurrenceDateToUtc(occDate, poolStartTime);

        if (representativeStartsAt < start || representativeStartsAt > end) continue;

        if (existingDropin) {
          if (!seenDropinIds.has(existingDropin.id)) {
            seenDropinIds.add(existingDropin.id);
            sessions.push({
              type: "dropin",
              id: existingDropin.id,
              name: existingDropin.name,
              startsAt: existingDropin.startsAt ?? representativeStartsAt,
              meta: { dropinId: existingDropin.id, templateId: tmpl.id, unmaterialized: false },
            });
          }
        } else {
          // Not yet materialized — materialize inline so scanners get a real dropin ID
          // and qr-scan can process walk-up check-ins against it.
          try {
            // Ensure dropin_occurrences row
            let [occurrence] = await db.select().from(dropinOccurrencesTable).where(
              and(eq(dropinOccurrencesTable.templateId, tmpl.id), eq(dropinOccurrencesTable.occurrenceDate, occDate))
            );
            if (!occurrence) {
              [occurrence] = await db.insert(dropinOccurrencesTable).values({
                templateId: tmpl.id, occurrenceDate: occDate, status: "upcoming",
              } as any).returning();
            }
            if (occurrence.status === "cancelled") continue;

            // Ensure dropin row (keyed by templateId + startsAt)
            let [newDropin] = await db.select().from(dropinsTable).where(
              and(eq(dropinsTable.templateId, tmpl.id), sql`starts_at = ${representativeStartsAt.toISOString()}::timestamptz`)
            );
            if (!newDropin) {
              [newDropin] = await db.insert(dropinsTable).values({
                name: tmpl.name,
                ageGroup: (firstPool?.ageGroup ?? []) as string[],
                courtId: firstPool?.courtId ?? null,
                startsAt: representativeStartsAt,
                durationMinutes: firstPool?.durationMinutes ?? (rule as any).durationMinutes ?? 120,
                price: String(firstPool?.price ?? "0"),
                registrationOpen: true,
                status: "upcoming",
                templateId: tmpl.id,
                isPublished: true,
              } as any).returning();
            }

            // Ensure dropin_court_pools rows for each template pool
            for (const tp of tmplPools) {
              const [existCp] = await db.select({ id: dropinCourtPoolsTable.id })
                .from(dropinCourtPoolsTable)
                .where(and(
                  eq(dropinCourtPoolsTable.dropinId, newDropin.id),
                  eq(dropinCourtPoolsTable.dropinTemplatePoolId, tp.id),
                ));
              if (!existCp) {
                const tpStartTime: string = (tp as any).startTime ?? (rule as any).startTime ?? "00:00";
                const cpStartsAt = occurrenceDateToUtc(occDate, tpStartTime);
                await db.insert(dropinCourtPoolsTable).values({
                  dropinId: newDropin.id,
                  courtId: tp.courtId,
                  dropinTemplatePoolId: tp.id,
                  ageGroup: (tp.ageGroup ?? []) as string[],
                  skillLevel: tp.skillLevel ?? "all",
                  cap: tp.cap,
                  price: String(tp.price ?? "0"),
                  registrationOpen: true,
                  startsAt: cpStartsAt,
                  durationMinutes: (tp as any).durationMinutes ?? (rule as any).durationMinutes ?? 120,
                  offerWindowMinutes: (tp as any).offerWindowMinutes ?? 240,
                  gender: (tp as any).gender ?? null,
                } as any).catch(() => {/* ignore unique constraint violations */});
              }
            }

            // Back-link occurrence → dropin (idempotent)
            await db.update(dropinOccurrencesTable)
              .set({ materializedDropinId: newDropin.id, updatedAt: new Date() } as any)
              .where(eq(dropinOccurrencesTable.id, occurrence.id));

            if (!seenDropinIds.has(newDropin.id)) {
              seenDropinIds.add(newDropin.id);
              sessions.push({
                type: "dropin",
                id: newDropin.id,
                name: newDropin.name,
                startsAt: newDropin.startsAt ?? representativeStartsAt,
                meta: { dropinId: newDropin.id, templateId: tmpl.id, unmaterialized: false },
              });
            }
          } catch (matErr) {
            console.error("[scanner] Failed to materialize template occurrence for scanner:", matErr);
          }
        }
      } catch {
        // Skip templates with malformed recurrence rules
      }
    }
  }

  // ── Camp days today ────────────────────────────────────────────────────────
  const todayStr = todayDateStr();
  let campDayRows: { day: any; camp: any }[] = [];

  if (isPrivileged) {
    campDayRows = await db.select({ day: campDaysTable, camp: campsTable })
      .from(campDaysTable)
      .innerJoin(campsTable, eq(campDaysTable.campId, campsTable.id))
      .where(eq(campDaysTable.date, todayStr));
  } else if (isCoach) {
    const assignments = await db.select().from(assignmentsTable)
      .where(and(
        eq(assignmentsTable.staffUserId, dbUser.id),
        eq(assignmentsTable.entityType, "camp"),
      ));
    const campIds = assignments.map(a => a.entityId);
    if (campIds.length > 0) {
      campDayRows = await db.select({ day: campDaysTable, camp: campsTable })
        .from(campDaysTable)
        .innerJoin(campsTable, eq(campDaysTable.campId, campsTable.id))
        .where(and(eq(campDaysTable.date, todayStr), inArray(campDaysTable.campId, campIds)));
    }
  }

  for (const { day, camp } of campDayRows) {
    sessions.push({
      type: "camp_day",
      id: day.id,
      name: `${camp.name} — ${day.date}`,
      startsAt: `${day.date}T${day.startTime}`,
      meta: { campId: camp.id, dayId: day.id, campName: camp.name, date: day.date },
    });
  }

  sessions.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  res.json({ sessions, userRole: dbUser.role });
});

// ─── POST /scanner/qr-scan ────────────────────────────────────────────────────

router.post("/scanner/qr-scan", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const { qrCode, sessionType, sessionId, campId } = req.body;

  if (!qrCode || !sessionType || !sessionId) {
    res.status(400).json({ error: "qrCode, sessionType, and sessionId are required" });
    return;
  }

  const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!dbUser) { res.status(401).json({ error: "User not found" }); return; }

  // Session-specific authorization: verify caller is assigned to THIS event
  const accessCheck = await canScanSession(
    dbUser,
    sessionType,
    Number(sessionId),
    campId ? Number(campId) : undefined,
  );
  if (!accessCheck.allowed) {
    res.status(403).json({ error: accessCheck.reason ?? "Not authorized to scan this session" });
    return;
  }

  // ─── Guest spot QR detection (drop-in only) ─────────────────────────────
  // Guest booking QR payloads are JSON objects: { spotId, dropinId, poolId? }
  let guestQrPayload: { spotId: number; dropinId: number; poolId?: number } | null = null;
  try {
    const parsed = JSON.parse(qrCode as string);
    if (parsed && typeof parsed.spotId === "number" && typeof parsed.dropinId === "number") {
      guestQrPayload = parsed;
    }
  } catch {
    // Not JSON — fall through to standard player QR resolution
  }

  if (guestQrPayload) {
    if (sessionType !== "dropin") {
      res.json({ status: "not_found", message: "Guest spot QR codes are only supported for drop-in sessions" });
      return;
    }
    const dropinId = Number(sessionId);
    if (guestQrPayload.dropinId !== dropinId) {
      res.json({ status: "not_found", message: "QR code is for a different drop-in session" });
      return;
    }

    const [dropin] = await db.select().from(dropinsTable).where(eq(dropinsTable.id, dropinId));
    if (!dropin) { res.status(404).json({ error: "Drop-in session not found" }); return; }
    if (dropin.status === "completed" || dropin.status === "cancelled") {
      res.status(409).json({ error: "Session has already ended and check-in is no longer available" }); return;
    }
    if (!isEventActive(dropin)) {
      const win = getEventWindow(dropin);
      const notYetActive = win ? new Date() < win.windowStart : true;
      res.status(403).json({
        error: "Event is not currently active",
        notYetActive,
        windowStart: win?.windowStart.toISOString() ?? null,
      });
      return;
    }

    const [spot] = await db.select().from(spotsTable).where(eq(spotsTable.id, guestQrPayload.spotId));
    if (!spot || spot.entityType !== "dropin" || spot.entityId !== dropinId) {
      res.json({ status: "not_found", message: "Spot not found for this session" });
      return;
    }
    if (spot.status !== "reserved" || spot.waitlisted) {
      res.json({ status: "not_found", message: "Spot is not active" });
      return;
    }

    const eventInfo = { type: "dropin", id: dropinId, name: dropin.name };

    // If the guest has since linked a user account, resolve as a normal player check-in
    if (spot.userId) {
      const [linkedUser] = await db.select().from(usersTable).where(eq(usersTable.id, spot.userId));
      if (linkedUser) {
        const linkedPlayerInfo = {
          id: linkedUser.id,
          firstName: linkedUser.firstName,
          lastName: linkedUser.lastName,
          playonId: (linkedUser as any).playonId ?? null,
        };
        const [existingCI] = await db.select().from(checkInsTable).where(and(
          eq(checkInsTable.entityType, "dropin"),
          eq(checkInsTable.entityId, dropinId),
          eq(checkInsTable.userId, linkedUser.id),
          sql`${checkInsTable.voidedAt} IS NULL`,
        ));
        if (existingCI) {
          res.json({ status: "confirmed", player: linkedPlayerInfo, event: eventInfo, checkedInAt: existingCI.checkedInAt });
          return;
        }
        if (spot.paymentStatus === "unpaid") {
          res.json({
            status: "registered_pending_payment",
            player: linkedPlayerInfo,
            event: { ...eventInfo, primaryPoolId: spot.poolId },
            spotId: spot.id,
            message: "Spot reserved but payment not yet collected. Confirm payment to complete check-in.",
          });
          return;
        }
        const [ci] = await db.insert(checkInsTable).values({
          entityType: "dropin", entityId: dropinId, userId: linkedUser.id,
          method: "qr", qrCodeScanned: qrCode, isManual: false, checkedInAt: new Date(),
        } as any).returning();
        res.json({ status: "checked_in", player: linkedPlayerInfo, event: eventInfo, checkedInAt: ci.checkedInAt });
        return;
      }
    }

    // Unlinked guest spot — check in against the spot directly
    const guestName = spot.guestName ?? "Guest";

    // Detect duplicate guest check-in by matching the exact QR payload scanned
    const [existingGuestCI] = await db.select().from(checkInsTable).where(and(
      eq(checkInsTable.entityType, "dropin"),
      eq(checkInsTable.entityId, dropinId),
      eq(checkInsTable.qrCodeScanned, qrCode as string),
      sql`${checkInsTable.voidedAt} IS NULL`,
    ));
    if (existingGuestCI) {
      res.json({ status: "confirmed", guestName, event: eventInfo, checkedInAt: existingGuestCI.checkedInAt });
      return;
    }

    if (spot.paymentStatus === "unpaid") {
      res.json({
        status: "registered_pending_payment",
        guestName,
        event: { ...eventInfo, primaryPoolId: spot.poolId },
        spotId: spot.id,
        message: "Spot reserved but payment not yet collected. Confirm payment to complete check-in.",
      });
      return;
    }

    const [ci] = await db.insert(checkInsTable).values({
      entityType: "dropin",
      entityId: dropinId,
      userId: null,
      method: "qr",
      qrCodeScanned: qrCode,
      isManual: false,
      checkedInAt: new Date(),
      notes: `guest:${guestQrPayload.spotId}:${guestName}`,
    } as any).returning();

    res.json({ status: "checked_in", guestName, event: eventInfo, checkedInAt: ci.checkedInAt });
    return;
  }
  // ─── End guest spot QR ───────────────────────────────────────────────────

  const player = await resolvePlayerByQr(qrCode as string);
  if (!player) {
    res.json({ status: "not_found", message: "QR code not recognised" });
    return;
  }

  const playerInfo = {
    id: player.id,
    firstName: player.firstName,
    lastName: player.lastName,
    playonId: player.playonId,
  };

  // ─── Drop-in ──────────────────────────────────────────────────────────────
  if (sessionType === "dropin") {
    const dropinId = Number(sessionId);
    const [dropin] = await db.select().from(dropinsTable).where(eq(dropinsTable.id, dropinId));
    if (!dropin) { res.status(404).json({ error: "Drop-in session not found" }); return; }
    if (dropin.status === "completed" || dropin.status === "cancelled") {
      res.status(409).json({ error: "Session has already ended and check-in is no longer available" }); return;
    }
    if (!isEventActive(dropin)) {
      const win = getEventWindow(dropin);
      const notYetActive = win ? new Date() < win.windowStart : true;
      res.status(403).json({
        error: "Event is not currently active",
        notYetActive,
        windowStart: win?.windowStart.toISOString() ?? null,
      });
      return;
    }

    const [existingCI] = await db.select().from(checkInsTable).where(and(
      eq(checkInsTable.entityType, "dropin"),
      eq(checkInsTable.entityId, dropinId),
      eq(checkInsTable.userId, player.id),
      sql`${checkInsTable.voidedAt} IS NULL`,
    ));
    if (existingCI) {
      res.json({
        status: "confirmed", player: playerInfo,
        event: { type: "dropin", id: dropinId, name: dropin.name },
        checkedInAt: existingCI.checkedInAt,
      });
      return;
    }

    // Look for a reserved non-waitlisted spot
    const pools = await db.select().from(dropinCourtPoolsTable).where(eq(dropinCourtPoolsTable.dropinId, dropinId));
    const poolIds = pools.map(p => p.id);

    const [spot] = poolIds.length
      ? await db.select().from(spotsTable).where(and(
          inArray(spotsTable.poolId, poolIds),
          eq(spotsTable.userId, player.id),
          eq(spotsTable.entityType, "dropin"),
          eq(spotsTable.entityId, dropinId),
          eq(spotsTable.status, "reserved"),
          eq(spotsTable.waitlisted, false),
        ))
      : [];

    if (spot) {
      // Payment gate: if spot is unpaid (walk-up pending payment), do NOT check in yet
      if (spot.paymentStatus === "unpaid") {
        res.json({
          status: "registered_pending_payment",
          player: playerInfo,
          event: { type: "dropin", id: dropinId, name: dropin.name, primaryPoolId: spot.poolId },
          spotId: spot.id,
          message: "Spot reserved but payment not yet collected. Confirm payment to complete check-in.",
        });
        return;
      }
      const [ci] = await db.insert(checkInsTable).values({
        entityType: "dropin", entityId: dropinId, userId: player.id,
        method: "qr", qrCodeScanned: qrCode, isManual: false, checkedInAt: new Date(),
      } as any).returning();
      res.json({
        status: "checked_in", player: playerInfo,
        event: { type: "dropin", id: dropinId, name: dropin.name },
        checkedInAt: ci.checkedInAt,
      });
      return;
    }

    // No spot — evaluate capacity for walk-up
    if (!dropin.registrationOpen || poolIds.length === 0) {
      res.json({
        status: "at_capacity",
        message: dropin.registrationOpen ? "No pools configured for this session" : "Registration is closed",
        player: playerInfo,
        event: { type: "dropin", id: dropinId, name: dropin.name },
      });
      return;
    }

    const [countRow] = await db.select({ count: sql<number>`count(*)` })
      .from(spotsTable)
      .where(and(
        inArray(spotsTable.poolId, poolIds),
        eq(spotsTable.status, "reserved"),
        eq(spotsTable.waitlisted, false),
      ));
    const spotsTaken = Number(countRow?.count ?? 0);
    const maxPlayers = dropin.maxPlayers ?? 15;

    if (spotsTaken >= maxPlayers) {
      res.json({
        status: "at_capacity",
        message: `Session is full (${spotsTaken}/${maxPlayers})`,
        player: playerInfo,
        event: { type: "dropin", id: dropinId, name: dropin.name, price: Number(dropin.price) },
      });
      return;
    }

    res.json({
      status: "walk_up_available", player: playerInfo,
      event: {
        type: "dropin", id: dropinId, name: dropin.name,
        price: Number(dropin.price),
        spotsLeft: maxPlayers - spotsTaken,
        primaryPoolId: pools[0]?.id ?? null,
      },
    });
    return;
  }

  // ─── Camp day ─────────────────────────────────────────────────────────────
  if (sessionType === "camp_day") {
    const dayId = Number(sessionId);
    const [day] = await db.select().from(campDaysTable).where(eq(campDaysTable.id, dayId));
    if (!day) { res.status(404).json({ error: "Camp day not found" }); return; }

    const campIdNum = Number(campId) || day.campId;
    const [camp] = await db.select().from(campsTable).where(eq(campsTable.id, campIdNum));
    if (!camp) { res.status(404).json({ error: "Camp not found" }); return; }
    if (!isEventActive(camp)) {
      const win = getEventWindow(camp);
      const notYetActive = win ? new Date() < win.windowStart : true;
      res.status(403).json({
        error: "Event is not currently active",
        notYetActive,
        windowStart: win?.windowStart.toISOString() ?? null,
      });
      return;
    }

    const eventInfo = { type: "camp_day", id: dayId, campId: camp.id, name: camp.name, date: day.date };

    const [existingCI] = await db.select().from(checkInsTable).where(and(
      eq(checkInsTable.entityType, "camp_day"),
      eq(checkInsTable.entityId, dayId),
      eq(checkInsTable.userId, player.id),
      sql`${checkInsTable.voidedAt} IS NULL`,
    ));
    if (existingCI) {
      res.json({ status: "confirmed", player: playerInfo, event: eventInfo, checkedInAt: existingCI.checkedInAt });
      return;
    }

    const [reg] = await db.select().from(campRegistrationsTable).where(and(
      eq(campRegistrationsTable.campId, camp.id),
      eq(campRegistrationsTable.playerUserId, player.id),
      sql`${campRegistrationsTable.status} != 'cancelled'`,
    ));

    if (reg) {
      // Payment gate: if registration is unpaid (walk-up pending payment), do NOT check in yet
      if (reg.paymentStatus === "unpaid") {
        res.json({
          status: "registered_pending_payment",
          player: playerInfo,
          event: eventInfo,
          registrationId: reg.id,
          message: "Registration exists but payment not yet collected. Confirm payment to complete check-in.",
        });
        return;
      }
      const [ci] = await db.insert(checkInsTable).values({
        entityType: "camp_day", entityId: dayId, userId: player.id,
        method: "qr", qrCodeScanned: qrCode, isManual: false, checkedInAt: new Date(),
      } as any).returning();
      res.json({ status: "checked_in", player: playerInfo, event: eventInfo, checkedInAt: ci.checkedInAt });
      return;
    }

    // Not registered — check capacity
    const participantsRegistered = camp.participantsRegistered ?? 0;
    const maxParticipants = camp.maxParticipants ?? 20;

    if (!camp.registrationOpen || participantsRegistered >= maxParticipants) {
      res.json({
        status: "at_capacity",
        message: camp.registrationOpen
          ? `Camp is full (${participantsRegistered}/${maxParticipants})`
          : "Camp registration is closed",
        player: playerInfo, event: eventInfo,
      });
      return;
    }

    const campAgeGroups: string[] = Array.isArray(camp.ageGroup) ? camp.ageGroup : camp.ageGroup ? [String(camp.ageGroup)] : [];
    const isYouth = campAgeGroups.some((ag: string) => ag !== "adult");
    let guardianRequired = false;
    let hasLinkedGuardian = false;
    if (isYouth) {
      guardianRequired = true;
      const [guardianLink] = await db.select().from(guardiansTable).where(and(
        eq(guardiansTable.youthUserId, player.id),
        eq(guardiansTable.status, "approved" as any),
      ));
      hasLinkedGuardian = !!guardianLink;
    }

    res.json({
      status: "walk_up_available", player: playerInfo,
      event: {
        ...eventInfo,
        price: Number(camp.price),
        spotsLeft: maxParticipants - participantsRegistered,
        isYouthCamp: isYouth,
        guardianRequired,
        hasLinkedGuardian,
      },
    });
    return;
  }

  // ─── League fixture ───────────────────────────────────────────────────────
  if (sessionType === "league_fixture") {
    const fixtureId = Number(sessionId);
    const [fixture] = await db.select().from(fixturesTable).where(eq(fixturesTable.id, fixtureId));
    if (!fixture) { res.status(404).json({ error: "Fixture not found" }); return; }
    if (!isEventActive({ startsAt: fixture.scheduledAt, durationMinutes: fixture.durationMinutes } as any)) {
      const eventObj = { startsAt: fixture.scheduledAt, durationMinutes: fixture.durationMinutes };
      const win = getEventWindow(eventObj as any);
      const notYetActive = win ? new Date() < win.windowStart : true;
      res.status(403).json({
        error: "Event is not currently active",
        notYetActive,
        windowStart: win?.windowStart.toISOString() ?? null,
      });
      return;
    }

    const homeTeam = fixture.homeTeamId
      ? (await db.select().from(teamsTable).where(eq(teamsTable.id, fixture.homeTeamId)))[0] ?? null
      : null;
    const awayTeam = fixture.awayTeamId
      ? (await db.select().from(teamsTable).where(eq(teamsTable.id, fixture.awayTeamId)))[0] ?? null
      : null;

    const eventInfo = {
      type: "league_fixture", id: fixtureId,
      name: [homeTeam?.name, awayTeam?.name].filter(Boolean).join(" vs ") || `Fixture #${fixtureId}`,
      homeTeam: homeTeam?.name ?? null,
      awayTeam: awayTeam?.name ?? null,
    };

    const [existingCI] = await db.select().from(checkInsTable).where(and(
      eq(checkInsTable.entityType, "fixture"),
      eq(checkInsTable.entityId, fixtureId),
      eq(checkInsTable.userId, player.id),
      sql`${checkInsTable.voidedAt} IS NULL`,
    ));
    if (existingCI) {
      res.json({ status: "confirmed", player: playerInfo, event: eventInfo, checkedInAt: existingCI.checkedInAt });
      return;
    }

    const teamIds = [fixture.homeTeamId, fixture.awayTeamId].filter((id): id is number => id != null);
    let onRoster = false;
    let playerTeam: string | null = null;

    // Prefer the frozen game card roster snapshot when available for league fixtures
    type RosterEntry = { dbUserId: number; userId: string; jerseyNumber?: string | null; firstName?: string | null; lastName?: string | null };
    let matchedRosterEntry: RosterEntry | null = null;
    const [gameCard] = await db.select().from(gameCardsTable).where(eq(gameCardsTable.fixtureId, fixtureId));
    if (gameCard) {
      const homeRoster: RosterEntry[] = (() => { try { return JSON.parse(gameCard.homeRoster || "[]"); } catch { return []; } })();
      const awayRoster: RosterEntry[] = (() => { try { return JSON.parse(gameCard.awayRoster || "[]"); } catch { return []; } })();
      const homeMatch = homeRoster.find((r) => r.dbUserId === player.id || r.userId === player.clerkId);
      const awayMatch = awayRoster.find((r) => r.dbUserId === player.id || r.userId === player.clerkId);
      if (homeMatch) {
        onRoster = true;
        playerTeam = homeTeam?.name ?? "Home";
        matchedRosterEntry = homeMatch;
      } else if (awayMatch) {
        onRoster = true;
        playerTeam = awayTeam?.name ?? "Away";
        matchedRosterEntry = awayMatch;
      }
    } else {
      for (const teamId of teamIds) {
        const members = await db.select().from(teamMembersTable)
          .where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.status, "active")));
        if (members.some(m => m.userId === player.clerkId)) {
          onRoster = true;
          playerTeam = teamId === fixture.homeTeamId ? homeTeam?.name ?? "Home" : awayTeam?.name ?? "Away";
          break;
        }
      }
    }

    if (onRoster) {
      let paymentWarning: string | null = null;
      const leagueId = fixture.entityId;
      if (leagueId && teamIds.length > 0) {
        for (const teamId of teamIds) {
          const [reg] = await db.select().from(leagueRegistrationsTable).where(and(
            eq(leagueRegistrationsTable.leagueId, leagueId),
            eq(leagueRegistrationsTable.teamId, teamId),
          ));
          if (reg && reg.paymentStatus !== "paid" && reg.paymentStatus !== "waived") {
            paymentWarning = `Team payment status: ${reg.paymentStatus}`;
          }
        }
      }

      const [ci] = await db.insert(checkInsTable).values({
        entityType: "fixture", entityId: fixtureId, userId: player.id,
        method: "qr", qrCodeScanned: qrCode, isManual: false, checkedInAt: new Date(),
      } as any).returning();

      res.json({
        status: "checked_in",
        player: {
          ...playerInfo,
          jerseyNumber: matchedRosterEntry?.jerseyNumber ?? null,
        },
        event: { ...eventInfo, team: playerTeam },
        checkedInAt: ci.checkedInAt,
        paymentWarning,
      });
      return;
    }

    // Not on roster — check if registered to any team in this league
    const leagueId = fixture.entityId;
    let hasLeagueReg = false;
    let leagueTeamName: string | null = null;
    if (leagueId) {
      const leagueTeams = await db.select().from(teamsTable).where(eq(teamsTable.leagueId, leagueId));
      for (const team of leagueTeams) {
        const members = await db.select().from(teamMembersTable)
          .where(and(eq(teamMembersTable.teamId, team.id), eq(teamMembersTable.status, "active")));
        if (members.some(m => m.userId === player.clerkId)) {
          hasLeagueReg = true;
          leagueTeamName = team.name;
          break;
        }
      }
    }

    res.json({
      status: "league_walk_up",
      message: hasLeagueReg
        ? `Player is on ${leagueTeamName ?? "a team"} in this league but not assigned to this game's roster`
        : "Player is not registered in this league",
      hasLeagueReg,
      leagueTeamName,
      player: playerInfo,
      event: eventInfo,
    });
    return;
  }

  res.status(400).json({ error: `Unknown sessionType: ${sessionType}` });
});

// ─── POST /scanner/dropin/:id/walk-up ─────────────────────────────────────────
// Admin/staff: create a spot for the scanned player and check them in atomically.
// This avoids the RSVP endpoint which always reserves for the authenticated user.

router.post("/scanner/dropin/:id/walk-up", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const dropinId = Number(req.params.id);
  const { playerId, poolId } = req.body;

  if (!playerId || !poolId) {
    res.status(400).json({ error: "playerId and poolId are required" });
    return;
  }

  const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!dbUser) { res.status(401).json({ error: "User not found" }); return; }

  const accessCheck = await canScanSession(dbUser, "dropin", dropinId);
  if (!accessCheck.allowed) {
    res.status(403).json({ error: accessCheck.reason ?? "Not authorized" });
    return;
  }

  const [dropin] = await db.select().from(dropinsTable).where(eq(dropinsTable.id, dropinId));
  if (!dropin) { res.status(404).json({ error: "Drop-in not found" }); return; }
  if (dropin.status === "completed" || dropin.status === "cancelled") {
    res.status(409).json({ error: "Session has already ended — walk-up registration is no longer available" }); return;
  }
  if (!dropin.registrationOpen) {
    res.status(409).json({ error: "Registration is closed for this session" });
    return;
  }

  const [player] = await db.select().from(usersTable).where(eq(usersTable.id, Number(playerId)));
  if (!player) { res.status(404).json({ error: "Player not found" }); return; }

  // Idempotency: player already has a reserved spot
  const [existingSpot] = await db.select().from(spotsTable).where(and(
    eq(spotsTable.poolId, Number(poolId)),
    eq(spotsTable.userId, player.id),
    eq(spotsTable.entityType, "dropin"),
    eq(spotsTable.entityId, dropinId),
    eq(spotsTable.status, "reserved"),
    eq(spotsTable.waitlisted, false),
  ));
  if (existingSpot) {
    const [existingCI] = await db.select().from(checkInsTable).where(and(
      eq(checkInsTable.entityType, "dropin"),
      eq(checkInsTable.entityId, dropinId),
      eq(checkInsTable.userId, player.id),
    ));
    if (existingCI) {
      res.json({ status: "already_checked_in", checkedInAt: existingCI.checkedInAt });
      return;
    }
    // Spot exists but not yet checked in — await payment confirmation
    res.json({
      status: "registered_pending_payment",
      spotId: existingSpot.id,
      player: { id: player.id, firstName: player.firstName, lastName: player.lastName },
    });
    return;
  }

  // Validate pool belongs to this dropin (outside transaction — read-only)
  const [pool] = await db.select().from(dropinCourtPoolsTable).where(eq(dropinCourtPoolsTable.id, Number(poolId)));
  if (!pool || pool.dropinId !== dropinId) {
    res.status(404).json({ error: "Pool not found for this session" });
    return;
  }
  const allPools = await db.select().from(dropinCourtPoolsTable).where(eq(dropinCourtPoolsTable.dropinId, dropinId));
  const allPoolIds = allPools.map(p => p.id);

  // Transactional capacity check + spot creation (NO check-in yet — payment must be confirmed first).
  // FOR UPDATE on the dropin row serializes concurrent walk-ups.
  let txResult: { error?: string; spotId?: number };
  try {
    txResult = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM "dropins" WHERE id = ${dropinId} FOR UPDATE`);

      const [countRow] = await tx.select({ count: sql<number>`count(*)` })
        .from(spotsTable)
        .where(and(
          inArray(spotsTable.poolId, allPoolIds),
          eq(spotsTable.status, "reserved"),
          eq(spotsTable.waitlisted, false),
        ));
      const spotsTaken = Number(countRow?.count ?? 0);
      const maxPlayers = dropin.maxPlayers ?? 15;
      if (spotsTaken >= maxPlayers) {
        return { error: `Session is now full (${spotsTaken}/${maxPlayers})` };
      }

      const [spot] = await tx.insert(spotsTable).values({
        entityType: "dropin",
        entityId: dropinId,
        poolId: Number(poolId),
        userId: player.id,
        status: "reserved",
        paymentStatus: "unpaid",
        waitlisted: false,
        confirmedAt: new Date(),
      } as any).returning();

      return { spotId: spot.id };
    });
  } catch (err: any) {
    res.status(500).json({ error: "Walk-up failed: " + (err.message ?? "unknown error") });
    return;
  }

  if (txResult.error) {
    res.status(409).json({ error: txResult.error });
    return;
  }

  // Spot reserved — staff must confirm payment before check-in completes
  res.status(201).json({
    status: "registered_pending_payment",
    spotId: txResult.spotId,
    player: { id: player.id, firstName: player.firstName, lastName: player.lastName },
    message: "Spot reserved. Collect payment then confirm to complete check-in.",
  });
});

// ─── POST /scanner/camp/:campId/day/:dayId/walk-up ────────────────────────────
// Admin/staff/assigned-coach: create a walk-up registration + check-in atomically.

router.post("/scanner/camp/:campId/day/:dayId/walk-up", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const campId = Number(req.params.campId);
  const dayId = Number(req.params.dayId);
  // guardianPresent: explicit staff confirmation that guardian is physically present
  // (required for youth camps when player has no approved guardian link)
  const { playerId, guardianPresent } = req.body;

  if (!playerId) {
    res.status(400).json({ error: "playerId is required" });
    return;
  }

  const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!dbUser) { res.status(401).json({ error: "User not found" }); return; }

  const accessCheck = await canScanSession(dbUser, "camp_day", dayId, campId);
  if (!accessCheck.allowed) {
    res.status(403).json({ error: accessCheck.reason ?? "Not authorized" });
    return;
  }

  const [camp] = await db.select().from(campsTable).where(eq(campsTable.id, campId));
  if (!camp) { res.status(404).json({ error: "Camp not found" }); return; }

  const [day] = await db.select().from(campDaysTable).where(and(
    eq(campDaysTable.id, dayId),
    eq(campDaysTable.campId, campId),
  ));
  if (!day) { res.status(404).json({ error: "Camp day not found" }); return; }

  const [player] = await db.select().from(usersTable).where(eq(usersTable.id, Number(playerId)));
  if (!player) { res.status(404).json({ error: "Player not found" }); return; }

  // ── Youth camp guardian enforcement ──────────────────────────────────────────
  // Youth camps (ageGroup !== 'adult') require an approved guardian link OR
  // explicit staff confirmation that the guardian is physically present (guardianPresent=true).
  const isYouthCamp = camp.ageGroup !== "adult";
  if (isYouthCamp) {
    const [approvedGuardian] = await db.select().from(guardiansTable).where(and(
      eq(guardiansTable.youthUserId, player.id),
      eq(guardiansTable.status, "approved"),
    ));
    if (!approvedGuardian && !guardianPresent) {
      res.status(422).json({
        error: "Youth camp walk-up requires an approved guardian link or guardian physically present",
        requiresGuardianConfirmation: true,
      });
      return;
    }
  }

  // Check for existing registration (idempotency — outside transaction since it's a read)
  const [existingReg] = await db.select().from(campRegistrationsTable).where(and(
    eq(campRegistrationsTable.campId, campId),
    eq(campRegistrationsTable.playerUserId, player.id),
    sql`${campRegistrationsTable.status} != 'cancelled'`,
  ));

  let regId: number;
  let wasWalkUp = false;

  if (existingReg) {
    regId = existingReg.id;
  } else {
    // Transactional capacity check + registration (NO check-in yet — payment must be confirmed first).
    // FOR UPDATE on the camps row serializes concurrent walk-ups.
    let txResult: { error?: string; regId?: number };
    try {
      txResult = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM "camps" WHERE id = ${campId} FOR UPDATE`);

        const [locked] = await tx.select().from(campsTable).where(eq(campsTable.id, campId));
        const participantsRegistered = locked?.participantsRegistered ?? 0;
        const maxParticipants = locked?.maxParticipants ?? 20;
        if (!locked?.registrationOpen || participantsRegistered >= maxParticipants) {
          return {
            error: locked?.registrationOpen
              ? `Camp is at capacity (${participantsRegistered}/${maxParticipants})`
              : "Camp registration is closed",
          };
        }

        const [newReg] = await tx.insert(campRegistrationsTable).values({
          campId,
          userId: dbUser.id,
          playerUserId: player.id,
          status: "confirmed",
          paymentStatus: "unpaid",
          notes: guardianPresent
            ? "Walk-up registration via QR scanner (guardian present, confirmed by staff)"
            : "Walk-up registration via QR scanner",
        } as any).returning();

        await tx.update(campsTable)
          .set({ participantsRegistered: (participantsRegistered + 1) as any })
          .where(eq(campsTable.id, campId));

        return { regId: newReg.id };
      });
    } catch (err: any) {
      res.status(500).json({ error: "Walk-up failed: " + (err.message ?? "unknown error") });
      return;
    }

    if (txResult.error) {
      res.status(409).json({ error: txResult.error });
      return;
    }
    regId = txResult.regId!;
    wasWalkUp = true;
  }

  // Idempotency: if already checked in for this day, return early
  const [existingCI] = await db.select().from(checkInsTable).where(and(
    eq(checkInsTable.entityType, "camp_day"),
    eq(checkInsTable.entityId, dayId),
    eq(checkInsTable.userId, player.id),
  ));
  if (existingCI) {
    res.json({
      status: "already_checked_in",
      checkedInAt: existingCI.checkedInAt,
      player: { id: player.id, firstName: player.firstName, lastName: player.lastName },
      registrationId: regId,
    });
    return;
  }

  // Registration complete — staff must confirm payment before check-in completes
  res.status(201).json({
    status: "registered_pending_payment",
    registrationId: regId,
    campId,
    dayId,
    player: { id: player.id, firstName: player.firstName, lastName: player.lastName },
    walkUp: wasWalkUp,
    message: "Registration confirmed. Collect payment then confirm to complete check-in.",
  });
});

// ─── POST /scanner/dropin/:id/collect-payment ──────────────────────────────────
// Staff confirms cash payment received for a walk-up drop-in spot, completing check-in.

router.post("/scanner/dropin/:id/collect-payment", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const dropinId = Number(req.params.id);
  const { playerId } = req.body;

  if (!playerId) { res.status(400).json({ error: "playerId is required" }); return; }

  const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!dbUser) { res.status(401).json({ error: "User not found" }); return; }

  const accessCheck = await canScanSession(dbUser, "dropin", dropinId);
  if (!accessCheck.allowed) { res.status(403).json({ error: accessCheck.reason ?? "Not authorized" }); return; }

  const [dropinForPayment] = await db.select().from(dropinsTable).where(eq(dropinsTable.id, dropinId));
  if (!dropinForPayment) { res.status(404).json({ error: "Drop-in session not found" }); return; }
  if (dropinForPayment.status === "completed" || dropinForPayment.status === "cancelled") {
    res.status(409).json({ error: "Session has already ended — payment collection is no longer available" }); return;
  }

  const [player] = await db.select().from(usersTable).where(eq(usersTable.id, Number(playerId)));
  if (!player) { res.status(404).json({ error: "Player not found" }); return; }

  const [spot] = await db.select().from(spotsTable).where(and(
    eq(spotsTable.entityType, "dropin"),
    eq(spotsTable.entityId, dropinId),
    eq(spotsTable.userId, player.id),
    eq(spotsTable.status, "reserved"),
    eq(spotsTable.waitlisted, false),
  ));
  if (!spot) { res.status(404).json({ error: "No walk-up spot found for this player" }); return; }

  // Idempotency
  const [existingCI] = await db.select().from(checkInsTable).where(and(
    eq(checkInsTable.entityType, "dropin"),
    eq(checkInsTable.entityId, dropinId),
    eq(checkInsTable.userId, player.id),
  ));
  if (existingCI) {
    res.json({ status: "already_checked_in", checkedInAt: existingCI.checkedInAt });
    return;
  }

  // Mark payment collected + check in within a transaction
  await db.transaction(async (tx) => {
    await tx.update(spotsTable)
      .set({ paymentStatus: "paid_external" } as any)
      .where(eq(spotsTable.id, spot.id));
    await tx.insert(checkInsTable).values({
      entityType: "dropin", entityId: dropinId, userId: player.id,
      method: "walk_in", isManual: true, checkedInAt: new Date(),
    } as any);
  });

  res.status(201).json({
    status: "checked_in",
    player: { id: player.id, firstName: player.firstName, lastName: player.lastName },
  });
});

// ─── POST /scanner/camp/:campId/day/:dayId/collect-payment ─────────────────────
// Staff confirms cash payment received for a walk-up camp registration, completing check-in.

router.post("/scanner/camp/:campId/day/:dayId/collect-payment", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const campId = Number(req.params.campId);
  const dayId = Number(req.params.dayId);
  const { playerId } = req.body;

  if (!playerId) { res.status(400).json({ error: "playerId is required" }); return; }

  const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!dbUser) { res.status(401).json({ error: "User not found" }); return; }

  const accessCheck = await canScanSession(dbUser, "camp_day", dayId, campId);
  if (!accessCheck.allowed) { res.status(403).json({ error: accessCheck.reason ?? "Not authorized" }); return; }

  const [player] = await db.select().from(usersTable).where(eq(usersTable.id, Number(playerId)));
  if (!player) { res.status(404).json({ error: "Player not found" }); return; }

  const [reg] = await db.select().from(campRegistrationsTable).where(and(
    eq(campRegistrationsTable.campId, campId),
    eq(campRegistrationsTable.playerUserId, player.id),
    sql`${campRegistrationsTable.status} != 'cancelled'`,
  ));
  if (!reg) { res.status(404).json({ error: "No walk-up registration found for this player" }); return; }

  // Idempotency
  const [existingCI] = await db.select().from(checkInsTable).where(and(
    eq(checkInsTable.entityType, "camp_day"),
    eq(checkInsTable.entityId, dayId),
    eq(checkInsTable.userId, player.id),
  ));
  if (existingCI) {
    res.json({ status: "already_checked_in", checkedInAt: existingCI.checkedInAt });
    return;
  }

  // Mark payment collected + check in within a transaction
  await db.transaction(async (tx) => {
    await tx.update(campRegistrationsTable)
      .set({ paymentStatus: "paid_external" } as any)
      .where(eq(campRegistrationsTable.id, reg.id));
    await tx.insert(checkInsTable).values({
      entityType: "camp_day", entityId: dayId, userId: player.id,
      method: "walk_in", isManual: true, checkedInAt: new Date(),
    } as any);
  });

  res.status(201).json({
    status: "checked_in",
    player: { id: player.id, firstName: player.firstName, lastName: player.lastName },
  });
});

// ─── GET /me/children-qr-today ────────────────────────────────────────────────
// Returns guardian's linked children with QR codes and today's events across
// all event types (camps, league fixtures, drop-ins).

router.get("/me/children-qr-today", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const [guardian] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!guardian) { res.status(401).json({ error: "User not found" }); return; }

  const links = await db.select({
    id: guardiansTable.id,
    youthUserId: guardiansTable.youthUserId,
    relationship: guardiansTable.relationship,
    isPrimary: guardiansTable.isPrimary,
    youthFirstName: usersTable.firstName,
    youthLastName: usersTable.lastName,
    youthQrCode: usersTable.qrCode,
    youthPlayonId: usersTable.playonId,
  })
    .from(guardiansTable)
    .leftJoin(usersTable, eq(guardiansTable.youthUserId, usersTable.id))
    .where(and(
      eq(guardiansTable.guardianUserId, guardian.id),
      eq(guardiansTable.status, "approved" as any),
    ));

  if (links.length === 0) {
    res.json({ children: [] });
    return;
  }

  const { start, end } = todayRange();
  const todayStr = todayDateStr();

  const children = await Promise.all(links.map(async link => {
    const youthId = link.youthUserId!;
    const todayEvents: any[] = [];

    // ── Camp events spanning today ──────────────────────────────────────────
    const campRegs = await db.select({ campReg: campRegistrationsTable, camp: campsTable })
      .from(campRegistrationsTable)
      .innerJoin(campsTable, eq(campRegistrationsTable.campId, campsTable.id))
      .where(and(
        eq(campRegistrationsTable.playerUserId, youthId),
        sql`${campRegistrationsTable.status} != 'cancelled'`,
      ));

    for (const { camp } of campRegs) {
      if (!camp.startDate || !camp.endDate) continue;
      const campStart = new Date(camp.startDate + "T00:00:00");
      const campEnd = new Date(camp.endDate + "T23:59:59");
      if (campStart <= end && campEnd >= start) {
        const [day] = await db.select().from(campDaysTable)
          .where(and(eq(campDaysTable.campId, camp.id), eq(campDaysTable.date, todayStr)));
        const [ci] = day
          ? await db.select().from(checkInsTable).where(and(
              eq(checkInsTable.entityType, "camp_day"),
              eq(checkInsTable.entityId, day.id),
              eq(checkInsTable.userId, youthId),
            ))
          : [];
        todayEvents.push({
          type: "camp", id: camp.id, name: camp.name,
          dayId: day?.id ?? null, date: todayStr,
          startTime: day?.startTime ?? null,
          checkedIn: !!ci,
        });
      }
    }

    // ── League fixture events today ─────────────────────────────────────────
    // Look up youth clerkId once (teamMembersTable uses clerkId as userId)
    const [youthUser] = await db.select({ clerkId: usersTable.clerkId }).from(usersTable).where(eq(usersTable.id, youthId));
    const youthClerkId = youthUser?.clerkId;

    if (youthClerkId) {
      const youthMemberships = await db.select({ teamId: teamMembersTable.teamId }).from(teamMembersTable)
        .where(and(eq(teamMembersTable.userId, youthClerkId), eq(teamMembersTable.status, "active")));
      const youthTeamIds = youthMemberships.map(m => m.teamId);

      if (youthTeamIds.length > 0) {
        const todayFixtures = await db.select().from(fixturesTable)
          .where(and(
            sql`${fixturesTable.scheduledAt} >= ${start}`,
            sql`${fixturesTable.scheduledAt} <= ${end}`,
            or(
              inArray(fixturesTable.homeTeamId, youthTeamIds),
              inArray(fixturesTable.awayTeamId, youthTeamIds),
            ),
          ));

        for (const fx of todayFixtures) {
          const [ci] = await db.select().from(checkInsTable).where(and(
            eq(checkInsTable.entityType, "fixture"),
            eq(checkInsTable.entityId, fx.id),
            eq(checkInsTable.userId, youthId),
          ));

          const homeTeam = fx.homeTeamId
            ? (await db.select({ name: teamsTable.name }).from(teamsTable).where(eq(teamsTable.id, fx.homeTeamId)))[0]
            : null;
          const awayTeam = fx.awayTeamId
            ? (await db.select({ name: teamsTable.name }).from(teamsTable).where(eq(teamsTable.id, fx.awayTeamId)))[0]
            : null;

          todayEvents.push({
            type: "league_fixture", id: fx.id,
            name: [homeTeam?.name, awayTeam?.name].filter(Boolean).join(" vs ") || `Fixture #${fx.id}`,
            date: todayStr,
            startTime: fx.scheduledAt ? new Date(fx.scheduledAt).toTimeString().slice(0, 5) : null,
            checkedIn: !!ci,
          });
        }
      }
    }

    // ── Drop-in spots today ─────────────────────────────────────────────────
    const pools = await db.select({ pool: dropinCourtPoolsTable, dropin: dropinsTable })
      .from(dropinCourtPoolsTable)
      .innerJoin(dropinsTable, eq(dropinCourtPoolsTable.dropinId, dropinsTable.id))
      .where(and(
        sql`${dropinsTable.startsAt} >= ${start}`,
        sql`${dropinsTable.startsAt} <= ${end}`,
      ));

    if (pools.length > 0) {
      const allPoolIds = pools.map(p => p.pool.id);
      const youthSpots = await db.select().from(spotsTable).where(and(
        inArray(spotsTable.poolId, allPoolIds),
        eq(spotsTable.userId, youthId),
        eq(spotsTable.entityType, "dropin"),
        eq(spotsTable.status, "reserved"),
        eq(spotsTable.waitlisted, false),
      ));

      for (const spot of youthSpots) {
        const pool = pools.find(p => p.pool.id === spot.poolId);
        if (!pool) continue;
        const [ci] = await db.select().from(checkInsTable).where(and(
          eq(checkInsTable.entityType, "dropin"),
          eq(checkInsTable.entityId, pool.dropin.id),
          eq(checkInsTable.userId, youthId),
        ));
        todayEvents.push({
          type: "dropin", id: pool.dropin.id, name: pool.dropin.name,
          date: todayStr,
          startTime: pool.dropin.startsAt ? new Date(pool.dropin.startsAt).toTimeString().slice(0, 5) : null,
          checkedIn: !!ci,
        });
      }
    }

    // Remove duplicates (same event id+type)
    const seen = new Set<string>();
    const uniqueEvents = todayEvents.filter(ev => {
      const key = `${ev.type}:${ev.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort events: not-checked-in first (need attention), then by start time
    uniqueEvents.sort((a, b) => {
      if (a.checkedIn !== b.checkedIn) return a.checkedIn ? 1 : -1;
      if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime);
      return 0;
    });

    // Get player QR (profile QR takes precedence over users table QR)
    const [profile] = await db.select().from(playerProfilesTable).where(eq(playerProfilesTable.userId, youthId));
    const qrCode = profile?.qrCode ?? link.youthQrCode;

    return {
      youthUserId: youthId,
      firstName: link.youthFirstName,
      lastName: link.youthLastName,
      relationship: link.relationship,
      isPrimary: link.isPrimary,
      qrCode,
      playonId: link.youthPlayonId,
      todayEvents: uniqueEvents,
      hasEventsToday: uniqueEvents.length > 0,
    };
  }));

  // Children with events today bubble to top, then alphabetically
  children.sort((a, b) => {
    if (a.hasEventsToday !== b.hasEventsToday) return a.hasEventsToday ? -1 : 1;
    return (a.firstName ?? "").localeCompare(b.firstName ?? "");
  });

  res.json({ children });
});

// ─── POST /scanner/league/fixture/:fixtureId/walk-up-override ─────────────────
// Admin/staff/assigned-ref: manually verify and check in a player who is not on
// the game roster. Records the override reason for audit purposes.
// Used when a player is league-registered but not on the specific game roster,
// or when staff have verbally confirmed eligibility.

router.post("/scanner/league/fixture/:fixtureId/walk-up-override", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const fixtureId = Number(req.params.fixtureId);
  const { playerId, reason } = req.body;

  if (!playerId) {
    res.status(400).json({ error: "playerId is required" });
    return;
  }

  const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!dbUser) { res.status(401).json({ error: "User not found" }); return; }

  const accessCheck = await canScanSession(dbUser, "league_fixture", fixtureId);
  if (!accessCheck.allowed) {
    res.status(403).json({ error: accessCheck.reason ?? "Not authorized" });
    return;
  }

  const [fixture] = await db.select().from(fixturesTable).where(eq(fixturesTable.id, fixtureId));
  if (!fixture) { res.status(404).json({ error: "Fixture not found" }); return; }

  const [player] = await db.select().from(usersTable).where(eq(usersTable.id, Number(playerId)));
  if (!player) { res.status(404).json({ error: "Player not found" }); return; }

  // ── Server-side league registration enforcement ───────────────────────────────
  // Player must have an active membership in a team registered to this league.
  // This mirrors the qr-scan hasLeagueReg check and cannot be bypassed via direct API calls.
  const leagueId = fixture.entityId;
  if (!leagueId) {
    res.status(422).json({ error: "Fixture is not associated with a league. Override check-in is not permitted." });
    return;
  }
  const leagueTeams = await db.select().from(teamsTable).where(eq(teamsTable.leagueId, leagueId));
  let hasLeagueReg = false;
  for (const team of leagueTeams) {
    const members = await db.select().from(teamMembersTable)
      .where(and(eq(teamMembersTable.teamId, team.id), eq(teamMembersTable.status, "active")));
    if (members.some(m => m.userId === player.clerkId)) {
      hasLeagueReg = true;
      break;
    }
  }
  if (!hasLeagueReg) {
    res.status(403).json({
      error: "Override check-in requires an active league registration. The player must register for this league before they can be checked in.",
      hasLeagueReg: false,
    });
    return;
  }

  // Idempotency — already checked in
  const [existingCI] = await db.select().from(checkInsTable).where(and(
    eq(checkInsTable.entityType, "fixture"),
    eq(checkInsTable.entityId, fixtureId),
    eq(checkInsTable.userId, player.id),
  ));
  if (existingCI) {
    res.json({
      status: "already_checked_in",
      checkedInAt: existingCI.checkedInAt,
      player: { id: player.id, firstName: player.firstName, lastName: player.lastName },
    });
    return;
  }

  // Create check-in with walk-up override method and reason in notes
  const [ci] = await db.insert(checkInsTable).values({
    entityType: "fixture",
    entityId: fixtureId,
    userId: player.id,
    method: "walk_in",
    isManual: true,
    notes: reason ? `Walk-up override: ${reason}` : "Walk-up override by staff",
    checkedInAt: new Date(),
  } as any).returning();

  res.status(201).json({
    status: "checked_in",
    checkedInAt: ci.checkedInAt,
    overrideBy: dbUser.id,
    reason: reason ?? null,
    player: { id: player.id, firstName: player.firstName, lastName: player.lastName },
  });
});

// ─── GET /checkin/my-active ────────────────────────────────────────────────────
// Returns currently-active check-ins for the authenticated user.
// An active check-in is one whose event end time is still in the future.
// Query: ?familyMode=true also includes check-ins for linked children.

router.get("/checkin/my-active", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const familyMode = req.query.familyMode === "true";

  const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!dbUser) { res.status(401).json({ error: "User not found" }); return; }

  const now = new Date();

  function computeEndsAt(entityType: string, entity: any): Date | null {
    if (entityType === "dropin") {
      if (!entity.startsAt) return null;
      const d = new Date(entity.startsAt);
      d.setMinutes(d.getMinutes() + (entity.durationMinutes ?? 120));
      return d;
    }
    if (entityType === "fixture" || entityType === "tournament" || entityType === "tournament_event") {
      if (!entity.scheduledAt) return null;
      const d = new Date(entity.scheduledAt);
      d.setMinutes(d.getMinutes() + (entity.durationMinutes ?? 60));
      return d;
    }
    if (entityType === "camp_day") {
      if (!entity.date || !entity.endTime) return null;
      return new Date(`${entity.date}T${entity.endTime}:00`);
    }
    return null;
  }

  async function activeCheckInsForUser(userId: number, childName?: string): Promise<any[]> {
    const checkIns = await db.select().from(checkInsTable).where(
      and(eq(checkInsTable.userId, userId), sql`${checkInsTable.voidedAt} IS NULL`),
    );
    const results: any[] = [];

    for (const ci of checkIns) {
      let eventName: string | null = null;
      let eventType: string | null = null;
      let endsAt: Date | null = null;

      if (ci.entityType === "dropin") {
        const [dropin] = await db.select().from(dropinsTable).where(eq(dropinsTable.id, ci.entityId));
        if (!dropin) continue;
        eventName = dropin.name;
        eventType = "drop-in";
        endsAt = computeEndsAt("dropin", dropin);
      } else if (ci.entityType === "fixture") {
        const [fixture] = await db.select().from(fixturesTable).where(eq(fixturesTable.id, ci.entityId));
        if (!fixture) continue;
        const homeTeam = fixture.homeTeamId
          ? (await db.select({ name: teamsTable.name }).from(teamsTable).where(eq(teamsTable.id, fixture.homeTeamId)))[0] ?? null
          : null;
        const awayTeam = fixture.awayTeamId
          ? (await db.select({ name: teamsTable.name }).from(teamsTable).where(eq(teamsTable.id, fixture.awayTeamId)))[0] ?? null
          : null;
        eventName = [homeTeam?.name, awayTeam?.name].filter(Boolean).join(" vs ") || `Fixture #${fixture.id}`;
        eventType = "league game";
        endsAt = computeEndsAt("fixture", fixture);
      } else if (ci.entityType === "camp_day") {
        const [day] = await db.select().from(campDaysTable).where(eq(campDaysTable.id, ci.entityId));
        if (!day) continue;
        const [camp] = await db.select().from(campsTable).where(eq(campsTable.id, day.campId));
        if (!camp) continue;
        eventName = camp.name;
        eventType = "camp";
        endsAt = computeEndsAt("camp_day", day);
      } else if (ci.entityType === "tournament" || ci.entityType === "tournament_event") {
        const [fixture] = await db.select().from(fixturesTable).where(eq(fixturesTable.id, ci.entityId));
        if (!fixture) continue;
        const homeTeam = fixture.homeTeamId
          ? (await db.select({ name: teamsTable.name }).from(teamsTable).where(eq(teamsTable.id, fixture.homeTeamId)))[0] ?? null
          : null;
        const awayTeam = fixture.awayTeamId
          ? (await db.select({ name: teamsTable.name }).from(teamsTable).where(eq(teamsTable.id, fixture.awayTeamId)))[0] ?? null
          : null;
        eventName = [homeTeam?.name, awayTeam?.name].filter(Boolean).join(" vs ") || `Fixture #${fixture.id}`;
        eventType = "tournament";
        endsAt = computeEndsAt("fixture", fixture);
      } else {
        continue;
      }

      if (endsAt && endsAt <= now) continue;

      results.push({
        entityType: ci.entityType,
        entityId: ci.entityId,
        eventName,
        eventType,
        checkedInAt: ci.checkedInAt,
        endsAt: endsAt?.toISOString() ?? null,
        ...(childName !== undefined ? { childName } : {}),
      });
    }
    return results;
  }

  const allCheckIns: any[] = await activeCheckInsForUser(dbUser.id);

  if (familyMode) {
    const children = await db.select().from(guardiansTable).where(
      and(eq(guardiansTable.guardianUserId, dbUser.id), eq(guardiansTable.status, "approved" as any))
    );
    for (const child of children) {
      const [childUser] = await db.select().from(usersTable).where(eq(usersTable.id, child.youthUserId));
      if (!childUser) continue;
      const childFullName = [childUser.firstName, childUser.lastName].filter(Boolean).join(" ") || "Child";
      const childCheckIns = await activeCheckInsForUser(child.youthUserId, childFullName);
      allCheckIns.push(...childCheckIns);
    }
  }

  res.json({ checkIns: allCheckIns });
});

// ─── DELETE /api/checkins/:id — soft-void a check-in ─────────────────────────
// Admin/staff only. For drop-ins: releases the spot back to available capacity.
// For league fixtures: blocked if game card is complete (super-admin can force).

router.delete("/checkins/:id", requireAuth, async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const checkInId = Number(req.params.id);
  const forceVoid = req.query.forceVoid === "true" || req.body?.forceVoid === true;

  if (!checkInId || isNaN(checkInId)) {
    res.status(400).json({ error: "Invalid check-in ID" });
    return;
  }

  const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!dbUser) { res.status(401).json({ error: "User not found" }); return; }

  const isAdmin = dbUser.role === "admin";
  // Super-admin: non-scoped admin (allowed to force-void completed game cards)
  const isSuperAdmin = isAdmin && (dbUser as any).adminLevel !== "scoped";

  // Fetch the check-in first so we can scope the permission check to its entityType
  const [ci] = await db.select().from(checkInsTable).where(eq(checkInsTable.id, checkInId));
  if (!ci) { res.status(404).json({ error: "Check-in not found" }); return; }

  // Entity-type-scoped permission check.
  // hasPermission automatically grants full (non-scoped) admins access to any key,
  // and checks canManage* flags for scoped admins and staff.
  // This ensures staff with only canManageCamps cannot void drop-in or league check-ins.
  const entityPermMap: Record<string, string> = {
    dropin: "canManageDropins",
    camp_day: "canManageCamps",
    fixture: "canManageLeagues",
    tournament: "canManageLeagues",
    tournament_event: "canManageLeagues",
  };
  const requiredPerm = entityPermMap[ci.entityType];
  const hasPerm = requiredPerm
    ? await hasPermission(authed.clerkUserId, requiredPerm as any)
    : false;
  if (!hasPerm) {
    res.status(403).json({ error: "Insufficient permissions to void this check-in type" });
    return;
  }

  if (ci.voidedAt) {
    res.status(409).json({ error: "Check-in is already voided" });
    return;
  }

  // ── League fixture: block if game card is complete ────────────────────────
  if (ci.entityType === "fixture") {
    const [gameCard] = await db.select().from(gameCardsTable).where(eq(gameCardsTable.fixtureId, ci.entityId));
    if (gameCard && gameCard.status === "completed") {
      if (!forceVoid) {
        res.status(409).json({
          error: "Cannot void a check-in for a completed game — the game card has already been finalised. Super-admins can override with forceVoid=true.",
          gameCardComplete: true,
        });
        return;
      }
      if (!isSuperAdmin) {
        res.status(403).json({
          error: "Overriding a completed game's check-in requires super-admin access.",
          gameCardComplete: true,
        });
        return;
      }
    }
  }

  // ── Perform void ──────────────────────────────────────────────────────────
  await db.transaction(async (tx) => {
    await tx.update(checkInsTable)
      .set({ voidedAt: new Date(), voidedByUserId: dbUser.id } as any)
      .where(eq(checkInsTable.id, checkInId));

    // Drop-in: release the spot back to available capacity.
    // Cancel all reserved, non-waitlisted spots for this user on this dropin,
    // regardless of poolId — covers both pooled and non-pooled (flat) drop-ins.
    if (ci.entityType === "dropin" && ci.userId) {
      await tx.update(spotsTable)
        .set({ status: "cancelled" } as any)
        .where(and(
          eq(spotsTable.userId, ci.userId),
          eq(spotsTable.entityType, "dropin"),
          eq(spotsTable.entityId, ci.entityId),
          eq(spotsTable.status, "reserved"),
          eq(spotsTable.waitlisted, false),
        ));
    }
  });

  res.json({
    ok: true,
    voidedAt: new Date().toISOString(),
    checkInId,
    entityType: ci.entityType,
    entityId: ci.entityId,
  });
});

export default router;
