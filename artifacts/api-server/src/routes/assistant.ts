/**
 * AI Help Assistant Routes (P10)
 *
 * Role-aware, RBAC-enforced AI chat assistant. All Anthropic calls are
 * server-side; the API key is never exposed to the client.
 *
 * Model: claude-sonnet-4-5
 *
 * GET  /assistant/conversations         — list my conversations (newest first)
 * POST /assistant/conversations         — start a new conversation
 * GET  /assistant/conversations/:id     — get conversation + full message history
 * DELETE /assistant/conversations/:id  — delete conversation
 * POST /assistant/conversations/:id/chat — send a message, receive AI response
 * POST /assistant/draft-announcement   — admin-only: draft an announcement text
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  assistantConversationsTable, usersTable, registrationsTable,
  fixturesTable, paymentsTable, assignmentsTable,
  leaguesTable, campsTable, tournamentsTable, dropinsTable,
  teamMembersTable, staffProfilesTable, guardiansTable,
} from "@workspace/db";
import { eq, and, desc, asc, gte, lt, or, ne, sql } from "drizzle-orm";
import { requireAuth, type AuthedRequest } from "../middlewares/auth";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import type { Request } from "express";

const router = Router();

const ASSISTANT_MODEL = "claude-sonnet-4-5";
const MAX_HISTORY_MESSAGES = 20; // keep last N turns for context window

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

// ── RBAC context injection ────────────────────────────────────────────────────
// Returns a lean, role-scoped context string injected into the system prompt.
// Context is read-only; the AI never writes to the DB.

/**
 * Shared helper: inject registrations and upcoming fixtures for a given
 * Clerk user ID (works for players directly and for guardian children).
 * `indent` allows nesting child data under a "CHILD:" heading.
 */
async function injectPlayerContext(
  clerkId: string,
  lines: string[],
  now: Date,
  indent = "",
): Promise<void> {
  const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const myRegistrations = await db.select().from(registrationsTable)
    .where(eq(registrationsTable.userId, clerkId))
    .orderBy(desc(registrationsTable.createdAt))
    .limit(10);

  if (myRegistrations.length) {
    lines.push(`${indent}REGISTRATIONS:`);
    myRegistrations.forEach(r => {
      lines.push(`${indent}  [id=${r.id}] ${r.programName} (${r.programType}) — status:${r.status} payment:${r.paymentStatus} paid:$${r.amountPaid}`);
    });
    const unpaid = myRegistrations.filter(r => r.paymentStatus === "unpaid" && r.status !== "cancelled");
    if (unpaid.length) {
      lines.push(`${indent}  UNPAID: ${unpaid.length} registration(s) need payment.`);
    }
  } else {
    lines.push(`${indent}REGISTRATIONS: none`);
  }

  // Find teams → upcoming fixtures
  const myTeamMemberships = await db.select({ teamId: teamMembersTable.teamId })
    .from(teamMembersTable)
    .where(eq(teamMembersTable.userId, clerkId))
    .limit(10);

  if (myTeamMemberships.length) {
    const teamIds = myTeamMemberships.map(m => m.teamId);
    const teamConditions = teamIds.flatMap(id => [
      eq(fixturesTable.homeTeamId, id),
      eq(fixturesTable.awayTeamId, id),
    ]);
    const myFixtures = await db.select({
      id: fixturesTable.id,
      entityType: fixturesTable.entityType,
      scheduledAt: fixturesTable.scheduledAt,
      status: fixturesTable.status,
      courtId: fixturesTable.courtId,
    }).from(fixturesTable)
      .where(and(
        gte(fixturesTable.scheduledAt, now),
        lt(fixturesTable.scheduledAt, weekAhead),
        or(...teamConditions),
      ))
      .orderBy(asc(fixturesTable.scheduledAt))
      .limit(5);

    if (myFixtures.length) {
      lines.push(`${indent}UPCOMING FIXTURES:`);
      myFixtures.forEach(f => {
        const dt = f.scheduledAt
          ? new Date(f.scheduledAt).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
          : "TBD";
        lines.push(`${indent}  [id=${f.id}] ${f.entityType} — ${dt} — court:${f.courtId ?? "TBD"} — ${f.status}`);
      });
    }
  }
}

async function buildUserContext(
  dbUser: typeof usersTable.$inferSelect
): Promise<string> {
  const lines: string[] = [];
  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const weekBehind = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  lines.push(`USER: ${dbUser.firstName ?? ""} ${dbUser.lastName ?? ""} <${dbUser.email}>`);
  lines.push(`ROLE: ${dbUser.role}`);
  lines.push(`DATE: ${now.toISOString().split("T")[0]}`);
  lines.push("");

  if (dbUser.role === "admin") {
    // Full platform overview — admins have unrestricted access
    const [[lgCount], [campCount], [tCount], [diCount]] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(leaguesTable),
      db.select({ count: sql<number>`count(*)::int` }).from(campsTable),
      db.select({ count: sql<number>`count(*)::int` }).from(tournamentsTable),
      db.select({ count: sql<number>`count(*)::int` }).from(dropinsTable),
    ]);

    lines.push("PLATFORM OVERVIEW:");
    lines.push(`  Leagues: ${lgCount.count}, Camps: ${campCount.count}, Tournaments: ${tCount.count}, Drop-ins: ${diCount.count}`);

    // Unpaid registrations
    const [unpaidCount] = await db.select({ count: sql<number>`count(*)::int` })
      .from(registrationsTable)
      .where(and(
        eq(registrationsTable.paymentStatus, "unpaid"),
        ne(registrationsTable.status, "cancelled"),
      ));
    lines.push(`  Unpaid registrations: ${unpaidCount.count}`);

    // Recent payments (last 7 days)
    const [recentPayments] = await db.select({
      count: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(amount::numeric), 0)::int`,
    }).from(paymentsTable)
      .where(and(
        gte(paymentsTable.createdAt, weekBehind),
        eq(paymentsTable.status, "succeeded"),
      ));
    lines.push(`  Payments this week: ${recentPayments.count} totaling $${recentPayments.total}`);

    // Active leagues (top 5)
    const activeLeagues = await db.select({
      id: leaguesTable.id,
      name: leaguesTable.name,
      status: leaguesTable.status,
      ageGroup: leaguesTable.ageGroup,
    }).from(leaguesTable)
      .where(eq(leaguesTable.status, "active"))
      .orderBy(desc(leaguesTable.createdAt))
      .limit(5);

    if (activeLeagues.length) {
      lines.push("\nACTIVE LEAGUES:");
      activeLeagues.forEach(l => lines.push(`  [id=${l.id}] ${l.name} (${l.ageGroup}, ${l.status})`));
    }

    // Upcoming fixtures this week
    const upcomingFixtures = await db.select({
      id: fixturesTable.id,
      entityType: fixturesTable.entityType,
      entityId: fixturesTable.entityId,
      scheduledAt: fixturesTable.scheduledAt,
      status: fixturesTable.status,
    }).from(fixturesTable)
      .where(and(
        gte(fixturesTable.scheduledAt, now),
        lt(fixturesTable.scheduledAt, weekAhead),
        eq(fixturesTable.status, "scheduled"),
      ))
      .orderBy(asc(fixturesTable.scheduledAt))
      .limit(10);

    if (upcomingFixtures.length) {
      lines.push(`\nFIXTURES THIS WEEK: ${upcomingFixtures.length}`);
      upcomingFixtures.slice(0, 5).forEach(f => {
        const dt = f.scheduledAt ? new Date(f.scheduledAt).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "TBD";
        lines.push(`  [id=${f.id}] ${f.entityType} #${f.entityId} — ${dt} — ${f.status}`);
      });
    }

  } else if (dbUser.role === "staff") {
    // Staff: context is scoped to their granted permissions only.
    // Load staff profile to determine what they can see.
    const [staffProfile] = await db.select().from(staffProfilesTable)
      .where(and(
        eq(staffProfilesTable.userId, dbUser.id),
        eq(staffProfilesTable.isActive, true),
      ));

    if (!staffProfile) {
      lines.push("STAFF NOTE: No active staff profile found. Limited context available.");
    } else {
      lines.push("STAFF PERMISSIONS:");
      const perms: string[] = [];
      if (staffProfile.canManageLeagues) perms.push("leagues");
      if (staffProfile.canManageCamps) perms.push("camps");
      if (staffProfile.canManageDropins) perms.push("drop-ins");
      if (staffProfile.canManageTournaments) perms.push("tournaments");
      if (staffProfile.canViewRegistrations) perms.push("view-registrations");
      if (staffProfile.canEditRegistrations) perms.push("edit-registrations");
      if (staffProfile.canManageUsers) perms.push("manage-users");
      if (staffProfile.canViewReports) perms.push("view-reports");
      if (staffProfile.canManageSchedules) perms.push("manage-schedules");
      if (staffProfile.canManageAssignments) perms.push("manage-assignments");
      lines.push(`  Granted: ${perms.length ? perms.join(", ") : "none"}`);

      // Inject data only for permissions the staff member holds
      const dataFetches: Promise<void>[] = [];

      if (staffProfile.canViewRegistrations) {
        dataFetches.push((async () => {
          const [unpaidCount] = await db.select({ count: sql<number>`count(*)::int` })
            .from(registrationsTable)
            .where(and(
              eq(registrationsTable.paymentStatus, "unpaid"),
              ne(registrationsTable.status, "cancelled"),
            ));
          lines.push(`\nUNPAID REGISTRATIONS: ${unpaidCount.count}`);
        })());
      }

      if (staffProfile.canViewReports) {
        dataFetches.push((async () => {
          const [recentPayments] = await db.select({
            count: sql<number>`count(*)::int`,
            total: sql<number>`coalesce(sum(amount::numeric), 0)::int`,
          }).from(paymentsTable)
            .where(and(
              gte(paymentsTable.createdAt, weekBehind),
              eq(paymentsTable.status, "succeeded"),
            ));
          lines.push(`\nPAYMENTS THIS WEEK: ${recentPayments.count} totaling $${recentPayments.total}`);
        })());
      }

      if (staffProfile.canManageLeagues || staffProfile.canManageSchedules) {
        dataFetches.push((async () => {
          const activeLeagues = await db.select({
            id: leaguesTable.id,
            name: leaguesTable.name,
            status: leaguesTable.status,
            ageGroup: leaguesTable.ageGroup,
          }).from(leaguesTable)
            .where(eq(leaguesTable.status, "active"))
            .orderBy(desc(leaguesTable.createdAt))
            .limit(5);

          if (activeLeagues.length) {
            lines.push("\nACTIVE LEAGUES (your scope):");
            activeLeagues.forEach(l => lines.push(`  [id=${l.id}] ${l.name} (${l.ageGroup}, ${l.status})`));
          }
        })());
      }

      if (staffProfile.canManageSchedules || staffProfile.canManageAssignments) {
        dataFetches.push((async () => {
          const upcomingFixtures = await db.select({
            id: fixturesTable.id,
            entityType: fixturesTable.entityType,
            entityId: fixturesTable.entityId,
            scheduledAt: fixturesTable.scheduledAt,
            status: fixturesTable.status,
          }).from(fixturesTable)
            .where(and(
              gte(fixturesTable.scheduledAt, now),
              lt(fixturesTable.scheduledAt, weekAhead),
              eq(fixturesTable.status, "scheduled"),
            ))
            .orderBy(asc(fixturesTable.scheduledAt))
            .limit(10);

          if (upcomingFixtures.length) {
            lines.push(`\nFIXTURES THIS WEEK: ${upcomingFixtures.length}`);
            upcomingFixtures.slice(0, 5).forEach(f => {
              const dt = f.scheduledAt ? new Date(f.scheduledAt).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "TBD";
              lines.push(`  [id=${f.id}] ${f.entityType} #${f.entityId} — ${dt} — ${f.status}`);
            });
          }
        })());
      }

      await Promise.all(dataFetches);
    }

  } else if (dbUser.role === "player") {
    // Player: own registrations, upcoming fixtures
    await injectPlayerContext(dbUser.clerkId, lines, now);

  } else if (dbUser.role === "parent") {
    // Guardian: show own registrations AND each linked child's registrations/fixtures
    // Own activity first
    await injectPlayerContext(dbUser.clerkId, lines, now);

    // Load linked children (approved guardian relationships only)
    const childLinks = await db
      .select({ youthUserId: guardiansTable.youthUserId })
      .from(guardiansTable)
      .where(and(
        eq(guardiansTable.guardianUserId, dbUser.id),
        eq(guardiansTable.status, "approved"),
      ));

    if (childLinks.length) {
      const childDbIds = childLinks.map(c => c.youthUserId);
      // Load each child's DB record to get their clerkId (needed for registrations/teamMembers)
      const childUsers = await db
        .select({ id: usersTable.id, clerkId: usersTable.clerkId, firstName: usersTable.firstName, lastName: usersTable.lastName })
        .from(usersTable)
        .where(or(...childDbIds.map(id => eq(usersTable.id, id))));

      for (const child of childUsers) {
        lines.push(`\nCHILD: ${child.firstName ?? ""} ${child.lastName ?? ""}`);
        await injectPlayerContext(child.clerkId, lines, now, "  ");
      }
    }

  } else if (dbUser.role === "ref" || dbUser.role === "coach") {
    // Ref/coach: their assignments this week and unpaid compensation
    const myAssignments = await db.select().from(assignmentsTable)
      .where(and(
        eq(assignmentsTable.staffUserId, dbUser.id),
        or(
          and(gte(assignmentsTable.startAt, weekBehind), lt(assignmentsTable.startAt, weekAhead)),
          eq(assignmentsTable.status, "assigned"),
        ),
      ))
      .orderBy(asc(assignmentsTable.startAt))
      .limit(10);

    if (myAssignments.length) {
      lines.push("MY ASSIGNMENTS THIS WEEK:");
      myAssignments.forEach(a => {
        const dt = a.startAt ? new Date(a.startAt).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "TBD";
        lines.push(`  [id=${a.id}] ${a.entityType} #${a.entityId} — ${a.role} — ${dt} — ${a.status} — pay:${a.isPaid ? `$${a.compensationAmount} (paid)` : `$${a.compensationAmount ?? "TBD"} (unpaid)`}`);
      });
    }

    const [unpaidComp] = await db.select({
      count: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(compensation_amount::numeric), 0)::numeric`,
    }).from(assignmentsTable)
      .where(and(
        eq(assignmentsTable.staffUserId, dbUser.id),
        eq(assignmentsTable.isPaid, false),
        ne(assignmentsTable.status, "declined"),
      ));

    lines.push(`\nUNPAID COMPENSATION: ${unpaidComp.count} assignment(s) totaling ~$${unpaidComp.total}`);
  }

  return lines.join("\n");
}

function buildSystemPrompt(userContext: string, role: string): string {
  const roleInstructions: Record<string, string> = {
    admin: `You have full visibility into the platform and can answer questions about registrations, payments, schedules, rosters, standings, and operations. You can also draft announcements, emails, and notifications for the admin to review and send.`,
    staff: `You have LIMITED, scoped visibility into the platform — only data listed in your context above under your granted permissions. You MUST NOT reveal platform-wide financial totals, other users' personal data, or any data not present in your context. Answer only questions within your scope and say so honestly when something is outside it.`,
    player: `You can only access your own data — your registrations, upcoming games, balance owed, and team information. Never reveal other players' personal or financial details.`,
    parent: `You can access your own and your children's data — registrations, upcoming games, balances, and waivers. Never reveal other families' personal or financial details.`,
    ref: `You can see your own assignments, schedule, and compensation status. You can also ask about how to record results for fixtures you're assigned to.`,
    coach: `You can see your own assignments, team rosters you coach, and your compensation status.`,
  };

  const instruction = roleInstructions[role] ?? roleInstructions.player;

  return `You are the PlayOn AI Assistant — a friendly, helpful guide for the PlayOn futsal platform at the Alumni Center in Lexington, KY.

PlayOn runs four types of programs: leagues (season-based competition), camps (skill development, mainly youth), drop-in sessions (casual Friday night play), and tournaments (bracketed events). Youth and adult programming run year-round.

ROLE-SPECIFIC ACCESS: ${instruction}

CURRENT USER CONTEXT:
${userContext}

RESPONSE GUIDELINES:
- Be concise and practical. Families are busy — get to the answer fast.
- Use plain language. No jargon. No markdown headers in responses (just plain text).
- When you don't have enough data to answer precisely, say what you do know and offer to help them navigate to the right section of the app.
- NEVER reveal other users' personal, financial, or contact information.
- NEVER make up data not in the context above. If you don't know, say so honestly.
- For admins drafting announcements: produce clean, professional text they can copy and use directly.`;
}

// ── List conversations ────────────────────────────────────────────────────────

router.get("/assistant/conversations", requireAuth, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const [dbUser] = await db.select().from(usersTable)
    .where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!dbUser) { res.status(404).json({ error: "User not found" }); return; }

  const conversations = await db.select({
    id: assistantConversationsTable.id,
    title: assistantConversationsTable.title,
    isActive: assistantConversationsTable.isActive,
    lastMessageAt: assistantConversationsTable.lastMessageAt,
    createdAt: assistantConversationsTable.createdAt,
    model: assistantConversationsTable.model,
  }).from(assistantConversationsTable)
    .where(eq(assistantConversationsTable.userId, dbUser.id))
    .orderBy(desc(assistantConversationsTable.lastMessageAt))
    .limit(50);

  res.json(conversations);
});

// ── Create conversation ───────────────────────────────────────────────────────

router.post("/assistant/conversations", requireAuth, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const body = req.body as { title?: string };

  const [dbUser] = await db.select().from(usersTable)
    .where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!dbUser) { res.status(404).json({ error: "User not found" }); return; }

  const [conversation] = await db.insert(assistantConversationsTable).values({
    userId: dbUser.id,
    title: body.title ?? "New conversation",
    messages: "[]",
    model: ASSISTANT_MODEL,
    isActive: true,
    lastMessageAt: new Date(),
  }).returning();

  res.status(201).json(conversation);
});

// ── Get conversation ──────────────────────────────────────────────────────────

router.get("/assistant/conversations/:id", requireAuth, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const id = Number(req.params.id);

  const [dbUser] = await db.select({ id: usersTable.id })
    .from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!dbUser) { res.status(404).json({ error: "User not found" }); return; }

  const [conversation] = await db.select().from(assistantConversationsTable)
    .where(and(
      eq(assistantConversationsTable.id, id),
      eq(assistantConversationsTable.userId, dbUser.id),
    ));

  if (!conversation) { res.status(404).json({ error: "Conversation not found" }); return; }

  const messages: ChatMessage[] = JSON.parse(conversation.messages);
  res.json({ ...conversation, messages });
});

// ── Delete conversation ───────────────────────────────────────────────────────

router.delete("/assistant/conversations/:id", requireAuth, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const id = Number(req.params.id);

  const [dbUser] = await db.select({ id: usersTable.id })
    .from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!dbUser) { res.status(404).json({ error: "User not found" }); return; }

  await db.delete(assistantConversationsTable)
    .where(and(
      eq(assistantConversationsTable.id, id),
      eq(assistantConversationsTable.userId, dbUser.id),
    ));

  res.status(204).send();
});

// ── Send message → get AI response ───────────────────────────────────────────

router.post("/assistant/conversations/:id/chat", requireAuth, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const id = Number(req.params.id);
  const body = req.body as { message: string };

  if (!body.message?.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const [dbUser] = await db.select().from(usersTable)
    .where(eq(usersTable.clerkId, authed.clerkUserId));
  if (!dbUser) { res.status(404).json({ error: "User not found" }); return; }

  const [conversation] = await db.select().from(assistantConversationsTable)
    .where(and(
      eq(assistantConversationsTable.id, id),
      eq(assistantConversationsTable.userId, dbUser.id),
    ));
  if (!conversation) { res.status(404).json({ error: "Conversation not found" }); return; }

  // Build user context (RBAC-scoped, read-only)
  const userContext = await buildUserContext(dbUser);
  const systemPrompt = buildSystemPrompt(userContext, dbUser.role);

  // Reconstruct message history for Anthropic
  const history: ChatMessage[] = JSON.parse(conversation.messages ?? "[]");
  const recentHistory = history.slice(-MAX_HISTORY_MESSAGES);

  const anthropicMessages: { role: "user" | "assistant"; content: string }[] = [
    ...recentHistory.map(m => ({ role: m.role, content: m.content })),
    { role: "user", content: body.message.trim() },
  ];

  let assistantReply = "";
  try {
    const response = await anthropic.messages.create({
      model: ASSISTANT_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: anthropicMessages,
    });

    const block = response.content[0];
    assistantReply = block.type === "text" ? block.text : "";
  } catch (err: any) {
    console.error("Assistant chat AI error:", err?.message ?? err);
    res.status(502).json({ error: "AI service unavailable. Please try again." });
    return;
  }

  const now = new Date().toISOString();
  const newUserMsg: ChatMessage = { role: "user", content: body.message.trim(), createdAt: now };
  const newAssistantMsg: ChatMessage = { role: "assistant", content: assistantReply, createdAt: now };

  const updatedMessages = [...history, newUserMsg, newAssistantMsg];

  // Auto-title from first user message if still default
  let title = conversation.title;
  if (title === "New conversation" && updatedMessages.length <= 2) {
    title = body.message.trim().slice(0, 60) + (body.message.trim().length > 60 ? "…" : "");
  }

  await db.update(assistantConversationsTable)
    .set({
      messages: JSON.stringify(updatedMessages),
      title,
      lastMessageAt: new Date(),
      model: ASSISTANT_MODEL,
    })
    .where(eq(assistantConversationsTable.id, id));

  res.json({
    role: "assistant",
    content: assistantReply,
    createdAt: now,
    conversationId: id,
    title,
  });
});

// ── Admin: draft announcement ─────────────────────────────────────────────────
// POST /assistant/draft-announcement
// Body: { topic: string, context?: string }
// Returns: { draft: string }
// Admins can copy the draft and send it through the notification system.

router.post("/assistant/draft-announcement", requireAuth, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const [dbUser] = await db.select().from(usersTable)
    .where(eq(usersTable.clerkId, authed.clerkUserId));

  if (!dbUser || dbUser.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }

  const body = req.body as { topic: string; tone?: string; context?: string };
  if (!body.topic?.trim()) {
    res.status(400).json({ error: "topic is required" });
    return;
  }

  const systemPrompt = `You are helping a PlayOn futsal admin draft a clear, professional announcement for players and families.
PlayOn is a futsal brand at the Alumni Center in Lexington, KY.
Write in a friendly, direct tone. Keep it concise (2-4 short paragraphs max).
Include: what happened / what's changing, what players/families need to do (if anything), and any key details (dates, times, locations).
Output ONLY the announcement text — no subject line, no JSON wrapper, no markdown formatting.`;

  const userContent = `Draft an announcement about: "${body.topic}"${body.context ? `\n\nAdditional context: ${body.context}` : ""}${body.tone ? `\n\nTone: ${body.tone}` : ""}`;

  let draft = "";
  try {
    const response = await anthropic.messages.create({
      model: ASSISTANT_MODEL,
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    });
    const block = response.content[0];
    draft = block.type === "text" ? block.text : "";
  } catch (err: any) {
    console.error("Assistant draft-announcement AI error:", err?.message ?? err);
    res.status(502).json({ error: "AI service unavailable. Please try again." });
    return;
  }

  res.json({ draft });
});

export default router;
