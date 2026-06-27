/// <reference lib="webworker" />
import { precacheAndRoute, createHandlerBoundToURL } from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";
import { NetworkFirst, CacheFirst, StaleWhileRevalidate } from "workbox-strategies";

declare const self: ServiceWorkerGlobalScope;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

precacheAndRoute(self.__WB_MANIFEST);

const navigationHandler = createHandlerBoundToURL("/index.html");
const navigationRoute = new NavigationRoute(navigationHandler, {
  denylist: [/^\/api\//],
});
registerRoute(navigationRoute);

registerRoute(
  ({ url }) => url.pathname.startsWith("/api/"),
  new NetworkFirst({
    cacheName: "api-cache",
    networkTimeoutSeconds: 10,
  })
);

// Pass Railway API requests straight to the network — no caching
registerRoute(
  ({ url }) => url.hostname.includes("railway.app"),
  new NetworkFirst({
    cacheName: "railway-api-cache",
    networkTimeoutSeconds: 10,
  })
);

registerRoute(
  ({ request }) =>
    request.destination === "style" ||
    request.destination === "script" ||
    request.destination === "worker",
  new StaleWhileRevalidate({
    cacheName: "static-assets",
  })
);

registerRoute(
  ({ request }) => request.destination === "image",
  new CacheFirst({
    cacheName: "image-cache",
  })
);

self.addEventListener("push", (event) => {
  let data: { title?: string; body?: string; tag?: string; url?: string } = {
    title: "PlayOn",
    body: "You have a new notification.",
  };
  try {
    data = event.data!.json();
  } catch {
    if (event.data) data.body = event.data.text();
  }

  const showPromise = self.registration
    .showNotification(data.title ?? "PlayOn", {
      body: data.body ?? "",
      icon: "/playon-logo.png",
      badge: "/favicon.png",
      tag: data.tag ?? "playon-notification",
      data: { url: data.url ?? "/" },
    })
    .then(async () => {
      if ("setAppBadge" in self.registration) {
        await (self.registration as any).setAppBadge(1);
      }
      // Broadcast to all open page clients so the bell badge updates immediately
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) {
        client.postMessage({ type: "push-notification" });
      }
    });

  event.waitUntil(showPromise);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string })?.url ?? "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (
            client.url.includes(self.location.origin) &&
            "focus" in client
          ) {
            client.navigate(url);
            return client.focus();
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(url);
      })
  );
});
