import React, { useState } from "react";
import { Redirect, Link } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { useAdminPermissions } from "@/hooks/use-admin-permissions";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { format } from "date-fns";
import { CheckCircle2, Clock, Shield, ShieldAlert, Pencil, UserPlus, Search, ChevronRight, UserCog, Mail } from "lucide-react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

interface StaffProfile {
  id: number;
  userId: number;
  title: string | null;
  bio: string | null;
  backgroundCheckStatus: string;
  isActive: boolean;
  canManageLeagues: boolean;
  canManageCamps: boolean;
  canManageDropins: boolean;
  canManageTournaments: boolean;
  canViewRegistrations: boolean;
  canEditRegistrations: boolean;
  canManageUsers: boolean;
  canManageCourts: boolean;
  canManageVenues: boolean;
  canManageAgeGroups: boolean;
  canViewReports: boolean;
  canProcessRefunds: boolean;
  canManagePayouts: boolean;
  canManageSchedules: boolean;
  canManageAssignments: boolean;
  canManageAnnouncements: boolean;
  canManageGameCards: boolean;
  notes: string | null;
  createdAt: string;
  connectAccountId: string | null;
  connectOnboardingStatus: string;
}

function connectStatusBadge(status: string) {
  const isOnboarded = status === "complete" || status === "onboarded";
  const map: Record<string, string> = {
    none: "bg-gray-100 text-gray-500",
    pending: "bg-gray-100 text-gray-500",
    invited: "bg-blue-100 text-blue-700",
    onboarding: "bg-yellow-100 text-yellow-800",
    complete: "bg-green-100 text-green-800",
    onboarded: "bg-green-100 text-green-800",
    restricted: "bg-red-100 text-red-700",
  };
  const label = isOnboarded ? "PAYOUT ✓"
    : status === "invited" ? "INVITED"
    : status === "onboarding" ? "ONBOARDING"
    : status === "restricted" ? "RESTRICTED"
    : "NOT SET UP";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${map[status] ?? "bg-gray-100 text-gray-700"}`}>
      {label}
    </span>
  );
}

interface AdminUser {
  id: number;
  clerkId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  adminLevel?: string;
  createdAt: string;
}

interface TrainingRecord {
  profileId: number;
  userId: number;
  trainingCompletedAt: string | null;
  trainingStatus: "complete" | "pending";
  userRoles: string[];
}

type PermissionKey = keyof Pick<StaffProfile,
  | "canManageLeagues" | "canManageCamps" | "canManageDropins" | "canManageTournaments"
  | "canViewRegistrations" | "canEditRegistrations" | "canManageUsers"
  | "canManageCourts" | "canManageVenues" | "canManageAgeGroups"
  | "canViewReports" | "canProcessRefunds" | "canManagePayouts"
  | "canManageSchedules" | "canManageAssignments"
  | "canManageAnnouncements" | "canManageGameCards"
>;

interface PermissionGroup {
  label: string;
  items: { key: PermissionKey; label: string; description: string }[];
}

const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    label: "Programs",
    items: [
      { key: "canManageLeagues", label: "Leagues", description: "Manage league programs and check in players at fixtures" },
      { key: "canManageCamps", label: "Camps", description: "Manage camp programs and check in registered participants" },
      { key: "canManageTournaments", label: "Tournaments", description: "Manage tournaments and check in teams at the venue" },
      { key: "canManageDropins", label: "Drop-ins", description: "Manage drop-in sessions and check in players at the door" },
    ],
  },
  {
    label: "Registrations & Users",
    items: [
      { key: "canViewRegistrations", label: "Registrations (view)", description: "View player and team registration details" },
      { key: "canEditRegistrations", label: "Registrations (edit)", description: "Edit, transfer, or cancel registrations" },
      { key: "canManageUsers", label: "User management", description: "Search, view, and manage player accounts" },
    ],
  },
  {
    label: "Facility",
    items: [
      { key: "canManageCourts", label: "Courts", description: "Add and configure courts and their availability" },
      { key: "canManageVenues", label: "Venues", description: "Create and edit venues and their settings" },
      { key: "canManageAgeGroups", label: "Age groups", description: "Define and manage age group configurations" },
    ],
  },
  {
    label: "Finance",
    items: [
      { key: "canViewReports", label: "Reports", description: "View revenue, registration, and payout reports" },
      { key: "canProcessRefunds", label: "Refunds / Payments", description: "Issue refunds and adjust payment records" },
      { key: "canManagePayouts", label: "Payouts", description: "Execute and review staff and coach payouts" },
    ],
  },
  {
    label: "Operations",
    items: [
      { key: "canManageSchedules", label: "Schedules", description: "Build and publish game and session schedules" },
      { key: "canManageAssignments", label: "Staff assignments", description: "Assign referees, coaches, and staff to fixtures" },
      { key: "canManageAnnouncements", label: "Announcements", description: "Draft and publish announcements to players" },
      { key: "canManageGameCards", label: "Game cards / Disciplinary", description: "Record game cards and manage suspensions" },
    ],
  },
];

const ALL_PERMISSION_KEYS: PermissionKey[] = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key));

const PERMISSION_PRESETS: { label: string; permissions: Partial<Record<PermissionKey, boolean>> }[] = [
  {
    label: "Check-in Staff",
    permissions: { canManageLeagues: true, canManageCamps: true, canManageTournaments: true, canManageDropins: true },
  },
  {
    label: "Schedule Coordinator",
    permissions: { canManageSchedules: true, canManageLeagues: true, canManageDropins: true, canViewRegistrations: true },
  },
  {
    label: "Registration Staff",
    permissions: { canViewRegistrations: true, canEditRegistrations: true },
  },
  {
    label: "Full Program Staff",
    permissions: {
      canManageSchedules: true, canManageLeagues: true, canManageCamps: true,
      canManageDropins: true, canManageTournaments: true, canViewRegistrations: true, canEditRegistrations: true,
    },
  },
];

const defaultPerms = (): Record<PermissionKey, boolean> =>
  Object.fromEntries(ALL_PERMISSION_KEYS.map((k) => [k, false])) as Record<PermissionKey, boolean>;

function permissionsFromProfile(sp: StaffProfile): Record<PermissionKey, boolean> {
  return Object.fromEntries(ALL_PERMISSION_KEYS.map((k) => [k, !!(sp as any)[k]])) as Record<PermissionKey, boolean>;
}

function PermissionToggles({
  perms,
  editing,
  onChange,
}: {
  perms: Record<string, boolean>;
  editing: boolean;
  onChange?: (key: string, val: boolean) => void;
}) {
  return (
    <div className="space-y-3">
      {PERMISSION_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">{group.label}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
            {group.items.map(({ key, label, description }) => {
              const val = !!perms[key];
              return (
                <label
                  key={key}
                  className={`flex items-start gap-2 ${editing ? "cursor-pointer" : "cursor-default"} select-none`}
                >
                  <input
                    type="checkbox"
                    checked={val}
                    disabled={!editing}
                    onChange={editing && onChange ? (e) => onChange(key, e.target.checked) : undefined}
                    className="h-4 w-4 mt-0.5 rounded border-input accent-primary disabled:opacity-60 flex-shrink-0"
                  />
                  <span className="flex flex-col">
                    <span className={`text-sm leading-snug ${val ? "font-medium" : "text-muted-foreground"}`}>{label}</span>
                    <span className="text-xs text-muted-foreground leading-snug">{description}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AdminStaff() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { getToken } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isSuperAdmin = (profile?.role === "admin" || profile?.adminLevel === "super" || profile?.adminLevel === "admin") && profile?.adminLevel !== "scoped";
  const { canManageUsers, canManagePayouts } = useAdminPermissions();

  // Staff profile state
  const [showForm, setShowForm] = useState(false);
  const [editingStaffId, setEditingStaffId] = useState<number | null>(null);
  const [newUserQuery, setNewUserQuery] = useState("");
  const [newUserSelected, setNewUserSelected] = useState<{ id: number; email: string; firstName: string | null; lastName: string | null } | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newPerms, setNewPerms] = useState<Record<string, boolean>>(defaultPerms());
  const [editStaffPerms, setEditStaffPerms] = useState<Record<number, Record<string, boolean>>>({});

  // Scoped admin permission state
  const [editingAdminClerkId, setEditingAdminClerkId] = useState<string | null>(null);
  const [editAdminPerms, setEditAdminPerms] = useState<Record<string, Record<string, boolean>>>({});

  // Edit staff profile (title, bio, notes)
  const [editStaffTarget, setEditStaffTarget] = useState<StaffProfile | null>(null);
  const [editStaffForm, setEditStaffForm] = useState({ title: "", bio: "", notes: "" });

  // Connect invite state
  const [invitingStaffUserId, setInvitingStaffUserId] = useState<number | null>(null);

  const connectInviteMut = useMutation({
    mutationFn: async (userId: number) => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/connect/staff/${userId}/invite`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error ?? "Failed to send invite");
      }
      return res.json();
    },
    onSuccess: (_data, userId) => {
      queryClient.invalidateQueries({ queryKey: ["staff-profiles"] });
      toast({ title: "Invite sent", description: "A Stripe Connect onboarding link was emailed to this staff member." });
      setInvitingStaffUserId(null);
    },
    onError: (err: Error) => {
      toast({ title: "Invite failed", description: err.message, variant: "destructive" });
      setInvitingStaffUserId(null);
    },
  });

  // Promote-to-super confirmation dialog
  const [promoteTarget, setPromoteTarget] = useState<AdminUser | null>(null);
  const [promoting, setPromoting] = useState(false);

  // Grant Admin Access dialog state
  const [grantAdminOpen, setGrantAdminOpen] = useState(false);
  const [grantStep, setGrantStep] = useState<"search" | "level" | "confirm">("search");
  const [grantQuery, setGrantQuery] = useState("");
  const [grantSelected, setGrantSelected] = useState<{ id: number; clerkId: string; email: string; firstName: string | null; lastName: string | null; role: string } | null>(null);
  const [grantLevel, setGrantLevel] = useState<"scoped" | "super">("scoped");
  const [granting, setGranting] = useState(false);

  // User search for new staff form
  const { data: newStaffSearchResults, isFetching: newStaffSearchFetching } = useQuery<Array<{ id: number; clerkId: string; email: string; firstName: string | null; lastName: string | null; role: string }>>({
    queryKey: ["new-staff-user-search", newUserQuery],
    enabled: showForm && newUserQuery.trim().length >= 2,
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/users/search?q=${encodeURIComponent(newUserQuery.trim())}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    staleTime: 5000,
  });

  // User search for grant admin
  const { data: userSearchResults, isFetching: searchFetching } = useQuery<Array<{ id: number; clerkId: string; email: string; firstName: string | null; lastName: string | null; role: string }>>({
    queryKey: ["admin-user-search", grantQuery],
    enabled: grantAdminOpen && grantStep === "search" && grantQuery.trim().length >= 2,
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/users/search?q=${encodeURIComponent(grantQuery.trim())}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    staleTime: 5000,
  });

  function openGrantAdminDialog() {
    setGrantAdminOpen(true);
    setGrantStep("search");
    setGrantQuery("");
    setGrantSelected(null);
    setGrantLevel("scoped");
  }

  async function handleGrantAdmin() {
    if (!grantSelected) return;
    setGranting(true);
    try {
      const token = await getToken();
      // Single atomic call — sets role="admin" and adminLevel in one DB transaction
      const res = await fetch(`${API_BASE}/admin/users/${grantSelected.clerkId}/grant-admin`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ adminLevel: grantLevel }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error ?? "Failed to grant admin access");
      }
      queryClient.invalidateQueries({ queryKey: ["admin-users-list"] });
      queryClient.invalidateQueries({ queryKey: ["staff-profiles"] });
      const name = [grantSelected.firstName, grantSelected.lastName].filter(Boolean).join(" ") || grantSelected.email;
      const levelLabel = grantLevel === "super" ? "Super Admin" : "Scoped Admin";
      toast({ title: "Admin access granted", description: `${name} is now a ${levelLabel}.` });
      setGrantAdminOpen(false);
    } catch (err: any) {
      toast({ title: "Failed to grant access", description: err.message, variant: "destructive" });
    } finally {
      setGranting(false);
    }
  }

  const { data: staffProfiles, isLoading: staffLoading } = useQuery<StaffProfile[]>({
    queryKey: ["staff-profiles"],
    enabled: !profileLoading && (profile?.role === "admin" || profile?.adminLevel === "super" || profile?.adminLevel === "admin"),
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/staff-profiles`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load staff profiles");
      return res.json();
    },
  });

  const { data: adminUsers, isLoading: adminUsersLoading } = useQuery<AdminUser[]>({
    queryKey: ["admin-users-list"],
    enabled: !profileLoading && (profile?.role === "admin" || profile?.adminLevel === "super" || profile?.adminLevel === "admin"),
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/users?role=admin`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load admin users");
      const data = await res.json();
      return data;
    },
  });

  const { data: trainingRecords } = useQuery<TrainingRecord[]>({
    queryKey: ["admin-training-status"],
    enabled: !profileLoading && (profile?.role === "admin" || profile?.adminLevel === "super" || profile?.adminLevel === "admin"),
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/training-status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const staffProfileByUserId = Object.fromEntries(
    (staffProfiles ?? []).map((sp) => [sp.userId, sp])
  );

  const trainingByUserId = Object.fromEntries(
    (trainingRecords ?? []).map((r) => [r.userId, r])
  );

  const createStaff = useMutation({
    mutationFn: async () => {
      if (!newUserSelected) throw new Error("No user selected");
      const token = await getToken();
      const res = await fetch(`${API_BASE}/staff-profiles`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: newUserSelected.id, title: newTitle || null, ...newPerms, canViewRegistrations: newPerms["canViewRegistrations"] ?? true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error ?? "Failed to create staff profile");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-profiles"] });
      setShowForm(false);
      setNewUserQuery("");
      setNewUserSelected(null);
      setNewTitle("");
      setNewPerms(defaultPerms());
      toast({ title: "Staff profile created", description: "The user now has staff access with the selected permissions." });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create", description: err.message, variant: "destructive" });
    },
  });

  const updateStaffPerms = useMutation({
    mutationFn: async ({ id, perms }: { id: number; perms: Record<string, boolean> }) => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/staff-profiles/${id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(perms),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error ?? "Failed to update permissions");
      }
      return res.json();
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["staff-profiles"] });
      setEditingStaffId(null);
      setEditStaffPerms((prev) => { const next = { ...prev }; delete next[vars.id]; return next; });
      toast({ title: "Permissions updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update", description: err.message, variant: "destructive" });
    },
  });

  const updateAdminPerms = useMutation({
    mutationFn: async ({ profileId, perms }: { profileId: number; clerkId: string; perms: Record<string, boolean> }) => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/staff-profiles/${profileId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(perms),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error ?? "Failed to update permissions");
      }
      return res.json();
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["staff-profiles"] });
      queryClient.invalidateQueries({ queryKey: ["admin-users-list"] });
      setEditingAdminClerkId(null);
      setEditAdminPerms((prev) => { const next = { ...prev }; delete next[vars.clerkId]; return next; });
      toast({ title: "Admin permissions updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update", description: err.message, variant: "destructive" });
    },
  });

  const patchStaffProfile = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: { title?: string | null; bio?: string | null; notes?: string | null } }) => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/staff-profiles/${id}/profile`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error ?? "Failed to update profile");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-profiles"] });
      toast({ title: "Profile updated" });
      setEditStaffTarget(null);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update", description: err.message, variant: "destructive" });
    },
  });

  function startEditStaff(sp: StaffProfile) {
    setEditingStaffId(sp.id);
    setEditStaffPerms((prev) => ({ ...prev, [sp.id]: permissionsFromProfile(sp) }));
  }

  function applyPreset(target: "new" | number | string, presetIdx: number) {
    const preset = PERMISSION_PRESETS[presetIdx].permissions;
    const applied = { ...defaultPerms(), ...Object.fromEntries(Object.entries(preset).map(([k, v]) => [k, v ?? false])) };
    if (target === "new") setNewPerms(applied);
    else if (typeof target === "number") setEditStaffPerms((prev) => ({ ...prev, [target]: applied }));
    else setEditAdminPerms((prev) => ({ ...prev, [target]: applied }));
  }

  async function handlePromoteToSuper() {
    if (!promoteTarget) return;
    setPromoting(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/users/${promoteTarget.clerkId}/admin-level`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ adminLevel: "super" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error ?? "Failed to promote admin");
      }
      queryClient.invalidateQueries({ queryKey: ["admin-users-list"] });
      queryClient.invalidateQueries({ queryKey: ["staff-profiles"] });
      const name = [promoteTarget.firstName, promoteTarget.lastName].filter(Boolean).join(" ") || promoteTarget.email;
      toast({ title: "Promoted to Super Admin", description: `${name} now has full admin access.` });
      setPromoteTarget(null);
    } catch (err: any) {
      toast({ title: "Failed to promote", description: err.message, variant: "destructive" });
    } finally {
      setPromoting(false);
    }
  }

  async function handleDowngradeToScoped(adminUser: AdminUser) {
    const token = await getToken();
    const res = await fetch(`${API_BASE}/admin/users/${adminUser.clerkId}/admin-level`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ adminLevel: "scoped" }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast({ title: "Failed to downgrade", description: (err as any).error ?? "Unknown error", variant: "destructive" });
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["admin-users-list"] });
    queryClient.invalidateQueries({ queryKey: ["staff-profiles"] });
    const name = [adminUser.firstName, adminUser.lastName].filter(Boolean).join(" ") || adminUser.email;
    toast({ title: "Downgraded to Scoped Admin", description: `${name} now has limited access. Configure their permissions below.` });
  }

  if (profileLoading) {
    return <Layout><div className="p-12"><Skeleton className="h-64" /></div></Layout>;
  }

  if (!profile || (profile.role !== "admin" && profile.adminLevel !== "super" && profile.adminLevel !== "admin")) {
    return <Redirect to="/dashboard" />;
  }

  const myClerkId = profile.clerkId;

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-5xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold font-sans uppercase tracking-tight text-primary">Staff & Admin Management</h1>
            <p className="text-muted-foreground mt-1">Manage admin levels and grant scoped permissions to staff members</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => history.back()}>Back to Admin</Button>
            {isSuperAdmin && (
              <>
                <Link href="/admin/roles">
                  <Button variant="outline" className="gap-2">
                    <UserCog className="h-4 w-4" />
                    Role Manager
                  </Button>
                </Link>
                <Button variant="outline" onClick={openGrantAdminDialog} className="gap-2">
                  <UserPlus className="h-4 w-4" />
                  Grant Admin Access
                </Button>
                <Button onClick={() => setShowForm((v) => !v)}>
                  {showForm ? "Cancel" : "Add Staff Member"}
                </Button>
              </>
            )}
          </div>
        </div>

        {/* ── Admin Users Section ── */}
        <div className="mb-10">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Admin Users
          </h2>

          {adminUsersLoading ? (
            <div className="space-y-3">{[1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div>
          ) : (
            <div className="space-y-4">
              {(adminUsers ?? []).map((adminUser) => {
                const level = adminUser.adminLevel ?? "super";
                const isScoped = level === "scoped";
                const isOwnRow = adminUser.clerkId === myClerkId;
                const displayName = [adminUser.firstName, adminUser.lastName].filter(Boolean).join(" ") || adminUser.email;
                const sp = staffProfileByUserId[adminUser.id];
                const isEditingAdmin = editingAdminClerkId === adminUser.clerkId;
                const currentAdminPerms = isEditingAdmin
                  ? (editAdminPerms[adminUser.clerkId] ?? (sp ? permissionsFromProfile(sp) : defaultPerms()))
                  : (sp ? permissionsFromProfile(sp) : defaultPerms());

                return (
                  <Card key={adminUser.clerkId} className={isOwnRow ? "border-primary/40" : ""}>
                    <CardContent className="pt-5">
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold">{displayName}</p>
                            {isOwnRow && <span className="text-xs text-primary font-medium">(you)</span>}
                            <p className="text-sm text-muted-foreground">{adminUser.email}</p>
                            {isScoped ? (
                              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                                <ShieldAlert className="h-3 w-3" />
                                Scoped Admin
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border border-red-200 dark:border-red-800">
                                <Shield className="h-3 w-3" />
                                Super Admin
                              </span>
                            )}
                          </div>
                        </div>
                        {isSuperAdmin && !isOwnRow && (
                          <div className="flex gap-2 flex-shrink-0">
                            {isScoped ? (
                              <>
                                {isEditingAdmin ? (
                                  <>
                                    <Button size="sm" variant="outline" onClick={() => {
                                      setEditingAdminClerkId(null);
                                      setEditAdminPerms((prev) => { const next = { ...prev }; delete next[adminUser.clerkId]; return next; });
                                    }}>Cancel</Button>
                                    <Button
                                      size="sm"
                                      disabled={updateAdminPerms.isPending}
                                      onClick={() => {
                                        if (!sp) return;
                                        updateAdminPerms.mutate({ profileId: sp.id, clerkId: adminUser.clerkId, perms: editAdminPerms[adminUser.clerkId] ?? {} });
                                      }}
                                    >
                                      {updateAdminPerms.isPending ? "Saving…" : "Save Permissions"}
                                    </Button>
                                  </>
                                ) : (
                                  <>
                                    <Button size="sm" variant="outline" onClick={() => {
                                      setEditingAdminClerkId(adminUser.clerkId);
                                      if (sp) setEditAdminPerms((prev) => ({ ...prev, [adminUser.clerkId]: permissionsFromProfile(sp) }));
                                    }}>
                                      Edit Permissions
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => setPromoteTarget(adminUser)} className="border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20">
                                      Promote to Super
                                    </Button>
                                  </>
                                )}
                              </>
                            ) : (
                              <Button size="sm" variant="outline" onClick={() => handleDowngradeToScoped(adminUser)} className="text-muted-foreground">
                                Make Scoped
                              </Button>
                            )}
                          </div>
                        )}
                      </div>

                      {isScoped && (
                        <div className="mt-3 pt-3 border-t border-border">
                          {isEditingAdmin && (
                            <div className="mb-3">
                              <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide mb-2">Quick Presets</p>
                              <div className="flex flex-wrap gap-2 mb-2">
                                {PERMISSION_PRESETS.map((p, i) => (
                                  <Button key={p.label} variant="outline" size="sm" onClick={() => applyPreset(adminUser.clerkId, i)}>
                                    {p.label}
                                  </Button>
                                ))}
                              </div>
                            </div>
                          )}
                          <PermissionToggles
                            perms={currentAdminPerms}
                            editing={isEditingAdmin}
                            onChange={(key, val) =>
                              setEditAdminPerms((prev) => ({
                                ...prev,
                                [adminUser.clerkId]: { ...(prev[adminUser.clerkId] ?? currentAdminPerms), [key]: val },
                              }))
                            }
                          />
                          {!sp && !isEditingAdmin && (
                            <p className="text-xs text-muted-foreground mt-2 italic">No permissions configured yet. Click "Edit Permissions" to set them.</p>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Staff Members Section ── */}
        <div>
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Shield className="h-5 w-5 text-muted-foreground" />
            Staff Members
          </h2>

          {showForm && isSuperAdmin && (
            <Card className="mb-6">
              <CardHeader><CardTitle>New Staff Profile</CardTitle></CardHeader>
              <CardContent>
                <div className="grid gap-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-1.5">
                      <Label htmlFor="userSearch">User Account</Label>
                      {newUserSelected ? (
                        <div className="flex items-center gap-2 h-10 px-3 rounded-md border border-input bg-muted/40">
                          <span className="text-sm flex-1 truncate">
                            {[newUserSelected.firstName, newUserSelected.lastName].filter(Boolean).join(" ") || newUserSelected.email}
                            <span className="text-muted-foreground ml-1 text-xs">{newUserSelected.email}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => { setNewUserSelected(null); setNewUserQuery(""); }}
                            className="text-muted-foreground hover:text-foreground text-xs shrink-0"
                          >
                            Change
                          </button>
                        </div>
                      ) : (
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                          <Input
                            id="userSearch"
                            placeholder="Search by name or email…"
                            value={newUserQuery}
                            onChange={(e) => setNewUserQuery(e.target.value)}
                            className="pl-9"
                            autoComplete="off"
                          />
                          {newUserQuery.trim().length >= 2 && (
                            <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-md overflow-hidden">
                              {newStaffSearchFetching ? (
                                <div className="px-3 py-2 text-sm text-muted-foreground">Searching…</div>
                              ) : !newStaffSearchResults?.length ? (
                                <div className="px-3 py-2 text-sm text-muted-foreground">No users found</div>
                              ) : (
                                newStaffSearchResults.map((u) => (
                                  <button
                                    key={u.id}
                                    type="button"
                                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center justify-between gap-2"
                                    onClick={() => { setNewUserSelected(u); setNewUserQuery(""); }}
                                  >
                                    <span className="font-medium truncate">
                                      {[u.firstName, u.lastName].filter(Boolean).join(" ") || u.email}
                                    </span>
                                    <span className="text-muted-foreground text-xs shrink-0">{u.email}</span>
                                  </button>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="title">Title (optional)</Label>
                      <Input
                        id="title"
                        placeholder="e.g. League Coordinator"
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                      />
                    </div>
                  </div>

                  <div>
                    <Label className="mb-2 block">Quick Presets</Label>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {PERMISSION_PRESETS.map((p, i) => (
                        <Button key={p.label} variant="outline" size="sm" onClick={() => applyPreset("new", i)}>
                          {p.label}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <Label className="mb-2 block">Permissions</Label>
                    <PermissionToggles
                      perms={newPerms}
                      editing={true}
                      onChange={(key, val) => setNewPerms((prev) => ({ ...prev, [key]: val }))}
                    />
                  </div>

                  <Button
                    onClick={() => createStaff.mutate()}
                    disabled={!newUserSelected || createStaff.isPending}
                  >
                    {createStaff.isPending ? "Creating..." : "Create Staff Profile"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {staffLoading ? (
            <div className="space-y-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-32" />)}</div>
          ) : (
            <div className="space-y-4">
              {staffProfiles?.map((sp) => {
                const isEditing = editingStaffId === sp.id;
                const currentPerms = isEditing
                  ? (editStaffPerms[sp.id] ?? permissionsFromProfile(sp))
                  : permissionsFromProfile(sp);
                const tr = trainingByUserId[sp.userId];

                return (
                  <Card key={sp.id}>
                    <CardContent className="pt-5">
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold">User #{sp.userId}</p>
                            {sp.title && <span className="text-sm text-muted-foreground">— {sp.title}</span>}
                            <span className={`text-xs px-2 py-0.5 rounded font-medium ${sp.isActive ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" : "bg-muted text-muted-foreground"}`}>
                              {sp.isActive ? "Active" : "Inactive"}
                            </span>
                            {tr && (
                              tr.trainingStatus === "complete" && tr.trainingCompletedAt ? (
                                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Training Complete · {format(new Date(tr.trainingCompletedAt), "MMM d, yyyy")}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                                  <Clock className="h-3 w-3" />
                                  Training Pending
                                </span>
                              )
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">Added {format(new Date(sp.createdAt), "MMM d, yyyy")}</p>
                        </div>
                        <div className="flex flex-col gap-1 items-end">
                          {connectStatusBadge((sp as any).connectOnboardingStatus ?? "pending")}
                          {(isSuperAdmin || canManageUsers) && (
                            <div className="flex gap-2 mt-1 flex-wrap justify-end">
                              {isEditing ? (
                                <>
                                  <Button size="sm" variant="outline" onClick={() => {
                                    setEditingStaffId(null);
                                    setEditStaffPerms((prev) => { const next = { ...prev }; delete next[sp.id]; return next; });
                                  }}>
                                    Cancel
                                  </Button>
                                  <Button
                                    size="sm"
                                    onClick={() => updateStaffPerms.mutate({ id: sp.id, perms: editStaffPerms[sp.id] ?? {} })}
                                    disabled={updateStaffPerms.isPending}
                                  >
                                    {updateStaffPerms.isPending ? "Saving..." : "Save"}
                                  </Button>
                                </>
                              ) : (
                                <>
                                  {(isSuperAdmin || canManagePayouts) && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="gap-1"
                                      disabled={invitingStaffUserId === sp.userId || connectInviteMut.isPending}
                                      onClick={() => {
                                        setInvitingStaffUserId(sp.userId);
                                        connectInviteMut.mutate(sp.userId);
                                      }}
                                      title="Send Stripe Connect onboarding invite"
                                    >
                                      <Mail className="h-3.5 w-3.5" />
                                      {invitingStaffUserId === sp.userId ? "Sending…" : "Invite to Payout"}
                                    </Button>
                                  )}
                                  <Button size="sm" variant="outline" onClick={() => { setEditStaffTarget(sp); setEditStaffForm({ title: sp.title ?? "", bio: sp.bio ?? "", notes: sp.notes ?? "" }); }}>
                                    <Pencil className="h-3.5 w-3.5 mr-1" /> Edit Profile
                                  </Button>
                                  {isSuperAdmin && <Button size="sm" variant="outline" onClick={() => startEditStaff(sp)}>Edit Permissions</Button>}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {isEditing && isSuperAdmin && (
                        <div className="mb-3">
                          <Label className="mb-1.5 block text-xs font-semibold uppercase text-muted-foreground">Quick Presets</Label>
                          <div className="flex flex-wrap gap-2 mb-2">
                            {PERMISSION_PRESETS.map((p, i) => (
                              <Button key={p.label} variant="outline" size="sm" onClick={() => applyPreset(sp.id, i)}>
                                {p.label}
                              </Button>
                            ))}
                          </div>
                        </div>
                      )}

                      <PermissionToggles
                        perms={currentPerms}
                        editing={isEditing && isSuperAdmin}
                        onChange={(key, val) =>
                          setEditStaffPerms((prev) => ({
                            ...prev,
                            [sp.id]: { ...(prev[sp.id] ?? permissionsFromProfile(sp)), [key]: val },
                          }))
                        }
                      />
                    </CardContent>
                  </Card>
                );
              })}
              {!staffProfiles?.length && !showForm && (
                <div className="text-center py-12 text-muted-foreground">
                  <p className="mb-4">No staff profiles yet.</p>
                  {isSuperAdmin && <Button onClick={() => setShowForm(true)}>Add the First Staff Member</Button>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Edit Staff Profile Dialog */}
      <Dialog open={editStaffTarget !== null} onOpenChange={(open) => { if (!open) setEditStaffTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Staff Profile</DialogTitle>
            <DialogDescription>Update title, bio, and notes for staff member #{editStaffTarget?.userId}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="mb-1 block">Title</Label>
              <Input
                value={editStaffForm.title}
                onChange={(e) => setEditStaffForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Head Coach, Program Director"
              />
            </div>
            <div>
              <Label className="mb-1 block">Bio</Label>
              <textarea
                className="w-full min-h-[80px] text-sm rounded-md border border-input bg-background px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                value={editStaffForm.bio}
                onChange={(e) => setEditStaffForm((f) => ({ ...f, bio: e.target.value }))}
                placeholder="Short bio"
              />
            </div>
            <div>
              <Label className="mb-1 block">Internal Notes</Label>
              <textarea
                className="w-full min-h-[80px] text-sm rounded-md border border-input bg-background px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                value={editStaffForm.notes}
                onChange={(e) => setEditStaffForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Notes (internal only)"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditStaffTarget(null)} disabled={patchStaffProfile.isPending}>Cancel</Button>
            <Button
              onClick={() => editStaffTarget && patchStaffProfile.mutate({
                id: editStaffTarget.id,
                updates: {
                  title: editStaffForm.title || null,
                  bio: editStaffForm.bio || null,
                  notes: editStaffForm.notes || null,
                },
              })}
              disabled={patchStaffProfile.isPending}
            >
              {patchStaffProfile.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Grant Admin Access Dialog ── */}
      <Dialog open={grantAdminOpen} onOpenChange={(open) => { if (!open && !granting) { setGrantAdminOpen(false); } }}>
        <DialogContent className="max-w-md">
          {grantStep === "search" && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <UserPlus className="h-5 w-5 text-primary" />
                  Grant Admin Access
                </DialogTitle>
                <DialogDescription>
                  Search for a user by name or email to promote them to admin.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    className="pl-9"
                    placeholder="Name or email…"
                    value={grantQuery}
                    onChange={(e) => setGrantQuery(e.target.value)}
                    autoFocus
                  />
                </div>

                {grantQuery.trim().length >= 2 && (
                  <div className="border rounded-md divide-y max-h-64 overflow-y-auto">
                    {searchFetching && (
                      <div className="p-3 text-sm text-muted-foreground text-center">Searching…</div>
                    )}
                    {!searchFetching && userSearchResults?.length === 0 && (
                      <div className="p-3 text-sm text-muted-foreground text-center">No users found</div>
                    )}
                    {!searchFetching && userSearchResults?.map((u) => {
                      const name = [u.firstName, u.lastName].filter(Boolean).join(" ") || null;
                      return (
                        <button
                          key={u.clerkId}
                          className="w-full text-left px-3 py-2.5 hover:bg-muted transition-colors flex items-center justify-between gap-2"
                          onClick={() => {
                            setGrantSelected(u);
                            setGrantStep("level");
                          }}
                        >
                          <div className="min-w-0">
                            {name && <p className="text-sm font-medium truncate">{name}</p>}
                            <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-xs px-2 py-0.5 rounded border border-border text-muted-foreground capitalize">{u.role}</span>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
                {grantQuery.trim().length < 2 && (
                  <p className="text-xs text-muted-foreground text-center py-2">Type at least 2 characters to search</p>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setGrantAdminOpen(false)}>Cancel</Button>
              </DialogFooter>
            </>
          )}

          {grantStep === "level" && grantSelected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-primary" />
                  Choose Admin Level
                </DialogTitle>
                <DialogDescription>
                  Select the level of admin access for <strong>{[grantSelected.firstName, grantSelected.lastName].filter(Boolean).join(" ") || grantSelected.email}</strong>.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <button
                  className={`w-full text-left rounded-lg border p-4 transition-colors ${grantLevel === "scoped" ? "border-primary bg-primary/5" : "border-border hover:bg-muted"}`}
                  onClick={() => setGrantLevel("scoped")}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <ShieldAlert className="h-4 w-4 text-amber-600" />
                    <span className="font-semibold text-sm">Scoped Admin</span>
                    {grantLevel === "scoped" && <span className="text-xs text-primary font-medium ml-auto">Selected</span>}
                  </div>
                  <p className="text-xs text-muted-foreground">Limited access — you choose exactly which areas they can manage. Good for program coordinators, registration staff, and schedulers.</p>
                </button>
                <button
                  className={`w-full text-left rounded-lg border p-4 transition-colors ${grantLevel === "super" ? "border-red-400 bg-red-50 dark:bg-red-900/10" : "border-border hover:bg-muted"}`}
                  onClick={() => setGrantLevel("super")}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Shield className="h-4 w-4 text-red-600" />
                    <span className="font-semibold text-sm">Super Admin</span>
                    {grantLevel === "super" && <span className="text-xs text-red-600 font-medium ml-auto">Selected</span>}
                  </div>
                  <p className="text-xs text-muted-foreground">Full, unrestricted access to every feature — including the ability to promote or demote other admins. Use sparingly.</p>
                </button>
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setGrantStep("search")}>Back</Button>
                <Button onClick={() => setGrantStep("confirm")}>
                  Continue
                </Button>
              </DialogFooter>
            </>
          )}

          {grantStep === "confirm" && grantSelected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Shield className={`h-5 w-5 ${grantLevel === "super" ? "text-red-500" : "text-amber-500"}`} />
                  Confirm Admin Promotion
                </DialogTitle>
                <DialogDescription>
                  Review the details below before granting access.
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-lg bg-muted/50 p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">User</span>
                  <span className="font-medium">{[grantSelected.firstName, grantSelected.lastName].filter(Boolean).join(" ") || "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Email</span>
                  <span className="font-medium">{grantSelected.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">New role</span>
                  <span className={`font-semibold ${grantLevel === "super" ? "text-red-600" : "text-amber-600"}`}>
                    {grantLevel === "super" ? "Super Admin" : "Scoped Admin"}
                  </span>
                </div>
              </div>
              {grantLevel === "super" && (
                <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 text-xs text-red-700 dark:text-red-400">
                  Super admins have full, unrestricted access including the ability to manage other admins.
                </div>
              )}
              <p className="text-xs text-muted-foreground">The user will receive an in-app notification that their role has been updated.</p>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setGrantStep("level")} disabled={granting}>Back</Button>
                <Button
                  onClick={handleGrantAdmin}
                  disabled={granting}
                  className={grantLevel === "super" ? "bg-red-600 hover:bg-red-700 text-white" : ""}
                >
                  {granting ? "Granting…" : "Grant Access"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Promote to Super Admin Confirmation */}
      <Dialog open={!!promoteTarget} onOpenChange={(open) => { if (!open && !promoting) setPromoteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-red-500" />
              Promote to Super Admin
            </DialogTitle>
            <DialogDescription>
              This will give <strong>{promoteTarget ? ([promoteTarget.firstName, promoteTarget.lastName].filter(Boolean).join(" ") || promoteTarget.email) : ""}</strong> full, unrestricted access to every feature in the admin panel. This cannot be undone without manually reverting them to Scoped.
            </DialogDescription>
          </DialogHeader>
          <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-1">
            <p className="text-muted-foreground">Super admins can:</p>
            <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
              <li>Access all features without any restrictions</li>
              <li>Promote or demote other admins</li>
              <li>Change user roles and system configuration</li>
            </ul>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPromoteTarget(null)} disabled={promoting}>Cancel</Button>
            <Button onClick={handlePromoteToSuper} disabled={promoting} className="bg-red-600 hover:bg-red-700 text-white">
              {promoting ? "Promoting…" : "Confirm Promotion"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
