import { Router } from "express";
import { db, notificationPreferencesTable, NOTIFICATION_TYPES, usersTable, webPushSubscriptionsTable } from "@workspace/db";
import { requireAuth, requirePermission, type AuthedRequest } from "../middlewares/auth";
import { and, eq } from "drizzle-orm";

const router = Router();

const SMS_DEFAULT_TYPES: string[] = [
  "waitlist_movement",
  "cancellation_rainout",
  "payment_receipt",
  "schedule_change",
];

const LABEL_MAP: Record<string, string> = {
  waitlist_movement: "Waitlist movement",
  cancellation_rainout: "Cancellation / rainout",
  payment_receipt: "Payment receipt",
  schedule_change: "Schedule change",
  upcoming_session: "Upcoming session reminder",
  payment_due: "Payment due reminder",
  balance_due: "Balance due before first game",
  announcement: "Announcements",
  results_standings: "Results & standings updates",
  sub_ref_alert: "Sub-ref open slot alert",
  fa_match_proposal: "Free agent match proposal",
  fa_match_response: "Free agent match update",
};

function buildDefaults(role: string) {
  const smsEnabled = role === "parent" || role === "youth" || role === "player";
  return NOTIFICATION_TYPES.map((type) => ({
    notificationType: type,
    channelEmail: true,
    channelSms: smsEnabled ? SMS_DEFAULT_TYPES.includes(type) : false,
    channelPush: false,
  }));
}

router.get("/notification-preferences", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const [dbUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, req.clerkUserId));
    if (!dbUser) return res.status(401).json({ error: "User not found" });

    const rows = await db
      .select()
      .from(notificationPreferencesTable)
      .where(eq(notificationPreferencesTable.userId, dbUser.id));

    const stored = new Map(rows.map((r) => [r.notificationType, r]));
    const defaults = buildDefaults(dbUser.role);

    const prefs = defaults.map((d) => {
      const stored_row = stored.get(d.notificationType);
      return {
        notificationType: d.notificationType,
        label: LABEL_MAP[d.notificationType] ?? d.notificationType,
        channelEmail: stored_row ? stored_row.channelEmail : d.channelEmail,
        channelSms: stored_row ? stored_row.channelSms : d.channelSms,
        channelPush: stored_row ? stored_row.channelPush : d.channelPush,
      };
    });

    res.json(prefs);
  } catch (err) {
    console.error("[notificationPreferences] GET error:", err);
    res.status(500).json({ error: "Failed to load notification preferences" });
  }
});

router.patch("/notification-preferences", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const [dbUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, req.clerkUserId));
    if (!dbUser) return res.status(401).json({ error: "User not found" });

    const updates: Array<{
      notificationType: string;
      channelEmail?: boolean;
      channelSms?: boolean;
      channelPush?: boolean;
    }> = req.body;

    if (!Array.isArray(updates)) {
      return res.status(400).json({ error: "Body must be an array of preference updates" });
    }

    for (const update of updates) {
      if (!NOTIFICATION_TYPES.includes(update.notificationType as any)) continue;

      await db
        .insert(notificationPreferencesTable)
        .values({
          userId: dbUser.id,
          notificationType: update.notificationType,
          channelEmail: update.channelEmail ?? true,
          channelSms: update.channelSms ?? false,
          channelPush: update.channelPush ?? false,
        })
        .onConflictDoUpdate({
          target: [notificationPreferencesTable.userId, notificationPreferencesTable.notificationType],
          set: {
            channelEmail: update.channelEmail ?? true,
            channelSms: update.channelSms ?? false,
            channelPush: update.channelPush ?? false,
            updatedAt: new Date(),
          },
        });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[notificationPreferences] PATCH error:", err);
    res.status(500).json({ error: "Failed to update notification preferences" });
  }
});

// ─── Web Push Subscription endpoints ─────────────────────────────────────────

/**
 * POST /notification-preferences/push-subscription
 * Save or update a browser push subscription for the authenticated user.
 * Body: { endpoint: string, keys: { p256dh: string, auth: string } }
 */
router.post(
  "/notification-preferences/push-subscription",
  requireAuth,
  async (req: AuthedRequest, res) => {
    try {
      const [dbUser] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.clerkId, req.clerkUserId));
      if (!dbUser) return res.status(401).json({ error: "User not found" });

      const { endpoint, keys } = req.body as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };

      if (!endpoint || !keys?.p256dh || !keys?.auth) {
        return res.status(400).json({ error: "endpoint, keys.p256dh, and keys.auth are required" });
      }

      await db
        .insert(webPushSubscriptionsTable)
        .values({
          userId: dbUser.id,
          endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
        })
        .onConflictDoUpdate({
          target: [webPushSubscriptionsTable.userId, webPushSubscriptionsTable.endpoint],
          set: {
            p256dh: keys.p256dh,
            auth: keys.auth,
            updatedAt: new Date(),
          },
        });

      res.json({ ok: true });
    } catch (err) {
      console.error("[notificationPreferences] push-subscription POST error:", err);
      res.status(500).json({ error: "Failed to save push subscription" });
    }
  },
);

/**
 * DELETE /notification-preferences/push-subscription
 * Remove the current browser's push subscription.
 * Body: { endpoint: string }
 */
router.delete(
  "/notification-preferences/push-subscription",
  requireAuth,
  async (req: AuthedRequest, res) => {
    try {
      const [dbUser] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.clerkId, req.clerkUserId));
      if (!dbUser) return res.status(401).json({ error: "User not found" });

      const { endpoint } = req.body as { endpoint?: string };
      if (!endpoint) return res.status(400).json({ error: "endpoint is required" });

      await db
        .delete(webPushSubscriptionsTable)
        .where(
          and(
            eq(webPushSubscriptionsTable.userId, dbUser.id),
            eq(webPushSubscriptionsTable.endpoint, endpoint),
          ),
        );

      res.json({ ok: true });
    } catch (err) {
      console.error("[notificationPreferences] push-subscription DELETE error:", err);
      res.status(500).json({ error: "Failed to remove push subscription" });
    }
  },
);

// ─── Admin endpoints ──────────────────────────────────────────────────────────

router.get("/admin/notification-preferences/:userId", requirePermission("canManageAnnouncements"), async (req: AuthedRequest, res) => {
  try {
    const targetUserId = parseInt(req.params.userId);
    const [targetUser] = await db.select().from(usersTable).where(eq(usersTable.id, targetUserId));
    if (!targetUser) return res.status(404).json({ error: "User not found" });

    const rows = await db
      .select()
      .from(notificationPreferencesTable)
      .where(eq(notificationPreferencesTable.userId, targetUserId));

    const stored = new Map(rows.map((r) => [r.notificationType, r]));
    const defaults = buildDefaults(targetUser.role);

    const prefs = defaults.map((d) => {
      const stored_row = stored.get(d.notificationType);
      return {
        notificationType: d.notificationType,
        label: LABEL_MAP[d.notificationType] ?? d.notificationType,
        channelEmail: stored_row ? stored_row.channelEmail : d.channelEmail,
        channelSms: stored_row ? stored_row.channelSms : d.channelSms,
        channelPush: stored_row ? stored_row.channelPush : d.channelPush,
      };
    });

    res.json({ user: { id: targetUser.id, email: targetUser.email, role: targetUser.role }, prefs });
  } catch (err) {
    console.error("[notificationPreferences] admin GET error:", err);
    res.status(500).json({ error: "Failed to load preferences" });
  }
});

router.patch("/admin/notification-preferences/:userId", requirePermission("canManageAnnouncements"), async (req: AuthedRequest, res) => {
  try {
    const targetUserId = parseInt(req.params.userId);
    const [targetUser] = await db.select().from(usersTable).where(eq(usersTable.id, targetUserId));
    if (!targetUser) return res.status(404).json({ error: "User not found" });

    const updates: Array<{
      notificationType: string;
      channelEmail?: boolean;
      channelSms?: boolean;
      channelPush?: boolean;
    }> = req.body;

    if (!Array.isArray(updates)) {
      return res.status(400).json({ error: "Body must be an array of preference updates" });
    }

    for (const update of updates) {
      if (!NOTIFICATION_TYPES.includes(update.notificationType as any)) continue;

      await db
        .insert(notificationPreferencesTable)
        .values({
          userId: targetUserId,
          notificationType: update.notificationType,
          channelEmail: update.channelEmail ?? true,
          channelSms: update.channelSms ?? false,
          channelPush: update.channelPush ?? false,
        })
        .onConflictDoUpdate({
          target: [notificationPreferencesTable.userId, notificationPreferencesTable.notificationType],
          set: {
            channelEmail: update.channelEmail ?? true,
            channelSms: update.channelSms ?? false,
            channelPush: update.channelPush ?? false,
            updatedAt: new Date(),
          },
        });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[notificationPreferences] admin PATCH error:", err);
    res.status(500).json({ error: "Failed to update preferences" });
  }
});

export default router;
