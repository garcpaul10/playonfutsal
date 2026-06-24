import { Router } from "express";
import { db, seasonRecapsTable, usersTable, guardiansTable, notificationsTable } from "@workspace/db";
import { requireAuth, requireAdmin, type AuthedRequest } from "../middlewares/auth";
import { eq, and, inArray } from "drizzle-orm";
import { sendSms } from "../services/sms";

const router = Router();

router.get("/season-recaps", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const [dbUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, req.clerkUserId));
    if (!dbUser) return res.status(401).json({ error: "User not found" });

    let targetUserIds = [dbUser.id];

    if (dbUser.role === "parent") {
      const children = await db
        .select({ youthUserId: guardiansTable.youthUserId })
        .from(guardiansTable)
        .where(
          and(
            eq(guardiansTable.guardianUserId, dbUser.id),
            eq(guardiansTable.status, "approved"),
          ),
        );

      targetUserIds = [...targetUserIds, ...children.map((c) => c.youthUserId)];
    }

    const recaps = await db
      .select({
        id: seasonRecapsTable.id,
        userId: seasonRecapsTable.userId,
        entityType: seasonRecapsTable.entityType,
        entityId: seasonRecapsTable.entityId,
        seasonLabel: seasonRecapsTable.seasonLabel,
        gamesPlayed: seasonRecapsTable.gamesPlayed,
        gamesAttended: seasonRecapsTable.gamesAttended,
        attendanceRate: seasonRecapsTable.attendanceRate,
        coachNote: seasonRecapsTable.coachNote,
        positiveHighlight: seasonRecapsTable.positiveHighlight,
        deliveredAt: seasonRecapsTable.deliveredAt,
        deliveryChannel: seasonRecapsTable.deliveryChannel,
        createdAt: seasonRecapsTable.createdAt,
        playerFirstName: usersTable.firstName,
        playerLastName: usersTable.lastName,
      })
      .from(seasonRecapsTable)
      .leftJoin(usersTable, eq(seasonRecapsTable.userId, usersTable.id))
      .where(inArray(seasonRecapsTable.userId, targetUserIds))
      .orderBy(seasonRecapsTable.createdAt);

    res.json(recaps);
  } catch (err) {
    console.error("[seasonRecaps] GET error:", err);
    res.status(500).json({ error: "Failed to load recaps" });
  }
});

router.post("/season-recaps", requireAdmin, async (req: AuthedRequest, res) => {
  try {
    const {
      userId,
      entityType,
      entityId,
      seasonLabel,
      gamesPlayed,
      gamesAttended,
      coachNote,
      positiveHighlight,
      deliveryChannel,
    } = req.body;

    if (!userId || !entityType || !entityId || !seasonLabel) {
      return res.status(400).json({ error: "userId, entityType, entityId, and seasonLabel are required" });
    }

    const [targetUser] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!targetUser) return res.status(404).json({ error: "User not found" });

    const played = gamesPlayed ?? 0;
    const attended = gamesAttended ?? 0;
    const rate = played > 0 ? `${Math.round((attended / played) * 100)}%` : "N/A";

    const [recap] = await db
      .insert(seasonRecapsTable)
      .values({
        userId,
        entityType,
        entityId,
        seasonLabel,
        gamesPlayed: played,
        gamesAttended: attended,
        attendanceRate: rate,
        coachNote: coachNote ?? null,
        positiveHighlight: positiveHighlight ?? null,
        deliveryChannel: deliveryChannel ?? "in_app",
      })
      .returning();

    const approvedGuardians = await db
      .select({ guardianUserId: guardiansTable.guardianUserId })
      .from(guardiansTable)
      .where(
        and(
          eq(guardiansTable.youthUserId, userId),
          eq(guardiansTable.status, "approved"),
        ),
      );

    const recipientIds = [userId, ...approvedGuardians.map((g) => g.guardianUserId)];
    const recipients = await db
      .select()
      .from(usersTable)
      .where(inArray(usersTable.id, recipientIds));

    const recapBody = buildRecapMessage(
      targetUser.firstName ?? "Your player",
      seasonLabel,
      played,
      attended,
      rate,
      coachNote,
      positiveHighlight,
    );

    let smsSent = 0;
    for (const r of recipients) {
      await db.insert(notificationsTable).values({
        userId: r.id,
        channel: "in_app",
        type: "season_recap",
        subject: `${seasonLabel} Recap — ${targetUser.firstName ?? "Player"}`,
        body: recapBody,
        status: "sent",
        sentAt: new Date(),
        metadata: JSON.stringify({ recapId: recap.id }),
      });

      if ((deliveryChannel === "sms" || deliveryChannel === "both") && r.phone) {
        const smsResult = await sendSms(r.phone, recapBody);
        if (smsResult.sent) smsSent++;
      }
    }

    await db
      .update(seasonRecapsTable)
      .set({ deliveredAt: new Date(), updatedAt: new Date() })
      .where(eq(seasonRecapsTable.id, recap.id));

    res.status(201).json({ recap, recipientsNotified: recipients.length, smsSent });
  } catch (err) {
    console.error("[seasonRecaps] POST error:", err);
    res.status(500).json({ error: "Failed to generate recap" });
  }
});

router.get("/admin/season-recaps", requireAdmin, async (_req, res) => {
  try {
    const recaps = await db
      .select({
        id: seasonRecapsTable.id,
        userId: seasonRecapsTable.userId,
        entityType: seasonRecapsTable.entityType,
        entityId: seasonRecapsTable.entityId,
        seasonLabel: seasonRecapsTable.seasonLabel,
        gamesPlayed: seasonRecapsTable.gamesPlayed,
        gamesAttended: seasonRecapsTable.gamesAttended,
        attendanceRate: seasonRecapsTable.attendanceRate,
        deliveredAt: seasonRecapsTable.deliveredAt,
        deliveryChannel: seasonRecapsTable.deliveryChannel,
        createdAt: seasonRecapsTable.createdAt,
        playerFirstName: usersTable.firstName,
        playerLastName: usersTable.lastName,
        playerEmail: usersTable.email,
      })
      .from(seasonRecapsTable)
      .leftJoin(usersTable, eq(seasonRecapsTable.userId, usersTable.id))
      .orderBy(seasonRecapsTable.createdAt);

    res.json(recaps);
  } catch (err) {
    console.error("[seasonRecaps] admin GET error:", err);
    res.status(500).json({ error: "Failed to load recaps" });
  }
});

function buildRecapMessage(
  firstName: string,
  seasonLabel: string,
  gamesPlayed: number,
  gamesAttended: number,
  rate: string,
  coachNote?: string | null,
  highlight?: string | null,
): string {
  const lines = [
    `${seasonLabel} Recap for ${firstName}`,
    `Games played: ${gamesPlayed} | Attended: ${gamesAttended} (${rate})`,
  ];
  if (highlight) lines.push(`Highlight: ${highlight}`);
  if (coachNote) lines.push(`Coach's note: ${coachNote}`);
  lines.push("Great season! We look forward to seeing you next time. — PlayOn");
  return lines.join("\n");
}

export default router;
