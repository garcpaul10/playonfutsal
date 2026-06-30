import { API_BASE } from "@/lib/api-base";
import React, { useState } from "react";
import { Redirect, useLocation } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { WizardShell } from "@/components/admin/WizardShell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@clerk/react";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Trash2, Building2, Clock, DollarSign, CalendarX, CheckCircle2,
  Globe, Settings, Loader2,
} from "lucide-react";

const STEPS = ["Basics", "Pricing", "Availability", "Blackouts", "Review"];

// ─── Wizard state ──────────────────────────────────────────────────────────────

interface PricingTierDraft {
  key: string; // local id
  name: string;
  durationMinutes: string;
  price: string;
  sortOrder: number;
}

interface BlackoutDraft {
  key: string;
  courtNumber: string; // "" = all courts
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
}

interface WizardState {
  // Basics
  name: string;
  description: string;
  enabledCourts: number[];
  // Availability
  openTime: string;
  closeTime: string;
  advanceBookingDays: string;
  slotIncrementMinutes: string;
  cancellationHours: string;
  requiresApproval: boolean;
  // Pricing tiers
  tiers: PricingTierDraft[];
  // Blackouts
  blackouts: BlackoutDraft[];
}

const DEFAULT: WizardState = {
  name: "",
  description: "",
  enabledCourts: [1, 2],
  openTime: "08:00",
  closeTime: "22:00",
  advanceBookingDays: "30",
  slotIncrementMinutes: "30",
  cancellationHours: "24",
  requiresApproval: false,
  tiers: [],
  blackouts: [],
};

function uid() {
  return Math.random().toString(36).slice(2);
}

function fmt12(t: string): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const p = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${p}`;
}

// ─── Step 1: Basics ────────────────────────────────────────────────────────────

function Step1Basics({ state, onChange }: { state: WizardState; onChange: (u: Partial<WizardState>) => void }) {
  const toggleCourt = (n: number) => {
    const next = state.enabledCourts.includes(n)
      ? state.enabledCourts.filter((c) => c !== n)
      : [...state.enabledCourts, n].sort();
    onChange({ enabledCourts: next });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-1">Name your rental offering</h2>
        <p className="text-sm text-muted-foreground">This is what customers will see when they visit the rentals page.</p>
      </div>

      <div className="space-y-4">
        <div>
          <Label className="text-sm font-medium">
            Offering Name <span className="text-red-400">*</span>
          </Label>
          <Input
            value={state.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="e.g. PlayOn Court Rentals"
            className="mt-1.5"
          />
        </div>

        <div>
          <Label className="text-sm font-medium">Description</Label>
          <Textarea
            value={state.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder="Describe what customers get when they rent a court — ideal for team practices, birthday parties, etc."
            rows={3}
            className="mt-1.5"
          />
        </div>

        <div>
          <Label className="text-sm font-medium mb-2 block">Courts Available for Rental</Label>
          <div className="flex gap-3">
            {[1, 2].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => toggleCourt(n)}
                className={`flex items-center gap-2 px-5 py-3 rounded-xl border font-medium text-sm transition-all ${
                  state.enabledCourts.includes(n)
                    ? "border-primary bg-primary/10 text-foreground ring-1 ring-primary"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                <Building2 className="h-4 w-4" />
                Court {n}
                {state.enabledCourts.includes(n) && <CheckCircle2 className="h-4 w-4 text-primary" />}
              </button>
            ))}
          </div>
          {state.enabledCourts.length === 0 && (
            <p className="text-xs text-red-400 mt-2">Select at least one court.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Step 2: Pricing ───────────────────────────────────────────────────────────

function Step2Pricing({ state, onChange }: { state: WizardState; onChange: (u: Partial<WizardState>) => void }) {
  const [form, setForm] = useState<Omit<PricingTierDraft, "key" | "sortOrder">>({
    name: "",
    durationMinutes: "",
    price: "",
  });
  const [editing, setEditing] = useState<string | null>(null);

  const addTier = () => {
    if (!form.name || !form.durationMinutes || !form.price) return;
    if (editing) {
      onChange({
        tiers: state.tiers.map((t) =>
          t.key === editing ? { ...t, ...form } : t
        ),
      });
      setEditing(null);
    } else {
      onChange({
        tiers: [...state.tiers, { key: uid(), sortOrder: state.tiers.length, ...form }],
      });
    }
    setForm({ name: "", durationMinutes: "", price: "" });
  };

  const startEdit = (tier: PricingTierDraft) => {
    setEditing(tier.key);
    setForm({ name: tier.name, durationMinutes: tier.durationMinutes, price: tier.price });
  };

  const removeTier = (key: string) => {
    onChange({ tiers: state.tiers.filter((t) => t.key !== key) });
  };

  const cancelEdit = () => {
    setEditing(null);
    setForm({ name: "", durationMinutes: "", price: "" });
  };

  const formValid = form.name.trim() && form.durationMinutes && form.price;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-1">Pricing tiers</h2>
        <p className="text-sm text-muted-foreground">
          Define the rental packages customers can choose from — e.g. 1 Hour, 2 Hours, Half Day.
        </p>
      </div>

      {/* Existing tiers */}
      {state.tiers.length > 0 && (
        <div className="space-y-2">
          {state.tiers.map((tier) => (
            <div
              key={tier.key}
              className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${
                editing === tier.key ? "border-primary bg-primary/5" : "border-border bg-card"
              }`}
            >
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-foreground">{tier.name}</p>
                <p className="text-xs text-muted-foreground">
                  {Number(tier.durationMinutes) >= 60
                    ? `${Number(tier.durationMinutes) / 60}hr${Number(tier.durationMinutes) > 60 ? "s" : ""}`
                    : `${tier.durationMinutes} min`}
                </p>
              </div>
              <span className="text-emerald-400 font-bold text-sm">${Number(tier.price).toFixed(2)}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => startEdit(tier)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded border border-border"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => removeTier(tier.key)}
                  className="text-muted-foreground hover:text-red-400 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / edit form */}
      <div className="border border-dashed border-border rounded-xl p-4 space-y-3 bg-muted/20">
        <p className="text-sm font-medium text-foreground">
          {editing ? "Edit tier" : "Add a pricing tier"}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs text-muted-foreground">Name</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="1 Hour"
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Duration (minutes)</Label>
            <Input
              type="number"
              value={form.durationMinutes}
              onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
              placeholder="60"
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Price ($)</Label>
            <Input
              type="number"
              step="0.01"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              placeholder="75.00"
              className="mt-1"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={addTier} disabled={!formValid}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            {editing ? "Save changes" : "Add tier"}
          </Button>
          {editing && (
            <Button size="sm" variant="outline" onClick={cancelEdit}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      {state.tiers.length === 0 && (
        <p className="text-xs text-amber-400">Add at least one pricing tier to continue.</p>
      )}
    </div>
  );
}

// ─── Step 3: Availability ──────────────────────────────────────────────────────

function Step3Availability({ state, onChange }: { state: WizardState; onChange: (u: Partial<WizardState>) => void }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-1">Availability settings</h2>
        <p className="text-sm text-muted-foreground">Control when courts are open for self-serve booking.</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="text-sm font-medium">Open Time</Label>
          <Input
            type="time"
            value={state.openTime}
            onChange={(e) => onChange({ openTime: e.target.value })}
            className="mt-1.5"
          />
          <p className="text-xs text-muted-foreground mt-1">Earliest start time customers can book</p>
        </div>
        <div>
          <Label className="text-sm font-medium">Close Time</Label>
          <Input
            type="time"
            value={state.closeTime}
            onChange={(e) => onChange({ closeTime: e.target.value })}
            className="mt-1.5"
          />
          <p className="text-xs text-muted-foreground mt-1">Latest end time for any rental</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="text-sm font-medium">Advance Booking Window</Label>
          <div className="flex items-center gap-2 mt-1.5">
            <Input
              type="number"
              min="1"
              max="365"
              value={state.advanceBookingDays}
              onChange={(e) => onChange({ advanceBookingDays: e.target.value })}
              className="w-24"
            />
            <span className="text-sm text-muted-foreground">days ahead</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">How far in advance customers can book</p>
        </div>
        <div>
          <Label className="text-sm font-medium">Slot Increment</Label>
          <div className="flex items-center gap-2 mt-1.5">
            <Input
              type="number"
              min="15"
              step="15"
              value={state.slotIncrementMinutes}
              onChange={(e) => onChange({ slotIncrementMinutes: e.target.value })}
              className="w-24"
            />
            <span className="text-sm text-muted-foreground">minutes</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Time slot grid granularity</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="text-sm font-medium">Cancellation Window</Label>
          <div className="flex items-center gap-2 mt-1.5">
            <Input
              type="number"
              min="0"
              value={state.cancellationHours}
              onChange={(e) => onChange({ cancellationHours: e.target.value })}
              className="w-24"
            />
            <span className="text-sm text-muted-foreground">hours before</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">How far ahead cancellations must be made for a refund</p>
        </div>
        <div>
          <Label className="text-sm font-medium">Approval Required?</Label>
          <div className="flex gap-3 mt-2">
            {[false, true].map((v) => (
              <button
                key={String(v)}
                type="button"
                onClick={() => onChange({ requiresApproval: v })}
                className={`px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
                  state.requiresApproval === v
                    ? "border-primary bg-primary/10 text-foreground ring-1 ring-primary"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                {v ? "Yes — review each booking" : "No — instant confirm"}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Step 4: Blackouts ─────────────────────────────────────────────────────────

function Step4Blackouts({ state, onChange }: { state: WizardState; onChange: (u: Partial<WizardState>) => void }) {
  const [form, setForm] = useState<Omit<BlackoutDraft, "key">>({
    courtNumber: "",
    date: "",
    startTime: "",
    endTime: "",
    reason: "",
  });

  const addBlackout = () => {
    if (!form.date) return;
    onChange({ blackouts: [...state.blackouts, { key: uid(), ...form }] });
    setForm({ courtNumber: "", date: "", startTime: "", endTime: "", reason: "" });
  };

  const removeBlackout = (key: string) => {
    onChange({ blackouts: state.blackouts.filter((b) => b.key !== key) });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-1">Blackout dates</h2>
        <p className="text-sm text-muted-foreground">
          Block specific dates or time ranges when courts are unavailable — holidays, maintenance, events, etc.
          You can always add more later.
        </p>
      </div>

      {/* Existing blackouts */}
      {state.blackouts.length > 0 && (
        <div className="space-y-2">
          {state.blackouts.map((b) => (
            <div key={b.key} className="flex items-center gap-4 p-4 rounded-xl border border-border bg-card">
              <CalendarX className="h-5 w-5 text-red-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-foreground">
                  {b.date}
                  {b.courtNumber ? ` · Court ${b.courtNumber}` : " · All Courts"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {b.startTime && b.endTime ? `${fmt12(b.startTime)} – ${fmt12(b.endTime)}` : "All day"}
                  {b.reason ? ` · ${b.reason}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => removeBlackout(b.key)}
                className="text-muted-foreground hover:text-red-400 transition-colors"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add form */}
      <div className="border border-dashed border-border rounded-xl p-4 space-y-3 bg-muted/20">
        <p className="text-sm font-medium text-foreground">Add a blackout</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-muted-foreground">Court (optional)</Label>
            <select
              value={form.courtNumber}
              onChange={(e) => setForm({ ...form, courtNumber: e.target.value })}
              className="w-full mt-1 bg-background border border-input text-foreground rounded-md px-3 py-2 text-sm"
            >
              <option value="">All Courts</option>
              {state.enabledCourts.map((n) => (
                <option key={n} value={String(n)}>Court {n}</option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Date <span className="text-red-400">*</span></Label>
            <Input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              className="mt-1"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-muted-foreground">Start Time (blank = all day)</Label>
            <Input
              type="time"
              value={form.startTime}
              onChange={(e) => setForm({ ...form, startTime: e.target.value })}
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">End Time</Label>
            <Input
              type="time"
              value={form.endTime}
              onChange={(e) => setForm({ ...form, endTime: e.target.value })}
              className="mt-1"
            />
          </div>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Reason (optional)</Label>
          <Input
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            placeholder="e.g. Holiday, Facility maintenance"
            className="mt-1"
          />
        </div>
        <Button size="sm" onClick={addBlackout} disabled={!form.date}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add Blackout
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Skip this step if you have no blackouts to add right now.
      </p>
    </div>
  );
}

// ─── Step 5: Review ────────────────────────────────────────────────────────────

function Step5Review({ state }: { state: WizardState }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-1">Review & publish</h2>
        <p className="text-sm text-muted-foreground">
          Everything looks good? Hit Publish to make this rental offering live for customers.
        </p>
      </div>

      {/* Basics */}
      <section>
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Basics</h3>
        <div className="bg-card rounded-xl border border-border divide-y divide-border overflow-hidden">
          <Row label="Name" value={state.name} />
          <Row label="Description" value={state.description || "—"} />
          <Row label="Courts" value={state.enabledCourts.map((n) => `Court ${n}`).join(", ")} />
        </div>
      </section>

      {/* Pricing */}
      <section>
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Pricing Tiers</h3>
        <div className="bg-card rounded-xl border border-border divide-y divide-border overflow-hidden">
          {state.tiers.map((t) => (
            <Row
              key={t.key}
              label={t.name}
              value={`$${Number(t.price).toFixed(2)} · ${
                Number(t.durationMinutes) >= 60
                  ? `${Number(t.durationMinutes) / 60}hr${Number(t.durationMinutes) > 60 ? "s" : ""}`
                  : `${t.durationMinutes} min`
              }`}
              accent="text-emerald-400"
            />
          ))}
        </div>
      </section>

      {/* Availability */}
      <section>
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Availability</h3>
        <div className="bg-card rounded-xl border border-border divide-y divide-border overflow-hidden">
          <Row label="Hours" value={`${fmt12(state.openTime)} – ${fmt12(state.closeTime)}`} />
          <Row label="Advance booking" value={`${state.advanceBookingDays} days`} />
          <Row label="Slot grid" value={`Every ${state.slotIncrementMinutes} min`} />
          <Row label="Cancellation window" value={`${state.cancellationHours} hrs before start`} />
          <Row label="Requires approval" value={state.requiresApproval ? "Yes" : "No — instant confirm"} />
        </div>
      </section>

      {/* Blackouts */}
      {state.blackouts.length > 0 && (
        <section>
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">
            Blackouts ({state.blackouts.length})
          </h3>
          <div className="bg-card rounded-xl border border-border divide-y divide-border overflow-hidden">
            {state.blackouts.map((b) => (
              <Row
                key={b.key}
                label={`${b.date}${b.courtNumber ? ` · Court ${b.courtNumber}` : " · All Courts"}`}
                value={
                  b.startTime && b.endTime
                    ? `${fmt12(b.startTime)} – ${fmt12(b.endTime)}${b.reason ? ` · ${b.reason}` : ""}`
                    : `All day${b.reason ? ` · ${b.reason}` : ""}`
                }
              />
            ))}
          </div>
        </section>
      )}

      <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-5 py-4 flex gap-3 items-start">
        <Globe className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
        <p className="text-sm text-emerald-400 font-medium">
          Publishing will make this rental offering live at <strong>/rentals</strong> so customers can start booking immediately.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5 gap-4">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <span className={`text-sm font-medium text-right ${accent ?? "text-foreground"}`}>{value}</span>
    </div>
  );
}

// ─── Main Wizard ───────────────────────────────────────────────────────────────

export default function RentalSetupWizard() {
  const { data: profile, isLoading } = useGetMyProfile();
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(DEFAULT);
  const [publishing, setPublishing] = useState(false);
  const [, setLocation] = useLocation();
  const { getToken } = useAuth();
  const { toast } = useToast();

  const onChange = (updates: Partial<WizardState>) => setState((prev) => ({ ...prev, ...updates }));

  const canProceed =
    step === 0 ? state.name.trim().length > 0 && state.enabledCourts.length > 0
    : step === 1 ? state.tiers.length > 0
    : step === 2 ? !!(state.openTime && state.closeTime && Number(state.advanceBookingDays) > 0)
    : true; // blackouts and review always ok

  const handlePublish = async () => {
    setPublishing(true);
    try {
      const token = await getToken();
      const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

      // 1. Create rental settings
      const settingsRes = await fetch(`${API_BASE}/admin/rental-settings`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: state.name,
          description: state.description || null,
          enabledCourts: state.enabledCourts,
          openTime: state.openTime,
          closeTime: state.closeTime,
          advanceBookingDays: Number(state.advanceBookingDays),
          slotIncrementMinutes: Number(state.slotIncrementMinutes),
          cancellationHours: Number(state.cancellationHours),
          requiresApproval: state.requiresApproval,
          isPublished: true,
        }),
      });
      if (!settingsRes.ok) {
        const d = await settingsRes.json();
        toast({ title: "Error saving settings", description: d.error, variant: "destructive" });
        return;
      }

      // 2. Create pricing tiers
      for (const tier of state.tiers) {
        await fetch(`${API_BASE}/admin/rental-pricing`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            name: tier.name,
            durationMinutes: Number(tier.durationMinutes),
            price: tier.price,
            isActive: true,
            sortOrder: tier.sortOrder,
          }),
        });
      }

      // 3. Create blackouts
      for (const b of state.blackouts) {
        await fetch(`${API_BASE}/admin/rental-blackouts`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            courtNumber: b.courtNumber ? Number(b.courtNumber) : null,
            date: b.date,
            startTime: b.startTime || null,
            endTime: b.endTime || null,
            reason: b.reason || null,
          }),
        });
      }

      toast({ title: "Rental offering published!", description: "Customers can now book courts at /rentals." });
      setLocation("/admin/rentals");
    } finally {
      setPublishing(false);
    }
  };

  if (isLoading) return null;
  if (!profile || profile.role !== "admin") return <Redirect to="/" />;

  return (
    <WizardShell
      title="Set Up Court Rentals"
      backHref="/admin/rentals"
      steps={STEPS}
      step={step}
      setStep={setStep}
      canProceed={canProceed}
      isLastStep={step === STEPS.length - 1}
      onPublish={handlePublish}
      publishLabel={publishing ? "Publishing…" : "Publish Offering"}
      publishDisabled={publishing}
    >
      {step === 0 && <Step1Basics state={state} onChange={onChange} />}
      {step === 1 && <Step2Pricing state={state} onChange={onChange} />}
      {step === 2 && <Step3Availability state={state} onChange={onChange} />}
      {step === 3 && <Step4Blackouts state={state} onChange={onChange} />}
      {step === 4 && <Step5Review state={state} />}
    </WizardShell>
  );
}
