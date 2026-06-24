import React from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LockedTabProps {
  isRegistered: boolean;
  isLoading?: boolean;
  children: React.ReactNode;
  onRegisterClick?: () => void;
}

export function LockedTab({ isRegistered, isLoading, children, onRegisterClick }: LockedTabProps) {
  if (isLoading) {
    return <div className="py-8 text-center text-white/30 animate-pulse text-sm">Checking access…</div>;
  }

  if (isRegistered) {
    return <>{children}</>;
  }

  return (
    <div className="relative">
      <div className="pointer-events-none select-none blur-sm opacity-40 max-h-48 overflow-hidden">
        {children}
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-gradient-to-t from-[#050508] via-[#050508]/80 to-transparent rounded-xl">
        <div className="flex flex-col items-center gap-3 text-center px-6">
          <div className="h-12 w-12 rounded-full bg-white/10 border border-white/20 flex items-center justify-center">
            <Lock className="h-5 w-5 text-white/60" />
          </div>
          <p className="font-semibold text-white text-base">Register to unlock full details</p>
          <p className="text-sm text-white/40">Schedule, Standings &amp; Teams are only visible to registered participants.</p>
          {onRegisterClick && (
            <Button
              className="mt-1 bg-[#dc2626] hover:bg-[#b91c1c] border-none"
              onClick={onRegisterClick}
            >
              Register Now
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
