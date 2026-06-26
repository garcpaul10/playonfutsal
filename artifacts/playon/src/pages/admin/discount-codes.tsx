import { API_BASE } from "@/lib/api-base";
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
import { format } from "date-fns";

interface DiscountCode {
  id: number;
  code: string;
  description: string | null;
  discountType: string;
  discountValue: string;
  applicableTo: string;
  entityType: string | null;
  entityId: number | null;
  maxUses: number | null;
  timesUsed: number;
  minOrderAmount: string | null;
  validFrom: string | null;
  validUntil: string | null;
  isActive: boolean;
  createdAt: string;
}

const EMPTY_FORM = {
  code: "",
  description: "",
  discountType: "percent" as "percent" | "amount",
  discountValue: "",
  applicableTo: "all",
  entityType: "",
  maxUses: "",
  minOrderAmount: "",
  validFrom: "",
  validUntil: "",
};

export default function AdminDiscountCodes() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<DiscountCode | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const authH = async () => ({
    Authorization: `Bearer ${await getToken()}`,
    "Content-Type": "application/json",
  });

  const { data: codes, isLoading } = useQuery<DiscountCode[]>({
    queryKey: ["discount-codes"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/discount-codes`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const headers = await authH();
      const res = await fetch(`${API_BASE}/admin/discount-codes`, { method: "POST", headers, body: JSON.stringify(payload) });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Failed"); }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["discount-codes"] });
      setShowForm(false);
      setForm({ ...EMPTY_FORM });
      toast({ title: "Discount code created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: Record<string, unknown> }) => {
      const headers = await authH();
      const res = await fetch(`${API_BASE}/admin/discount-codes/${id}`, { method: "PATCH", headers, body: JSON.stringify(payload) });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Failed"); }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["discount-codes"] });
      setEditing(null);
      setShowForm(false);
      toast({ title: "Discount code updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deactivateMutation = useMutation({
    mutationFn: async (id: number) => {
      const headers = await authH();
      await fetch(`${API_BASE}/admin/discount-codes/${id}`, { method: "DELETE", headers: { Authorization: (await getToken()) ?? "" } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["discount-codes"] });
      toast({ title: "Discount code deactivated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setShowForm(true);
  }

  function openEdit(dc: DiscountCode) {
    setEditing(dc);
    setForm({
      code: dc.code,
      description: dc.description ?? "",
      discountType: dc.discountType as "percent" | "amount",
      discountValue: dc.discountValue,
      applicableTo: dc.applicableTo,
      entityType: dc.entityType ?? "",
      maxUses: dc.maxUses != null ? String(dc.maxUses) : "",
      minOrderAmount: dc.minOrderAmount ?? "",
      validFrom: dc.validFrom ? dc.validFrom.slice(0, 10) : "",
      validUntil: dc.validUntil ? dc.validUntil.slice(0, 10) : "",
    });
    setShowForm(true);
  }

  function buildPayload() {
    return {
      code: form.code,
      description: form.description || null,
      discountType: form.discountType,
      discountValue: Number(form.discountValue),
      applicableTo: form.applicableTo,
      entityType: form.entityType || null,
      maxUses: form.maxUses ? Number(form.maxUses) : null,
      minOrderAmount: form.minOrderAmount ? Number(form.minOrderAmount) : null,
      validFrom: form.validFrom || null,
      validUntil: form.validUntil || null,
    };
  }

  function submit() {
    if (editing) {
      updateMutation.mutate({ id: editing.id, payload: buildPayload() });
    } else {
      createMutation.mutate(buildPayload());
    }
  }

  if (profileLoading) return <Layout><div className="p-12"><Skeleton className="h-96" /></div></Layout>;
  const isSuperAdmin = profile?.role === "admin" || profile?.adminLevel === "super" || profile?.adminLevel === "admin";
  const canView = profile?.role === "admin" || profile?.role === "staff" || profile?.adminLevel === "super" || profile?.adminLevel === "admin";
  if (!canView) return <Redirect to="/dashboard" />;

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12">
        <a href="/admin" className="text-sm text-muted-foreground hover:text-foreground mb-4 block">← Admin</a>
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-4xl font-bold font-sans uppercase tracking-tight text-primary">Discount Codes</h1>
          {isSuperAdmin && <Button onClick={openCreate}>+ New Code</Button>}
        </div>
        <p className="text-muted-foreground mb-8">Promo codes, early-bird discounts, and family rates for any offering.</p>

        {showForm && (
          <Card className="mb-8">
            <CardHeader><CardTitle>{editing ? "Edit Code" : "Create Discount Code"}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Code * (auto-uppercased)</Label>
                  <Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                    placeholder="e.g. SUMMER25" disabled={!!editing} />
                </div>
                <div className="space-y-1">
                  <Label>Description</Label>
                  <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional label" />
                </div>
                <div className="space-y-1">
                  <Label>Discount Type *</Label>
                  <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={form.discountType} onChange={e => setForm(f => ({ ...f, discountType: e.target.value as "percent" | "amount" }))}>
                    <option value="percent">Percent off (%)</option>
                    <option value="amount">Fixed amount ($)</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Discount Value * ({form.discountType === "percent" ? "%" : "$"})</Label>
                  <Input type="number" step="0.01" min="0" value={form.discountValue}
                    onChange={e => setForm(f => ({ ...f, discountValue: e.target.value }))} placeholder="e.g. 10" />
                </div>
                <div className="space-y-1">
                  <Label>Applies To</Label>
                  <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={form.applicableTo} onChange={e => setForm(f => ({ ...f, applicableTo: e.target.value }))}>
                    <option value="all">All offerings</option>
                    <option value="league">Leagues only</option>
                    <option value="camp">Camps only</option>
                    <option value="drop_in">Drop-ins only</option>
                    <option value="tournament">Tournaments only</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Max Uses</Label>
                  <Input type="number" value={form.maxUses} onChange={e => setForm(f => ({ ...f, maxUses: e.target.value }))} placeholder="Unlimited" />
                </div>
                <div className="space-y-1">
                  <Label>Min Order Amount ($)</Label>
                  <Input type="number" step="0.01" value={form.minOrderAmount}
                    onChange={e => setForm(f => ({ ...f, minOrderAmount: e.target.value }))} placeholder="No minimum" />
                </div>
                <div className="space-y-1">
                  <Label>Valid From</Label>
                  <Input type="date" value={form.validFrom} onChange={e => setForm(f => ({ ...f, validFrom: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Valid Until</Label>
                  <Input type="date" value={form.validUntil} onChange={e => setForm(f => ({ ...f, validUntil: e.target.value }))} />
                </div>
              </div>
              <div className="flex gap-2">
                <Button disabled={!form.code || !form.discountValue || isPending} onClick={submit}>
                  {isPending ? "Saving..." : editing ? "Save Changes" : "Create Code"}
                </Button>
                <Button variant="outline" onClick={() => { setShowForm(false); setEditing(null); }}>Cancel</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-14" />)}</div>
        ) : !codes?.length ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No discount codes yet. Create one to offer promotions at checkout.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="px-4 py-3 text-left">Code</th>
                      <th className="px-4 py-3 text-left">Type</th>
                      <th className="px-4 py-3 text-left">Value</th>
                      <th className="px-4 py-3 text-left">Applies To</th>
                      <th className="px-4 py-3 text-right">Used</th>
                      <th className="px-4 py-3 text-left">Valid Until</th>
                      <th className="px-4 py-3 text-left">Status</th>
                      {isSuperAdmin && <th className="px-4 py-3 text-right">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {codes.map(dc => (
                      <tr key={dc.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-3 font-mono font-semibold">{dc.code}</td>
                        <td className="px-4 py-3 capitalize text-xs">{dc.discountType}</td>
                        <td className="px-4 py-3 font-semibold">
                          {dc.discountType === "percent" ? `${dc.discountValue}%` : `$${dc.discountValue}`}
                        </td>
                        <td className="px-4 py-3"><Badge variant="outline" className="text-xs">{dc.applicableTo}</Badge></td>
                        <td className="px-4 py-3 text-right text-xs">
                          {dc.timesUsed}{dc.maxUses != null ? ` / ${dc.maxUses}` : ""}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {dc.validUntil ? format(new Date(dc.validUntil), "MMM d, yyyy") : "No expiry"}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={dc.isActive ? "default" : "outline"} className="text-xs">
                            {dc.isActive ? "active" : "inactive"}
                          </Badge>
                        </td>
                        {isSuperAdmin && (
                          <td className="px-4 py-3 text-right">
                            <div className="flex justify-end gap-2">
                              <Button size="sm" variant="outline" onClick={() => openEdit(dc)}>Edit</Button>
                              {dc.isActive && (
                                <Button size="sm" variant="outline" className="text-red-600"
                                  onClick={() => deactivateMutation.mutate(dc.id)}>
                                  Deactivate
                                </Button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
