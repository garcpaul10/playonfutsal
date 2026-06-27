import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setBaseUrl } from "@workspace/api-client-react";

const apiUrl = import.meta.env.VITE_API_URL ?? "https://workspaceapi-server-production-3488.up.railway.app";
setBaseUrl(apiUrl);

if ("serviceWorker" in navigator) {
  // Unregister any existing service workers so they don't intercept API requests
  navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));

  window.addEventListener("load", () => {
    // Service worker temporarily disabled — was blocking cross-origin Railway API requests
    // navigator.serviceWorker.register("/sw.js")
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
