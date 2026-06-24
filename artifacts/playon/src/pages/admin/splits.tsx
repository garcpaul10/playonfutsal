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

interface SplitRule {
  id: number;
  name: string;
  venueId: number | null;
  offeringType: string | null;
  offeringId: number | null;
  splitType: "percentage" | "flat" | "hybrid";
  facilityPct: string | null;
  flatFee: string | null;
  flatFeeUnit: string | null;
  version: number;
  isLatest: boolean;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
}

interface Venue { id: number; name: string; }

const emptyForm = {
  name: "",
  venueId: "",
  offeringType: "",
  offeringId: "",
  splitType: "percentage" as "percentage" | "flat" | "hybrid",
  facilityPct: "",
  flatFee: "",
  flatFeeUnit: "per_event",
  notes: "",
};

export default function AdminSplits() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [editingId, setEditingId] = useState<number | null>(null);

  const authHeader = async () => ({
    Authorization: `Bearer ${await getToken()}`,
    "Content-Type": "application/json",
  });

  const { data: rules, isLoading } = useQuery<SplitRule[]>({
    queryKey: ["split-rules"],
    queryFn: async () => {
      const res = await fetch("/api/admin/facility-split-rules");
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const { data: venues } = useQuery<Venue[]>({
    queryKey: ["venues"],
    queryFn: async () => {
      const res = await fetch("/api/venues");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const headers = await authHeader();
      const url = editingId ? `/api/admin/facility-split-rules/${editingId}` : "/api/admin/facility-split-rules";
      const method = editingId ? "PATCH" : "POST";
      const res = await fetch(url, { method, headers, body: JSON.stringify(payload) });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Failed"); }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["split-rules"] });
      setShowCreate(false);
      setEditingId(null);
      setForm({ ...emptyForm });
      toast({ title: editingId ? "Rule updated (new version)" : "Split rule created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deactivateMutation = useMutation({
    mutationFn: async (id: number) => {
      const headers = await authHeader();
      await fetch(`/api/admin/facility-split-rules/${id}`, { method: "DELETE", headers });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["split-rules"] });
      toast({ title: "Rule deactivated" });
    },
  });

  if (profileLoading) return <Layout><div className="p-12"><Skeleton className="h-96" /></div></Layout>;
  const isSuperAdmin = profile?.role === "admin" || profile?.adminLevel === "super" || profile?.adminLevel === "admin";
  const canView = profile?.role === "admin" || profile?.role === "staff" || profile?.adminLevel === "super" || profile?.adminLevel === "admin";

  if (!canView) return <Redirect to="/dashboard" />;

  function openEdit(rule: SplitRule) {
    setEditingId(rule.id);
    setForm({
      name: rule.name,
      venueId: rule.venueId != null ? String(rule.venueId) : "",
      offeringType: rule.offeringType ?? "",
      offeringId: rule.offeringId != null ? String(rule.offeringId) : "",
      splitType: rule.splitType,
      facilityPct: rule.facilityPct ?? "",
      flatFee: rule.flatFee ?? "",
      flatFeeUnit: rule.flatFeeUnit ?? "per_event",
      notes: rule.notes ?? "",
    });
    setShowCreate(true);
  }

  function buildPayload() {
    return {
      name: form.name,
      venueId: form.venueId ? Number(form.venueId) : null,
      offeringType: form.offeringType || null,
      offeringId: form.offeringType && form.offeringId ? Number(form.offeringId) : null,
      splitType: form.splitType,
      facilityPct: form.facilityPct ? Number(form.facilityPct) : null,
      flatFee: form.flatFee ? Number(form.flatFee) : null,
      flatFeeUnit: form.flatFeeUnit || null,
      notes: form.notes || null,
    };
  }

  function splitTypeLabel(rule: SplitRule) {
    if (rule.splitType === "percentage") return `${rule.facilityPct}% to facility`;
    if (rule.splitType === "flat") return `$${rule.flatFee} flat ${rule.flatFeeUnit ?? ""}`;
    return `$${rule.flatFee} flat + ${rule.facilityPct}%`;
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12">
        <div className="flex items-center justify-between mb-8">
          <div>
            <a href="/admin" className="text-sm text-muted-foreground hover:text-foreground mb-1 block">← Admin</a>
            <h1 className="text-4xl font-bold font-sans uppercase tracking-tight text-primary">Facility Split Rules</h1>
            <p className="text-muted-foreground mt-1">Configure how gross revenue is shared between PlayOn and the venue. Each edit creates a new version.</p>
          </div>
          {isSuperAdmin && (
            <Button onClick={() => { setEditingId(null); setForm({ ...emptyForm }); setShowCreate(true); }}>New Split Rule</Button>
          )}
        </div>

        {showCreate && (
          <Card className="mb-6 border-primary/30">
            <CardHeader><CardTitle>{editingId ? "Edit Split Rule (creates new version)" : "New Facility Split Rule"}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1"><Label>Name *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Alumni Center Standard" /></div>
                <div className="space-y-1">
                  <Label>Venue</Label>
                  <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.venueId} onChange={e => setForm(f => ({ ...f, venueId: e.target.value }))}>
                    <option value="">All venues</option>
                    {venues?.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Offering Type (optional scope)</Label>
                  <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.offeringType} onChange={e => setForm(f => ({ ...f, offeringType: e.target.value, offeringId: "" }))}>
                    <option value="">All offering types</option>
                    <option value="drop_in">Drop-in</option>
                    <option value="camp">Camp</option>
                    <option value="league">League</option>
                    <option value="tournament">Tournament</option>
                  </select>
                </div>
                {form.offeringType && (
                  <div className="space-y-1">
                    <Label>Offering ID (optional — leave blank for all {form.offeringType}s)</Label>
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      placeholder="e.g. 42"
                      value={form.offeringId}
                      onChange={e => setForm(f => ({ ...f, offeringId: e.target.value }))}
                    />
                  </div>
                )}
                <div className="space-y-1">
                  <Label>Split Type *</Label>
                  <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.splitType} onChange={e => setForm(f => ({ ...f, splitType: e.target.value as any }))}>
                    <option value="percentage">Percentage</option>
                    <option value="flat">Flat Fee</option>
                    <option value="hybrid">Hybrid (flat + percentage)</option>
                  </select>
                </div>
                {(form.splitType === "percentage" || form.splitType === "hybrid") && (
                  <div className="space-y-1"><Label>Facility Percentage (%)</Label><Input type="number" step="0.01" min="0" max="100" value={form.facilityPct} onChange={e => setForm(f => ({ ...f, facilityPct: e.target.value }))} /></div>
                )}
                {(form.splitType === "flat" || form.splitType === "hybrid") && (
                  <>
                    <div className="space-y-1"><Label>Flat Fee ($)</Label><Input type="number" step="0.01" value={form.flatFee} onChange={e => setForm(f => ({ ...f, flatFee: e.target.value }))} /></div>
                    <div className="space-y-1">
                      <Label>Flat Fee Unit</Label>
                      <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.flatFeeUnit} onChange={e => setForm(f => ({ ...f, flatFeeUnit: e.target.value }))}>
                        <option value="per_session">Per Session</option>
                        <option value="per_event">Per Event</option>
                        <option value="per_hour">Per Hour</option>
                      </select>
                    </div>
                  </>
                )}
              </div>
              <div className="space-y-1"><Label>Notes</Label><textarea className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px]" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
              <div className="flex gap-2">
                <Button onClick={() => saveMutation.mutate(buildPayload())} disabled={!form.name}>
                  {saveMutation.isPending ? "Saving..." : editingId ? "Save New Version" : "Create Rule"}
                </Button>
                <Button variant="outline" onClick={() => { setShowCreate(false); setEditingId(null); }}>Cancel</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-20" />)}</div>
        ) : !rules?.length ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">No facility split rules configured.</CardContent></Card>
        ) : (
          <div className="space-y-3">
            {rules.map(rule => (
              <Card key={rule.id} className={!rule.isActive ? "opacity-50" : ""}>
                <CardContent className="py-4 flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold">{rule.name}</span>
                      <Badge variant="outline" className="text-xs">v{rule.version}</Badge>
                      {rule.isLatest && <Badge className="text-xs bg-green-700">Latest</Badge>}
                      {!rule.isActive && <Badge variant="destructive" className="text-xs">Inactive</Badge>}
                      {rule.offeringType && <Badge variant="secondary" className="text-xs">{rule.offeringType}</Badge>}
                    </div>
                    <div className="text-sm text-muted-foreground">{splitTypeLabel(rule)}</div>
                    {rule.notes && <div className="text-xs text-muted-foreground mt-1 italic">{rule.notes}</div>}
                  </div>
                  <div className="flex gap-2">
                    {isSuperAdmin && rule.isLatest && rule.isActive && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => openEdit(rule)}>Edit</Button>
                        <Button size="sm" variant="destructive" onClick={() => deactivateMutation.mutate(rule.id)}>Deactivate</Button>
                      </>
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
