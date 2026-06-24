---
name: Drop-in template architecture
description: Template-first lazy-materialization system for drop-in sessions — key constraints and path choices
---

## The rule
New drop-in creation uses `dropin_templates` + `dropin_template_pools`. Occurrences are computed on the fly from a JSONB `recurrence_rule`. Concrete `dropin_occurrences` rows are materialized only on registration or within 24h of start.

## API paths
- New system: `/dropin-templates/*` and `/dropin-occurrences/*` (hyphenated)
- Old system: `/dropins/templates/*` (slash — belongs to `sessionTemplatesTable` / old pre-generation scheduler)

**Why:** The old `dropins.ts` router owns `/dropins/templates/*` for the legacy session-template pre-generation system. Using the same path caused Express to shadow the new routes since `dropinsRouter` mounts before `dropinTemplatesRouter`. Hyphenated paths avoid the collision entirely.

## How to apply
- Any new endpoint that touches `dropin_templates` / `dropin_template_pools` / `dropin_occurrences` must live under `/dropin-templates/` or `/dropin-occurrences/` in `routes/dropinTemplates.ts`.
- Frontend queries use `/api/dropin-templates`, `/api/dropin-occurrences`, `/api/dropin-presets`.
- Admin wizard routes: `/admin/dropins/new` (create) and `/admin/dropins/:id/edit` (edit). These are registered BEFORE the wildcard `/admin/dropins/:id/*` routes in App.tsx.
- Player occurrence detail route: `/dropins/occ/:templateId/:date` — must be registered BEFORE `/dropins/:id` in App.tsx to prevent `:id` capturing the segment "occ".

## Critical schema constraint
`dropinTemplatePoolsTable` does NOT have a `registrationOpen` column. Registration open/close per occurrence is controlled exclusively via the `dropin_occurrence_overrides` table (field="registrationOpen", value=true/false). Any code checking per-pool registration status must query `dropin_occurrence_overrides`, not the template pool row.

## Registration-time materialization chain
When a player RSVPs for a new-style occurrence, materialize in order:
1. `dropin_occurrences` — keyed by (templateId, occurrenceDate)
2. `dropins` (legacy) — keyed by (templateId, startsAt::timestamptz); used as `entityId` for spots
3. `dropin_court_pools` (legacy) — keyed by (dropinId, courtId); used as `poolId` for spots

Spots are inserted with `entityType="dropin"`, `entityId=dropin.id`, `poolId=courtPool.id` — the existing payment/waitlist/check-in code continues to work unchanged via these legacy IDs.

## Forward-fork boundary rule
In PATCH /dropin-templates/:id with scope=forward: old template `endDate` must be set to one day BEFORE `forkFromDate` (not equal to it). Equal causes the pivot date to be owned by both templates.

## 5 new tables (migration 0080)
- `dropin_templates` — master record (name, sport, recurrence_rule JSONB, draft/published flags)
- `dropin_template_pools` — per-court pools (cap, price, age_group[], early_bird_pricing JSONB)
- `dropin_occurrences` — materialized occurrence rows (lazy; status: upcoming/skipped/cancelled/completed)
- `dropin_occurrence_overrides` — per-occurrence field overrides (cap, price, registrationOpen)
- `dropin_pool_presets` — saved pool configs per user

## Recurrence rule shape
```json
{
  "type": "one_time" | "recurring",
  "startDate": "YYYY-MM-DD",
  "startTime": "HH:MM",
  "durationMinutes": 120,
  "dayOfWeek": 5,
  "intervalNum": 1,
  "intervalUnit": "week" | "month",
  "endCondition": "never" | "on_date" | "after_n",
  "endDate": null,
  "endAfterN": null,
  "skippedDates": []
}
```
