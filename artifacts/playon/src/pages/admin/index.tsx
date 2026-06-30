import { API_BASE } from "@/lib/api-base";
import React from "react";
import { Redirect, Link } from "wouter";
import { useGetMyProfile, useGetAdminStats, useListAdminActivity } from "@workspace/api-client-react";
import type { AdminStats } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users, DollarSign, Calendar, Trophy, Activity,
  AlertCircle, Flag, ScanLine, CreditCard, ChevronRight,
  UserPlus, HeartPulse, ClipboardCheck, ShieldAlert, Building2, Plus,
} from "lucide-react";
import { format } from "date-fns";


function StatCard({ icon: Icon, label, value, sub, accent }: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  accent: string;
}) {
  return (
    <div className={`bg-card rounded-xl border border-border p-5 flex items-start gap-4 border-l-4 ${accent}`}>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
        <p className="text-3xl font-bold text-foreground leading-none">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1.5">{sub}</p>}
      </div>
      <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
    </div>
  );
}

export default function Admin() {
  const { data: profile, isLoading: isProfileLoading } = useGetMyProfile();
  const { data: stats, isLoading: isStatsLoading } = useGetAdminStats();
  const { data: activity } = useListAdminActivity({ limit: 8 });
  const { getToken } = useAuth();

  const isAdmin = !!profile && profile.role === "admin";
  const isScopedAdmin = isAdmin && (profile as any).adminLevel === "scoped";

  const { data: myStaffProfile } = useQuery<Record<string, boolean> | null>({
    queryKey: ["my-staff-profile-perms"],
    enabled: isScopedAdmin,
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/staff-profiles/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 60_000,
  });

  const { data: openIncidents } = useQuery<any[]>({
    queryKey: ["admin-open-incidents"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/admin/incident-reports?status=open`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 60_000,
    enabled: isAdmin,
  });

  const { data: openAlerts } = useQuery<any[]>({
    queryKey: ["admin-open-sub-ref-alerts"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/sub-ref-alerts`, { credentials: "include" });
      if (!res.ok) return [];
      const all = await res.json();
      const today = new Date(); today.setHours(0, 0, 0, 0);
      return (all as any[]).filter((a) => {
        if (a.status !== "open") return false;
        if (!a.gameDate) return true;
        const d = new Date(a.gameDate); d.setHours(0, 0, 0, 0);
        return d.getTime() === today.getTime();
      });
    },
    staleTime: 60_000,
    enabled: isAdmin,
  });

  const { data: outstandingPayments } = useQuery<any[]>({
    queryKey: ["admin-outstanding-payments"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/admin/payments/outstanding`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 60_000,
    enabled: isAdmin,
  });

  const { data: nextDropin } = useQuery<any>({
    queryKey: ["admin-next-dropin"],
    queryFn: async () => {
      const from = new Date().toISOString();
      const res = await fetch(`${API_BASE}/dropins?from=${encodeURIComponent(from)}`, { credentials: "include" });
      if (!res.ok) return null;
      const list = await res.json();
      return Array.isArray(list) && list.length > 0 ? list[0] : null;
    },
    staleTime: 120_000,
    enabled: isAdmin,
  });

  const { data: dashboardAlerts } = useQuery<{ stuckFreeAgentsCount: number; missingHealthPacketsCount: number; incompleteRostersCount: number }>({
    queryKey: ["admin-dashboard-alerts"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/dashboard-alerts`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { stuckFreeAgentsCount: 0, missingHealthPacketsCount: 0, incompleteRostersCount: 0 };
      return res.json();
    },
    staleTime: 120_000,
    enabled: isAdmin,
  });

  if (isProfileLoading) {
    return (
      <div className="p-8 space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-28" />)}</div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (profile?.role !== "admin") return <Redirect to="/dashboard" />;

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const unpaidOldCount = (outstandingPayments ?? []).filter(
    (r: any) => r.paymentStatus === "unpaid" && new Date(r.createdAt) < sevenDaysAgo
  ).length;

  const incidentCount = openIncidents?.length ?? 0;
  const alertCount = openAlerts?.length ?? 0;

  type AttentionItem = { key: string; href: string; iconColor: string; borderColor: string; icon: React.ElementType; label: string };
  const attentionItems: AttentionItem[] = [];
  if (incidentCount > 0) {
    attentionItems.push({ key: "incidents", href: "/admin/incident-reports", iconColor: "text-red-400", borderColor: "border-red-500/30", icon: AlertCircle, label: `${incidentCount} open incident report${incidentCount > 1 ? "s" : ""}` });
  }
  if (unpaidOldCount > 0) {
    attentionItems.push({ key: "unpaid", href: "/admin/payments", iconColor: "text-amber-400", borderColor: "border-amber-500/30", icon: DollarSign, label: `${unpaidOldCount} unpaid registration${unpaidOldCount > 1 ? "s" : ""} over 7 days` });
  }
  if (alertCount > 0) {
    attentionItems.push({ key: "alerts", href: "/admin/sub-ref-alerts", iconColor: "text-orange-400", borderColor: "border-orange-500/30", icon: Flag, label: `${alertCount} unfilled sub slot${alertCount > 1 ? "s" : ""} today` });
  }
  const stuckFAs = dashboardAlerts?.stuckFreeAgentsCount ?? 0;
  if (stuckFAs > 0) {
    attentionItems.push({ key: "stuck-fas", href: "/admin/leagues", iconColor: "text-violet-400", borderColor: "border-violet-500/30", icon: UserPlus, label: `${stuckFAs} free agent${stuckFAs > 1 ? "s" : ""} without a team` });
  }
  const missingHP = dashboardAlerts?.missingHealthPacketsCount ?? 0;
  if (missingHP > 0) {
    attentionItems.push({ key: "missing-hp", href: "/admin/camps", iconColor: "text-rose-400", borderColor: "border-rose-500/30", icon: HeartPulse, label: `${missingHP} camp player${missingHP > 1 ? "s" : ""} missing health packet` });
  }
  const incompleteRosters = dashboardAlerts?.incompleteRostersCount ?? 0;
  if (incompleteRosters > 0) {
    attentionItems.push({ key: "incomplete-rosters", href: "/admin/tournaments", iconColor: "text-amber-400", borderColor: "border-amber-500/30", icon: ClipboardCheck, label: `${incompleteRosters} tournament team${incompleteRosters > 1 ? "s" : ""} with incomplete roster` });
  }

  const checkinHref = "/scanner";

  const QUICK_ACTIONS = [
    { icon: ScanLine,    label: "Start Check-In",  href: checkinHref,             color: "text-green-400",   bg: "bg-green-400/10" },
    { icon: Plus,        label: "Create Offering", href: "/admin/create",         color: "text-primary",     bg: "bg-primary/10" },
    { icon: Building2,   label: "Court Rentals",   href: "/admin/rentals",        color: "text-teal-400",    bg: "bg-teal-400/10" },
    { icon: Flag,        label: "Post Sub Alert",  href: "/admin/sub-ref-alerts", color: "text-orange-400",  bg: "bg-orange-400/10" },
    { icon: CreditCard,  label: "View Payments",   href: "/admin/payments",       color: "text-emerald-400", bg: "bg-emerald-400/10" },
    { icon: Users,       label: "Manage Users",    href: "/admin/staff",          color: "text-violet-400",  bg: "bg-violet-400/10" },
  ].filter((qa) => {
    if (!isScopedAdmin) return true;
    if (qa.href === "/admin/dropins") return !!(myStaffProfile as any)?.canManageDropins;
    if (qa.href === "/admin/sub-ref-alerts") return !!(myStaffProfile as any)?.canManageAssignments;
    if (qa.href === "/admin/payments") return !!(myStaffProfile as any)?.canViewReports || !!(myStaffProfile as any)?.canProcessRefunds;
    if (qa.href === "/admin/staff") return !!(myStaffProfile as any)?.canManageUsers;
    return true;
  });

  return (
    <div className="p-6 space-y-6 max-w-5xl">

        {/* Page heading */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight">Dashboard</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {activity?.[0]
                ? `Last activity ${format(new Date(activity[0].createdAt), "MMM d, h:mm a")}`
                : "PlayOn Futsal · Alumni Center, Lexington KY"}
            </p>
          </div>
          {isScopedAdmin && (
            <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-medium">
              <ShieldAlert className="h-3.5 w-3.5" />
              Scoped Admin
            </span>
          )}
        </div>

        {/* Needs Attention inbox — non-dismissible rows */}
        {attentionItems.length > 0 && (
          <section>
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 text-red-400" />
              Needs Attention
              <span className="ml-1 text-[10px] font-semibold bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full">
                {attentionItems.length}
              </span>
            </h2>
            <div className="bg-card rounded-xl border border-border overflow-hidden divide-y divide-border">
              {attentionItems.map((item) => (
                <Link key={item.key} href={item.href}>
                  <div className={`flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors cursor-pointer group`}>
                    <div className={`w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0`}>
                      <item.icon className={`h-4 w-4 ${item.iconColor}`} />
                    </div>
                    <span className="flex-1 text-sm font-medium text-foreground">{item.label}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors flex-shrink-0" />
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Stat cards */}
        {isStatsLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[1,2,3,4].map(i => <Skeleton key={i} className="h-24" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={Users}     label="Total Members"     value={stats?.totalUsers ?? 0}        sub={`${stats?.totalRegistrations ?? 0} registrations`} accent="border-l-blue-500" />
            <StatCard icon={DollarSign} label="Total Revenue"    value={`$${(stats?.totalRevenue ?? 0).toLocaleString()}`} sub="all-time" accent="border-l-emerald-500" />
            <StatCard icon={Trophy}    label="Active Leagues"    value={stats?.activeLeagues ?? 0}     sub={`${stats?.activeCamps ?? 0} active camps`} accent="border-l-amber-500" />
            <StatCard icon={Calendar}  label="Upcoming Drop-ins" value={stats?.upcomingDropins ?? 0}   sub={`${stats?.upcomingTournaments ?? 0} tournaments`} accent="border-l-purple-500" />
          </div>
        )}

        {/* Quick actions */}
        {QUICK_ACTIONS.length > 0 && (
          <section>
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Quick Actions</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {QUICK_ACTIONS.map((qa) => (
                <Link key={qa.label} href={qa.href}>
                  <div className="group flex flex-col items-center gap-2 p-4 rounded-xl bg-card border border-border hover:border-primary/50 hover:bg-primary/5 transition-all cursor-pointer text-center">
                    <div className={`w-10 h-10 rounded-lg ${qa.bg} flex items-center justify-center group-hover:scale-105 transition-transform`}>
                      <qa.icon className={`h-5 w-5 ${qa.color}`} />
                    </div>
                    <span className="text-xs font-medium text-foreground leading-tight">{qa.label}</span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Recent Activity */}
        <section>
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5" />
            Recent Activity
          </h2>
          <div className="bg-card rounded-xl border border-border p-5">
            <div className="space-y-3">
              {activity?.map((item) => (
                <div key={item.id} className="flex gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
                  <div className="w-1.5 h-1.5 mt-2 rounded-full bg-primary flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground leading-snug">{item.message}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {format(new Date(item.createdAt), "MMM d, h:mm a")}
                    </p>
                  </div>
                </div>
              ))}
              {!activity?.length && (
                <p className="text-sm text-muted-foreground">No recent activity.</p>
              )}
            </div>
          </div>
        </section>

    </div>
  );
}
