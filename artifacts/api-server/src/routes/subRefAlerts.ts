import { Router } from "express";
import { db, subRefAlertsTable, usersTable, fixturesTable, assignmentsTable, notificationsTable } from "@workspace/db";
import { requireAuth, requirePermission, type AuthedRequest } from "../middlewares/auth";
import { eq, and, or, lte, gte, inArray } from "drizzle-orm";
import { sendSmsBulk } from "../services/sms";
import { ensureGameCard } from "../services/gameCardService";

const router = Router();

/**
 * Find eligible substitute refs: all refs not already scheduled for an
 * overlapping fixture. Overlap window = ±90 minutes around the game date.
 */
async function findEligibleRefs(
  fixtureId: number | undefined,
  gameDate: Date | undefined,
  currentRefUserId: number | undefined,
): Promise<(typeof usersTable.$inferSelect)[]> {
  const allRefs = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.role, "ref"));

  const excludeIds = new Set<number>();

  if (currentRefUserId) excludeIds.add(currentRefUserId);

  if (gameDate) {
    const windowStart = new Date(gameDate.getTime() - 90 * 60 * 1000);
    const windowEnd = new Date(gameDate.getTime() + 90 * 60 * 1000);

    const busyAssignments = await db
      .select({ staffUserId: assignmentsTable.staffUserId })
      .from(assignmentsTable)
      .where(
        and(
          eq(assignmentsTable.role, "referee"),
          or(
            and(
              lte(assignmentsTable.startAt, windowEnd),
              gte(assignmentsTable.endAt, windowStart),
            ),
          ),
        ),
      );

    for (const a of busyAssignments) {
      excludeIds.add(a.staffUserId);
    }
  }

  if (fixtureId) {
    const fixtureAssignments = await db
      .select({ staffUserId: assignmentsTable.staffUserId })
      .from(assignmentsTable)
      .where(
        and(
          eq(assignmentsTable.entityType, "fixture"),
          eq(assignmentsTable.entityId, fixtureId),
        ),
      );
    for (const a of fixtureAssignments) {
      excludeIds.add(a.staffUserId);
    }
  }

  return allRefs.filter((r) => !excludeIds.has(r.id));
}

router.post("/sub-ref-alerts", requirePermission("canManageAssignments"), async (req: AuthedRequest, res) => {
  try {
    const { fixtureId, gameDate, notes, programType } = req.body as {
      fixtureId?: number;
      gameDate?: string;
      notes?: string;
      programType?: string;
    };

    if (!fixtureId && !programType) {
      return res.status(400).json({
        error: "Either fixtureId or programType (league|tournament) is required",
      });
    }

    if (!fixtureId && programType && !["league", "tournament"].includes(programType)) {
      return res.status(400).json({
        error: "Sub-ref alerts are only for leagues and tournaments, not drop-ins",
      });
    }

    let fixture: typeof fixturesTable.$inferSelect | null = null;
    if (fixtureId) {
      const [f] = await db.select().from(fixturesTable).where(eq(fixturesTable.id, fixtureId));
      if (!f) return res.status(404).json({ error: "Fixture not found" });

      if (f.entityType === "dropin") {
        return res.status(400).json({
          error: "Sub-ref alerts are only for leagues and tournaments, not drop-ins",
        });
      }
      fixture = f;
    }

    const resolvedDate = gameDate
      ? new Date(gameDate)
      : fixture?.scheduledAt ?? undefined;

    const [alert] = await db
      .insert(subRefAlertsTable)
      .values({
        requestedByUserId: req.dbUser!.id,
        fixtureId: fixtureId ?? null,
        gameDate: resolvedDate ?? null,
        notes: notes ?? null,
        status: "open",
      })
      .returning();

    const eligibleRefs = await findEligibleRefs(
      fixtureId,
      resolvedDate,
      fixture?.refereeUserId ?? undefined,
    );

    const refsWithPhone = eligibleRefs.filter((r) => r.phone);

    const dateStr = alert.gameDate
      ? new Date(alert.gameDate).toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : "TBD";

    const smsBody =
      `[PlayOn] OPEN REF SLOT: ${dateStr}. ` +
      `${notes ? notes + " " : ""}` +
      `Log in to claim: ${process.env.APP_URL ?? "https://playonfutsal.vercel.app"}/sub-ref-alerts`;

    const smsResult = await sendSmsBulk(
      refsWithPhone.map((r) => ({ phone: r.phone!, name: r.firstName ?? undefined })),
      smsBody,
    );

    const notifInserts = eligibleRefs.map((r) => ({
      userId: r.id,
      channel: "in_app",
      type: "sub_ref_alert",
      subject: "Open ref slot available",
      body: `An open ref slot needs coverage${dateStr !== "TBD" ? " on " + dateStr : ""}. First to claim gets it.`,
      status: "sent",
      sentAt: new Date(),
      metadata: JSON.stringify({ alertId: alert.id }),
    }));

    if (notifInserts.length > 0) {
      await db.insert(notificationsTable).values(notifInserts);
    }

    res.status(201).json({
      alert,
      notified: eligibleRefs.length,
      sms: smsResult,
    });
  } catch (err) {
    console.error("[subRefAlerts] POST error:", err);
    res.status(500).json({ error: "Failed to create sub-ref alert" });
  }
});

router.get("/sub-ref-alerts", requirePermission("canManageAssignments"), async (_req, res) => {
  try {
    const alerts = await db
      .select({
        id: subRefAlertsTable.id,
        status: subRefAlertsTable.status,
        fixtureId: subRefAlertsTable.fixtureId,
        gameDate: subRefAlertsTable.gameDate,
        notes: subRefAlertsTable.notes,
        createdAt: subRefAlertsTable.createdAt,
        requestedBy: {
          id: usersTable.id,
          firstName: usersTable.firstName,
          lastName: usersTable.lastName,
          email: usersTable.email,
        },
      })
      .from(subRefAlertsTable)
      .leftJoin(usersTable, eq(subRefAlertsTable.requestedByUserId, usersTable.id))
      .orderBy(subRefAlertsTable.createdAt);

    res.json(alerts);
  } catch (err) {
    console.error("[subRefAlerts] GET error:", err);
    res.status(500).json({ error: "Failed to load sub-ref alerts" });
  }
});

router.get("/sub-ref-alerts/open", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const [dbUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, req.clerkUserId));
    if (!dbUser) return res.status(401).json({ error: "User not found" });

    if (dbUser.role !== "ref" && dbUser.role !== "admin") {
      return res.status(403).json({ error: "Only refs and admins can view open alerts" });
    }

    const alerts = await db
      .select()
      .from(subRefAlertsTable)
      .where(eq(subRefAlertsTable.status, "open"))
      .orderBy(subRefAlertsTable.gameDate);

    res.json(alerts);
  } catch (err) {
    console.error("[subRefAlerts] GET open error:", err);
    res.status(500).json({ error: "Failed to load open alerts" });
  }
});

router.get("/sub-ref-alerts/:id", requirePermission("canManageAssignments"), async (req: AuthedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    const [alert] = await db
      .select()
      .from(subRefAlertsTable)
      .where(eq(subRefAlertsTable.id, id));

    if (!alert) return res.status(404).json({ error: "Alert not found" });

    let claimer = null;
    if (alert.claimedByUserId) {
      const [u] = await db.select().from(usersTable).where(eq(usersTable.id, alert.claimedByUserId));
      claimer = u ?? null;
    }

    res.json({ ...alert, claimer });
  } catch (err) {
    console.error("[subRefAlerts] GET :id error:", err);
    res.status(500).json({ error: "Failed to load alert" });
  }
});

router.post("/sub-ref-alerts/:id/claim", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const [dbUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, req.clerkUserId));
    if (!dbUser) return res.status(401).json({ error: "User not found" });

    if (dbUser.role !== "ref" && dbUser.role !== "admin") {
      return res.status(403).json({ error: "Only refs can claim open slots" });
    }

    const id = parseInt(req.params.id);

    const [alert] = await db.select().from(subRefAlertsTable).where(eq(subRefAlertsTable.id, id));
    if (!alert) return res.status(404).json({ error: "Alert not found" });
    if (alert.status !== "open") {
      return res.status(409).json({ error: "This slot has already been claimed or cancelled" });
    }

    const eligibleRefs = await findEligibleRefs(
      alert.fixtureId ?? undefined,
      alert.gameDate ?? undefined,
      undefined,
    );
    const isEligible = eligibleRefs.some((r) => r.id === dbUser.id);
    if (!isEligible && dbUser.role !== "admin") {
      return res.status(409).json({
        error: "You are not eligible to claim this slot — you may already be scheduled during this window",
      });
    }

    const [updated] = await db
      .update(subRefAlertsTable)
      .set({
        claimedByUserId: dbUser.id,
        status: "claimed",
        updatedAt: new Date(),
      })
      .where(and(eq(subRefAlertsTable.id, id), eq(subRefAlertsTable.status, "open")))
      .returning();

    if (!updated) {
      return res.status(409).json({ error: "Another ref claimed this slot first" });
    }

    if (updated.fixtureId) {
      const fx = await db.select().from(fixturesTable).where(eq(fixturesTable.id, updated.fixtureId)).then(r => r[0]);
      if (fx) {
        await db.insert(assignmentsTable).values({
          staffUserId: dbUser.id,
          entityType: "fixture",
          entityId: updated.fixtureId,
          role: "referee",
          startAt: fx.scheduledAt ?? new Date(),
          endAt: new Date((fx.scheduledAt ?? new Date()).getTime() + (fx.durationMinutes ?? 90) * 60_000),
          status: "assigned",
        } as any).onConflictDoNothing();
      }
      ensureGameCard(updated.fixtureId).catch((err) => {
        console.error("[game-card] failed to refresh card after sub-ref claim", updated.fixtureId, err?.message);
      });
    }

    res.json(updated);
  } catch (err) {
    console.error("[subRefAlerts] POST claim error:", err);
    res.status(500).json({ error: "Failed to claim slot" });
  }
});

router.patch("/sub-ref-alerts/:id/cancel", requirePermission("canManageAssignments"), async (req: AuthedRequest, res) => {
  try {
    const id = parseInt(req.params.id);

    const [updated] = await db
      .update(subRefAlertsTable)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(subRefAlertsTable.id, id))
      .returning();

    if (!updated) return res.status(404).json({ error: "Alert not found" });

    res.json(updated);
  } catch (err) {
    console.error("[subRefAlerts] PATCH cancel error:", err);
    res.status(500).json({ error: "Failed to cancel alert" });
  }
});

export default router;
