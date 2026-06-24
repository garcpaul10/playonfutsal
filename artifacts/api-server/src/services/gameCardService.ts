/**
 * Game Card Service
 * Handles auto-generation and roster snapshotting for game cards.
 * Called whenever fixtures are created or refs are assigned.
 */
import {
  db, gameCardsTable, fixturesTable, teamsTable, teamMembersTable,
  usersTable, playerProfilesTable, guardiansTable, assignmentsTable,
} from "@workspace/db";
import { eq, and, ne } from "drizzle-orm";

export interface RosterPlayer {
  userId: string;
  dbUserId: number;
  firstName: string | null;
  lastName: string | null;
  jerseyNumber: string | null;
  role: string;
  guardianContact: { name: string | null; phone: string | null } | null;
}

async function snapshotTeamRoster(teamId: number): Promise<RosterPlayer[]> {
  const members = await db.select().from(teamMembersTable)
    .where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.status, "active")));

  const roster: RosterPlayer[] = [];
  for (const m of members) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, m.userId));
    if (!user) continue;

    const [profile] = await db.select().from(playerProfilesTable).where(eq(playerProfilesTable.userId, user.id));

    let guardianContact: { name: string | null; phone: string | null } | null = null;
    const guardians = await db.select().from(guardiansTable)
      .where(and(eq(guardiansTable.youthUserId, user.id), eq(guardiansTable.status, "approved")));
    if (guardians.length > 0) {
      const [g] = guardians;
      const [guardianUser] = await db.select().from(usersTable).where(eq(usersTable.id, g.guardianUserId));
      guardianContact = {
        name: guardianUser ? `${guardianUser.firstName ?? ""} ${guardianUser.lastName ?? ""}`.trim() || null : null,
        phone: guardianUser?.phone ?? null,
      };
    }

    roster.push({
      userId: m.userId,
      dbUserId: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      jerseyNumber: profile?.jerseyNumber?.toString() ?? null,
      role: m.role,
      guardianContact,
    });
  }
  return roster;
}

/**
 * Ensure a game card exists for the given fixture. If one already exists,
 * updates the ref assignment and re-snapshots rosters (idempotent).
 */
export async function ensureGameCard(fixtureId: number): Promise<void> {
  const [fixture] = await db.select().from(fixturesTable).where(eq(fixturesTable.id, fixtureId));
  if (!fixture) return;

  if (fixture.status === "cancelled" || fixture.status === "bye") return;

  const homeTeam = fixture.homeTeamId
    ? (await db.select().from(teamsTable).where(eq(teamsTable.id, fixture.homeTeamId)))[0] ?? null
    : null;
  const awayTeam = fixture.awayTeamId
    ? (await db.select().from(teamsTable).where(eq(teamsTable.id, fixture.awayTeamId)))[0] ?? null
    : null;

  const homeRoster = homeTeam ? await snapshotTeamRoster(homeTeam.id) : [];
  const awayRoster = awayTeam ? await snapshotTeamRoster(awayTeam.id) : [];

  const assignments = await db.select({
    staffUserId: assignmentsTable.staffUserId,
    role: assignmentsTable.role,
  }).from(assignmentsTable)
    .where(and(
      eq(assignmentsTable.entityType, "fixture"),
      eq(assignmentsTable.entityId, fixtureId),
      ne(assignmentsTable.status, "declined"),
    ));

  const refUserIds: number[] = [];
  if (fixture.refereeUserId) refUserIds.push(fixture.refereeUserId);
  let scorekeeperId: number | null = null;

  for (const a of assignments) {
    if (a.role === "scorekeeper") {
      scorekeeperId = a.staffUserId;
    } else {
      if (!refUserIds.includes(a.staffUserId)) refUserIds.push(a.staffUserId);
    }
  }

  const [existing] = await db.select().from(gameCardsTable).where(eq(gameCardsTable.fixtureId, fixtureId));

  if (existing) {
    if (existing.lockedAt) return;
    await db.update(gameCardsTable).set({
      homeTeamId: fixture.homeTeamId,
      awayTeamId: fixture.awayTeamId,
      homeTeamName: homeTeam?.name ?? null,
      awayTeamName: awayTeam?.name ?? null,
      homeRoster: JSON.stringify(homeRoster),
      awayRoster: JSON.stringify(awayRoster),
      refUserIds: JSON.stringify(refUserIds),
      ...(scorekeeperId !== null ? { scorekeeperId } : {}),
      updatedAt: new Date(),
    }).where(eq(gameCardsTable.id, existing.id));
  } else {
    await db.insert(gameCardsTable).values({
      fixtureId,
      entityType: fixture.entityType,
      entityId: fixture.entityId,
      homeTeamId: fixture.homeTeamId,
      awayTeamId: fixture.awayTeamId,
      homeTeamName: homeTeam?.name ?? null,
      awayTeamName: awayTeam?.name ?? null,
      homeRoster: JSON.stringify(homeRoster),
      awayRoster: JSON.stringify(awayRoster),
      refUserIds: JSON.stringify(refUserIds),
      scorekeeperId,
      status: "upcoming",
    } as any);
  }
}

/**
 * Generate game cards for all scheduled fixtures of a given entity
 * (e.g. all league fixtures after schedule generation).
 */
export async function ensureGameCardsForEntity(entityType: string, entityId: number): Promise<void> {
  const fixtures = await db.select().from(fixturesTable)
    .where(and(eq(fixturesTable.entityType, entityType), eq(fixturesTable.entityId, entityId)));

  for (const fx of fixtures) {
    if (fx.status === "scheduled" || fx.status === "pending") {
      await ensureGameCard(fx.id).catch(() => {});
    }
  }
}
