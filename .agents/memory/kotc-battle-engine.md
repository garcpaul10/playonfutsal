---
name: Kings of The Court Battle Engine
description: Architecture decisions and integration patterns for the KotC event system
---

# Kings of The Court (KotC) Battle Engine

## Core Architecture

**Season → Battle → Registration → Queue → Game Card** is the lifecycle.

- `kotc_seasons` — configuration hub (sport, team_size, win_target, lives_required, grace_period_seconds, etc.)
- `kotc_battles` — individual events within a season (multi-court supported via court_count)
- `kotc_battle_mods` — moderator assignment per court per battle
- `kotc_teams` + `kotc_team_players` — team roster; captain creates, invites players
- `kotc_battle_registrations` — team registers for a specific battle + court
- `kotc_rotation_queues` — live queue per court; positions shift after each game
- `kotc_game_cards` — created by QR scan, stores winner/loser, triggers life deduction
- `kotc_life_ledger` — immutable append-only audit trail of every life change

## QR Code System

Team QR codes use format `kotc-team-${randomUUID()}` stored in `kotc_teams.qr_code` (unique). This is a custom string — NOT using the existing `qrCodesTable` enum to avoid enum migration complexity.

## Rules Acknowledgment Gate

Before a game card can be created via QR scan, BOTH captains must have `rules_acknowledged_at` set on their `kotc_team_players` row. The scan endpoint enforces this and returns 400 if either captain hasn't acknowledged.

## Lives Grace Timer

Implemented as `setTimeout` in the game result endpoint (Phase 1 simplicity). When a team hits 0 lives:
1. Queue entry → `pending_purchase` status, `grace_expires_at` set
2. setTimeout fires after `season.gracePeriodSeconds`
3. If team still has 0 lives, queue → `bowed_out`

Phase 2 should replace setTimeout with a durable job queue.

## API Routes

All under `/kotc/*`:
- Seasons: `GET/POST /kotc/seasons`, `GET/PATCH /kotc/seasons/:id`
- Battles: `GET/POST /kotc/seasons/:seasonId/battles`, `GET/PATCH /kotc/battles/:id`
- Mods: `POST/DELETE /kotc/battles/:id/mods`
- Teams: `GET/POST /kotc/seasons/:seasonId/teams`, `GET/PATCH /kotc/teams/:id`
- Roster: `/kotc/teams/:id/invite`, `/kotc/team-invites/:id/accept|decline`
- Battle flow: `POST /kotc/battles/:battleId/start`, `POST /kotc/battles/:battleId/scan`
- Game result: `POST /kotc/game-cards/:gameCardId/result`
- Admin: `POST /kotc/teams/:teamId/credit-lives`
- Leaderboard: `GET /kotc/seasons/:seasonId/leaderboard`

## Web Routes

- `/admin/kings-of-the-court` — Admin season/battle/team management
- `/battle-mod/:battleId` — Battle Moderator queue view + QR scan UI
- `/kotc/teams/:teamId` — Captain portal (roster, battles, QR, lives, rules)
- `/kotc/leaderboard` — Public leaderboard with season selector

## Mobile

`artifacts/playon-mobile/app/leaderboard.tsx` — KotC-native leaderboard replacing the previous placeholder, with season selector, standings table, lives display, hot streak indicator.

## Migration

Migration 0090 in `lib/db/src/ensure-schema.mjs`. The verification query's IN clause must list all KotC tables (`kotc_seasons`, `kotc_battles`, `kotc_battle_mods`, `kotc_teams`, `kotc_team_players`, `kotc_battle_registrations`, `kotc_rotation_queues`, `kotc_game_cards`, `kotc_life_ledger`) — it was a hardcoded list that needed updating.

**Why:** The verification runs a `WHERE table_name IN (...)` query — new tables must be explicitly added to this list or verification always fails even when tables exist.

## Notification Types

Added to `NotificationType` union in `artifacts/api-server/src/services/notifications.ts`:
`kotc_on_deck`, `kotc_lives_low`, `kotc_lives_out`, `kotc_grace_expiring`, `kotc_bowed_out`, `kotc_rules_reminder`, `kotc_game_rules`

All notifications use `sendNotificationWithPreferences` or `sendMultiChannelNotification` from `../services/notifications`.

## TypeScript

The `@workspace/db` package uses TypeScript `composite: true` project references. When new schema files are added, must run `pnpm --filter @workspace/db exec tsc --build` to emit `.d.ts` into `lib/db/dist/schema/` — otherwise api-server TypeScript can't find the new table exports. (seed.ts has pre-existing TS errors that don't block declaration emit since `noEmitOnError: false`.)

## Phase 2 Remaining

- Stripe lives purchase flow (checkout session + webhook credit)
- Public discovery page / KotC card on programs page
- Court display TV screen (kiosk mode)
