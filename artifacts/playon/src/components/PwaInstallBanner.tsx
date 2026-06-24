import { useState, useEffect } from "react";
import { X, Download } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "pwa-install-banner-dismissed";

export function PwaInstallBanner() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY)) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setPromptEvent(e as BeforeInstallPromptEvent);
      setVisible(true);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  function handleInstall() {
    if (!promptEvent) return;
    promptEvent.prompt();
    promptEvent.userChoice.then((choice) => {
      if (choice.outcome === "accepted") {
        setVisible(false);
      }
      setPromptEvent(null);
    });
  }

  function handleDismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-0 inset-x-0 z-50 flex items-center gap-3 px-4 py-3 bg-[hsl(195,14%,18%)] border-t border-[hsl(195,14%,28%)] shadow-lg animate-in slide-in-from-bottom-2 duration-300"
      role="banner"
      aria-label="Install PlayOn"
    >
      <img
        src="/playon-logo.png"
        alt=""
        className="h-9 w-9 rounded-lg object-cover flex-shrink-0"
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white leading-tight">Add PlayOn to your home screen</p>
        <p className="text-xs text-[hsl(180,5%,60%)] leading-tight mt-0.5">Works offline · No app store needed</p>
      </div>
      <button
        onClick={handleInstall}
        className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[hsl(349,78%,26%)] hover:bg-[hsl(349,78%,32%)] text-white text-sm font-medium transition-colors"
      >
        <Download className="h-3.5 w-3.5" />
        Install
      </button>
      <button
        onClick={handleDismiss}
        className="flex-shrink-0 p-1.5 rounded-md text-[hsl(180,5%,60%)] hover:text-white hover:bg-[hsl(195,14%,28%)] transition-colors"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
