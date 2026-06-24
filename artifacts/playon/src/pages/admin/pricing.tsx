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

type Category = "drop_in" | "camp" | "league" | "tournament";

interface PricingRule {
  id: number;
  name: string;
  category: Category;
  version: number;
  isLatest: boolean;
  isActive: boolean;
  basePrice: string | null;
  memberPrice: string | null;
  depositAmount: string | null;
  depositRequired: boolean | null;
  balanceDueDate: string | null;
  skillTierPricing: string | null;
  packSize: number | null;
  packPrice: string | null;
  pricingBasis: string | null;
  earlyBirdPrice: string | null;
  earlyBirdCutoff: string | null;
  lateFee: string | null;
  siblingDiscountPct: string | null;
  teamFee: string | null;
  playerFee: string | null;
  installmentPlan: boolean | null;
  installmentCount: number | null;
  teamEntryFee: string | null;
  perPlayerFee: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

const CATEGORIES: { key: Category; label: string }[] = [
  { key: "drop_in", label: "Drop-in" },
  { key: "camp", label: "Camp" },
  { key: "league", label: "League" },
  { key: "tournament", label: "Tournament" },
];

const emptyForm = {
  name: "",
  category: "drop_in" as Category,
  basePrice: "",
  memberPrice: "",
  depositAmount: "",
  depositRequired: false,
  balanceDueDate: "",
  skillTierPricing: "",
  packSize: "",
  packPrice: "",
  pricingBasis: "per_camp",
  earlyBirdPrice: "",
  earlyBirdCutoff: "",
  lateFee: "",
  siblingDiscountPct: "",
  teamFee: "",
  playerFee: "",
  installmentPlan: false,
  installmentCount: "",
  teamEntryFee: "",
  perPlayerFee: "",
  notes: "",
};

function numOrNull(v: string) { return v.trim() ? Number(v) : null; }

export default function AdminPricing() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<Category>("drop_in");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ ...emptyForm, category: activeTab });
  const [editingId, setEditingId] = useState<number | null>(null);

  const authHeader = async () => ({
    Authorization: `Bearer ${await getToken()}`,
    "Content-Type": "application/json",
  });

  const { data: rules, isLoading } = useQuery<PricingRule[]>({
    queryKey: ["pricing-rules", activeTab],
    queryFn: async () => {
      const res = await fetch(`/api/admin/pricing-rules?category=${activeTab}`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const headers = await authHeader();
      const url = editingId
        ? `/api/admin/pricing-rules/${editingId}`
        : "/api/admin/pricing-rules";
      const method = editingId ? "PATCH" : "POST";
      const res = await fetch(url, { method, headers, body: JSON.stringify(payload) });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Failed"); }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pricing-rules"] });
      setShowCreate(false);
      setEditingId(null);
      setForm({ ...emptyForm, category: activeTab });
      toast({ title: editingId ? "Rule updated (new version created)" : "Rule created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deactivateMutation = useMutation({
    mutationFn: async (id: number) => {
      const headers = await authHeader();
      const res = await fetch(`/api/admin/pricing-rules/${id}`, { method: "DELETE", headers });
      if (!res.ok && res.status !== 204) throw new Error("Failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pricing-rules"] });
      toast({ title: "Rule deactivated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const isSuperAdmin = profile?.role === "admin" || profile?.adminLevel === "super" || profile?.adminLevel === "admin";
  const canView = profile?.role === "admin" || profile?.role === "staff" || profile?.adminLevel === "super" || profile?.adminLevel === "admin";

  if (profileLoading) return <Layout><div className="p-12"><Skeleton className="h-96" /></div></Layout>;
  if (!canView) return <Redirect to="/dashboard" />;

  function openEdit(rule: PricingRule) {
    setEditingId(rule.id);
    setForm({
      name: rule.name,
      category: rule.category,
      basePrice: rule.basePrice ?? "",
      memberPrice: rule.memberPrice ?? "",
      depositAmount: rule.depositAmount ?? "",
      depositRequired: rule.depositRequired ?? false,
      balanceDueDate: rule.balanceDueDate ?? "",
      skillTierPricing: rule.skillTierPricing ?? "",
      packSize: rule.packSize != null ? String(rule.packSize) : "",
      packPrice: rule.packPrice ?? "",
      pricingBasis: rule.pricingBasis ?? "per_camp",
      earlyBirdPrice: rule.earlyBirdPrice ?? "",
      earlyBirdCutoff: rule.earlyBirdCutoff ?? "",
      lateFee: rule.lateFee ?? "",
      siblingDiscountPct: rule.siblingDiscountPct ?? "",
      teamFee: rule.teamFee ?? "",
      playerFee: rule.playerFee ?? "",
      installmentPlan: rule.installmentPlan ?? false,
      installmentCount: rule.installmentCount != null ? String(rule.installmentCount) : "",
      teamEntryFee: rule.teamEntryFee ?? "",
      perPlayerFee: rule.perPlayerFee ?? "",
      notes: rule.notes ?? "",
    });
    setShowCreate(true);
  }

  function buildPayload() {
    const base: Record<string, unknown> = {
      name: form.name,
      category: form.category,
      notes: form.notes || null,
    };
    if (form.category === "drop_in") {
      base.basePrice = numOrNull(form.basePrice);
      base.memberPrice = numOrNull(form.memberPrice);
      base.skillTierPricing = form.skillTierPricing || null;
      base.packSize = form.packSize ? Number(form.packSize) : null;
      base.packPrice = numOrNull(form.packPrice);
    } else if (form.category === "camp") {
      base.basePrice = numOrNull(form.basePrice);
      base.memberPrice = numOrNull(form.memberPrice);
      base.pricingBasis = form.pricingBasis;
      base.earlyBirdPrice = numOrNull(form.earlyBirdPrice);
      base.earlyBirdCutoff = form.earlyBirdCutoff || null;
      base.lateFee = numOrNull(form.lateFee);
      base.siblingDiscountPct = numOrNull(form.siblingDiscountPct);
      base.depositAmount = numOrNull(form.depositAmount);
      base.depositRequired = form.depositRequired;
    } else if (form.category === "league") {
      base.teamFee = numOrNull(form.teamFee);
      base.playerFee = numOrNull(form.playerFee);
      base.memberPrice = numOrNull(form.memberPrice);
      base.depositAmount = numOrNull(form.depositAmount);
      base.depositRequired = form.depositRequired;
      base.balanceDueDate = form.balanceDueDate || null;
      base.installmentPlan = form.installmentPlan;
      base.installmentCount = form.installmentCount ? Number(form.installmentCount) : null;
    } else if (form.category === "tournament") {
      base.teamEntryFee = numOrNull(form.teamEntryFee);
      base.perPlayerFee = numOrNull(form.perPlayerFee);
      base.memberPrice = numOrNull(form.memberPrice);
      base.earlyBirdPrice = numOrNull(form.earlyBirdPrice);
      base.earlyBirdCutoff = form.earlyBirdCutoff || null;
      base.depositAmount = numOrNull(form.depositAmount);
      base.depositRequired = form.depositRequired;
      base.balanceDueDate = form.balanceDueDate || null;
    }
    return base;
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12">
        <div className="flex items-center justify-between mb-8">
          <div>
            <a href="/admin" className="text-sm text-muted-foreground hover:text-foreground mb-1 block">← Admin</a>
            <h1 className="text-4xl font-bold font-sans uppercase tracking-tight text-primary">Pricing Rules</h1>
            <p className="text-muted-foreground mt-1">Admin-editable pricing engine. Each edit creates a new version; old versions are preserved.</p>
          </div>
          {isSuperAdmin && (
            <Button onClick={() => { setEditingId(null); setForm({ ...emptyForm, category: activeTab }); setShowCreate(true); }}>
              New Rule
            </Button>
          )}
        </div>

        {/* Category tabs */}
        <div className="flex gap-2 mb-6">
          {CATEGORIES.map(c => (
            <button
              key={c.key}
              onClick={() => { setActiveTab(c.key); setShowCreate(false); }}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === c.key ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Create / Edit form */}
        {showCreate && (
          <Card className="mb-6 border-primary/30">
            <CardHeader>
              <CardTitle>{editingId ? `Edit Rule (creates new version)` : "New Pricing Rule"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Name *</Label>
                  <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Adult Drop-in Standard" />
                </div>
                {!editingId && (
                  <div className="space-y-1">
                    <Label>Category *</Label>
                    <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as Category }))}>
                      {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                  </div>
                )}
              </div>

              {/* Drop-in fields */}
              {form.category === "drop_in" && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1"><Label>Base Price ($)</Label><Input type="number" step="0.01" value={form.basePrice} onChange={e => setForm(f => ({ ...f, basePrice: e.target.value }))} /></div>
                  <div className="space-y-1"><Label>Member Price ($)</Label><Input type="number" step="0.01" value={form.memberPrice} onChange={e => setForm(f => ({ ...f, memberPrice: e.target.value }))} /></div>
                  <div className="space-y-1"><Label>Pack Size (sessions)</Label><Input type="number" value={form.packSize} onChange={e => setForm(f => ({ ...f, packSize: e.target.value }))} /></div>
                  <div className="space-y-1"><Label>Pack Price ($)</Label><Input type="number" step="0.01" value={form.packPrice} onChange={e => setForm(f => ({ ...f, packPrice: e.target.value }))} /></div>
                  <div className="space-y-1 md:col-span-2"><Label>Skill Tier Pricing (JSON)</Label><Input value={form.skillTierPricing} onChange={e => setForm(f => ({ ...f, skillTierPricing: e.target.value }))} placeholder='{"beginner":"15.00","advanced":"20.00"}' /></div>
                </div>
              )}

              {/* Camp fields */}
              {form.category === "camp" && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <Label>Pricing Basis</Label>
                    <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.pricingBasis} onChange={e => setForm(f => ({ ...f, pricingBasis: e.target.value }))}>
                      <option value="per_camp">Per Camp</option>
                      <option value="per_day">Per Day</option>
                    </select>
                  </div>
                  <div className="space-y-1"><Label>Base Price ($)</Label><Input type="number" step="0.01" value={form.basePrice} onChange={e => setForm(f => ({ ...f, basePrice: e.target.value }))} /></div>
                  <div className="space-y-1"><Label>Member Price ($)</Label><Input type="number" step="0.01" value={form.memberPrice} onChange={e => setForm(f => ({ ...f, memberPrice: e.target.value }))} /></div>
                  <div className="space-y-1"><Label>Early-Bird Price ($)</Label><Input type="number" step="0.01" value={form.earlyBirdPrice} onChange={e => setForm(f => ({ ...f, earlyBirdPrice: e.target.value }))} /></div>
                  <div className="space-y-1"><Label>Early-Bird Cutoff</Label><Input type="date" value={form.earlyBirdCutoff} onChange={e => setForm(f => ({ ...f, earlyBirdCutoff: e.target.value }))} /></div>
                  <div className="space-y-1"><Label>Late Fee ($)</Label><Input type="number" step="0.01" value={form.lateFee} onChange={e => setForm(f => ({ ...f, lateFee: e.target.value }))} /></div>
                  <div className="space-y-1"><Label>Sibling Discount (%)</Label><Input type="number" step="0.01" value={form.siblingDiscountPct} onChange={e => setForm(f => ({ ...f, siblingDiscountPct: e.target.value }))} /></div>
                  <div className="space-y-1"><Label>Deposit ($)</Label><Input type="number" step="0.01" value={form.depositAmount} onChange={e => setForm(f => ({ ...f, depositAmount: e.target.value }))} /></div>
                  <div className="flex items-center gap-2 pt-6"><input type="checkbox" checked={form.depositRequired} onChange={e => setForm(f => ({ ...f, depositRequired: e.target.checked }))} /><Label>Deposit Required</Label></div>
                </div>
              )}

              {/* League fields */}
              {form.category === "league" && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1"><Label>Team Fee ($)</Label><Input type="number" step="0.01" value={form.teamFee} onChange={e => setForm(f => ({ ...f, teamFee: e.target.value }))} /></div>
                  <div className="space-y-1"><Label>Player / Free-Agent Fee ($)</Label><Input type="number" step="0.01" value={form.playerFee} onChange={e => setForm(f => ({ ...f, playerFee: e.target.value }))} /></div>
                  <div className="space-y-1"><Label>Member Price ($)</Label><Input type="number" step="0.01" value={form.memberPrice} onChange={e => setForm(f => ({ ...f, memberPrice: e.target.value }))} /></div>
                  <div className="space-y-1"><Label>Deposit ($)</Label><Input type="number" step="0.01" value={form.depositAmount} onChange={e => setForm(f => ({ ...f, depositAmount: e.target.value }))} /></div>
                  <div className="space-y-1"><Label>Balance Due Date</Label><Input type="date" value={form.balanceDueDate} onChange={e => setForm(f => ({ ...f, balanceDueDate: e.target.value }))} /></div>
                  <div className="flex items-center gap-2 pt-6"><input type="checkbox" checked={form.depositRequired} onChange={e => setForm(f => ({ ...f, depositRequired: e.target.checked }))} /><Label>Deposit Required</Label></div>
                  <div className="flex items-center gap-2 pt-6"><input type="checkbox" checked={form.installmentPlan} onChange={e => setForm(f => ({ ...f, installmentPlan: e.target.checked }))} /><Label>Installment Plan</Label></div>
                  {form.installmentPlan && <div className="space-y-1"><Label>Installment Count</Label><Input type="number" value={form.installmentCount} onChange={e => setForm(f => ({ ...f, installmentCount: e.target.value }))} /></div>}
                </div>
              )}

              {/* Tournament fields */}
              {form.category === "tournament" && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1"><Label>Team Entry Fee ($)</Label><Input type="number" step="0.01" value={form.teamEntryFee} onChange={e => setForm(f => ({ ...f, teamEntryFee: e.target.value }))} /></div>
                  <div className="space-y-1"><Label>Per-Player Fee ($)</Label><Input type="number" step="0.01" value={form.perPlayerFee} onChange={e => setForm(f => ({ ...f, perPlayerFee: e.target.value }))} /></div>
                  <div className="space-y-1"><Label>Member Price ($)</Label><Input type="number" step="0.01" value={form.memberPrice} onChange={e => setForm(f => ({ ...f, memberPrice: e.target.value }))} /></div>
                  <div className="space-y-1"><Label>Early-Bird Fee ($)</Label><Input type="number" step="0.01" value={form.earlyBirdPrice} onChange={e => setForm(f => ({ ...f, earlyBirdPrice: e.target.value }))} /></div>
                  <div className="space-y-1"><Label>Early-Bird Cutoff</Label><Input type="date" value={form.earlyBirdCutoff} onChange={e => setForm(f => ({ ...f, earlyBirdCutoff: e.target.value }))} /></div>
                  <div className="space-y-1"><Label>Deposit ($)</Label><Input type="number" step="0.01" value={form.depositAmount} onChange={e => setForm(f => ({ ...f, depositAmount: e.target.value }))} /></div>
                  <div className="space-y-1"><Label>Balance Due Date</Label><Input type="date" value={form.balanceDueDate} onChange={e => setForm(f => ({ ...f, balanceDueDate: e.target.value }))} /></div>
                  <div className="flex items-center gap-2 pt-6"><input type="checkbox" checked={form.depositRequired} onChange={e => setForm(f => ({ ...f, depositRequired: e.target.checked }))} /><Label>Deposit Required</Label></div>
                </div>
              )}

              <div className="space-y-1">
                <Label>Notes</Label>
                <textarea className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px]" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Internal notes..." />
              </div>

              <div className="flex gap-2">
                <Button onClick={() => createMutation.mutate(buildPayload())} disabled={!form.name}>
                  {createMutation.isPending ? "Saving..." : editingId ? "Save New Version" : "Create Rule"}
                </Button>
                <Button variant="outline" onClick={() => { setShowCreate(false); setEditingId(null); }}>Cancel</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Rules list */}
        {isLoading ? (
          <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-20" />)}</div>
        ) : !rules?.length ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">No pricing rules for {CATEGORIES.find(c => c.key === activeTab)?.label ?? activeTab}. Create one above.</CardContent></Card>
        ) : (
          <div className="space-y-3">
            {rules.map(rule => (
              <Card key={rule.id} className={!rule.isActive ? "opacity-50" : ""}>
                <CardContent className="py-4 flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold">{rule.name}</span>
                      <Badge variant="outline" className="text-xs">v{rule.version}</Badge>
                      {rule.isLatest && <Badge className="text-xs bg-green-700">Latest</Badge>}
                      {!rule.isActive && <Badge variant="destructive" className="text-xs">Inactive</Badge>}
                    </div>
                    <div className="text-sm text-muted-foreground flex flex-wrap gap-3">
                      {rule.basePrice && <span>Base: ${rule.basePrice}</span>}
                      {rule.memberPrice && <span>Member: ${rule.memberPrice}</span>}
                      {rule.teamFee && <span>Team fee: ${rule.teamFee}</span>}
                      {rule.teamEntryFee && <span>Entry fee: ${rule.teamEntryFee}</span>}
                      {rule.earlyBirdPrice && <span>Early-bird: ${rule.earlyBirdPrice}</span>}
                      {rule.depositAmount && <span>Deposit: ${rule.depositAmount}</span>}
                      {rule.notes && <span className="italic">{rule.notes}</span>}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
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
