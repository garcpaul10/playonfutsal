---
name: Courts venueId + split rule hierarchy
description: courts.venue_id column added so courts can be associated with venues; computeRevenueSplit finds event-specific rules without requiring venueId
---

## Rule
`courts.venue_id` (integer, nullable) was added via migration 0054. Admin pages pass `court?.venueId` to `EventSplitPanel` so venue-default fallback can be displayed.

`computeRevenueSplit` lookup hierarchy (in order):
1. Explicit `splitRuleId` → use it directly
2. If `offeringType + offeringId` provided, venue-scoped offering rule (matching `venueId`)
3. If still no match, offering-scoped rule without venue constraint (allows rules with `venueId=null`)
4. If still no match and `venueId` is provided, venue-level default rule (no offering scope)
5. No rule → zero facility split

**Why:** Event-specific overrides created for leagues/camps/drop-ins (which may lack a court venueId) used to be invisible to the compute service because the old code only entered the lookup branch when `venueId` was present. Now, rules scoped by `offeringType+offeringId` are found regardless of venue context.

**How to apply:** When recording revenue for events, always pass `offeringType` and `offeringId` to `computeRevenueSplit` so event-specific overrides can be resolved. Pass `venueId` as well when available for venue-default fallback.
