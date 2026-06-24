import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@clerk/react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";
const POLL_INTERVAL_MS = 15_000;

export interface UserNotification {
  id: number;
  type: string;
  subject: string | null;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface UseNotificationsResult {
  items: UserNotification[];
  unreadCount: number;
  isLoading: boolean;
  markRead: (id: number) => Promise<void>;
  markAllRead: () => Promise<void>;
  refresh: () => void;
}

export function useNotifications(): UseNotificationsResult {
  const { getToken, isSignedIn } = useAuth();
  const [items, setItems] = useState<UserNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchNotifications = useCallback(async () => {
    if (!isSignedIn) return;
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/notifications`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setItems(data.items ?? []);
        // Use the server-computed aggregate — accurate even when items are paginated
        setUnreadCount(data.unreadCount ?? 0);
      }
    } catch {
      // Non-blocking — polling will retry
    } finally {
      setIsLoading(false);
    }
  }, [getToken, isSignedIn]);

  // Initial load
  useEffect(() => {
    if (!isSignedIn) return;
    setIsLoading(true);
    fetchNotifications();
  }, [isSignedIn, fetchNotifications]);

  // Polling every 15 s
  useEffect(() => {
    if (!isSignedIn) return;
    intervalRef.current = setInterval(fetchNotifications, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isSignedIn, fetchNotifications]);

  // Refresh on service worker push message (real-time badge bump).
  // sw.ts broadcasts { type: 'push-notification' } after showing the system notification.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const handler = (event: MessageEvent) => {
      if ((event.data as { type?: string })?.type === "push-notification") {
        fetchNotifications();
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, [fetchNotifications]);

  const markRead = useCallback(
    async (id: number) => {
      try {
        const token = await getToken();
        await fetch(`${API_BASE}/notifications/${id}/read`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}` },
        });
        setItems((prev) =>
          prev.map((n) => (n.id === id ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n)),
        );
        setUnreadCount((c) => Math.max(0, c - 1));
      } catch {
        // ignore
      }
    },
    [getToken],
  );

  const markAllRead = useCallback(async () => {
    try {
      const token = await getToken();
      await fetch(`${API_BASE}/notifications/read-all`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      });
      const now = new Date().toISOString();
      setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? now })));
      setUnreadCount(0);
    } catch {
      // ignore
    }
  }, [getToken]);

  return { items, unreadCount, isLoading, markRead, markAllRead, refresh: fetchNotifications };
}
