---
name: PlayOn free agent notifications
description: Email + in-app notification dispatch at every step of the AI free agent matching flow
---

## Rule
Five notification calls are dispatched in `leagues.ts` for the free agent flow,
all using `sendNotificationWithPreferences` (in_app always + email/sms per user prefs):

1. AI proposes match → notify team captain (`triggerFreeAgentMatching`, after team_reviewing DB update)
2. Team approves → notify free agent player (`team-respond` endpoint, after player_reviewing DB update)
3. Team declines → notify free agent player (`team-respond` decline branch) ← NEW
4. Player accepts → notify team captain (`player-respond` accept branch, after matched DB update)
5. Player declines → notify team captain (`player-respond` decline branch) ← NEW

**Why:** The two-way confirmation flow was previously silent on decline paths; both parties
now receive in-app + email at every transition.

## Implementation
- Import: `import { sendNotification, sendNotificationWithPreferences } from "../services/notifications";`
- Notification types used: `"fa_match_proposal"` (proposals) and `"fa_match_response"` (responses)
- Both types are declared in `notifications.ts` NotificationType union
- Email bodies include player profile (positions, skill level, AI reasoning) and a `PUBLIC_APP_URL`-based deep link
- All calls are fire-and-forget (`.catch(() => {})`) — never block the API response
- Captain found via: `db.select().from(teamMembersTable).where(role="captain", status="active")`
- In the player-decline branch, the team must be fetched separately (it's not in scope from the accept branch)
- `dispatchEmail` in notifications.ts is still a stub — real email provider wiring is a follow-up task
