/**
 * Court availability: view schedule (fixtures + blocks) for a court/date range,
 * and manage blocked periods (maintenance, external bookings, etc.)
 */
import { Router, type IRouter } from "express";
import { db, courtsTable, courtAvailabilityTable, fixturesTable, dropinsTable, dropinCourtPoolsTable, spotsTable, campDaysTable, campsTable, auditLogTable, usersTable } from "@workspace/db";
import { eq, and, gte, lte, or, sql, inArray, isNull } from "drizzle-orm";
import { checkCourtConflict } from "../services/courtConflict.js";
import { requirePermission, type AuthedRequest } from "../middlewares/auth";

const router: IRouter = Router();

/**
 * GET /court-availability/calendar?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&courtId=N
 * Returns fixtures and blocked periods for the given date range (and optional court).
 */
router.get("/court-availability/calendar", requirePermission("canManageCourts"), async (req, res): Promise<void> => {
  const { startDate, endDate, courtId } = req.query as Record<string, string>;
  if (!startDate || !endDate) {
    res.status(400).json({ error: "startDate and endDate are required (YYYY-MM-DD)" });
    return;
  }
  const start = new Date(startDate);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  const parsedCourtId = courtId ? parseInt(courtId) : undefined;

  // Drop-in and camp overlaps use half-open range: booking.start < rangeEnd AND booking.end > rangeStart
  const [courts, fixtures, blocks, dropins, campDays] = await Promise.all([
    db.select().from(courtsTable).orderBy(courtsTable.id),
    // Fixtures in range, optional court filter
    db.select().from(fixturesTable).where(
      and(
        gte(fixturesTable.scheduledAt, start),
        lte(fixturesTable.scheduledAt, end),
        parsedCourtId ? eq(fixturesTable.courtId, parsedCourtId) : undefined,
      ),
    ).orderBy(fixturesTable.scheduledAt),
    // Court availability blocks overlapping the range
    db.select().from(courtAvailabilityTable).where(
      and(
        or(
          and(gte(courtAvailabilityTable.startsAt, start), lte(courtAvailabilityTable.startsAt, end)),
          and(lte(courtAvailabilityTable.startsAt, start), gte(courtAvailabilityTable.endsAt, start)),
        ),
        parsedCourtId ? eq(courtAvailabilityTable.courtId, parsedCourtId) : undefined,
      ),
    ).orderBy(courtAvailabilityTable.startsAt),
    // Drop-ins scheduled in this range (half-open overlap)
    db.select().from(dropinsTable).where(
      and(
        sql`${dropinsTable.startsAt} < ${end.toISOString()}::timestamptz`,
        sql`${dropinsTable.startsAt} + (${dropinsTable.durationMinutes} * interval '1 minute') > ${start.toISOString()}::timestamptz`,
        parsedCourtId ? eq(dropinsTable.courtId, parsedCourtId) : undefined,
      ),
    ).orderBy(dropinsTable.startsAt) as Promise<any[]>,
    // Camp days in this date range, joined with camps for court_id
    db.select({
      id: campDaysTable.id,
      campId: campDaysTable.campId,
      date: campDaysTable.date,
      startTime: campDaysTable.startTime,
      endTime: campDaysTable.endTime,
      notes: campDaysTable.notes,
      courtId: campsTable.courtId,
      campName: campsTable.name,
    })
      .from(campDaysTable)
      .innerJoin(campsTable, eq(campsTable.id, campDaysTable.campId))
      .where(
        and(
          gte(campDaysTable.date, startDate),
          lte(campDaysTable.date, endDate),
          parsedCourtId ? eq(campsTable.courtId, parsedCourtId) : undefined,
        ),
      )
      .orderBy(campDaysTable.date),
  ]);

  // Enrich drop-ins with live pool-based occupancy (spotsTotal / spotsTaken)
  let enrichedDropins = dropins;
  if (dropins.length > 0) {
    const dropinIds = dropins.map((d: any) => d.id);
    const pools = await db
      .select({ id: dropinCourtPoolsTable.id, dropinId: dropinCourtPoolsTable.dropinId, cap: dropinCourtPoolsTable.cap })
      .from(dropinCourtPoolsTable)
      .where(inArray(dropinCourtPoolsTable.dropinId, dropinIds));

    if (pools.length > 0) {
      const poolIds = pools.map((p) => p.id);
      const spotRows = await db
        .select({ poolId: spotsTable.poolId, count: sql<number>`count(*)` })
        .from(spotsTable)
        .where(
          and(
            inArray(spotsTable.poolId, poolIds),
            eq(spotsTable.status, "reserved"),
            eq(spotsTable.waitlisted, false),
          )
        )
        .groupBy(spotsTable.poolId);

      const spotsByPool = new Map<number, number>();
      for (const row of spotRows) spotsByPool.set(row.poolId!, Number(row.count));

      const aggByDropin = new Map<number, { spotsTotal: number; spotsTaken: number }>();
      for (const pool of pools) {
        const did = pool.dropinId!;
        const existing = aggByDropin.get(did) ?? { spotsTotal: 0, spotsTaken: 0 };
        existing.spotsTotal += pool.cap ?? 0;
        existing.spotsTaken += spotsByPool.get(pool.id) ?? 0;
        aggByDropin.set(did, existing);
      }

      // For dropins without pools, count flat-path spots live
      const dropinsWithPools = new Set(pools.map((p) => p.dropinId!));
      const nopoolIds = dropinIds.filter((id: number) => !dropinsWithPools.has(id));
      const flatSpotCounts = new Map<number, number>();
      if (nopoolIds.length) {
        const flatRows = await db
          .select({ entityId: spotsTable.entityId, count: sql<number>`count(*)` })
          .from(spotsTable)
          .where(
            and(
              eq(spotsTable.entityType, "dropin"),
              inArray(spotsTable.entityId, nopoolIds),
              isNull(spotsTable.poolId),
              eq(spotsTable.status, "reserved"),
              eq(spotsTable.waitlisted, false),
            )
          )
          .groupBy(spotsTable.entityId);
        for (const row of flatRows) flatSpotCounts.set(row.entityId!, Number(row.count));
      }

      enrichedDropins = dropins.map((d: any) => {
        const agg = aggByDropin.get(d.id);
        return {
          ...d,
          spotsTotal: agg ? agg.spotsTotal : d.maxPlayers,
          spotsTaken: agg ? agg.spotsTaken : (flatSpotCounts.get(d.id) ?? 0),
        };
      });
    } else {
      // No pools configured — count flat-path spots live from the spots table
      const flatRows = await db
        .select({ entityId: spotsTable.entityId, count: sql<number>`count(*)` })
        .from(spotsTable)
        .where(
          and(
            eq(spotsTable.entityType, "dropin"),
            inArray(spotsTable.entityId, dropinIds),
            isNull(spotsTable.poolId),
            eq(spotsTable.status, "reserved"),
            eq(spotsTable.waitlisted, false),
          )
        )
        .groupBy(spotsTable.entityId);
      const flatSpotCounts = new Map<number, number>();
      for (const row of flatRows) flatSpotCounts.set(row.entityId!, Number(row.count));

      enrichedDropins = dropins.map((d: any) => ({
        ...d,
        spotsTotal: d.maxPlayers,
        spotsTaken: flatSpotCounts.get(d.id) ?? 0,
      }));
    }
  }

  res.json({ courts, fixtures, blocks, dropins: enrichedDropins, campDays });
});

/** GET /court-availability/blocks — list all blocks (optionally filtered by courtId) */
router.get("/court-availability/blocks", requirePermission("canManageCourts"), async (req, res): Promise<void> => {
  const { courtId } = req.query as Record<string, string>;
  const rows = courtId
    ? await db.select().from(courtAvailabilityTable).where(eq(courtAvailabilityTable.courtId, parseInt(courtId))).orderBy(courtAvailabilityTable.startsAt)
    : await db.select().from(courtAvailabilityTable).orderBy(courtAvailabilityTable.startsAt);
  res.json(rows);
});

/** POST /court-availability/blocks — mark a court unavailable for a time range */
router.post("/court-availability/blocks", requirePermission("canManageCourts"), async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const { courtId, startsAt, endsAt, reason, notes } = req.body as {
    courtId: number;
    startsAt: string;
    endsAt: string;
    reason?: string;
    notes?: string;
  };

  if (!courtId || !startsAt || !endsAt) {
    res.status(400).json({ error: "courtId, startsAt, and endsAt are required" });
    return;
  }

  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (end <= start) {
    res.status(400).json({ error: "endsAt must be after startsAt" });
    return;
  }

  const [court] = await db.select().from(courtsTable).where(eq(courtsTable.id, courtId));
  if (!court) {
    res.status(404).json({ error: "Court not found" });
    return;
  }

  // Warn about any existing bookings that this block will overlap (admin is creating the block
  // intentionally, so we allow it but surface the conflicts in the response).
  const existingConflict = await checkCourtConflict(courtId, start, end);

  const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, authed.clerkUserId));
  const [block] = await db.insert(courtAvailabilityTable).values({
    courtId,
    startsAt: start,
    endsAt: end,
    reason: reason ?? null,
    notes: notes ?? null,
    blockedByUserId: dbUser?.id ?? null,
  }).returning();

  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "court_block_created",
    entityType: "court",
    entityId: String(courtId),
    notes: JSON.stringify({ blockId: block.id, reason, startsAt, endsAt }),
  });

  res.status(201).json({
    block,
    warning: existingConflict.conflict
      ? `Block created, but there is a conflict: ${existingConflict.reason}`
      : null,
  });
});

/** DELETE /court-availability/blocks/:id — remove a court block */
router.delete("/court-availability/blocks/:id", requirePermission("canManageCourts"), async (req: any, res): Promise<void> => {
  const authed = req as AuthedRequest;
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid block id" });
    return;
  }
  const [deleted] = await db.delete(courtAvailabilityTable).where(eq(courtAvailabilityTable.id, id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Block not found" });
    return;
  }
  await db.insert(auditLogTable).values({
    actorClerkId: authed.clerkUserId,
    action: "court_block_deleted",
    entityType: "court",
    entityId: String(deleted.courtId),
    notes: JSON.stringify({ blockId: id }),
  });
  res.sendStatus(204);
});

export default router;
