import { useCallback } from "react";
import { useLocation } from "wouter";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

export interface ProfileGateResult {
  checkAndRedirect: () => Promise<void>;
}

export function useProfileGate(): ProfileGateResult {
  const [, setLocation] = useLocation();

  const checkAndRedirect = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/me`, { credentials: "include" });
      if (!res.ok) {
        setLocation("/onboarding");
        return;
      }
      const profile = await res.json();

      const profileRoles: string[] = Array.isArray(profile.roles) ? profile.roles : [];
      const hasRoles = profileRoles.length > 0;

      if (!hasRoles) {
        setLocation("/onboarding");
        return;
      }

      // Also gate on ID verification — users with roles but no idVerified
      // are sent back to onboarding to complete the ID step.
      if (!profile.idVerified) {
        setLocation("/onboarding");
        return;
      }
    } catch {
      setLocation("/onboarding");
      return;
    }
    setLocation("/dashboard");
  }, [setLocation]);

  return { checkAndRedirect };
}
