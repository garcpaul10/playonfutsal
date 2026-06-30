import { API_BASE } from "@/lib/api-base";
import React, { useState } from "react";
import { Redirect, useLocation } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { WizardShell } from "@/components/admin/WizardShell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { useToast } from "@/hooks/use-toast";
import { toEasternISOString } from "@/lib/timezone";
import {
  Building2, CheckCircle2, Plus, Trash2, CalendarDays, Clock,
  AlertTriangle, Lock, Loader2,
} from "lucide-react";
import { format, addDays, eachDayOfInterval, parseISO } from "date-fns";

const STEPS = ["Courts", "Dates & Times", "Details", "Review"];

// ─── Types ────────────────────────────────────────────────────────────────────

interface TimeSlot {
  key: string;
  allDay: boolean;
  startTime: string; // HH:MM for datetime-local base
  endTime: string;
}

interface WizardState {
  courtIds: number[];
  dateMode: "range" | "specific";
  dateFrom: string;
  dateTo: string;
  specificDates: string[];
  timeSlots: TimeSlot[];
  reason: string;
  notes: string;
}

function uid() { return Math.random().toString(36).slice(2); }

const DEFAULT: WizardState = {
  courtIds: [],
  dateMode: "range",
  dateFrom: format(new Date(), "yyyy-MM-dd"),
  dateTo: format(new Date(), "yyyy-MM-dd"),
  specificDates: [],
  timeSlots: [{ key: uid(), allDay: true, startTime: "08:00", endTime: "22:00" }],
  reason: "",
  notes: "",
};

// ─── Step 1: Courts ───────────────────────────────────────────────────────────

function Step1Courts({ state, onChange, courts }: {
  state: WizardState;
  onChange: (u: Partial<WizardState>) => void;
  courts: { id: number; name: string; type: string }[];
}) {
  const toggle = (id: number) => {
    const next = state.courtIds.includes(id)
      ? state.courtIds.filter((c) => c !== id)
      : [...state.courtIds, id];
    onChange({ courtIds: next });
  };

  const allSelected = courts.length > 0 && courts.every((c) => state.courtIds.includes(c.id));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-1">Which courts?</h2>
        <p className="text-sm text-muted-foreground">Select one or more courts to block. All selected courts will get the same block(s).</p>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => onChange({ courtIds: allSelected ? [] : courts.map((c) => c.id) })}
          className="text-xs text-primary hover:underline"
        >
          {allSelected ? "Deselect all" : "Select all"}
        </button>
      </div>

      <div className="space-y-3">
        {courts.map((court) => {
          const selected = state.courtIds.includes(court.id);
          return (
            <button
              key={court.id}
              type="button"
              onClick={() => toggle(court.id)}
              className={`w-full flex items-center gap-4 p-4 rounded-xl border text-left transition-all ${
                selected
                  ? "border-primary bg-primary/10 ring-1 ring-primary"
                  : "border-border bg-card hover:border-primary/40"
              }`}
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${selected ? "bg-primary/20" : "bg-muted"}`}>
                <Building2 className={`h-5 w-5 ${selected ? "text-primary" : "text-muted-foreground"}`} />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-foreground">{court.name}</p>
                <p className="text-xs text-muted-foreground capitalize">{court.type.replace("_", " ")}</p>
              </div>
              {selected && <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />}
            </button>
          );
        })}
      </div>

      {state.courtIds.length === 0 && (
        <p className="text-xs text-amber-400">Select at least one court to continue.</p>
      )}
    </div>
  );
}

// ─── Step 2: Dates & Times ────────────────────────────────────────────────────

function Step2DatesAndTimes({ state, onChange }: {
  state: WizardState;
  onChange: (u: Partial<WizardState>) => void;
}) {
  const addDate = (d: string) => {
    if (!d || state.specificDates.includes(d)) return;
    onChange({ specificDates: [...state.specificDates, d].sort() });
  };

  const removeDate = (d: string) => onChange({ specificDates: state.specificDates.filter((x) => x !== d) });

  const addSlot = () => {
    onChange({
      timeSlots: [...state.timeSlots, { key: uid(), allDay: false, startTime: "08:00", endTime: "17:00" }],
    });
  };

  const updateSlot = (key: string, patch: Partial<TimeSlot>) => {
    onChange({ timeSlots: state.timeSlots.map((s) => s.key === key ? { ...s, ...patch } : s) });
  };

  const removeSlot = (key: string) => {
    if (state.timeSlots.length === 1) return;
    onChange({ timeSlots: state.timeSlots.filter((s) => s.key !== key) });
  };

  // Compute effective date list for preview
  const effectiveDates: string[] = state.dateMode === "range"
    ? (state.dateFrom && state.dateTo && state.dateFrom <= state.dateTo
        ? eachDayOfInterval({ start: parseISO(state.dateFrom), end: parseISO(state.dateTo) }).map((d) => format(d, "yyyy-MM-dd"))
        : [])
    : state.specificDates;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-1">When?</h2>
        <p className="text-sm text-muted-foreground">Pick the dates and time windows to block.</p>
      </div>

      {/* Date mode toggle */}
      <div>
        <Label className="text-sm font-medium mb-2 block">Date selection</Label>
        <div className="flex gap-2">
          {(["range", "specific"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onChange({ dateMode: mode })}
              className={`px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
                state.dateMode === mode
                  ? "border-primary bg-primary/10 text-foreground ring-1 ring-primary"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {mode === "range" ? "Date range" : "Specific dates"}
            </button>
          ))}
        </div>
      </div>

      {/* Date inputs */}
      {state.dateMode === "range" ? (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-sm font-medium">From <span className="text-red-400">*</span></Label>
            <Input
              type="date"
              value={state.dateFrom}
              onChange={(e) => onChange({ dateFrom: e.target.value })}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label className="text-sm font-medium">To <span className="text-red-400">*</span></Label>
            <Input
              type="date"
              value={state.dateTo}
              min={state.dateFrom}
              onChange={(e) => onChange({ dateTo: e.target.value })}
              className="mt-1.5"
            />
          </div>
        </div>
      ) : (
        <div>
          <Label className="text-sm font-medium mb-2 block">Add specific dates</Label>
          <div className="flex gap-2 mb-3">
            <Input
              type="date"
              className="flex-1"
              onChange={(e) => { addDate(e.target.value); e.target.value = ""; }}
            />
          </div>
          {state.specificDates.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {state.specificDates.map((d) => (
                <div key={d} className="flex items-center gap-1.5 bg-primary/10 border border-primary/20 rounded-lg px-3 py-1.5 text-sm">
                  <CalendarDays className="h-3.5 w-3.5 text-primary" />
                  <span className="text-foreground font-medium">{format(parseISO(d), "EEE, MMM d")}</span>
                  <button type="button" onClick={() => removeDate(d)} className="text-muted-foreground hover:text-red-400 ml-1 transition-colors">×</button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No dates added yet.</p>
          )}
        </div>
      )}

      {/* Time slots */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <Label className="text-sm font-medium">Time windows</Label>
          <button type="button" onClick={addSlot} className="text-xs text-primary hover:underline flex items-center gap-1">
            <Plus className="h-3 w-3" /> Add another window
          </button>
        </div>

        <div className="space-y-3">
          {state.timeSlots.map((slot, i) => (
            <div key={slot.key} className="border border-border rounded-xl p-4 space-y-3 bg-card">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">Window {i + 1}</span>
                {state.timeSlots.length > 1 && (
                  <button type="button" onClick={() => removeSlot(slot.key)} className="text-muted-foreground hover:text-red-400 transition-colors">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={slot.allDay}
                  onChange={(e) => updateSlot(slot.key, { allDay: e.target.checked })}
                  className="rounded accent-primary"
                />
                <span className="text-sm text-foreground">All day</span>
              </label>

              {!slot.allDay && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Start time</Label>
                    <Input
                      type="time"
                      value={slot.startTime}
                      onChange={(e) => updateSlot(slot.key, { startTime: e.target.value })}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">End time</Label>
                    <Input
                      type="time"
                      value={slot.endTime}
                      onChange={(e) => updateSlot(slot.key, { endTime: e.target.value })}
                      className="mt-1"
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Preview count */}
      {effectiveDates.length > 0 && (
        <div className="bg-muted/40 rounded-xl px-4 py-3 text-sm text-muted-foreground">
          <Clock className="h-4 w-4 inline mr-1.5 text-primary" />
          This will create <strong className="text-foreground">{effectiveDates.length * state.timeSlots.length * (state.courtIds.length || 1)} block(s)</strong>
          {" "}across {effectiveDates.length} date{effectiveDates.length !== 1 ? "s" : ""}, {state.timeSlots.length} time window{state.timeSlots.length !== 1 ? "s" : ""}, and {state.courtIds.length || 1} court{(state.courtIds.length || 1) !== 1 ? "s" : ""}.
        </div>
      )}
    </div>
  );
}

// ─── Step 3: Details ──────────────────────────────────────────────────────────

function Step3Details({ state, onChange }: {
  state: WizardState;
  onChange: (u: Partial<WizardState>) => void;
}) {
  const PRESETS = ["Maintenance", "Private event", "Holiday", "External booking", "Staff training", "Facility closed"];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-1">Reason & notes</h2>
        <p className="text-sm text-muted-foreground">Help your team understand why these courts are blocked.</p>
      </div>

      <div>
        <Label className="text-sm font-medium">Reason <span className="text-red-400">*</span></Label>
        <Input
          value={state.reason}
          onChange={(e) => onChange({ reason: e.target.value })}
          placeholder="e.g. Facility maintenance, Private event…"
          className="mt-1.5"
        />
        <div className="flex flex-wrap gap-2 mt-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onChange({ reason: p })}
              className={`px-3 py-1 rounded-full text-xs border transition-all ${
                state.reason === p
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div>
        <Label className="text-sm font-medium">Internal notes</Label>
        <Input
          value={state.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          placeholder="Optional — only visible to admins"
          className="mt-1.5"
        />
      </div>

      <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-3 flex gap-3">
        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
        <p className="text-sm text-amber-600 dark:text-amber-400">
          Blocking courts does not auto-cancel existing fixtures. Cross-offering conflict enforcement prevents <em>new</em> bookings during this period.
        </p>
      </div>
    </div>
  );
}

// ─── Step 4: Review ───────────────────────────────────────────────────────────

function Step4Review({ state, courts }: {
  state: WizardState;
  courts: { id: number; name: string }[];
}) {
  const effectiveDates: string[] = state.dateMode === "range"
    ? (state.dateFrom && state.dateTo && state.dateFrom <= state.dateTo
        ? eachDayOfInterval({ start: parseISO(state.dateFrom), end: parseISO(state.dateTo) }).map((d) => format(d, "yyyy-MM-dd"))
        : [])
    : state.specificDates;

  const totalBlocks = effectiveDates.length * state.timeSlots.length * state.courtIds.length;
  const selectedCourtNames = state.courtIds.map((id) => courts.find((c) => c.id === id)?.name ?? `Court ${id}`);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-1">Review blocks</h2>
        <p className="text-sm text-muted-foreground">Confirm everything looks right before creating the blocks.</p>
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden divide-y divide-border">
        <Row label="Courts" value={selectedCourtNames.join(", ")} />
        <Row
          label="Dates"
          value={
            state.dateMode === "range"
              ? `${format(parseISO(state.dateFrom), "MMM d")} – ${format(parseISO(state.dateTo), "MMM d, yyyy")} (${effectiveDates.length} day${effectiveDates.length !== 1 ? "s" : ""})`
              : `${effectiveDates.length} specific date${effectiveDates.length !== 1 ? "s" : ""}`
          }
        />
        <Row
          label="Time windows"
          value={state.timeSlots.map((s) =>
            s.allDay ? "All day" : `${fmt12(s.startTime)} – ${fmt12(s.endTime)}`
          ).join(" · ")}
        />
        <Row label="Reason" value={state.reason} />
        {state.notes && <Row label="Notes" value={state.notes} />}
      </div>

      {/* Per-date preview (collapsed if many) */}
      {effectiveDates.length > 0 && effectiveDates.length <= 14 && (
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Dates being blocked</p>
          <div className="flex flex-wrap gap-2">
            {effectiveDates.map((d) => (
              <span key={d} className="text-xs bg-destructive/10 border border-destructive/20 text-destructive rounded-lg px-2.5 py-1 font-medium">
                {format(parseISO(d), "EEE, MMM d")}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="bg-destructive/10 border border-destructive/20 rounded-xl px-5 py-4 flex gap-3 items-start">
        <Lock className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
        <p className="text-sm text-destructive font-medium">
          This will create <strong>{totalBlocks} block{totalBlocks !== 1 ? "s" : ""}</strong> across {state.courtIds.length} court{state.courtIds.length !== 1 ? "s" : ""}.
          New bookings will be prevented during these periods.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between px-5 py-3.5 gap-4">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <span className="text-sm font-medium text-foreground text-right">{value || "—"}</span>
    </div>
  );
}

function fmt12(t: string): string {
  if (!t) return t;
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

// ─── Main Wizard ──────────────────────────────────────────────────────────────

export default function BlockCourtWizard() {
  const { data: profile, isLoading } = useGetMyProfile();
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(DEFAULT);
  const [submitting, setSubmitting] = useState(false);
  const [, setLocation] = useLocation();
  const { getToken } = useAuth();
  const { toast } = useToast();

  const { data: courts = [] } = useQuery<{ id: number; name: string; type: string }[]>({
    queryKey: ["courts"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/courts`, { headers: { Authorization: `Bearer ${token}` } });
      return res.json();
    },
    enabled: !!profile,
  });

  const onChange = (updates: Partial<WizardState>) => setState((prev) => ({ ...prev, ...updates }));

  const effectiveDates: string[] = state.dateMode === "range"
    ? (state.dateFrom && state.dateTo && state.dateFrom <= state.dateTo
        ? eachDayOfInterval({ start: parseISO(state.dateFrom), end: parseISO(state.dateTo) }).map((d) => format(d, "yyyy-MM-dd"))
        : [])
    : state.specificDates;

  const canProceed =
    step === 0 ? state.courtIds.length > 0
    : step === 1 ? effectiveDates.length > 0 && state.timeSlots.length > 0
    : step === 2 ? state.reason.trim().length > 0
    : true;

  const handlePublish = async () => {
    setSubmitting(true);
    try {
      const token = await getToken();
      const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
      let created = 0;
      let failed = 0;

      for (const courtId of state.courtIds) {
        for (const date of effectiveDates) {
          for (const slot of state.timeSlots) {
            const startsAt = slot.allDay
              ? toEasternISOString(`${date}T00:00`)
              : toEasternISOString(`${date}T${slot.startTime}`);
            const endsAt = slot.allDay
              ? toEasternISOString(`${date}T23:59`)
              : toEasternISOString(`${date}T${slot.endTime}`);

            const res = await fetch(`${API_BASE}/court-availability/blocks`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                courtId,
                startsAt,
                endsAt,
                reason: state.reason || undefined,
                notes: state.notes || undefined,
              }),
            });
            if (res.ok) created++; else failed++;
          }
        }
      }

      if (failed > 0) {
        toast({ title: `${created} block(s) created, ${failed} failed`, variant: "destructive" });
      } else {
        toast({ title: `${created} block${created !== 1 ? "s" : ""} created`, description: "Courts are now blocked for the selected periods." });
      }
      setLocation("/admin/court-calendar");
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) return null;
  if (!profile || (profile.role !== "admin" && profile.role !== "staff")) return <Redirect to="/" />;

  return (
    <WizardShell
      title="Block Courts"
      backHref="/admin/court-calendar"
      steps={STEPS}
      step={step}
      setStep={setStep}
      canProceed={canProceed}
      isLastStep={step === STEPS.length - 1}
      onPublish={handlePublish}
      publishLabel={submitting ? "Blocking…" : "Block Courts"}
      publishDisabled={submitting}
    >
      {step === 0 && <Step1Courts state={state} onChange={onChange} courts={courts} />}
      {step === 1 && <Step2DatesAndTimes state={state} onChange={onChange} />}
      {step === 2 && <Step3Details state={state} onChange={onChange} />}
      {step === 3 && <Step4Review state={state} courts={courts} />}
    </WizardShell>
  );
}
