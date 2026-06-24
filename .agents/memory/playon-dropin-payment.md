---
name: PlayOn drop-in payment flow
description: Payment-first spot reservation flow for paid drop-in pools
---

## Rule
For paid pools (price > 0, not full): use POST /dropins/pools/:poolId/checkout → Stripe → webhook creates spot.
For free pools ($0) or waitlist: use POST /dropins/pools/:poolId/rsvp directly.

**Why:** Code review required payment-first for paid pools. RSVP-first created unpaid spots that users might abandon.

## How it works
1. Frontend `checkout` mutation calls `/dropins/pools/:poolId/checkout`
2. Backend creates Stripe session with metadata: `{ programType: "drop_in", programId, poolId, clerkUserId }`
3. Frontend redirects to `session.url`
4. On `checkout.session.completed`, `handleCheckoutComplete` in `stripeWebhook.ts` checks for `meta.poolId`
5. If present, creates spot in `spotsTable` with `status: "reserved", paymentStatus: "paid_inapp"` (idempotent)

## Key files
- `artifacts/api-server/src/routes/dropins.ts` — POST /dropins/pools/:poolId/checkout endpoint
- `artifacts/api-server/src/routes/stripeWebhook.ts` — handleCheckoutComplete, drop-in spot creation
- `artifacts/playon/src/pages/dropins/[id].tsx` — PoolCard checkout mutation + button logic
