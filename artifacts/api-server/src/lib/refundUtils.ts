/**
 * Shared refund/credit computation utilities.
 *
 * computeRefundableBase — single source of truth for refundable amount math.
 *   refundableBase = gross - serviceFee - policyNonRefundable
 *   serviceFee is ALWAYS excluded; policyNonRefundable is an additional floor.
 *   Both refundPolicies.ts (manual) and cancellationEngine.ts (auto) must use this.
 */

export interface RefundableBaseOpts {
  grossPaid: number;
  serviceFeeAmount: number;
  policyNonRefundableAmount: number;
}

export function computeRefundableBase(opts: RefundableBaseOpts): number {
  const { grossPaid, serviceFeeAmount, policyNonRefundableAmount } = opts;
  return Math.max(0, grossPaid - serviceFeeAmount - policyNonRefundableAmount);
}
