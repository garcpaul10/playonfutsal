---
name: Two-tier event model — session shell + pools
description: Rationale and implementation status of the decision to make pool.cap the sole capacity control for drop-in sessions.
---

# Two-Tier Event Model: Session Shell + Pools

## The Rule
A drop-in session is a *shell* (name, description, age groups, gender, price, timing, cancellation window, registration settings). All operational capacity and court assignment lives in **court pools** (`dropin_court_pools`), not on the session row.

`dropins.maxPlayers` is a legacy column kept nullable/ignored for backward compatibility. The capacity shown to players and used for registration gating is always derived from `SUM(dropin_court_pools.cap)` for pools belonging to the session.

**Why:** The old model had `maxPlayers` on the session and `cap` on each pool, causing confusion about which value actually controlled registration limits. Pools are more granular (per-court, per-age-group, per-skill-level), so they are the correct home for capacity.

## Current Status (as of 2026-06-08)
- **Drop-ins:** Two-tier model is fully implemented.
  - Session form: `maxPlayers`, `courtId`, `skillLevel` removed; form reorganized into General + Logistics sections.
  - API `POST /dropins` and `PATCH /dropins/:id`: no longer accept or write `maxPlayers`; `courtId` defaults to 1 if omitted.
  - Admin UI: inline amber warning on session cards with no pools prompts admin to add at least one pool.
  - Player-facing registration: reads capacity from pool `cap`; falls back to `dropins.maxPlayers` + `dropins.playersRegistered` for sessions with no pools (backward compat).
- **Leagues, tournaments, camps:** NOT yet converted. Track as separate future work.

## How to Apply
- When adding new event types (leagues, tournaments, camps), follow the same pattern: keep the parent event as a general-info shell; put court/capacity/skill in sub-pools.
- When computing capacity for display or gating, always check for pools first and fall back to flat fields only when the pool set is empty.
