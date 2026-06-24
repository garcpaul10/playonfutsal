/**
 * Shared role → dashboard mapping used by both web and mobile apps.
 *
 * Each entry declares which roles grant access to that dashboard and the
 * canonical web path for it (mobile routes are handled per-platform).
 */

export interface DashboardConfig {
  id: string;
  label: string;
  description: string;
  webPath: string;
  requiredRoles: string[];
}

export const DASHBOARD_CONFIGS: DashboardConfig[] = [
  {
    id: "admin",
    label: "Admin Console",
    description: "Programs, players and finance",
    webPath: "/admin",
    requiredRoles: ["admin"],
  },
  {
    id: "staff",
    label: "Staff / Game Cards",
    description: "Your upcoming game assignments",
    webPath: "/staff/game-cards",
    requiredRoles: ["ref", "coach", "scorekeeper", "staff"],
  },
  {
    id: "earnings",
    label: "Earnings",
    description: "Payout status and history",
    webPath: "/staff/earnings",
    requiredRoles: ["ref", "coach", "scorekeeper", "staff"],
  },
  {
    id: "ref-alerts",
    label: "Ref Alerts",
    description: "Open ref slots to claim",
    webPath: "/ref-alerts",
    requiredRoles: ["ref"],
  },
  {
    id: "family",
    label: "Family Dashboard",
    description: "Manage your children's accounts",
    webPath: "/family",
    requiredRoles: ["parent"],
  },
  {
    id: "player",
    label: "Player Dashboard",
    description: "Your registrations and schedule",
    webPath: "/dashboard",
    requiredRoles: ["player"],
  },
];

/**
 * Returns the user's role list from `profile.roles`.
 *
 * The /api/me endpoint guarantees `roles` is always a populated array
 * (the legacy singular `role` field is merged in at the API boundary), so
 * this helper reads only from `roles`.  The former `profile.role` fallback
 * has been removed — role resolution is now single-source.
 */
export function resolveUserRoles(profile: any): string[] {
  return Array.isArray(profile?.roles) ? [...new Set(profile.roles as string[])] : [];
}

/**
 * Returns only the dashboard entries the user is entitled to, based on their
 * resolved roles.
 */
export function getAvailableDashboards(userRoles: string[]): DashboardConfig[] {
  return DASHBOARD_CONFIGS.filter((d) =>
    d.requiredRoles.some((r) => userRoles.includes(r))
  );
}
