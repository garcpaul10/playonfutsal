import React, { useState } from "react";
import { Redirect } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { Search, Shield, ShieldAlert, AlertTriangle, UserCog } from "lucide-react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

const VALID_ROLES = ["player", "parent", "ref", "coach", "scorekeeper", "staff", "admin"] as const;
type ValidRole = typeof VALID_ROLES[number];

const ROLE_LABELS: Record<ValidRole, string> = {
  player: "Player",
  parent: "Parent",
  ref: "Referee",
  coach: "Coach",
  scorekeeper: "Scorekeeper",
  staff: "Staff",
  admin: "Admin",
};

const ROLE_COLORS: Record<ValidRole, string> = {
  player: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800",
  parent: "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800",
  ref: "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800",
  coach: "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800",
  scorekeeper: "bg-cyan-100 text-cyan-800 border-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-300 dark:border-cyan-800",
  staff: "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-800",
  admin: "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800",
};

interface UserSearchResult {
  id: number;
  clerkId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  roles: string[];
  adminLevel: string | null;
}

export default function AdminRoles() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { getToken } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isSuperAdmin =
    profile?.role === "admin" &&
    (profile?.adminLevel === "super" || !profile?.adminLevel || profile?.adminLevel !== "scoped");

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(null);
  const [pendingRoles, setPendingRoles] = useState<string[]>([]);
  const [pendingAdminLevel, setPendingAdminLevel] = useState<"super" | "scoped">("scoped");
  const [isDirty, setIsDirty] = useState(false);

  // Self-edit confirmation dialog
  const [selfEditDialog, setSelfEditDialog] = useState<{
    open: boolean;
    action: "remove_admin" | "downgrade_super";
    onConfirm: () => void;
  }>({ open: false, action: "remove_admin", onConfirm: () => {} });

  const { data: searchResults, isFetching: searchFetching } = useQuery<UserSearchResult[]>({
    queryKey: ["role-manager-search", searchQuery],
    enabled: searchQuery.trim().length >= 2,
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(
        `${API_BASE}/admin/users/search?q=${encodeURIComponent(searchQuery.trim())}&all=1`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    staleTime: 5000,
  });

  function selectUser(user: UserSearchResult) {
    setSelectedUser(user);
    const currentRoles = Array.isArray(user.roles) && user.roles.length > 0
      ? user.roles
      : [user.role].filter(Boolean);
    setPendingRoles(currentRoles);
    setPendingAdminLevel((user.adminLevel as "super" | "scoped") ?? "scoped");
    setIsDirty(false);
  }

  function toggleRole(role: ValidRole) {
    if (!selectedUser) return;

    const isSelf = selectedUser.clerkId === profile?.clerkId;
    const hasRole = pendingRoles.includes(role);
    const isAdminRole = role === "admin";

    if (isSelf && isAdminRole && hasRole) {
      // Removing admin from self — require explicit confirmation
      setSelfEditDialog({
        open: true,
        action: "remove_admin",
        onConfirm: () => {
          applyRoleToggle(role);
          setSelfEditDialog((d) => ({ ...d, open: false }));
        },
      });
      return;
    }

    applyRoleToggle(role);
  }

  function applyRoleToggle(role: ValidRole) {
    const hasRole = pendingRoles.includes(role);
    const next = hasRole
      ? pendingRoles.filter((r) => r !== role)
      : [...pendingRoles, role];
    setPendingRoles(next);
    setIsDirty(true);
  }

  function handleAdminLevelChange(level: "super" | "scoped") {
    if (!selectedUser) return;
    const isSelf = selectedUser.clerkId === profile?.clerkId;

    if (isSelf && level === "scoped" && pendingAdminLevel === "super") {
      setSelfEditDialog({
        open: true,
        action: "downgrade_super",
        onConfirm: () => {
          setPendingAdminLevel(level);
          setIsDirty(true);
          setSelfEditDialog((d) => ({ ...d, open: false }));
        },
      });
      return;
    }

    setPendingAdminLevel(level);
    setIsDirty(true);
  }

  const saveRoles = useMutation({
    mutationFn: async () => {
      if (!selectedUser) throw new Error("No user selected");
      const token = await getToken();
      const body: Record<string, unknown> = { roles: pendingRoles };
      if (pendingRoles.includes("admin")) {
        body.adminLevel = pendingAdminLevel;
      }
      const res = await fetch(`${API_BASE}/admin/users/${selectedUser.id}/roles`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error ?? "Failed to update roles");
      }
      return res.json();
    },
    onSuccess: (updated) => {
      const displayName =
        [selectedUser?.firstName, selectedUser?.lastName].filter(Boolean).join(" ") ||
        selectedUser?.email ||
        "User";
      toast({ title: "Roles updated", description: `${displayName}'s roles have been saved.` });

      // Refresh the selected user to reflect new state
      const refreshed: UserSearchResult = {
        ...selectedUser!,
        role: updated.role,
        roles: updated.roles,
        adminLevel: updated.adminLevel,
      };
      setSelectedUser(refreshed);
      setIsDirty(false);

      // Invalidate any queries that might show user data
      queryClient.invalidateQueries({ queryKey: ["admin-users-list"] });
      queryClient.invalidateQueries({ queryKey: ["role-manager-search", searchQuery] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save", description: err.message, variant: "destructive" });
    },
  });

  if (profileLoading) {
    return (
      <Layout>
        <div className="p-12">
          <Skeleton className="h-64" />
        </div>
      </Layout>
    );
  }

  if (!isSuperAdmin) {
    return <Redirect to="/admin" />;
  }

  const displayName = selectedUser
    ? [selectedUser.firstName, selectedUser.lastName].filter(Boolean).join(" ") || selectedUser.email
    : null;

  const isSelfSelected = selectedUser?.clerkId === profile?.clerkId;

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold font-sans uppercase tracking-tight text-primary flex items-center gap-2">
              <UserCog className="h-7 w-7" />
              Role Manager
            </h1>
            <p className="text-muted-foreground mt-1">
              Search any user and toggle their roles. Changes take effect immediately.
            </p>
          </div>
          <Button variant="outline" onClick={() => history.back()}>
            Back to Admin
          </Button>
        </div>

        {/* Search */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Search User</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or email…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            {searchQuery.trim().length >= 2 && (
              <div className="mt-3 space-y-1">
                {searchFetching ? (
                  <div className="space-y-2">
                    {[1, 2].map((i) => (
                      <Skeleton key={i} className="h-12 rounded-md" />
                    ))}
                  </div>
                ) : (searchResults ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2 text-center">No users found</p>
                ) : (
                  (searchResults ?? []).map((user) => {
                    const name =
                      [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
                    const isSelected = selectedUser?.id === user.id;
                    return (
                      <button
                        key={user.id}
                        onClick={() => selectUser(user)}
                        className={`w-full text-left px-3 py-2.5 rounded-md transition-colors flex items-center justify-between gap-2 ${
                          isSelected
                            ? "bg-primary/10 border border-primary/30"
                            : "hover:bg-muted border border-transparent"
                        }`}
                      >
                        <div>
                          <p className="text-sm font-medium">{name}</p>
                          <p className="text-xs text-muted-foreground">{user.email}</p>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {user.role === "admin" && (
                            <span className="text-xs px-1.5 py-0.5 rounded font-semibold bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
                              {user.adminLevel === "scoped" ? "Scoped Admin" : "Super Admin"}
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground">{user.role}</span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Role editor */}
        {selectedUser ? (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    {displayName}
                    {isSelfSelected && (
                      <span className="text-xs text-primary font-medium">(you)</span>
                    )}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground mt-0.5">{selectedUser.email}</p>
                </div>
                {isDirty && (
                  <Button
                    size="sm"
                    onClick={() => saveRoles.mutate()}
                    disabled={saveRoles.isPending}
                  >
                    {saveRoles.isPending ? "Saving…" : "Save Changes"}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {isSelfSelected && (
                <div className="flex items-start gap-2 p-3 rounded-md bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-sm">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <p>
                    You are editing your own account. Removing your admin role or downgrading from
                    super will require confirmation and will limit your own access.
                  </p>
                </div>
              )}

              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  Roles
                </p>
                <div className="flex flex-wrap gap-2">
                  {VALID_ROLES.map((role) => {
                    const isActive = pendingRoles.includes(role);
                    return (
                      <button
                        key={role}
                        onClick={() => toggleRole(role)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium transition-all select-none ${
                          isActive
                            ? ROLE_COLORS[role]
                            : "bg-muted/30 text-muted-foreground border-muted hover:border-muted-foreground/50"
                        }`}
                        title={isActive ? `Remove ${ROLE_LABELS[role]} role` : `Add ${ROLE_LABELS[role]} role`}
                      >
                        {role === "admin" && isActive && (
                          <Shield className="h-3.5 w-3.5" />
                        )}
                        {ROLE_LABELS[role]}
                        <span className={`text-xs ${isActive ? "opacity-70" : "opacity-40"}`}>
                          {isActive ? "✓" : "+"}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {pendingRoles.length === 0 && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    No roles selected — saving will set the user to "player" by default.
                  </p>
                )}
              </div>

              {/* Admin level sub-control */}
              {pendingRoles.includes("admin") && (
                <div className="pt-2 border-t">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                    Admin Level
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => handleAdminLevelChange("super")}
                      className={`flex-1 flex items-start gap-2 p-3 rounded-lg border text-sm transition-all ${
                        pendingAdminLevel === "super"
                          ? "border-red-400 bg-red-50 dark:bg-red-900/20 dark:border-red-700"
                          : "border-border hover:border-muted-foreground/40"
                      }`}
                    >
                      <Shield className={`h-4 w-4 mt-0.5 flex-shrink-0 ${pendingAdminLevel === "super" ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`} />
                      <div className="text-left">
                        <p className={`font-semibold ${pendingAdminLevel === "super" ? "text-red-700 dark:text-red-300" : ""}`}>
                          Super Admin
                        </p>
                        <p className="text-xs text-muted-foreground">Full unrestricted access to all features</p>
                      </div>
                    </button>
                    <button
                      onClick={() => handleAdminLevelChange("scoped")}
                      className={`flex-1 flex items-start gap-2 p-3 rounded-lg border text-sm transition-all ${
                        pendingAdminLevel === "scoped"
                          ? "border-amber-400 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700"
                          : "border-border hover:border-muted-foreground/40"
                      }`}
                    >
                      <ShieldAlert className={`h-4 w-4 mt-0.5 flex-shrink-0 ${pendingAdminLevel === "scoped" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`} />
                      <div className="text-left">
                        <p className={`font-semibold ${pendingAdminLevel === "scoped" ? "text-amber-700 dark:text-amber-300" : ""}`}>
                          Scoped Admin
                        </p>
                        <p className="text-xs text-muted-foreground">Limited to permissions set in their staff profile</p>
                      </div>
                    </button>
                  </div>
                </div>
              )}

              {isDirty && (
                <div className="pt-2 flex justify-end">
                  <Button
                    onClick={() => saveRoles.mutate()}
                    disabled={saveRoles.isPending}
                  >
                    {saveRoles.isPending ? "Saving…" : "Save Changes"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="text-center py-16 text-muted-foreground">
            <UserCog className="h-12 w-12 mx-auto mb-4 opacity-30" />
            <p className="text-lg font-medium">Search for a user above</p>
            <p className="text-sm mt-1">Select a result to view and edit their roles</p>
          </div>
        )}

        {/* Self-edit confirmation dialog */}
        <Dialog
          open={selfEditDialog.open}
          onOpenChange={(open) => setSelfEditDialog((d) => ({ ...d, open }))}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-5 w-5" />
                {selfEditDialog.action === "remove_admin"
                  ? "Remove your own admin role?"
                  : "Downgrade your admin level?"}
              </DialogTitle>
              <DialogDescription className="pt-1">
                {selfEditDialog.action === "remove_admin" ? (
                  <>
                    You are about to remove the <strong>admin</strong> role from your own account.
                    This will revoke your access to the admin dashboard immediately on your next
                    page load. Are you sure?
                  </>
                ) : (
                  <>
                    You are about to downgrade your own admin level from{" "}
                    <strong>Super</strong> to <strong>Scoped</strong>. You will lose unrestricted
                    access and be limited to only the permissions set in your staff profile. Are
                    you sure?
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => setSelfEditDialog((d) => ({ ...d, open: false }))}
              >
                Cancel
              </Button>
              <Button variant="destructive" onClick={selfEditDialog.onConfirm}>
                Yes, proceed
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
