---
name: League divisions layer
description: Key enforcement rules and behavioral decisions for the divisions model in leagues
---

# League divisions layer

## Rule
Leagues are now containers; `league_divisions` is the real competitive unit. Every team, fixture, and standings row carries a `division_id` FK. Single-division leagues are backward-compatible — GET /standings returns a flat array. Multi-division leagues return `{type:"grouped", divisions:[…]}`.

**Why:** Divisions support age-group or skill-tier splits within one league without requiring separate league records.

## Multi-division enforcement (critical)
- `POST /leagues/:id/teams`, `POST /leagues/:id/register`, and `POST /leagues/:id/fixtures/generate` all **reject** requests that omit `divisionId` when the league has >1 division. Single-division leagues default to the only division.
- Division ownership is always validated: if supplied `divisionId.leagueId !== leagueId`, return 400.
- `DELETE /leagues/:id/divisions/:divId` is blocked if any teams/fixtures/standings exist in that division (prevents orphaned rows). Blocked if it is the last division.

## Age-group eligibility on registration
- `POST /leagues/:id/register` accepts optional `teamAgeGroup` string. If the selected division has non-empty `ageGroups[]` and `teamAgeGroup` is supplied, the server enforces the match (400 if mismatch).
- UI collects age group via a filter chip row and auto-narrows the division picker.

## Waitlist promotion (auto + manual)
- Both FIFO auto-promotion (status change path) and manual promotion (`POST /leagues/:id/waitlist/:regId/promote`) assign the first division (by `divisionOrder`) to the promoted team and include `divisionId` in the standings insert.

## How to apply
- Migrations 0056–0059 in `lib/db/src/ensure-schema.mjs`.
- `recomputeStandings(leagueId, divisionId?)` recomputes per-division when divisionId is known; falls back to league-wide otherwise.
- Admin panel `FixturesPanel` has a division picker that appears only for multi-division leagues; picker is required before generation.
- Public `RegisterTab` shows age-group filter + division picker when `divisions.length > 1`.
- `LeagueFormModal` shows read-only age-group summary (union of all division ageGroups) when editing a multi-division league.
