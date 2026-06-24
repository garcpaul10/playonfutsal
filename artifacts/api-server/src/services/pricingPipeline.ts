/**
 * Shared server-side pricing pipeline used by both checkout and installment plan creation.
 *
 * Responsibilities:
 *  - Fetch offering base price (with pricingRuleId)
 *  - Apply PricingRule modifiers: early-bird, late fee, sibling discount
 *  - Apply discount/promo code
 *
 * These are the same computations performed in checkout.ts, factored out so installment
 * plans charge the identical authoritative total as a normal checkout session.
 */
import {
  db, leaguesTable, campsTable, dropinsTable, tournamentsTable,
  pricingRulesTable, discountCodesTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";

// ── Offering lookup ──────────────────────────────────────────────────────────

export interface OfferingInfo {
  name: string;
  basePrice: number;
  category: string;
  pricingRuleId?: number | null;
}

export async function getOfferingInfo(programType: string, programId: number): Promise<OfferingInfo> {
  if (programType === "league") {
    const [l] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, programId));
    if (!l) throw new Error("League not found");
    return { name: l.name, basePrice: Number(l.registrationPrice ?? 0), category: "league", pricingRuleId: l.pricingRuleId };
  } else if (programType === "camp") {
    const [c] = await db.select().from(campsTable).where(eq(campsTable.id, programId));
    if (!c) throw new Error("Camp not found");
    return { name: c.name, basePrice: Number(c.price ?? 0), category: "camp", pricingRuleId: c.pricingRuleId };
  } else if (programType === "drop_in") {
    const [d] = await db.select().from(dropinsTable).where(eq(dropinsTable.id, programId));
    if (!d) throw new Error("Drop-in not found");
    return { name: d.name, basePrice: Number(d.price ?? 0), category: "drop_in" };
  } else if (programType === "tournament") {
    const [t] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, programId));
    if (!t) throw new Error("Tournament not found");
    return { name: t.name, basePrice: Number(t.teamPrice ?? 0), category: "tournament" };
  }
  throw new Error(`Unknown program type: ${programType}`);
}

// ── PricingRule modifiers ────────────────────────────────────────────────────

export interface PricingModifiersResult {
  adjustedPrice: number;
  modifiers: string[];
}

export async function applyPricingRuleModifiers(opts: {
  basePrice: number;
  pricingRuleId?: number | null;
  category: string;
  /** Server-derived sibling number — 1 (first child) or 2+ (sibling discount applies). Never trust client. */
  serverSiblingNumber?: number;
}): Promise<PricingModifiersResult> {
  let price = opts.basePrice;
  const modifiers: string[] = [];

  if (!opts.pricingRuleId) return { adjustedPrice: price, modifiers };

  const [rule] = await db.select().from(pricingRulesTable).where(eq(pricingRulesTable.id, opts.pricingRuleId));
  if (!rule) return { adjustedPrice: price, modifiers };

  const now = new Date();

  if (rule.earlyBirdPrice != null && rule.earlyBirdCutoff != null && now < new Date(rule.earlyBirdCutoff)) {
    price = Math.min(price, Number(rule.earlyBirdPrice));
    modifiers.push(`Early-bird price: $${rule.earlyBirdPrice}`);
  }

  if (rule.lateFee != null && rule.earlyBirdCutoff != null && now >= new Date(rule.earlyBirdCutoff)) {
    price += Number(rule.lateFee);
    modifiers.push(`Late fee: +$${rule.lateFee}`);
  }

  if (opts.category === "camp" && rule.siblingDiscountPct != null && (opts.serverSiblingNumber ?? 1) > 1) {
    const discountPct = Number(rule.siblingDiscountPct);
    const discount = Math.round(price * (discountPct / 100) * 100) / 100;
    price -= discount;
    modifiers.push(`Sibling discount (${discountPct}%): -$${discount}`);
  }

  return { adjustedPrice: Math.max(0, Math.round(price * 100) / 100), modifiers };
}

// ── Discount code ────────────────────────────────────────────────────────────

export interface DiscountResult {
  discountAmount: number;
  discountCodeId: number;
}

export async function applyDiscountCode(
  code: string,
  basePrice: number,
  programType: string,
  programId: number,
): Promise<DiscountResult> {
  const [dc] = await db.select().from(discountCodesTable).where(
    and(eq(discountCodesTable.code, code.toUpperCase()), eq(discountCodesTable.isActive, true))
  );
  if (!dc) throw new Error("Invalid or inactive discount code");
  if (dc.maxUses != null && dc.timesUsed >= dc.maxUses) throw new Error("Discount code has reached its usage limit");
  const now = new Date();
  if (dc.validFrom && new Date(dc.validFrom) > now) throw new Error("Discount code is not yet active");
  if (dc.validUntil && new Date(dc.validUntil) < now) throw new Error("Discount code has expired");
  if (dc.minOrderAmount && basePrice < Number(dc.minOrderAmount)) throw new Error(`Minimum order amount of $${dc.minOrderAmount} required`);

  if (dc.applicableTo !== "all") {
    const typeGates = ["league", "camp", "drop_in", "tournament"];
    if (typeGates.includes(dc.applicableTo) && dc.applicableTo !== programType) {
      throw new Error(`Discount code is only valid for ${dc.applicableTo.replace("_", " ")} registrations`);
    }
    if (dc.applicableTo === "specific") {
      if (dc.entityType && dc.entityType !== programType) throw new Error("Discount code not applicable to this offering type");
      if (dc.entityId && dc.entityId !== programId) throw new Error("Discount code not applicable to this specific offering");
    }
  }

  let discountAmount = 0;
  if (dc.discountType === "percent") {
    discountAmount = basePrice * (Number(dc.discountValue) / 100);
  } else {
    discountAmount = Math.min(Number(dc.discountValue), basePrice);
  }
  return { discountAmount: Math.round(discountAmount * 100) / 100, discountCodeId: dc.id };
}

// ── Full pricing pipeline ────────────────────────────────────────────────────

export interface PricingPipelineResult {
  basePrice: number;
  adjustedPrice: number;
  discountAmount: number;
  finalPrice: number;
  discountCodeId: number | null;
  modifiers: string[];
}

/**
 * Run the complete server-side pricing pipeline for an offering.
 * Produces the same total that POST /checkout/session would charge.
 *
 * @param serverSiblingNumber  Derived server-side from guardiansTable; do NOT pass client value.
 */
export async function computeAuthoritativeTotal(opts: {
  programType: string;
  programId: number;
  discountCode?: string;
  serverSiblingNumber?: number;
}): Promise<PricingPipelineResult> {
  const offering = await getOfferingInfo(opts.programType, opts.programId);
  let basePrice = offering.basePrice;

  const { adjustedPrice, modifiers } = await applyPricingRuleModifiers({
    basePrice,
    pricingRuleId: offering.pricingRuleId,
    category: offering.category,
    serverSiblingNumber: opts.serverSiblingNumber,
  });

  let discountAmount = 0;
  let discountCodeId: number | null = null;
  if (opts.discountCode) {
    const result = await applyDiscountCode(opts.discountCode, adjustedPrice, opts.programType, opts.programId);
    discountAmount = result.discountAmount;
    discountCodeId = result.discountCodeId;
  }

  const finalPrice = Math.max(0, Math.round((adjustedPrice - discountAmount) * 100) / 100);

  return {
    basePrice,
    adjustedPrice,
    discountAmount,
    finalPrice,
    discountCodeId,
    modifiers,
  };
}
