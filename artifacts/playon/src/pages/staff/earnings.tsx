import { API_BASE } from "@/lib/api-base";
import React, { useState } from "react";
import { Redirect } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { format } from "date-fns";
import { DollarSign, ExternalLink, AlertCircle, CheckCircle2, Clock } from "lucide-react";

interface ConnectStatus {
  connectAccountId: string | null;
  connectOnboardingStatus: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  requirements: string[];
}

interface MyPayout {
  id: number;
  amount: string;
  currency: string;
  status: string;
  description: string | null;
  processedAt: string | null;
  providerTransferId: string | null;
  failureReason: string | null;
  createdAt: string;
}

interface OwedItem {
  id: number;
  entityType: string;
  entityId: number;
  role: string;
  compensationAmount: string;
  createdAt: string;
}

interface OwedResponse {
  assignments: OwedItem[];
  totalOwed: string;
}

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending:    { label: "Pending",    variant: "secondary" },
  approved:   { label: "Approved",   variant: "outline" },
  processing: { label: "Processing", variant: "outline" },
  paid:       { label: "Paid",       variant: "default" },
  failed:     { label: "Failed",     variant: "destructive" },
  voided:     { label: "Voided",     variant: "secondary" },
};

const CONNECT_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  not_started:  { label: "Not connected",  color: "text-muted-foreground" },
  pending:      { label: "Setup in progress", color: "text-yellow-600" },
  complete:     { label: "Connected",      color: "text-green-600" },
  restricted:   { label: "Restricted — action required", color: "text-destructive" },
};

export default function StaffEarnings() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { getToken } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [onboardingLoading, setOnboardingLoading] = useState(false);

  const isStaff = !profileLoading && (
    profile?.role === "staff" ||
    profile?.role === "admin" ||
    profile?.role === "ref" ||
    profile?.role === "coach" ||
    (profile?.roles ?? []).some((r: string) => ["ref", "coach", "scorekeeper", "staff", "admin"].includes(r))
  );

  const { data: connectStatus, isLoading: connectLoading } = useQuery<ConnectStatus>({
    queryKey: ["staff-connect-status"],
    enabled: isStaff,
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/staff/connect/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load Connect status");
      return res.json();
    },
  });

  const { data: owedData, isLoading: owedLoading } = useQuery<OwedResponse>({
    queryKey: ["staff-payouts-owed-me"],
    enabled: isStaff,
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/staff/payouts/owed/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load owed amounts");
      return res.json();
    },
  });

  const { data: history, isLoading: historyLoading } = useQuery<MyPayout[]>({
    queryKey: ["staff-payouts-me"],
    enabled: isStaff,
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/staff/payouts/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load payout history");
      return res.json();
    },
  });

  async function startOnboarding() {
    setOnboardingLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/staff/connect/onboard`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to start onboarding");
      }
      const { url } = await res.json();
      window.location.href = url;
    } catch (err: any) {
      toast({ title: "Setup failed", description: err.message, variant: "destructive" });
    } finally {
      setOnboardingLoading(false);
    }
  }

  async function refreshOnboarding() {
    setOnboardingLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/staff/connect/refresh`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to refresh session");
      const { url } = await res.json();
      window.location.href = url;
    } catch (err: any) {
      toast({ title: "Refresh failed", description: err.message, variant: "destructive" });
    } finally {
      setOnboardingLoading(false);
    }
  }

  if (profileLoading) {
    return <Layout><div className="p-12"><Skeleton className="h-64" /></div></Layout>;
  }

  if (!profile || (!isStaff)) {
    return <Redirect to="/dashboard" />;
  }

  const connectInfo = connectStatus?.connectOnboardingStatus
    ? CONNECT_STATUS_LABELS[connectStatus.connectOnboardingStatus] ?? { label: connectStatus.connectOnboardingStatus, color: "" }
    : CONNECT_STATUS_LABELS["not_started"];

  const totalPaid = (history ?? [])
    .filter(p => p.status === "paid")
    .reduce((acc, p) => acc + Number(p.amount), 0);

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold font-sans uppercase tracking-tight text-primary">My Earnings</h1>
          <p className="text-muted-foreground mt-1">Track your payout status and payment history — Refs, Coaches &amp; Scorekeepers</p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <Card>
            <CardContent className="pt-5">
              <p className="text-sm text-muted-foreground mb-1">Amount Owed</p>
              {owedLoading ? <Skeleton className="h-8 w-24" /> : (
                <p className="text-2xl font-bold text-primary">
                  ${Number(owedData?.totalOwed ?? 0).toFixed(2)}
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                {owedData?.assignments?.length ?? 0} unpaid assignment{owedData?.assignments?.length !== 1 ? "s" : ""}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5">
              <p className="text-sm text-muted-foreground mb-1">Total Paid Out</p>
              {historyLoading ? <Skeleton className="h-8 w-24" /> : (
                <p className="text-2xl font-bold">${totalPaid.toFixed(2)}</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                {(history ?? []).filter(p => p.status === "paid").length} completed payment{(history ?? []).filter(p => p.status === "paid").length !== 1 ? "s" : ""}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5">
              <p className="text-sm text-muted-foreground mb-1">Payout Account</p>
              {connectLoading ? <Skeleton className="h-8 w-32" /> : (
                <p className={`text-sm font-semibold mt-1 ${connectInfo.color}`}>
                  {connectStatus?.payoutsEnabled
                    ? <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-green-600" /> Ready to receive</span>
                    : connectInfo.label}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Stripe Connect onboarding panel */}
        {!connectLoading && (
          <Card className="mb-8 border-dashed">
            <CardContent className="pt-5">
              <div className="flex items-start gap-4">
                <DollarSign className="h-8 w-8 text-primary mt-0.5 shrink-0" />
                <div className="flex-1">
                  <h2 className="font-semibold text-base mb-1">Payout Account Setup</h2>
                  {connectStatus?.payoutsEnabled ? (
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <p className="text-sm text-muted-foreground">
                        Your Stripe account is connected and payouts are enabled.
                        {connectStatus.connectAccountId && (
                          <span className="ml-1 font-mono text-xs text-muted-foreground/70">({connectStatus.connectAccountId})</span>
                        )}
                      </p>
                    </div>
                  ) : connectStatus?.connectOnboardingStatus === "restricted" ? (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <AlertCircle className="h-4 w-4 text-destructive" />
                        <p className="text-sm text-destructive">Your account has restrictions. Please complete the required steps.</p>
                      </div>
                      {connectStatus.requirements?.length > 0 && (
                        <ul className="text-xs text-muted-foreground list-disc ml-4 mb-3 space-y-0.5">
                          {connectStatus.requirements.map(r => <li key={r}>{r}</li>)}
                        </ul>
                      )}
                      <Button size="sm" onClick={refreshOnboarding} disabled={onboardingLoading}>
                        {onboardingLoading ? "Loading..." : "Resolve Issues"}
                        <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : connectStatus?.connectOnboardingStatus === "pending" ? (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Clock className="h-4 w-4 text-yellow-600" />
                        <p className="text-sm text-muted-foreground">Your account setup is in progress. Continue where you left off.</p>
                      </div>
                      <Button size="sm" onClick={refreshOnboarding} disabled={onboardingLoading}>
                        {onboardingLoading ? "Loading..." : "Continue Setup"}
                        <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm text-muted-foreground mb-3">
                        Connect a bank account through Stripe to receive your pay directly. It takes about 2 minutes.
                      </p>
                      <Button size="sm" onClick={startOnboarding} disabled={onboardingLoading}>
                        {onboardingLoading ? "Loading..." : "Set Up Payout Account"}
                        <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Unpaid assignments */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-3">Unpaid Assignments</h2>
          {owedLoading ? (
            <div className="space-y-2">{[1,2].map(i => <Skeleton key={i} className="h-16" />)}</div>
          ) : owedData?.assignments?.length ? (
            <div className="space-y-2">
              {owedData.assignments.map(a => (
                <Card key={a.id}>
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium capitalize">{a.role} — {a.entityType} #{a.entityId}</p>
                        <p className="text-xs text-muted-foreground">{format(new Date(a.createdAt), "MMM d, yyyy")}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-primary">${Number(a.compensationAmount).toFixed(2)}</p>
                        <Badge variant="secondary" className="text-xs">Awaiting payout</Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-4 text-center">No unpaid assignments at this time.</p>
          )}
        </div>

        {/* Payout history */}
        <div>
          <h2 className="text-lg font-semibold mb-3">Payout History</h2>
          {historyLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-16" />)}</div>
          ) : history?.length ? (
            <div className="space-y-2">
              {history.map(p => {
                const s = STATUS_BADGE[p.status] ?? { label: p.status, variant: "secondary" as const };
                return (
                  <Card key={p.id}>
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">{p.description ?? `Payout #${p.id}`}</p>
                          <p className="text-xs text-muted-foreground">
                            {p.processedAt ? format(new Date(p.processedAt), "MMM d, yyyy") : format(new Date(p.createdAt), "MMM d, yyyy")}
                            {p.providerTransferId && (
                              <span className="ml-2 font-mono">{p.providerTransferId}</span>
                            )}
                          </p>
                          {p.failureReason && (
                            <p className="text-xs text-destructive mt-0.5">{p.failureReason}</p>
                          )}
                        </div>
                        <div className="text-right flex flex-col items-end gap-1">
                          <p className="font-semibold">${Number(p.amount).toFixed(2)}</p>
                          <Badge variant={s.variant}>{s.label}</Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-4 text-center">No payout history yet.</p>
          )}
        </div>
      </div>
    </Layout>
  );
}
