import React, { useState } from "react";
import { Redirect, Link } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { format } from "date-fns";
import { Search, Users, ChevronRight, ChevronLeft, Shield, ShieldCheck, UserCog, RefreshCw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

interface UserRow {
  id: number;
  clerkId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  role: string;
  roles: string[];
  adminLevel?: string | null;
  idVerified: boolean | null;
  createdAt: string;
}

interface ListResponse {
  items: UserRow[];
  total: number;
  page: number;
  limit: number;
}

interface OrphanedDbRow {
  id: number;
  clerkId: string;
  email: string | null;
  role: string | null;
}

interface OrphanedClerkAccount {
  clerkId: string;
  email: string | null;
}

interface ReconcileDryRunResult {
  dryRun: true;
  orphanedDbRows: OrphanedDbRow[];
  orphanedClerkAccounts: OrphanedClerkAccount[];
  counts: { orphanedDbRows: number; orphanedClerkAccounts: number };
}

interface ReconcileExecuteResult {
  dryRun: false;
  dbRowsRemoved: number;
  clerkAccountsRemoved: number;
  clerkErrors: string[];
  counts: { orphanedDbRows: number; orphanedClerkAccounts: number };
}

const ROLE_COLORS: Record<string, string> = {
  player: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300",
  parent: "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300",
  ref: "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300",
  coach: "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300",
  scorekeeper: "bg-cyan-100 text-cyan-800 border-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-300",
  staff: "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300",
  admin: "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300",
};

export default function AdminUsers() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { getToken } = useAuth();

  const [search, setSearch] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [page, setPage] = useState(1);
  const limit = 25;

  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [reconcileLoading, setReconcileLoading] = useState(false);
  const [reconcileApplying, setReconcileApplying] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<ReconcileDryRunResult | null>(null);

  const { data, isLoading } = useQuery<ListResponse>({
    queryKey: ["admin-clerk-users", search, page],
    queryFn: async () => {
      const token = await getToken();
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search) params.set("q", search);
      const res = await fetch(`${API_BASE}/admin/clerk-users?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load users");
      return res.json();
    },
    staleTime: 30_000,
    enabled: !!profile && profile.role === "admin" && profile.adminLevel === "super",
  });

  if (profileLoading) {
    return (
      <Layout>
        <div className="p-8 space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-96" />
        </div>
      </Layout>
    );
  }

  if (profile?.role !== "admin" || profile.adminLevel !== "super") {
    return <Redirect to="/admin" />;
  }

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  function handleSearch() {
    setSearch(inputValue.trim());
    setPage(1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleSearch();
  }

  function displayName(u: UserRow) {
    const n = [u.firstName, u.lastName].filter(Boolean).join(" ");
    return n || u.email;
  }

  async function handleReconcileDryRun() {
    setReconcileLoading(true);
    setReconcileResult(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/users/reconcile`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ execute: false }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error ?? "Request failed");
      }
      const result: ReconcileDryRunResult = await res.json();
      setReconcileResult(result);
      setReconcileOpen(true);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to run reconciliation check");
    } finally {
      setReconcileLoading(false);
    }
  }

  async function handleReconcileApply() {
    setReconcileApplying(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/users/reconcile`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ execute: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error ?? "Request failed");
      }
      const result: ReconcileExecuteResult = await res.json();
      setReconcileOpen(false);
      setReconcileResult(null);
      const total = result.dbRowsRemoved + result.clerkAccountsRemoved;
      if (total === 0) {
        toast.success("Reconciliation complete — no records to remove.");
      } else {
        const parts: string[] = [];
        if (result.dbRowsRemoved > 0)
          parts.push(`${result.dbRowsRemoved} orphaned DB row${result.dbRowsRemoved !== 1 ? "s" : ""}`);
        if (result.clerkAccountsRemoved > 0)
          parts.push(`${result.clerkAccountsRemoved} orphaned Clerk account${result.clerkAccountsRemoved !== 1 ? "s" : ""}`);
        toast.success(`Removed ${parts.join(" and ")}.`);
        if (result.clerkErrors.length > 0) {
          toast.error(`${result.clerkErrors.length} Clerk deletion${result.clerkErrors.length !== 1 ? "s" : ""} failed — check server logs.`);
        }
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to apply reconciliation");
    } finally {
      setReconcileApplying(false);
    }
  }

  const hasOrphans =
    reconcileResult &&
    (reconcileResult.counts.orphanedDbRows > 0 || reconcileResult.counts.orphanedClerkAccounts > 0);

  return (
    <Layout>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/admin">
              <button type="button" className="text-muted-foreground hover:text-foreground transition-colors">
                <ChevronLeft className="h-5 w-5" />
              </button>
            </Link>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center">
                <UserCog className="h-5 w-5 text-violet-500" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground">User Management</h1>
                <p className="text-sm text-muted-foreground">
                  {total > 0 ? `${total.toLocaleString()} total accounts` : "Search and manage user accounts"}
                </p>
              </div>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleReconcileDryRun}
            disabled={reconcileLoading}
            className="gap-2 shrink-0"
          >
            <RefreshCw className={`h-4 w-4 ${reconcileLoading ? "animate-spin" : ""}`} />
            {reconcileLoading ? "Checking…" : "Reconcile Users"}
          </Button>
        </div>

        {/* Search */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search by name or email…"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>
          <Button onClick={handleSearch}>Search</Button>
          {search && (
            <Button variant="ghost" onClick={() => { setSearch(""); setInputValue(""); setPage(1); }}>
              Clear
            </Button>
          )}
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 space-y-3">
                {[1,2,3,4,5].map((i) => <Skeleton key={i} className="h-14" />)}
              </div>
            ) : items.length === 0 ? (
              <div className="p-12 text-center">
                <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">
                  {search ? `No users found for "${search}"` : "No users yet"}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {items.map((u) => (
                  <Link key={u.clerkId} href={`/admin/users/${u.clerkId}`}>
                    <div className="flex items-center gap-4 px-5 py-4 hover:bg-muted/40 transition-colors cursor-pointer group">
                      <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0 font-semibold text-sm text-muted-foreground">
                        {(u.firstName?.[0] ?? u.email[0] ?? "?").toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-foreground truncate">{displayName(u)}</span>
                          {u.idVerified && (
                            <ShieldCheck className="h-3.5 w-3.5 text-green-500 flex-shrink-0" title="ID Verified" />
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0.5 ${ROLE_COLORS[u.role] ?? ""}`}>
                          {u.role}{u.adminLevel ? ` (${u.adminLevel})` : ""}
                        </Badge>
                        <span className="text-xs text-muted-foreground hidden sm:block">
                          {format(new Date(u.createdAt), "MMM d, yyyy")}
                        </span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Page {page} of {totalPages} ({total} total)
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Reconcile Dialog */}
      <Dialog open={reconcileOpen} onOpenChange={(open) => { if (!reconcileApplying) setReconcileOpen(open); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {hasOrphans ? (
                <AlertTriangle className="h-5 w-5 text-amber-500" />
              ) : (
                <RefreshCw className="h-5 w-5 text-green-500" />
              )}
              User Reconciliation Report
            </DialogTitle>
            <DialogDescription>
              Dry-run complete. Review the orphaned accounts below before applying changes.
            </DialogDescription>
          </DialogHeader>

          {reconcileResult && (
            <div className="space-y-4 text-sm">
              {/* Summary counts */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold text-foreground">{reconcileResult.counts.orphanedDbRows}</p>
                  <p className="text-xs text-muted-foreground mt-1">Orphaned DB rows</p>
                  <p className="text-[10px] text-muted-foreground">(in DB, not in Clerk)</p>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold text-foreground">{reconcileResult.counts.orphanedClerkAccounts}</p>
                  <p className="text-xs text-muted-foreground mt-1">Orphaned Clerk accounts</p>
                  <p className="text-[10px] text-muted-foreground">(in Clerk, not in DB)</p>
                </div>
              </div>

              {/* Orphaned DB rows list */}
              {reconcileResult.orphanedDbRows.length > 0 && (
                <div>
                  <p className="font-medium text-foreground mb-1.5">Orphaned DB rows to delete:</p>
                  <div className="rounded-md border divide-y divide-border max-h-36 overflow-y-auto">
                    {reconcileResult.orphanedDbRows.map((r) => (
                      <div key={r.clerkId} className="px-3 py-2 text-xs font-mono text-muted-foreground">
                        <span className="text-foreground">{r.email ?? "(no email)"}</span>
                        <span className="ml-2 opacity-60">{r.clerkId}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Orphaned Clerk accounts list */}
              {reconcileResult.orphanedClerkAccounts.length > 0 && (
                <div>
                  <p className="font-medium text-foreground mb-1.5">Orphaned Clerk accounts to delete:</p>
                  <div className="rounded-md border divide-y divide-border max-h-36 overflow-y-auto">
                    {reconcileResult.orphanedClerkAccounts.map((r) => (
                      <div key={r.clerkId} className="px-3 py-2 text-xs font-mono text-muted-foreground">
                        <span className="text-foreground">{r.email ?? "(no email)"}</span>
                        <span className="ml-2 opacity-60">{r.clerkId}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!hasOrphans && (
                <p className="text-center text-muted-foreground py-2">
                  Everything looks clean — no orphaned accounts found.
                </p>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => setReconcileOpen(false)}
              disabled={reconcileApplying}
            >
              Cancel
            </Button>
            {hasOrphans && (
              <Button
                variant="destructive"
                onClick={handleReconcileApply}
                disabled={reconcileApplying}
              >
                {reconcileApplying ? "Applying…" : "Apply Changes"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
