import { API_BASE } from "@/lib/api-base";
import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CreditCard, Users, Plus, Pencil, Trash2, Crown, CheckCircle2, XCircle, SlidersHorizontal } from "lucide-react";
import { format } from "date-fns";


function statusBadge(status: string) {
  if (status === "active") return <Badge className="bg-green-100 text-green-800 border-green-200"><CheckCircle2 className="h-3 w-3 mr-1" />Active</Badge>;
  if (status === "cancelled") return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Cancelled</Badge>;
  if (status === "past_due") return <Badge variant="outline" className="border-amber-400 text-amber-700">Past Due</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

// ── Membership Plans ──────────────────────────────────────────────────────────

function PlanForm({ plan, onSave, onClose }: { plan?: any; onSave: (data: any) => void; onClose: () => void }) {
  const [form, setForm] = useState({
    name: plan?.name ?? "",
    description: plan?.description ?? "",
    price: plan?.price ?? "",
    billingCycle: plan?.billingCycle ?? "monthly",
    trialDays: plan?.trialDays ?? 0,
    discountPercent: plan?.discountPercent ?? "0",
    features: (plan?.features ?? []).join("\n"),
    stripePriceId: plan?.stripePriceId ?? "",
    stripeProductId: plan?.stripeProductId ?? "",
    isActive: plan?.isActive ?? true,
    createStripeProduct: false,
  });

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...form,
      trialDays: Number(form.trialDays),
      features: form.features.split("\n").map((s: string) => s.trim()).filter(Boolean),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <Label>Plan Name *</Label>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} required placeholder="e.g. PlayOn Member" />
        </div>
        <div className="col-span-2">
          <Label>Description</Label>
          <Input value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="What members get..." />
        </div>
        <div>
          <Label>Price ($/period) *</Label>
          <Input type="number" step="0.01" value={form.price} onChange={(e) => set("price", e.target.value)} required placeholder="19.99" />
        </div>
        <div>
          <Label>Billing Cycle</Label>
          <Select value={form.billingCycle} onValueChange={(v) => set("billingCycle", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="annual">Annual</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Trial Days</Label>
          <Input type="number" min="0" value={form.trialDays} onChange={(e) => set("trialDays", e.target.value)} />
        </div>
        <div>
          <Label>Discount % (for display)</Label>
          <Input type="number" step="0.01" min="0" max="100" value={form.discountPercent} onChange={(e) => set("discountPercent", e.target.value)} />
        </div>
        <div className="col-span-2">
          <Label>Features / Perks (one per line)</Label>
          <textarea
            className="w-full border rounded-md p-2 text-sm min-h-[80px] bg-background"
            value={form.features}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => set("features", e.target.value)}
            placeholder="10% off drop-ins&#10;Member pricing on leagues&#10;Priority registration"
          />
        </div>
        <div>
          <Label>Stripe Price ID</Label>
          <Input value={form.stripePriceId} onChange={(e) => set("stripePriceId", e.target.value)} placeholder="price_xxx" />
        </div>
        <div>
          <Label>Stripe Product ID</Label>
          <Input value={form.stripeProductId} onChange={(e) => set("stripeProductId", e.target.value)} placeholder="prod_xxx" />
        </div>
        {!plan && (
          <div className="col-span-2 flex items-center gap-2">
            <input type="checkbox" id="createStripe" checked={form.createStripeProduct}
              onChange={(e) => set("createStripeProduct", e.target.checked)} />
            <label htmlFor="createStripe" className="text-sm">Auto-create Stripe Product & Price</label>
          </div>
        )}
        <div className="col-span-2 flex items-center gap-2">
          <input type="checkbox" id="isActive" checked={form.isActive}
            onChange={(e) => set("isActive", e.target.checked)} />
          <label htmlFor="isActive" className="text-sm">Active (visible to players)</label>
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit">{plan ? "Save Changes" : "Create Plan"}</Button>
      </div>
    </form>
  );
}

// ── Manual grant dialog ───────────────────────────────────────────────────────

function GrantMembershipDialog({ plans, onGrant }: { plans: any[]; onGrant: (data: any) => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ userId: "", planId: "", startDate: "", endDate: "", notes: "" });
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onGrant({
      userId: Number(form.userId),
      planId: Number(form.planId),
      startDate: form.startDate || undefined,
      endDate: form.endDate || undefined,
      notes: form.notes || undefined,
    });
    setOpen(false);
    setForm({ userId: "", planId: "", startDate: "", endDate: "", notes: "" });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-1" />Grant Membership</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Grant Membership</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>User ID</Label>
            <Input type="number" value={form.userId} onChange={(e) => set("userId", e.target.value)} required placeholder="Internal user ID" />
          </div>
          <div>
            <Label>Plan</Label>
            <Select value={form.planId} onValueChange={(v) => set("planId", v)}>
              <SelectTrigger><SelectValue placeholder="Select plan" /></SelectTrigger>
              <SelectContent>
                {plans.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.name} (${p.price}/{p.billingCycle})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Start Date</Label>
              <Input type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />
            </div>
            <div>
              <Label>End Date</Label>
              <Input type="date" value={form.endDate} onChange={(e) => set("endDate", e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Notes (optional)</Label>
            <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Reason for manual grant" />
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit">Grant</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Override dialog ───────────────────────────────────────────────────────────

function OverrideMembershipDialog({ membership, onOverride, onClose }: { membership: any; onOverride: (data: any) => void; onClose: () => void }) {
  const [form, setForm] = useState({
    status: membership.status ?? "active",
    endDate: membership.endDate ?? "",
    renewsAt: membership.renewsAt ?? "",
    notes: "",
  });
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onOverride({
      status: form.status,
      endDate: form.endDate || undefined,
      renewsAt: form.renewsAt || undefined,
      notes: form.notes || undefined,
    });
  };

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>Override Membership</DialogTitle></DialogHeader>
      <p className="text-sm text-muted-foreground">
        {membership.userFirstName} {membership.userLastName} — {membership.planName}
      </p>
      <form onSubmit={handleSubmit} className="space-y-4 mt-2">
        <div>
          <Label>Status</Label>
          <Select value={form.status} onValueChange={(v) => set("status", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="past_due">Past Due</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>End Date</Label>
            <Input type="date" value={form.endDate} onChange={(e) => set("endDate", e.target.value)} />
          </div>
          <div>
            <Label>Renews At</Label>
            <Input type="date" value={form.renewsAt} onChange={(e) => set("renewsAt", e.target.value)} />
          </div>
        </div>
        <div>
          <Label>Notes</Label>
          <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Reason for override" />
        </div>
        <div className="flex gap-2 justify-end">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit">Apply Override</Button>
        </div>
      </form>
    </DialogContent>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminMemberships() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editingPlan, setEditingPlan] = useState<any | null>(null);
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [planFilter, setPlanFilter] = useState("all");
  const [overridingMembership, setOverridingMembership] = useState<any | null>(null);
  const [membershipToCancel, setMembershipToCancel] = useState<number | null>(null);

  const { data: plans = [], isLoading: plansLoading } = useQuery({
    queryKey: ["admin", "membership-plans"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/admin/membership-plans`, { credentials: "include" });
      return r.json();
    },
  });

  const { data: members = [], isLoading: membersLoading } = useQuery({
    queryKey: ["admin", "memberships", statusFilter, planFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (planFilter !== "all") params.set("planId", planFilter);
      const r = await fetch(`${API_BASE}/admin/memberships?${params}`, { credentials: "include" });
      return r.json();
    },
  });

  const createPlan = useMutation({
    mutationFn: async (data: any) => {
      const r = await fetch(`${API_BASE}/admin/membership-plans`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "membership-plans"] }); toast({ title: "Plan created" }); setPlanDialogOpen(false); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updatePlan = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const r = await fetch(`${API_BASE}/admin/membership-plans/${id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "membership-plans"] }); toast({ title: "Plan updated" }); setEditingPlan(null); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const grantMembership = useMutation({
    mutationFn: async (data: any) => {
      const r = await fetch(`${API_BASE}/admin/memberships`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "memberships"] }); toast({ title: "Membership granted" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const overrideMembership = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const r = await fetch(`${API_BASE}/admin/memberships/${id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "memberships"] });
      toast({ title: "Membership updated" });
      setOverridingMembership(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const cancelMembership = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`${API_BASE}/admin/memberships/${id}`, {
        method: "DELETE", credentials: "include",
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "memberships"] }); toast({ title: "Membership cancelled" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const activePlanCount = plans.filter((p: any) => p.isActive).length;
  const activeMembers = members.filter((m: any) => m.status === "active").length;

  return (
    <Layout>
      <div className="container mx-auto py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Crown className="h-6 w-6 text-amber-500" />Memberships</h1>
            <p className="text-muted-foreground mt-1">Manage subscription tiers and member access</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <CreditCard className="h-8 w-8 text-primary/60" />
                <div><div className="text-2xl font-bold">{activePlanCount}</div><div className="text-sm text-muted-foreground">Active Plans</div></div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Users className="h-8 w-8 text-primary/60" />
                <div><div className="text-2xl font-bold">{activeMembers}</div><div className="text-sm text-muted-foreground">Active Members</div></div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Crown className="h-8 w-8 text-amber-500/60" />
                <div><div className="text-2xl font-bold">{members.length}</div><div className="text-sm text-muted-foreground">Total Records</div></div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="plans">
          <TabsList>
            <TabsTrigger value="plans">Membership Plans</TabsTrigger>
            <TabsTrigger value="members">Members</TabsTrigger>
          </TabsList>

          {/* Plans tab */}
          <TabsContent value="plans" className="space-y-4">
            <div className="flex justify-end">
              <Dialog open={planDialogOpen} onOpenChange={setPlanDialogOpen}>
                <DialogTrigger asChild>
                  <Button><Plus className="h-4 w-4 mr-1" />New Plan</Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader><DialogTitle>Create Membership Plan</DialogTitle></DialogHeader>
                  <PlanForm onSave={(d) => createPlan.mutate(d)} onClose={() => setPlanDialogOpen(false)} />
                </DialogContent>
              </Dialog>
            </div>

            {plansLoading ? (
              <div className="text-sm text-muted-foreground p-4">Loading plans…</div>
            ) : plans.length === 0 ? (
              <Card><CardContent className="py-12 text-center text-muted-foreground">No membership plans yet. Create one to get started.</CardContent></Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {plans.map((plan: any) => (
                  <Card key={plan.id} className={!plan.isActive ? "opacity-60" : ""}>
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="flex items-center gap-2">
                            <Crown className="h-4 w-4 text-amber-500" />
                            {plan.name}
                            {!plan.isActive && <Badge variant="outline">Inactive</Badge>}
                          </CardTitle>
                          <CardDescription>{plan.description}</CardDescription>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-bold">${Number(plan.price).toFixed(2)}</div>
                          <div className="text-xs text-muted-foreground">/{plan.billingCycle}</div>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {plan.features?.length > 0 && (
                        <ul className="text-sm space-y-1">
                          {plan.features.map((f: string, i: number) => (
                            <li key={i} className="flex items-center gap-1 text-muted-foreground">
                              <CheckCircle2 className="h-3 w-3 text-green-500 flex-shrink-0" />{f}
                            </li>
                          ))}
                        </ul>
                      )}
                      {plan.stripePriceId && (
                        <div className="text-xs text-muted-foreground font-mono bg-muted px-2 py-1 rounded">
                          Stripe: {plan.stripePriceId}
                        </div>
                      )}
                      {!plan.stripePriceId && Number(plan.price) > 0 && (
                        <div className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 px-2 py-1 rounded border border-amber-200 dark:border-amber-800">
                          ⚠ No Stripe price linked — players cannot enroll online until configured
                        </div>
                      )}
                      <div className="flex gap-2 pt-1">
                        <Dialog open={editingPlan?.id === plan.id} onOpenChange={(o) => !o && setEditingPlan(null)}>
                          <DialogTrigger asChild>
                            <Button size="sm" variant="outline" onClick={() => setEditingPlan(plan)}>
                              <Pencil className="h-3 w-3 mr-1" />Edit
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-2xl">
                            <DialogHeader><DialogTitle>Edit Plan</DialogTitle></DialogHeader>
                            {editingPlan?.id === plan.id && (
                              <PlanForm plan={editingPlan} onSave={(d) => updatePlan.mutate({ id: plan.id, data: d })} onClose={() => setEditingPlan(null)} />
                            )}
                          </DialogContent>
                        </Dialog>
                        <Button size="sm" variant="outline" onClick={() => updatePlan.mutate({ id: plan.id, data: { isActive: !plan.isActive } })}>
                          {plan.isActive ? "Deactivate" : "Activate"}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Members tab */}
          <TabsContent value="members" className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <Label className="text-sm">Status:</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                    <SelectItem value="past_due">Past Due</SelectItem>
                  </SelectContent>
                </Select>
                <Label className="text-sm">Tier:</Label>
                <Select value={planFilter} onValueChange={setPlanFilter}>
                  <SelectTrigger className="w-44"><SelectValue placeholder="All tiers" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All tiers</SelectItem>
                    {plans.map((p: any) => (
                      <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <GrantMembershipDialog plans={plans} onGrant={(d) => grantMembership.mutate(d)} />
            </div>

            {membersLoading ? (
              <div className="text-sm text-muted-foreground p-4">Loading members…</div>
            ) : members.length === 0 ? (
              <Card><CardContent className="py-12 text-center text-muted-foreground">No memberships found.</CardContent></Card>
            ) : (
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Member</TableHead>
                      <TableHead>Plan</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead>Renews / Ends</TableHead>
                      <TableHead>Stripe Sub</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {members.map((m: any) => (
                      <TableRow key={m.id}>
                        <TableCell>
                          <div className="font-medium">{m.userFirstName} {m.userLastName}</div>
                          <div className="text-xs text-muted-foreground">{m.userEmail}</div>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{m.planName}</div>
                          <div className="text-xs text-muted-foreground">${Number(m.planPrice).toFixed(2)}/{m.planBillingCycle}</div>
                        </TableCell>
                        <TableCell>{statusBadge(m.status)}</TableCell>
                        <TableCell className="text-sm">{m.startDate ? format(new Date(m.startDate), "MMM d, yyyy") : "—"}</TableCell>
                        <TableCell className="text-sm">{m.renewsAt ? format(new Date(m.renewsAt), "MMM d, yyyy") : m.endDate ? format(new Date(m.endDate), "MMM d, yyyy") : "—"}</TableCell>
                        <TableCell>
                          {m.providerSubscriptionId ? (
                            <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded">{m.providerSubscriptionId.slice(0, 16)}…</span>
                          ) : <span className="text-muted-foreground text-xs">Manual</span>}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Dialog open={overridingMembership?.id === m.id} onOpenChange={(o) => !o && setOverridingMembership(null)}>
                              <DialogTrigger asChild>
                                <Button size="sm" variant="ghost" onClick={() => setOverridingMembership(m)}>
                                  <SlidersHorizontal className="h-4 w-4" />
                                </Button>
                              </DialogTrigger>
                              {overridingMembership?.id === m.id && (
                                <OverrideMembershipDialog
                                  membership={overridingMembership}
                                  onOverride={(data) => overrideMembership.mutate({ id: m.id, data })}
                                  onClose={() => setOverridingMembership(null)}
                                />
                              )}
                            </Dialog>
                            {m.status === "active" && (
                              <Button
                                size="sm" variant="ghost" className="text-destructive"
                                onClick={() => setMembershipToCancel(m.id)}
                                disabled={cancelMembership.isPending}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <AlertDialog open={membershipToCancel !== null} onOpenChange={(open) => { if (!open) setMembershipToCancel(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this membership?</AlertDialogTitle>
            <AlertDialogDescription>This will immediately cancel the member's subscription. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Membership</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (membershipToCancel !== null) { cancelMembership.mutate(membershipToCancel); setMembershipToCancel(null); } }}
            >
              Cancel Membership
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
