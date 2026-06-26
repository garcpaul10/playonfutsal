import { Router, type IRouter } from "express";
import {
  db,
  kotcSeasonsTable, kotcBattlesTable, kotcBattleModsTable,
  kotcTeamsTable, kotcTeamPlayersTable,
  kotcBattleRegistrationsTable, kotcRotationQueuesTable,
  kotcGameCardsTable, kotcLifeLedgerTable,
  kotcDramaRulesTable, kotcWaitlistTable, kotcPendingPurchasesTable,
  usersTable, guardiansTable, qrCodesTable, paymentsTable,
} from "@workspace/db";
import { eq, and, asc, desc, sql, inArray, or } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { getAuth } from "@clerk/express";
import { randomUUID } from "crypto";
import { sendNotificationWithPreferences, sendMultiChannelNotification } from "../services/notifications";
import { generateQrDataUri } from "../services/qr";
import { getUncachableStripeClient } from "../lib/stripe";
import { computeRevenueSplit, recordRevenue } from "../services/revenueComputation";

const router: IRouter = Router();

async function getDbUser(clerkId: string) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  return user;
}

async function isBattleModOrAdmin(battleId: number, userId: number, role: string | null): Promise<boolean> {
  if (role === "admin") return true;
  const [mod] = await db
    .select()
    .from(kotcBattleModsTable)
    .where(and(eq(kotcBattleModsTable.battleId, battleId), eq(kotcBattleModsTable.userId, userId)));
  return !!mod;
}

// Court-scoped mod auth: moderator must be assigned specifically to this court (or be admin).
async function isBattleModOrAdminForCourt(battleId: number, courtNumber: number, userId: number, role: string | null): Promise<boolean> {
  if (role === "admin") return true;
  const [mod] = await db
    .select()
    .from(kotcBattleModsTable)
    .where(and(
      eq(kotcBattleModsTable.battleId, battleId),
      eq(kotcBattleModsTable.userId, userId),
      eq(kotcBattleModsTable.courtNumber, courtNumber),
    ));
  return !!mod;
}

async function isTeamMemberOrAdmin(teamId: number, userId: number, role: string | null): Promise<boolean> {
  if (role === "admin") return true;
  const [member] = await db
    .select()
    .from(kotcTeamPlayersTable)
    .where(and(
      eq(kotcTeamPlayersTable.teamId, teamId),
      eq(kotcTeamPlayersTable.userId, userId),
      eq(kotcTeamPlayersTable.status, "active"),
    ));
  return !!member;
}

async function hasApprovedGuardian(youthUserId: number): Promise<boolean> {
  const [guardian] = await db
    .select()
    .from(guardiansTable)
    .where(and(
      eq(guardiansTable.youthUserId, youthUserId),
      eq(guardiansTable.status, "approved"),
    ));
  return !!guardian;
}

// Returns true if the season's gender OR age bracket indicates a youth event requiring guardian approval.
// Youth criteria: gender bracket is boys/girls OR age bracket is U18 or below.
function isYouthBracket(genderBracket: string, ageBracket: string): boolean {
  if (["girls", "boys"].includes((genderBracket || "").toLowerCase())) return true;
  const uMatch = (ageBracket || "").toLowerCase().match(/^u(\d+)$/);
  if (uMatch && Number(uMatch[1]) <= 18) return true;
  return false;
}

function isYouthByDob(dateOfBirth: string | null): boolean {
  if (!dateOfBirth) return false;
  const ageDiff = Date.now() - new Date(dateOfBirth).getTime();
  const ageYears = ageDiff / (1000 * 60 * 60 * 24 * 365.25);
  return ageYears < 18;
}

function genderMatchesBracket(userGender: string | null, bracket: string): boolean {
  if (bracket === "coed" || bracket === "open") return true;
  if (!userGender) return true; // can't enforce without data — allow but flag
  const g = userGender.toLowerCase();
  if (bracket === "men" && (g === "male" || g === "man" || g === "m")) return true;
  if (bracket === "women" && (g === "female" || g === "woman" || g === "f" || g === "w")) return true;
  if (bracket === "boys" && (g === "male" || g === "man" || g === "m")) return true;
  if (bracket === "girls" && (g === "female" || g === "woman" || g === "f" || g === "w")) return true;
  return false;
}

function ageMatchesBracket(dateOfBirth: string | null, ageBracket: string): boolean {
  if (!ageBracket || ageBracket === "open") return true;
  if (!dateOfBirth) return true; // can't enforce without DOB on file
  const ageDiff = Date.now() - new Date(dateOfBirth).getTime();
  const ageYears = ageDiff / (1000 * 60 * 60 * 24 * 365.25);
  // Adult bracket: must be 18 or older
  if (ageBracket === "adult") return ageYears >= 18;
  // Handle "uNN" format (e.g. "u14", "u16", "u18") — must be strictly under that age
  const uMatch = ageBracket.toLowerCase().match(/^u(\d+)$/);
  if (uMatch) {
    const maxAge = parseInt(uMatch[1], 10);
    return ageYears < maxAge;
  }
  // Handle "NN+" format (e.g. "18+") — must be at least that age
  const plusMatch = ageBracket.match(/^(\d+)\+$/);
  if (plusMatch) {
    const minAge = parseInt(plusMatch[1], 10);
    return ageYears >= minAge;
  }
  return true; // unknown custom format — allow
}

// ─── Seasons ──────────────────────────────────────────────────────────────────

router.get("/kotc/seasons", requireAuth, async (req, res) => {
  try {
    const seasons = await db
      .select()
      .from(kotcSeasonsTable)
      .orderBy(desc(kotcSeasonsTable.createdAt));
    res.json(seasons);
  } catch (err) {
    console.error("[kotc] GET /kotc/seasons:", err);
    res.status(500).json({ error: "Failed to fetch seasons" });
  }
});

router.get("/kotc/seasons/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [season] = await db.select().from(kotcSeasonsTable).where(eq(kotcSeasonsTable.id, id));
    if (!season) return void res.status(404).json({ error: "Season not found" });

    // Gate visibility: unpublished seasons only accessible to admins
    if (!season.isPublished) {
      const { userId: clerkId } = getAuth(req);
      const user = clerkId ? await getDbUser(clerkId) : null;
      if (!user || user.role !== "admin") {
        return void res.status(404).json({ error: "Season not found" });
      }
    }

    res.json(season);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch season" });
  }
});

// ─── Team QR Code (captain-only, rendered via qr.ts service) ───────────────────

router.get("/kotc/teams/:id/qr", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { userId: clerkId } = getAuth(req);
    const user = await getDbUser(clerkId!);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    const [team] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.id, id));
    if (!team) return void res.status(404).json({ error: "Team not found" });

    if (team.captainUserId !== user.id && user.role !== "admin") {
      return void res.status(403).json({ error: "Only the team captain or an admin may access the team QR code" });
    }

    const dataUri = await generateQrDataUri(team.qrCode);
    res.json({ qrCode: team.qrCode, dataUri, scope: "kotc_captain" });
  } catch (err) {
    console.error("[kotc] GET team qr:", err);
    res.status(500).json({ error: "Failed to generate QR code" });
  }
});

const VALID_GENDER_BRACKETS = ["coed", "men", "women", "girls", "boys"] as const;
const VALID_AGE_BRACKETS = ["open", "u12", "u14", "u16", "u18", "adult", "custom"] as const;

router.post("/kotc/seasons", requireAdmin, async (req, res) => {
  try {
    const {
      name, sport, sportConfig, genderBracket, ageBracket, teamSize,
      winCondition, winTarget, timeLimitMinutes, gracePeriodSeconds,
      livesRequired, maxTeamsPerCourt, startsAt, endsAt, venueId, notes,
    } = req.body;

    if (!name) return void res.status(400).json({ error: "Season name is required" });
    if (genderBracket && !VALID_GENDER_BRACKETS.includes((genderBracket as string).toLowerCase() as typeof VALID_GENDER_BRACKETS[number])) {
      return void res.status(400).json({ error: `Invalid genderBracket. Must be one of: ${VALID_GENDER_BRACKETS.join(", ")}` });
    }
    if (ageBracket && !VALID_AGE_BRACKETS.includes((ageBracket as string).toLowerCase() as typeof VALID_AGE_BRACKETS[number])) {
      return void res.status(400).json({ error: `Invalid ageBracket. Must be one of: ${VALID_AGE_BRACKETS.join(", ")}` });
    }
    if (winCondition && !["points", "time_limit"].includes(winCondition)) {
      return void res.status(400).json({ error: "winCondition must be 'points' or 'time_limit'" });
    }

    const isYouth = isYouthBracket(genderBracket || "", ageBracket || "");

    const [season] = await db.insert(kotcSeasonsTable).values({
      name,
      sport: sport || "basketball",
      sportConfig: sportConfig || {},
      genderBracket: genderBracket || "coed",
      ageBracket: ageBracket || "open",
      teamSize: teamSize || 4,
      winCondition: winCondition || "points",
      winTarget: winTarget || 7,
      timeLimitMinutes: timeLimitMinutes || 5,
      gracePeriodSeconds: gracePeriodSeconds || 60,
      livesRequired: livesRequired || 3,
      maxTeamsPerCourt: maxTeamsPerCourt || 8,
      startsAt: startsAt ? new Date(startsAt) : null,
      endsAt: endsAt ? new Date(endsAt) : null,
      venueId: venueId || null,
      isYouth,
      notes: notes || null,
    }).returning();

    res.status(201).json(season);
  } catch (err) {
    console.error("[kotc] POST /kotc/seasons:", err);
    res.status(500).json({ error: "Failed to create season" });
  }
});

router.patch("/kotc/seasons/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const updates: Record<string, unknown> = {};
    const allowed = [
      "name", "sport", "sportConfig", "genderBracket", "ageBracket", "teamSize",
      "winCondition", "winTarget", "timeLimitMinutes", "gracePeriodSeconds",
      "livesRequired", "maxTeamsPerCourt", "status", "startsAt", "endsAt",
      "venueId", "notes", "championTeamId", "lifePacks", "waitlistWindowMinutes",
    ];
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (req.body.genderBracket !== undefined) {
      const gb = (req.body.genderBracket as string).toLowerCase();
      if (!VALID_GENDER_BRACKETS.includes(gb as typeof VALID_GENDER_BRACKETS[number])) {
        return void res.status(400).json({ error: `Invalid genderBracket. Must be one of: ${VALID_GENDER_BRACKETS.join(", ")}` });
      }
    }
    if (req.body.ageBracket !== undefined) {
      const ab = (req.body.ageBracket as string).toLowerCase();
      if (!VALID_AGE_BRACKETS.includes(ab as typeof VALID_AGE_BRACKETS[number])) {
        return void res.status(400).json({ error: `Invalid ageBracket. Must be one of: ${VALID_AGE_BRACKETS.join(", ")}` });
      }
    }
    if (req.body.winCondition !== undefined && !["points", "time_limit"].includes(req.body.winCondition)) {
      return void res.status(400).json({ error: "winCondition must be 'points' or 'time_limit'" });
    }
    if (req.body.genderBracket !== undefined || req.body.ageBracket !== undefined) {
      const gb = req.body.genderBracket ?? (await db.select().from(kotcSeasonsTable).where(eq(kotcSeasonsTable.id, id)))[0]?.genderBracket ?? "";
      const ab = req.body.ageBracket ?? (await db.select().from(kotcSeasonsTable).where(eq(kotcSeasonsTable.id, id)))[0]?.ageBracket ?? "";
      updates.isYouth = isYouthBracket(gb, ab);
    }
    if (req.body.startsAt) updates.startsAt = new Date(req.body.startsAt);
    if (req.body.endsAt) updates.endsAt = new Date(req.body.endsAt);

    const [season] = await db
      .update(kotcSeasonsTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(kotcSeasonsTable.id, id))
      .returning();

    if (!season) return void res.status(404).json({ error: "Season not found" });
    res.json(season);
  } catch (err) {
    res.status(500).json({ error: "Failed to update season" });
  }
});

// ─── Battles ──────────────────────────────────────────────────────────────────

router.get("/kotc/seasons/:seasonId/battles", async (req, res) => {
  try {
    const seasonId = Number(req.params.seasonId);
    const [season] = await db.select({ isPublished: kotcSeasonsTable.isPublished }).from(kotcSeasonsTable).where(eq(kotcSeasonsTable.id, seasonId));
    if (!season) return void res.status(404).json({ error: "Season not found" });
    if (!season.isPublished) {
      const { userId: clerkId } = getAuth(req);
      const user = clerkId ? await getDbUser(clerkId) : null;
      if (!user || user.role !== "admin") return void res.status(404).json({ error: "Season not found" });
    }
    const battles = await db
      .select()
      .from(kotcBattlesTable)
      .where(eq(kotcBattlesTable.seasonId, seasonId))
      .orderBy(asc(kotcBattlesTable.scheduledAt));
    res.json(battles);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch battles" });
  }
});

router.get("/kotc/battles/:id", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [battle] = await db.select().from(kotcBattlesTable).where(eq(kotcBattlesTable.id, id));
    if (!battle) return void res.status(404).json({ error: "Battle not found" });

    const mods = await db
      .select()
      .from(kotcBattleModsTable)
      .where(eq(kotcBattleModsTable.battleId, id));

    const registrations = await db
      .select()
      .from(kotcBattleRegistrationsTable)
      .where(eq(kotcBattleRegistrationsTable.battleId, id));

    res.json({ ...battle, mods, registrations });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch battle" });
  }
});

router.post("/kotc/seasons/:seasonId/battles", requireAdmin, async (req, res) => {
  try {
    const seasonId = Number(req.params.seasonId);
    const { scheduledAt, venueId, courtIds, courtCount, maxTeamsPerCourt, durationMinutes, notes } = req.body;

    const resolvedCourtCount = Array.isArray(courtIds) && courtIds.length > 0
      ? courtIds.length
      : (courtCount || 1);

    const [battle] = await db.insert(kotcBattlesTable).values({
      seasonId,
      scheduledAt: new Date(scheduledAt),
      venueId: venueId || null,
      courtIds: Array.isArray(courtIds) && courtIds.length > 0 ? courtIds : null,
      courtCount: resolvedCourtCount,
      maxTeamsPerCourt: maxTeamsPerCourt || 8,
      durationMinutes: durationMinutes || 120,
      notes: notes || null,
    }).returning();

    // Pre-battle 30-min reminder: schedule notification to all registered teams 30 min before start
    if (scheduledAt) {
      const msUntilStart = new Date(scheduledAt).getTime() - Date.now();
      const msUntilReminder = msUntilStart - 30 * 60 * 1000;
      if (msUntilReminder > 0) {
        setTimeout(async () => {
          try {
            const regs = await db
              .select()
              .from(kotcBattleRegistrationsTable)
              .where(and(
                eq(kotcBattleRegistrationsTable.battleId, battle.id),
                eq(kotcBattleRegistrationsTable.status, "registered"),
              ));
            const teamIds = regs.map((r) => r.teamId);
            if (teamIds.length === 0) return;
            const players = await db
              .select()
              .from(kotcTeamPlayersTable)
              .where(and(
                inArray(kotcTeamPlayersTable.teamId, teamIds),
                eq(kotcTeamPlayersTable.status, "active"),
              ));
            const uniqueUids = [...new Set(players.map((p) => p.userId))];
            for (const uid of uniqueUids) {
              sendMultiChannelNotification(["push", "in_app"], {
                userId: uid,
                type: "kotc_rules_reminder",
                subject: "⚔️ Battle Starting in 30 Minutes!",
                body: "Your Kings of The Court battle starts in 30 minutes. Head to the court and get warmed up!",
              }).catch(() => {});
            }
          } catch (e) {
            console.error("[kotc] pre-battle reminder:", e);
          }
        }, msUntilReminder);
      }
    }

    res.status(201).json(battle);
  } catch (err) {
    console.error("[kotc] POST battles:", err);
    res.status(500).json({ error: "Failed to create battle" });
  }
});

router.patch("/kotc/battles/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const updates: Record<string, unknown> = {};
    const allowed = ["scheduledAt", "venueId", "courtIds", "courtCount", "maxTeamsPerCourt", "durationMinutes", "status", "notes"];
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (req.body.scheduledAt) updates.scheduledAt = new Date(req.body.scheduledAt);
    if (Array.isArray(req.body.courtIds) && req.body.courtIds.length > 0) {
      updates.courtCount = req.body.courtIds.length;
    }

    const [battle] = await db
      .update(kotcBattlesTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(kotcBattlesTable.id, id))
      .returning();

    if (!battle) return void res.status(404).json({ error: "Battle not found" });
    res.json(battle);
  } catch (err) {
    res.status(500).json({ error: "Failed to update battle" });
  }
});

// ─── Battle Moderator Assignment ───────────────────────────────────────────────

router.post("/kotc/battles/:id/mods", requireAdmin, async (req, res) => {
  try {
    const battleId = Number(req.params.id);
    const { userId, courtNumber } = req.body;

    await db.delete(kotcBattleModsTable).where(
      and(eq(kotcBattleModsTable.battleId, battleId), eq(kotcBattleModsTable.courtNumber, courtNumber || 1))
    );

    const [mod] = await db.insert(kotcBattleModsTable).values({
      battleId,
      userId: Number(userId),
      courtNumber: courtNumber || 1,
    }).returning();

    res.status(201).json(mod);
  } catch (err) {
    res.status(500).json({ error: "Failed to assign moderator" });
  }
});

router.delete("/kotc/battles/:id/mods/:modId", requireAdmin, async (req, res) => {
  try {
    await db.delete(kotcBattleModsTable).where(eq(kotcBattleModsTable.id, Number(req.params.modId)));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to remove moderator" });
  }
});

// ─── Moderator: My Battles ──────────────────────────────────────────────────

router.get("/kotc/my-battles", requireAuth, async (req, res) => {
  try {
    const { userId: clerkId } = getAuth(req);
    const user = await getDbUser(clerkId!);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    const mods = await db
      .select()
      .from(kotcBattleModsTable)
      .where(eq(kotcBattleModsTable.userId, user.id));

    if (mods.length === 0) return void res.json([]);

    const battleIds = mods.map((m) => m.battleId);
    const battles = await db
      .select()
      .from(kotcBattlesTable)
      .where(inArray(kotcBattlesTable.id, battleIds))
      .orderBy(asc(kotcBattlesTable.scheduledAt));

    res.json(battles.map((b) => ({
      ...b,
      courtNumber: mods.find((m) => m.battleId === b.id)?.courtNumber ?? 1,
    })));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch moderator battles" });
  }
});

// ─── Teams ────────────────────────────────────────────────────────────────────

router.get("/kotc/seasons/:seasonId/teams", async (req, res) => {
  try {
    const seasonId = Number(req.params.seasonId);
    const [season] = await db.select({ isPublished: kotcSeasonsTable.isPublished }).from(kotcSeasonsTable).where(eq(kotcSeasonsTable.id, seasonId));
    if (!season) return void res.status(404).json({ error: "Season not found" });

    const { userId: clerkId } = getAuth(req);
    const user = clerkId ? await getDbUser(clerkId) : null;

    if (!season.isPublished && (!user || user.role !== "admin")) {
      return void res.status(404).json({ error: "Season not found" });
    }

    const teams = await db
      .select()
      .from(kotcTeamsTable)
      .where(eq(kotcTeamsTable.seasonId, seasonId))
      .orderBy(asc(kotcTeamsTable.name));

    const teamIds = teams.map((t) => t.id);
    const players = teamIds.length > 0
      ? await db.select().from(kotcTeamPlayersTable).where(inArray(kotcTeamPlayersTable.teamId, teamIds))
      : [];

    // Determine which team the user captains (if any) — only captain sees own QR code

    res.json(teams.map((t) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { qrCode, ...safeTeam } = t;
      return {
        // Only expose QR to the captain or admin
        ...(user && (user.id === t.captainUserId || user.role === "admin") ? t : safeTeam),
        players: players.filter((p) => p.teamId === t.id),
      };
    }));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch teams" });
  }
});

router.get("/kotc/teams/:id", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { userId: clerkId } = getAuth(req);
    const user = await getDbUser(clerkId!);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    const [team] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.id, id));
    if (!team) return void res.status(404).json({ error: "Team not found" });

    const canViewDetails = await isTeamMemberOrAdmin(id, user.id, user.role);
    // QR code is a scan credential — only the captain or admin may see it
    const isCaptainOrAdmin = team.captainUserId === user.id || user.role === "admin";

    const players = await db
      .select({
        id: kotcTeamPlayersTable.id,
        userId: kotcTeamPlayersTable.userId,
        role: kotcTeamPlayersTable.role,
        status: kotcTeamPlayersTable.status,
        rulesAcknowledgedAt: kotcTeamPlayersTable.rulesAcknowledgedAt,
        joinedAt: kotcTeamPlayersTable.joinedAt,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        // Email only visible to team members and admins
        ...(canViewDetails ? { email: usersTable.email } : {}),
      })
      .from(kotcTeamPlayersTable)
      .leftJoin(usersTable, eq(usersTable.id, kotcTeamPlayersTable.userId))
      .where(eq(kotcTeamPlayersTable.teamId, id));

    // Omit qrCode from response unless requester is captain or admin
    const { qrCode, ...teamWithoutQr } = team;
    res.json({ ...(isCaptainOrAdmin ? team : teamWithoutQr), players });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch team" });
  }
});

router.post("/kotc/seasons/:seasonId/teams", requireAuth, async (req, res) => {
  try {
    const seasonId = Number(req.params.seasonId);
    const { userId: clerkId } = getAuth(req);
    const user = await getDbUser(clerkId!);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    const [season] = await db.select().from(kotcSeasonsTable).where(eq(kotcSeasonsTable.id, seasonId));
    if (!season) return void res.status(404).json({ error: "Season not found" });

    // Youth guardian prerequisite: season is youth if flagged OR if age bracket is U18 or below
    const seasonIsYouth = (season as Record<string, unknown>).isYouth ||
      isYouthBracket(String((season as Record<string, unknown>).genderBracket || ""), String((season as Record<string, unknown>).ageBracket || ""));
    if (seasonIsYouth) {
      const guardianOk = await hasApprovedGuardian(user.id);
      if (!guardianOk) {
        return void res.status(403).json({ error: "Youth seasons require an approved guardian on file before creating a team" });
      }
    }

    const { name, color, logoUrl } = req.body;
    if (!name) return void res.status(400).json({ error: "Team name required" });

    const qrCode = `kotc-team-${randomUUID()}`;

    const [team] = await db.insert(kotcTeamsTable).values({
      seasonId,
      captainUserId: user.id,
      name,
      color: color || null,
      logoUrl: logoUrl || null,
      qrCode,
    }).returning();

    // Register the QR code in the scoped registry so the /qr endpoint can authenticate it
    await db.insert(qrCodesTable).values({
      code: qrCode,
      scope: "kotc_captain",
      userId: user.id,
      entityType: "kotc_team",
      entityId: team.id,
      isActive: true,
    });

    await db.insert(kotcTeamPlayersTable).values({
      teamId: team.id,
      userId: user.id,
      role: "captain",
      status: "active",
      joinedAt: new Date(),
    });

    res.status(201).json(team);
  } catch (err) {
    console.error("[kotc] POST teams:", err);
    res.status(500).json({ error: "Failed to create team" });
  }
});

router.patch("/kotc/teams/:id", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { userId: clerkId } = getAuth(req);
    const user = await getDbUser(clerkId!);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    const [team] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.id, id));
    if (!team) return void res.status(404).json({ error: "Team not found" });
    if (team.captainUserId !== user.id && user.role !== "admin") {
      return void res.status(403).json({ error: "Forbidden" });
    }

    const updates: Record<string, unknown> = {};
    for (const key of ["name", "color", "logoUrl"]) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const [updated] = await db
      .update(kotcTeamsTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(kotcTeamsTable.id, id))
      .returning();

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: "Failed to update team" });
  }
});

// ─── Roster Management ────────────────────────────────────────────────────────

router.post("/kotc/teams/:id/invite", requireAuth, async (req, res) => {
  try {
    const teamId = Number(req.params.id);
    const { userId: clerkId } = getAuth(req);
    const user = await getDbUser(clerkId!);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    const [team] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.id, teamId));
    if (!team) return void res.status(404).json({ error: "Team not found" });
    if (team.captainUserId !== user.id && user.role !== "admin") {
      return void res.status(403).json({ error: "Only the captain can invite players" });
    }

    const { inviteeUserId, inviteeEmail } = req.body;
    if (!inviteeUserId && !inviteeEmail) {
      return void res.status(400).json({ error: "inviteeUserId or inviteeEmail required" });
    }

    // Lookup by ID or email
    let invitee;
    if (inviteeUserId) {
      [invitee] = await db.select().from(usersTable).where(eq(usersTable.id, Number(inviteeUserId)));
    } else {
      [invitee] = await db.select().from(usersTable).where(eq(usersTable.email, inviteeEmail));
    }
    if (!invitee) return void res.status(404).json({ error: "User not found" });

    // Load season for bracket + youth checks
    const [season] = await db.select().from(kotcSeasonsTable).where(eq(kotcSeasonsTable.id, team.seasonId));

    // Youth guardian prerequisite
    if ((season as Record<string, unknown>).isYouth) {
      const guardianOk = await hasApprovedGuardian(invitee.id);
      if (!guardianOk) {
        return void res.status(403).json({ error: "Invited player must have an approved guardian on file for youth seasons" });
      }
    }

    // Gender bracket validation — use canonical season.genderBracket column
    if (season.genderBracket && !genderMatchesBracket(invitee.gender, season.genderBracket)) {
      return void res.status(400).json({ error: `This season is restricted to ${season.genderBracket} participants` });
    }

    // Age bracket validation — use canonical season.ageBracket column
    if (season.ageBracket && !ageMatchesBracket(invitee.dateOfBirth, season.ageBracket)) {
      return void res.status(400).json({ error: `This season's age bracket (${season.ageBracket}) does not match this player's date of birth` });
    }

    const [existing] = await db
      .select()
      .from(kotcTeamPlayersTable)
      .where(and(eq(kotcTeamPlayersTable.teamId, teamId), eq(kotcTeamPlayersTable.userId, invitee.id)));

    if (existing) return void res.status(409).json({ error: "Player already on team" });

    const [invite] = await db.insert(kotcTeamPlayersTable).values({
      teamId,
      userId: invitee.id,
      role: "player",
      status: "invited",
    }).returning();

    await sendNotificationWithPreferences({
      userId: invitee.id,
      type: "kotc_game_rules",
      subject: `You've been invited to ${team.name}`,
      body: `${user.firstName ?? "A captain"} invited you to join their Kings of The Court team "${team.name}". Accept your invite to play!`,
    });

    res.status(201).json(invite);
  } catch (err) {
    res.status(500).json({ error: "Failed to invite player" });
  }
});

router.post("/kotc/team-invites/:id/accept", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { userId: clerkId } = getAuth(req);
    const user = await getDbUser(clerkId!);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    const [invite] = await db.select().from(kotcTeamPlayersTable).where(eq(kotcTeamPlayersTable.id, id));
    if (!invite) return void res.status(404).json({ error: "Invite not found" });
    if (invite.userId !== user.id) return void res.status(403).json({ error: "Forbidden" });

    const [updated] = await db
      .update(kotcTeamPlayersTable)
      .set({ status: "active", joinedAt: new Date() })
      .where(eq(kotcTeamPlayersTable.id, id))
      .returning();

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: "Failed to accept invite" });
  }
});

router.post("/kotc/team-invites/:id/decline", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { userId: clerkId } = getAuth(req);
    const user = await getDbUser(clerkId!);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    const [invite] = await db.select().from(kotcTeamPlayersTable).where(eq(kotcTeamPlayersTable.id, id));
    if (!invite) return void res.status(404).json({ error: "Invite not found" });
    if (invite.userId !== user.id) return void res.status(403).json({ error: "Forbidden" });

    await db
      .update(kotcTeamPlayersTable)
      .set({ status: "declined" })
      .where(eq(kotcTeamPlayersTable.id, id));

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to decline invite" });
  }
});

// ─── My Teams ─────────────────────────────────────────────────────────────────

router.get("/kotc/my-teams", requireAuth, async (req, res) => {
  try {
    const { userId: clerkId } = getAuth(req);
    const user = await getDbUser(clerkId!);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    const memberships = await db
      .select()
      .from(kotcTeamPlayersTable)
      .where(and(eq(kotcTeamPlayersTable.userId, user.id), eq(kotcTeamPlayersTable.status, "active")));

    if (memberships.length === 0) return void res.json([]);

    const teamIds = memberships.map((m) => m.teamId);
    const teams = await db
      .select()
      .from(kotcTeamsTable)
      .where(inArray(kotcTeamsTable.id, teamIds));

    res.json(teams.map((t) => ({
      ...t,
      myRole: memberships.find((m) => m.teamId === t.id)?.role ?? "player",
    })));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch teams" });
  }
});

// ─── Battle Registration ──────────────────────────────────────────────────────

router.post("/kotc/battles/:battleId/register", requireAuth, async (req, res) => {
  try {
    const battleId = Number(req.params.battleId);
    const { userId: clerkId } = getAuth(req);
    const user = await getDbUser(clerkId!);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    const { teamId, courtNumber, actingCaptainUserId } = req.body;
    if (!teamId) return void res.status(400).json({ error: "teamId required" });

    const [team] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.id, Number(teamId)));
    if (!team) return void res.status(404).json({ error: "Team not found" });
    if (team.captainUserId !== user.id && user.role !== "admin") {
      return void res.status(403).json({ error: "Only the captain can register the team" });
    }

    const [battle] = await db.select().from(kotcBattlesTable).where(eq(kotcBattlesTable.id, battleId));
    if (!battle) return void res.status(404).json({ error: "Battle not found" });

    // Cross-season integrity: team must belong to the same season as the battle
    if (team.seasonId !== battle.seasonId) {
      return void res.status(400).json({ error: "Team is not registered in the same season as this battle" });
    }

    const [season] = await db.select().from(kotcSeasonsTable).where(eq(kotcSeasonsTable.id, battle.seasonId));
    if (team.livesBalance < season.livesRequired) {
      return void res.status(400).json({
        error: `Team must have at least ${season.livesRequired} lives to register`,
      });
    }

    // Court bounds validation: courtNumber must be within 1..battle.courtCount
    const courtNum = courtNumber ? Number(courtNumber) : 1;
    if (courtNum < 1 || courtNum > (battle.courtCount || 1)) {
      return void res.status(400).json({
        error: `Invalid courtNumber ${courtNum}. This battle has ${battle.courtCount || 1} court(s) (valid range: 1–${battle.courtCount || 1}).`,
      });
    }

    // Capacity check: count existing registrations for this court vs maxTeamsPerCourt
    const [courtCountRow] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(kotcBattleRegistrationsTable)
      .where(and(
        eq(kotcBattleRegistrationsTable.battleId, battleId),
        eq(kotcBattleRegistrationsTable.courtNumber, courtNum),
      ));
    const currentCount = Number(courtCountRow?.count ?? 0);
    const maxPerCourt = battle.maxTeamsPerCourt || 8;
    if (currentCount >= maxPerCourt) {
      return void res.status(409).json({
        error: `Court ${courtNum} is full (${maxPerCourt} teams maximum). Choose a different court or contact the organizer.`,
      });
    }

    // Per-player per-season rules acknowledgment: ALL active players must acknowledge before battle registration
    const unacknowledged = await db
      .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
      .from(kotcTeamPlayersTable)
      .leftJoin(usersTable, eq(usersTable.id, kotcTeamPlayersTable.userId))
      .where(and(
        eq(kotcTeamPlayersTable.teamId, Number(teamId)),
        eq(kotcTeamPlayersTable.status, "active"),
        sql`${kotcTeamPlayersTable.rulesAcknowledgedAt} IS NULL`,
      ));
    if (unacknowledged.length > 0) {
      const names = unacknowledged.map((p) => p.firstName ?? "Unnamed player").join(", ");
      return void res.status(400).json({
        error: `The following players have not acknowledged the season rules: ${names}. All active players must acknowledge rules before the team can register for a battle.`,
      });
    }

    const [existing] = await db
      .select()
      .from(kotcBattleRegistrationsTable)
      .where(and(
        eq(kotcBattleRegistrationsTable.battleId, battleId),
        eq(kotcBattleRegistrationsTable.teamId, Number(teamId)),
      ));
    if (existing) return void res.status(409).json({ error: "Team already registered for this battle" });

    const [reg] = await db.insert(kotcBattleRegistrationsTable).values({
      battleId,
      teamId: Number(teamId),
      courtNumber: courtNum,
      actingCaptainUserId: actingCaptainUserId || null,
    }).returning();

    res.status(201).json(reg);
  } catch (err) {
    console.error("[kotc] register battle:", err);
    res.status(500).json({ error: "Failed to register for battle" });
  }
});

router.get("/kotc/teams/:teamId/registrations", requireAuth, async (req, res) => {
  try {
    const teamId = Number(req.params.teamId);
    const { userId: clerkId } = getAuth(req);
    const user = await getDbUser(clerkId!);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    const [team] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.id, teamId));
    if (!team) return void res.status(404).json({ error: "Team not found" });
    const isMemberOrAdmin = user.role === "admin" || team.captainUserId === user.id
      || !!(await db.select().from(kotcTeamPlayersTable).where(and(
          eq(kotcTeamPlayersTable.teamId, teamId),
          eq(kotcTeamPlayersTable.userId, user.id),
          eq(kotcTeamPlayersTable.status, "active"),
        )).then((rows) => rows[0]));
    if (!isMemberOrAdmin) return void res.status(403).json({ error: "Forbidden" });

    const registrations = await db
      .select()
      .from(kotcBattleRegistrationsTable)
      .where(eq(kotcBattleRegistrationsTable.teamId, teamId))
      .orderBy(desc(kotcBattleRegistrationsTable.battleId));

    res.json(registrations);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch registrations" });
  }
});

router.patch("/kotc/registrations/:id/acting-captain", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { actingCaptainUserId } = req.body;
    const { userId: clerkId } = getAuth(req);
    const user = await getDbUser(clerkId!);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    // Load registration to verify ownership
    const [existing] = await db
      .select()
      .from(kotcBattleRegistrationsTable)
      .where(eq(kotcBattleRegistrationsTable.id, id));
    if (!existing) return void res.status(404).json({ error: "Registration not found" });

    // Only the team captain or admin may reassign acting captain
    const [team] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.id, existing.teamId));
    if (!team) return void res.status(404).json({ error: "Team not found" });
    if (team.captainUserId !== user.id && user.role !== "admin") {
      return void res.status(403).json({ error: "Only the team captain or an admin may change the acting captain" });
    }

    // Verify the new acting captain is an active team member
    if (actingCaptainUserId) {
      const [member] = await db
        .select()
        .from(kotcTeamPlayersTable)
        .where(and(
          eq(kotcTeamPlayersTable.teamId, existing.teamId),
          eq(kotcTeamPlayersTable.userId, Number(actingCaptainUserId)),
          eq(kotcTeamPlayersTable.status, "active"),
        ));
      if (!member) return void res.status(400).json({ error: "Acting captain must be an active team member" });
    }

    const [reg] = await db
      .update(kotcBattleRegistrationsTable)
      .set({ actingCaptainUserId: actingCaptainUserId || null })
      .where(eq(kotcBattleRegistrationsTable.id, id))
      .returning();
    res.json(reg);
  } catch (err) {
    res.status(500).json({ error: "Failed to update acting captain" });
  }
});

// ─── Rules Acknowledgment ────────────────────────────────────────────────────

router.post("/kotc/teams/:teamId/acknowledge-rules", requireAuth, async (req, res) => {
  try {
    const teamId = Number(req.params.teamId);
    const { userId: clerkId } = getAuth(req);
    const user = await getDbUser(clerkId!);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    const [member] = await db
      .select()
      .from(kotcTeamPlayersTable)
      .where(and(eq(kotcTeamPlayersTable.teamId, teamId), eq(kotcTeamPlayersTable.userId, user.id)));

    if (!member) return void res.status(404).json({ error: "Not a team member" });

    const [updated] = await db
      .update(kotcTeamPlayersTable)
      .set({ rulesAcknowledgedAt: new Date() })
      .where(eq(kotcTeamPlayersTable.id, member.id))
      .returning();

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: "Failed to record rules acknowledgment" });
  }
});

router.get("/kotc/seasons/:seasonId/rules", requireAuth, async (req, res) => {
  try {
    const [season] = await db
      .select()
      .from(kotcSeasonsTable)
      .where(eq(kotcSeasonsTable.id, Number(req.params.seasonId)));

    if (!season) return void res.status(404).json({ error: "Season not found" });

    const sport = season.sport || "basketball";
    const cards = getRulesCards(sport, season as Record<string, unknown>);
    res.json({ cards, season });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch rules" });
  }
});

function getRulesCards(sport: string, season: Record<string, unknown>): Array<{
  title: string; body: string; icon: string;
}> {
  const teamSize = season.teamSize || 4;
  const winTarget = season.winTarget || 7;
  const timeLimit = season.timeLimitMinutes || 5;
  const graceSeconds = season.gracePeriodSeconds || 60;

  return [
    {
      title: "Win Condition",
      body: `First team to score ${winTarget} points OR the team with more points when the ${timeLimit}-minute time limit expires wins. If time expires while tied, the team that has been on court longer loses.`,
      icon: "trophy",
    },
    {
      title: "Team Size",
      body: `Teams play ${teamSize}v${teamSize}. If your full roster isn't present, you can choose to play short-handed or skip your turn (skip = moved to back of queue, no life lost).`,
      icon: "users",
    },
    {
      title: "Lives System",
      body: "The losing team loses 1 life. When a team hits 0 lives, their captain will be notified and a grace timer starts. Purchase lives before the timer expires to stay in the queue.",
      icon: "heart",
    },
    {
      title: "Self-Officiation",
      body: `${sport.charAt(0).toUpperCase() + sport.slice(1)} is self-officiated in street/pick-up style. Call your own fouls. Disputes go captain-to-captain first, then escalate to the Battle Moderator. You have ${graceSeconds} seconds grace period when your slot comes up.`,
      icon: "shield",
    },
  ];
}

// ─── Rotation Queue ──────────────────────────────────────────────────────────

router.get("/kotc/battles/:battleId/queue", requireAuth, async (req, res) => {
  try {
    const battleId = Number(req.params.battleId);
    const courtNumber = Number(req.query.court || 1);

    const queue = await db
      .select({
        id: kotcRotationQueuesTable.id,
        battleId: kotcRotationQueuesTable.battleId,
        teamId: kotcRotationQueuesTable.teamId,
        courtNumber: kotcRotationQueuesTable.courtNumber,
        position: kotcRotationQueuesTable.position,
        status: kotcRotationQueuesTable.status,
        graceExpiresAt: kotcRotationQueuesTable.graceExpiresAt,
        teamName: kotcTeamsTable.name,
        teamColor: kotcTeamsTable.color,
        livesBalance: kotcTeamsTable.livesBalance,
      })
      .from(kotcRotationQueuesTable)
      .leftJoin(kotcTeamsTable, eq(kotcTeamsTable.id, kotcRotationQueuesTable.teamId))
      .where(and(
        eq(kotcRotationQueuesTable.battleId, battleId),
        eq(kotcRotationQueuesTable.courtNumber, courtNumber),
      ))
      .orderBy(asc(kotcRotationQueuesTable.position));

    res.json(queue);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch queue" });
  }
});

router.post("/kotc/battles/:battleId/start", requireAuth, async (req, res) => {
  try {
    const battleId = Number(req.params.battleId);
    const { userId: clerkId } = getAuth(req);
    const user = await getDbUser(clerkId!);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    const [battle] = await db.select().from(kotcBattlesTable).where(eq(kotcBattlesTable.id, battleId));
    if (!battle) return void res.status(404).json({ error: "Battle not found" });

    if (user.role !== "admin") {
      const [isMod] = await db
        .select()
        .from(kotcBattleModsTable)
        .where(and(eq(kotcBattleModsTable.battleId, battleId), eq(kotcBattleModsTable.userId, user.id)));
      if (!isMod) return void res.status(403).json({ error: "Not a moderator for this battle" });
    }

    // Idempotency guard: if the battle already has queue entries, it was already started.
    // Wipe existing entries before re-initializing (allows re-start by admin/mod to fix ordering).
    if (battle.status === "active") {
      return void res.status(409).json({ error: "Battle is already active. Use the queue management endpoints to adjust positions." });
    }

    const registrations = await db
      .select()
      .from(kotcBattleRegistrationsTable)
      .where(and(
        eq(kotcBattleRegistrationsTable.battleId, battleId),
        eq(kotcBattleRegistrationsTable.status, "registered"),
      ))
      .orderBy(asc(kotcBattleRegistrationsTable.registeredAt));

    // Clear any stale queue entries (safety net for re-draft scenarios)
    await db.delete(kotcRotationQueuesTable).where(eq(kotcRotationQueuesTable.battleId, battleId));

    for (let courtNum = 1; courtNum <= (battle.courtCount || 1); courtNum++) {
      const courtRegs = registrations.filter((r) => r.courtNumber === courtNum);
      for (let i = 0; i < courtRegs.length; i++) {
        await db.insert(kotcRotationQueuesTable).values({
          battleId,
          teamId: courtRegs[i].teamId,
          courtNumber: courtNum,
          position: i + 1,
          status: "queued",
        });
      }
    }

    await db
      .update(kotcBattlesTable)
      .set({ status: "active", startedAt: new Date(), updatedAt: new Date() })
      .where(eq(kotcBattlesTable.id, battleId));

    const allRegisteredTeamIds = registrations.map((r) => r.teamId);
    const allPlayers = allRegisteredTeamIds.length > 0
      ? await db
          .select()
          .from(kotcTeamPlayersTable)
          .where(and(
            inArray(kotcTeamPlayersTable.teamId, allRegisteredTeamIds),
            eq(kotcTeamPlayersTable.status, "active"),
          ))
      : [];

    const uniqueUserIds = [...new Set(allPlayers.map((p) => p.userId))];
    for (const uid of uniqueUserIds) {
      sendNotificationWithPreferences({
        userId: uid,
        type: "kotc_rules_reminder",
        subject: "Battle Started!",
        body: "Your battle has started. Check the queue to see your team's position.",
      }).catch(() => {});
    }

    res.json({ ok: true, queuedTeams: registrations.length });
  } catch (err) {
    console.error("[kotc] start battle:", err);
    res.status(500).json({ error: "Failed to start battle" });
  }
});

// ─── Captain: Play Short ────────────────────────────────────────────────────────
// Acknowledges intent to play short-handed this slot. No life penalty, no queue move.

router.post("/kotc/teams/:teamId/play-short", requireAuth, async (req, res) => {
  try {
    const teamId = Number(req.params.teamId);
    const { battleId } = req.body;
    const { userId: clerkId } = getAuth(req);
    const user = await getDbUser(clerkId!);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    const [team] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.id, teamId));
    if (!team) return void res.status(404).json({ error: "Team not found" });
    if (team.captainUserId !== user.id && user.role !== "admin") {
      return void res.status(403).json({ error: "Only captain can declare play-short" });
    }

    const [entry] = await db
      .select()
      .from(kotcRotationQueuesTable)
      .where(and(
        eq(kotcRotationQueuesTable.battleId, Number(battleId)),
        eq(kotcRotationQueuesTable.teamId, teamId),
        sql`status IN ('queued', 'on_court')`,
      ));
    if (!entry) return void res.status(404).json({ error: "Team not in active queue" });

    // Notify all active players that the team is playing short-handed
    const players = await db
      .select()
      .from(kotcTeamPlayersTable)
      .where(and(eq(kotcTeamPlayersTable.teamId, teamId), eq(kotcTeamPlayersTable.status, "active")));
    for (const p of players) {
      sendMultiChannelNotification(["in_app"], {
        userId: p.userId,
        type: "kotc_game_rules",
        subject: "Playing Short-Handed",
        body: `${team.name} is playing short-handed this slot. No penalty — give it your best!`,
      }).catch(() => {});
    }

    res.json({ ok: true, message: "Play-short acknowledged — no penalty applied" });
  } catch (err) {
    console.error("[kotc] play-short:", err);
    res.status(500).json({ error: "Failed to acknowledge play-short" });
  }
});

// ─── Moderator: No-Show Penalty ────────────────────────────────────────────────
// When a team is called to court but doesn't appear, the mod marks them as no-show.
// Deducts 1 life and moves them to the back of the queue.

router.post("/kotc/battles/:battleId/no-show", requireAuth, async (req, res) => {
  try {
    const battleId = Number(req.params.battleId);
    const { teamId } = req.body;
    const { userId: clerkId } = getAuth(req);
    const user = await getDbUser(clerkId!);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    const [team] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.id, Number(teamId)));
    if (!team) return void res.status(404).json({ error: "Team not found" });

    const [entry] = await db
      .select()
      .from(kotcRotationQueuesTable)
      .where(and(
        eq(kotcRotationQueuesTable.battleId, battleId),
        eq(kotcRotationQueuesTable.teamId, Number(teamId)),
        sql`status IN ('queued', 'on_court')`,
      ));
    if (!entry) return void res.status(404).json({ error: "Team is not in an active queue slot" });

    // Court-scoped authorization: moderator must be assigned to THIS team's court (server-derived)
    if (!(await isBattleModOrAdminForCourt(battleId, entry.courtNumber, user.id, user.role))) {
      return void res.status(403).json({ error: "You are not assigned as moderator for this court" });
    }

    const newBalance = Math.max(0, team.livesBalance - 1);
    await db.update(kotcTeamsTable).set({ livesBalance: newBalance, updatedAt: new Date() })
      .where(eq(kotcTeamsTable.id, Number(teamId)));

    await db.insert(kotcLifeLedgerTable).values({
      teamId: Number(teamId),
      delta: -1,
      reason: "no_show_penalty",
      referenceType: "admin",
      balanceAfter: newBalance,
      createdByUserId: user.id,
    });

    // Fetch season so grace timer duration matches season config (not a hardcoded constant)
    const [battle] = await db.select().from(kotcBattlesTable).where(eq(kotcBattlesTable.id, battleId));
    const [noShowSeason] = battle
      ? await db.select().from(kotcSeasonsTable).where(eq(kotcSeasonsTable.id, battle.seasonId))
      : [undefined];
    const graceSeconds = noShowSeason?.gracePeriodSeconds || 60;

    const [maxPos] = await db
      .select({ max: sql<number>`MAX(position)` })
      .from(kotcRotationQueuesTable)
      .where(and(
        eq(kotcRotationQueuesTable.battleId, battleId),
        eq(kotcRotationQueuesTable.courtNumber, entry.courtNumber),
        sql`status NOT IN ('bowed_out', 'pending_purchase')`,
      ));

    if (newBalance <= 0) {
      await db.update(kotcRotationQueuesTable).set({
        status: "pending_purchase",
        graceStartedAt: new Date(),
        graceExpiresAt: new Date(Date.now() + graceSeconds * 1000),
        updatedAt: new Date(),
      }).where(eq(kotcRotationQueuesTable.id, entry.id));

      sendMultiChannelNotification(["push", "in_app"], {
        userId: team.captainUserId,
        type: "kotc_lives_out",
        subject: "⚠️ No-Show Penalty — Lives Out",
        body: `${team.name} was marked as a no-show and is out of lives. Purchase more within ${graceSeconds}s or you'll be removed from the queue.`,
      }).catch(() => {});

      const graceMs = graceSeconds * 1000;
      const halfGraceMs = Math.floor(graceMs / 2);
      const captainUserId = team.captainUserId;
      const teamName = team.name;
      const queueEntryId = entry.id;

      // Midpoint warning
      setTimeout(async () => {
        try {
          const [stillPending] = await db
            .select()
            .from(kotcRotationQueuesTable)
            .where(and(
              eq(kotcRotationQueuesTable.battleId, battleId),
              eq(kotcRotationQueuesTable.teamId, Number(teamId)),
              eq(kotcRotationQueuesTable.status, "pending_purchase"),
            ));
          if (stillPending) {
            sendMultiChannelNotification(["push", "in_app"], {
              userId: captainUserId,
              type: "kotc_lives_low",
              subject: "⏰ Grace Period Expiring Soon",
              body: `${teamName} — about ${Math.ceil(graceSeconds / 2)}s left to purchase lives or you'll be removed!`,
            }).catch(() => {});
          }
        } catch (e) { console.error("[kotc] no-show grace midpoint:", e); }
      }, halfGraceMs);

      // Full expiry: auto-bow-out if still pending_purchase
      setTimeout(async () => {
        try {
          const [current] = await db
            .select()
            .from(kotcRotationQueuesTable)
            .where(and(
              eq(kotcRotationQueuesTable.battleId, battleId),
              eq(kotcRotationQueuesTable.teamId, Number(teamId)),
              eq(kotcRotationQueuesTable.status, "pending_purchase"),
            ));
          if (current) {
            const [refreshed] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.id, Number(teamId)));
            if ((refreshed?.livesBalance ?? 0) <= 0) {
              await db.update(kotcRotationQueuesTable).set({
                status: "bowed_out",
                bowedOutAt: new Date(),
                updatedAt: new Date(),
              }).where(eq(kotcRotationQueuesTable.id, queueEntryId));

              sendMultiChannelNotification(["push", "in_app"], {
                userId: captainUserId,
                type: "kotc_bowed_out",
                subject: "Bowed Out",
                body: `${teamName} has been removed from the queue due to a no-show. Purchase lives to rejoin.`,
              }).catch(() => {});
            }
          }
        } catch (e) { console.error("[kotc] no-show grace expiry:", e); }
      }, graceMs);
    } else {
      await db.update(kotcRotationQueuesTable).set({
        position: (maxPos?.max ?? 0) + 1,
        status: "queued",
        updatedAt: new Date(),
      }).where(eq(kotcRotationQueuesTable.id, entry.id));

      sendMultiChannelNotification(["push", "in_app"], {
        userId: team.captainUserId,
        type: "kotc_lives_out",
        subject: "⚠️ No-Show Penalty",
        body: `${team.name} was marked as a no-show and lost 1 life (${newBalance} remaining). You've been moved to the back of the queue.`,
      }).catch(() => {});
    }

    res.json({ ok: true, newBalance });
  } catch (err) {
    console.error("[kotc] no-show:", err);
    res.status(500).json({ error: "Failed to record no-show" });
  }
});

router.post("/kotc/teams/:teamId/skip-turn", requireAuth, async (req, res) => {
  try {
    const teamId = Number(req.params.teamId);
    const { battleId } = req.body;
    const { userId: clerkId } = getAuth(req);
    const user = await getDbUser(clerkId!);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    const [team] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.id, teamId));
    if (!team) return void res.status(404).json({ error: "Team not found" });
    if (team.captainUserId !== user.id && user.role !== "admin") {
      return void res.status(403).json({ error: "Only captain can skip turn" });
    }

    const [entry] = await db
      .select()
      .from(kotcRotationQueuesTable)
      .where(and(
        eq(kotcRotationQueuesTable.battleId, Number(battleId)),
        eq(kotcRotationQueuesTable.teamId, teamId),
        eq(kotcRotationQueuesTable.status, "queued"),
      ));

    if (!entry) return void res.status(404).json({ error: "Team not in queue" });

    const [maxPos] = await db
      .select({ max: sql<number>`MAX(position)` })
      .from(kotcRotationQueuesTable)
      .where(and(
        eq(kotcRotationQueuesTable.battleId, Number(battleId)),
        eq(kotcRotationQueuesTable.courtNumber, entry.courtNumber),
      ));

    const newPosition = (maxPos?.max ?? entry.position) + 1;

    await db
      .update(kotcRotationQueuesTable)
      .set({ position: newPosition, updatedAt: new Date() })
      .where(eq(kotcRotationQueuesTable.id, entry.id));

    await db
      .update(kotcRotationQueuesTable)
      .set({
        position: sql`${kotcRotationQueuesTable.position} - 1`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(kotcRotationQueuesTable.battleId, Number(battleId)),
        eq(kotcRotationQueuesTable.courtNumber, entry.courtNumber),
        sql`position > ${entry.position} AND position < ${newPosition} AND id != ${entry.id}`,
      ));

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to skip turn" });
  }
});

// ─── Game Cards ───────────────────────────────────────────────────────────────

router.post("/kotc/battles/:battleId/scan", requireAuth, async (req, res) => {
  try {
    const battleId = Number(req.params.battleId);
    const { userId: clerkId } = getAuth(req);
    const user = await getDbUser(clerkId!);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    const { team1QrCode, team2QrCode } = req.body;
    if (!team1QrCode || !team2QrCode) {
      return void res.status(400).json({ error: "Both captain QR codes required" });
    }

    const [battle] = await db.select().from(kotcBattlesTable).where(eq(kotcBattlesTable.id, battleId));
    if (!battle) return void res.status(404).json({ error: "Battle not found" });

    const [season] = await db.select().from(kotcSeasonsTable).where(eq(kotcSeasonsTable.id, battle.seasonId));

    const [team1] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.qrCode, team1QrCode));
    const [team2] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.qrCode, team2QrCode));

    if (!team1) return void res.status(404).json({ error: "Team 1 QR code not found" });
    if (!team2) return void res.status(404).json({ error: "Team 2 QR code not found" });
    if (team1.id === team2.id) return void res.status(400).json({ error: "Both QR codes belong to same team" });

    const [reg1] = await db
      .select()
      .from(kotcBattleRegistrationsTable)
      .where(and(eq(kotcBattleRegistrationsTable.battleId, battleId), eq(kotcBattleRegistrationsTable.teamId, team1.id)));

    const [reg2] = await db
      .select()
      .from(kotcBattleRegistrationsTable)
      .where(and(eq(kotcBattleRegistrationsTable.battleId, battleId), eq(kotcBattleRegistrationsTable.teamId, team2.id)));

    if (!reg1) return void res.status(400).json({ error: `${team1.name} is not registered for this battle` });
    if (!reg2) return void res.status(400).json({ error: `${team2.name} is not registered for this battle` });

    // Multi-court integrity: both teams must be registered for the same court
    if (reg1.courtNumber !== reg2.courtNumber) {
      return void res.status(400).json({
        error: `Teams are registered for different courts (${team1.name}: court ${reg1.courtNumber}, ${team2.name}: court ${reg2.courtNumber}). Use the same court.`,
      });
    }

    // Court-scoped authorization: moderator must be assigned to THIS court (server-derived)
    if (!(await isBattleModOrAdminForCourt(battleId, reg1.courtNumber, user.id, user.role))) {
      return void res.status(403).json({ error: "You are not assigned as moderator for this court" });
    }

    // Queue eligibility: both teams must be in queued or on_court state (not bowed out or pending purchase)
    const [q1] = await db
      .select()
      .from(kotcRotationQueuesTable)
      .where(and(
        eq(kotcRotationQueuesTable.battleId, battleId),
        eq(kotcRotationQueuesTable.teamId, team1.id),
        eq(kotcRotationQueuesTable.courtNumber, reg1.courtNumber),
        sql`status IN ('queued', 'on_court')`,
      ));
    const [q2] = await db
      .select()
      .from(kotcRotationQueuesTable)
      .where(and(
        eq(kotcRotationQueuesTable.battleId, battleId),
        eq(kotcRotationQueuesTable.teamId, team2.id),
        eq(kotcRotationQueuesTable.courtNumber, reg2.courtNumber),
        sql`status IN ('queued', 'on_court')`,
      ));
    if (!q1) return void res.status(400).json({ error: `${team1.name} is not currently eligible (bowed out or awaiting payment)` });
    if (!q2) return void res.status(400).json({ error: `${team2.name} is not currently eligible (bowed out or awaiting payment)` });

    if (team1.livesBalance < 1) return void res.status(400).json({ error: `${team1.name} has no lives remaining` });
    if (team2.livesBalance < 1) return void res.status(400).json({ error: `${team2.name} has no lives remaining` });

    const [captain1Member] = await db
      .select()
      .from(kotcTeamPlayersTable)
      .where(and(
        eq(kotcTeamPlayersTable.teamId, team1.id),
        eq(kotcTeamPlayersTable.userId, reg1.actingCaptainUserId ?? team1.captainUserId),
      ));

    const [captain2Member] = await db
      .select()
      .from(kotcTeamPlayersTable)
      .where(and(
        eq(kotcTeamPlayersTable.teamId, team2.id),
        eq(kotcTeamPlayersTable.userId, reg2.actingCaptainUserId ?? team2.captainUserId),
      ));

    if (!captain1Member?.rulesAcknowledgedAt) {
      return void res.status(400).json({ error: `${team1.name} captain has not acknowledged the season rules` });
    }
    if (!captain2Member?.rulesAcknowledgedAt) {
      return void res.status(400).json({ error: `${team2.name} captain has not acknowledged the season rules` });
    }

    // Court is derived server-side from the validated registration — never trust client courtNumber
    // (reg1.courtNumber === reg2.courtNumber was already enforced above)
    const resolvedCourt = reg1.courtNumber;
    const [gameCard] = await db.insert(kotcGameCardsTable).values({
      battleId,
      courtNumber: resolvedCourt,
      team1Id: team1.id,
      team2Id: team2.id,
      moderatorUserId: user.id,
      status: "in_progress",
    }).returning();

    // Mark both teams as on_court when the game starts
    await db.update(kotcRotationQueuesTable).set({ status: "on_court", updatedAt: new Date() })
      .where(and(
        eq(kotcRotationQueuesTable.battleId, battleId),
        eq(kotcRotationQueuesTable.courtNumber, resolvedCourt),
        sql`team_id IN (${team1.id}, ${team2.id})`,
      ));

    const rulesCards = getRulesCards(season.sport, season as Record<string, unknown>);

    const cap1UserId = reg1.actingCaptainUserId ?? team1.captainUserId;
    const cap2UserId = reg2.actingCaptainUserId ?? team2.captainUserId;

    sendMultiChannelNotification(["push", "in_app"], {
      userId: cap1UserId,
      type: "kotc_game_rules",
      subject: "Game Time!",
      body: `Your game vs ${team2.name} is starting. Win condition: ${season.winTarget} points or ${season.timeLimitMinutes} min.`,
    }).catch(() => {});

    sendMultiChannelNotification(["push", "in_app"], {
      userId: cap2UserId,
      type: "kotc_game_rules",
      subject: "Game Time!",
      body: `Your game vs ${team1.name} is starting. Win condition: ${season.winTarget} points or ${season.timeLimitMinutes} min.`,
    }).catch(() => {});

    res.status(201).json({ gameCard, rulesCards, team1, team2 });
  } catch (err) {
    console.error("[kotc] scan:", err);
    res.status(500).json({ error: "Failed to process QR scan" });
  }
});

router.post("/kotc/game-cards/:gameCardId/result", requireAuth, async (req, res) => {
  try {
    const gameCardId = Number(req.params.gameCardId);
    const { winnerTeamId } = req.body;
    const { userId: clerkId } = getAuth(req);
    const user = await getDbUser(clerkId!);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    const [gameCard] = await db.select().from(kotcGameCardsTable).where(eq(kotcGameCardsTable.id, gameCardId));
    if (!gameCard) return void res.status(404).json({ error: "Game card not found" });
    if (gameCard.status !== "in_progress") return void res.status(400).json({ error: "Game card is not in progress" });

    // Court-scoped authorization: moderator must be assigned to THIS court
    if (!(await isBattleModOrAdminForCourt(gameCard.battleId, gameCard.courtNumber, user.id, user.role))) {
      return void res.status(403).json({ error: "You are not assigned as moderator for this court" });
    }

    // Validate winner belongs to the game — prevents corrupted standings
    const validWinnerIds = new Set([gameCard.team1Id, gameCard.team2Id]);
    if (!validWinnerIds.has(Number(winnerTeamId))) {
      return void res.status(400).json({ error: "winnerTeamId must be one of the two teams on this game card" });
    }

    const loserTeamId = gameCard.team1Id === Number(winnerTeamId) ? gameCard.team2Id : gameCard.team1Id;

    await db.update(kotcGameCardsTable).set({
      winnerTeamId: Number(winnerTeamId),
      loserTeamId,
      status: "completed",
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(kotcGameCardsTable.id, gameCardId));

    const [loserTeam] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.id, loserTeamId));
    if (!loserTeam) return void res.status(404).json({ error: "Loser team not found" });

    const newBalance = loserTeam.livesBalance - 1;
    await db.update(kotcTeamsTable).set({
      livesBalance: newBalance,
      livesConsumed: loserTeam.livesConsumed + 1,
      updatedAt: new Date(),
    }).where(eq(kotcTeamsTable.id, loserTeamId));

    await db.insert(kotcLifeLedgerTable).values({
      teamId: loserTeamId,
      delta: -1,
      reason: "game_loss",
      referenceType: "kotc_game_card",
      referenceId: gameCardId,
      balanceAfter: newBalance,
      createdByUserId: user.id,
    });

    const [battle] = await db.select().from(kotcBattlesTable).where(eq(kotcBattlesTable.id, gameCard.battleId));
    const [season] = await db.select().from(kotcSeasonsTable).where(eq(kotcSeasonsTable.id, battle.seasonId));

    await reorderQueue(gameCard.battleId, gameCard.courtNumber ?? 1, Number(winnerTeamId), loserTeamId);

    // Phase 2: evaluate drama rules (fire-and-forget)
    evaluateDramaRules(battle.seasonId, gameCard.battleId, Number(winnerTeamId), loserTeamId, loserTeam.livesBalance + 1).catch(() => {});

    if (newBalance <= 0) {
      await db.update(kotcRotationQueuesTable).set({
        status: "pending_purchase",
        graceStartedAt: new Date(),
        graceExpiresAt: new Date(Date.now() + (season.gracePeriodSeconds || 60) * 1000),
        updatedAt: new Date(),
      }).where(and(
        eq(kotcRotationQueuesTable.battleId, gameCard.battleId),
        eq(kotcRotationQueuesTable.teamId, loserTeamId),
      ));

      sendMultiChannelNotification(["push", "in_app"], {
        userId: loserTeam.captainUserId,
        type: "kotc_lives_out",
        subject: "⚠️ Lives Out!",
        body: `${loserTeam.name} is out of lives! Purchase more lives within ${season.gracePeriodSeconds}s to stay in the queue.`,
      }).catch(() => {});

      const graceMs = (season.gracePeriodSeconds || 60) * 1000;
      const halfGraceMs = Math.floor(graceMs / 2);

      // Midpoint warning: fires at 50% of grace period remaining
      setTimeout(async () => {
        try {
          const [stillPending] = await db
            .select()
            .from(kotcRotationQueuesTable)
            .where(and(
              eq(kotcRotationQueuesTable.battleId, gameCard.battleId),
              eq(kotcRotationQueuesTable.teamId, loserTeamId),
              eq(kotcRotationQueuesTable.status, "pending_purchase"),
            ));
          if (stillPending) {
            const halfSec = Math.ceil((season.gracePeriodSeconds || 60) / 2);
            sendMultiChannelNotification(["push", "in_app"], {
              userId: loserTeam.captainUserId,
              type: "kotc_lives_low",
              subject: "⏰ Grace Period Expiring Soon",
              body: `${loserTeam.name} — about ${halfSec}s left to purchase lives or you'll be removed from the queue!`,
            }).catch(() => {});
          }
        } catch (e) {
          console.error("[kotc] grace midpoint notify:", e);
        }
      }, halfGraceMs);

      // Full expiry: fires at end of grace period
      setTimeout(async () => {
        try {
          const [current] = await db
            .select()
            .from(kotcRotationQueuesTable)
            .where(and(
              eq(kotcRotationQueuesTable.battleId, gameCard.battleId),
              eq(kotcRotationQueuesTable.teamId, loserTeamId),
              eq(kotcRotationQueuesTable.status, "pending_purchase"),
            ));

          if (current) {
            const [refreshedTeam] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.id, loserTeamId));
            if ((refreshedTeam?.livesBalance ?? 0) <= 0) {
              await db.update(kotcRotationQueuesTable).set({
                status: "bowed_out",
                bowedOutAt: new Date(),
                updatedAt: new Date(),
              }).where(eq(kotcRotationQueuesTable.id, current.id));

              sendMultiChannelNotification(["push", "in_app"], {
                userId: loserTeam.captainUserId,
                type: "kotc_bowed_out",
                subject: "Bowed Out",
                body: `${loserTeam.name} has been removed from the queue. Purchase lives to rejoin.`,
              }).catch(() => {});
            }
          }
        } catch (e) {
          console.error("[kotc] grace timer expiry:", e);
        }
      }, graceMs);
    } else if (newBalance === 2) {
      sendMultiChannelNotification(["push", "in_app"], {
        userId: loserTeam.captainUserId,
        type: "kotc_lives_low",
        subject: "⚠️ 2 Lives Remaining",
        body: `${loserTeam.name} has only 2 lives left. Consider purchasing more to stay in the season.`,
      }).catch(() => {});
    }

    res.json({ ok: true, newBalance, loserTeamId });
  } catch (err) {
    console.error("[kotc] game result:", err);
    res.status(500).json({ error: "Failed to record game result" });
  }
});

async function reorderQueue(battleId: number, courtNumber: number, winnerTeamId: number, loserTeamId: number) {
  // Step 1: Move loser to the back of the queue
  const [maxPos] = await db
    .select({ max: sql<number>`MAX(position)` })
    .from(kotcRotationQueuesTable)
    .where(and(
      eq(kotcRotationQueuesTable.battleId, battleId),
      eq(kotcRotationQueuesTable.courtNumber, courtNumber),
      sql`status NOT IN ('bowed_out', 'pending_purchase')`,
    ));

  const newLoserPosition = (maxPos?.max ?? 0) + 1;

  await db.update(kotcRotationQueuesTable).set({
    position: newLoserPosition,
    status: "queued",
    updatedAt: new Date(),
  }).where(and(
    eq(kotcRotationQueuesTable.battleId, battleId),
    eq(kotcRotationQueuesTable.teamId, loserTeamId),
    eq(kotcRotationQueuesTable.courtNumber, courtNumber),
  ));

  // Step 2: Clear any stale on_court state for this court that doesn't belong to the winner
  // (prevents on_court accumulation across multiple games)
  await db.update(kotcRotationQueuesTable).set({
    status: "queued",
    updatedAt: new Date(),
  }).where(and(
    eq(kotcRotationQueuesTable.battleId, battleId),
    eq(kotcRotationQueuesTable.courtNumber, courtNumber),
    eq(kotcRotationQueuesTable.status, "on_court"),
    sql`team_id != ${winnerTeamId}`,
  ));

  // Step 3: Mark winner as on_court (stays in place at position 1 for next game)
  await db.update(kotcRotationQueuesTable).set({
    status: "on_court",
    updatedAt: new Date(),
  }).where(and(
    eq(kotcRotationQueuesTable.battleId, battleId),
    eq(kotcRotationQueuesTable.teamId, winnerTeamId),
    eq(kotcRotationQueuesTable.courtNumber, courtNumber),
  ));

  const nextEntries = await db
    .select()
    .from(kotcRotationQueuesTable)
    .where(and(
      eq(kotcRotationQueuesTable.battleId, battleId),
      eq(kotcRotationQueuesTable.courtNumber, courtNumber),
      eq(kotcRotationQueuesTable.status, "queued"),
    ))
    .orderBy(asc(kotcRotationQueuesTable.position))
    .limit(1);

  if (nextEntries.length > 0) {
    const nextTeamId = nextEntries[0].teamId;
    const [nextTeam] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.id, nextTeamId));
    if (nextTeam) {
      const players = await db
        .select()
        .from(kotcTeamPlayersTable)
        .where(and(eq(kotcTeamPlayersTable.teamId, nextTeamId), eq(kotcTeamPlayersTable.status, "active")));
      for (const p of players) {
        sendMultiChannelNotification(["push", "in_app"], {
          userId: p.userId,
          type: "kotc_on_deck",
          subject: "You're on deck!",
          body: `${nextTeam.name} — you're next up in the rotation. Get ready!`,
        }).catch(() => {});
      }
    }
  }
}

// ─── Admin: Manual Life Credit ────────────────────────────────────────────────

router.post("/kotc/teams/:teamId/credit-lives", requireAdmin, async (req, res) => {
  try {
    const teamId = Number(req.params.teamId);
    const { amount, reason } = req.body;
    if (!amount || Number(amount) === 0) return void res.status(400).json({ error: "amount required" });

    const { userId: clerkId } = getAuth(req);
    const user = await getDbUser(clerkId!);

    const [team] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.id, teamId));
    if (!team) return void res.status(404).json({ error: "Team not found" });

    const newBalance = team.livesBalance + Number(amount);
    await db.update(kotcTeamsTable).set({
      livesBalance: newBalance,
      updatedAt: new Date(),
    }).where(eq(kotcTeamsTable.id, teamId));

    const [entry] = await db.insert(kotcLifeLedgerTable).values({
      teamId,
      delta: Number(amount),
      reason: reason || "admin_credit",
      referenceType: "admin",
      balanceAfter: newBalance,
      createdByUserId: user?.id,
    }).returning();

    if (newBalance > 0) {
      const [queueEntry] = await db
        .select()
        .from(kotcRotationQueuesTable)
        .where(and(
          eq(kotcRotationQueuesTable.teamId, teamId),
          eq(kotcRotationQueuesTable.status, "pending_purchase"),
        ));

      if (queueEntry) {
        await db.update(kotcRotationQueuesTable).set({
          status: "queued",
          graceStartedAt: null,
          graceExpiresAt: null,
          updatedAt: new Date(),
        }).where(eq(kotcRotationQueuesTable.id, queueEntry.id));
      }
    }

    res.json({ ok: true, newBalance, entry });
  } catch (err) {
    res.status(500).json({ error: "Failed to credit lives" });
  }
});

// ─── Leaderboard ──────────────────────────────────────────────────────────────

router.get("/kotc/seasons/:seasonId/leaderboard", requireAuth, async (req, res) => {
  try {
    const seasonId = Number(req.params.seasonId);

    const teams = await db
      .select()
      .from(kotcTeamsTable)
      .where(and(eq(kotcTeamsTable.seasonId, seasonId), eq(kotcTeamsTable.status, "active")));

    if (teams.length === 0) return void res.json([]);

    // Derive Reigning King from prior seasons' championTeamId → captain linkage
    // A team is "Reigning King" if its captain was the captain of a prior season's champion team
    const priorChampionSeasons = await db
      .select({ championTeamId: kotcSeasonsTable.championTeamId })
      .from(kotcSeasonsTable)
      .where(and(
        sql`${kotcSeasonsTable.id} != ${seasonId}`,
        sql`${kotcSeasonsTable.championTeamId} IS NOT NULL`,
      ));

    const priorChampionTeamIds = priorChampionSeasons
      .map((s) => s.championTeamId)
      .filter((id): id is number => id != null);

    const priorChampionCaptainIds = new Set<number>();
    if (priorChampionTeamIds.length > 0) {
      const priorChampionTeams = await db
        .select({ captainUserId: kotcTeamsTable.captainUserId })
        .from(kotcTeamsTable)
        .where(inArray(kotcTeamsTable.id, priorChampionTeamIds));
      for (const t of priorChampionTeams) priorChampionCaptainIds.add(t.captainUserId);
    }

    const teamIds = teams.map((t) => t.id);

    const battles = await db
      .select({ id: kotcBattlesTable.id })
      .from(kotcBattlesTable)
      .where(eq(kotcBattlesTable.seasonId, seasonId));

    const battleIds = battles.map((b) => b.id);
    const allGameCards = battleIds.length > 0
      ? await db
          .select()
          .from(kotcGameCardsTable)
          .where(and(
            inArray(kotcGameCardsTable.battleId, battleIds),
            sql`${kotcGameCardsTable.status} = 'completed'`,
          ))
      : [];

    const latestBattle = battleIds.length > 0 ? battleIds[battleIds.length - 1] : null;
    const currentBattleCards = latestBattle
      ? allGameCards.filter((gc) => gc.battleId === latestBattle)
      : [];

    const stats = teams.map((team) => {
      const wins = allGameCards.filter((gc) => gc.winnerTeamId === team.id).length;
      const losses = allGameCards.filter((gc) => gc.loserTeamId === team.id).length;
      const gamesPlayed = wins + losses;

      const battlesAttended = new Set(
        allGameCards
          .filter((gc) => gc.team1Id === team.id || gc.team2Id === team.id)
          .map((gc) => gc.battleId)
      ).size;

      const winRate = gamesPlayed > 0 ? wins / gamesPlayed : 0;

      let hotStreak = 0;
      const currentCards = [...currentBattleCards]
        .filter((gc) => gc.team1Id === team.id || gc.team2Id === team.id)
        .sort((a, b) => new Date(a.completedAt ?? a.createdAt).getTime() - new Date(b.completedAt ?? b.createdAt).getTime());

      for (let i = currentCards.length - 1; i >= 0; i--) {
        if (currentCards[i].winnerTeamId === team.id) {
          hotStreak++;
        } else {
          break;
        }
      }

      return {
        teamId: team.id,
        teamName: team.name,
        teamColor: team.color,
        livesRemaining: team.livesBalance,
        livesConsumed: team.livesConsumed,
        wins,
        losses,
        gamesPlayed,
        battlesAttended,
        winRate: Math.round(winRate * 100) / 100,
        hotStreak: hotStreak >= 3 ? hotStreak : 0,
        isReigning: priorChampionCaptainIds.has(team.captainUserId),
        status: team.status,
      };
    });

    // Build head-to-head win map: h2hWins[A][B] = number of times A beat B
    const h2hWins: Record<number, Record<number, number>> = {};
    for (const gc of allGameCards) {
      if (gc.winnerTeamId == null || gc.loserTeamId == null) continue;
      if (!h2hWins[gc.winnerTeamId]) h2hWins[gc.winnerTeamId] = {};
      h2hWins[gc.winnerTeamId][gc.loserTeamId] = (h2hWins[gc.winnerTeamId][gc.loserTeamId] ?? 0) + 1;
    }

    stats.sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.winRate !== a.winRate) return b.winRate - a.winRate;
      // Head-to-head tiebreaker: compare direct matchup wins between the two teams
      const aBeatsB = h2hWins[a.teamId]?.[b.teamId] ?? 0;
      const bBeatsA = h2hWins[b.teamId]?.[a.teamId] ?? 0;
      if (aBeatsB !== bBeatsA) return bBeatsA - aBeatsB;
      // Final tiebreaker: fewer lives consumed is better
      if (a.livesConsumed !== b.livesConsumed) return a.livesConsumed - b.livesConsumed;
      return 0;
    });

    res.json(stats);
  } catch (err) {
    console.error("[kotc] leaderboard:", err);
    res.status(500).json({ error: "Failed to fetch leaderboard" });
  }
});

router.get("/kotc/seasons/:seasonId/game-cards", requireAuth, async (req, res) => {
  try {
    const seasonId = Number(req.params.seasonId);

    const battles = await db
      .select({ id: kotcBattlesTable.id })
      .from(kotcBattlesTable)
      .where(eq(kotcBattlesTable.seasonId, seasonId));

    const battleIds = battles.map((b) => b.id);
    if (battleIds.length === 0) return void res.json([]);

    const gameCards = await db
      .select()
      .from(kotcGameCardsTable)
      .where(inArray(kotcGameCardsTable.battleId, battleIds))
      .orderBy(desc(kotcGameCardsTable.createdAt));

    res.json(gameCards);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch game cards" });
  }
});

// ─── Phase 2: Drama Rules Evaluation (called after game result) ───────────────

async function evaluateDramaRules(
  seasonId: number,
  battleId: number,
  winnerTeamId: number,
  loserTeamIdBeforeResult: number,
  loserBalanceBeforeResult: number,
): Promise<void> {
  try {
    const rules = await db
      .select()
      .from(kotcDramaRulesTable)
      .where(and(eq(kotcDramaRulesTable.seasonId, seasonId), eq(kotcDramaRulesTable.isActive, true)));

    if (rules.length === 0) return;

    const [winnerTeam] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.id, winnerTeamId));
    if (!winnerTeam) return;

    for (const rule of rules) {
      let triggered = false;

      if (rule.triggerType === "consecutive_wins") {
        // Count how many consecutive wins the winner has in the current battle
        const battleCards = await db
          .select()
          .from(kotcGameCardsTable)
          .where(and(
            eq(kotcGameCardsTable.battleId, battleId),
            eq(kotcGameCardsTable.status, "completed"),
          ))
          .orderBy(desc(kotcGameCardsTable.completedAt));

        let streak = 0;
        for (const card of battleCards) {
          if (card.winnerTeamId === winnerTeamId) {
            streak++;
          } else if (card.team1Id === winnerTeamId || card.team2Id === winnerTeamId) {
            break;
          }
        }

        // Only trigger if we hit exactly the threshold (avoid repeat triggers)
        if (streak === rule.threshold) triggered = true;

      } else if (rule.triggerType === "win_from_one_life") {
        // Loser had exactly 1 life before deduction, and winner wins
        if (loserBalanceBeforeResult === 1) triggered = true;

      } else if (rule.triggerType === "most_wins_in_battle") {
        // Check if winner now has the most wins in this battle and count == threshold
        const battleCards = await db
          .select()
          .from(kotcGameCardsTable)
          .where(and(
            eq(kotcGameCardsTable.battleId, battleId),
            eq(kotcGameCardsTable.status, "completed"),
          ));

        const winCounts: Record<number, number> = {};
        for (const card of battleCards) {
          if (card.winnerTeamId) {
            winCounts[card.winnerTeamId] = (winCounts[card.winnerTeamId] ?? 0) + 1;
          }
        }

        const winnerCount = winCounts[winnerTeamId] ?? 0;
        const maxCount = Math.max(...Object.values(winCounts));
        if (winnerCount === maxCount && winnerCount === rule.threshold) triggered = true;
      }

      if (triggered) {
        const newBalance = winnerTeam.livesBalance + rule.rewardLives;
        await db.update(kotcTeamsTable)
          .set({ livesBalance: newBalance, updatedAt: new Date() })
          .where(eq(kotcTeamsTable.id, winnerTeamId));

        await db.insert(kotcLifeLedgerTable).values({
          teamId: winnerTeamId,
          delta: rule.rewardLives,
          reason: "drama_rule_bonus",
          referenceType: "kotc_drama_rule",
          referenceId: rule.id,
          balanceAfter: newBalance,
        });

        // Notify all team players
        const players = await db
          .select()
          .from(kotcTeamPlayersTable)
          .where(and(eq(kotcTeamPlayersTable.teamId, winnerTeamId), eq(kotcTeamPlayersTable.status, "active")));

        for (const p of players) {
          sendMultiChannelNotification(["push", "in_app"], {
            userId: p.userId,
            type: "kotc_drama_rule_triggered",
            subject: `🎭 ${rule.name}!`,
            body: rule.notificationMessage + ` (+${rule.rewardLives} bonus life!)`,
            metadata: { ruleId: rule.id, teamId: winnerTeamId, lives: rule.rewardLives },
          }).catch(() => {});
        }
      }
    }
  } catch (e) {
    console.error("[kotc] drama rules evaluation:", e);
  }
}

// ─── Phase 2: Drama Rules CRUD ────────────────────────────────────────────────

router.get("/kotc/seasons/:seasonId/drama-rules", requireAuth, async (req, res) => {
  try {
    const seasonId = Number(req.params.seasonId);
    const rules = await db
      .select()
      .from(kotcDramaRulesTable)
      .where(eq(kotcDramaRulesTable.seasonId, seasonId))
      .orderBy(asc(kotcDramaRulesTable.id));
    res.json(rules);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch drama rules" });
  }
});

router.post("/kotc/seasons/:seasonId/drama-rules", requireAdmin, async (req, res) => {
  try {
    const seasonId = Number(req.params.seasonId);
    const { name, triggerType, threshold, rewardLives, notificationMessage } = req.body;
    if (!name || !triggerType || !notificationMessage) {
      return void res.status(400).json({ error: "name, triggerType, and notificationMessage required" });
    }
    const VALID_TRIGGERS = ["consecutive_wins", "win_from_one_life", "most_wins_in_battle"];
    if (!VALID_TRIGGERS.includes(triggerType)) {
      return void res.status(400).json({ error: `triggerType must be one of: ${VALID_TRIGGERS.join(", ")}` });
    }
    const [rule] = await db.insert(kotcDramaRulesTable).values({
      seasonId,
      name,
      triggerType,
      threshold: Number(threshold ?? 1),
      rewardLives: Number(rewardLives ?? 1),
      notificationMessage,
    }).returning();
    res.status(201).json(rule);
  } catch (err) {
    res.status(500).json({ error: "Failed to create drama rule" });
  }
});

router.patch("/kotc/drama-rules/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const updates: Record<string, unknown> = {};
    for (const key of ["name", "triggerType", "threshold", "rewardLives", "notificationMessage", "isActive"]) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    const [rule] = await db.update(kotcDramaRulesTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(kotcDramaRulesTable.id, id))
      .returning();
    if (!rule) return void res.status(404).json({ error: "Drama rule not found" });
    res.json(rule);
  } catch (err) {
    res.status(500).json({ error: "Failed to update drama rule" });
  }
});

router.delete("/kotc/drama-rules/:id", requireAdmin, async (req, res) => {
  try {
    await db.delete(kotcDramaRulesTable).where(eq(kotcDramaRulesTable.id, Number(req.params.id)));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete drama rule" });
  }
});

// ─── Phase 2: Life Pack Stripe Checkout ──────────────────────────────────────

router.get("/kotc/seasons/:seasonId/life-packs", requireAuth, async (req, res) => {
  try {
    const [season] = await db.select().from(kotcSeasonsTable).where(eq(kotcSeasonsTable.id, Number(req.params.seasonId)));
    if (!season) return void res.status(404).json({ error: "Season not found" });
    res.json({ lifePacks: (season as any).lifePacks ?? [] });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch life packs" });
  }
});

router.post("/kotc/teams/:teamId/checkout", requireAuth, async (req, res) => {
  try {
    const teamId = Number(req.params.teamId);
    const { packIndex } = req.body;
    if (packIndex === undefined || packIndex === null) {
      return void res.status(400).json({ error: "packIndex required" });
    }

    const { userId: clerkId } = getAuth(req);
    const user = await getDbUser(clerkId!);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    const [team] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.id, teamId));
    if (!team) return void res.status(404).json({ error: "Team not found" });
    if (team.captainUserId !== user.id && user.role !== "admin") {
      return void res.status(403).json({ error: "Only the captain can purchase lives" });
    }
    if (team.status === "dissolved") {
      return void res.status(400).json({ error: "Cannot purchase lives for a dissolved team" });
    }

    const [season] = await db.select().from(kotcSeasonsTable).where(eq(kotcSeasonsTable.id, team.seasonId));
    if (!season) return void res.status(404).json({ error: "Season not found" });

    const lifePacks: Array<{ name: string; lives: number; priceCents: number }> = (season as any).lifePacks ?? [];
    if (lifePacks.length === 0) {
      return void res.status(400).json({ error: "No life packs configured for this season" });
    }

    const pack = lifePacks[Number(packIndex)];
    if (!pack) return void res.status(400).json({ error: `Pack index ${packIndex} not found` });

    // Guardian spending cap check for youth seasons
    if (season.isYouth) {
      const guardian = await db
        .select()
        .from(guardiansTable)
        .where(and(eq(guardiansTable.youthUserId, user.id), eq(guardiansTable.status, "approved")))
        .then((r) => r[0]);

      if (!guardian) {
        return void res.status(403).json({ error: "Youth captain requires an approved guardian to purchase lives" });
      }

      const capCents = (team as any).guardianSpendingCapCents ?? null;
      const alreadySpentCents = (team as any).totalPurchasedCents ?? 0;
      if (capCents !== null && alreadySpentCents + pack.priceCents > capCents) {
        return void res.status(400).json({
          error: `Purchase would exceed the guardian-set spending cap of $${(capCents / 100).toFixed(2)}. Current spend: $${(alreadySpentCents / 100).toFixed(2)}.`,
        });
      }

      // Create pending purchase record — requires guardian approval
      const guardianUser = await db.select().from(usersTable).where(eq(usersTable.id, guardian.guardianUserId)).then((r) => r[0]);

      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const [pending] = await db.insert(kotcPendingPurchasesTable).values({
        teamId,
        seasonId: season.id,
        guardianUserId: guardian.guardianUserId,
        packIndex: Number(packIndex),
        packName: pack.name,
        packLives: pack.lives,
        packPriceCents: pack.priceCents,
        status: "pending",
        expiresAt,
      }).returning();

      // Notify guardian
      if (guardianUser) {
        sendMultiChannelNotification(["push", "in_app"], {
          userId: guardianUser.id,
          type: "kotc_guardian_approval_request",
          subject: `Purchase Approval Required — ${team.name}`,
          body: `${team.name} wants to purchase "${pack.name}" (${pack.lives} lives) for $${(pack.priceCents / 100).toFixed(2)}. Open the app to approve or decline.`,
          metadata: { pendingPurchaseId: pending.id, teamId, packName: pack.name, priceCents: pack.priceCents },
          link: `/kotc/pending-purchases/${pending.id}`,
        }).catch(() => {});
      }

      return void res.status(202).json({
        requiresGuardianApproval: true,
        pendingPurchaseId: pending.id,
        message: "Guardian approval request sent. Lives will be credited after approval.",
      });
    }

    // Adult season: create Stripe checkout session directly
    const stripe = await getUncachableStripeClient();
    const APP_URL = (process.env.PUBLIC_APP_URL ?? "https://playonfutsal.vercel.app").replace(/\/$/, "");
    const priceInCents = pack.priceCents;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: priceInCents,
            product_data: {
              name: `KotC Life Pack — ${pack.name}`,
              description: `${pack.lives} lives for ${team.name} in ${season.name}. Lives are non-refundable if you dissolve your team.`,
            },
          },
        },
      ],
      metadata: {
        type: "kotc_life_purchase",
        teamId: String(teamId),
        seasonId: String(season.id),
        packIndex: String(packIndex),
        packName: pack.name,
        packLives: String(pack.lives),
        packPriceCents: String(priceInCents),
        clerkUserId: clerkId!,
      },
      success_url: `${APP_URL}/kotc/team/${teamId}?purchase=success`,
      cancel_url: `${APP_URL}/kotc/team/${teamId}?purchase=cancelled`,
    });

    res.json({
      requiresGuardianApproval: false,
      checkoutUrl: session.url,
      sessionId: session.id,
      disclosure: "Lives are non-refundable if you dissolve your team.",
    });
  } catch (err) {
    console.error("[kotc] checkout:", err);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// ─── Phase 2: Guardian Purchase Approval ─────────────────────────────────────

router.get("/kotc/pending-purchases", requireAuth, async (req, res) => {
  try {
    const { userId: clerkId } = getAuth(req);
    const user = await getDbUser(clerkId!);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    const pending = await db
      .select()
      .from(kotcPendingPurchasesTable)
      .where(and(
        eq(kotcPendingPurchasesTable.guardianUserId, user.id),
        eq(kotcPendingPurchasesTable.status, "pending"),
      ))
      .orderBy(desc(kotcPendingPurchasesTable.createdAt));

    res.json(pending);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch pending purchases" });
  }
});

router.get("/kotc/teams/:teamId/pending-purchases", requireAuth, async (req, res) => {
  try {
    const teamId = Number(req.params.teamId);
    const { userId: clerkId } = getAuth(req);
    const user = await getDbUser(clerkId!);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    const [team] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.id, teamId));
    if (!team) return void res.status(404).json({ error: "Team not found" });

    if (team.captainUserId !== user.id && user.role !== "admin") {
      return void res.status(403).json({ error: "Forbidden" });
    }

    const pending = await db
      .select()
      .from(kotcPendingPurchasesTable)
      .where(eq(kotcPendingPurchasesTable.teamId, teamId))
      .orderBy(desc(kotcPendingPurchasesTable.createdAt));

    res.json(pending);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch pending purchases" });
  }
});

router.post("/kotc/pending-purchases/:id/approve", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { userId: clerkId } = getAuth(req);
    const user = await getDbUser(clerkId!);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    const [pending] = await db
      .select()
      .from(kotcPendingPurchasesTable)
      .where(eq(kotcPendingPurchasesTable.id, id));

    if (!pending) return void res.status(404).json({ error: "Pending purchase not found" });
    if (pending.guardianUserId !== user.id && user.role !== "admin") {
      return void res.status(403).json({ error: "Only the guardian may approve this purchase" });
    }
    if (pending.status !== "pending") {
      return void res.status(400).json({ error: `Purchase already ${pending.status}` });
    }
    if (pending.expiresAt && new Date() > pending.expiresAt) {
      await db.update(kotcPendingPurchasesTable)
        .set({ status: "expired", updatedAt: new Date() })
        .where(eq(kotcPendingPurchasesTable.id, id));
      return void res.status(400).json({ error: "This purchase approval request has expired" });
    }

    const [team] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.id, pending.teamId));
    if (!team) return void res.status(404).json({ error: "Team not found" });

    const [season] = await db.select().from(kotcSeasonsTable).where(eq(kotcSeasonsTable.id, pending.seasonId));
    if (!season) return void res.status(404).json({ error: "Season not found" });

    // Check spending cap again at approval time
    const capCents = (team as any).guardianSpendingCapCents ?? null;
    const alreadySpentCents = (team as any).totalPurchasedCents ?? 0;
    if (capCents !== null && alreadySpentCents + pending.packPriceCents > capCents) {
      return void res.status(400).json({
        error: `Purchase would exceed the spending cap of $${(capCents / 100).toFixed(2)}`,
      });
    }

    // Create Stripe checkout session
    const stripe = await getUncachableStripeClient();
    const APP_URL = (process.env.PUBLIC_APP_URL ?? "https://playonfutsal.vercel.app").replace(/\/$/, "");

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: pending.packPriceCents,
            product_data: {
              name: `KotC Life Pack — ${pending.packName}`,
              description: `${pending.packLives} lives for ${team.name} (${season.name}). Lives are non-refundable if you dissolve your team.`,
            },
          },
        },
      ],
      metadata: {
        type: "kotc_life_purchase",
        teamId: String(pending.teamId),
        seasonId: String(pending.seasonId),
        packIndex: String(pending.packIndex),
        packName: pending.packName,
        packLives: String(pending.packLives),
        packPriceCents: String(pending.packPriceCents),
        pendingPurchaseId: String(pending.id),
        clerkUserId: clerkId!,
      },
      success_url: `${APP_URL}/kotc/team/${pending.teamId}?purchase=success`,
      cancel_url: `${APP_URL}/kotc/team/${pending.teamId}?purchase=cancelled`,
    });

    await db.update(kotcPendingPurchasesTable)
      .set({ status: "approved", stripeSessionId: session.id, processedAt: new Date(), updatedAt: new Date() })
      .where(eq(kotcPendingPurchasesTable.id, id));

    // Notify captain that guardian approved
    sendMultiChannelNotification(["push", "in_app"], {
      userId: team.captainUserId,
      type: "kotc_guardian_approved",
      subject: "Purchase Approved!",
      body: `Your guardian approved the "${pending.packName}" purchase. Complete checkout to receive your lives.`,
      link: session.url ?? undefined,
      metadata: { checkoutUrl: session.url, sessionId: session.id },
    }).catch(() => {});

    res.json({ ok: true, checkoutUrl: session.url, sessionId: session.id });
  } catch (err) {
    console.error("[kotc] approve pending purchase:", err);
    res.status(500).json({ error: "Failed to approve purchase" });
  }
});

router.post("/kotc/pending-purchases/:id/decline", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { userId: clerkId } = getAuth(req);
    const user = await getDbUser(clerkId!);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    const [pending] = await db.select().from(kotcPendingPurchasesTable).where(eq(kotcPendingPurchasesTable.id, id));
    if (!pending) return void res.status(404).json({ error: "Pending purchase not found" });
    if (pending.guardianUserId !== user.id && user.role !== "admin") {
      return void res.status(403).json({ error: "Only the guardian may decline this purchase" });
    }
    if (pending.status !== "pending") {
      return void res.status(400).json({ error: `Purchase already ${pending.status}` });
    }

    await db.update(kotcPendingPurchasesTable)
      .set({ status: "declined", processedAt: new Date(), updatedAt: new Date() })
      .where(eq(kotcPendingPurchasesTable.id, id));

    const [team] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.id, pending.teamId));
    if (team) {
      sendMultiChannelNotification(["push", "in_app"], {
        userId: team.captainUserId,
        type: "kotc_guardian_declined",
        subject: "Purchase Declined",
        body: `Your guardian declined the "${pending.packName}" purchase request.`,
      }).catch(() => {});
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to decline purchase" });
  }
});

router.patch("/kotc/teams/:teamId/guardian-cap", requireAuth, async (req, res) => {
  try {
    const teamId = Number(req.params.teamId);
    const { guardianSpendingCapCents } = req.body;
    const { userId: clerkId } = getAuth(req);
    const user = await getDbUser(clerkId!);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    const [team] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.id, teamId));
    if (!team) return void res.status(404).json({ error: "Team not found" });

    // Only guardian of the captain or admin may set the cap
    const isGuardian = await db
      .select()
      .from(guardiansTable)
      .where(and(eq(guardiansTable.guardianUserId, user.id), eq(guardiansTable.youthUserId, team.captainUserId), eq(guardiansTable.status, "approved")))
      .then((r) => !!r[0]);

    if (!isGuardian && user.role !== "admin") {
      return void res.status(403).json({ error: "Only the team's guardian or an admin may set the spending cap" });
    }

    const [updated] = await db.update(kotcTeamsTable)
      .set({ guardianSpendingCapCents: guardianSpendingCapCents !== null ? Number(guardianSpendingCapCents) : null, updatedAt: new Date() } as any)
      .where(eq(kotcTeamsTable.id, teamId))
      .returning();

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: "Failed to set guardian spending cap" });
  }
});

// ─── Phase 2: Team Dissolution ────────────────────────────────────────────────

router.post("/kotc/teams/:teamId/dissolve", requireAuth, async (req, res) => {
  try {
    const teamId = Number(req.params.teamId);
    const { userId: clerkId } = getAuth(req);
    const user = await getDbUser(clerkId!);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    const [team] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.id, teamId));
    if (!team) return void res.status(404).json({ error: "Team not found" });

    const isGuardian = await db
      .select()
      .from(guardiansTable)
      .where(and(eq(guardiansTable.guardianUserId, user.id), eq(guardiansTable.youthUserId, team.captainUserId), eq(guardiansTable.status, "approved")))
      .then((r) => !!r[0]);

    if (team.captainUserId !== user.id && !isGuardian && user.role !== "admin") {
      return void res.status(403).json({ error: "Only the team captain, their guardian, or an admin may dissolve the team" });
    }
    if (team.status === "dissolved") {
      return void res.status(400).json({ error: "Team is already dissolved" });
    }

    // Check refund eligibility: zero battles attended AND within 48hr of first purchase
    let refundIssued = false;
    let refundMessage = "Lives forfeited. No refund issued.";

    const firstPurchaseAt: Date | null = (team as any).firstPurchaseAt ?? null;
    const totalPurchasedCents: number = (team as any).totalPurchasedCents ?? 0;

    // Count battles where this team played at least one game
    const [season] = await db.select().from(kotcSeasonsTable).where(eq(kotcSeasonsTable.id, team.seasonId));
    const battles = await db
      .select({ id: kotcBattlesTable.id })
      .from(kotcBattlesTable)
      .where(eq(kotcBattlesTable.seasonId, team.seasonId));

    const battleIds = battles.map((b) => b.id);
    const gamesPlayed = battleIds.length > 0
      ? await db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(kotcGameCardsTable)
          .where(and(
            inArray(kotcGameCardsTable.battleId, battleIds),
            or(eq(kotcGameCardsTable.team1Id, teamId), eq(kotcGameCardsTable.team2Id, teamId)),
            eq(kotcGameCardsTable.status, "completed"),
          ))
          .then((r) => Number(r[0]?.count ?? 0))
      : 0;

    const within48hrs = firstPurchaseAt
      ? Date.now() - firstPurchaseAt.getTime() < 48 * 60 * 60 * 1000
      : false;

    if (gamesPlayed === 0 && within48hrs && totalPurchasedCents > 0) {
      // Issue refund via Stripe — find the original payment
      try {
        const payment = await db
          .select()
          .from(paymentsTable)
          .where(and(eq(paymentsTable.entityType, "kotc_life_purchase"), eq(paymentsTable.entityId, teamId)))
          .orderBy(asc(paymentsTable.createdAt))
          .then((r) => r[0]);

        if (payment?.providerChargeId) {
          const stripe = await getUncachableStripeClient();
          await stripe.refunds.create({ charge: payment.providerChargeId });
          refundIssued = true;
          refundMessage = `Full refund of $${(totalPurchasedCents / 100).toFixed(2)} issued to your original payment method.`;

          await db.update(paymentsTable)
            .set({ status: "refunded", updatedAt: new Date() } as any)
            .where(eq(paymentsTable.id, payment.id));
        }
      } catch (stripeErr) {
        console.error("[kotc] dissolution refund:", stripeErr);
        refundMessage = "Refund eligible but Stripe refund failed — contact support.";
      }
    }

    // Zero out lives
    await db.update(kotcTeamsTable)
      .set({ livesBalance: 0, status: "dissolved", updatedAt: new Date() })
      .where(eq(kotcTeamsTable.id, teamId));

    if (team.livesBalance > 0 || refundIssued) {
      await db.insert(kotcLifeLedgerTable).values({
        teamId,
        delta: -team.livesBalance,
        reason: refundIssued ? "dissolution_refund" : "dissolution_forfeit",
        referenceType: "dissolution",
        balanceAfter: 0,
        createdByUserId: user.id,
      });
    }

    // Remove from any active waitlists
    await db.update(kotcWaitlistTable)
      .set({ status: "released", releasedAt: new Date(), updatedAt: new Date() } as any)
      .where(and(eq(kotcWaitlistTable.teamId, teamId), eq(kotcWaitlistTable.status, "waiting")));

    // Notify captain and all players
    const players = await db
      .select()
      .from(kotcTeamPlayersTable)
      .where(and(eq(kotcTeamPlayersTable.teamId, teamId), eq(kotcTeamPlayersTable.status, "active")));

    for (const p of players) {
      sendMultiChannelNotification(["push", "in_app"], {
        userId: p.userId,
        type: "kotc_team_dissolved",
        subject: `${team.name} Dissolved`,
        body: `${team.name} has been dissolved. ${refundMessage}`,
        metadata: { refundIssued, teamId },
      }).catch(() => {});
    }

    res.json({ ok: true, refundIssued, refundMessage });
  } catch (err) {
    console.error("[kotc] dissolve team:", err);
    res.status(500).json({ error: "Failed to dissolve team" });
  }
});

// ─── Phase 2: Battle Cancellation with Carry-Forward ─────────────────────────

router.post("/kotc/battles/:battleId/cancel", requireAdmin, async (req, res) => {
  try {
    const battleId = Number(req.params.battleId);
    const [battle] = await db.select().from(kotcBattlesTable).where(eq(kotcBattlesTable.id, battleId));
    if (!battle) return void res.status(404).json({ error: "Battle not found" });
    if (battle.status === "cancelled") return void res.status(400).json({ error: "Battle already cancelled" });

    // Find all registered teams
    const registrations = await db
      .select()
      .from(kotcBattleRegistrationsTable)
      .where(and(
        eq(kotcBattleRegistrationsTable.battleId, battleId),
        eq(kotcBattleRegistrationsTable.status, "registered"),
      ));

    const teamIds = registrations.map((r) => r.teamId);

    // Mark battle cancelled
    await db.update(kotcBattlesTable)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(kotcBattlesTable.id, battleId));

    // Lives automatically carry forward — they stay in team's balance unchanged.
    // Write a carry_forward ledger note so there's an explicit audit trail.
    for (const reg of registrations) {
      const [team] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.id, reg.teamId));
      if (team && team.livesBalance > 0) {
        await db.insert(kotcLifeLedgerTable).values({
          teamId: reg.teamId,
          delta: 0,
          reason: "battle_cancellation_carry_forward",
          referenceType: "kotc_battle",
          referenceId: battleId,
          balanceAfter: team.livesBalance,
        });
      }
    }

    // Notify all affected captains and team players
    if (teamIds.length > 0) {
      const players = await db
        .select()
        .from(kotcTeamPlayersTable)
        .where(and(inArray(kotcTeamPlayersTable.teamId, teamIds), eq(kotcTeamPlayersTable.status, "active")));

      const uniqueUids = [...new Set(players.map((p) => p.userId))];
      for (const uid of uniqueUids) {
        sendMultiChannelNotification(["push", "in_app"], {
          userId: uid,
          type: "kotc_battle_cancelled",
          subject: "⚠️ Battle Cancelled",
          body: "Tonight's battle has been cancelled. Don't worry — your lives are saved and carry forward to your next battle.",
          metadata: { battleId },
        }).catch(() => {});
      }
    }

    // Also release waitlisted teams and notify them
    const waitlisted = await db
      .select()
      .from(kotcWaitlistTable)
      .where(and(eq(kotcWaitlistTable.battleId, battleId), eq(kotcWaitlistTable.status, "waiting")));

    if (waitlisted.length > 0) {
      await db.update(kotcWaitlistTable)
        .set({ status: "released", releasedAt: new Date(), updatedAt: new Date() } as any)
        .where(and(eq(kotcWaitlistTable.battleId, battleId), eq(kotcWaitlistTable.status, "waiting")));

      for (const w of waitlisted) {
        const [wTeam] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.id, w.teamId));
        if (wTeam) {
          sendMultiChannelNotification(["push", "in_app"], {
            userId: wTeam.captainUserId,
            type: "kotc_battle_cancelled",
            subject: "Battle Cancelled",
            body: "The battle you were waitlisted for has been cancelled.",
          }).catch(() => {});
        }
      }
    }

    res.json({ ok: true, teamsNotified: teamIds.length });
  } catch (err) {
    console.error("[kotc] cancel battle:", err);
    res.status(500).json({ error: "Failed to cancel battle" });
  }
});

// ─── Phase 2: Waitlist ────────────────────────────────────────────────────────

router.get("/kotc/battles/:battleId/waitlist", requireAuth, async (req, res) => {
  try {
    const battleId = Number(req.params.battleId);
    const waitlist = await db
      .select({
        id: kotcWaitlistTable.id,
        battleId: kotcWaitlistTable.battleId,
        teamId: kotcWaitlistTable.teamId,
        position: kotcWaitlistTable.position,
        status: kotcWaitlistTable.status,
        carryForward: kotcWaitlistTable.carryForward,
        notifiedAt: kotcWaitlistTable.notifiedAt,
        responseDeadline: kotcWaitlistTable.responseDeadline,
        confirmedAt: kotcWaitlistTable.confirmedAt,
        createdAt: kotcWaitlistTable.createdAt,
        teamName: kotcTeamsTable.name,
        teamColor: kotcTeamsTable.color,
      })
      .from(kotcWaitlistTable)
      .leftJoin(kotcTeamsTable, eq(kotcTeamsTable.id, kotcWaitlistTable.teamId))
      .where(eq(kotcWaitlistTable.battleId, battleId))
      .orderBy(asc(kotcWaitlistTable.position));
    res.json(waitlist);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch waitlist" });
  }
});

router.post("/kotc/battles/:battleId/waitlist", requireAuth, async (req, res) => {
  try {
    const battleId = Number(req.params.battleId);
    const { teamId } = req.body;
    if (!teamId) return void res.status(400).json({ error: "teamId required" });

    const { userId: clerkId } = getAuth(req);
    const user = await getDbUser(clerkId!);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    const [team] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.id, Number(teamId)));
    if (!team) return void res.status(404).json({ error: "Team not found" });
    if (team.captainUserId !== user.id && user.role !== "admin") {
      return void res.status(403).json({ error: "Only the captain can join the waitlist" });
    }

    const [battle] = await db.select().from(kotcBattlesTable).where(eq(kotcBattlesTable.id, battleId));
    if (!battle) return void res.status(404).json({ error: "Battle not found" });
    if (battle.status === "cancelled") return void res.status(400).json({ error: "Cannot join waitlist for a cancelled battle" });

    // Check if waitlist is locked (2hr before start)
    if ((battle as any).waitlistLockedAt) {
      return void res.status(400).json({ error: "Waitlist is locked — no new additions accepted within 2 hours of battle start" });
    }
    const msUntilBattle = new Date(battle.scheduledAt).getTime() - Date.now();
    if (msUntilBattle <= 2 * 60 * 60 * 1000) {
      return void res.status(400).json({ error: "Waitlist is locked — less than 2 hours until battle start" });
    }

    // Check if team is already registered
    const [existing] = await db
      .select()
      .from(kotcBattleRegistrationsTable)
      .where(and(eq(kotcBattleRegistrationsTable.battleId, battleId), eq(kotcBattleRegistrationsTable.teamId, Number(teamId))));
    if (existing) return void res.status(409).json({ error: "Team is already registered for this battle" });

    // Check if already on waitlist
    const [onWaitlist] = await db
      .select()
      .from(kotcWaitlistTable)
      .where(and(
        eq(kotcWaitlistTable.battleId, battleId),
        eq(kotcWaitlistTable.teamId, Number(teamId)),
        sql`status IN ('waiting', 'notified')`,
      ));
    if (onWaitlist) return void res.status(409).json({ error: "Team is already on the waitlist" });

    const [maxPos] = await db
      .select({ max: sql<number>`MAX(position)` })
      .from(kotcWaitlistTable)
      .where(eq(kotcWaitlistTable.battleId, battleId));

    const [entry] = await db.insert(kotcWaitlistTable).values({
      battleId,
      teamId: Number(teamId),
      position: (maxPos?.max ?? 0) + 1,
      status: "waiting",
    }).returning();

    res.status(201).json(entry);
  } catch (err) {
    console.error("[kotc] join waitlist:", err);
    res.status(500).json({ error: "Failed to join waitlist" });
  }
});

router.delete("/kotc/battles/:battleId/waitlist/:teamId", requireAuth, async (req, res) => {
  try {
    const battleId = Number(req.params.battleId);
    const teamId = Number(req.params.teamId);
    const { userId: clerkId } = getAuth(req);
    const user = await getDbUser(clerkId!);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    const [team] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.id, teamId));
    if (!team) return void res.status(404).json({ error: "Team not found" });
    if (team.captainUserId !== user.id && user.role !== "admin") {
      return void res.status(403).json({ error: "Forbidden" });
    }

    await db.update(kotcWaitlistTable)
      .set({ status: "released", releasedAt: new Date(), updatedAt: new Date() } as any)
      .where(and(
        eq(kotcWaitlistTable.battleId, battleId),
        eq(kotcWaitlistTable.teamId, teamId),
        sql`status IN ('waiting', 'notified')`,
      ));

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to leave waitlist" });
  }
});

// Admin waitlist management
router.patch("/kotc/waitlist/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const updates: Record<string, unknown> = {};
    for (const key of ["position", "status", "carryForward"]) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    const [entry] = await db.update(kotcWaitlistTable)
      .set({ ...updates, updatedAt: new Date() } as any)
      .where(eq(kotcWaitlistTable.id, id))
      .returning();
    if (!entry) return void res.status(404).json({ error: "Waitlist entry not found" });
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: "Failed to update waitlist entry" });
  }
});

router.delete("/kotc/waitlist/:id", requireAdmin, async (req, res) => {
  try {
    await db.update(kotcWaitlistTable)
      .set({ status: "released", releasedAt: new Date(), updatedAt: new Date() } as any)
      .where(eq(kotcWaitlistTable.id, Number(req.params.id)));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to remove waitlist entry" });
  }
});

// Captain: keep position (carry-forward to next battle)
router.post("/kotc/waitlist/:id/keep", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { userId: clerkId } = getAuth(req);
    const user = await getDbUser(clerkId!);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    const [entry] = await db.select().from(kotcWaitlistTable).where(eq(kotcWaitlistTable.id, id));
    if (!entry) return void res.status(404).json({ error: "Waitlist entry not found" });

    const [team] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.id, entry.teamId));
    if (!team) return void res.status(404).json({ error: "Team not found" });
    if (team.captainUserId !== user.id && user.role !== "admin") {
      return void res.status(403).json({ error: "Forbidden" });
    }

    const [updated] = await db.update(kotcWaitlistTable)
      .set({ carryForward: true, updatedAt: new Date() } as any)
      .where(eq(kotcWaitlistTable.id, id))
      .returning();

    sendMultiChannelNotification(["push", "in_app"], {
      userId: team.captainUserId,
      type: "kotc_waitlist_carry_forward",
      subject: "Waitlist Position Kept",
      body: `${team.name}'s waitlist position will carry forward to the next battle.`,
    }).catch(() => {});

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: "Failed to keep waitlist position" });
  }
});

// Captain: release position (remove from waitlist)
router.post("/kotc/waitlist/:id/release", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { userId: clerkId } = getAuth(req);
    const user = await getDbUser(clerkId!);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    const [entry] = await db.select().from(kotcWaitlistTable).where(eq(kotcWaitlistTable.id, id));
    if (!entry) return void res.status(404).json({ error: "Waitlist entry not found" });

    const [team] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.id, entry.teamId));
    if (team && team.captainUserId !== user.id && user.role !== "admin") {
      return void res.status(403).json({ error: "Forbidden" });
    }

    await db.update(kotcWaitlistTable)
      .set({ status: "released", carryForward: false, releasedAt: new Date(), updatedAt: new Date() } as any)
      .where(eq(kotcWaitlistTable.id, id));

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to release waitlist position" });
  }
});

// Admin: promote waitlisted team to registered
router.post("/kotc/waitlist/:id/promote", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { courtNumber } = req.body;

    const [entry] = await db.select().from(kotcWaitlistTable).where(eq(kotcWaitlistTable.id, id));
    if (!entry) return void res.status(404).json({ error: "Waitlist entry not found" });

    const [battle] = await db.select().from(kotcBattlesTable).where(eq(kotcBattlesTable.id, entry.battleId));
    if (!battle) return void res.status(404).json({ error: "Battle not found" });

    const [team] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.id, entry.teamId));
    if (!team) return void res.status(404).json({ error: "Team not found" });

    // Register the team
    const [reg] = await db.insert(kotcBattleRegistrationsTable).values({
      battleId: entry.battleId,
      teamId: entry.teamId,
      courtNumber: courtNumber || 1,
      status: "registered",
    }).returning();

    // Mark waitlist entry as confirmed
    await db.update(kotcWaitlistTable)
      .set({ status: "confirmed", confirmedAt: new Date(), updatedAt: new Date() } as any)
      .where(eq(kotcWaitlistTable.id, id));

    // Notify captain
    sendMultiChannelNotification(["push", "in_app"], {
      userId: team.captainUserId,
      type: "kotc_waitlist_promoted",
      subject: "🎉 You're In!",
      body: `${team.name} has been promoted from the waitlist and is now registered for the battle. Purchase lives to lock in your spot!`,
      metadata: { battleId: entry.battleId, teamId: entry.teamId },
    }).catch(() => {});

    res.status(201).json({ ok: true, registration: reg });
  } catch (err) {
    console.error("[kotc] promote waitlist:", err);
    res.status(500).json({ error: "Failed to promote waitlist team" });
  }
});

// ─── Phase 2: Admin Battle Controls ──────────────────────────────────────────

router.post("/kotc/battles/:battleId/pause", requireAdmin, async (req, res) => {
  try {
    const battleId = Number(req.params.battleId);
    const [battle] = await db.select().from(kotcBattlesTable).where(eq(kotcBattlesTable.id, battleId));
    if (!battle) return void res.status(404).json({ error: "Battle not found" });
    if (battle.status !== "active") return void res.status(400).json({ error: "Battle must be active to pause" });
    if ((battle as any).pausedAt) return void res.status(400).json({ error: "Battle is already paused" });

    await db.update(kotcBattlesTable)
      .set({ pausedAt: new Date(), updatedAt: new Date() } as any)
      .where(eq(kotcBattlesTable.id, battleId));

    // Notify all moderators and registered team players
    const registrations = await db
      .select()
      .from(kotcBattleRegistrationsTable)
      .where(eq(kotcBattleRegistrationsTable.battleId, battleId));
    const teamIds = registrations.map((r) => r.teamId);
    if (teamIds.length > 0) {
      const players = await db
        .select()
        .from(kotcTeamPlayersTable)
        .where(and(inArray(kotcTeamPlayersTable.teamId, teamIds), eq(kotcTeamPlayersTable.status, "active")));
      const uniqueUids = [...new Set(players.map((p) => p.userId))];
      for (const uid of uniqueUids) {
        sendMultiChannelNotification(["in_app"], {
          userId: uid,
          type: "kotc_rules_reminder",
          subject: "⏸ Battle Paused",
          body: "The battle has been paused by the admin. Stand by.",
        }).catch(() => {});
      }
    }

    res.json({ ok: true, pausedAt: new Date() });
  } catch (err) {
    res.status(500).json({ error: "Failed to pause battle" });
  }
});

router.post("/kotc/battles/:battleId/resume", requireAdmin, async (req, res) => {
  try {
    const battleId = Number(req.params.battleId);
    const [battle] = await db.select().from(kotcBattlesTable).where(eq(kotcBattlesTable.id, battleId));
    if (!battle) return void res.status(404).json({ error: "Battle not found" });
    const pausedAt: Date | null = (battle as any).pausedAt ?? null;
    if (!pausedAt) return void res.status(400).json({ error: "Battle is not paused" });

    const pausedSeconds = Math.floor((Date.now() - pausedAt.getTime()) / 1000);
    const totalPausedSeconds = ((battle as any).pausedDurationSeconds ?? 0) + pausedSeconds;

    await db.update(kotcBattlesTable)
      .set({ pausedAt: null, pausedDurationSeconds: totalPausedSeconds, updatedAt: new Date() } as any)
      .where(eq(kotcBattlesTable.id, battleId));

    res.json({ ok: true, pausedDurationSeconds: totalPausedSeconds });
  } catch (err) {
    res.status(500).json({ error: "Failed to resume battle" });
  }
});

router.post("/kotc/battles/:battleId/extend", requireAdmin, async (req, res) => {
  try {
    const battleId = Number(req.params.battleId);
    const { additionalMinutes } = req.body;
    if (!additionalMinutes || Number(additionalMinutes) <= 0) {
      return void res.status(400).json({ error: "additionalMinutes must be positive" });
    }

    const [battle] = await db.select().from(kotcBattlesTable).where(eq(kotcBattlesTable.id, battleId));
    if (!battle) return void res.status(404).json({ error: "Battle not found" });

    const newDuration = (battle.durationMinutes || 120) + Number(additionalMinutes);
    const [updated] = await db.update(kotcBattlesTable)
      .set({ durationMinutes: newDuration, updatedAt: new Date() })
      .where(eq(kotcBattlesTable.id, battleId))
      .returning();

    // Notify all team players
    const registrations = await db
      .select()
      .from(kotcBattleRegistrationsTable)
      .where(eq(kotcBattleRegistrationsTable.battleId, battleId));
    const teamIds = registrations.map((r) => r.teamId);
    if (teamIds.length > 0) {
      const players = await db
        .select()
        .from(kotcTeamPlayersTable)
        .where(and(inArray(kotcTeamPlayersTable.teamId, teamIds), eq(kotcTeamPlayersTable.status, "active")));
      const uniqueUids = [...new Set(players.map((p) => p.userId))];
      for (const uid of uniqueUids) {
        sendMultiChannelNotification(["push", "in_app"], {
          userId: uid,
          type: "kotc_rules_reminder",
          subject: "⏱ Battle Extended",
          body: `The battle has been extended by ${additionalMinutes} minutes. New total duration: ${newDuration} minutes.`,
        }).catch(() => {});
      }
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: "Failed to extend battle" });
  }
});

// Dispute resolution: admin overrides a game card result
router.post("/kotc/game-cards/:gameCardId/dispute", requireAdmin, async (req, res) => {
  try {
    const gameCardId = Number(req.params.gameCardId);
    const { newWinnerTeamId, overrideNotes } = req.body;
    const { userId: clerkId } = getAuth(req);
    const user = await getDbUser(clerkId!);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    if (!newWinnerTeamId) return void res.status(400).json({ error: "newWinnerTeamId required" });

    const [gameCard] = await db.select().from(kotcGameCardsTable).where(eq(kotcGameCardsTable.id, gameCardId));
    if (!gameCard) return void res.status(404).json({ error: "Game card not found" });
    if (gameCard.status !== "completed") return void res.status(400).json({ error: "Can only dispute completed game cards" });

    const validTeamIds = new Set([gameCard.team1Id, gameCard.team2Id]);
    if (!validTeamIds.has(Number(newWinnerTeamId))) {
      return void res.status(400).json({ error: "newWinnerTeamId must be one of the teams on this game card" });
    }

    const previousWinnerId = gameCard.winnerTeamId;
    const previousLoserId = gameCard.loserTeamId;
    const newLoserId = gameCard.team1Id === Number(newWinnerTeamId) ? gameCard.team2Id : gameCard.team1Id;

    if (previousWinnerId === Number(newWinnerTeamId)) {
      return void res.status(400).json({ error: "New winner is the same as current winner — no change needed" });
    }

    // Reverse the life deduction from the previous loser
    if (previousLoserId) {
      const [prevLoser] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.id, previousLoserId));
      if (prevLoser) {
        const restoredBalance = prevLoser.livesBalance + 1;
        await db.update(kotcTeamsTable)
          .set({ livesBalance: restoredBalance, livesConsumed: Math.max(0, prevLoser.livesConsumed - 1), updatedAt: new Date() })
          .where(eq(kotcTeamsTable.id, previousLoserId));
        await db.insert(kotcLifeLedgerTable).values({
          teamId: previousLoserId,
          delta: 1,
          reason: "dispute_reversal",
          referenceType: "kotc_game_card",
          referenceId: gameCardId,
          balanceAfter: restoredBalance,
          createdByUserId: user.id,
        });
      }
    }

    // Apply life deduction to the new loser
    const [newLoser] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.id, newLoserId));
    if (newLoser) {
      const newBalance = Math.max(0, newLoser.livesBalance - 1);
      await db.update(kotcTeamsTable)
        .set({ livesBalance: newBalance, livesConsumed: newLoser.livesConsumed + 1, updatedAt: new Date() })
        .where(eq(kotcTeamsTable.id, newLoserId));
      await db.insert(kotcLifeLedgerTable).values({
        teamId: newLoserId,
        delta: -1,
        reason: "dispute_deduction",
        referenceType: "kotc_game_card",
        referenceId: gameCardId,
        balanceAfter: newBalance,
        createdByUserId: user.id,
      });
    }

    // Update game card
    await db.update(kotcGameCardsTable)
      .set({
        winnerTeamId: Number(newWinnerTeamId),
        loserTeamId: newLoserId,
        isDisputed: true,
        disputeOverrideByUserId: user.id,
        disputeOverrideNotes: overrideNotes || null,
        updatedAt: new Date(),
      } as any)
      .where(eq(kotcGameCardsTable.id, gameCardId));

    // Notify captains of both affected teams
    for (const tid of [previousWinnerId, previousLoserId, Number(newWinnerTeamId), newLoserId].filter((id): id is number => !!id)) {
      const [t] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.id, tid));
      if (t) {
        sendMultiChannelNotification(["push", "in_app"], {
          userId: t.captainUserId,
          type: "kotc_dispute_resolved",
          subject: "⚖️ Game Card Dispute Resolved",
          body: `An admin has resolved a disputed game card. Check your updated life balance.${overrideNotes ? " Note: " + overrideNotes : ""}`,
          metadata: { gameCardId, overrideNotes },
        }).catch(() => {});
      }
    }

    res.json({ ok: true, newWinnerTeamId: Number(newWinnerTeamId), newLoserId });
  } catch (err) {
    console.error("[kotc] dispute:", err);
    res.status(500).json({ error: "Failed to resolve dispute" });
  }
});

// ─── Phase 2: Captain Voluntary Bow-Out ──────────────────────────────────────

router.post("/kotc/teams/:teamId/bow-out", requireAuth, async (req, res) => {
  try {
    const teamId = Number(req.params.teamId);
    const { battleId } = req.body;
    if (!battleId) return void res.status(400).json({ error: "battleId required" });

    const { userId: clerkId } = getAuth(req);
    const user = await getDbUser(clerkId!);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    const [team] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.id, teamId));
    if (!team) return void res.status(404).json({ error: "Team not found" });

    const [reg] = await db
      .select()
      .from(kotcBattleRegistrationsTable)
      .where(and(
        eq(kotcBattleRegistrationsTable.battleId, Number(battleId)),
        eq(kotcBattleRegistrationsTable.teamId, teamId),
        eq(kotcBattleRegistrationsTable.status, "registered"),
      ));

    if (!reg) {
      // Check if an acting captain is making the request
      const [regByActing] = await db
        .select()
        .from(kotcBattleRegistrationsTable)
        .where(and(
          eq(kotcBattleRegistrationsTable.battleId, Number(battleId)),
          eq(kotcBattleRegistrationsTable.teamId, teamId),
        ));

      const actingCaptain = regByActing?.actingCaptainUserId;
      if (team.captainUserId !== user.id && actingCaptain !== user.id && user.role !== "admin") {
        return void res.status(403).json({ error: "Only the captain, acting captain, or admin may bow out" });
      }
      if (!regByActing) return void res.status(404).json({ error: "Team is not registered for this battle" });
    } else {
      if (team.captainUserId !== user.id && reg.actingCaptainUserId !== user.id && user.role !== "admin") {
        return void res.status(403).json({ error: "Only the captain, acting captain, or admin may bow out" });
      }
    }

    // Remove from rotation queue
    await db.update(kotcRotationQueuesTable)
      .set({ status: "bowed_out", bowedOutAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(kotcRotationQueuesTable.battleId, Number(battleId)),
        eq(kotcRotationQueuesTable.teamId, teamId),
        sql`status IN ('queued', 'on_court', 'pending_purchase')`,
      ));

    // Mark registration as withdrawn
    await db.update(kotcBattleRegistrationsTable)
      .set({ status: "withdrawn", withdrawnAt: new Date() } as any)
      .where(and(
        eq(kotcBattleRegistrationsTable.battleId, Number(battleId)),
        eq(kotcBattleRegistrationsTable.teamId, teamId),
      ));

    // Notify all team players
    const players = await db
      .select()
      .from(kotcTeamPlayersTable)
      .where(and(eq(kotcTeamPlayersTable.teamId, teamId), eq(kotcTeamPlayersTable.status, "active")));

    for (const p of players) {
      sendMultiChannelNotification(["push", "in_app"], {
        userId: p.userId,
        type: "kotc_bowed_out",
        subject: "Left Battle",
        body: `${team.name} has voluntarily left the battle. Lives are not refunded.`,
        metadata: { teamId, battleId },
      }).catch(() => {});
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[kotc] bow-out:", err);
    res.status(500).json({ error: "Failed to bow out" });
  }
});

// ─── Phase 2: KotC Life Purchase — Webhook Credit Handler ────────────────────
// Called internally from stripeWebhook.ts on checkout.session.completed
// with metadata.type === "kotc_life_purchase"

export async function handleKotcLifePurchase(session: any): Promise<void> {
  const meta: Record<string, string> = session.metadata ?? {};
  const teamId = Number(meta.teamId);
  const seasonId = Number(meta.seasonId);
  const packLives = Number(meta.packLives);
  const packPriceCents = Number(meta.packPriceCents);
  const packName = meta.packName;
  const pendingPurchaseId = meta.pendingPurchaseId ? Number(meta.pendingPurchaseId) : null;

  if (!teamId || !packLives) {
    console.error("[kotc] handleKotcLifePurchase: missing teamId or packLives in session metadata");
    return;
  }

  const [team] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.id, teamId));
  if (!team) {
    console.error("[kotc] handleKotcLifePurchase: team not found:", teamId);
    return;
  }

  // Idempotency: check if this session was already processed
  const [existingPayment] = await db
    .select()
    .from(paymentsTable)
    .where(and(eq(paymentsTable.providerPaymentId, session.id), eq(paymentsTable.entityType, "kotc_life_purchase")));

  if (existingPayment?.status === "paid") {
    console.log("[kotc] handleKotcLifePurchase: already processed session:", session.id);
    return;
  }

  const newBalance = team.livesBalance + packLives;
  const priceUsd = packPriceCents / 100;
  const now = new Date();

  // Credit lives
  await db.update(kotcTeamsTable)
    .set({
      livesBalance: newBalance,
      firstPurchaseAt: (team as any).firstPurchaseAt ?? now,
      totalPurchasedCents: ((team as any).totalPurchasedCents ?? 0) + packPriceCents,
      updatedAt: now,
    } as any)
    .where(eq(kotcTeamsTable.id, teamId));

  // Life ledger entry
  await db.insert(kotcLifeLedgerTable).values({
    teamId,
    delta: packLives,
    reason: "life_purchase",
    referenceType: "stripe_session",
    balanceAfter: newBalance,
  });

  // Record payment
  let paymentId: number | null = null;
  try {
    const [payment] = await db.insert(paymentsTable).values({
      userId: null,
      entityType: "kotc_life_purchase",
      entityId: teamId,
      amount: String(priceUsd),
      currency: "usd",
      status: "paid",
      provider: "stripe",
      providerPaymentId: session.id,
      paymentMethod: "card",
      metadata: JSON.stringify({ packName, packLives, seasonId }),
    } as any).returning();
    paymentId = payment.id;
  } catch (e) {
    console.error("[kotc] payment record failed:", e);
  }

  // Revenue split
  try {
    const [season] = await db.select().from(kotcSeasonsTable).where(eq(kotcSeasonsTable.id, seasonId));
    const venueId = season?.venueId ?? null;
    await computeRevenueSplit({
      entityType: "kotc_life_purchase",
      entityId: teamId,
      category: "kotc",
      grossAmount: priceUsd,
      paymentId,
      paymentMethod: "card",
      venueId,
      offeringType: "kotc_season",
      offeringId: seasonId,
      description: `KotC life pack purchase — ${packName} (${packLives} lives) for team ${teamId}`,
    });
  } catch (e) {
    console.error("[kotc] revenue split failed:", e);
  }

  // If team was in pending_purchase state in any active queue, flip back to active
  const [pendingQueueEntry] = await db
    .select()
    .from(kotcRotationQueuesTable)
    .where(and(eq(kotcRotationQueuesTable.teamId, teamId), eq(kotcRotationQueuesTable.status, "pending_purchase")));

  if (pendingQueueEntry) {
    await db.update(kotcRotationQueuesTable)
      .set({ status: "queued", graceStartedAt: null, graceExpiresAt: null, updatedAt: now })
      .where(eq(kotcRotationQueuesTable.id, pendingQueueEntry.id));
  }

  // Mark pending purchase as completed if applicable
  if (pendingPurchaseId) {
    await db.update(kotcPendingPurchasesTable)
      .set({ status: "completed", stripeSessionId: session.id, processedAt: now, updatedAt: now } as any)
      .where(eq(kotcPendingPurchasesTable.id, pendingPurchaseId));
  }

  // Notify captain + all team players
  try {
    const players = await db
      .select()
      .from(kotcTeamPlayersTable)
      .where(and(eq(kotcTeamPlayersTable.teamId, teamId), eq(kotcTeamPlayersTable.status, "active")));

    const uniqueUids = [...new Set(players.map((p) => p.userId))];
    for (const uid of uniqueUids) {
      sendMultiChannelNotification(["push", "in_app"], {
        userId: uid,
        type: "kotc_life_purchase_confirmed",
        subject: "💚 Lives Purchased!",
        body: `${team.name} purchased "${packName}" — ${packLives} lives added. New balance: ${newBalance}.`,
        metadata: { packName, packLives, newBalance, teamId },
      }).catch(() => {});
    }
  } catch (e) {
    console.error("[kotc] purchase notification failed:", e);
  }
}

router.get("/kotc/seasons/:seasonId/waitlist-teams", requireAuth, async (req, res) => {
  try {
    const seasonId = Number(req.params.seasonId);
    const [season] = await db.select().from(kotcSeasonsTable).where(eq(kotcSeasonsTable.id, seasonId));
    if (!season) return void res.status(404).json({ error: "Season not found" });

    const battles = await db.select({ id: kotcBattlesTable.id }).from(kotcBattlesTable).where(eq(kotcBattlesTable.seasonId, seasonId));
    const battleIds = battles.map((b) => b.id);
    if (battleIds.length === 0) return void res.json([]);

    const waitlistEntries = await db
      .select()
      .from(kotcWaitlistTable)
      .where(and(
        inArray(kotcWaitlistTable.battleId, battleIds),
        eq(kotcWaitlistTable.carryForward, true),
        sql`${kotcWaitlistTable.status} IN ('waiting', 'notified')`,
      ))
      .orderBy(asc(kotcWaitlistTable.position));

    res.json(waitlistEntries);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch carry-forward waitlist teams" });
  }
});

router.get("/kotc/teams/:teamId/guardian-cap", requireAuth, async (req, res) => {
  try {
    const teamId = Number(req.params.teamId);
    const { userId: clerkId } = getAuth(req);
    const user = await getDbUser(clerkId!);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });
    const [team] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.id, teamId));
    if (!team) return void res.status(404).json({ error: "Team not found" });
    if (!(await isTeamMemberOrAdmin(teamId, user.id, user.role))) {
      return void res.status(403).json({ error: "Forbidden" });
    }
    res.json({
      guardianSpendingCapCents: (team as any).guardianSpendingCapCents ?? null,
      totalPurchasedCents: (team as any).totalPurchasedCents ?? 0,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch guardian cap" });
  }
});

router.post("/kotc/teams/:teamId/join-request", requireAuth, async (req, res) => {
  try {
    const teamId = Number(req.params.teamId);
    const { userId: clerkId } = getAuth(req);
    const user = await getDbUser(clerkId!);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    const [team] = await db.select().from(kotcTeamsTable).where(eq(kotcTeamsTable.id, teamId));
    if (!team) return void res.status(404).json({ error: "Team not found" });

    // Prevent requesting to join own team
    if (team.captainUserId === user.id) {
      return void res.status(400).json({ error: "You are already the captain of this team" });
    }

    // Check if already a member
    const [existing] = await db
      .select()
      .from(kotcTeamPlayersTable)
      .where(and(eq(kotcTeamPlayersTable.teamId, teamId), eq(kotcTeamPlayersTable.userId, user.id)));
    if (existing) return void res.status(409).json({ error: "You are already a member of this team" });

    // Notify the captain
    sendMultiChannelNotification(["push", "in_app"], {
      userId: team.captainUserId,
      type: "kotc_join_request",
      subject: "⚔️ Someone wants to join your team!",
      body: `${user.firstName ?? "A player"} ${user.lastName ?? ""} wants to join ${team.name}. Go to your team page to send them an invite.`,
    }).catch(() => {});

    res.json({ ok: true, message: "Join request sent to the team captain" });
  } catch (err) {
    console.error("[kotc] POST join-request:", err);
    res.status(500).json({ error: "Failed to send join request" });
  }
});

router.get("/kotc/teams/:teamId/life-ledger", requireAuth, async (req, res) => {
  try {
    const teamId = Number(req.params.teamId);
    const { userId: clerkId } = getAuth(req);
    const user = await getDbUser(clerkId!);
    if (!user) return void res.status(401).json({ error: "Unauthorized" });

    // Only team members and admins may view the life ledger
    if (!(await isTeamMemberOrAdmin(teamId, user.id, user.role))) {
      return void res.status(403).json({ error: "Only team members or admins may view the life ledger" });
    }

    const ledger = await db
      .select()
      .from(kotcLifeLedgerTable)
      .where(eq(kotcLifeLedgerTable.teamId, teamId))
      .orderBy(desc(kotcLifeLedgerTable.createdAt));
    res.json(ledger);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch life ledger" });
  }
});

export default router;
