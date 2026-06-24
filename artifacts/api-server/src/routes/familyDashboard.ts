import { Router } from "express";
import {
  db,
  guardiansTable,
  usersTable,
  registrationsTable,
  fixturesTable,
  teamMembersTable,
  spotsTable,
  campRegistrationsTable,
  campsTable,
  dropinsTable,
  dropinCourtPoolsTable,
  seasonRecapsTable,
  assignmentsTable,
  subRefAlertsTable,
  teamsTable,
  leagueFreeAgentsTable,
  leaguesTable,
  leagueRegistrationsTable,
} from "@workspace/db";
import { requireAuth, type AuthedRequest } from "../middlewares/auth";
import { eq, and, gte, lte, inArray, ne, sql, or, isNull } from "drizzle-orm";
import { activeSpotCondition, activeCampRegCondition } from "../lib/activeConditions";

const router = Router();

router.get("/family-dashboard", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const [dbUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, req.clerkUserId));
    if (!dbUser) return res.status(401).json({ error: "User not found" });

    if (dbUser.role !== "parent" && dbUser.role !== "admin") {
      return res.status(403).json({ error: "Family dashboard is only available to guardian accounts" });
    }

    const children = await db
      .select({
        id: guardiansTable.id,
        youthUserId: guardiansTable.youthUserId,
        relationship: guardiansTable.relationship,
        status: guardiansTable.status,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        email: usersTable.email,
        dateOfBirth: usersTable.dateOfBirth,
        clerkId: usersTable.clerkId,
      })
      .from(guardiansTable)
      .innerJoin(usersTable, eq(guardiansTable.youthUserId, usersTable.id))
      .where(
        and(
          eq(guardiansTable.guardianUserId, dbUser.id),
          eq(guardiansTable.status, "approved"),
        ),
      );

    if (children.length === 0) {
      return res.json({
        children: [],
        upcomingThisWeek: [],
        outstandingBalances: [],
        recentRecaps: [],
      });
    }

    const childClerkIds = children.map((c) => c.clerkId);
    const childDbIds = children.map((c) => c.youthUserId);

    const weekStart = new Date();
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const regs = await db
      .select()
      .from(registrationsTable)
      .where(
        and(
          inArray(registrationsTable.userId, childClerkIds),
          ne(registrationsTable.status, "cancelled"),
        ),
      );

    const teamRows = childClerkIds.length > 0
      ? await db
          .select()
          .from(teamMembersTable)
          .where(inArray(teamMembersTable.userId, childClerkIds))
      : [];

    const teamIds = [...new Set(teamRows.map((t) => t.teamId))];

    const upcomingFixtures = teamIds.length > 0
      ? await db
          .select()
          .from(fixturesTable)
          .where(
            and(
              gte(fixturesTable.scheduledAt, weekStart),
              lte(fixturesTable.scheduledAt, weekEnd),
            ),
          )
      : [];

    const fixturesForTeams = upcomingFixtures.filter(
      (f) =>
        (f.homeTeamId && teamIds.includes(f.homeTeamId)) ||
        (f.awayTeamId && teamIds.includes(f.awayTeamId)),
    );

    const upcomingDropinSpots = childDbIds.length > 0
      ? await db
          .select({
            spot: spotsTable,
            dropin: dropinsTable,
            poolStartsAt: dropinCourtPoolsTable.startsAt,
            poolDurationMinutes: dropinCourtPoolsTable.durationMinutes,
          })
          .from(spotsTable)
          .innerJoin(
            dropinsTable,
            and(
              eq(spotsTable.entityId, dropinsTable.id),
              eq(spotsTable.entityType, "dropin"),
            ),
          )
          .leftJoin(
            dropinCourtPoolsTable,
            eq(spotsTable.poolId, dropinCourtPoolsTable.id),
          )
          .where(
            and(
              inArray(spotsTable.userId, childDbIds),
              activeSpotCondition,
              gte(sql`COALESCE(${dropinCourtPoolsTable.startsAt}, ${dropinsTable.startsAt})`, weekStart),
            ),
          )
      : [];

    const upcomingDropins = upcomingDropinSpots.map((r) => r.spot);

    const campRegs = childDbIds.length > 0
      ? await db
          .select()
          .from(campRegistrationsTable)
          .where(
            and(
              inArray(campRegistrationsTable.playerUserId, childDbIds),
              activeCampRegCondition,
            ),
          )
      : [];

    const campIds = [...new Set(campRegs.map((c) => c.campId))];
    const upcomingCamps = campIds.length > 0
      ? await db
          .select()
          .from(campsTable)
          .where(
            and(
              inArray(campsTable.id, campIds),
              sql`${campsTable.startDate} <= ${weekEnd.toISOString().split("T")[0]}`,
              sql`${campsTable.endDate} >= ${weekStart.toISOString().split("T")[0]}`,
            ),
          )
      : [];

    const unpaidRegs = regs.filter((r) => r.paymentStatus === "unpaid" || r.paymentStatus === "partial");
    const unpaidDropins = upcomingDropins.filter((s) => s.paymentStatus === "unpaid");
    const unpaidCamps = campRegs.filter((c) => c.paymentStatus === "unpaid" || c.paymentStatus === "partial");

    const childMap = new Map(children.map((c) => [c.clerkId, c]));
    const childDbMap = new Map(children.map((c) => [c.youthUserId, c]));
    const childClerkDbMap = new Map(children.map((c) => [c.clerkId, c]));

    const outstandingBalances = [
      ...unpaidRegs.map((r) => {
        const child = childMap.get(r.userId);
        return {
          youthUserId: child?.youthUserId ?? null,
          childName: child
            ? `${child.firstName ?? ""} ${child.lastName ?? ""}`.trim()
            : "Child",
          type: r.programType,
          programName: r.programName,
          paymentStatus: r.paymentStatus,
          amountPaid: r.amountPaid,
          programId: r.programId,
          registrationId: r.id,
          spotId: null as number | null,
          poolId: null as number | null,
        };
      }),
      ...unpaidDropins.map((s) => {
        const child = s.userId ? childDbMap.get(s.userId) : null;
        return {
          youthUserId: child?.youthUserId ?? null,
          childName: child
            ? `${child.firstName ?? ""} ${child.lastName ?? ""}`.trim()
            : "Child",
          type: "drop_in",
          programName: "Drop-in spot",
          paymentStatus: s.paymentStatus,
          amountPaid: "0",
          programId: s.entityId,
          registrationId: null as number | null,
          spotId: s.id,
          poolId: s.poolId,
        };
      }),
      ...unpaidCamps.map((c) => {
        const child = c.playerUserId ? childDbMap.get(c.playerUserId) : null;
        return {
          youthUserId: child?.youthUserId ?? null,
          childName: child
            ? `${child.firstName ?? ""} ${child.lastName ?? ""}`.trim()
            : "Child",
          type: "camp",
          programName: "Camp registration",
          paymentStatus: c.paymentStatus,
          amountPaid: String(c.pricePaid ?? "0"),
          programId: c.campId,
          registrationId: null as number | null,
          spotId: null as number | null,
          poolId: null as number | null,
          campRegId: c.id,
        };
      }),
    ];

    const recentRecaps = await db
      .select()
      .from(seasonRecapsTable)
      .where(inArray(seasonRecapsTable.userId, childDbIds))
      .orderBy(seasonRecapsTable.createdAt)
      .limit(5);

    const upcomingThisWeek = [
      ...fixturesForTeams.map((f) => {
        const teamRow = teamRows.find(
          (t) => t.teamId === f.homeTeamId || t.teamId === f.awayTeamId,
        );
        const child = teamRow ? childClerkDbMap.get(teamRow.userId) : null;
        return {
          type: "fixture" as const,
          youthUserId: child?.youthUserId ?? null,
          childName: child
            ? `${child.firstName ?? ""} ${child.lastName ?? ""}`.trim()
            : "Child",
          description: `${f.entityType} game`,
          scheduledAt: f.scheduledAt?.toISOString() ?? null,
        };
      }),
      ...upcomingDropinSpots.map(({ spot, dropin, poolStartsAt, poolDurationMinutes }) => {
        const child = spot.userId ? childDbMap.get(spot.userId) : null;
        const startsAt = poolStartsAt ?? dropin.startsAt;
        const durationMinutes = poolDurationMinutes ?? null;
        const endsAt = startsAt && durationMinutes
          ? new Date(startsAt.getTime() + durationMinutes * 60_000).toISOString()
          : null;
        return {
          type: "dropin" as const,
          youthUserId: child?.youthUserId ?? null,
          childName: child
            ? `${child.firstName ?? ""} ${child.lastName ?? ""}`.trim()
            : "Child",
          description: dropin.name,
          scheduledAt: startsAt.toISOString(),
          endsAt,
        };
      }),
      ...upcomingCamps.flatMap((camp) => {
        const registeredChildren = campRegs
          .filter((cr) => cr.campId === camp.id)
          .map((cr) => ({ child: childDbMap.get(cr.playerUserId) }));
        return registeredChildren
          .filter((r) => r.child != null)
          .map(({ child }) => ({
            type: "camp" as const,
            youthUserId: child!.youthUserId,
            childName: `${child!.firstName ?? ""} ${child!.lastName ?? ""}`.trim(),
            description: camp.name,
            scheduledAt: camp.startDate
              ? new Date(camp.startDate).toISOString()
              : null,
          }));
      }),
    ].sort((a, b) => {
      if (!a.scheduledAt) return 1;
      if (!b.scheduledAt) return -1;
      return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
    });

    const childUpcomingEvents = new Map<number, typeof upcomingThisWeek[0]>();
    for (const event of upcomingThisWeek) {
      if (event.youthUserId != null && !childUpcomingEvents.has(event.youthUserId)) {
        childUpcomingEvents.set(event.youthUserId, event);
      }
    }

    const childUnpaidCount = new Map<number, number>();
    for (const bal of outstandingBalances) {
      if (bal.youthUserId != null) {
        childUnpaidCount.set(bal.youthUserId, (childUnpaidCount.get(bal.youthUserId) ?? 0) + 1);
      }
    }

    res.json({
      children: children.map((c) => ({
        youthUserId: c.youthUserId,
        firstName: c.firstName,
        lastName: c.lastName,
        relationship: c.relationship,
        dateOfBirth: c.dateOfBirth,
        registrations: regs.filter((r) => r.userId === c.clerkId).length,
        campRegistrations: campRegs.filter((cr) => cr.playerUserId === c.youthUserId).length,
        upcomingEvent: childUpcomingEvents.get(c.youthUserId) ?? null,
        unpaidCount: childUnpaidCount.get(c.youthUserId) ?? 0,
      })),
      upcomingThisWeek,
      outstandingBalances,
      recentRecaps: recentRecaps.map((r) => ({
        id: r.id,
        userId: r.userId,
        seasonLabel: r.seasonLabel,
        gamesPlayed: r.gamesPlayed,
        gamesAttended: r.gamesAttended,
        attendanceRate: r.attendanceRate,
        coachNote: r.coachNote,
        positiveHighlight: r.positiveHighlight,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    console.error("[familyDashboard] GET error:", err);
    res.status(500).json({ error: "Failed to load family dashboard" });
  }
});

router.get("/family-dashboard/child/:youthUserId", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const youthUserId = parseInt(req.params.youthUserId, 10);
    if (isNaN(youthUserId)) return res.status(400).json({ error: "Invalid child ID" });

    const [dbUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, req.clerkUserId));
    if (!dbUser) return res.status(401).json({ error: "User not found" });

    const [guardianLink] = await db
      .select()
      .from(guardiansTable)
      .where(
        and(
          eq(guardiansTable.guardianUserId, dbUser.id),
          eq(guardiansTable.youthUserId, youthUserId),
          eq(guardiansTable.status, "approved"),
        ),
      );
    if (!guardianLink) return res.status(403).json({ error: "Not authorized to view this child" });

    const [child] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, youthUserId));
    if (!child) return res.status(404).json({ error: "Child not found" });

    const registrations = await db
      .select()
      .from(registrationsTable)
      .where(
        and(
          eq(registrationsTable.userId, child.clerkId),
          ne(registrationsTable.status, "cancelled"),
        ),
      )
      .orderBy(registrationsTable.createdAt);

    const campRegs = await db
      .select({
        campReg: campRegistrationsTable,
        camp: campsTable,
      })
      .from(campRegistrationsTable)
      .innerJoin(campsTable, eq(campRegistrationsTable.campId, campsTable.id))
      .where(
        and(
          eq(campRegistrationsTable.playerUserId, youthUserId),
          activeCampRegCondition,
        ),
      )
      .orderBy(campRegistrationsTable.createdAt);

    const dropinSpots = await db
      .select({
        spot: spotsTable,
        dropin: dropinsTable,
        poolStartsAt: dropinCourtPoolsTable.startsAt,
        poolDurationMinutes: dropinCourtPoolsTable.durationMinutes,
        poolPrice: dropinCourtPoolsTable.price,
      })
      .from(spotsTable)
      .innerJoin(
        dropinsTable,
        and(
          eq(spotsTable.entityId, dropinsTable.id),
          eq(spotsTable.entityType, "dropin"),
        ),
      )
      .leftJoin(
        dropinCourtPoolsTable,
        eq(spotsTable.poolId, dropinCourtPoolsTable.id),
      )
      .where(
        and(
          eq(spotsTable.userId, youthUserId),
          activeSpotCondition,
        ),
      )
      .orderBy(sql`COALESCE(${dropinCourtPoolsTable.startsAt}, ${dropinsTable.startsAt})`);

    res.json({
      child: {
        id: child.id,
        firstName: child.firstName,
        lastName: child.lastName,
        dateOfBirth: child.dateOfBirth,
        relationship: guardianLink.relationship,
      },
      registrations: registrations.map((r) => ({
        id: r.id,
        programType: r.programType,
        programName: r.programName,
        programId: r.programId,
        status: r.status,
        paymentStatus: r.paymentStatus,
        amountPaid: r.amountPaid,
        createdAt: r.createdAt,
      })),
      campRegistrations: campRegs.map(({ campReg, camp }) => ({
        id: campReg.id,
        campId: camp.id,
        campName: camp.name,
        startDate: camp.startDate,
        endDate: camp.endDate,
        status: campReg.status,
        paymentStatus: campReg.paymentStatus,
        pricePaid: campReg.pricePaid,
        createdAt: campReg.createdAt,
      })),
      dropinSpots: dropinSpots.map(({ spot, dropin, poolStartsAt, poolDurationMinutes, poolPrice }) => {
        const startsAt = poolStartsAt ?? dropin.startsAt;
        const durationMinutes = poolDurationMinutes ?? null;
        const endsAt = startsAt && durationMinutes
          ? new Date(startsAt.getTime() + durationMinutes * 60_000).toISOString()
          : null;
        return {
          id: spot.id,
          dropinName: dropin.name,
          dropinId: dropin.id,
          poolId: spot.poolId,
          startsAt: startsAt.toISOString(),
          endsAt,
          status: spot.status,
          paymentStatus: spot.paymentStatus,
          poolPrice: Number(poolPrice ?? 0),
          createdAt: spot.createdAt,
        };
      }),
    });
  } catch (err) {
    console.error("[familyDashboard/child] GET error:", err);
    res.status(500).json({ error: "Failed to load child detail" });
  }
});


/**
 * GET /me/staff-dashboard
 * Returns upcoming assignments and role-specific data for refs and coaches.
 * Accessible to any authenticated user; returns empty collections for users without assignments.
 */
router.get("/me/staff-dashboard", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const [dbUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, req.clerkUserId));
    if (!dbUser) return res.status(401).json({ error: "User not found" });

    const now = new Date();

    const upcomingAssignments = await db
      .select()
      .from(assignmentsTable)
      .where(
        and(
          eq(assignmentsTable.staffUserId, dbUser.id),
          or(
            gte(assignmentsTable.startAt, now),
            gte(assignmentsTable.endAt, now),
          ),
        ),
      )
      .orderBy(assignmentsTable.startAt)
      .limit(10);

    const fixtureIds = upcomingAssignments
      .filter((a) => a.entityType === "fixture")
      .map((a) => a.entityId);

    const assignedFixtures = fixtureIds.length > 0
      ? await db
          .select()
          .from(fixturesTable)
          .where(
            and(
              inArray(fixturesTable.id, fixtureIds),
              ne(fixturesTable.status, "cancelled"),
              gte(fixturesTable.scheduledAt, now),
            ),
          )
          .orderBy(fixturesTable.scheduledAt)
          .limit(10)
      : [];

    const leagueTournamentAssignments = upcomingAssignments.filter(
      (a) => a.entityType === "league" || a.entityType === "tournament",
    );
    const entityGroups = leagueTournamentAssignments.reduce<Record<string, number[]>>(
      (acc, a) => {
        if (!acc[a.entityType]) acc[a.entityType] = [];
        acc[a.entityType].push(a.entityId);
        return acc;
      },
      {},
    );

    const programFixtures: typeof fixturesTable.$inferSelect[] = [];
    for (const [entityType, entityIds] of Object.entries(entityGroups)) {
      if (entityIds.length === 0) continue;
      const rows = await db
        .select()
        .from(fixturesTable)
        .where(
          and(
            inArray(fixturesTable.entityId, entityIds),
            eq(fixturesTable.entityType, entityType),
            ne(fixturesTable.status, "cancelled"),
            gte(fixturesTable.scheduledAt, now),
          ),
        )
        .orderBy(fixturesTable.scheduledAt)
        .limit(10);
      programFixtures.push(...rows);
    }

    const allUpcomingFixtures = [
      ...assignedFixtures,
      ...programFixtures.filter((f) => !assignedFixtures.some((af) => af.id === f.id)),
    ].sort((a, b) => {
      if (!a.scheduledAt) return 1;
      if (!b.scheduledAt) return -1;
      return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
    });

    const coachAssignments = upcomingAssignments.filter((a) => a.role === "coach");
    let teamRoster: Array<{
      teamId: number;
      teamName: string;
      memberCount: number;
      members: Array<{ userId: string; role: string; jerseyNumber: number | null }>;
    }> = [];

    if (coachAssignments.length > 0) {
      const assignedLeagueIds = coachAssignments
        .filter((a) => a.entityType === "league")
        .map((a) => a.entityId);
      const assignedTournamentIds = coachAssignments
        .filter((a) => a.entityType === "tournament")
        .map((a) => a.entityId);

      const teams = await db
        .select()
        .from(teamsTable)
        .where(
          or(
            assignedLeagueIds.length > 0
              ? inArray(teamsTable.leagueId, assignedLeagueIds)
              : undefined,
            assignedTournamentIds.length > 0
              ? inArray(teamsTable.tournamentId, assignedTournamentIds)
              : undefined,
          ),
        )
        .limit(5);

      if (teams.length > 0) {
        const teamIds = teams.map((t) => t.id);
        const members = await db
          .select()
          .from(teamMembersTable)
          .where(
            and(
              inArray(teamMembersTable.teamId, teamIds),
              eq(teamMembersTable.status, "active"),
            ),
          );

        teamRoster = teams.map((team) => {
          const teamMembers = members.filter((m) => m.teamId === team.id);
          return {
            teamId: team.id,
            teamName: team.name,
            memberCount: teamMembers.length,
            members: teamMembers.map((m) => ({
              userId: m.userId,
              role: m.role,
              jerseyNumber: m.jerseyNumber,
            })),
          };
        });
      }
    }

    const openSubSlots = await db
      .select()
      .from(subRefAlertsTable)
      .where(eq(subRefAlertsTable.status, "open"))
      .orderBy(subRefAlertsTable.gameDate)
      .limit(5);

    res.json({
      upcomingAssignments,
      upcomingFixtures: allUpcomingFixtures.slice(0, 5),
      teamRoster,
      openSubSlots,
    });
  } catch (err) {
    console.error("[staffDashboard] GET error:", err);
    res.status(500).json({ error: "Failed to load staff dashboard" });
  }
});

/**
 * GET /me/team-dashboard
 * Returns team management data for users with team_manager or team_coach roles:
 * teams they manage, pending free agent proposals, and upcoming fixtures.
 */
router.get("/me/team-dashboard", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const clerkUserId = req.clerkUserId;

    const managingMemberships = await db
      .select()
      .from(teamMembersTable)
      .where(
        and(
          eq(teamMembersTable.userId, clerkUserId),
          eq(teamMembersTable.status, "active"),
          inArray(teamMembersTable.role, ["captain", "manager", "coach"]),
        ),
      );

    const captainTeams = await db
      .select()
      .from(teamsTable)
      .where(eq(teamsTable.captainUserId, clerkUserId));

    const managingTeamIds = [
      ...new Set([
        ...managingMemberships.map((m) => m.teamId),
        ...captainTeams.map((t) => t.id),
      ]),
    ];

    if (managingTeamIds.length === 0) {
      return res.json({ teams: [], upcomingFixtures: [] });
    }

    const teams = await db
      .select()
      .from(teamsTable)
      .where(inArray(teamsTable.id, managingTeamIds));

    const allMembers = await db
      .select()
      .from(teamMembersTable)
      .where(
        and(
          inArray(teamMembersTable.teamId, managingTeamIds),
          eq(teamMembersTable.status, "active"),
        ),
      );

    const pendingMembers = await db
      .select()
      .from(teamMembersTable)
      .where(
        and(
          inArray(teamMembersTable.teamId, managingTeamIds),
          eq(teamMembersTable.status, "pending"),
        ),
      );

    const pendingFreeAgents = await db
      .select()
      .from(leagueFreeAgentsTable)
      .where(
        and(
          inArray(leagueFreeAgentsTable.proposedTeamId, managingTeamIds),
          eq(leagueFreeAgentsTable.matchStatus, "team_reviewing"),
        ),
      );

    const faUserIds = pendingFreeAgents.map((fa) => fa.userId);
    const faUsers =
      faUserIds.length > 0
        ? await db.select().from(usersTable).where(inArray(usersTable.clerkId, faUserIds))
        : [];
    const faUserMap = Object.fromEntries(faUsers.map((u) => [u.clerkId, u]));

    const now = new Date();
    const upcomingFixtures = await db
      .select()
      .from(fixturesTable)
      .where(
        and(
          or(
            inArray(fixturesTable.homeTeamId, managingTeamIds),
            inArray(fixturesTable.awayTeamId, managingTeamIds),
          ),
          gte(fixturesTable.scheduledAt, now),
          ne(fixturesTable.status, "cancelled"),
        ),
      )
      .orderBy(fixturesTable.scheduledAt)
      .limit(5);

    // Fetch league registration payment data for each team
    const leagueRegs = managingTeamIds.length > 0
      ? await db.select().from(leagueRegistrationsTable)
          .where(inArray(leagueRegistrationsTable.teamId, managingTeamIds))
      : [];
    const leagueRegMap: Record<number, typeof leagueRegs[number]> = Object.fromEntries(
      leagueRegs.map((r) => [r.teamId, r]),
    );

    const teamData = teams.map((team) => {
      const members = allMembers.filter((m) => m.teamId === team.id);
      const fas = pendingFreeAgents.filter((fa) => fa.proposedTeamId === team.id);
      const reg = leagueRegMap[team.id];
      const parsedNotes = (() => {
        try { return reg?.notes ? JSON.parse(reg.notes) : {}; } catch { return {}; }
      })();
      return {
        teamId: team.id,
        teamName: team.name,
        leagueId: team.leagueId,
        confirmedCount: members.length,
        pendingCount: pendingMembers.filter((m) => m.teamId === team.id).length,
        members: members.map((m) => ({
          userId: m.userId,
          role: m.role,
          jerseyNumber: m.jerseyNumber,
        })),
        pendingFreeAgents: fas.map((fa) => {
          const u = faUserMap[fa.userId];
          return {
            id: fa.id,
            leagueId: fa.leagueId,
            userId: fa.userId,
            positions: fa.positions ? JSON.parse(fa.positions) : [],
            skillLevel: fa.skillLevel,
            matchReasoning: fa.matchReasoning,
            user: u
              ? { firstName: u.firstName, lastName: u.lastName, email: u.email }
              : null,
          };
        }),
        registration: reg ? {
          id: reg.id,
          paymentStatus: reg.paymentStatus,
          totalAmount: reg.totalAmount,
          amountPaid: reg.amountPaid,
          balanceDue: reg.balanceDue,
          balanceDueDate: reg.balanceDueDate ? reg.balanceDueDate.toString() : null,
          depositPaid: reg.depositPaid ?? false,
          depositAmount: reg.depositAmount,
          blackoutDates: (parsedNotes.blackoutDates ?? []) as string[],
        } : null,
      };
    });

    res.json({ teams: teamData, upcomingFixtures });
  } catch (err) {
    console.error("[teamDashboard] error:", err);
    res.status(500).json({ error: "Failed to load team dashboard" });
  }
});

/**
 * PATCH /me/team-registrations/:regId/blackout-dates
 * Allows a team captain/manager/coach to update blackout dates on their team's
 * league registration (stored as JSON in the notes field).
 */
router.patch("/me/team-registrations/:regId/blackout-dates", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const clerkUserId = req.clerkUserId;
  const regId = Number(req.params.regId);
  const { blackoutDates } = req.body ?? {};

  if (!Array.isArray(blackoutDates)) {
    res.status(400).json({ error: "blackoutDates must be an array of date strings" });
    return;
  }

  const [reg] = await db.select().from(leagueRegistrationsTable)
    .where(eq(leagueRegistrationsTable.id, regId));
  if (!reg) { res.status(404).json({ error: "Registration not found" }); return; }

  // Verify user is captain/manager/coach of the team
  const [membership] = reg.teamId
    ? await db.select().from(teamMembersTable).where(
        and(
          eq(teamMembersTable.teamId, reg.teamId),
          eq(teamMembersTable.userId, clerkUserId),
          eq(teamMembersTable.status, "active"),
          inArray(teamMembersTable.role, ["captain", "manager", "coach"]),
        ),
      )
    : [undefined];

  const [captainTeam] = reg.teamId
    ? await db.select().from(teamsTable)
        .where(and(eq(teamsTable.id, reg.teamId), eq(teamsTable.captainUserId, clerkUserId)))
    : [undefined];

  if (!membership && !captainTeam) {
    res.status(403).json({ error: "You are not authorized to update this registration" });
    return;
  }

  const existingNotes = (() => {
    try { return reg.notes ? JSON.parse(reg.notes) : {}; } catch { return {}; }
  })();
  const updatedNotes = { ...existingNotes, blackoutDates: blackoutDates.filter((d: any) => typeof d === "string") };

  await db.update(leagueRegistrationsTable)
    .set({ notes: JSON.stringify(updatedNotes) })
    .where(eq(leagueRegistrationsTable.id, regId));

  res.json({ success: true, blackoutDates: updatedNotes.blackoutDates });
});

/**
 * GET /me/free-agent-status
 * Returns active free agent registrations for the current player across all leagues.
 */
router.get("/me/free-agent-status", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const clerkUserId = req.clerkUserId;

    const agents = await db
      .select()
      .from(leagueFreeAgentsTable)
      .where(
        and(
          eq(leagueFreeAgentsTable.userId, clerkUserId),
          // Include assigned/matched so players see their confirmed placement
          ne(leagueFreeAgentsTable.status, "cancelled"),
        ),
      );

    if (agents.length === 0) return res.json([]);

    const leagueIds = agents.map((a) => a.leagueId);
    const leagues = await db
      .select()
      .from(leaguesTable)
      .where(inArray(leaguesTable.id, leagueIds));
    const leagueMap = Object.fromEntries(leagues.map((l) => [l.id, l]));

    const proposedTeamIds = agents
      .map((a) => a.proposedTeamId)
      .filter(Boolean) as number[];
    const proposedTeams =
      proposedTeamIds.length > 0
        ? await db
            .select()
            .from(teamsTable)
            .where(inArray(teamsTable.id, proposedTeamIds))
        : [];
    const teamMap = Object.fromEntries(proposedTeams.map((t) => [t.id, t]));

    const result = agents.map((a) => ({
      id: a.id,
      leagueId: a.leagueId,
      leagueName: leagueMap[a.leagueId]?.name ?? `League #${a.leagueId}`,
      matchStatus: a.matchStatus ?? "unmatched",
      proposedTeamName: a.proposedTeamId ? (teamMap[a.proposedTeamId]?.name ?? null) : null,
      proposedAt: a.proposedAt?.toISOString() ?? null,
      positions: a.positions ? JSON.parse(a.positions) : [],
      skillLevel: a.skillLevel,
      status: a.status,
    }));

    res.json(result);
  } catch (err) {
    console.error("[freeAgentStatus] error:", err);
    res.status(500).json({ error: "Failed to load free agent status" });
  }
});

/**
 * GET /me/camp-health-packets
 * Returns upcoming camp registrations where the health packet has not been submitted.
 * Includes both the player's own registrations and (for parents) their children's registrations.
 */
router.get("/me/camp-health-packets", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const clerkUserId = req.clerkUserId;
    const [dbUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, clerkUserId));
    if (!dbUser) return res.status(401).json({ error: "User not found" });

    const ownRegs = await db
      .select()
      .from(campRegistrationsTable)
      .where(
        and(
          eq(campRegistrationsTable.playerUserId, dbUser.id),
          eq(campRegistrationsTable.status, "confirmed"),
          isNull(campRegistrationsTable.healthPacketSubmittedAt),
        ),
      );

    const childRegs = await db
      .select()
      .from(campRegistrationsTable)
      .where(
        and(
          eq(campRegistrationsTable.guardianUserId, dbUser.id),
          eq(campRegistrationsTable.status, "confirmed"),
          isNull(campRegistrationsTable.healthPacketSubmittedAt),
          ne(campRegistrationsTable.playerUserId, dbUser.id),
        ),
      );

    const allRegs = [...ownRegs, ...childRegs];
    if (allRegs.length === 0) return res.json([]);

    const campIds = [...new Set(allRegs.map((r) => r.campId))];
    const camps = await db
      .select()
      .from(campsTable)
      .where(inArray(campsTable.id, campIds));
    const campMap = Object.fromEntries(camps.map((c) => [c.id, c]));

    const playerIds = [
      ...new Set(allRegs.map((r) => r.playerUserId).filter(Boolean)),
    ] as number[];
    const players =
      playerIds.length > 0
        ? await db.select().from(usersTable).where(inArray(usersTable.id, playerIds))
        : [];
    const playerMap = Object.fromEntries(players.map((u) => [u.id, u]));

    const now = new Date();
    const result = allRegs
      .map((reg) => {
        const camp = campMap[reg.campId];
        if (!camp?.startDate) return null;

        const campStart = new Date(camp.startDate + "T12:00:00");
        if (campStart < now) return null;

        const msPerDay = 1000 * 60 * 60 * 24;
        const daysUntilCamp = Math.ceil(
          (campStart.getTime() - now.getTime()) / msPerDay,
        );

        const player = reg.playerUserId ? playerMap[reg.playerUserId] : null;
        const isChild =
          reg.guardianUserId === dbUser.id &&
          reg.playerUserId !== dbUser.id;

        return {
          registrationId: reg.id,
          campId: reg.campId,
          campName: camp.name,
          campStartDate: camp.startDate,
          daysUntilCamp,
          playerName: player
            ? `${player.firstName ?? ""} ${player.lastName ?? ""}`.trim()
            : "Unknown",
          isChild,
        };
      })
      .filter(Boolean);

    res.json(result);
  } catch (err) {
    console.error("[campHealthPackets] error:", err);
    res.status(500).json({ error: "Failed to load camp health packets" });
  }
});

export default router;
