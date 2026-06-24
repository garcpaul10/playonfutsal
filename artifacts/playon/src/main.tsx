import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        console.info("[sw] Service worker registered:", reg.scope);
      })
      .catch((err) => {
        console.warn("[sw] Service worker registration failed:", err);
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
