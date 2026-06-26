/**
 * Automated reminder jobs.
 *
 * Runs once at startup and every 60 minutes thereafter (in-process scheduler).
 * Jobs are idempotent: notifications are only sent if not already sent today
 * (checked via notifications table — same user + type + date = skip).
 *
 * Active jobs:
 *   1. upcoming_session  — 24 h before a fixture the player is registered for
 *   2. payment_due       — registrations with paymentStatus=unpaid > 3 days old
 *   3. balance_due       — registrations with paymentStatus=unpaid where first fixture is ≤ 7 days away
 */

import {
  db,
  usersTable,
  registrationsTable,
  fixturesTable,
  teamMembersTable,
  notificationsTable,
  spotsTable,
} from "@workspace/db";
import { eq, and, gte, lte, ne, inArray, lt } from "drizzle-orm";
import { sendNotificationWithPreferences } from "./notifications";

const JOB_INTERVAL_MS = 60 * 60 * 1000;

function todayKey(): string {
  return new Date().toISOString().split("T")[0];
}

async function alreadySentToday(
  userId: number,
  type: string,
): Promise<boolean> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const rows = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.userId, userId),
        eq(notificationsTable.type, type),
        gte(notificationsTable.createdAt, todayStart),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function runUpcomingSessionReminders(): Promise<void> {
  const now = new Date();
  const windowStart = new Date(now.getTime() + 20 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 28 * 60 * 60 * 1000);

  try {
    const fixtures = await db
      .select()
      .from(fixturesTable)
      .where(
        and(
          gte(fixturesTable.scheduledAt, windowStart),
          lte(fixturesTable.scheduledAt, windowEnd),
        ),
      );

    if (fixtures.length === 0) return;

    const fixtureTeamIds = new Set<number>();
    for (const f of fixtures) {
      if (f.homeTeamId) fixtureTeamIds.add(f.homeTeamId);
      if (f.awayTeamId) fixtureTeamIds.add(f.awayTeamId);
    }

    if (fixtureTeamIds.size === 0) return;

    const members = await db
      .select()
      .from(teamMembersTable)
      .where(inArray(teamMembersTable.teamId, Array.from(fixtureTeamIds)));

    const clerkIds = [...new Set(members.map((m) => m.userId))];
    if (clerkIds.length === 0) return;

    const players = await db
      .select()
      .from(usersTable)
      .where(inArray(usersTable.clerkId, clerkIds));

    for (const player of players) {
      const alreadySent = await alreadySentToday(player.id, "upcoming_session");
      if (alreadySent) continue;

      const playerFixtures = fixtures.filter((f) => {
        const playerTeams = members
          .filter((m) => m.userId === player.clerkId)
          .map((m) => m.teamId);
        return (
          (f.homeTeamId && playerTeams.includes(f.homeTeamId)) ||
          (f.awayTeamId && playerTeams.includes(f.awayTeamId))
        );
      });

      if (playerFixtures.length === 0) continue;

      const nextFixture = playerFixtures[0];
      const dateStr = nextFixture.scheduledAt
        ? new Date(nextFixture.scheduledAt).toLocaleString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })
        : "tomorrow";

      await sendNotificationWithPreferences({
        userId: player.id,
        type: "upcoming_session",
        subject: "You have a game tomorrow",
        body: `Reminder: you have a ${nextFixture.entityType} game scheduled for ${dateStr}. See you on the court! — PlayOn`,
        metadata: { fixtureId: nextFixture.id },
      });
    }
  } catch (err) {
    console.error("[reminders] upcoming_session error:", err);
  }
}

async function runPaymentDueReminders(): Promise<void> {
  try {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    // Track which DB user IDs have already been sent a reminder this pass so that
    // a player with both a registration row and a spot row gets at most one notification.
    const sentThisRun = new Set<number>();

    // ── Part 1: registrations-based (non-drop-in programs) ────────────────────
    const unpaid = await db
      .select()
      .from(registrationsTable)
      .where(
        and(
          eq(registrationsTable.paymentStatus, "unpaid"),
          ne(registrationsTable.status, "cancelled"),
          lte(registrationsTable.createdAt, threeDaysAgo),
        ),
      );

    if (unpaid.length > 0) {
      const clerkIds = [...new Set(unpaid.map((r) => r.userId))];
      const players = await db
        .select()
        .from(usersTable)
        .where(inArray(usersTable.clerkId, clerkIds));

      const playerMap = new Map(players.map((p) => [p.clerkId, p]));

      for (const reg of unpaid) {
        const player = playerMap.get(reg.userId);
        if (!player) continue;

        const alreadySent = await alreadySentToday(player.id, "payment_due");
        if (alreadySent) { sentThisRun.add(player.id); continue; }

        await sendNotificationWithPreferences({
          userId: player.id,
          type: "payment_due",
          subject: "Payment due for your registration",
          body: `Your registration for ${reg.programName} has an outstanding balance. Please pay before your first session at playonfutsal.vercel.app — PlayOn`,
          metadata: { registrationId: reg.id },
        });
        sentThisRun.add(player.id);
      }
    }

    // ── Part 2: drop-in spots (no matching registrations row required) ────────
    // Find spots where: status=reserved, paymentStatus=unpaid, entityType=dropin, older than 3 days.
    const unpaidSpots = await db
      .select()
      .from(spotsTable)
      .where(
        and(
          eq(spotsTable.status, "reserved"),
          eq((spotsTable as any).paymentStatus, "unpaid"),
          eq(spotsTable.entityType, "dropin"),
          lte(spotsTable.createdAt, threeDaysAgo),
        ),
      );

    if (unpaidSpots.length === 0) return;

    const spotUserIds = [...new Set(unpaidSpots.map((s) => s.userId).filter((id): id is number => id != null))];
    if (spotUserIds.length === 0) return;

    const spotPlayers = await db
      .select()
      .from(usersTable)
      .where(inArray(usersTable.id, spotUserIds));

    const spotPlayerMap = new Map(spotPlayers.map((p) => [p.id, p]));

    // Build set of (userId clerkId, entityId) pairs that already appear in paid registrations,
    // so we don't send a duplicate reminder when both a spot and a paid registration exist.
    const paidRegKeys = new Set<string>();
    if (spotUserIds.length > 0) {
      const spotClerkIds = spotPlayers.map((p) => p.clerkId);
      // Include all canonical paid statuses: paid_inapp (Stripe), paid_external (cash/offline),
      // and waived (admin override). Any of these means the player has settled their drop-in
      // obligation and should NOT receive a payment-due reminder.
      const paidDropinRegs = await db
        .select({ userId: registrationsTable.userId, programId: registrationsTable.programId })
        .from(registrationsTable)
        .where(
          and(
            eq(registrationsTable.programType, "drop_in"),
            inArray(registrationsTable.paymentStatus, ["paid_inapp", "paid_external", "waived"]),
            ne(registrationsTable.status, "cancelled"),
            inArray(registrationsTable.userId, spotClerkIds),
          ),
        );
      for (const r of paidDropinRegs) {
        paidRegKeys.add(`${r.userId}-${r.programId}`);
      }
    }

    for (const spot of unpaidSpots) {
      if (!spot.userId) continue;
      const player = spotPlayerMap.get(spot.userId);
      if (!player) continue;

      // Skip if already covered by a paid registration for this user+session
      const regKey = `${player.clerkId}-${spot.entityId}`;
      if (paidRegKeys.has(regKey)) continue;

      // Skip if reminder already sent by Part 1 or earlier today
      if (sentThisRun.has(player.id)) continue;
      const alreadySent = await alreadySentToday(player.id, "payment_due");
      if (alreadySent) continue;

      await sendNotificationWithPreferences({
        userId: player.id,
        type: "payment_due",
        subject: "Payment due for your drop-in spot",
        body: `You have an unpaid drop-in spot (session #${spot.entityId}). Please complete your payment at playonfutsal.vercel.app — PlayOn`,
        metadata: { spotId: spot.id, dropinId: spot.entityId },
      });
      sentThisRun.add(player.id);
    }
  } catch (err) {
    console.error("[reminders] payment_due error:", err);
  }
}

async function runBalanceDueReminders(): Promise<void> {
  try {
    const now = new Date();
    const sevenDaysOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const upcomingFixtures = await db
      .select()
      .from(fixturesTable)
      .where(
        and(
          gte(fixturesTable.scheduledAt, now),
          lte(fixturesTable.scheduledAt, sevenDaysOut),
        ),
      );

    if (upcomingFixtures.length === 0) return;

    const teamIds = new Set<number>();
    for (const f of upcomingFixtures) {
      if (f.homeTeamId) teamIds.add(f.homeTeamId);
      if (f.awayTeamId) teamIds.add(f.awayTeamId);
    }

    if (teamIds.size === 0) return;

    const members = await db
      .select()
      .from(teamMembersTable)
      .where(inArray(teamMembersTable.teamId, Array.from(teamIds)));

    const clerkIds = [...new Set(members.map((m) => m.userId))];
    if (clerkIds.length === 0) return;

    const unpaidRegs = await db
      .select()
      .from(registrationsTable)
      .where(
        and(
          inArray(registrationsTable.userId, clerkIds),
          eq(registrationsTable.paymentStatus, "unpaid"),
          ne(registrationsTable.status, "cancelled"),
        ),
      );

    if (unpaidRegs.length === 0) return;

    const players = await db
      .select()
      .from(usersTable)
      .where(inArray(usersTable.clerkId, [...new Set(unpaidRegs.map((r) => r.userId))]));

    const playerMap = new Map(players.map((p) => [p.clerkId, p]));

    for (const reg of unpaidRegs) {
      const player = playerMap.get(reg.userId);
      if (!player) continue;

      const alreadySent = await alreadySentToday(player.id, "balance_due");
      if (alreadySent) continue;

      await sendNotificationWithPreferences({
        userId: player.id,
        type: "balance_due",
        subject: "Balance due before your first game",
        body: `You have an unpaid balance for ${reg.programName} and a game is coming up within 7 days. Please pay now at playonfutsal.vercel.app — PlayOn`,
        metadata: { registrationId: reg.id },
      });
    }
  } catch (err) {
    console.error("[reminders] balance_due error:", err);
  }
}

async function runAllJobs(): Promise<void> {
  console.info("[reminders] running scheduled reminder jobs");
  await Promise.allSettled([
    runUpcomingSessionReminders(),
    runPaymentDueReminders(),
    runBalanceDueReminders(),
  ]);
  console.info("[reminders] reminder jobs complete");
}

export function startReminderScheduler(): void {
  runAllJobs().catch((err) => console.error("[reminders] startup run error:", err));
  setInterval(() => {
    runAllJobs().catch((err) => console.error("[reminders] scheduled run error:", err));
  }, JOB_INTERVAL_MS);
  console.info("[reminders] scheduler started — runs every 60 minutes");
}
