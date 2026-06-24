import { Router } from "express";
import { db, notificationsTable, usersTable } from "@workspace/db";
import { eq, and, isNull, desc, count } from "drizzle-orm";
import { requireAuth, type AuthedRequest } from "../middlewares/auth";

const router = Router();

/**
 * GET /notifications
 * Returns in-app notifications for the authenticated user, newest first.
 * unreadCount is computed via a separate aggregate over ALL unread rows (not capped by limit).
 * Query params: limit (default 50, max 100)
 */
router.get("/notifications", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const [dbUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, req.clerkUserId));
    if (!dbUser) return res.status(401).json({ error: "User not found" });

    const limit = Math.min(parseInt((req.query.limit as string) || "50", 10), 100);

    const [items, unreadRows] = await Promise.all([
      db
        .select()
        .from(notificationsTable)
        .where(
          and(
            eq(notificationsTable.userId, dbUser.id),
            eq(notificationsTable.channel, "in_app"),
          ),
        )
        .orderBy(desc(notificationsTable.createdAt))
        .limit(limit),

      db
        .select({ total: count() })
        .from(notificationsTable)
        .where(
          and(
            eq(notificationsTable.userId, dbUser.id),
            eq(notificationsTable.channel, "in_app"),
            isNull(notificationsTable.readAt),
          ),
        ),
    ]);

    const unreadCount = unreadRows[0]?.total ?? 0;

    res.json({
      items: items.map((n) => ({
        id: n.id,
        type: n.type,
        subject: n.subject,
        body: n.body,
        link: n.link ?? null,
        readAt: n.readAt ?? null,
        createdAt: n.createdAt,
      })),
      unreadCount,
    });
  } catch (err) {
    console.error("[notificationsInbox] GET error:", err);
    res.status(500).json({ error: "Failed to load notifications" });
  }
});

/**
 * PATCH /notifications/read-all
 * Marks all unread in-app notifications for the user as read.
 * Must be registered BEFORE /:id/read so Express doesn't treat "read-all" as an id.
 */
router.patch("/notifications/read-all", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const [dbUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, req.clerkUserId));
    if (!dbUser) return res.status(401).json({ error: "User not found" });

    await db
      .update(notificationsTable)
      .set({ readAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(notificationsTable.userId, dbUser.id),
          eq(notificationsTable.channel, "in_app"),
          isNull(notificationsTable.readAt),
        ),
      );

    res.json({ ok: true });
  } catch (err) {
    console.error("[notificationsInbox] PATCH read-all error:", err);
    res.status(500).json({ error: "Failed to mark all notifications as read" });
  }
});

/**
 * PATCH /notifications/:id/read
 * Marks a single notification as read. Only affects the authenticated user's own notifications.
 */
router.patch("/notifications/:id/read", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const [dbUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, req.clerkUserId));
    if (!dbUser) return res.status(401).json({ error: "User not found" });

    const notifId = parseInt(req.params.id, 10);
    if (isNaN(notifId)) return res.status(400).json({ error: "Invalid notification ID" });

    await db
      .update(notificationsTable)
      .set({ readAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(notificationsTable.id, notifId),
          eq(notificationsTable.userId, dbUser.id),
        ),
      );

    res.json({ ok: true });
  } catch (err) {
    console.error("[notificationsInbox] PATCH read error:", err);
    res.status(500).json({ error: "Failed to mark notification as read" });
  }
});

export default router;
