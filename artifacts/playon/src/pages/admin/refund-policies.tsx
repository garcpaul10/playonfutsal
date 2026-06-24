import React, { useState } from "react";
import { Redirect } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { useToast } from "@/hooks/use-toast";

interface RefundPolicy {
  id: number;
  name: string;
  entityType: string;
  refundType: string;
  windowDays: number;
  windowMinutes: number | null;
  refundPercent: string;
  creditPercent: string;
  nonRefundableAmount: string;
  allowPartialRefund: boolean;
  requiresAdminApproval: boolean;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
}

const EMPTY_FORM = {
  name: "",
  entityType: "all",
  refundType: "credit" as "credit" | "original" | "none",
  windowDays: "7",
  windowMinutes: "",
  refundPercent: "100",
  creditPercent: "100",
  nonRefundableAmount: "0",
  allowPartialRefund: true,
  requiresAdminApproval: false,
  notes: "",
};

export default function AdminRefundPolicies() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<RefundPolicy | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const authH = async () => ({
    Authorization: `Bearer ${await getToken()}`,
    "Content-Type": "application/json",
  });

  const { data: policies, isLoading } = useQuery<RefundPolicy[]>({
    queryKey: ["refund-policies"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/admin/refund-policies", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const headers = await authH();
      const res = await fetch("/api/admin/refund-policies", { method: "POST", headers, body: JSON.stringify(payload) });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Failed"); }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["refund-policies"] });
      setShowForm(false);
      setForm({ ...EMPTY_FORM });
      toast({ title: "Refund policy created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: Record<string, unknown> }) => {
      const headers = await authH();
      const res = await fetch(`/api/admin/refund-policies/${id}`, { method: "PATCH", headers, body: JSON.stringify(payload) });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Failed"); }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["refund-policies"] });
      setEditing(null);
      setShowForm(false);
      toast({ title: "Policy updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deactivateMutation = useMutation({
    mutationFn: async (id: number) => {
      const token = await getToken();
      await fetch(`/api/admin/refund-policies/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token ?? ""}` } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["refund-policies"] });
      toast({ title: "Policy deactivated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setShowForm(true);
  }

  function openEdit(p: RefundPolicy) {
    setEditing(p);
    setForm({
      name: p.name,
      entityType: p.entityType,
      refundType: p.refundType as "credit" | "original" | "none",
      windowDays: String(p.windowDays),
      windowMinutes: p.windowMinutes != null ? String(p.windowMinutes) : "",
      refundPercent: p.refundPercent,
      creditPercent: p.creditPercent,
      nonRefundableAmount: p.nonRefundableAmount,
      allowPartialRefund: p.allowPartialRefund,
      requiresAdminApproval: p.requiresAdminApproval,
      notes: p.notes ?? "",
    });
    setShowForm(true);
  }

  function buildPayload() {
    return {
      name: form.name,
      entityType: form.entityType,
      refundType: form.refundType,
      windowDays: Number(form.windowDays),
      windowMinutes: form.windowMinutes !== "" ? Number(form.windowMinutes) : null,
      refundPercent: Number(form.refundPercent),
      creditPercent: Number(form.creditPercent),
      nonRefundableAmount: Number(form.nonRefundableAmount),
      allowPartialRefund: form.allowPartialRefund,
      requiresAdminApproval: form.requiresAdminApproval,
      notes: form.notes || null,
    };
  }

  if (profileLoading) return <Layout><div className="p-12"><Skeleton className="h-96" /></div></Layout>;
  const isSuperAdmin = profile?.role === "admin" || profile?.adminLevel === "super" || profile?.adminLevel === "admin";
  const canView = profile?.role === "admin" || profile?.role === "staff" || profile?.adminLevel === "super" || profile?.adminLevel === "admin";
  if (!canView) return <Redirect to="/dashboard" />;

  const isPending = createMutation.isPending || updateMutation.isPending;

  const refundTypeLabel = (t: string) => {
    if (t === "credit") return "Account Credit";
    if (t === "original") return "Original Method";
    if (t === "none") return "No Refund";
    return t;
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12">
        <a href="/admin" className="text-sm text-muted-foreground hover:text-foreground mb-4 block">← Admin</a>
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-4xl font-bold font-sans uppercase tracking-tight text-primary">Refund & Credit Policies</h1>
          {isSuperAdmin && <Button onClick={openCreate}>+ New Policy</Button>}
        </div>
        <p className="text-muted-foreground mb-8">
          Rules that govern how cancellations are handled — automatic credit, partial refund, or no refund. Service fee is always non-refundable.
        </p>

        {showForm && (
          <Card className="mb-8">
            <CardHeader><CardTitle>{editing ? "Edit Policy" : "Create Refund Policy"}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Policy Name *</Label>
                  <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Weather Cancellation Policy" />
                </div>
                <div className="space-y-1">
                  <Label>Applies To</Label>
                  <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={form.entityType} onChange={e => setForm(f => ({ ...f, entityType: e.target.value }))}>
                    <option value="all">All offerings</option>
                    <option value="league">Leagues</option>
                    <option value="camp">Camps</option>
                    <option value="drop_in">Drop-ins</option>
                    <option value="tournament">Tournaments</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Refund Type *</Label>
                  <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={form.refundType} onChange={e => setForm(f => ({ ...f, refundType: e.target.value as "credit" | "original" | "none" }))}>
                    <option value="credit">Issue account credit</option>
                    <option value="original">Refund to original payment method</option>
                    <option value="none">No refund</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Window (days before event)</Label>
                  <Input type="number" min="0" value={form.windowDays}
                    onChange={e => setForm(f => ({ ...f, windowDays: e.target.value }))} placeholder="e.g. 7" />
                  <p className="text-xs text-muted-foreground">Used for leagues, camps, and tournaments.</p>
                </div>
                <div className="space-y-1">
                  <Label>Window (minutes before event)</Label>
                  <Input type="number" min="0" value={form.windowMinutes}
                    onChange={e => setForm(f => ({ ...f, windowMinutes: e.target.value }))} placeholder="e.g. 120 (drop-ins only)" />
                  <p className="text-xs text-muted-foreground">Used for drop-in sessions. Overrides days for drop-in type policies.</p>
                </div>
                {form.refundType === "original" && (
                  <div className="space-y-1">
                    <Label>Refund Percent (%)</Label>
                    <Input type="number" min="0" max="100" step="1" value={form.refundPercent}
                      onChange={e => setForm(f => ({ ...f, refundPercent: e.target.value }))} />
                  </div>
                )}
                {form.refundType === "credit" && (
                  <div className="space-y-1">
                    <Label>Credit Percent (%)</Label>
                    <Input type="number" min="0" max="100" step="1" value={form.creditPercent}
                      onChange={e => setForm(f => ({ ...f, creditPercent: e.target.value }))} />
                  </div>
                )}
                <div className="space-y-1">
                  <Label>Non-Refundable Amount ($)</Label>
                  <Input type="number" step="0.01" min="0" value={form.nonRefundableAmount}
                    onChange={e => setForm(f => ({ ...f, nonRefundableAmount: e.target.value }))} placeholder="0" />
                  <p className="text-xs text-muted-foreground">Amount withheld regardless of policy (e.g. registration fee). Service fee always retained separately.</p>
                </div>
                <div className="space-y-1">
                  <Label>Notes</Label>
                  <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="e.g. Weather cancellations only" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <input type="checkbox" id="partial" checked={form.allowPartialRefund}
                    onChange={e => setForm(f => ({ ...f, allowPartialRefund: e.target.checked }))} />
                  <Label htmlFor="partial">Allow partial refunds</Label>
                </div>
                <div className="flex items-center gap-3">
                  <input type="checkbox" id="approval" checked={form.requiresAdminApproval}
                    onChange={e => setForm(f => ({ ...f, requiresAdminApproval: e.target.checked }))} />
                  <Label htmlFor="approval">Requires admin approval before issuing</Label>
                </div>
              </div>
              <div className="flex gap-2">
                <Button disabled={!form.name || isPending} onClick={() => {
                  if (editing) {
                    updateMutation.mutate({ id: editing.id, payload: buildPayload() });
                  } else {
                    createMutation.mutate(buildPayload());
                  }
                }}>
                  {isPending ? "Saving..." : editing ? "Save Changes" : "Create Policy"}
                </Button>
                <Button variant="outline" onClick={() => { setShowForm(false); setEditing(null); }}>Cancel</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-14" />)}</div>
        ) : !policies?.length ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No refund policies yet. Create one to standardize how cancellations are handled.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {policies.map(p => (
              <Card key={p.id} className={p.isActive ? "" : "opacity-60"}>
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold">{p.name}</h3>
                        <Badge variant={p.isActive ? "default" : "outline"} className="text-xs">
                          {p.isActive ? "active" : "inactive"}
                        </Badge>
                        <Badge variant="outline" className="text-xs">{p.entityType}</Badge>
                      </div>
                      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
                        <span>Type: <span className="text-foreground font-medium">{refundTypeLabel(p.refundType)}</span></span>
                        {p.windowMinutes != null
                          ? <span>Window: <span className="text-foreground">{p.windowMinutes}m</span></span>
                          : <span>Window: <span className="text-foreground">{p.windowDays}d</span></span>
                        }
                        {p.refundType === "original" && <span>Refund: <span className="text-foreground">{p.refundPercent}%</span></span>}
                        {p.refundType === "credit" && <span>Credit: <span className="text-foreground">{p.creditPercent}%</span></span>}
                        {Number(p.nonRefundableAmount) > 0 && <span>Withheld: <span className="text-foreground">${p.nonRefundableAmount}</span></span>}
                        {p.requiresAdminApproval && <span className="text-amber-600">Requires approval</span>}
                      </div>
                      {p.notes && <p className="text-xs text-muted-foreground mt-1 italic">{p.notes}</p>}
                    </div>
                    {isSuperAdmin && (
                      <div className="flex gap-2 flex-shrink-0">
                        <Button size="sm" variant="outline" onClick={() => openEdit(p)}>Edit</Button>
                        {p.isActive && (
                          <Button size="sm" variant="outline" className="text-red-600"
                            onClick={() => deactivateMutation.mutate(p.id)}>
                            Deactivate
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
