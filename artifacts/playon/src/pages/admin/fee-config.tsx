import React, { useState } from "react";
import { Redirect } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { useToast } from "@/hooks/use-toast";

interface ServiceFeeConfig {
  id: number;
  name: string;
  feePercent: string;
  maxFeeAmount: string | null;
  minFeeAmount: string | null;
  appliesToCard: boolean;
  appliesToExternal: boolean;
  nonRefundable: boolean;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
}

export default function AdminFeeConfig() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    feePercent: "",
    maxFeeAmount: "",
    minFeeAmount: "",
    appliesToCard: true,
    appliesToExternal: false,
    notes: "",
  });

  const authHeader = async () => ({
    Authorization: `Bearer ${await getToken()}`,
    "Content-Type": "application/json",
  });

  const { data: config, isLoading } = useQuery<ServiceFeeConfig>({
    queryKey: ["service-fee-config"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/admin/service-fee-config", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const headers = await authHeader();
      const res = await fetch("/api/admin/service-fee-config", {
        method: "PATCH",
        headers,
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Failed"); }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["service-fee-config"] });
      setEditing(false);
      toast({ title: "Service fee configuration updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (profileLoading) return <Layout><div className="p-12"><Skeleton className="h-96" /></div></Layout>;
  const isSuperAdmin = profile?.role === "admin" || profile?.adminLevel === "super" || profile?.adminLevel === "admin";
  const canView = profile?.role === "admin" || profile?.role === "staff" || profile?.adminLevel === "super" || profile?.adminLevel === "admin";

  if (!canView) return <Redirect to="/dashboard" />;

  function openEdit() {
    if (!config) return;
    setForm({
      feePercent: config.feePercent,
      maxFeeAmount: config.maxFeeAmount ?? "",
      minFeeAmount: config.minFeeAmount ?? "",
      appliesToCard: config.appliesToCard,
      appliesToExternal: config.appliesToExternal,
      notes: config.notes ?? "",
    });
    setEditing(true);
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-2xl">
        <a href="/admin" className="text-sm text-muted-foreground hover:text-foreground mb-4 block">← Admin</a>
        <h1 className="text-4xl font-bold font-sans uppercase tracking-tight text-primary mb-2">Service Fee</h1>
        <p className="text-muted-foreground mb-8">
          Pass-through fee on in-app card payments to cover Stripe processing costs. Non-refundable. Shown at checkout.
        </p>

        {isLoading ? (
          <Skeleton className="h-64" />
        ) : config ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Active Configuration</CardTitle>
              {isSuperAdmin && !editing && <Button size="sm" onClick={openEdit}>Edit</Button>}
            </CardHeader>
            <CardContent className="space-y-4">
              {editing ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label>Fee Percentage (%) *</Label>
                      <Input type="number" step="0.01" min="0" max="100" value={form.feePercent}
                        onChange={e => setForm(f => ({ ...f, feePercent: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>Maximum Fee Amount ($)</Label>
                      <Input type="number" step="0.01" value={form.maxFeeAmount}
                        onChange={e => setForm(f => ({ ...f, maxFeeAmount: e.target.value }))} placeholder="No cap" />
                    </div>
                    <div className="space-y-1">
                      <Label>Minimum Fee Amount ($)</Label>
                      <Input type="number" step="0.01" value={form.minFeeAmount}
                        onChange={e => setForm(f => ({ ...f, minFeeAmount: e.target.value }))} placeholder="No floor" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <input type="checkbox" id="card" checked={form.appliesToCard}
                        onChange={e => setForm(f => ({ ...f, appliesToCard: e.target.checked }))} />
                      <Label htmlFor="card">Applies to in-app card payments</Label>
                    </div>
                    <div className="flex items-center gap-3">
                      <input type="checkbox" id="external" checked={form.appliesToExternal}
                        onChange={e => setForm(f => ({ ...f, appliesToExternal: e.target.checked }))} />
                      <Label htmlFor="external">Applies to cash / external payments</Label>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>Notes</Label>
                    <textarea className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px]"
                      value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={() => updateMutation.mutate({
                      feePercent: Number(form.feePercent),
                      maxFeeAmount: form.maxFeeAmount ? Number(form.maxFeeAmount) : null,
                      minFeeAmount: form.minFeeAmount ? Number(form.minFeeAmount) : null,
                      appliesToCard: form.appliesToCard,
                      appliesToExternal: form.appliesToExternal,
                      notes: form.notes || null,
                    })} disabled={!form.feePercent}>
                      {updateMutation.isPending ? "Saving..." : "Save Configuration"}
                    </Button>
                    <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div><span className="text-muted-foreground">Fee Rate</span><p className="font-semibold text-xl">{config.feePercent}%</p></div>
                    {config.maxFeeAmount && <div><span className="text-muted-foreground">Max Fee</span><p className="font-semibold">${config.maxFeeAmount}</p></div>}
                    {config.minFeeAmount && <div><span className="text-muted-foreground">Min Fee</span><p className="font-semibold">${config.minFeeAmount}</p></div>}
                  </div>
                  <div className="space-y-1 text-sm">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${config.appliesToCard ? "bg-green-500" : "bg-gray-400"}`} />
                      <span>In-app card payments: {config.appliesToCard ? "applies" : "exempt"}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${config.appliesToExternal ? "bg-green-500" : "bg-gray-400"}`} />
                      <span>Cash / external payments: {config.appliesToExternal ? "applies" : "exempt"}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                      <span>Non-refundable (covers Stripe processing cost)</span>
                    </div>
                  </div>
                  {config.notes && <p className="text-sm text-muted-foreground italic">{config.notes}</p>}
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </Layout>
  );
}
