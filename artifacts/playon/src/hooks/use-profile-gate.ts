import { API_BASE } from "@/lib/api-base";
import { useAuth } from "@clerk/react";
import { useCallback } from "react";
import { useLocation } from "wouter";


export interface ProfileGateResult {
  checkAndRedirect: () => Promise<void>;
}

export function useProfileGate(): ProfileGateResult {
  const [, setLocation] = useLocation();
  const { getToken } = useAuth();

  const checkAndRedirect = useCallback(async () => {
    try {
      const token = await getToken();
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/me`, { headers });
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
  }, [setLocation, getToken]);

  return { checkAndRedirect };
}
