import { db, revenueRecordsTable, facilitySplitRulesTable, serviceFeeConfigsTable, auditLogTable } from "@workspace/db";
import { eq, and, isNull, isNotNull, sql } from "drizzle-orm";

export interface RevenueInput {
  entityType: string;
  entityId: number | null;
  category: string;
  grossAmount: number;
  /** If provided, used as an idempotency key — revenue is only recorded once per paymentId */
  paymentId?: number | null;
  /** Payment method determines whether service fee applies */
  paymentMethod: "card" | "external";
  /** If provided, uses this split rule. Otherwise finds the latest active rule for the venue/offering. */
  splitRuleId?: number | null;
  /** Venue to find split rule for (if splitRuleId not provided) */
  venueId?: number | null;
  /** Optional offering scope for split rule lookup */
  offeringType?: string | null;
  offeringId?: number | null;
  description?: string | null;
  revenueDate?: string | null;
  actorClerkId?: string | null;
}

export interface RevenueResult {
  grossAmount: number;
  facilityAmount: number;
  serviceFeeAmount: number;
  playonNet: number;
  splitRuleId: number | null;
  feeConfigId: number | null;
}

/**
 * Compute how a gross payment is split between facility, service fee, and PlayOn net.
 *
 * Split logic:
 *   percentage: facilityAmount = gross * (facilityPct / 100)
 *   flat:       facilityAmount = flatFee (per event)
 *   hybrid:     facilityAmount = flatFee + (gross - flatFee) * (facilityPct / 100)
 *
 * Service fee logic:
 *   serviceFeeAmount = gross * (feePercent / 100), clamped to [minFeeAmount, maxFeeAmount]
 *   Only applied when appliesToCard (card) or appliesToExternal (external) is true.
 *
 * playonNet = gross - facilityAmount
 * (serviceFeeAmount is additional revenue flowing entirely to PlayOn; it is stored for
 *  reporting purposes but is NOT deducted from PlayOn's net)
 */
export async function computeRevenueSplit(input: RevenueInput): Promise<RevenueResult> {
  const { grossAmount, paymentMethod } = input;

  // ── Resolve split rule ──────────────────────────────────────────────────────
  let splitRule: typeof facilitySplitRulesTable.$inferSelect | null = null;
  if (input.splitRuleId) {
    const [r] = await db.select().from(facilitySplitRulesTable)
      .where(eq(facilitySplitRulesTable.id, input.splitRuleId));
    splitRule = r ?? null;
  } else {
    const baseConditions = [
      eq(facilitySplitRulesTable.isLatest, true),
      eq(facilitySplitRulesTable.isActive, true),
    ];

    if (input.offeringType && input.offeringId) {
      // First: try to find an event-specific rule (venueId may be null for events without direct venue association)
      if (input.venueId) {
        // Prefer venue-scoped offering rule
        const [r] = await db.select().from(facilitySplitRulesTable)
          .where(and(
            ...baseConditions,
            eq(facilitySplitRulesTable.venueId, input.venueId),
            eq(facilitySplitRulesTable.offeringType, input.offeringType),
            eq(facilitySplitRulesTable.offeringId, input.offeringId),
          ));
        splitRule = r ?? null;
      }
      if (!splitRule) {
        // Fall back to offering-scoped rule without venue constraint
        const [r] = await db.select().from(facilitySplitRulesTable)
          .where(and(
            ...baseConditions,
            eq(facilitySplitRulesTable.offeringType, input.offeringType),
            eq(facilitySplitRulesTable.offeringId, input.offeringId),
          ));
        splitRule = r ?? null;
      }
    }

    if (!splitRule && input.venueId) {
      // Fall back to venue-level default rule (no offering scope)
      const [r] = await db.select().from(facilitySplitRulesTable)
        .where(and(
          ...baseConditions,
          eq(facilitySplitRulesTable.venueId, input.venueId),
          isNull(facilitySplitRulesTable.offeringType),
          isNull(facilitySplitRulesTable.offeringId),
        ));
      splitRule = r ?? null;
    }
  }

  // ── Compute facility amount ─────────────────────────────────────────────────
  let facilityAmount = 0;
  if (splitRule) {
    const facilityPct = splitRule.facilityPct != null ? Number(splitRule.facilityPct) : 0;
    const flatFee = splitRule.flatFee != null ? Number(splitRule.flatFee) : 0;
    switch (splitRule.splitType) {
      case "percentage":
        facilityAmount = grossAmount * (facilityPct / 100);
        break;
      case "flat":
        facilityAmount = Math.min(flatFee, grossAmount);
        break;
      case "hybrid":
        facilityAmount = Math.min(flatFee + (grossAmount - flatFee) * (facilityPct / 100), grossAmount);
        break;
    }
    facilityAmount = Math.max(0, facilityAmount);
  }

  // ── Resolve active service fee config ───────────────────────────────────────
  let feeConfig: typeof serviceFeeConfigsTable.$inferSelect | null = null;
  try {
    const [r] = await db.select().from(serviceFeeConfigsTable)
      .where(eq(serviceFeeConfigsTable.isActive, true));
    feeConfig = r ?? null;
  } catch {
    // Table may not yet exist (pre-migration). Fall through to in-memory default below.
    feeConfig = null;
  }

  // If no active config found in DB (e.g. fresh deploy before seed ran), use in-memory default
  // matching the seeded row: 3% card-only, no min/max clamp.
  if (!feeConfig) {
    feeConfig = {
      id: -1,
      name: "Default Service Fee",
      feePercent: "3.00",
      appliesToCard: true,
      appliesToExternal: false,
      nonRefundable: true,
      minFeeAmount: null,
      maxFeeAmount: null,
      notes: null,
      createdByClerkId: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as typeof serviceFeeConfigsTable.$inferSelect;
  }

  // ── Compute service fee ─────────────────────────────────────────────────────
  let serviceFeeAmount = 0;
  if (feeConfig) {
    const applies = paymentMethod === "card" ? feeConfig.appliesToCard : feeConfig.appliesToExternal;
    if (applies) {
      serviceFeeAmount = grossAmount * (Number(feeConfig.feePercent) / 100);
      if (feeConfig.minFeeAmount != null) serviceFeeAmount = Math.max(serviceFeeAmount, Number(feeConfig.minFeeAmount));
      if (feeConfig.maxFeeAmount != null) serviceFeeAmount = Math.min(serviceFeeAmount, Number(feeConfig.maxFeeAmount));
    }
  }

  const playonNet = grossAmount - facilityAmount;

  return {
    grossAmount,
    facilityAmount: round2(facilityAmount),
    serviceFeeAmount: round2(serviceFeeAmount),
    playonNet: round2(playonNet),
    splitRuleId: splitRule?.id ?? null,
    feeConfigId: feeConfig && feeConfig.id > 0 ? feeConfig.id : null,
  };
}

/**
 * Compute AND persist a RevenueRecord row plus an audit log entry.
 * Returns the inserted record.
 */
export async function recordRevenue(
  input: RevenueInput,
): Promise<typeof revenueRecordsTable.$inferSelect> {
  // Durable idempotency: if a paymentId is provided, check if a revenue record
  // already exists for it. If so, return the existing record without inserting again.
  if (input.paymentId != null) {
    const [existing] = await db.select().from(revenueRecordsTable)
      .where(eq(revenueRecordsTable.paymentId, input.paymentId));
    if (existing) return existing;
  }

  const computed = await computeRevenueSplit(input);

  // Use raw SQL INSERT … ON CONFLICT DO NOTHING to explicitly honor the partial unique index
  // revenue_records_payment_id_uq (payment_id) WHERE payment_id IS NOT NULL.
  // Drizzle's .onConflictDoNothing() without an explicit target may not correctly resolve
  // partial unique indexes in all versions — raw SQL avoids ambiguity.
  const revenueDate = input.revenueDate ?? new Date().toISOString().slice(0, 10);
  const rawResult = await db.execute(sql`
    INSERT INTO revenue_records
      (entity_type, entity_id, payment_id, category, gross_amount, facility_amount,
       service_fee_amount, playon_net, revenue_date, split_rule_id, description)
    VALUES
      (${input.entityType}, ${input.entityId ?? null}, ${input.paymentId ?? null},
       ${input.category}, ${String(computed.grossAmount)}, ${String(computed.facilityAmount)},
       ${String(computed.serviceFeeAmount)}, ${String(computed.playonNet)},
       ${revenueDate}::date, ${computed.splitRuleId ?? null}, ${input.description ?? null})
    ON CONFLICT (payment_id) WHERE payment_id IS NOT NULL DO NOTHING
    RETURNING id
  `);

  const rows = (rawResult as any).rows ?? rawResult;
  const insertedId: number | undefined = Array.isArray(rows) && rows.length > 0 ? rows[0].id : undefined;

  // Re-read the winner row (either our insert or the concurrent winner)
  let record: typeof revenueRecordsTable.$inferSelect;
  if (insertedId != null) {
    const [r] = await db.select().from(revenueRecordsTable).where(eq(revenueRecordsTable.id, insertedId));
    if (!r) throw new Error("Revenue record insert succeeded but row not found");
    record = r;
  } else if (input.paymentId != null) {
    const [existing] = await db.select().from(revenueRecordsTable)
      .where(eq(revenueRecordsTable.paymentId, input.paymentId));
    if (!existing) throw new Error("Revenue record ON CONFLICT DO NOTHING — existing row not found");
    record = existing;
  } else {
    throw new Error("Revenue record insert returned no rows and no paymentId to re-read by");
  }

  if (input.actorClerkId) {
    await db.insert(auditLogTable).values({
      actorClerkId: input.actorClerkId,
      action: "create",
      entityType: "revenue_record",
      entityId: String(record.id),
      after: JSON.stringify(record),
      notes: `Gross $${computed.grossAmount} → facility $${computed.facilityAmount}, svc fee $${computed.serviceFeeAmount}, net $${computed.playonNet}`,
    });
  }

  return record;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
