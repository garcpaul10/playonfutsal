import { Router } from "express";
import { db } from "@workspace/db";
import {
  broadcastMessagesTable,
  registrationsTable,
  spotsTable,
  usersTable,
  leaguesTable,
  tournamentsTable,
  campsTable,
  dropinsTable,
  dropinCourtPoolsTable,
} from "@workspace/db";
import { eq, and, inArray, ne, sql } from "drizzle-orm";
import { requireAnyPermission, type AuthedRequest } from "../middlewares/auth";
import { sendMultiChannelNotification, type NotificationChannel } from "../services/notifications";
import type { Request } from "express";

const router = Router();

// ── Types ─────────────────────────────────────────────────────────────────────

interface Recipient {
  id: number;
  name: string;
  email: string;
  status: string;
}

// ── Recipient resolution helper ───────────────────────────────────────────────

/**
 * Resolve the set of recipients for a broadcast message.
 *
 * Two independent data sources exist in this app:
 *   • spots       — drop-in participation (identified by spots.waitlisted boolean)
 *   • registrations — league / tournament / camp participation
 *
 * Targeting matrix:
 *   offeringType=drop_in           → spots only (filter by eventId/poolId when provided)
 *   offeringType=league|tournament|camp → registrations only
 *   offeringType=all, no eventId   → spots (all drop-ins) + registrations (all non-drop-in)
 *   offeringType=all + eventType   → one source based on eventType; uses both IDs safely
 *   poolId provided                → spots only filtered by poolId (implies drop_in)
 *
 * Callers MUST pass eventType when offeringType=all and eventId is set; otherwise
 * integer IDs across offering tables may collide. A 400 is returned at the route level.
 */
async function resolveRecipients(params: {
  offeringType?: string;
  eventId?: number;
  eventType?: string;
  poolId?: number;
  statusFilter?: string;
  individualIds?: number[];
}): Promise<Recipient[]> {
  const { offeringType, eventId, eventType, poolId, statusFilter, individualIds } = params;

  const recipientMap = new Map<number, Recipient>();

  // Which type are we targeting?
  const effectiveType = offeringType && offeringType !== "all" ? offeringType : eventType;
  const isAll = !offeringType || offeringType === "all";
  const isDropinTarget = effectiveType === "drop_in" || poolId != null;
  const isRegistrationTarget = effectiveType && effectiveType !== "drop_in";

  // ── Query spots (drop-in participants) ──────────────────────────────────────
  // Query spots when: targeting drop-in explicitly, or broadcasting to all (no type filter)
  if (isDropinTarget || (isAll && !eventId)) {
    const waitlistCond =
      statusFilter === "registered"
        ? eq(spotsTable.waitlisted, false)
        : statusFilter === "waitlisted"
          ? eq(spotsTable.waitlisted, true)
          : undefined;

    const spotsRows = await db
      .select({
        userId: spotsTable.userId,
        waitlisted: spotsTable.waitlisted,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        email: usersTable.email,
      })
      .from(spotsTable)
      .innerJoin(usersTable, eq(usersTable.id, spotsTable.userId))
      .where(
        and(
          ne(spotsTable.status, "cancelled"),
          poolId != null ? eq(spotsTable.poolId, poolId) : undefined,
          // Only apply eventId filter for drop-in spots when we know this is a drop-in event
          eventId != null && isDropinTarget && poolId == null
            ? eq(spotsTable.entityId, eventId)
            : undefined,
          waitlistCond,
        ),
      );

    for (const row of spotsRows) {
      if (!row.userId || !row.email) continue;
      recipientMap.set(row.userId, {
        id: row.userId,
        name: [row.firstName, row.lastName].filter(Boolean).join(" ") || row.email,
        email: row.email,
        status: row.waitlisted ? "waitlisted" : "registered",
      });
    }

    // If targeting drop-in only (pool or explicit drop_in), skip registrations query
    if (isDropinTarget) {
      let recipients = Array.from(recipientMap.values());
      if (individualIds?.length) {
        const idSet = new Set(individualIds);
        recipients = recipients.filter((r) => idSet.has(r.id));
      }
      return recipients;
    }
  }

  // ── Query registrations (league / tournament / camp participants) ───────────
  // Skip if we only want drop-ins; include when targeting registrations explicitly or all types
  if (isRegistrationTarget || isAll) {
    const confirmedStatuses = ["confirmed", "active"];
    const waitlistedStatuses = ["waitlisted"];
    let allowedStatuses: string[];
    if (statusFilter === "registered") {
      allowedStatuses = confirmedStatuses;
    } else if (statusFilter === "waitlisted") {
      allowedStatuses = waitlistedStatuses;
    } else {
      allowedStatuses = [...confirmedStatuses, ...waitlistedStatuses];
    }

    const regConditions = [
      ne(registrationsTable.status, "cancelled"),
      ne(registrationsTable.status, "expired"),
      inArray(registrationsTable.status, allowedStatuses),
    ];

    if (isRegistrationTarget) {
      // Scoped to a specific non-dropin offering type — safe to add programType + eventId
      regConditions.push(eq(registrationsTable.programType, effectiveType!));
      if (eventId != null) {
        regConditions.push(eq(registrationsTable.programId, eventId));
      }
    } else {
      // offeringType=all with no eventId — exclude drop_in entries (already covered via spots)
      regConditions.push(ne(registrationsTable.programType, "drop_in"));
    }

    const regRows = await db
      .select({
        dbUserId: usersTable.id,
        status: registrationsTable.status,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        email: usersTable.email,
      })
      .from(registrationsTable)
      .innerJoin(usersTable, eq(usersTable.clerkId, registrationsTable.userId))
      .where(and(...regConditions));

    const confirmedSet = new Set(["confirmed", "active"]);
    for (const row of regRows) {
      if (!row.email || !row.dbUserId) continue;
      if (!recipientMap.has(row.dbUserId)) {
        recipientMap.set(row.dbUserId, {
          id: row.dbUserId,
          name: [row.firstName, row.lastName].filter(Boolean).join(" ") || row.email,
          email: row.email,
          status: confirmedSet.has(row.status) ? "registered" : "waitlisted",
        });
      }
    }
  }

  let recipients = Array.from(recipientMap.values());
  if (individualIds?.length) {
    const idSet = new Set(individualIds);
    recipients = recipients.filter((r) => idSet.has(r.id));
  }
  return recipients;
}

// ── GET /messaging/recipients ─────────────────────────────────────────────────

const requireMessagingPermission = requireAnyPermission(["canManageAnnouncements"]);

router.get("/messaging/recipients", requireMessagingPermission, async (req: Request, res): Promise<void> => {
  const {
    offeringType,
    eventId,
    eventType,
    poolId,
    status: statusFilter,
    individualIds,
  } = req.query as Record<string, string | undefined>;

  // eventId with offeringType=all requires eventType to avoid cross-table ID collisions
  if (eventId && (!offeringType || offeringType === "all") && !eventType) {
    res.status(400).json({ error: "eventType is required when offeringType is 'all' and eventId is provided" });
    return;
  }

  try {
    const recipients = await resolveRecipients({
      offeringType: offeringType ?? undefined,
      eventId: eventId ? parseInt(eventId) : undefined,
      eventType: eventType ?? undefined,
      poolId: poolId ? parseInt(poolId) : undefined,
      statusFilter: statusFilter ?? "both",
      individualIds: individualIds
        ? String(individualIds)
            .split(",")
            .map(Number)
            .filter((n) => !isNaN(n))
        : undefined,
    });

    res.json({ recipients, count: recipients.length });
  } catch (err) {
    console.error("[messaging] GET /recipients error:", err);
    res.status(500).json({ error: "Failed to resolve recipients" });
  }
});

// ── GET /messaging/events ─────────────────────────────────────────────────────
// Returns events for a given offering type to populate the event picker

router.get("/messaging/events", requireMessagingPermission, async (req: Request, res): Promise<void> => {
  const { offeringType } = req.query as { offeringType?: string };

  try {
    let events: { id: number; name: string; type: string }[] = [];

    if (!offeringType || offeringType === "all") {
      const [leagues, tournaments, camps, dropins] = await Promise.all([
        db.select({ id: leaguesTable.id, name: leaguesTable.name }).from(leaguesTable).orderBy(leaguesTable.name).limit(50),
        db.select({ id: tournamentsTable.id, name: tournamentsTable.name }).from(tournamentsTable).orderBy(tournamentsTable.name).limit(50),
        db.select({ id: campsTable.id, name: campsTable.name }).from(campsTable).orderBy(campsTable.name).limit(50),
        db.select({ id: dropinsTable.id, name: dropinsTable.name }).from(dropinsTable).orderBy(dropinsTable.name).limit(50),
      ]);
      events = [
        ...leagues.map((e) => ({ ...e, type: "league" })),
        ...tournaments.map((e) => ({ ...e, type: "tournament" })),
        ...camps.map((e) => ({ ...e, type: "camp" })),
        ...dropins.map((e) => ({ ...e, type: "drop_in" })),
      ];
    } else if (offeringType === "league") {
      const rows = await db.select({ id: leaguesTable.id, name: leaguesTable.name }).from(leaguesTable).orderBy(leaguesTable.name).limit(100);
      events = rows.map((e) => ({ ...e, type: "league" }));
    } else if (offeringType === "tournament") {
      const rows = await db.select({ id: tournamentsTable.id, name: tournamentsTable.name }).from(tournamentsTable).orderBy(tournamentsTable.name).limit(100);
      events = rows.map((e) => ({ ...e, type: "tournament" }));
    } else if (offeringType === "camp") {
      const rows = await db.select({ id: campsTable.id, name: campsTable.name }).from(campsTable).orderBy(campsTable.name).limit(100);
      events = rows.map((e) => ({ ...e, type: "camp" }));
    } else if (offeringType === "drop_in") {
      const rows = await db.select({ id: dropinsTable.id, name: dropinsTable.name }).from(dropinsTable).orderBy(dropinsTable.name).limit(100);
      events = rows.map((e) => ({ ...e, type: "drop_in" }));
    }

    res.json(events);
  } catch (err) {
    console.error("[messaging] GET /events error:", err);
    res.status(500).json({ error: "Failed to load events" });
  }
});

// ── GET /messaging/pools ─────────────────────────────────────────────────────
// Returns pools for a given drop-in event

router.get("/messaging/pools", requireMessagingPermission, async (req: Request, res): Promise<void> => {
  const { dropinId } = req.query as { dropinId?: string };
  if (!dropinId) {
    res.json([]);
    return;
  }

  try {
    const poolRows = await db
      .select({
        id: dropinCourtPoolsTable.id,
        courtId: dropinCourtPoolsTable.courtId,
        ageGroup: dropinCourtPoolsTable.ageGroup,
        skillLevel: dropinCourtPoolsTable.skillLevel,
      })
      .from(dropinCourtPoolsTable)
      .where(eq(dropinCourtPoolsTable.dropinId, parseInt(dropinId)))
      .orderBy(dropinCourtPoolsTable.id);

    const pools = poolRows.map((p) => ({
      id: p.id,
      name: `Court ${p.courtId} — ${Array.isArray(p.ageGroup) ? p.ageGroup.join(", ") : p.ageGroup} (${p.skillLevel})`,
    }));

    res.json(pools);
  } catch (err) {
    console.error("[messaging] GET /pools error:", err);
    res.status(500).json({ error: "Failed to load pools" });
  }
});

// ── GET /messaging/history ────────────────────────────────────────────────────

router.get("/messaging/history", requireMessagingPermission, async (_req: Request, res): Promise<void> => {
  try {
    const rows = await db
      .select({
        id: broadcastMessagesTable.id,
        createdAt: broadcastMessagesTable.createdAt,
        subject: broadcastMessagesTable.subject,
        body: broadcastMessagesTable.body,
        channels: broadcastMessagesTable.channels,
        offeringType: broadcastMessagesTable.offeringType,
        eventId: broadcastMessagesTable.eventId,
        poolId: broadcastMessagesTable.poolId,
        statusFilter: broadcastMessagesTable.statusFilter,
        recipientCount: broadcastMessagesTable.recipientCount,
        senderFirstName: usersTable.firstName,
        senderLastName: usersTable.lastName,
        senderEmail: usersTable.email,
      })
      .from(broadcastMessagesTable)
      .leftJoin(usersTable, eq(usersTable.id, broadcastMessagesTable.createdBy))
      .orderBy(sql`${broadcastMessagesTable.createdAt} DESC`)
      .limit(50);

    res.json(rows);
  } catch (err) {
    console.error("[messaging] GET /history error:", err);
    res.status(500).json({ error: "Failed to load history" });
  }
});

// ── POST /messaging/send ──────────────────────────────────────────────────────

router.post("/messaging/send", requireMessagingPermission, async (req: Request, res): Promise<void> => {
  const authed = req as AuthedRequest;

  const {
    subject,
    body,
    channels,
    offeringType,
    eventId,
    eventType,
    poolId,
    statusFilter,
    individualIds,
  } = req.body as {
    subject: string;
    body: string;
    channels: string[];
    offeringType?: string;
    eventId?: number;
    eventType?: string;
    poolId?: number;
    statusFilter?: string;
    individualIds?: number[];
  };

  if (!subject?.trim() || !body?.trim()) {
    res.status(400).json({ error: "subject and body are required" });
    return;
  }

  // eventId with offeringType=all requires eventType to avoid cross-table ID collisions
  if (eventId && (!offeringType || offeringType === "all") && !eventType) {
    res.status(400).json({ error: "eventType is required when offeringType is 'all' and eventId is provided" });
    return;
  }

  if (!channels || channels.length === 0) {
    res.status(400).json({ error: "At least one channel is required" });
    return;
  }

  const validChannels = ["in_app", "email"] as const;
  const sanitizedChannels = channels.filter((c): c is NotificationChannel =>
    (validChannels as readonly string[]).includes(c),
  );

  if (sanitizedChannels.length === 0) {
    res.status(400).json({ error: "Invalid channels — must be in_app or email" });
    return;
  }

  try {
    const recipients = await resolveRecipients({
      offeringType: offeringType ?? undefined,
      eventId: eventId ?? undefined,
      eventType: eventType ?? undefined,
      poolId: poolId ?? undefined,
      statusFilter: statusFilter ?? "both",
      individualIds: individualIds?.length ? individualIds : undefined,
    });

    if (recipients.length === 0) {
      res.status(400).json({ error: "No recipients matched the selected filters" });
      return;
    }

    // Dispatch notifications and track per-recipient outcomes
    const dispatches = recipients.map((recipient) =>
      sendMultiChannelNotification(sanitizedChannels, {
        userId: recipient.id,
        type: "announcement",
        subject: subject.trim(),
        body: body.trim(),
      }),
    );

    const results = await Promise.allSettled(dispatches);
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - succeeded;

    // Audit log — record how many actually succeeded
    await db.insert(broadcastMessagesTable).values({
      createdBy: authed.dbUser!.id,
      subject: subject.trim(),
      body: body.trim(),
      channels: sanitizedChannels,
      offeringType: offeringType ?? null,
      eventId: eventId ?? null,
      poolId: poolId ?? null,
      statusFilter: statusFilter ?? "both",
      recipientCount: succeeded,
    });

    console.info(
      `[messaging] Broadcast sent by admin ${authed.dbUser!.id} → ${succeeded}/${recipients.length} succeeded, ${failed} failed via [${sanitizedChannels.join(", ")}]`,
    );

    res.json({ sent: succeeded, failed, total: recipients.length });
  } catch (err) {
    console.error("[messaging] POST /send error:", err);
    res.status(500).json({ error: "Failed to send broadcast" });
  }
});

export default router;
