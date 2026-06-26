import {
  db, notificationsTable, notificationPreferencesTable, usersTable, webPushSubscriptionsTable,
  playerProfilesTable, leaguesTable, campsTable, tournamentsTable, dropinsTable,
  dropinCourtPoolsTable, courtsTable, venuesTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { sendSms } from "./sms";
import { sendEmail } from "./email";
import { renderEmail, defaultEmailPayload, type EmailTemplatePayload, registrationConfirmationEmail } from "./emailTemplate";
import { sendWebPush } from "./webPush";
import { generateQrDataUri } from "./qr";

export type NotificationChannel = "email" | "sms" | "push" | "in_app";
export type NotificationType =
  | "registration_confirmed"
  | "registration_cancelled"
  | "payment_received"
  | "payment_failed"
  | "refund_issued"
  | "dropin_reminder"
  | "league_start"
  | "waiver_required"
  | "admin_override"
  | "role_changed"
  | "general"
  | "waitlist_movement"
  | "cancellation_rainout"
  | "payment_receipt"
  | "schedule_change"
  | "upcoming_session"
  | "payment_due"
  | "balance_due"
  | "announcement"
  | "results_standings"
  | "sub_ref_alert"
  | "season_recap"
  | "fa_match_proposal"
  | "fa_match_response"
  | "kotc_on_deck"
  | "kotc_lives_low"
  | "kotc_lives_out"
  | "kotc_grace_expiring"
  | "kotc_bowed_out"
  | "kotc_rules_reminder"
  | "kotc_game_rules"
  | "kotc_life_purchase_confirmed"
  | "kotc_guardian_approval_request"
  | "kotc_guardian_approved"
  | "kotc_guardian_declined"
  | "kotc_drama_rule_triggered"
  | "kotc_waitlist_promoted"
  | "kotc_waitlist_carry_forward"
  | "kotc_battle_available"
  | "kotc_battle_cancelled"
  | "kotc_dispute_resolved"
  | "kotc_team_dissolved"
  | "kotc_refund_issued"
  | "spot_offer"
  | "offer_expired"
  | "balance_due_reminder"
  | "account_onboarding";

export interface NotificationPayload {
  userId: number;
  channel: NotificationChannel;
  type: NotificationType;
  subject?: string;
  body: string;
  link?: string;
  metadata?: Record<string, unknown>;
  emailTemplate?: EmailTemplatePayload;
}

const SMS_PRIORITY_TYPES = [
  "waitlist_movement",
  "cancellation_rainout",
  "payment_receipt",
  "refund_issued",
  "payment_failed",
  "schedule_change",
];

/**
 * Core notification dispatcher.
 * Writes a notification record to the DB and triggers channel-specific delivery.
 * Respects user channel preferences (stored in notification_preferences table).
 * non-in_app channels are skipped if the user has opted out.
 */
export async function sendNotification(payload: NotificationPayload): Promise<void> {
  try {
    if (payload.channel !== "in_app") {
      const allowed = await isChannelAllowed(payload.userId, payload.type, payload.channel);
      if (!allowed) return;
    }

    const [inserted] = await db
      .insert(notificationsTable)
      .values({
        userId: payload.userId,
        channel: payload.channel,
        type: payload.type,
        subject: payload.subject ?? null,
        body: payload.body,
        link: payload.link ?? null,
        status: "queued",
        metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
      })
      .returning();

    switch (payload.channel) {
      case "email":
        await dispatchEmail(payload, inserted.id);
        break;
      case "sms":
        await dispatchSms(payload, inserted.id);
        break;
      case "push":
        await dispatchPush(payload, inserted.id);
        break;
      case "in_app":
        await markNotificationSent(inserted.id);
        break;
    }
  } catch (err) {
    console.error("[notifications] dispatch error:", err);
  }
}

/**
 * Sends to in_app always, then checks preferences for sms/email/push.
 * This is the preferred method for event-driven notifications (e.g. registration confirmed,
 * waitlist movement) where the user's stored preferences should govern delivery.
 */
export async function sendNotificationWithPreferences(
  payload: Omit<NotificationPayload, "channel">,
): Promise<void> {
  await sendNotification({ ...payload, channel: "in_app" });

  const prefs = await getUserChannelPreferences(payload.userId, payload.type);

  const channelJobs: Promise<void>[] = [];
  if (prefs.email) channelJobs.push(sendNotification({ ...payload, channel: "email" }));
  if (prefs.sms) channelJobs.push(sendNotification({ ...payload, channel: "sms" }));
  if (prefs.push) channelJobs.push(sendNotification({ ...payload, channel: "push" }));

  await Promise.allSettled(channelJobs);
}

/**
 * Bulk sender for explicit channels (bypasses preference check — use for admin-triggered sends).
 */
export async function sendMultiChannelNotification(
  channels: NotificationChannel[],
  payload: Omit<NotificationPayload, "channel">,
): Promise<void> {
  await Promise.allSettled(channels.map((channel) => sendNotification({ ...payload, channel })));
}

// ─── Preference helpers ───────────────────────────────────────────────────────

async function getUserChannelPreferences(
  userId: number,
  notificationType: string,
): Promise<{ email: boolean; sms: boolean; push: boolean }> {
  const [pref] = await db
    .select()
    .from(notificationPreferencesTable)
    .where(
      and(
        eq(notificationPreferencesTable.userId, userId),
        eq(notificationPreferencesTable.notificationType, notificationType),
      ),
    );

  if (pref) {
    return { email: pref.channelEmail, sms: pref.channelSms, push: pref.channelPush };
  }

  // No stored pref — apply role-based defaults
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  const role = user?.role ?? "player";
  const smsEnabled = role === "parent" || role === "youth" || role === "player";
  return {
    email: true,
    sms: smsEnabled && SMS_PRIORITY_TYPES.includes(notificationType),
    push: false,
  };
}

async function isChannelAllowed(
  userId: number,
  notificationType: string,
  channel: NotificationChannel,
): Promise<boolean> {
  const prefs = await getUserChannelPreferences(userId, notificationType);
  if (channel === "email") return prefs.email;
  if (channel === "sms") return prefs.sms;
  if (channel === "push") return prefs.push;
  return true;
}

// ─── Channel dispatchers ──────────────────────────────────────────────────────

async function dispatchEmail(payload: NotificationPayload, notificationId: number): Promise<void> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.userId));
  if (!user?.email) {
    console.warn(`[notifications] no email address for user ${payload.userId} — skipping email`);
    await markNotificationSent(notificationId);
    return;
  }

  const subject = payload.subject ?? "PlayOn Notification";
  const templatePayload: EmailTemplatePayload =
    (payload.emailTemplate as EmailTemplatePayload | undefined) ??
    defaultEmailPayload(payload.type, subject, payload.body);

  const { html, text } = renderEmail(templatePayload);
  console.info(`[notifications] dispatching email to ${user.email} — subject: "${subject}"`);

  const result = await sendEmail({
    to: user.email,
    subject,
    html,
    text,
  });

  if (result.sent) {
    await markNotificationSent(notificationId);
  } else {
    await db
      .update(notificationsTable)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(notificationsTable.id, notificationId));
  }
}

async function dispatchSms(payload: NotificationPayload, notificationId: number): Promise<void> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.userId));
  if (!user?.phone) {
    await markNotificationSent(notificationId);
    return;
  }

  const result = await sendSms(user.phone, payload.body);
  if (result.sent) {
    await markNotificationSent(notificationId);
  } else {
    await db
      .update(notificationsTable)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(notificationsTable.id, notificationId));
  }
}

async function dispatchPush(payload: NotificationPayload, notificationId: number): Promise<void> {
  const subscriptions = await db
    .select()
    .from(webPushSubscriptionsTable)
    .where(eq(webPushSubscriptionsTable.userId, payload.userId));

  if (subscriptions.length === 0) {
    await markNotificationSent(notificationId);
    return;
  }

  const APP_URL = (process.env.PUBLIC_APP_URL ?? "https://playonfutsal.vercel.app").replace(/\/$/, "");
  const pushPayload = {
    title: payload.subject ?? "PlayOn",
    body: payload.body,
    tag: payload.type,
    url: APP_URL,
  };

  let anySent = false;
  for (const sub of subscriptions) {
    const result = await sendWebPush(
      { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
      pushPayload,
    );
    if (result.sent) {
      anySent = true;
    } else if (result.expired) {
      // Subscription expired — remove it so we don't keep trying
      await db
        .delete(webPushSubscriptionsTable)
        .where(eq(webPushSubscriptionsTable.id, sub.id));
      console.info(`[notifications] removed expired push subscription ${sub.id} for user ${payload.userId}`);
    }
  }

  if (anySent) {
    await markNotificationSent(notificationId);
  } else {
    await db
      .update(notificationsTable)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(notificationsTable.id, notificationId));
  }
}

async function markNotificationSent(notificationId: number): Promise<void> {
  try {
    await db
      .update(notificationsTable)
      .set({ status: "sent", sentAt: new Date() })
      .where(eq(notificationsTable.id, notificationId));
  } catch {
    // Non-blocking
  }
}

// ─── Registration Confirmation Email ──────────────────────────────────────────

export interface RegistrationConfirmationOptions {
  recipientUserId: number;
  playerUserId: number;
  entityType: string;
  entityId: number;
  poolId?: number | null;
  divisionName?: string | null;
  amountPaid: number;
}

/**
 * Sends a branded registration confirmation email with the player's QR code embedded inline.
 * - Resolves the QR string from player_profiles.qr_code (fallback: users.qr_code).
 * - For guardian registrations, playerUserId is the child; recipientUserId is the guardian.
 * - Respects email channel preferences.
 * - Non-blocking: logs errors but never throws.
 */
export async function sendRegistrationConfirmationEmail(
  opts: RegistrationConfirmationOptions,
): Promise<void> {
  try {
    const { recipientUserId, playerUserId, entityType, entityId, poolId, divisionName, amountPaid } = opts;

    // Check email preference
    const allowed = await isChannelAllowed(recipientUserId, "registration_confirmed", "email");
    if (!allowed) return;

    // Resolve recipient email + name
    const [recipient] = await db.select().from(usersTable).where(eq(usersTable.id, recipientUserId));
    if (!recipient?.email) {
      console.warn("[confirmationEmail] no email for user", recipientUserId);
      return;
    }

    // Resolve the player's QR string (child for guardian registrations)
    let qrString: string | null = null;
    const [playerProfile] = await db
      .select({ qrCode: playerProfilesTable.qrCode })
      .from(playerProfilesTable)
      .where(eq(playerProfilesTable.userId, playerUserId));
    if (playerProfile?.qrCode) {
      qrString = playerProfile.qrCode;
    } else {
      const [playerUser] = await db
        .select({ qrCode: usersTable.qrCode })
        .from(usersTable)
        .where(eq(usersTable.id, playerUserId));
      qrString = playerUser?.qrCode ?? null;
    }

    if (!qrString) {
      console.warn("[confirmationEmail] no QR string for player", playerUserId, "— skipping");
      return;
    }

    // Resolve player name (for the greeting)
    let playerFirstName = recipient.firstName ?? "";
    if (playerUserId !== recipientUserId) {
      const [pUser] = await db
        .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
        .from(usersTable)
        .where(eq(usersTable.id, playerUserId));
      if (pUser?.firstName) playerFirstName = pUser.firstName;
    }
    const playerName = playerFirstName || recipient.firstName || "Player";

    // Resolve offering details
    const details = await resolveOfferingDetails(entityType, entityId, poolId ?? null);

    // Generate QR code as data URI
    const qrDataUri = await generateQrDataUri(qrString);

    // Format amount paid
    const amountLabel = amountPaid <= 0 ? "Free" : `$${amountPaid.toFixed(2)}`;

    // Build pool/division label
    const poolOrDivision = divisionName ?? details.poolName ?? null;

    const { html, text, subject } = registrationConfirmationEmail({
      playerName,
      eventName: details.name,
      eventType: details.eventType,
      dates: details.dates,
      times: details.times ?? undefined,
      venue: details.venue ?? undefined,
      poolOrDivision: poolOrDivision ?? undefined,
      amountPaid: amountLabel,
      qrDataUri,
    });

    console.info(`[confirmationEmail] sending to ${recipient.email} — subject: "${subject}"`);
    await sendEmail({ to: recipient.email, subject, html, text });
  } catch (err) {
    console.error("[confirmationEmail] failed:", err);
  }
}

// ─── Offering detail resolver ─────────────────────────────────────────────────

interface OfferingDetails {
  name: string;
  eventType: string;
  dates: string;
  times?: string | null;
  venue?: string | null;
  poolName?: string | null;
}

async function resolveVenueName(courtId: number | null | undefined): Promise<string | null> {
  if (!courtId) return null;
  try {
    const [court] = await db
      .select({ venueId: courtsTable.venueId })
      .from(courtsTable)
      .where(eq(courtsTable.id, courtId));
    if (!court?.venueId) return null;
    const [venue] = await db
      .select({ name: venuesTable.name })
      .from(venuesTable)
      .where(eq(venuesTable.id, court.venueId));
    return venue?.name ?? null;
  } catch {
    return null;
  }
}

function formatDateRange(start: string | Date | null | undefined, end: string | Date | null | undefined): string {
  const fmt = (d: string | Date) =>
    new Date(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  if (!start) return "TBD";
  if (!end || start === end) return fmt(start);
  return `${fmt(start)} – ${fmt(end)}`;
}

function formatTime(dt: string | Date | null | undefined): string | null {
  if (!dt) return null;
  return new Date(dt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

async function resolveOfferingDetails(
  entityType: string,
  entityId: number,
  poolId: number | null,
): Promise<OfferingDetails> {
  if (entityType === "league") {
    const [row] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, entityId));
    const venue = await resolveVenueName((row as any)?.courtId);
    return {
      name: row?.name ?? `League #${entityId}`,
      eventType: "League",
      dates: formatDateRange((row as any)?.startDate, (row as any)?.endDate),
      venue,
    };
  }

  if (entityType === "tournament") {
    const [row] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, entityId));
    const venue = await resolveVenueName((row as any)?.courtId);
    const startDate = (row as any)?.startDate ?? (row as any)?.startsAt;
    const endDate = (row as any)?.endDate ?? (row as any)?.endsAt;
    return {
      name: row?.name ?? `Tournament #${entityId}`,
      eventType: "Tournament",
      dates: formatDateRange(startDate, endDate),
      venue,
    };
  }

  if (entityType === "camp") {
    const [row] = await db.select().from(campsTable).where(eq(campsTable.id, entityId));
    const venue = await resolveVenueName((row as any)?.courtId);
    const startDate = (row as any)?.startDate ?? (row as any)?.startsAt;
    const endDate = (row as any)?.endDate ?? (row as any)?.endsAt;
    return {
      name: row?.name ?? `Camp #${entityId}`,
      eventType: "Camp",
      dates: formatDateRange(startDate, endDate),
      venue,
    };
  }

  if (entityType === "drop_in") {
    const [row] = await db.select().from(dropinsTable).where(eq(dropinsTable.id, entityId));
    const venue = await resolveVenueName((row as any)?.courtId);

    let times: string | null = null;
    let poolName: string | null = null;
    let poolDate: string | null = null;

    if (poolId) {
      const [pool] = await db.select().from(dropinCourtPoolsTable).where(eq(dropinCourtPoolsTable.id, poolId));
      if (pool) {
        if ((pool as any).startsAt) {
          const start = new Date((pool as any).startsAt);
          poolDate = start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
          const startTime = formatTime((pool as any).startsAt);
          if (startTime) {
            const durationMs = ((pool as any).durationMinutes ?? 120) * 60 * 1000;
            const endTime = formatTime(new Date(start.getTime() + durationMs));
            times = endTime ? `${startTime} – ${endTime}` : startTime;
          }
        }
        poolName = (pool as any).name ?? null;
      }
    }

    const sessionDate = poolDate ?? formatDateRange((row as any)?.startsAt, (row as any)?.endsAt);

    return {
      name: row?.name ?? `Drop-in #${entityId}`,
      eventType: "Drop-in",
      dates: sessionDate,
      times,
      venue,
      poolName,
    };
  }

  return {
    name: `Event #${entityId}`,
    eventType: entityType.charAt(0).toUpperCase() + entityType.slice(1).replace(/_/g, "-"),
    dates: "TBD",
  };
}

export interface InviteEmailResult {
  sent: boolean;
  error?: string;
}

/**
 * Sends a branded staff invite email to an address that does not yet have a PlayOn account.
 * Returns { sent: true } on success or { sent: false, error } on failure so callers can
 * surface the failure to admins rather than silently swallowing it.
 */
export async function sendInviteEmail(
  toEmail: string,
  role: string,
  inviteUrl: string,
): Promise<InviteEmailResult> {
  const roleLabel =
    role === "ref"
      ? "Referee"
      : role === "coach"
        ? "Coach"
        : role === "scorekeeper"
          ? "Scorekeeper"
          : role;
  const subject = `You've been invited to join PlayOn as a ${roleLabel}`;

  const templatePayload: EmailTemplatePayload = {
    subject,
    preheader: `You have been invited to join PlayOn as a ${roleLabel}. Accept your invite to get started.`,
    heading: `You're invited to join PlayOn`,
    bodyParagraphs: [
      `Hi there,`,
      `You've been invited to join PlayOn Futsal as a ${roleLabel}. Click the button below to complete your registration and set up your account.`,
      `This invitation link expires in 7 days. If you didn't expect this email you can safely ignore it.`,
    ],
    cta: { label: "Accept Invite", url: inviteUrl },
  };

  const { html, text } = renderEmail(templatePayload);
  console.info(`[invites] dispatching invite email to ${toEmail} — subject: "${subject}"`);
  console.info(`[invites] invite URL: ${inviteUrl}`);

  const result = await sendEmail({ to: toEmail, subject, html, text });
  if (!result.sent) {
    console.error(`[invites] invite email FAILED for ${toEmail} — reason: ${result.error ?? "unknown"}`);
  } else {
    console.info(`[invites] invite email sent successfully to ${toEmail}`);
  }
  return result;
}
