import { API_BASE } from "@/lib/api-base";
import React, { useState } from "react";
import { Redirect } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { InlinePaymentDialog } from "@/components/inline-payment-dialog";
import { AlertTriangle } from "lucide-react";

function fmt(n: number) { return n.toLocaleString("en-US", { style: "currency", currency: "USD" }); }

interface Payment {
  id: number;
  userId: number | null;
  entityType: string;
  entityId: number;
  registrationId: number | null;
  amount: string;
  currency: string;
  status: string;
  provider: string;
  paymentMethod: string | null;
  receiptUrl: string | null;
  refunded: boolean;
  refundAmount: string | null;
  refundedAt: string | null;
  metadata: string | null;
  createdAt: string;
}

interface OutstandingReg {
  id: number;
  userId?: string | number;
  programType?: string;
  programId?: number;
  programName?: string;
  amountPaid?: string;
  paymentStatus: string;
  createdAt?: string;
  // deposit/balance flow fields (league/tournament)
  offeringType?: string;
  offeringName?: string;
  totalAmount?: string | number;
  balanceDue?: string | number;
  balanceDueDate?: string | null;
  depositPaid?: boolean;
  playBlocked?: boolean;
}

interface PaymentSummary {
  byType: Record<string, { inApp: number; external: number; refunded: number; count: number }>;
  totals: { inApp: number; external: number; refunded: number; count: number };
}

interface RefundPolicy {
  id: number;
  name: string;
  entityType: string;
  refundType: string;
  windowDays: number;
  refundPercent: string;
  creditPercent: string;
  nonRefundableAmount: string;
  isActive: boolean;
}

export default function AdminPayments() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [tab, setTab] = useState<"summary" | "outstanding" | "external" | "refunds" | "facility-split" | "installments">("summary");

  const { data: disputeSummary } = useQuery<{ openCount: number }>({
    queryKey: ["disputes-summary"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/disputes/summary`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return { openCount: 0 };
      return res.json();
    },
    refetchInterval: 60_000,
  });
  const [payNextDialog, setPayNextDialog] = useState<{ clientSecret: string; publishableKey: string; amount: number } | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [filterType, setFilterType] = useState("");

  // External payment form
  const [extForm, setExtForm] = useState({ registrationId: "", amount: "", method: "cash", notes: "" });
  const [showExtForm, setShowExtForm] = useState(false);

  // Refund form
  const [refundForm, setRefundForm] = useState({ paymentId: "", policyId: "", reason: "", overrideAmount: "" });
  const [showRefundForm, setShowRefundForm] = useState(false);

  const authH = async () => ({
    Authorization: `Bearer ${await getToken()}`,
    "Content-Type": "application/json",
  });

  const { data: summary, isLoading: summaryLoading } = useQuery<PaymentSummary>({
    queryKey: ["payments-summary", from, to],
    queryFn: async () => {
      const token = await getToken();
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await fetch(`${API_BASE}/admin/payments/summary?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: tab === "summary",
  });

  const { data: outstanding, isLoading: outstandingLoading } = useQuery<OutstandingReg[]>({
    queryKey: ["payments-outstanding", filterType],
    queryFn: async () => {
      const token = await getToken();
      const headers = { Authorization: `Bearer ${token}` };

      // Fetch camp/drop-in outstanding (registrations table)
      const campTypes = ["camp", "drop_in"];
      const includeCamp = !filterType || campTypes.includes(filterType);
      const includeLeagueTournament = !filterType || filterType === "league" || filterType === "tournament";

      const results: OutstandingReg[] = [];

      if (includeCamp) {
        const params = new URLSearchParams();
        if (filterType && campTypes.includes(filterType)) params.set("programType", filterType);
        const res = await fetch(`${API_BASE}/admin/payments/outstanding?${params}`, { headers });
        if (res.ok) {
          const rows: OutstandingReg[] = await res.json();
          results.push(...rows);
        }
      }

      if (includeLeagueTournament) {
        // Fetch league/tournament deposit+balance outstanding rows
        const params = new URLSearchParams();
        if (filterType === "league") params.set("type", "league");
        else if (filterType === "tournament") params.set("type", "tournament");
        const res = await fetch(`${API_BASE}/admin/deposits/outstanding?${params}`, { headers });
        if (res.ok) {
          const rows: OutstandingReg[] = await res.json();
          results.push(...rows);
        }
      }

      return results;
    },
    enabled: tab === "outstanding",
  });

  const { data: externals, isLoading: externalsLoading } = useQuery<Payment[]>({
    queryKey: ["payments-external"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/payments/external`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: tab === "external",
  });

  const { data: payments, isLoading: paymentsLoading } = useQuery<Payment[]>({
    queryKey: ["payments", from, to],
    queryFn: async () => {
      const token = await getToken();
      const params = new URLSearchParams();
      params.set("status", "paid");
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await fetch(`${API_BASE}/payments?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: tab === "refunds",
  });

  const { data: policies } = useQuery<RefundPolicy[]>({
    queryKey: ["refund-policies"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/refund-policies`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: tab === "refunds",
  });

  interface FacilitySplitRow {
    entityType: string;
    count: number;
    gross: number;
    serviceFees: number;
    net: number;
    refunded: number;
    netAfterRefunds: number;
  }
  interface FacilitySplit {
    breakdown: FacilitySplitRow[];
    totals: Omit<FacilitySplitRow, "entityType">;
  }

  const { data: facilitySplit, isLoading: facilityLoading } = useQuery<FacilitySplit>({
    queryKey: ["facility-split", from, to],
    queryFn: async () => {
      const token = await getToken();
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await fetch(`${API_BASE}/admin/payments/facility-split?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: tab === "facility-split",
  });

  interface InstallmentPayment { id: number; installmentNumber: number; amount: string; dueDate: string; status: string; }
  interface InstallmentSchedule {
    id: number; userId: number; entityType: string; entityId: number;
    totalAmount: string; paidAmount: string; installmentCount: number; status: string; createdAt: string;
    payments: InstallmentPayment[];
  }

  const { data: installmentSchedules, isLoading: installmentsLoading } = useQuery<InstallmentSchedule[]>({
    queryKey: ["admin-installments"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/installments`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: tab === "installments",
  });

  const payNextMutation = useMutation({
    mutationFn: async (scheduleId: number) => {
      const headers = await authH();
      const res = await fetch(`${API_BASE}/admin/installments/${scheduleId}/pay-next`, { method: "POST", headers });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Failed"); }
      return res.json();
    },
    onSuccess: (data) => {
      setPayNextDialog({ clientSecret: data.clientSecret, publishableKey: data.publishableKey, amount: data.amount });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const sendRemindersMutation = useMutation({
    mutationFn: async () => {
      const headers = await authH();
      const res = await fetch(`${API_BASE}/admin/payments/send-balance-reminders`, { method: "POST", headers });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Failed"); }
      return res.json();
    },
    onSuccess: (data) => toast({ title: "Reminders sent", description: `${data.sent} in-app notification(s) queued.` }),
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const markExternalMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const headers = await authH();
      const res = await fetch(`${API_BASE}/admin/refunds/external`, { method: "POST", headers, body: JSON.stringify(payload) });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Failed"); }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payments-outstanding"] });
      qc.invalidateQueries({ queryKey: ["payments-external"] });
      setShowExtForm(false);
      setExtForm({ registrationId: "", amount: "", method: "cash", notes: "" });
      toast({ title: "External payment recorded" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const applyRefundMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const headers = await authH();
      const res = await fetch(`${API_BASE}/admin/refunds/apply`, { method: "POST", headers, body: JSON.stringify(payload) });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Failed"); }
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["payments"] });
      setShowRefundForm(false);
      setRefundForm({ paymentId: "", policyId: "", reason: "", overrideAmount: "" });
      const msg = data.action === "refund"
        ? `Refunded ${fmt(data.refundAmount)}`
        : data.action === "credit"
          ? `Issued ${fmt(data.creditAmount)} account credit`
          : "No refund issued";
      toast({ title: "Refund processed", description: msg });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (profileLoading) return <Layout><div className="p-12"><Skeleton className="h-96" /></div></Layout>;
  const canView = profile?.role === "admin" || profile?.role === "staff" || profile?.adminLevel === "super" || profile?.adminLevel === "admin";
  const isSuperAdmin = profile?.role === "admin" || profile?.adminLevel === "super" || profile?.adminLevel === "admin";
  if (!canView) return <Redirect to="/dashboard" />;

  const TABS = [
    { key: "summary", label: "Summary" },
    { key: "outstanding", label: "Outstanding Balances" },
    { key: "installments", label: "Installment Plans" },
    { key: "facility-split", label: "Facility Split" },
    { key: "external", label: "External Payments" },
    { key: "refunds", label: "Refunds / Credits" },
  ] as const;

  const statusColor = (s: string) => {
    if (s === "paid") return "bg-green-100 text-green-800";
    if (s === "paid_inapp") return "bg-green-100 text-green-800";
    if (s === "paid_external") return "bg-blue-100 text-blue-800";
    if (s === "unpaid") return "bg-red-100 text-red-800";
    if (s === "refunded") return "bg-amber-100 text-amber-800";
    return "bg-gray-100 text-gray-700";
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12">
        <a href="/admin" className="text-sm text-muted-foreground hover:text-foreground mb-4 block">← Admin</a>
        <h1 className="text-4xl font-bold font-sans uppercase tracking-tight text-primary mb-2">Financial Dashboard</h1>
        <p className="text-muted-foreground mb-4">Outstanding balances, payment log, external payments, and refunds/credits.</p>

        {(disputeSummary?.openCount ?? 0) > 0 && (
          <a href="/admin/disputes" className="flex items-start gap-3 p-4 mb-6 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100 transition-colors">
            <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0 text-amber-600" />
            <div>
              <p className="font-medium">
                {disputeSummary!.openCount} open chargeback dispute{disputeSummary!.openCount !== 1 ? "s" : ""} require attention
              </p>
              <p className="text-sm text-amber-700 mt-0.5">
                Click to view disputes and submit evidence in Stripe before your response window closes.
              </p>
            </div>
          </a>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Date filter (shared) */}
        {(tab === "summary" || tab === "refunds") && (
          <Card className="mb-6">
            <CardContent className="pt-4">
              <div className="flex flex-wrap gap-4">
                <div className="space-y-1">
                  <Label>From</Label>
                  <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-40" />
                </div>
                <div className="space-y-1">
                  <Label>To</Label>
                  <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-40" />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── SUMMARY ── */}
        {tab === "summary" && (
          summaryLoading ? <Skeleton className="h-64" /> : !summary ? null : (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                  <CardHeader className="pb-1"><CardTitle className="text-sm text-muted-foreground">In-App Collected</CardTitle></CardHeader>
                  <CardContent><p className="text-2xl font-bold text-green-600">{fmt(summary.totals.inApp)}</p></CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-1"><CardTitle className="text-sm text-muted-foreground">External (Cash/Venmo)</CardTitle></CardHeader>
                  <CardContent><p className="text-2xl font-bold text-blue-600">{fmt(summary.totals.external)}</p></CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-1"><CardTitle className="text-sm text-muted-foreground">Total Collected</CardTitle></CardHeader>
                  <CardContent><p className="text-2xl font-bold">{fmt(summary.totals.inApp + summary.totals.external)}</p></CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-1"><CardTitle className="text-sm text-muted-foreground">Refunded</CardTitle></CardHeader>
                  <CardContent><p className="text-2xl font-bold text-red-500">{fmt(summary.totals.refunded)}</p></CardContent>
                </Card>
              </div>
              <Card>
                <CardHeader><CardTitle>By Offering Type</CardTitle></CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-muted-foreground">
                          <th className="px-4 py-3 text-left">Type</th>
                          <th className="px-4 py-3 text-right">Payments</th>
                          <th className="px-4 py-3 text-right">In-App</th>
                          <th className="px-4 py-3 text-right">External</th>
                          <th className="px-4 py-3 text-right">Refunded</th>
                          <th className="px-4 py-3 text-right font-semibold">Net</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(summary.byType).map(([type, vals]) => (
                          <tr key={type} className="border-b last:border-0 hover:bg-muted/30">
                            <td className="px-4 py-3"><Badge variant="outline" className="text-xs">{type}</Badge></td>
                            <td className="px-4 py-3 text-right">{vals.count}</td>
                            <td className="px-4 py-3 text-right">{fmt(vals.inApp)}</td>
                            <td className="px-4 py-3 text-right">{fmt(vals.external)}</td>
                            <td className="px-4 py-3 text-right text-red-500">{fmt(vals.refunded)}</td>
                            <td className="px-4 py-3 text-right font-semibold">{fmt(vals.inApp + vals.external - vals.refunded)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
          )
        )}

        {/* ── OUTSTANDING BALANCES ── */}
        {tab === "outstanding" && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 mb-4">
              <select
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={filterType}
                onChange={e => setFilterType(e.target.value)}
              >
                <option value="">All types</option>
                <option value="league">Leagues</option>
                <option value="camp">Camps</option>
                <option value="drop_in">Drop-ins</option>
                <option value="tournament">Tournaments</option>
              </select>
              {isSuperAdmin && (
                <>
                  <Button size="sm" onClick={() => setShowExtForm(true)}>Log External Payment</Button>
                  <Button size="sm" variant="outline"
                    disabled={sendRemindersMutation.isPending}
                    onClick={() => sendRemindersMutation.mutate()}>
                    {sendRemindersMutation.isPending ? "Sending..." : "Send Balance Reminders"}
                  </Button>
                </>
              )}
            </div>

            {showExtForm && (
              <Card className="mb-4">
                <CardHeader><CardTitle>Log External Payment</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label>Registration ID *</Label>
                      <Input type="number" value={extForm.registrationId}
                        onChange={e => setExtForm(f => ({ ...f, registrationId: e.target.value }))} placeholder="Reg ID" />
                    </div>
                    <div className="space-y-1">
                      <Label>Amount Paid ($) *</Label>
                      <Input type="number" step="0.01" value={extForm.amount}
                        onChange={e => setExtForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" />
                    </div>
                    <div className="space-y-1">
                      <Label>Method</Label>
                      <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        value={extForm.method} onChange={e => setExtForm(f => ({ ...f, method: e.target.value }))}>
                        <option value="cash">Cash</option>
                        <option value="venmo">Venmo</option>
                        <option value="check">Check</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label>Notes</Label>
                      <Input value={extForm.notes} onChange={e => setExtForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional note" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      disabled={!extForm.registrationId || !extForm.amount || markExternalMutation.isPending}
                      onClick={() => markExternalMutation.mutate({
                        registrationId: Number(extForm.registrationId),
                        amount: Number(extForm.amount),
                        method: extForm.method,
                        notes: extForm.notes || undefined,
                      })}
                    >
                      {markExternalMutation.isPending ? "Saving..." : "Save"}
                    </Button>
                    <Button variant="outline" onClick={() => setShowExtForm(false)}>Cancel</Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {outstandingLoading ? <Skeleton className="h-48" /> : !outstanding?.length ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  No outstanding balances. Everyone's paid up!
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-muted-foreground">
                          <th className="px-4 py-3 text-left">Reg #</th>
                          <th className="px-4 py-3 text-left">Program</th>
                          <th className="px-4 py-3 text-left">Type</th>
                          <th className="px-4 py-3 text-right">Paid</th>
                          <th className="px-4 py-3 text-right">Balance Due</th>
                          <th className="px-4 py-3 text-left">Status</th>
                          <th className="px-4 py-3 text-left">Due Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {outstanding.map(r => {
                          // Deposit/balance rows (league/tournament) have offeringType
                          const isDepositRow = !!r.offeringType;
                          const programLabel = isDepositRow ? r.offeringName : r.programName;
                          const typeLabel = isDepositRow ? r.offeringType : r.programType;
                          const paid = isDepositRow ? Number(r.amountPaid ?? 0) : Number(r.amountPaid ?? 0);
                          const balanceDue = isDepositRow ? Number(r.balanceDue ?? 0) : null;
                          const dueDateStr = r.balanceDueDate ? (() => { try { return format(new Date(r.balanceDueDate!), "MMM d, yyyy"); } catch { return r.balanceDueDate; } })() : "—";
                          const createdStr = r.createdAt ? (() => { try { return format(new Date(r.createdAt), "MMM d, yyyy"); } catch { return "—"; } })() : "—";
                          return (
                            <tr key={`${isDepositRow ? "dep" : "reg"}-${r.id}`} className="border-b last:border-0 hover:bg-muted/30">
                              <td className="px-4 py-3 font-mono text-xs">#{r.id}</td>
                              <td className="px-4 py-3 font-medium">{programLabel ?? "—"}</td>
                              <td className="px-4 py-3">
                                <Badge variant="outline" className="text-xs">{typeLabel ?? "—"}</Badge>
                                {r.playBlocked && <Badge variant="destructive" className="text-xs ml-1">Blocked</Badge>}
                              </td>
                              <td className="px-4 py-3 text-right">{fmt(paid)}</td>
                              <td className="px-4 py-3 text-right">
                                {balanceDue != null ? <span className="font-semibold text-red-600">{fmt(balanceDue)}</span> : "—"}
                              </td>
                              <td className="px-4 py-3">
                                <span className={`text-xs font-medium px-2 py-1 rounded-full ${statusColor(r.paymentStatus)}`}>
                                  {r.paymentStatus}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-muted-foreground text-xs">
                                {isDepositRow ? dueDateStr : createdStr}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* ── INSTALLMENT PLANS ── */}
        {tab === "installments" && (
          <div className="space-y-4">
            {installmentsLoading ? <Skeleton className="h-48" /> : !installmentSchedules?.length ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  No installment plans found.
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-muted-foreground">
                          <th className="px-4 py-3 text-left">Schedule #</th>
                          <th className="px-4 py-3 text-left">Type</th>
                          <th className="px-4 py-3 text-left">Entity #</th>
                          <th className="px-4 py-3 text-right">Total</th>
                          <th className="px-4 py-3 text-right">Paid</th>
                          <th className="px-4 py-3 text-right">Remaining</th>
                          <th className="px-4 py-3 text-center">Installments</th>
                          <th className="px-4 py-3 text-left">Status</th>
                          <th className="px-4 py-3 text-left">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {installmentSchedules.map(s => {
                          const pending = s.payments.filter(p => p.status === "pending");
                          const paid = s.payments.filter(p => p.status === "paid");
                          const remaining = Number(s.totalAmount) - Number(s.paidAmount);
                          return (
                            <tr key={s.id} className="border-b last:border-0 hover:bg-muted/30">
                              <td className="px-4 py-3 font-mono text-xs">#{s.id}</td>
                              <td className="px-4 py-3"><Badge variant="outline" className="text-xs">{s.entityType}</Badge></td>
                              <td className="px-4 py-3 text-muted-foreground text-xs">#{s.entityId}</td>
                              <td className="px-4 py-3 text-right font-semibold">{fmt(Number(s.totalAmount))}</td>
                              <td className="px-4 py-3 text-right text-green-600">{fmt(Number(s.paidAmount))}</td>
                              <td className="px-4 py-3 text-right text-amber-600">{fmt(remaining)}</td>
                              <td className="px-4 py-3 text-center text-xs">{paid.length}/{s.installmentCount}</td>
                              <td className="px-4 py-3">
                                <span className={`text-xs font-medium px-2 py-1 rounded-full ${s.status === "active" ? "bg-blue-100 text-blue-800" : s.status === "completed" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-700"}`}>
                                  {s.status}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                {pending.length > 0 && s.status === "active" ? (
                                  <Button
                                    size="sm"
                                    disabled={payNextMutation.isPending}
                                    onClick={() => payNextMutation.mutate(s.id)}
                                  >
                                    {payNextMutation.isPending ? "Loading…" : `Charge Installment #${pending[0].installmentNumber}`}
                                  </Button>
                                ) : (
                                  <span className="text-xs text-muted-foreground">
                                    {s.status === "completed" ? "Complete" : "No pending"}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* ── FACILITY SPLIT ── */}
        {tab === "facility-split" && (
          <div className="space-y-6">
            <Card className="mb-4">
              <CardContent className="pt-4">
                <div className="flex flex-wrap gap-4">
                  <div className="space-y-1">
                    <Label>From</Label>
                    <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="rounded-md border border-input bg-background px-3 py-2 text-sm w-40" />
                  </div>
                  <div className="space-y-1">
                    <Label>To</Label>
                    <input type="date" value={to} onChange={e => setTo(e.target.value)} className="rounded-md border border-input bg-background px-3 py-2 text-sm w-40" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {facilityLoading ? <Skeleton className="h-64" /> : !facilitySplit ? null : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card>
                    <CardHeader className="pb-1"><CardTitle className="text-sm text-muted-foreground">Gross Collected</CardTitle></CardHeader>
                    <CardContent><p className="text-2xl font-bold">{fmt(facilitySplit.totals.gross)}</p></CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-1"><CardTitle className="text-sm text-muted-foreground">Service Fees</CardTitle></CardHeader>
                    <CardContent><p className="text-2xl font-bold text-blue-600">{fmt(facilitySplit.totals.serviceFees)}</p></CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-1"><CardTitle className="text-sm text-muted-foreground">Net to Facility</CardTitle></CardHeader>
                    <CardContent><p className="text-2xl font-bold text-green-600">{fmt(facilitySplit.totals.net)}</p></CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-1"><CardTitle className="text-sm text-muted-foreground">Net After Refunds</CardTitle></CardHeader>
                    <CardContent><p className="text-2xl font-bold text-green-700">{fmt(facilitySplit.totals.netAfterRefunds)}</p></CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader><CardTitle>Breakdown by Offering Type</CardTitle></CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-muted-foreground">
                            <th className="px-4 py-3 text-left">Type</th>
                            <th className="px-4 py-3 text-right">Payments</th>
                            <th className="px-4 py-3 text-right">Gross</th>
                            <th className="px-4 py-3 text-right">Service Fees</th>
                            <th className="px-4 py-3 text-right font-semibold">Net to Facility</th>
                            <th className="px-4 py-3 text-right">Refunded</th>
                            <th className="px-4 py-3 text-right font-semibold">Net After Refunds</th>
                          </tr>
                        </thead>
                        <tbody>
                          {facilitySplit.breakdown.map(row => (
                            <tr key={row.entityType} className="border-b last:border-0 hover:bg-muted/30">
                              <td className="px-4 py-3"><Badge variant="outline" className="text-xs">{row.entityType}</Badge></td>
                              <td className="px-4 py-3 text-right">{row.count}</td>
                              <td className="px-4 py-3 text-right">{fmt(row.gross)}</td>
                              <td className="px-4 py-3 text-right text-blue-600">{fmt(row.serviceFees)}</td>
                              <td className="px-4 py-3 text-right font-semibold text-green-700">{fmt(row.net)}</td>
                              <td className="px-4 py-3 text-right text-red-500">{fmt(row.refunded)}</td>
                              <td className="px-4 py-3 text-right font-bold">{fmt(row.netAfterRefunds)}</td>
                            </tr>
                          ))}
                          <tr className="bg-muted/40 font-semibold">
                            <td className="px-4 py-3">Total</td>
                            <td className="px-4 py-3 text-right">{facilitySplit.totals.count}</td>
                            <td className="px-4 py-3 text-right">{fmt(facilitySplit.totals.gross)}</td>
                            <td className="px-4 py-3 text-right text-blue-600">{fmt(facilitySplit.totals.serviceFees)}</td>
                            <td className="px-4 py-3 text-right text-green-700">{fmt(facilitySplit.totals.net)}</td>
                            <td className="px-4 py-3 text-right text-red-500">{fmt(facilitySplit.totals.refunded)}</td>
                            <td className="px-4 py-3 text-right font-bold">{fmt(facilitySplit.totals.netAfterRefunds)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        )}

        {/* ── EXTERNAL PAYMENTS LOG ── */}
        {tab === "external" && (
          externalsLoading ? <Skeleton className="h-48" /> : !externals?.length ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No external payments logged yet.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="px-4 py-3 text-left">Date</th>
                        <th className="px-4 py-3 text-left">Offering</th>
                        <th className="px-4 py-3 text-left">Method</th>
                        <th className="px-4 py-3 text-right">Amount</th>
                        <th className="px-4 py-3 text-left">Reg #</th>
                      </tr>
                    </thead>
                    <tbody>
                      {externals.map(p => (
                        <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="px-4 py-3 text-muted-foreground text-xs">{format(new Date(p.createdAt), "MMM d, yyyy")}</td>
                          <td className="px-4 py-3"><Badge variant="outline" className="text-xs">{p.entityType} #{p.entityId}</Badge></td>
                          <td className="px-4 py-3 capitalize">{p.paymentMethod ?? "—"}</td>
                          <td className="px-4 py-3 text-right font-semibold">{fmt(Number(p.amount))}</td>
                          <td className="px-4 py-3 text-muted-foreground text-xs">{p.registrationId ? `#${p.registrationId}` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )
        )}

        {/* ── REFUNDS / CREDITS ── */}
        {tab === "refunds" && (
          <div className="space-y-4">
            {isSuperAdmin && (
              <div className="flex justify-end mb-4">
                <Button size="sm" onClick={() => setShowRefundForm(true)}>Apply Refund / Credit</Button>
              </div>
            )}

            {showRefundForm && (
              <Card className="mb-4">
                <CardHeader><CardTitle>Apply Refund or Credit</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Service fee is always non-refundable. The refund policy determines whether the program fee is refunded to the original payment method or issued as an account credit.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label>Payment ID *</Label>
                      <Input type="number" value={refundForm.paymentId}
                        onChange={e => setRefundForm(f => ({ ...f, paymentId: e.target.value }))} placeholder="Payment ID" />
                    </div>
                    <div className="space-y-1">
                      <Label>Refund Policy (optional)</Label>
                      <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        value={refundForm.policyId} onChange={e => setRefundForm(f => ({ ...f, policyId: e.target.value }))}>
                        <option value="">Full refund (no policy)</option>
                        {policies?.filter(p => p.isActive).map(p => (
                          <option key={p.id} value={String(p.id)}>
                            {p.name} ({p.refundType === "credit" ? `${p.creditPercent}% credit` : `${p.refundPercent}% refund`})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label>Override Amount ($)</Label>
                      <Input type="number" step="0.01" value={refundForm.overrideAmount}
                        onChange={e => setRefundForm(f => ({ ...f, overrideAmount: e.target.value }))} placeholder="Leave blank to use policy" />
                    </div>
                    <div className="space-y-1">
                      <Label>Reason</Label>
                      <Input value={refundForm.reason} onChange={e => setRefundForm(f => ({ ...f, reason: e.target.value }))} placeholder="e.g. weather cancellation, early withdrawal" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      disabled={!refundForm.paymentId || applyRefundMutation.isPending}
                      onClick={() => applyRefundMutation.mutate({
                        paymentId: Number(refundForm.paymentId),
                        policyId: refundForm.policyId ? Number(refundForm.policyId) : undefined,
                        reason: refundForm.reason || undefined,
                        overrideAmount: refundForm.overrideAmount ? Number(refundForm.overrideAmount) : undefined,
                      })}
                    >
                      {applyRefundMutation.isPending ? "Processing..." : "Process Refund"}
                    </Button>
                    <Button variant="outline" onClick={() => setShowRefundForm(false)}>Cancel</Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {paymentsLoading ? <Skeleton className="h-48" /> : !payments?.length ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  No paid payments found in this date range.
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-muted-foreground">
                          <th className="px-4 py-3 text-left">ID</th>
                          <th className="px-4 py-3 text-left">Date</th>
                          <th className="px-4 py-3 text-left">Type</th>
                          <th className="px-4 py-3 text-left">Method</th>
                          <th className="px-4 py-3 text-right">Amount</th>
                          <th className="px-4 py-3 text-left">Status</th>
                          <th className="px-4 py-3 text-right">Refunded</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payments.map(p => (
                          <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30">
                            <td className="px-4 py-3 font-mono text-xs">#{p.id}</td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">{format(new Date(p.createdAt), "MMM d, yyyy")}</td>
                            <td className="px-4 py-3"><Badge variant="outline" className="text-xs">{p.entityType}</Badge></td>
                            <td className="px-4 py-3 capitalize text-xs">{p.paymentMethod ?? p.provider}</td>
                            <td className="px-4 py-3 text-right font-semibold">{fmt(Number(p.amount))}</td>
                            <td className="px-4 py-3">
                              <span className={`text-xs font-medium px-2 py-1 rounded-full ${p.refunded ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800"}`}>
                                {p.refunded ? "refunded" : "paid"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right text-xs text-red-500">
                              {p.refunded && p.refundAmount ? fmt(Number(p.refundAmount)) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
      {payNextDialog && (
        <InlinePaymentDialog
          open={true}
          clientSecret={payNextDialog.clientSecret}
          publishableKey={payNextDialog.publishableKey}
          amount={payNextDialog.amount}
          onSuccess={() => {
            setPayNextDialog(null);
            qc.invalidateQueries({ queryKey: ["admin-installments"] });
            toast({ title: "Installment charged", description: "Payment collected successfully." });
          }}
          onCancel={() => setPayNextDialog(null)}
        />
      )}
    </Layout>
  );
}
