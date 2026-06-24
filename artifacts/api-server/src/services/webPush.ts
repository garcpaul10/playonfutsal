/**
 * webPush.ts — Web Push (VAPID) delivery service for PlayOn.
 *
 * Requires env vars:
 *   VAPID_PUBLIC_KEY   — generated VAPID public key
 *   VAPID_PRIVATE_KEY  — generated VAPID private key (secret)
 *   VAPID_CONTACT_EMAIL — sender contact for VAPID subject
 *
 * When credentials are absent the send is a no-op and `sent: false` is returned.
 */

import webPush from "web-push";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_CONTACT_EMAIL = process.env.VAPID_CONTACT_EMAIL ?? "no-reply@playon.app";

export const webPushConfigured = !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

if (webPushConfigured) {
  webPush.setVapidDetails(
    `mailto:${VAPID_CONTACT_EMAIL}`,
    VAPID_PUBLIC_KEY!,
    VAPID_PRIVATE_KEY!,
  );
}

export interface WebPushResult {
  sent: boolean;
  expired?: boolean;
  error?: string;
}

export interface PushSubscriptionData {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Send a web push notification to a single subscription.
 * Returns `expired: true` when the subscription is gone (410/404) — caller should delete it.
 */
export async function sendWebPush(
  subscription: PushSubscriptionData,
  payload: { title: string; body: string; url?: string; tag?: string },
): Promise<WebPushResult> {
  if (!webPushConfigured) {
    console.warn("[webPush] VAPID keys not configured — skipping push");
    return { sent: false, error: "Web push not configured" };
  }

  try {
    await webPush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
    );
    return { sent: true };
  } catch (err: any) {
    const statusCode = err?.statusCode ?? 0;
    if (statusCode === 410 || statusCode === 404) {
      return { sent: false, expired: true };
    }
    console.error("[webPush] Send error:", err?.message ?? err);
    return { sent: false, error: err?.message ?? "Push send error" };
  }
}
