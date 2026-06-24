import React, { useState } from "react";
import { Redirect } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { useAdminPermissions } from "@/hooks/use-admin-permissions";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { DollarSign, Clock, CheckCircle, XCircle, RefreshCw, Play, Users, Mail } from "lucide-react";

const BASE = import.meta.env.BASE_URL;
function apiUrl(path: string) { return `${BASE}api${path}`; }

function fmt(n: number | string) {
  return Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    pending_onboarding: "bg-orange-100 text-orange-800",
    pending: "bg-yellow-100 text-yellow-800",
    approved: "bg-blue-100 text-blue-800",
    processing: "bg-purple-100 text-purple-800",
    paid: "bg-green-100 text-green-800",
    failed: "bg-red-100 text-red-800",
  };
  const label = status === "pending_onboarding" ? "AWAITING ONBOARDING" : status.toUpperCase();
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${map[status] ?? "bg-gray-100 text-gray-700"}`}>
      {label}
    </span>
  );
}

function connectBadge(status: string) {
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
  const label = isOnboarded
    ? "CONNECT ✓"
    : status === "invited"
    ? "INVITED"
    : status === "onboarding"
    ? "ONBOARDING"
    : status === "restricted"
    ? "RESTRICTED"
    : "NOT SET UP";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${map[status] ?? "bg-gray-100 text-gray-700"}`}>
      {label}
    </span>
  );
}

interface OwedRow {
  assignment: {
    id: number;
    entityType: string;
    entityId: number;
    role: string;
    compensationAmount: string;
    status: string;
    startAt: string | null;
  };
  staffUser: { id: number; firstName: string | null; lastName: string | null; email: string | null } | null;
  connectAccountId: string | null;
  connectOnboardingStatus: string;
}

interface PayoutRow {
  id: number;
  recipientUserId: number | null;
  assignmentId: number | null;
  amount: string;
  currency: string;
  status: string;
  payoutType: string;
  connectAccountId: string | null;
  providerTransferId: string | null;
  approvedAt: string | null;
  failureReason: string | null;
  description: string | null;
  processedAt: string | null;
  createdAt: string;
  recipient: { name: string | null; email: string | null } | null;
  assignment: {
    id: number;
    entityType: string;
    entityId: number;
    role: string;
    compensationAmount: string;
  } | null;
}

export default function AdminPayouts() {
  const { data: profile, isLoading: isProfileLoading } = useGetMyProfile();
  const { canManagePayouts } = useAdminPermissions();
  const { getToken } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedPending, setSelectedPending] = useState<Set<number>>(new Set());
  const [selectedOwed, setSelectedOwed] = useState<Set<number>>(new Set());
  const [invitingSendId, setInvitingSendId] = useState<number | null>(null);

  const authHeader = async () => ({ Authorization: `Bearer ${await getToken()}` });

  const staffInviteMut = useMutation({
    mutationFn: async (userId: number) => {
      const r = await fetch(apiUrl(`/admin/connect/staff/${userId}/invite`), {
        method: "POST",
        headers: await authHeader(),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error((body as any).error ?? r.statusText);
      }
      return r.json();
    },
    onSuccess: (_data, userId) => {
      toast({ title: "Invite sent", description: "Stripe Connect onboarding link emailed to recipient." });
      setInvitingSendId(null);
      queryClient.invalidateQueries({ queryKey: ["admin-payouts-queue"] });
      queryClient.invalidateQueries({ queryKey: ["admin-payouts-owed"] });
    },
    onError: (e: Error) => {
      toast({ title: "Invite failed", description: e.message, variant: "destructive" });
      setInvitingSendId(null);
    },
  });

  const owedQ = useQuery<OwedRow[]>({
    queryKey: ["admin-payouts-owed"],
    queryFn: async () => {
      const r = await fetch(apiUrl("/admin/payouts/owed"), { headers: await authHeader() });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const queueQ = useQuery<PayoutRow[]>({
    queryKey: ["admin-payouts-queue"],
    queryFn: async () => {
      const r = await fetch(apiUrl("/admin/payouts/queue"), { headers: await authHeader() });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const historyQ = useQuery<PayoutRow[]>({
    queryKey: ["admin-payouts-history"],
    queryFn: async () => {
      const r = await fetch(apiUrl("/admin/payouts/history"), { headers: await authHeader() });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const createMut = useMutation({
    mutationFn: async (assignmentIds: number[]) => {
      const r = await fetch(apiUrl("/admin/payouts/create"), {
        method: "POST",
        headers: { ...(await authHeader()), "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentIds }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: (data) => {
      toast({ title: `${data.length} payout record(s) created` });
      setSelectedOwed(new Set());
      queryClient.invalidateQueries({ queryKey: ["admin-payouts-owed"] });
      queryClient.invalidateQueries({ queryKey: ["admin-payouts-queue"] });
    },
    onError: (e: Error) => toast({ title: "Error creating payouts", description: e.message, variant: "destructive" }),
  });

  const approveMut = useMutation({
    mutationFn: async (payoutIds: number[]) => {
      const r = await fetch(apiUrl("/admin/payouts/approve"), {
        method: "POST",
        headers: { ...(await authHeader()), "Content-Type": "application/json" },
        body: JSON.stringify({ payoutIds }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: (data) => {
      toast({ title: `${data.approved} payout(s) approved` });
      setSelectedPending(new Set());
      queryClient.invalidateQueries({ queryKey: ["admin-payouts-queue"] });
    },
    onError: (e: Error) => toast({ title: "Error approving", description: e.message, variant: "destructive" }),
  });

  const executeMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(apiUrl(`/admin/payouts/${id}/execute`), {
        method: "POST",
        headers: await authHeader(),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? r.statusText);
      }
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Payout executed successfully" });
      queryClient.invalidateQueries({ queryKey: ["admin-payouts-queue"] });
      queryClient.invalidateQueries({ queryKey: ["admin-payouts-history"] });
    },
    onError: (e: Error) => toast({ title: "Execution failed", description: e.message, variant: "destructive" }),
  });

  const retryMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(apiUrl(`/admin/payouts/${id}/retry`), {
        method: "POST",
        headers: await authHeader(),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Payout reset to approved — ready to retry" });
      queryClient.invalidateQueries({ queryKey: ["admin-payouts-history"] });
      queryClient.invalidateQueries({ queryKey: ["admin-payouts-queue"] });
    },
    onError: (e: Error) => toast({ title: "Retry failed", description: e.message, variant: "destructive" }),
  });

  if (isProfileLoading) return <Layout><div className="p-12"><Skeleton className="h-96" /></div></Layout>;
  if (profile?.role !== "admin" && profile?.adminLevel !== "super" && profile?.adminLevel !== "admin") return <Redirect to="/dashboard" />;

  const onboardingPayouts = queueQ.data?.filter(p => p.status === "pending_onboarding") ?? [];
  const pendingPayouts = queueQ.data?.filter(p => p.status === "pending") ?? [];
  const approvedPayouts = queueQ.data?.filter(p => p.status === "approved" || p.status === "processing") ?? [];
  const totalOwed = (owedQ.data ?? []).reduce((s, r) => s + Number(r.assignment.compensationAmount ?? 0), 0);
  const totalPending = pendingPayouts.reduce((s, p) => s + Number(p.amount), 0);
  const totalApproved = approvedPayouts.reduce((s, p) => s + Number(p.amount), 0);

  // Group pending_onboarding payouts by recipient for the summary panel
  // Exclude venue payouts (recipientUserId is null) — those are shown on the Venues admin page
  const onboardingByRecipient = onboardingPayouts
    .filter(p => p.recipientUserId != null)
    .reduce<Map<number, { name: string; email: string; count: number; total: number }>>(
    (acc, p) => {
      const key = p.recipientUserId!;
      const existing = acc.get(key);
      if (existing) {
        existing.count += 1;
        existing.total += Number(p.amount);
      } else {
        acc.set(key, {
          name: p.recipient?.name ?? `User #${key}`,
          email: p.recipient?.email ?? "",
          count: 1,
          total: Number(p.amount),
        });
      }
      return acc;
    },
    new Map(),
  );

  return (
    <Layout>
      <div className="container mx-auto px-4 py-10 space-y-8">
        <div>
          <h1 className="text-3xl font-bold font-sans uppercase tracking-tight text-primary">Payouts</h1>
          <p className="text-muted-foreground mt-1">Ref &amp; coach payouts via Stripe Connect</p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm text-muted-foreground">Assignments Owed</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600">{fmt(totalOwed)}</div>
              <p className="text-xs text-muted-foreground">{owedQ.data?.length ?? 0} unpaid assignments</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm text-muted-foreground">Pending Approval</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600">{fmt(totalPending)}</div>
              <p className="text-xs text-muted-foreground">{pendingPayouts.length} payouts</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm text-muted-foreground">Approved &amp; Ready</CardTitle>
              <CheckCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{fmt(totalApproved)}</div>
              <p className="text-xs text-muted-foreground">{approvedPayouts.length} payouts</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="owed">
          <TabsList>
            <TabsTrigger value="owed">Owed ({owedQ.data?.length ?? 0})</TabsTrigger>
            <TabsTrigger value="queue">Queue ({queueQ.data?.length ?? 0})</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          {/* TAB: Owed assignments (not yet queued) */}
          <TabsContent value="owed" className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Assignments with compensation set but no payout record created yet.
              </p>
              <Button
                size="sm"
                disabled={selectedOwed.size === 0 || createMut.isPending}
                onClick={() => createMut.mutate(Array.from(selectedOwed))}
              >
                Create Payouts ({selectedOwed.size})
              </Button>
            </div>

            {owedQ.isLoading ? <Skeleton className="h-48" /> : (
              <Card>
                <CardContent className="p-0">
                  {!owedQ.data?.length ? (
                    <p className="p-8 text-center text-muted-foreground">No unpaid assignments</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="border-b bg-muted/30">
                        <tr>
                          <th className="p-3 text-left w-8">
                            <input type="checkbox" onChange={e => {
                              if (e.target.checked) setSelectedOwed(new Set(owedQ.data!.map(r => r.assignment.id)));
                              else setSelectedOwed(new Set());
                            }} />
                          </th>
                          <th className="p-3 text-left">Staff</th>
                          <th className="p-3 text-left">Role</th>
                          <th className="p-3 text-left">Assignment</th>
                          <th className="p-3 text-left">Connect</th>
                          <th className="p-3 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {owedQ.data.map(row => (
                          <tr key={row.assignment.id} className="border-b hover:bg-muted/20">
                            <td className="p-3">
                              <input type="checkbox"
                                checked={selectedOwed.has(row.assignment.id)}
                                onChange={e => {
                                  const next = new Set(selectedOwed);
                                  if (e.target.checked) next.add(row.assignment.id);
                                  else next.delete(row.assignment.id);
                                  setSelectedOwed(next);
                                }}
                              />
                            </td>
                            <td className="p-3">
                              <div className="font-medium">
                                {row.staffUser ? ([row.staffUser.firstName, row.staffUser.lastName].filter(Boolean).join(" ") || "—") : "—"}
                              </div>
                              <div className="text-xs text-muted-foreground">{row.staffUser?.email ?? ""}</div>
                            </td>
                            <td className="p-3 capitalize">{row.assignment.role}</td>
                            <td className="p-3">
                              <span className="capitalize">{row.assignment.entityType}</span> #{row.assignment.entityId}
                              {row.assignment.startAt && (
                                <div className="text-xs text-muted-foreground">
                                  {format(new Date(row.assignment.startAt), "MMM d, yyyy")}
                                </div>
                              )}
                            </td>
                            <td className="p-3">{connectBadge(row.connectOnboardingStatus)}</td>
                            <td className="p-3 text-right font-semibold">{fmt(row.assignment.compensationAmount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* TAB: Payout queue (pending + approved) */}
          <TabsContent value="queue" className="space-y-4">

            {/* ── Onboarding Needed panel ── */}
            {onboardingByRecipient.size > 0 && (
              <Card className="border-orange-200 bg-orange-50 dark:bg-orange-950/20 dark:border-orange-800">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2 text-orange-800 dark:text-orange-300">
                    <Mail className="h-4 w-4" />
                    Waiting on Stripe Connect onboarding ({onboardingByRecipient.size} recipient{onboardingByRecipient.size > 1 ? "s" : ""})
                  </CardTitle>
                  <p className="text-xs text-orange-700 dark:text-orange-400 mt-1">
                    These payouts will auto-execute once the recipient finishes their Stripe account setup. Use "Re-invite" to resend the link.
                  </p>
                </CardHeader>
                <CardContent className="pt-0">
                  <table className="w-full text-sm">
                    <thead className="border-b border-orange-200 dark:border-orange-800">
                      <tr>
                        <th className="pb-2 text-left font-medium text-orange-800 dark:text-orange-300">Recipient</th>
                        <th className="pb-2 text-center font-medium text-orange-800 dark:text-orange-300">Payouts queued</th>
                        <th className="pb-2 text-right font-medium text-orange-800 dark:text-orange-300">Total held</th>
                        {canManagePayouts && <th className="pb-2 text-right font-medium text-orange-800 dark:text-orange-300">Action</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from(onboardingByRecipient.entries()).map(([userId, info]) => (
                        <tr key={userId} className="border-b border-orange-100 dark:border-orange-900/50 last:border-0">
                          <td className="py-2">
                            <div className="font-medium">{info.name}</div>
                            <div className="text-xs text-muted-foreground">{info.email}</div>
                          </td>
                          <td className="py-2 text-center">
                            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-orange-200 dark:bg-orange-800 text-orange-900 dark:text-orange-200 text-xs font-bold">
                              {info.count}
                            </span>
                          </td>
                          <td className="py-2 text-right font-semibold">{fmt(info.total)}</td>
                          {canManagePayouts && (
                            <td className="py-2 text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1 border-orange-300 text-orange-800 hover:bg-orange-100 dark:border-orange-700 dark:text-orange-300 dark:hover:bg-orange-900/40"
                                disabled={invitingSendId === userId || staffInviteMut.isPending}
                                onClick={() => {
                                  setInvitingSendId(userId);
                                  staffInviteMut.mutate(userId);
                                }}
                              >
                                <Mail className="h-3 w-3" />
                                {invitingSendId === userId ? "Sending…" : "Re-invite"}
                              </Button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}

            {pendingPayouts.length > 0 && (
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">Select pending payouts to approve.</p>
                <Button
                  size="sm"
                  disabled={selectedPending.size === 0 || approveMut.isPending}
                  onClick={() => approveMut.mutate(Array.from(selectedPending))}
                >
                  Approve Selected ({selectedPending.size})
                </Button>
              </div>
            )}

            {queueQ.isLoading ? <Skeleton className="h-48" /> : (
              <Card>
                <CardContent className="p-0">
                  {!queueQ.data?.length ? (
                    <p className="p-8 text-center text-muted-foreground">Queue is empty</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="border-b bg-muted/30">
                        <tr>
                          <th className="p-3 text-left w-8"></th>
                          <th className="p-3 text-left">Recipient</th>
                          <th className="p-3 text-left">Description</th>
                          <th className="p-3 text-left">Status</th>
                          <th className="p-3 text-right">Amount</th>
                          <th className="p-3 text-left">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {queueQ.data.map(p => (
                          <tr key={p.id} className="border-b hover:bg-muted/20">
                            <td className="p-3">
                              {p.status === "pending" && (
                                <input type="checkbox"
                                  checked={selectedPending.has(p.id)}
                                  onChange={e => {
                                    const next = new Set(selectedPending);
                                    if (e.target.checked) next.add(p.id);
                                    else next.delete(p.id);
                                    setSelectedPending(next);
                                  }}
                                />
                              )}
                            </td>
                            <td className="p-3">
                              <div className="font-medium">{p.recipient?.name ?? `User #${p.recipientUserId}`}</div>
                              <div className="text-xs text-muted-foreground">{p.recipient?.email ?? ""}</div>
                              {!p.connectAccountId && (
                                <div className="text-xs text-red-600 mt-0.5">No Connect account</div>
                              )}
                            </td>
                            <td className="p-3 text-muted-foreground">{p.description ?? "—"}</td>
                            <td className="p-3">{statusBadge(p.status)}</td>
                            <td className="p-3 text-right font-semibold">{fmt(p.amount)}</td>
                            <td className="p-3">
                              {p.status === "approved" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={executeMut.isPending}
                                  onClick={() => executeMut.mutate(p.id)}
                                  className="flex items-center gap-1"
                                >
                                  <Play className="h-3 w-3" /> Execute
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* TAB: History */}
          <TabsContent value="history">
            {historyQ.isLoading ? <Skeleton className="h-48" /> : (
              <Card>
                <CardContent className="p-0">
                  {!historyQ.data?.length ? (
                    <p className="p-8 text-center text-muted-foreground">No payout history</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="border-b bg-muted/30">
                        <tr>
                          <th className="p-3 text-left">Recipient</th>
                          <th className="p-3 text-left">Description</th>
                          <th className="p-3 text-left">Status</th>
                          <th className="p-3 text-right">Amount</th>
                          <th className="p-3 text-left">Transfer ID</th>
                          <th className="p-3 text-left">Date</th>
                          <th className="p-3 text-left">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {historyQ.data.map(p => (
                          <tr key={p.id} className="border-b hover:bg-muted/20">
                            <td className="p-3">
                              <div className="font-medium">{p.recipient?.name ?? `User #${p.recipientUserId}`}</div>
                              <div className="text-xs text-muted-foreground">{p.recipient?.email ?? ""}</div>
                            </td>
                            <td className="p-3 text-muted-foreground">{p.description ?? "—"}</td>
                            <td className="p-3">
                              {statusBadge(p.status)}
                              {p.failureReason && (
                                <div className="text-xs text-red-600 mt-0.5 max-w-xs truncate" title={p.failureReason}>
                                  {p.failureReason}
                                </div>
                              )}
                            </td>
                            <td className="p-3 text-right font-semibold">{fmt(p.amount)}</td>
                            <td className="p-3">
                              {p.providerTransferId ? (
                                <code className="text-xs bg-muted px-1 py-0.5 rounded">{p.providerTransferId}</code>
                              ) : "—"}
                            </td>
                            <td className="p-3 text-muted-foreground text-xs">
                              {p.processedAt ? format(new Date(p.processedAt), "MMM d, yyyy") : "—"}
                            </td>
                            <td className="p-3">
                              {p.status === "failed" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={retryMut.isPending}
                                  onClick={() => retryMut.mutate(p.id)}
                                  className="flex items-center gap-1"
                                >
                                  <RefreshCw className="h-3 w-3" /> Retry
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
