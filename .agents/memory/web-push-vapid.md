---
name: Web push VAPID setup
description: How PlayOn's browser push notification pipeline is configured end-to-end
---

# Web Push VAPID Setup

## The rule
VAPID_PUBLIC_KEY and VAPID_CONTACT_EMAIL are env vars (shared); VAPID_PRIVATE_KEY is a Replit secret. VITE_VAPID_PUBLIC_KEY is the Vite-exposed copy for the frontend `pushManager.subscribe` call.

**Why:** Vite strips non-VITE_ prefixed env vars from the browser bundle; the private key must never reach the frontend.

## How to apply
- Backend push service: `artifacts/api-server/src/services/webPush.ts` — reads the three vars, calls `webPush.setVapidDetails` once at module load.
- DB table: `web_push_subscriptions` (migration 0071 in ensure-schema.mjs); schema in `lib/db/src/schema/webPushSubscriptions.ts`.
- Push routes: `POST /notification-preferences/push-subscription` and `DELETE` in `notificationPreferences.ts`.
- `dispatchPush` in `notifications.ts` fetches all subscriptions for the user, calls `sendWebPush`, auto-deletes expired ones (410/404).
- Service worker: `artifacts/playon/public/sw.js` — handles `push` event → `showNotification`. Registered in `main.tsx` on window load.
- Frontend opt-in UI: `artifacts/playon/src/pages/notification-preferences.tsx` — `requestPermission` → `pushManager.subscribe` → POST to backend.
