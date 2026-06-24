import React, { useState } from "react";
import { Redirect, Link } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { format } from "date-fns";
import { ShieldCheck, ShieldAlert, Search, User, ShieldPlus, X, Plus, Shield, ExternalLink, Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAdminPermissions } from "@/hooks/use-admin-permissions";

const ALL_PRIMARY_ROLES = ["player", "parent", "ref", "coach", "scorekeeper", "staff", "admin"] as const;
const MULTI_ROLES = ["player", "parent", "ref", "coach", "scorekeeper"] as const;
type PrimaryRole = typeof ALL_PRIMARY_ROLES[number];
type MultiRole = typeof MULTI_ROLES[number];

const ROLE_LABELS: Record<string, string> = {
  player: "Player",
  parent: "Parent",
  ref: "Ref",
  coach: "Coach",
  scorekeeper: "Scorekeeper",
  staff: "Staff",
  admin: "Admin",
  team_manager: "Team Manager",
  team_coach: "Team Coach",
};

const ROLE_COLORS: Record<string, string> = {
  player: "bg-blue-50 text-blue-700 border-blue-200",
  parent: "bg-purple-50 text-purple-700 border-purple-200",
  ref: "bg-orange-50 text-orange-700 border-orange-200",
  coach: "bg-green-50 text-green-700 border-green-200",
  scorekeeper: "bg-cyan-50 text-cyan-700 border-cyan-200",
  staff: "bg-gray-50 text-gray-700 border-gray-200",
  admin: "bg-red-50 text-red-700 border-red-200",
  team_manager: "bg-amber-50 text-amber-700 border-amber-200",
  team_coach: "bg-teal-50 text-teal-700 border-teal-200",
};

interface UserRow {
  id: number;
  clerkId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  role: string;
  roles: string[];
  adminLevel?: string;
  playonId: string | null;
  idVerified: boolean | null;
  idVerifiedAt: string | null;
  createdAt: string;
}

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

function ManagedTeamsSection({ clerkId }: { clerkId: string }) {
  const { getToken } = useAuth();
  const { data: teams, isLoading } = useQuery<Array<{ id: number; name: string; role: string }>>({
    queryKey: ["user-managed-teams", clerkId],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/users/${clerkId}/managed-teams`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.ok ? res.json() : [];
    },
    staleTime: 120_000,
  });
  if (isLoading) return <span className="text-xs text-muted-foreground">Loading…</span>;
  if (!teams?.length) return <span className="text-xs text-muted-foreground italic">no teams yet</span>;
  return (
    <div className="flex gap-1 flex-wrap">
      {teams.map((t) => (
        <span key={t.id} className="text-xs px-2 py-0.5 rounded-full border bg-muted font-medium">
          {t.name} <span className="text-muted-foreground capitalize">({t.role})</span>
        </span>
      ))}
    </div>
  );
}

interface PendingRoleChange {
  clerkId: string;
  displayName: string;
  oldRole: string;
  newRole: string;
}

export default function AdminPlayers() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { canManageUsers, isSuperAdmin } = useAdminPermissions();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");

  const [approveTarget, setApproveTarget] = useState<UserRow | null>(null);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());

  const [pendingRoleChange, setPendingRoleChange] = useState<PendingRoleChange | null>(null);
  const [confirmingRole, setConfirmingRole] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [editProfileTarget, setEditProfileTarget] = useState<UserRow | null>(null);
  const [editProfileForm, setEditProfileForm] = useState({ firstName: "", lastName: "", email: "", phone: "", dateOfBirth: "", emergencyContactName: "", emergencyContactPhone: "" });
  const [editProfileSaving, setEditProfileSaving] = useState(false);

  const [savingRoles, setSavingRoles] = useState<Record<string, boolean>>({});
  const [addRoleOpen, setAddRoleOpen] = useState<Record<string, boolean>>({});

  const { data: users, isLoading } = useQuery<UserRow[]>({
    queryKey: ["admin-users", search, roleFilter],
    enabled: !profileLoading && (profile?.role === "admin" || profile?.adminLevel === "super" || profile?.adminLevel === "admin"),
    queryFn: async () => {
      const token = await getToken();
      const params = new URLSearchParams();
      if (roleFilter !== "all") params.set("role", roleFilter);
      if (search) params.set("q", search);
      const res = await fetch(`${API_BASE}/users?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load users");
      const data = await res.json();
      return data.map((u: any) => ({ ...u, roles: u.roles ?? [] }));
    },
  });

  if (profileLoading) return <Layout><div className="p-12"><Skeleton className="h-64" /></div></Layout>;
  if (!profile || (profile.role !== "admin" && profile.adminLevel !== "super" && profile.adminLevel !== "admin")) return <Redirect to="/dashboard" />;

  const total = users?.length ?? 0;
  const verifiedCount = users?.filter((u) => u.idVerified || approvedIds.has(u.clerkId)).length ?? 0;

  async function handleApprove() {
    if (!approveTarget) return;
    setApproving(true);
    setApproveError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/users/${approveTarget.clerkId}/approve-id`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to approve ID");
      }
      setApprovedIds((prev) => new Set([...prev, approveTarget.clerkId]));
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      setApproveTarget(null);
    } catch (err: any) {
      setApproveError(err.message ?? "An error occurred");
    } finally {
      setApproving(false);
    }
  }

  async function patchUser(clerkId: string, body: object) {
    const token = await getToken();
    const res = await fetch(`${API_BASE}/users/${clerkId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "Failed to update user");
    }
    return res.json();
  }

  async function handleConfirmRoleChange() {
    if (!pendingRoleChange) return;
    setConfirmingRole(true);
    try {
      await patchUser(pendingRoleChange.clerkId, { role: pendingRoleChange.newRole });
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      toast({ title: "Role updated", description: `${pendingRoleChange.displayName} is now a ${ROLE_LABELS[pendingRoleChange.newRole]}.` });
      setPendingRoleChange(null);
    } catch (err: any) {
      toast({ title: "Failed to update role", description: err.message, variant: "destructive" });
    } finally {
      setConfirmingRole(false);
    }
  }

  async function handleEditProfile() {
    if (!editProfileTarget) return;
    setEditProfileSaving(true);
    try {
      await patchUser(editProfileTarget.clerkId, {
        firstName: editProfileForm.firstName || undefined,
        lastName: editProfileForm.lastName || undefined,
        email: editProfileForm.email || undefined,
        phone: editProfileForm.phone || undefined,
        dateOfBirth: editProfileForm.dateOfBirth ? new Date(editProfileForm.dateOfBirth).toISOString() : null,
        emergencyContactName: editProfileForm.emergencyContactName || null,
        emergencyContactPhone: editProfileForm.emergencyContactPhone || null,
      } as any);
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      toast({ title: "Profile updated" });
      setEditProfileTarget(null);
    } catch (err: any) {
      toast({ title: "Failed to update profile", description: err.message, variant: "destructive" });
    } finally {
      setEditProfileSaving(false);
    }
  }

  async function handleDeleteUser() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/users/${deleteTarget.clerkId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to delete user");
      }
      queryClient.setQueryData<UserRow[]>(["admin-users", search, roleFilter], (prev) =>
        prev ? prev.filter((u) => u.clerkId !== deleteTarget.clerkId) : prev,
      );
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["admin-clerk-users"] });
      const name = [deleteTarget.firstName, deleteTarget.lastName].filter(Boolean).join(" ") || deleteTarget.email;
      toast({ title: "User deleted", description: `${name} has been permanently removed.` });
      setDeleteTarget(null);
    } catch (err: any) {
      setDeleteError(err.message ?? "An error occurred");
    } finally {
      setDeleting(false);
    }
  }

  async function handleToggleMultiRole(user: UserRow, role: string, add: boolean) {
    const key = `${user.clerkId}:${role}`;
    setSavingRoles((prev) => ({ ...prev, [key]: true }));
    const newRoles = add
      ? [...new Set([...user.roles, role])]
      : user.roles.filter((r) => r !== role);
    try {
      await patchUser(user.clerkId, { roles: newRoles });
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      toast({ title: add ? "Role added" : "Role removed" });
    } catch (err: any) {
      toast({ title: "Failed to update roles", description: err.message, variant: "destructive" });
    } finally {
      setSavingRoles((prev) => ({ ...prev, [key]: false }));
      if (add) setAddRoleOpen((prev) => ({ ...prev, [user.clerkId]: false }));
    }
  }

  const myClerkId = profile.clerkId;

  return (
    <TooltipProvider>
      <Layout>
        <div className="container mx-auto px-4 py-12 max-w-5xl">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold font-sans uppercase tracking-tight text-primary">
                User Directory
              </h1>
              <p className="text-muted-foreground mt-1">
                All registered accounts — manage roles and ID verification
              </p>
            </div>
            <Button variant="outline" onClick={() => history.back()}>Back to Admin</Button>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            <Card>
              <CardContent className="pt-5 text-center">
                <p className="text-3xl font-bold">{total}</p>
                <p className="text-sm text-muted-foreground mt-1">Total Users</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5 text-center">
                <p className="text-3xl font-bold text-green-600">{verifiedCount}</p>
                <p className="text-sm text-muted-foreground mt-1">ID Verified</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5 text-center">
                <p className="text-3xl font-bold text-amber-600">{total - verifiedCount}</p>
                <p className="text-sm text-muted-foreground mt-1">Pending Verification</p>
              </CardContent>
            </Card>
          </div>

          {/* Search + role filter */}
          <div className="flex gap-3 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Filter by role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                {ALL_PRIMARY_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* User list */}
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28" />)}
            </div>
          ) : (
            <div className="space-y-3">
              {users?.map((user) => {
                const isVerified = user.idVerified || approvedIds.has(user.clerkId);
                const isOwnRow = user.clerkId === myClerkId;
                const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ") || "Unknown User";
                const availableToAdd = MULTI_ROLES.filter((r) => !user.roles.includes(r));

                return (
                  <Card key={user.id} className={isOwnRow ? "border-primary/30" : ""}>
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-start gap-4">
                        {/* Avatar */}
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <User className="w-5 h-5 text-primary" />
                        </div>

                        {/* User info + role controls */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-0.5">
                            <p className="font-semibold truncate">{displayName}</p>
                            {user.playonId && (
                              <span className="text-xs text-muted-foreground font-mono">{user.playonId}</span>
                            )}
                            {isOwnRow && (
                              <span className="text-xs text-primary font-medium">(you)</span>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground truncate mb-2">{user.email}</p>

                          {/* Primary role dropdown */}
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs text-muted-foreground w-20 flex-shrink-0">Primary role</span>
                            {isOwnRow ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="inline-flex items-center">
                                    <Select value={user.role} disabled>
                                      <SelectTrigger className="h-7 text-xs w-36 opacity-50 cursor-not-allowed">
                                        <SelectValue />
                                      </SelectTrigger>
                                    </Select>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent>
                                  You cannot change your own role
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <Select
                                value={user.role}
                                onValueChange={(newRole) => {
                                  if (newRole === user.role) return;
                                  setPendingRoleChange({ clerkId: user.clerkId, displayName, oldRole: user.role, newRole });
                                }}
                              >
                                <SelectTrigger className="h-7 text-xs w-36">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {ALL_PRIMARY_ROLES.map((r) => (
                                    <SelectItem key={r} value={r} className="text-xs">
                                      {ROLE_LABELS[r]}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </div>

                          {/* Admin level indicator — only for admin users */}
                          {user.role === "admin" && (
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-xs text-muted-foreground w-20 flex-shrink-0">Admin level</span>
                              {user.adminLevel === "scoped" ? (
                                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                                  <ShieldAlert className="h-3 w-3" />
                                  Scoped
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border border-red-200 dark:border-red-800">
                                  <Shield className="h-3 w-3" />
                                  Super
                                </span>
                              )}
                              <Link href="/admin/staff" className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline underline-offset-2">
                                <ExternalLink className="h-3 w-3" />
                                Permissions
                              </Link>
                            </div>
                          )}

                          {/* Multi-role badges */}
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs text-muted-foreground w-20 flex-shrink-0">Also has</span>
                            {user.roles.length === 0 && !isOwnRow && (
                              <span className="text-xs text-muted-foreground italic">no extra roles</span>
                            )}
                            {user.roles.map((r) => {
                              const key = `${user.clerkId}:${r}`;
                              return (
                                <span
                                  key={r}
                                  className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${ROLE_COLORS[r] ?? "bg-gray-50 text-gray-700 border-gray-200"}`}
                                >
                                  {ROLE_LABELS[r] ?? r}
                                  {!isOwnRow && (
                                    <button
                                      onClick={() => handleToggleMultiRole(user, r, false)}
                                      disabled={savingRoles[key]}
                                      className="ml-0.5 hover:opacity-70 disabled:opacity-40"
                                      aria-label={`Remove ${r} role`}
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  )}
                                </span>
                              );
                            })}
                            {!isOwnRow && availableToAdd.length > 0 && (
                              addRoleOpen[user.clerkId] ? (
                                <Select
                                  onValueChange={(r) => {
                                    handleToggleMultiRole(user, r, true);
                                    setAddRoleOpen((prev) => ({ ...prev, [user.clerkId]: false }));
                                  }}
                                  onOpenChange={(open) => {
                                    if (!open) setAddRoleOpen((prev) => ({ ...prev, [user.clerkId]: false }));
                                  }}
                                >
                                  <SelectTrigger className="h-6 text-xs w-32">
                                    <SelectValue placeholder="Pick role…" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {availableToAdd.map((r) => (
                                      <SelectItem key={r} value={r} className="text-xs">
                                        {ROLE_LABELS[r]}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <button
                                  onClick={() => setAddRoleOpen((prev) => ({ ...prev, [user.clerkId]: true }))}
                                  className="inline-flex items-center gap-0.5 text-xs text-muted-foreground border border-dashed border-muted-foreground/40 rounded-full px-2 py-0.5 hover:border-primary hover:text-primary transition-colors"
                                  aria-label="Add role"
                                >
                                  <Plus className="w-3 h-3" />
                                  Add
                                </button>
                              )
                            )}
                          </div>

                          {/* Managed teams — only for team role holders */}
                          {(user.roles.includes("team_manager") || user.roles.includes("team_coach")) && (
                            <div className="flex items-center gap-2 mt-1.5">
                              <span className="text-xs text-muted-foreground w-20 flex-shrink-0">Manages</span>
                              <ManagedTeamsSection clerkId={user.clerkId} />
                            </div>
                          )}
                        </div>

                        {/* ID Verification Badge + Approve Button + Edit Profile */}
                        <div className="flex-shrink-0 flex flex-col items-end gap-2">
                          {canManageUsers && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                              onClick={() => {
                                setEditProfileTarget(user);
                                setEditProfileForm({
                                  firstName: user.firstName ?? "",
                                  lastName: user.lastName ?? "",
                                  email: user.email ?? "",
                                  phone: user.phone ?? "",
                                  dateOfBirth: user.dateOfBirth ? user.dateOfBirth.slice(0, 10) : "",
                                  emergencyContactName: (user as any).emergencyContactName ?? "",
                                  emergencyContactPhone: (user as any).emergencyContactPhone ?? "",
                                });
                              }}
                            >
                              <Pencil className="w-3 h-3" />
                              Edit Profile
                            </Button>
                          )}
                          {isSuperAdmin && !isOwnRow && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs gap-1 text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => { setDeleteTarget(user); setDeleteError(null); }}
                            >
                              <Trash2 className="w-3 h-3" />
                              Delete User
                            </Button>
                          )}
                          {isVerified ? (
                            <div className="flex flex-col items-end gap-1">
                              <div className="flex items-center gap-1.5 bg-green-50 text-green-700 border border-green-200 px-2.5 py-1 rounded-full">
                                <ShieldCheck className="w-3.5 h-3.5" />
                                <span className="text-xs font-semibold">ID Verified</span>
                              </div>
                              {user.idVerifiedAt && (
                                <p className="text-xs text-muted-foreground">
                                  {format(new Date(user.idVerifiedAt), "MMM d, yyyy")}
                                </p>
                              )}
                              {approvedIds.has(user.clerkId) && !user.idVerified && (
                                <p className="text-xs text-muted-foreground italic">manually approved</p>
                              )}
                            </div>
                          ) : (
                            <div className="flex flex-col items-end gap-2">
                              <div className="flex items-center gap-1.5 bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-1 rounded-full">
                                <ShieldAlert className="w-3.5 h-3.5" />
                                <span className="text-xs font-semibold">Unverified</span>
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/5"
                                onClick={() => { setApproveTarget(user); setApproveError(null); }}
                              >
                                <ShieldPlus className="w-3.5 h-3.5" />
                                Manually Approve
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
              {!isLoading && !users?.length && (
                <p className="text-muted-foreground text-center py-12">No users found.</p>
              )}
            </div>
          )}
        </div>

        {/* Primary Role Change Confirmation Dialog */}
        <Dialog open={!!pendingRoleChange} onOpenChange={(open) => { if (!open && !confirmingRole) setPendingRoleChange(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Change Primary Role</DialogTitle>
              <DialogDescription>
                This will update the user's primary role and send them an in-app notification.
              </DialogDescription>
            </DialogHeader>
            {pendingRoleChange && (
              <div className="bg-muted/50 rounded-lg p-4 space-y-1.5 text-sm">
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-20 flex-shrink-0">User</span>
                  <span className="font-medium">{pendingRoleChange.displayName}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-20 flex-shrink-0">From</span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium ${ROLE_COLORS[pendingRoleChange.oldRole] ?? ""}`}>
                    {ROLE_LABELS[pendingRoleChange.oldRole] ?? pendingRoleChange.oldRole}
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-20 flex-shrink-0">To</span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium ${ROLE_COLORS[pendingRoleChange.newRole] ?? ""}`}>
                    {ROLE_LABELS[pendingRoleChange.newRole] ?? pendingRoleChange.newRole}
                  </span>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setPendingRoleChange(null)}
                disabled={confirmingRole}
              >
                Cancel
              </Button>
              <Button onClick={handleConfirmRoleChange} disabled={confirmingRole}>
                {confirmingRole ? "Saving…" : "Confirm Change"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Manual Approval Confirmation Dialog */}
        <Dialog open={!!approveTarget} onOpenChange={(open) => { if (!open && !approving) { setApproveTarget(null); setApproveError(null); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShieldPlus className="w-5 h-5 text-primary" />
                Manually Approve ID Verification
              </DialogTitle>
              <DialogDescription>
                You are about to manually mark this user as ID verified. Only do this if you have
                personally confirmed their identity through another means (e.g. in-person, staff review).
              </DialogDescription>
            </DialogHeader>

            {approveTarget && (
              <div className="bg-muted/50 rounded-lg p-4 space-y-1.5 text-sm">
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-16 flex-shrink-0">Name</span>
                  <span className="font-medium">
                    {[approveTarget.firstName, approveTarget.lastName].filter(Boolean).join(" ") || "—"}
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-16 flex-shrink-0">Email</span>
                  <span className="font-medium truncate">{approveTarget.email}</span>
                </div>
                {approveTarget.dateOfBirth && (
                  <div className="flex gap-2">
                    <span className="text-muted-foreground w-16 flex-shrink-0">DOB</span>
                    <span className="font-medium">
                      {format(new Date(approveTarget.dateOfBirth), "MMM d, yyyy")}
                    </span>
                  </div>
                )}
                {approveTarget.playonId && (
                  <div className="flex gap-2">
                    <span className="text-muted-foreground w-16 flex-shrink-0">PlayOn ID</span>
                    <span className="font-mono text-xs">{approveTarget.playonId}</span>
                  </div>
                )}
              </div>
            )}

            {approveError && (
              <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">{approveError}</p>
            )}

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => { setApproveTarget(null); setApproveError(null); }}
                disabled={approving}
              >
                Cancel
              </Button>
              <Button
                onClick={handleApprove}
                disabled={approving}
                className="gap-2"
              >
                <ShieldCheck className="w-4 h-4" />
                {approving ? "Approving…" : "Approve ID"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete User Confirmation Dialog */}
        <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !deleting) { setDeleteTarget(null); setDeleteError(null); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <Trash2 className="w-5 h-5" />
                Delete User
              </DialogTitle>
              <DialogDescription>
                This will permanently remove the user from the app and their login credentials. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>

            {deleteTarget && (
              <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-4 space-y-1.5 text-sm">
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-16 flex-shrink-0">Name</span>
                  <span className="font-medium">
                    {[deleteTarget.firstName, deleteTarget.lastName].filter(Boolean).join(" ") || "—"}
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-16 flex-shrink-0">Email</span>
                  <span className="font-medium truncate">{deleteTarget.email}</span>
                </div>
                {deleteTarget.playonId && (
                  <div className="flex gap-2">
                    <span className="text-muted-foreground w-16 flex-shrink-0">PlayOn ID</span>
                    <span className="font-mono text-xs">{deleteTarget.playonId}</span>
                  </div>
                )}
              </div>
            )}

            {deleteError && (
              <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">{deleteError}</p>
            )}

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => { setDeleteTarget(null); setDeleteError(null); }}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteUser}
                disabled={deleting}
                className="gap-2"
              >
                <Trash2 className="w-4 h-4" />
                {deleting ? "Deleting…" : "Delete User"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Profile Dialog */}
        <Dialog open={editProfileTarget !== null} onOpenChange={(open) => { if (!open) setEditProfileTarget(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Profile</DialogTitle>
              <DialogDescription>
                Update name and phone for {[editProfileTarget?.firstName, editProfileTarget?.lastName].filter(Boolean).join(" ") || editProfileTarget?.email}.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium mb-1 block">First Name</label>
                  <Input
                    value={editProfileForm.firstName}
                    onChange={(e) => setEditProfileForm((f) => ({ ...f, firstName: e.target.value }))}
                    placeholder="First name"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Last Name</label>
                  <Input
                    value={editProfileForm.lastName}
                    onChange={(e) => setEditProfileForm((f) => ({ ...f, lastName: e.target.value }))}
                    placeholder="Last name"
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Email</label>
                <Input
                  type="email"
                  value={editProfileForm.email}
                  onChange={(e) => setEditProfileForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="Email address"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium mb-1 block">Phone</label>
                  <Input
                    value={editProfileForm.phone}
                    onChange={(e) => setEditProfileForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="Phone number"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Date of Birth</label>
                  <Input
                    type="date"
                    value={editProfileForm.dateOfBirth}
                    onChange={(e) => setEditProfileForm((f) => ({ ...f, dateOfBirth: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium mb-1 block">Emergency Contact Name</label>
                  <Input
                    value={editProfileForm.emergencyContactName}
                    onChange={(e) => setEditProfileForm((f) => ({ ...f, emergencyContactName: e.target.value }))}
                    placeholder="Contact name"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Emergency Contact Phone</label>
                  <Input
                    value={editProfileForm.emergencyContactPhone}
                    onChange={(e) => setEditProfileForm((f) => ({ ...f, emergencyContactPhone: e.target.value }))}
                    placeholder="Contact phone"
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditProfileTarget(null)} disabled={editProfileSaving}>Cancel</Button>
              <Button onClick={handleEditProfile} disabled={editProfileSaving}>
                {editProfileSaving ? "Saving…" : "Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Layout>
    </TooltipProvider>
  );
}
