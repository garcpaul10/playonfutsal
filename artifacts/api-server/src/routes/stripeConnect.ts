/**
 * Stripe Connect onboarding routes.
 *
 * Self-service (staff):
 *  POST /staff/connect/onboard  — create / reuse a Stripe Express account, return an Account Link URL
 *  GET  /staff/connect/status   — return current onboarding/payout capability status
 *  POST /staff/connect/refresh  — generate a fresh Account Link when a prior link expired
 *
 * Admin-initiated invite flow:
 *  POST /admin/connect/staff/:userId/invite   — admin sends a Stripe Connect invite link to a staff member
 *  POST /admin/connect/venues/:venueId/invite — admin sends a Stripe Connect invite link to a facility
 *  GET  /admin/connect/staff/:userId/status   — admin views onboarding status + queued payout count
 *  GET  /admin/connect/venues/:venueId/status — admin views venue onboarding status + queued payout count
 */
import { Router, type IRouter } from "express";
import { db, staffProfilesTable, usersTable, venuesTable, payoutsTable, auditLogTable } from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { requireStaffOrRef, requirePermission, type AuthedRequest } from "../middlewares/auth";
import { getUncachableStripeClient } from "../lib/stripe";
import { sendEmail } from "../services/email";
import { renderEmail, type EmailTemplatePayload } from "../services/emailTemplate";
import { sendSms } from "../services/sms";
import type { Request } from "express";

const router: IRouter = Router();

async function getDbUser(clerkId: string) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  return user ?? null;
}

async function getStaffProfile(userId: number) {
  const [profile] = await db.select().from(staffProfilesTable)
    .where(eq(staffProfilesTable.userId, userId));
  return profile ?? null;
}

function appOriginFromReq(req: Request): string {
  return (req.headers["x-forwarded-proto"] ?? "https") + "://" +
    (req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost:3000");
}

// ─── Self-service staff routes ────────────────────────────────────────────────

/**
 * POST /staff/connect/onboard
 * Creates a Stripe Express connected account if one does not exist, then
 * generates a one-time Account Link URL and returns it.
 */
router.post("/staff/connect/onboard", requireStaffOrRef, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const dbUser = await getDbUser(authed.clerkUserId);
  if (!dbUser) { res.status(404).json({ error: "User not found" }); return; }

  const profile = await getStaffProfile(dbUser.id);
  if (!profile) { res.status(404).json({ error: "Staff profile not found. Contact an admin." }); return; }

  const body = req.body as { returnPath?: string; refreshPath?: string };
  const origin = appOriginFromReq(req);
  const returnUrl = `${origin}${body.returnPath ?? "/connect/complete"}`;
  const refreshUrl = `${origin}${body.refreshPath ?? "/connect/refresh"}`;

  const stripe = await getUncachableStripeClient();

  let connectAccountId = (profile as any).connectAccountId as string | null;

  if (!connectAccountId) {
    const account = await stripe.accounts.create({
      type: "express",
      country: "US",
      email: dbUser.email ?? undefined,
      capabilities: { transfers: { requested: true } },
      metadata: {
        playonUserId: String(dbUser.id),
        playonClerkId: authed.clerkUserId,
      },
    });
    connectAccountId = account.id;

    await db.update(staffProfilesTable)
      .set({ connectAccountId, connectOnboardingStatus: "onboarding", updatedAt: new Date() } as any)
      .where(eq(staffProfilesTable.id, profile.id));

    await db.insert(auditLogTable).values({
      actorClerkId: authed.clerkUserId,
      action: "create",
      entityType: "stripe_connect_account",
      entityId: connectAccountId,
      notes: `Express connected account created for staff user ${dbUser.id}`,
    });
  }

  const accountLink = await stripe.accountLinks.create({
    account: connectAccountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: "account_onboarding",
  });

  res.json({ url: accountLink.url, connectAccountId, expiresAt: accountLink.expires_at });
});

/**
 * GET /staff/connect/status
 * Returns the staff member's Connect onboarding status and payout capability.
 */
router.get("/staff/connect/status", requireStaffOrRef, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const dbUser = await getDbUser(authed.clerkUserId);
  if (!dbUser) { res.status(404).json({ error: "User not found" }); return; }

  const profile = await getStaffProfile(dbUser.id);
  if (!profile) { res.status(404).json({ error: "Staff profile not found" }); return; }

  const connectAccountId = (profile as any).connectAccountId as string | null;
  const storedStatus = (profile as any).connectOnboardingStatus as string;

  if (!connectAccountId) {
    res.json({ status: "not_started", connectAccountId: null, payoutsEnabled: false });
    return;
  }

  const stripe = await getUncachableStripeClient();
  const account = await stripe.accounts.retrieve(connectAccountId);

  const payoutsEnabled = account.payouts_enabled ?? false;
  const chargesEnabled = account.charges_enabled ?? false;
  const detailsSubmitted = account.details_submitted ?? false;

  let liveStatus = storedStatus;
  if (detailsSubmitted && payoutsEnabled) {
    liveStatus = "complete";
  } else if (detailsSubmitted && !payoutsEnabled) {
    liveStatus = "restricted";
  } else if (connectAccountId && !detailsSubmitted) {
    liveStatus = "onboarding";
  }

  if (liveStatus !== storedStatus) {
    await db.update(staffProfilesTable)
      .set({ connectOnboardingStatus: liveStatus, updatedAt: new Date() } as any)
      .where(eq(staffProfilesTable.id, profile.id));
  }

  res.json({ status: liveStatus, connectAccountId, payoutsEnabled, chargesEnabled, detailsSubmitted, requirements: account.requirements ?? null });
});

/**
 * POST /staff/connect/refresh
 * Generates a fresh Account Link for staff who didn't complete onboarding.
 */
router.post("/staff/connect/refresh", requireStaffOrRef, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const dbUser = await getDbUser(authed.clerkUserId);
  if (!dbUser) { res.status(404).json({ error: "User not found" }); return; }

  const profile = await getStaffProfile(dbUser.id);
  if (!profile) { res.status(404).json({ error: "Staff profile not found" }); return; }

  const connectAccountId = (profile as any).connectAccountId as string | null;
  if (!connectAccountId) {
    res.status(400).json({ error: "No connected account found. Start onboarding first via POST /staff/connect/onboard." });
    return;
  }

  const body = req.body as { returnPath?: string; refreshPath?: string };
  const origin = appOriginFromReq(req);
  const returnUrl = `${origin}${body.returnPath ?? "/connect/complete"}`;
  const refreshUrl = `${origin}${body.refreshPath ?? "/connect/refresh"}`;

  const stripe = await getUncachableStripeClient();
  const accountLink = await stripe.accountLinks.create({
    account: connectAccountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: "account_onboarding",
  });

  res.json({ url: accountLink.url, expiresAt: accountLink.expires_at });
});

// ─── Admin invite routes ──────────────────────────────────────────────────────

/**
 * POST /admin/connect/staff/:userId/invite
 * Admin sends a Stripe Connect onboarding invite link to a staff member.
 * Creates the Stripe Express account if one doesn't exist yet, generates a
 * fresh Account Link, and emails it to the recipient. Sets onboarding status
 * to "invited".
 */
router.post(
  "/admin/connect/staff/:userId/invite",
  requirePermission("canManagePayouts"),
  async (req: Request, res): Promise<void> => {
    const authed = req as AuthedRequest;
    const userId = Number(req.params.userId);
    if (isNaN(userId)) { res.status(400).json({ error: "Invalid userId" }); return; }

    const [targetUser] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!targetUser) { res.status(404).json({ error: "User not found" }); return; }

    const profile = await getStaffProfile(userId);
    if (!profile) { res.status(404).json({ error: "Staff profile not found for this user" }); return; }

    const recipientEmail = targetUser.email;
    if (!recipientEmail) { res.status(422).json({ error: "User has no email address on file" }); return; }

    const origin = appOriginFromReq(req);
    const returnUrl = `${origin}/connect/complete`;
    const refreshUrl = `${origin}/connect/refresh`;

    const stripe = await getUncachableStripeClient();

    let connectAccountId = (profile as any).connectAccountId as string | null;

    if (!connectAccountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: "US",
        email: recipientEmail,
        capabilities: { transfers: { requested: true } },
        metadata: {
          playonUserId: String(userId),
          invitedByClerkId: authed.clerkUserId,
        },
      });
      connectAccountId = account.id;

      await db.update(staffProfilesTable)
        .set({ connectAccountId, connectOnboardingStatus: "invited", updatedAt: new Date() } as any)
        .where(eq(staffProfilesTable.id, profile.id));
    } else {
      // Only update status if not already fully onboarded — never downgrade onboarded recipients
      const currentStatus = (profile as any).connectOnboardingStatus as string ?? "pending";
      const isAlreadyOnboarded = currentStatus === "onboarded" || currentStatus === "complete";
      if (!isAlreadyOnboarded) {
        await db.update(staffProfilesTable)
          .set({ connectOnboardingStatus: "invited", updatedAt: new Date() } as any)
          .where(eq(staffProfilesTable.id, profile.id));
      }
    }

    const accountLink = await stripe.accountLinks.create({
      account: connectAccountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: "account_onboarding",
    });

    const recipientName = [targetUser.firstName, targetUser.lastName].filter(Boolean).join(" ") || "there";

    const staffInvitePayload: EmailTemplatePayload = {
      subject: "You're invited to set up your PlayOn payout account",
      preheader: "An admin has invited you to set up your Stripe account for payouts.",
      heading: "You're invited to set up your payout account",
      bodyParagraphs: [
        `Hi ${recipientName},`,
        "An admin has invited you to set up your Stripe account so you can receive payouts from PlayOn.",
        "Click the button below to complete setup. This link expires in 24 hours — if it has expired, ask your admin to re-send the invite.",
        "Once you finish, any pending payouts will be released to your account automatically.",
      ],
      cta: { label: "Set up payout account", url: accountLink.url },
    };
    const { html: staffInviteHtml, text: staffInviteText } = renderEmail(staffInvitePayload);
    const emailResult = await sendEmail({
      to: recipientEmail,
      subject: staffInvitePayload.subject,
      text: staffInviteText,
      html: staffInviteHtml,
    });

    const smsPhone = targetUser.phone ?? null;
    let smsSent = false;
    if (smsPhone) {
      const smsResult = await sendSms(
        smsPhone,
        `PlayOn: You've been invited to set up your payout account. Complete setup here (expires 24h): ${accountLink.url}`,
      );
      smsSent = smsResult.sent;
    }

    await db.insert(auditLogTable).values({
      actorClerkId: authed.clerkUserId,
      action: "invite",
      entityType: "stripe_connect_account",
      entityId: connectAccountId,
      notes: `Connect invite sent to staff user ${userId} (${recipientEmail}). Email sent: ${emailResult.sent}. SMS sent: ${smsSent}`,
    });

    res.json({
      connectAccountId,
      inviteUrl: accountLink.url,
      expiresAt: accountLink.expires_at,
      emailSent: emailResult.sent,
      smsSent,
    });
  },
);

/**
 * POST /admin/connect/venues/:venueId/invite
 * Admin sends a Stripe Connect onboarding invite link to a facility partner.
 * Body: { email: string; phone?: string }
 */
router.post(
  "/admin/connect/venues/:venueId/invite",
  requirePermission("canManagePayouts"),
  async (req: Request, res): Promise<void> => {
    const authed = req as AuthedRequest;
    const venueId = Number(req.params.venueId);
    if (isNaN(venueId)) { res.status(400).json({ error: "Invalid venueId" }); return; }

    const [venue] = await db.select().from(venuesTable).where(eq(venuesTable.id, venueId));
    if (!venue) { res.status(404).json({ error: "Venue not found" }); return; }

    const body = req.body as { email?: string; phone?: string };
    const recipientEmail = body.email?.trim();
    if (!recipientEmail) { res.status(400).json({ error: "email is required" }); return; }

    const origin = appOriginFromReq(req);
    const returnUrl = `${origin}/connect/complete`;
    const refreshUrl = `${origin}/connect/refresh`;

    const stripe = await getUncachableStripeClient();

    let connectAccountId = (venue as any).stripeConnectAccountId as string | null;

    if (!connectAccountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: "US",
        email: recipientEmail,
        capabilities: { transfers: { requested: true } },
        metadata: {
          playonVenueId: String(venueId),
          venueName: venue.name,
          invitedByClerkId: authed.clerkUserId,
        },
      });
      connectAccountId = account.id;

      await db.update(venuesTable)
        .set({
          stripeConnectAccountId: connectAccountId,
          stripeConnectOnboardingStatus: "invited",
          updatedAt: new Date(),
        } as any)
        .where(eq(venuesTable.id, venueId));
    } else {
      // Only update status if not already fully onboarded — never downgrade onboarded venues
      const currentStatus = (venue as any).stripeConnectOnboardingStatus as string ?? "none";
      if (currentStatus !== "onboarded") {
        await db.update(venuesTable)
          .set({ stripeConnectOnboardingStatus: "invited", updatedAt: new Date() } as any)
          .where(eq(venuesTable.id, venueId));
      }
    }

    const accountLink = await stripe.accountLinks.create({
      account: connectAccountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: "account_onboarding",
    });

    const venueInvitePayload: EmailTemplatePayload = {
      subject: `PlayOn: Set up payout account for ${venue.name}`,
      preheader: `An admin has invited ${venue.name} to set up a Stripe account for facility payouts.`,
      heading: "Set up your facility payout account",
      bodyParagraphs: [
        `Hi,`,
        `An admin has invited ${venue.name} to set up a Stripe account to receive facility payout splits from PlayOn.`,
        "Click the button below to complete setup. This link expires in 24 hours — if it has expired, ask your admin to re-send the invite.",
        "Once setup is complete, facility payouts will be released to the connected account automatically.",
      ],
      cta: { label: "Set up payout account", url: accountLink.url },
    };
    const { html: venueInviteHtml, text: venueInviteText } = renderEmail(venueInvitePayload);
    const emailResult = await sendEmail({
      to: recipientEmail,
      subject: venueInvitePayload.subject,
      text: venueInviteText,
      html: venueInviteHtml,
    });

    let smsSent = false;
    const smsPhone = body.phone?.trim() ?? null;
    if (smsPhone) {
      const smsResult = await sendSms(
        smsPhone,
        `PlayOn: ${venue.name} has been invited to set up a payout account. Complete setup here (expires 24h): ${accountLink.url}`,
      );
      smsSent = smsResult.sent;
    }

    await db.insert(auditLogTable).values({
      actorClerkId: authed.clerkUserId,
      action: "invite",
      entityType: "stripe_connect_account_venue",
      entityId: connectAccountId,
      notes: `Connect invite sent to venue ${venueId} (${venue.name}) at ${recipientEmail}. Email sent: ${emailResult.sent}. SMS sent: ${smsSent}`,
    });

    res.json({
      venueId,
      connectAccountId,
      inviteUrl: accountLink.url,
      expiresAt: accountLink.expires_at,
      emailSent: emailResult.sent,
      smsSent,
    });
  },
);

/**
 * GET /admin/connect/staff/:userId/status
 * Admin views a staff member's Connect onboarding status and count of queued payouts.
 */
router.get(
  "/admin/connect/staff/:userId/status",
  requirePermission("canManagePayouts"),
  async (req: Request, res): Promise<void> => {
    const userId = Number(req.params.userId);
    if (isNaN(userId)) { res.status(400).json({ error: "Invalid userId" }); return; }

    const [targetUser] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!targetUser) { res.status(404).json({ error: "User not found" }); return; }

    const profile = await getStaffProfile(userId);
    if (!profile) { res.status(404).json({ error: "Staff profile not found" }); return; }

    const connectAccountId = (profile as any).connectAccountId as string | null;
    const storedStatus = (profile as any).connectOnboardingStatus as string ?? "pending";

    const queuedPayouts = await db.select({ id: payoutsTable.id })
      .from(payoutsTable)
      .where(
        and(
          eq(payoutsTable.recipientUserId, userId),
          eq(payoutsTable.status, "pending_onboarding"),
        ),
      );

    res.json({
      userId,
      connectAccountId,
      onboardingStatus: storedStatus,
      queuedPayoutCount: queuedPayouts.length,
    });
  },
);

/**
 * GET /admin/connect/venues/:venueId/status
 * Admin views a venue's Connect onboarding status and count of queued payouts.
 */
router.get(
  "/admin/connect/venues/:venueId/status",
  requirePermission("canManagePayouts"),
  async (req: Request, res): Promise<void> => {
    const venueId = Number(req.params.venueId);
    if (isNaN(venueId)) { res.status(400).json({ error: "Invalid venueId" }); return; }

    const [venue] = await db.select().from(venuesTable).where(eq(venuesTable.id, venueId));
    if (!venue) { res.status(404).json({ error: "Venue not found" }); return; }

    const connectAccountId = (venue as any).stripeConnectAccountId as string | null;
    const storedStatus = (venue as any).stripeConnectOnboardingStatus as string ?? "none";

    const queuedPayouts = await db.select({ id: payoutsTable.id })
      .from(payoutsTable)
      .where(
        and(
          eq((payoutsTable as any).venueId, venueId),
          eq(payoutsTable.status, "pending_onboarding"),
        ),
      );

    res.json({
      venueId,
      connectAccountId,
      onboardingStatus: storedStatus,
      queuedPayoutCount: queuedPayouts.length,
    });
  },
);

/**
 * GET /admin/connect/venues/all-statuses
 * Returns Stripe Connect onboarding status + queued payout count for every venue.
 * Used by the venues admin page to show a per-venue queued count pill.
 */
router.get(
  "/admin/connect/venues/all-statuses",
  requirePermission("canManagePayouts"),
  async (_req: Request, res): Promise<void> => {
    const allVenues = await db.select({
      id: venuesTable.id,
      connectAccountId: (venuesTable as any).stripeConnectAccountId,
      onboardingStatus: (venuesTable as any).stripeConnectOnboardingStatus,
    }).from(venuesTable);

    // Count pending_onboarding payouts per venue in one query
    const queuedRows = await db.select({
      venueId: (payoutsTable as any).venueId,
      count: sql<number>`COUNT(*)::int`,
    })
      .from(payoutsTable)
      .where(eq(payoutsTable.status, "pending_onboarding"))
      .groupBy((payoutsTable as any).venueId);

    const countByVenueId = new Map<number, number>(
      queuedRows
        .filter(r => r.venueId != null)
        .map(r => [r.venueId as number, r.count]),
    );

    res.json(
      allVenues.map(v => ({
        venueId: v.id,
        connectAccountId: v.connectAccountId ?? null,
        onboardingStatus: v.onboardingStatus ?? "none",
        queuedPayoutCount: countByVenueId.get(v.id) ?? 0,
      })),
    );
  },
);

export default router;
