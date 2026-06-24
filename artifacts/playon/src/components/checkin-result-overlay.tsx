import React, { useEffect } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

export interface CheckInResult {
  result: "verified" | "denied";
  playerName?: string;
  playonId?: string;
  reason?: string;
}

interface CheckInResultOverlayProps {
  value: CheckInResult | null;
  onDismiss: () => void;
}

export function CheckInResultOverlay({ value, onDismiss }: CheckInResultOverlayProps) {
  useEffect(() => {
    if (!value) return;
    const t = setTimeout(onDismiss, 2500);
    return () => clearTimeout(t);
  }, [value, onDismiss]);

  if (!value) return null;

  const ok = value.result === "verified";

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center cursor-pointer select-none"
      style={{ backgroundColor: ok ? "#16a34a" : "#dc2626" }}
      onClick={onDismiss}
    >
      {ok
        ? <CheckCircle2 className="h-32 w-32 text-white mb-4" strokeWidth={1.5} />
        : <XCircle className="h-32 w-32 text-white mb-4" strokeWidth={1.5} />}

      <p className="text-white text-5xl font-bold tracking-tight mb-3 font-sans uppercase">
        {ok ? "Verified" : "Denied"}
      </p>

      {value.playerName && (
        <p className="text-white/90 text-2xl font-semibold">{value.playerName}</p>
      )}
      {value.playonId && (
        <p className="text-white/60 text-base font-mono mt-1">{value.playonId}</p>
      )}
      {value.reason && (
        <p className={`text-center max-w-xs mt-4 px-4 text-lg leading-snug ${ok ? "text-white/70" : "text-white/90"}`}>
          {value.reason}
        </p>
      )}

      <p className="text-white/40 text-sm mt-10">Tap anywhere to dismiss</p>
    </div>
  );
}
