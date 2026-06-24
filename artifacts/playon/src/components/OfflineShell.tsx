import { useState, useEffect } from "react";
import { WifiOff, RefreshCw } from "lucide-react";

export function OfflineShell() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const goOnline = () => setIsOffline(false);
    const goOffline = () => setIsOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col"
      style={{ background: "hsl(195,14%,14%)" }}
      aria-live="assertive"
      role="alert"
    >
      <header
        className="flex items-center gap-3 px-4 py-3 border-b"
        style={{ borderColor: "hsl(195,14%,24%)" }}
      >
        <img
          src="/playon-logo.png"
          alt="PlayOn"
          className="h-8 w-auto"
        />
        <span className="text-white font-semibold text-lg">PlayOn</span>
      </header>

      <nav
        className="flex gap-1 px-4 py-2 border-b text-sm"
        style={{ borderColor: "hsl(195,14%,24%)" }}
      >
        {["Explore", "My PlayOn", "Account"].map((label) => (
          <span
            key={label}
            className="px-3 py-1.5 rounded-md text-[hsl(180,5%,55%)] select-none"
          >
            {label}
          </span>
        ))}
      </nav>

      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6 text-center">
        <div
          className="flex h-20 w-20 items-center justify-center rounded-full"
          style={{ background: "hsl(195,14%,20%)" }}
        >
          <WifiOff className="h-9 w-9 text-[hsl(180,5%,55%)]" />
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-semibold text-white">You're offline</h1>
          <p className="text-sm text-[hsl(180,5%,55%)] max-w-xs leading-relaxed">
            Check your connection and try again. Your previously viewed schedules
            and rosters may still be available once you're back online.
          </p>
        </div>

        <button
          onClick={() => window.location.reload()}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium text-white transition-colors"
          style={{ background: "hsl(349,78%,26%)" }}
          onMouseOver={(e) =>
            (e.currentTarget.style.background = "hsl(349,78%,32%)")
          }
          onMouseOut={(e) =>
            (e.currentTarget.style.background = "hsl(349,78%,26%)")
          }
        >
          <RefreshCw className="h-4 w-4" />
          Try again
        </button>
      </div>
    </div>
  );
}
