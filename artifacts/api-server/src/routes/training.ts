import { Router, type IRouter } from "express";
import { db, staffProfilesTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, type AuthedRequest } from "../middlewares/auth";

const router: IRouter = Router();

const REQUIRED_SECTIONS: Record<string, number[]> = {
  ref: [1, 2],
  scorekeeper: [1, 2, 3],
};

const PASSING_SCORE = 0.8;

function getRequiredSections(roles: string[]): number[] {
  const sections = new Set<number>();
  for (const role of roles) {
    const req = REQUIRED_SECTIONS[role];
    if (req) req.forEach((s) => sections.add(s));
  }
  return [...sections].sort();
}

function computeTrainingComplete(
  roles: string[],
  progress: Record<string, { passed: boolean; score: number; total: number; completedAt: string }> | null
): boolean {
  const required = getRequiredSections(roles);
  if (required.length === 0) return false;
  return required.every((s) => progress?.[String(s)]?.passed === true);
}

/** GET /api/training/status — returns training status for the authenticated user */
router.get("/training/status", requireAuth, async (req, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkId, authed.clerkUserId));

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const roles: string[] = (user as any).roles ?? [];
  const required = getRequiredSections(roles);

  const [profile] = await db
    .select()
    .from(staffProfilesTable)
    .where(eq(staffProfilesTable.userId, user.id));

  const progress = (profile?.trainingProgress as Record<string, any> | null) ?? null;

  // Derive isComplete from required sections + progress (source of truth)
  // This is more robust than relying solely on trainingCompletedAt timestamp
  const isComplete = required.length > 0 && computeTrainingComplete(roles, progress as any);

  res.json({
    isComplete,
    trainingCompletedAt: profile?.trainingCompletedAt ?? null,
    requiredSections: required,
    progress: progress ?? {},
    roles,
  });
});

/** POST /api/training/section-complete — record a section quiz result */
router.post("/training/section-complete", requireAuth, async (req, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const { sectionId, score, total } = req.body as {
    sectionId: number;
    score: number;
    total: number;
  };

  if (!sectionId || score == null || !total) {
    res.status(400).json({ error: "sectionId, score, and total are required" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkId, authed.clerkUserId));

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const roles: string[] = (user as any).roles ?? [];
  const required = getRequiredSections(roles);

  const [profile] = await db
    .select()
    .from(staffProfilesTable)
    .where(eq(staffProfilesTable.userId, user.id));

  if (!profile) {
    res.status(404).json({ error: "Staff profile not found" });
    return;
  }

  const passed = score / total >= PASSING_SCORE;
  const existingProgress = (profile.trainingProgress as Record<string, any> | null) ?? {};

  const newProgress = {
    ...existingProgress,
    [String(sectionId)]: {
      passed,
      score,
      total,
      completedAt: new Date().toISOString(),
    },
  };

  const allComplete = computeTrainingComplete(roles, newProgress as any);
  const trainingCompletedAt = allComplete
    ? (profile.trainingCompletedAt ?? new Date())
    : profile.trainingCompletedAt;

  const [updated] = await db
    .update(staffProfilesTable)
    .set({
      trainingProgress: newProgress,
      trainingCompletedAt: trainingCompletedAt ?? undefined,
      updatedAt: new Date(),
    })
    .where(eq(staffProfilesTable.id, profile.id))
    .returning();

  res.json({
    passed,
    score,
    total,
    sectionId,
    isComplete: allComplete,
    trainingCompletedAt: updated.trainingCompletedAt ?? null,
    requiredSections: required,
    progress: newProgress,
  });
});

/** GET /api/admin/training-status — admin view: training status for all ref/scorekeeper staff */
router.get("/admin/training-status", requireAuth, async (req, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const [caller] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkId, authed.clerkUserId));

  if (!caller || caller.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const staffRows = await db
    .select({
      profileId: staffProfilesTable.id,
      userId: staffProfilesTable.userId,
      title: staffProfilesTable.title,
      isActive: staffProfilesTable.isActive,
      trainingCompletedAt: staffProfilesTable.trainingCompletedAt,
      trainingProgress: staffProfilesTable.trainingProgress,
      userFirstName: usersTable.firstName,
      userLastName: usersTable.lastName,
      userEmail: usersTable.email,
      userRoles: (usersTable as any).roles,
    })
    .from(staffProfilesTable)
    .innerJoin(usersTable, eq(staffProfilesTable.userId, usersTable.id));

  const result = staffRows
    .filter((r) => {
      const roles: string[] = r.userRoles ?? [];
      return roles.includes("ref") || roles.includes("scorekeeper");
    })
    .map((r) => ({
      ...r,
      trainingStatus: r.trainingCompletedAt ? "complete" : "pending",
    }));

  res.json(result);
});

export default router;
