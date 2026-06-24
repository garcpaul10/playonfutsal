import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { useGetMyProfile } from "@workspace/api-client-react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

type StaffProfile = Record<string, boolean | string | number | null>;

/**
 * Returns granular permission flags for the current admin/staff user.
 * Super-admins (role=admin AND adminLevel≠scoped) get all flags set to true.
 * Scoped admins and staff resolve flags from their staff_profiles row.
 * Safe to call in any admin sub-component — TanStack Query caches the result.
 */
export function useAdminPermissions() {
  const { getToken } = useAuth();
  const { data: profile } = useGetMyProfile();

  const isSuperAdmin =
    !!profile &&
    (profile.roles?.includes("admin") ?? false) &&
    (profile as any).adminLevel !== "scoped";

  const { data: staffProfile } = useQuery<StaffProfile | null>({
    queryKey: ["my-staff-profile"],
    queryFn: async () => {
      const token = await getToken();
      const r = await fetch(`${API_BASE}/staff-profiles/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return r.ok ? r.json() : null;
    },
    enabled:
      !!profile &&
      !isSuperAdmin &&
      (profile.roles?.includes("admin") || profile.roles?.includes("staff")),
    staleTime: 60_000,
  });

  function can(permission: string): boolean {
    if (!profile) return false;
    if (isSuperAdmin) return true;
    return !!staffProfile?.[permission];
  }

  return {
    isSuperAdmin,
    can,
    canManageLeagues: can("canManageLeagues"),
    canManageTournaments: can("canManageTournaments"),
    canManageDropins: can("canManageDropins"),
    canManageCamps: can("canManageCamps"),
    canManageCourts: can("canManageCourts"),
    canManageVenues: can("canManageVenues"),
    canManageAgeGroups: can("canManageAgeGroups"),
    canManageUsers: can("canManageUsers"),
    canManageGameCards: can("canManageGameCards"),
    canManageSchedules: can("canManageSchedules"),
    canViewReports: can("canViewReports"),
    canManageAssignments: can("canManageAssignments"),
    canManageAnnouncements: can("canManageAnnouncements"),
    canEditRegistrations: can("canEditRegistrations"),
    canProcessRefunds: can("canProcessRefunds"),
    canManagePayouts: can("canManagePayouts"),
  };
}
