---
name: Age group waivers system
description: USYS eligibility enforcement and guardian waiver request flow
---

## Rule
All registration paths (drop-ins, camps, leagues, tournaments) now enforce USYS
age eligibility via `checkUsysAgeEligibility` in `lib/usysAgeEligibility.ts`.
Each path also fetches `status="approved"` rows from `age_group_waivers` for the
player and passes them as the `waivedGroups` parameter, allowing approved players
to bypass the normal USYS bracket.

**Why:** USYS uses a July 31 cutoff date (not calendar year) and two-year age bands
(U8 = ages 7–8, U9 = 8–9, etc.). The old per-route helpers used incorrect single-year
ranges with no waiver support.

**How to apply:**
- When adding a new event type with age gating, import `checkUsysAgeEligibility`
  from `../lib/usysAgeEligibility` and fetch approved waivers via the pattern in
  `getPlayerWaivedGroups(playerId)` (see dropins.ts or camps.ts for reference).
- Waiver table: `age_group_waivers` (migration 0063). Guardian submits via
  `POST /age-group-waivers`. Admin reviews via `PATCH /age-group-waivers/:id`
  (requires `canManageAgeGroups` permission).
- Admin UI: `/admin/age-group-waivers` (registered in App.tsx + admin-nav-config.ts).
- Guardian UI: `child-detail.tsx` has "Age Group Waivers" section with request dialog.
