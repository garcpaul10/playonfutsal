import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setBaseUrl } from "@workspace/api-client-react";

const apiUrl = import.meta.env.VITE_API_URL ?? "https://workspaceapi-server-production-3488.up.railway.app";
setBaseUrl(apiUrl);

if ("serviceWorker" in navigator) {
  // Register the service worker (built by Vite PWA plugin from src/sw.ts).
  // sw.ts passes all cross-origin requests straight to the network, so it no
  // longer blocks Railway API calls.
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("[SW] Registration failed:", err);
    });
  });

  window.addEventListener("focus", () => {
    if ("clearAppBadge" in navigator) {
      (navigator as any).clearAppBadge().catch(() => {});
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && "clearAppBadge" in navigator) {
      (navigator as any).clearAppBadge().catch(() => {});
    }
  });
}

createRoot(document.getElementById("root")!).render(<App />);
