import { Router, type IRouter } from "express";
import { db, teamsTable, teamMembersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  ListTeamsQueryParams,
  ListTeamsResponse,
  GetTeamParams,
  GetTeamResponse,
  CreateTeamBody,
  UpdateTeamParams,
  UpdateTeamBody,
  UpdateTeamResponse,
} from "@workspace/api-zod";
import { requirePermission, requireAnyPermission, hasPermission, type AuthedRequest } from "../middlewares/auth";
import { getAuth } from "@clerk/express";

const router: IRouter = Router();

router.get("/teams", async (req, res): Promise<void> => {
  const query = ListTeamsQueryParams.safeParse(req.query);

  // myTeams=true: return only teams the authenticated user is a member of
  const myTeams = req.query.myTeams === "true";
  if (myTeams) {
    const { userId: clerkId } = getAuth(req as any);
    if (!clerkId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const memberships = await db.select().from(teamMembersTable)
      .where(eq(teamMembersTable.userId, clerkId));
    const teamIds = memberships.map((m) => m.teamId);
    if (teamIds.length === 0) { res.json([]); return; }
    const teams = await db.select().from(teamsTable).where(inArray(teamsTable.id, teamIds));
    res.json(ListTeamsResponse.parse(teams));
    return;
  }

  let teams = await db.select().from(teamsTable).orderBy(teamsTable.name);
  if (query.success) {
    if (query.data.leagueId) teams = teams.filter((t) => t.leagueId === query.data.leagueId);
    if (query.data.tournamentId) teams = teams.filter((t) => t.tournamentId === query.data.tournamentId);
  }
  res.json(ListTeamsResponse.parse(teams));
});

router.post("/teams", requirePermission("canManageLeagues"), async (req, res): Promise<void> => {
  const parsed = CreateTeamBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [team] = await db.insert(teamsTable).values(parsed.data).returning();
  res.status(201).json(GetTeamResponse.parse(team));
});

router.get("/teams/:id", async (req, res): Promise<void> => {
  const params = GetTeamParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, params.data.id));
  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  res.json(GetTeamResponse.parse(team));
});

router.patch("/teams/:id", requireAnyPermission(["canManageLeagues", "canManageTournaments"]), async (req, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const params = UpdateTeamParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateTeamBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Fetch the team first to enforce domain-scoped permission.
  // A user with only canManageTournaments must not be able to mutate league teams (and vice versa).
  const [existing] = await db.select().from(teamsTable).where(eq(teamsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Team not found" });
    return;
  }

  // Super-admins (role=admin AND adminLevel≠scoped) bypass domain checks.
  const dbUser = authed.dbUser;
  const isSuperAdmin = dbUser && dbUser.role === "admin" && (dbUser as any).adminLevel !== "scoped";
  if (!isSuperAdmin) {
    if (existing.leagueId) {
      const ok = await hasPermission(authed.clerkUserId, "canManageLeagues");
      if (!ok) { res.status(403).json({ error: "Forbidden: this team belongs to a league; canManageLeagues required" }); return; }
    }
    if (existing.tournamentId) {
      const ok = await hasPermission(authed.clerkUserId, "canManageTournaments");
      if (!ok) { res.status(403).json({ error: "Forbidden: this team belongs to a tournament; canManageTournaments required" }); return; }
    }
  }

  const [team] = await db
    .update(teamsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(teamsTable.id, params.data.id))
    .returning();
  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  res.json(UpdateTeamResponse.parse(team));
});

export default router;
