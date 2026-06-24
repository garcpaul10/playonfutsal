import { useLocation } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import {
  ShieldAlert,
  ClipboardList,
  DollarSign,
  AlertTriangle,
  Users,
  LayoutDashboard,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  DASHBOARD_CONFIGS,
  resolveUserRoles,
  getAvailableDashboards,
} from "@workspace/brand";
import type { DashboardConfig } from "@workspace/brand";

export type { DashboardConfig };

const DASHBOARD_ICONS: Record<string, LucideIcon> = {
  admin: ShieldAlert,
  staff: ClipboardList,
  earnings: DollarSign,
  "ref-alerts": AlertTriangle,
  family: Users,
  player: LayoutDashboard,
};

export interface DashboardEntry extends DashboardConfig {
  icon: LucideIcon;
}

export function useDashboardSwitcher() {
  const [location] = useLocation();
  const { data: profile } = useGetMyProfile();

  const userRoles = resolveUserRoles(profile);
  const available: DashboardEntry[] = getAvailableDashboards(userRoles).map(
    (d) => ({ ...d, icon: DASHBOARD_ICONS[d.id] ?? LayoutDashboard })
  );

  const active =
    available.find((d) => {
      if (d.webPath === "/dashboard") {
        return location === "/" || location === "/dashboard";
      }
      return location.startsWith(d.webPath);
    }) ?? null;

  return {
    available,
    active,
    isMultiRole: userRoles.length > 1,
  };
}
