---
name: Guardian child registration
description: How parent-on-behalf-of-child registration works in drop-ins and camps, and the spots.guardian_user_id column
---

# Guardian child registration

The `spots` table carries a nullable `guardian_user_id` FK (migration 0055) to record when a parent registered a child rather than themselves.

## How it works

- RSVP/checkout endpoints in `dropins.ts` accept an optional `playerUserId` body field.
- When `playerUserId` is provided and differs from the caller, the backend:
  1. Validates an approved `guardiansTable` link (`canRegister: true`)
  2. Age-checks the child against the pool's `ageGroup` via `checkPoolAgeEligibility`
  3. Creates the spot with `userId = playerUserId` and `guardianUserId = caller.id`
- Idempotency checks are on `targetUserId` (child's id), not the guardian's id.

## Frontend

- Reusable `ParticipantSelector` component (`artifacts/playon/src/components/participant-selector.tsx`) fetches `/api/me/guardian-links`, filters by age, auto-selects a single eligible child.
- Web camps page uses it in the `child_select` step.
- Web drop-in `CourtPoolCard`: non-adult pools show the selector before RSVP/checkout.
- Mobile `program/[id].tsx`: youth pool card press opens an inline picker; `handleDropinRsvp(poolId, playerUserId?)` passes the child's id.

## Gotcha

`ensure-schema.mjs` verification query has an `IN (...)` whitelist of tables — `spots` must be in that list or the required-column check will always fail even after the migration runs.

**Why:** The column is in `spots`, not in the original set of verified tables; easy to miss when adding new spot-level columns in the future.
