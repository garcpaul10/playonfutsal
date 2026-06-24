import { Router, type IRouter } from "express";
import {
  db, dropinsTable, checkInsTable, usersTable, spotsTable,
  fixturesTable, teamsTable, teamMembersTable, leagueRegistrationsTable,
  campDaysTable, campsTable, campRegistrationsTable,
  tournamentsTable, tournamentRegistrationsTable,
} from "@workspace/db";
import { eq, and, inArray, asc, desc } from "drizzle-orm";
import { requirePermission } from "../middlewares/auth";

const router: IRouter = Router();

// ─── Helper ───────────────────────────────────────────────────────────────────

const METHOD_LABELS: Record<string, string> = {
  qr: "QR",
  camera: "Camera",
  manual: "Manual",
  walk_in: "Walk-in",
};
function methodLabel(m: string | null): string {
  return m ? (METHOD_LABELS[m] ?? m) : "—";
}

// ─── Dropin Attendance ────────────────────────────────────────────────────────

router.get("/dropins/:id/attendance", requirePermission("canManageDropins"), async (req, res): Promise<void> => {
  const dropinId = Number(req.params.id);

  const [dropin] = await db.select().from(dropinsTable).where(eq(dropinsTable.id, dropinId));
  if (!dropin) { res.status(404).json({ error: "Drop-in not found" }); return; }

  // Fetch reserved non-waitlisted spots (current active registrations)
  const spots = await db.select().from(spotsTable)
    .where(and(
      eq(spotsTable.entityType, "dropin"),
      eq(spotsTable.entityId, dropinId),
      eq(spotsTable.status, "reserved"),
      eq(spotsTable.waitlisted, false),
    ))
    .orderBy(asc(spotsTable.createdAt));

  // Also fetch voided check-ins — players whose spots were cancelled after void
  // need to appear in history even though they no longer have a reserved spot
  const allCheckIns = await db.select().from(checkInsTable)
    .where(and(eq(checkInsTable.entityType, "dropin"), eq(checkInsTable.entityId, dropinId)))
    .orderBy(desc(checkInsTable.checkedInAt));

  // Active = not voided; voided = has voidedAt
  const activeByUser = new Map<number, typeof allCheckIns[0]>();
  const voidedByUser = new Map<number, typeof allCheckIns[0]>();
  for (const ci of allCheckIns) {
    if (!ci.userId) continue;
    if (ci.voidedAt) {
      if (!voidedByUser.has(ci.userId)) voidedByUser.set(ci.userId, ci);
    } else {
      if (!activeByUser.has(ci.userId)) activeByUser.set(ci.userId, ci);
    }
  }

  // Build combined user set: reserved spot holders + voided-only players (spot cancelled)
  const reservedUserIds = new Set(spots.map(s => s.userId).filter(Boolean) as number[]);
  const voidedOnlyUserIds = [...voidedByUser.keys()].filter(uid => !reservedUserIds.has(uid) && !activeByUser.has(uid));
  const allUserIds = [...new Set([...reservedUserIds, ...voidedOnlyUserIds])];

  const users = allUserIds.length
    ? await db.select().from(usersTable).where(inArray(usersTable.id, allUserIds))
    : [];
  const userMap = new Map(users.map(u => [u.id, u]));

  // Fetch voider names
  const voiderIds = [...new Set([...voidedByUser.values()].map(c => c.voidedByUserId).filter(Boolean) as number[])];
  const voiders = voiderIds.length ? await db.select().from(usersTable).where(inArray(usersTable.id, voiderIds)) : [];
  const voiderMap = new Map(voiders.map(u => [u.id, u]));

  function buildAttendanceRow(userId: number, spotPaymentStatus: string | null, noShow: boolean) {
    const u = userMap.get(userId);
    const ci = activeByUser.get(userId);
    const voidedCi = voidedByUser.get(userId);
    const voider = voidedCi?.voidedByUserId ? voiderMap.get(voidedCi.voidedByUserId) : null;
    return {
      userId,
      firstName: u?.firstName ?? null,
      lastName: u?.lastName ?? null,
      email: u?.email ?? null,
      checkedIn: !!ci,
      checkedInAt: ci?.checkedInAt?.toISOString() ?? null,
      method: ci?.method ?? null,
      methodLabel: methodLabel(ci?.method ?? null),
      paymentStatus: spotPaymentStatus,
      noShow,
      voided: !ci && !!voidedCi,
      voidedAt: voidedCi?.voidedAt?.toISOString() ?? null,
      voidedByName: voider ? `${voider.firstName ?? ""} ${voider.lastName ?? ""}`.trim() || voider.email : null,
    };
  }

  // Rows from reserved spots (current registrations)
  const attendance = [
    ...spots.map(s => buildAttendanceRow(s.userId!, s.paymentStatus, s.noShow ?? false)),
    // Rows for voided-only players (no longer have a reserved spot)
    ...voidedOnlyUserIds.map(uid => buildAttendanceRow(uid, null, false)),
  ];

  const stats = {
    totalRegistered: spots.length,
    totalCheckedIn: attendance.filter(a => a.checkedIn).length,
    noShows: attendance.filter(a => a.noShow).length,
    unpaid: attendance.filter(a => a.paymentStatus === "unpaid").length,
  };

  res.json({
    session: {
      id: dropin.id,
      name: dropin.name,
      startsAt: dropin.startsAt,
      durationMinutes: dropin.durationMinutes,
      type: "dropin",
    },
    stats,
    attendance,
  });
});

// ─── League Fixture Attendance ─────────────────────────────────────────────────

router.get("/leagues/fixtures/:fixtureId/attendance", requirePermission("canManageLeagues"), async (req, res): Promise<void> => {
  const fixtureId = Number(req.params.fixtureId);

  const [fixture] = await db.select().from(fixturesTable).where(eq(fixturesTable.id, fixtureId));
  if (!fixture) { res.status(404).json({ error: "Fixture not found" }); return; }

  const teamIds = [fixture.homeTeamId, fixture.awayTeamId].filter(Boolean) as number[];
  const teams = teamIds.length
    ? await db.select().from(teamsTable).where(inArray(teamsTable.id, teamIds))
    : [];
  const teamMap = new Map(teams.map(t => [t.id, t]));

  // All active team members for both teams
  const members = teamIds.length
    ? await db.select().from(teamMembersTable)
        .where(and(inArray(teamMembersTable.teamId, teamIds), eq(teamMembersTable.status, "active")))
    : [];

  // Look up users by clerk ID (teamMembers.userId stores clerk IDs)
  const clerkIds = [...new Set(members.map(m => m.userId))];
  const usersArr = clerkIds.length
    ? await db.select().from(usersTable).where(inArray(usersTable.clerkId, clerkIds))
    : [];
  const userByClerk = new Map(usersArr.map(u => [u.clerkId, u]));
  const userById = new Map(usersArr.map(u => [u.id, u]));

  // Check-ins — all (active + voided) for history display
  const allFixtureCheckIns = await db.select().from(checkInsTable)
    .where(and(eq(checkInsTable.entityType, "fixture"), eq(checkInsTable.entityId, fixtureId)));

  const activeByUserF = new Map<number, typeof allFixtureCheckIns[0]>();
  const voidedByUserF = new Map<number, typeof allFixtureCheckIns[0]>();
  for (const ci of allFixtureCheckIns) {
    if (!ci.userId) continue;
    if (ci.voidedAt) { if (!voidedByUserF.has(ci.userId)) voidedByUserF.set(ci.userId, ci); }
    else { if (!activeByUserF.has(ci.userId)) activeByUserF.set(ci.userId, ci); }
  }

  const voiderIdsF = [...new Set([...voidedByUserF.values()].map(c => c.voidedByUserId).filter(Boolean) as number[])];
  const voidersF = voiderIdsF.length ? await db.select().from(usersTable).where(inArray(usersTable.id, voiderIdsF)) : [];
  const voiderMapF = new Map(voidersF.map(u => [u.id, u]));

  // League registration payment status per team (leagueId is fixture.entityId for league fixtures)
  const leagueRegs = fixture.entityId
    ? await db.select().from(leagueRegistrationsTable)
        .where(and(eq(leagueRegistrationsTable.leagueId, fixture.entityId), inArray(leagueRegistrationsTable.teamId, teamIds)))
    : [];
  const payByTeam = new Map(leagueRegs.map(r => [r.teamId!, r.paymentStatus]));

  const attendance = members.map(m => {
    const u = userByClerk.get(m.userId);
    const ci = u ? activeByUserF.get(u.id) : undefined;
    const voidedCi = u ? voidedByUserF.get(u.id) : undefined;
    const voider = voidedCi?.voidedByUserId ? voiderMapF.get(voidedCi.voidedByUserId) : null;
    const teamName = teamMap.get(m.teamId)?.name ?? null;
    const side = m.teamId === fixture.homeTeamId ? "home" : "away";
    return {
      userId: u?.id ?? null,
      firstName: u?.firstName ?? null,
      lastName: u?.lastName ?? null,
      email: u?.email ?? null,
      teamName,
      side,
      checkedIn: !!ci,
      checkedInAt: ci?.checkedInAt?.toISOString() ?? null,
      method: ci?.method ?? null,
      methodLabel: methodLabel(ci?.method ?? null),
      paymentStatus: payByTeam.get(m.teamId) ?? "unknown",
      noShow: false,
      voided: !ci && !!voidedCi,
      voidedAt: voidedCi?.voidedAt?.toISOString() ?? null,
      voidedByName: voider ? `${voider.firstName ?? ""} ${voider.lastName ?? ""}`.trim() || voider.email : null,
    };
  });

  const homeTeam = teamMap.get(fixture.homeTeamId!);
  const awayTeam = teamMap.get(fixture.awayTeamId!);

  res.json({
    session: {
      id: fixture.id,
      name: [homeTeam?.name, awayTeam?.name].filter(Boolean).join(" vs ") || `Fixture #${fixture.id}`,
      startsAt: fixture.scheduledAt,
      type: "league_fixture",
      homeTeam: homeTeam?.name ?? null,
      awayTeam: awayTeam?.name ?? null,
    },
    stats: {
      totalRegistered: members.length,
      totalCheckedIn: attendance.filter(a => a.checkedIn).length,
      noShows: members.length - attendance.filter(a => a.checkedIn).length,
      unpaid: [...payByTeam.values()].filter(v => v !== "paid" && v !== "waived").length,
    },
    attendance,
  });
});

// ─── Camp Day Attendance ──────────────────────────────────────────────────────

router.get("/camps/:campId/days/:dayId/attendance", requirePermission("canManageCamps"), async (req, res): Promise<void> => {
  const campId = Number(req.params.campId);
  const dayId = Number(req.params.dayId);

  const [camp] = await db.select().from(campsTable).where(eq(campsTable.id, campId));
  if (!camp) { res.status(404).json({ error: "Camp not found" }); return; }

  const [day] = await db.select().from(campDaysTable).where(eq(campDaysTable.id, dayId));
  if (!day) { res.status(404).json({ error: "Camp day not found" }); return; }

  // All confirmed registrations for the camp
  const regs = await db.select().from(campRegistrationsTable)
    .where(and(eq(campRegistrationsTable.campId, campId)))
    .orderBy(asc(campRegistrationsTable.createdAt));
  const activeRegs = regs.filter(r => r.status !== "cancelled");

  // Users
  const userIds = [...new Set([
    ...activeRegs.map(r => r.userId),
    ...activeRegs.map(r => r.playerUserId).filter(Boolean) as number[],
  ])];
  const users = userIds.length
    ? await db.select().from(usersTable).where(inArray(usersTable.id, userIds))
    : [];
  const userMap = new Map(users.map(u => [u.id, u]));

  // Check-ins for this camp day — all (active + voided) for history display
  const allCampCheckIns = await db.select().from(checkInsTable)
    .where(and(eq(checkInsTable.entityType, "camp_day"), eq(checkInsTable.entityId, dayId)));

  const activeByUserC = new Map<number, typeof allCampCheckIns[0]>();
  const voidedByUserC = new Map<number, typeof allCampCheckIns[0]>();
  for (const ci of allCampCheckIns) {
    if (!ci.userId) continue;
    if (ci.voidedAt) { if (!voidedByUserC.has(ci.userId)) voidedByUserC.set(ci.userId, ci); }
    else { if (!activeByUserC.has(ci.userId)) activeByUserC.set(ci.userId, ci); }
  }

  const voiderIdsC = [...new Set([...voidedByUserC.values()].map(c => c.voidedByUserId).filter(Boolean) as number[])];
  const voidersC = voiderIdsC.length ? await db.select().from(usersTable).where(inArray(usersTable.id, voiderIdsC)) : [];
  const voiderMapC = new Map(voidersC.map(u => [u.id, u]));

  const attendance = activeRegs.map(r => {
    const playerId = r.playerUserId ?? r.userId;
    const u = userMap.get(playerId);
    const ci = activeByUserC.get(playerId);
    const voidedCi = voidedByUserC.get(playerId);
    const voider = voidedCi?.voidedByUserId ? voiderMapC.get(voidedCi.voidedByUserId) : null;
    return {
      userId: playerId,
      firstName: u?.firstName ?? null,
      lastName: u?.lastName ?? null,
      email: u?.email ?? null,
      checkedIn: !!ci,
      checkedInAt: ci?.checkedInAt?.toISOString() ?? null,
      method: ci?.method ?? null,
      methodLabel: methodLabel(ci?.method ?? null),
      paymentStatus: r.paymentStatus,
      noShow: !ci,
      voided: !ci && !!voidedCi,
      voidedAt: voidedCi?.voidedAt?.toISOString() ?? null,
      voidedByName: voider ? `${voider.firstName ?? ""} ${voider.lastName ?? ""}`.trim() || voider.email : null,
    };
  });

  // Override noShow: only players who aren't checked in are no-shows after the session
  const checkedIn = attendance.filter(a => a.checkedIn);
  const notCheckedIn = attendance.filter(a => !a.checkedIn);

  res.json({
    session: {
      id: dayId,
      name: `${camp.name} — Day (${day.date})`,
      startsAt: `${day.date}T${day.startTime}`,
      type: "camp_day",
      campName: camp.name,
      date: day.date,
    },
    stats: {
      totalRegistered: activeRegs.length,
      totalCheckedIn: checkedIn.length,
      noShows: notCheckedIn.length,
      unpaid: attendance.filter(a => a.paymentStatus === "unpaid").length,
    },
    attendance,
  });
});

// ─── Tournament Fixture Attendance ─────────────────────────────────────────────

router.get("/tournaments/:id/fixtures/:fixtureId/attendance", requirePermission("canManageTournaments"), async (req, res): Promise<void> => {
  const tournamentId = Number(req.params.id);
  const fixtureId = Number(req.params.fixtureId);

  const [tournament] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, tournamentId));
  if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }

  const [fixture] = await db.select().from(fixturesTable).where(eq(fixturesTable.id, fixtureId));
  if (!fixture) { res.status(404).json({ error: "Fixture not found" }); return; }

  const teamIds = [fixture.homeTeamId, fixture.awayTeamId].filter(Boolean) as number[];
  const teams = teamIds.length
    ? await db.select().from(teamsTable).where(inArray(teamsTable.id, teamIds))
    : [];
  const teamMap = new Map(teams.map(t => [t.id, t]));

  // All team members
  const members = teamIds.length
    ? await db.select().from(teamMembersTable)
        .where(and(inArray(teamMembersTable.teamId, teamIds), eq(teamMembersTable.status, "active")))
    : [];

  const clerkIds = [...new Set(members.map(m => m.userId))];
  const usersArr = clerkIds.length
    ? await db.select().from(usersTable).where(inArray(usersTable.clerkId, clerkIds))
    : [];
  const userByClerk = new Map(usersArr.map(u => [u.clerkId, u]));

  // Check-ins — entityType="tournament", entityId=fixtureId
  const checkIns = await db.select().from(checkInsTable)
    .where(and(eq(checkInsTable.entityType, "tournament"), eq(checkInsTable.entityId, fixtureId)));
  const checkedInByUser = new Map(checkIns.map(ci => [ci.userId!, ci]));

  // Also include walk-in check-ins (entityType="tournament_event")
  const walkInCheckIns = await db.select().from(checkInsTable)
    .where(and(eq(checkInsTable.entityType, "tournament_event"), eq(checkInsTable.entityId, fixtureId)));
  for (const ci of walkInCheckIns) {
    if (ci.userId && !checkedInByUser.has(ci.userId)) {
      checkedInByUser.set(ci.userId, ci);
    }
  }

  // Tournament registration payment status per team
  const tourneyRegs = teamIds.length
    ? await db.select().from(tournamentRegistrationsTable)
        .where(and(eq(tournamentRegistrationsTable.tournamentId, tournamentId), inArray(tournamentRegistrationsTable.teamId, teamIds)))
    : [];
  const payByTeam = new Map(tourneyRegs.map(r => [r.teamId!, r.paymentStatus]));

  const attendance = members.map(m => {
    const u = userByClerk.get(m.userId);
    const ci = u ? checkedInByUser.get(u.id) : undefined;
    const teamName = teamMap.get(m.teamId)?.name ?? null;
    const side = m.teamId === fixture.homeTeamId ? "home" : "away";
    return {
      userId: u?.id ?? null,
      firstName: u?.firstName ?? null,
      lastName: u?.lastName ?? null,
      email: u?.email ?? null,
      teamName,
      side,
      checkedIn: !!ci,
      checkedInAt: ci?.checkedInAt?.toISOString() ?? null,
      method: ci?.method ?? null,
      methodLabel: methodLabel(ci?.method ?? null),
      paymentStatus: payByTeam.get(m.teamId) ?? "unknown",
      noShow: false,
    };
  });

  // Add walk-in players not already in members list
  const allUserIds = new Set(members.map(m => userByClerk.get(m.userId)?.id).filter(Boolean) as number[]);
  for (const [uid, ci] of checkedInByUser) {
    if (!allUserIds.has(uid)) {
      const u = usersArr.find(u => u.id === uid)
        ?? (await db.select().from(usersTable).where(eq(usersTable.id, uid)).limit(1))[0];
      if (u) {
        attendance.push({
          userId: u.id,
          firstName: u.firstName,
          lastName: u.lastName,
          email: u.email,
          teamName: null,
          side: "walk-in",
          checkedIn: true,
          checkedInAt: ci.checkedInAt?.toISOString() ?? null,
          method: ci.method,
          methodLabel: methodLabel(ci.method),
          paymentStatus: "paid_external",
          noShow: false,
        });
      }
    }
  }

  const homeTeam = teamMap.get(fixture.homeTeamId!);
  const awayTeam = teamMap.get(fixture.awayTeamId!);

  res.json({
    session: {
      id: fixture.id,
      name: [homeTeam?.name, awayTeam?.name].filter(Boolean).join(" vs ") || `Fixture #${fixture.id}`,
      startsAt: fixture.scheduledAt,
      type: "tournament_fixture",
      tournamentName: tournament.name,
      homeTeam: homeTeam?.name ?? null,
      awayTeam: awayTeam?.name ?? null,
    },
    stats: {
      totalRegistered: members.length,
      totalCheckedIn: attendance.filter(a => a.checkedIn).length,
      noShows: members.length - attendance.filter(a => a.checkedIn).length,
      unpaid: [...payByTeam.values()].filter(v => v !== "paid" && v !== "waived").length,
    },
    attendance,
  });
});

export default router;
