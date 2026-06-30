import { API_BASE } from "@/lib/api-base";
import React, { useState, useCallback } from "react";
import { Redirect } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Link } from "wouter";
import {
  Plus, Trash2, Building2, Clock, DollarSign, CalendarX, CheckCircle2,
  XCircle, Loader2, Pencil, Settings, Users, ClipboardCheck, Copy,
} from "lucide-react";

function useAuthHeaders() {
  const { getToken } = useAuth();
  return useCallback(async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  }, [getToken]);
}

function fmt12(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const p = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${p}`;
}

const STATUS_STYLES: Record<string, string> = {
  confirmed: "bg-emerald-100 text-emerald-700 border-emerald-200",
  pending: "bg-yellow-100 text-yellow-700 border-yellow-200",
  cancelled: "bg-red-100 text-red-600 border-red-200",
};

const PAY_STYLES: Record<string, string> = {
  paid: "bg-emerald-100 text-emerald-700",
  unpaid: "bg-yellow-100 text-yellow-700",
  refunded: "bg-blue-100 text-blue-700",
};

// ── Bookings Tab ──────────────────────────────────────────────────────────────

function BookingsTab() {
  const getHeaders = useAuthHeaders();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [dateFilter, setDateFilter] = useState("");
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [cancelRefund, setCancelRefund] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [checkingIn, setCheckingIn] = useState<number | null>(null);

  const { data: rentals = [], isLoading } = useQuery({
    queryKey: ["admin-rentals", dateFilter],
    queryFn: async () => {
      const h = await getHeaders();
      const url = `${API_BASE}/admin/rentals${dateFilter ? `?date=${dateFilter}` : ""}`;
      const res = await fetch(url, { headers: h });
      return res.json();
    },
  });

  const handleCheckin = async (id: number) => {
    setCheckingIn(id);
    try {
      const h = await getHeaders();
      const res = await fetch(`${API_BASE}/admin/rentals/${id}/checkin`, { method: "POST", headers: h });
      if (res.ok) {
        toast({ title: "Checked in!" });
        qc.invalidateQueries({ queryKey: ["admin-rentals"] });
      }
    } finally {
      setCheckingIn(null);
    }
  };

  const handleCancel = async () => {
    if (!cancelId) return;
    setCancelling(true);
    try {
      const h = await getHeaders();
      const res = await fetch(`${API_BASE}/admin/rentals/${cancelId}/cancel`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ refund: cancelRefund }),
      });
      if (!res.ok) {
        const d = await res.json();
        toast({ title: "Error", description: d.error, variant: "destructive" });
      } else {
        toast({ title: "Rental cancelled" });
        qc.invalidateQueries({ queryKey: ["admin-rentals"] });
        setCancelId(null);
      }
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <div className="flex items-center gap-2">
          <Label className="text-muted-foreground text-sm">Filter by date</Label>
          <Input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="w-44"
          />
          {dateFilter && (
            <button onClick={() => setDateFilter("")} className="text-muted-foreground hover:text-foreground text-xs">Clear</button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />)}
        </div>
      ) : rentals.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Building2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p>No rentals found{dateFilter ? " for this date" : ""}.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rentals.map((r: any) => (
            <div key={r.id} className="bg-background border border-border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-4 shadow-sm">
              {/* Left: court icon */}
              <div className="hidden sm:flex h-10 w-10 rounded-lg bg-muted items-center justify-center shrink-0">
                <Building2 className="h-5 w-5 text-muted-foreground" />
              </div>

              {/* Middle: main info */}
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-foreground">Court {r.courtNumber}</span>
                  <Badge className={`text-xs border font-medium ${STATUS_STYLES[r.status] ?? ""}`}>{r.status}</Badge>
                  <Badge className={`text-xs border-0 font-medium ${PAY_STYLES[r.paymentStatus] ?? ""}`}>{r.paymentStatus}</Badge>
                  {r.checkinAt && (
                    <Badge className="text-xs bg-emerald-100 text-emerald-700 border border-emerald-200 font-medium">✓ Checked In</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{r.date}</span>
                  {" · "}
                  {fmt12(r.startTime)} – {fmt12(r.endTime)}
                </p>
                {r.userName && (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium">{r.userName}</span>
                    {r.userEmail ? ` · ${r.userEmail}` : ""}
                  </p>
                )}
                {r.adminNotes && <p className="text-xs text-muted-foreground italic">{r.adminNotes}</p>}
              </div>

              {/* Right: price + actions */}
              <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                <span className="text-emerald-600 font-bold text-base">${Number(r.totalPrice).toFixed(2)}</span>
                {r.groupWaiverToken && (
                  <button
                    title="Copy group waiver link"
                    onClick={() => navigator.clipboard.writeText(`${window.location.origin}/waiver/rental/${r.groupWaiverToken}`)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                )}
                {!r.checkinAt && r.status === "confirmed" && (
                  <Button size="sm" variant="outline" onClick={() => handleCheckin(r.id)} disabled={checkingIn === r.id}>
                    {checkingIn === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><ClipboardCheck className="h-3.5 w-3.5 mr-1" /> Check In</>}
                  </Button>
                )}
                {r.status !== "cancelled" && (
                  <Button variant="destructive" size="sm" onClick={() => { setCancelId(r.id); setCancelRefund(r.paymentStatus === "paid"); }}>
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={cancelId !== null} onOpenChange={(o) => { if (!o) setCancelId(null); }}>
        <DialogContent className="bg-[#111118] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle>Cancel Rental</DialogTitle>
          </DialogHeader>
          <p className="text-white/60 text-sm">Are you sure you want to cancel this rental?</p>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="refund"
              checked={cancelRefund}
              onChange={(e) => setCancelRefund(e.target.checked)}
              className="rounded"
            />
            <Label htmlFor="refund" className="text-white/70 text-sm cursor-pointer">Issue refund to customer</Label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelId(null)} disabled={cancelling}>Keep</Button>
            <Button variant="destructive" onClick={handleCancel} disabled={cancelling}>
              {cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : "Cancel Rental"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Pricing Tiers Tab ─────────────────────────────────────────────────────────

function PricingTab() {
  const getHeaders = useAuthHeaders();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editTier, setEditTier] = useState<any>(null);
  const [form, setForm] = useState({ name: "", durationMinutes: "", price: "", sortOrder: "0" });
  const [saving, setSaving] = useState(false);

  const { data: tiers = [], isLoading } = useQuery({
    queryKey: ["admin-rental-pricing"],
    queryFn: async () => {
      const h = await getHeaders();
      const res = await fetch(`${API_BASE}/admin/rental-pricing`, { headers: h });
      return res.json();
    },
  });

  const openNew = () => { setEditTier(null); setForm({ name: "", durationMinutes: "", price: "", sortOrder: String(tiers.length) }); setShowForm(true); };
  const openEdit = (t: any) => { setEditTier(t); setForm({ name: t.name, durationMinutes: String(t.durationMinutes), price: String(t.price), sortOrder: String(t.sortOrder) }); setShowForm(true); };

  const handleSave = async () => {
    if (!form.name || !form.durationMinutes || !form.price) {
      toast({ title: "All fields are required", variant: "destructive" }); return;
    }
    setSaving(true);
    try {
      const h = await getHeaders();
      const url = editTier ? `${API_BASE}/admin/rental-pricing/${editTier.id}` : `${API_BASE}/admin/rental-pricing`;
      const res = await fetch(url, {
        method: editTier ? "PATCH" : "POST",
        headers: h,
        body: JSON.stringify({ ...form, durationMinutes: Number(form.durationMinutes), price: form.price, sortOrder: Number(form.sortOrder) }),
      });
      if (!res.ok) { const d = await res.json(); toast({ title: "Error", description: d.error, variant: "destructive" }); return; }
      toast({ title: editTier ? "Tier updated" : "Tier created" });
      qc.invalidateQueries({ queryKey: ["admin-rental-pricing"] });
      setShowForm(false);
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this pricing tier?")) return;
    const h = await getHeaders();
    await fetch(`${API_BASE}/admin/rental-pricing/${id}`, { method: "DELETE", headers: h });
    qc.invalidateQueries({ queryKey: ["admin-rental-pricing"] });
    toast({ title: "Tier deleted" });
  };

  const handleToggle = async (tier: any) => {
    const h = await getHeaders();
    await fetch(`${API_BASE}/admin/rental-pricing/${tier.id}`, {
      method: "PATCH", headers: h, body: JSON.stringify({ isActive: !tier.isActive }),
    });
    qc.invalidateQueries({ queryKey: ["admin-rental-pricing"] });
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <p className="text-muted-foreground text-sm">Configure rental durations and prices shown to customers.</p>
        <Button onClick={openNew} size="sm"><Plus className="h-4 w-4 mr-1" /> Add Tier</Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}</div>
      ) : tiers.length === 0 ? (
        <p className="text-muted-foreground text-sm text-center py-10">No pricing tiers yet. Add one to enable rentals.</p>
      ) : (
        <div className="space-y-3">
          {tiers.map((tier: any) => (
            <div key={tier.id} className={`flex items-center gap-4 p-4 rounded-xl border transition-all shadow-sm ${tier.isActive ? "bg-background border-border" : "bg-muted border-border opacity-50"}`}>
              <div className="flex-1 min-w-0">
                <p className="text-foreground font-semibold">{tier.name}</p>
                <p className="text-muted-foreground text-xs">
                  {tier.durationMinutes >= 60
                    ? `${tier.durationMinutes / 60}hr${tier.durationMinutes > 60 ? "s" : ""}`
                    : `${tier.durationMinutes} min`}
                </p>
              </div>
              <span className="text-emerald-600 font-bold">${Number(tier.price).toFixed(2)}</span>
              <div className="flex items-center gap-2">
                <button onClick={() => handleToggle(tier)} className="text-muted-foreground hover:text-foreground transition-colors" title={tier.isActive ? "Deactivate" : "Activate"}>
                  {tier.isActive ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4" />}
                </button>
                <button onClick={() => openEdit(tier)} className="text-muted-foreground hover:text-foreground transition-colors"><Pencil className="h-4 w-4" /></button>
                <button onClick={() => handleDelete(tier.id)} className="text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={(o) => { if (!o) setShowForm(false); }}>
        <DialogContent className="bg-[#111118] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle>{editTier ? "Edit Pricing Tier" : "Add Pricing Tier"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-white/70 text-sm">Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. 1 Hour, Half Day (4 hrs)" className="bg-white/5 border-white/10 text-white mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-white/70 text-sm">Duration (minutes)</Label>
                <Input type="number" value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} placeholder="60" className="bg-white/5 border-white/10 text-white mt-1" />
              </div>
              <div>
                <Label className="text-white/70 text-sm">Price ($)</Label>
                <Input type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="50.00" className="bg-white/5 border-white/10 text-white mt-1" />
              </div>
            </div>
            <div>
              <Label className="text-white/70 text-sm">Sort Order</Label>
              <Input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} className="bg-white/5 border-white/10 text-white mt-1 w-24" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Blackouts Tab ─────────────────────────────────────────────────────────────

function BlackoutsTab() {
  const getHeaders = useAuthHeaders();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ courtNumber: "", date: "", startTime: "", endTime: "", reason: "" });
  const [saving, setSaving] = useState(false);

  const { data: blackouts = [], isLoading } = useQuery({
    queryKey: ["admin-rental-blackouts"],
    queryFn: async () => {
      const h = await getHeaders();
      const res = await fetch(`${API_BASE}/admin/rental-blackouts`, { headers: h });
      return res.json();
    },
  });

  const handleSave = async () => {
    if (!form.date) { toast({ title: "Date is required", variant: "destructive" }); return; }
    if ((form.startTime && !form.endTime) || (!form.startTime && form.endTime)) {
      toast({ title: "Both start and end time are required, or leave both empty for all-day", variant: "destructive" }); return;
    }
    setSaving(true);
    try {
      const h = await getHeaders();
      const res = await fetch(`${API_BASE}/admin/rental-blackouts`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({
          courtNumber: form.courtNumber ? Number(form.courtNumber) : null,
          date: form.date,
          startTime: form.startTime || null,
          endTime: form.endTime || null,
          reason: form.reason || null,
        }),
      });
      if (!res.ok) { const d = await res.json(); toast({ title: "Error", description: d.error, variant: "destructive" }); return; }
      toast({ title: "Blackout added" });
      qc.invalidateQueries({ queryKey: ["admin-rental-blackouts"] });
      setShowForm(false);
      setForm({ courtNumber: "", date: "", startTime: "", endTime: "", reason: "" });
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Remove this blackout?")) return;
    const h = await getHeaders();
    await fetch(`${API_BASE}/admin/rental-blackouts/${id}`, { method: "DELETE", headers: h });
    qc.invalidateQueries({ queryKey: ["admin-rental-blackouts"] });
    toast({ title: "Blackout removed" });
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <p className="text-muted-foreground text-sm">Block dates or time ranges when courts are unavailable for rental.</p>
        <Button onClick={() => setShowForm(true)} size="sm"><Plus className="h-4 w-4 mr-1" /> Add Blackout</Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}</div>
      ) : blackouts.length === 0 ? (
        <p className="text-muted-foreground text-sm text-center py-10">No blackout dates set.</p>
      ) : (
        <div className="space-y-3">
          {blackouts.map((b: any) => (
            <div key={b.id} className="flex items-center gap-4 p-4 rounded-xl border bg-background border-border shadow-sm">
              <CalendarX className="h-5 w-5 text-red-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-foreground font-semibold">
                  {b.date}
                  {b.courtNumber ? ` · Court ${b.courtNumber}` : " · All Courts"}
                </p>
                <p className="text-muted-foreground text-xs">
                  {b.startTime && b.endTime ? `${fmt12(b.startTime)} – ${fmt12(b.endTime)}` : "All day"}
                  {b.reason ? ` · ${b.reason}` : ""}
                </p>
              </div>
              <button onClick={() => handleDelete(b.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={(o) => { if (!o) setShowForm(false); }}>
        <DialogContent className="bg-[#111118] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle>Add Blackout</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-white/70 text-sm">Court (optional)</Label>
                <select
                  value={form.courtNumber}
                  onChange={(e) => setForm({ ...form, courtNumber: e.target.value })}
                  className="w-full mt-1 bg-white/5 border border-white/10 text-white rounded-md px-3 py-2 text-sm"
                >
                  <option value="">All Courts</option>
                  <option value="1">Court 1</option>
                  <option value="2">Court 2</option>
                </select>
              </div>
              <div>
                <Label className="text-white/70 text-sm">Date</Label>
                <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="bg-white/5 border-white/10 text-white mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-white/70 text-sm">Start Time (leave blank for all day)</Label>
                <Input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} className="bg-white/5 border-white/10 text-white mt-1" />
              </div>
              <div>
                <Label className="text-white/70 text-sm">End Time</Label>
                <Input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} className="bg-white/5 border-white/10 text-white mt-1" />
              </div>
            </div>
            <div>
              <Label className="text-white/70 text-sm">Reason (optional)</Label>
              <Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. Facility maintenance" className="bg-white/5 border-white/10 text-white mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add Blackout"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Main Admin Page ───────────────────────────────────────────────────────────

type Tab = "bookings" | "pricing" | "blackouts";

export default function AdminRentals() {
  const { data: profile, isLoading } = useGetMyProfile();
  const [tab, setTab] = useState<Tab>("bookings");

  if (isLoading) return null;
  if (!profile || profile.role !== "admin") return <Redirect to="/" />;

  const TABS: { value: Tab; label: string }[] = [
    { value: "bookings", label: "Bookings" },
    { value: "pricing", label: "Pricing Tiers" },
    { value: "blackouts", label: "Blackouts" },
  ];

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-foreground">Court Rentals</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage rental bookings, pricing, and availability.</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Link href="/admin/rentals/setup">
              <Button variant="outline"><Settings className="h-4 w-4 mr-1.5" /> Set Up Rentals</Button>
            </Link>
            <Link href="/admin/rentals/new">
              <Button><Plus className="h-4 w-4 mr-1.5" /> New Rental</Button>
            </Link>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-border mb-8">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-all -mb-px ${
                tab === t.value
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "bookings" && <BookingsTab />}
        {tab === "pricing" && <PricingTab />}
        {tab === "blackouts" && <BlackoutsTab />}
      </div>
    </Layout>
  );
}
