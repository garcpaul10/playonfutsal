/**
 * 5-Step Camp Creation Wizard
 *
 * Step 1: Basics       — name, sport, venue, description, image
 * Step 2: Schedule     — camp day builder (date, start time, end time, notes)
 * Step 3: Participants — age groups, max cap, gender, price, court
 * Step 4: Staff        — coach assignment (search staff, set role + compensation)
 * Step 5: Review       — conflict check + Publish / Schedule / Save Draft
 *
 * Draft semantics: "Save as Draft" persists wizard state only
 * (localStorage + backend draft store) — no camp record is created.
 * "Publish Now" and "Schedule Publish" create the real camp record.
 */

import React, { useState, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { useAdminPermissions } from "@/hooks/use-admin-permissions";
import { useAuth } from "@clerk/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useDraftAutosave } from "@/hooks/use-draft-autosave";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Plus, Trash2, Calendar, Pencil } from "lucide-react";
import { AGE_GROUPS } from "@workspace/brand";
import { format, parseISO } from "date-fns";
import { Layout } from "@/components/layout";
import { WizardShell } from "@/components/admin/WizardShell";

import { API_BASE as API } from "@/lib/api-base";

function useAuthHeaders() {
  const { getToken } = useAuth();
  return useCallback(async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  }, [getToken]);
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SPORTS = [
  { value: "basketball", label: "🏀 Basketball" },
  { value: "soccer", label: "⚽ Soccer" },
  { value: "futsal", label: "⚽ Futsal" },
  { value: "volleyball", label: "🏐 Volleyball" },
  { value: "tennis", label: "🎾 Tennis" },
  { value: "pickleball", label: "🏓 Pickleball" },
  { value: "badminton", label: "🏸 Badminton" },
  { value: "hockey", label: "🏒 Hockey" },
  { value: "baseball", label: "⚾ Baseball" },
  { value: "other", label: "🏃 Other" },
];

const GENDER_OPTIONS = [
  { value: "", label: "Any / Coed" },
  { value: "boy", label: "Boys" },
  { value: "girl", label: "Girls" },
  { value: "men", label: "Men" },
  { value: "women", label: "Women" },
  { value: "coed", label: "Coed" },
];

const COACH_ROLES = [
  { value: "coach", label: "Head Coach" },
  { value: "assistant_coach", label: "Assistant Coach" },
  { value: "supervisor", label: "Supervisor" },
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface CampDayEntry {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  notes: string;
}

interface CoachEntry {
  id: string;
  staffUserId: string;
  role: string;
  compensationAmount: string;
}

export interface CampWizardState {
  name: string;
  sport: string;
  venueId: string;
  description: string;
  imageUrl: string;
  days: CampDayEntry[];
  ageGroup: string[];
  maxParticipants: string;
  gender: string;
  price: string;
  registrationOpen: boolean;
  registrationDeadline: string;
  coaches: CoachEntry[];
  courtId: string;
}

function uid() {
  return Math.random().toString(36).slice(2);
}

function defaultState(): CampWizardState {
  return {
    name: "",
    sport: "soccer",
    venueId: "",
    description: "",
    imageUrl: "",
    days: [],
    ageGroup: ["u8_u11"],
    maxParticipants: "20",
    gender: "",
    price: "0",
    registrationOpen: false,
    registrationDeadline: "",
    coaches: [],
    courtId: "",
  };
}

// ─── Step 1 — Basics ──────────────────────────────────────────────────────────

function Step1Basics({ state, onChange, venues }: {
  state: CampWizardState;
  onChange: (s: Partial<CampWizardState>) => void;
  venues: any[];
}) {
  return (
    <div className="space-y-5">
      <div>
        <Label>Camp Name</Label>
        <Input
          className="mt-1"
          placeholder="e.g. Summer Futsal Camp 2026"
          value={state.name}
          onChange={e => onChange({ name: e.target.value })}
          required
        />
        <p className="text-xs text-muted-foreground mt-1">This is what players see when browsing camps.</p>
      </div>

      <div>
        <Label>Sport</Label>
        <div className="grid grid-cols-3 gap-2 mt-2">
          {SPORTS.map(s => (
            <button
              key={s.value}
              type="button"
              onClick={() => onChange({ sport: s.value })}
              className={`text-sm py-2 px-3 rounded-lg border transition-colors text-left ${
                state.sport === s.value ? "border-primary bg-primary/10 text-primary font-semibold" : "border-input hover:bg-muted"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <Label>Venue / Facility</Label>
        <select
          className="w-full h-10 rounded border border-input bg-background px-3 text-sm mt-1"
          value={state.venueId}
          onChange={e => onChange({ venueId: e.target.value })}
        >
          <option value="">Select venue (optional)</option>
          {venues.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </div>

      <div>
        <Label>Description (optional)</Label>
        <Textarea
          className="mt-1 resize-none"
          rows={3}
          placeholder="What players and parents should know — schedule overview, what to bring, skill level expectations…"
          value={state.description}
          onChange={e => onChange({ description: e.target.value })}
        />
      </div>

      <div>
        <Label>Card Image URL (optional)</Label>
        <Input
          className="mt-1"
          placeholder="https://example.com/image.jpg"
          value={state.imageUrl}
          onChange={e => onChange({ imageUrl: e.target.value })}
        />
        <p className="text-xs text-muted-foreground mt-1">Paste a public image URL. Appears on the camp listing card.</p>
        {state.imageUrl && (
          <img
            src={state.imageUrl}
            alt="Card preview"
            className="mt-2 h-28 w-full object-cover rounded-lg border"
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            onLoad={e => { (e.currentTarget as HTMLImageElement).style.display = "block"; }}
          />
        )}
      </div>
    </div>
  );
}

// ─── Step 2 — Schedule ────────────────────────────────────────────────────────

function Step2Schedule({ state, onChange }: {
  state: CampWizardState;
  onChange: (s: Partial<CampWizardState>) => void;
}) {
  const [newDay, setNewDay] = useState({ date: "", startTime: "09:00", endTime: "17:00", notes: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDay, setEditDay] = useState({ date: "", startTime: "09:00", endTime: "17:00", notes: "" });

  function addDay() {
    if (!newDay.date) return;
    const entry: CampDayEntry = { id: uid(), ...newDay };
    const sorted = [...state.days, entry].sort((a, b) => a.date.localeCompare(b.date));
    onChange({ days: sorted });
    setNewDay({ date: "", startTime: "09:00", endTime: "17:00", notes: "" });
  }

  function removeDay(id: string) {
    onChange({ days: state.days.filter(d => d.id !== id) });
  }

  function startEdit(d: CampDayEntry) {
    setEditingId(d.id);
    setEditDay({ date: d.date, startTime: d.startTime, endTime: d.endTime, notes: d.notes });
  }

  function saveEdit(id: string) {
    const updated = state.days.map(d => d.id === id ? { ...d, ...editDay } : d)
      .sort((a, b) => a.date.localeCompare(b.date));
    onChange({ days: updated });
    setEditingId(null);
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">Add each day of the camp individually. Days are sorted by date automatically.</p>

      <Card className="p-4 space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Add a Camp Day</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label className="text-xs">Date</Label>
            <Input type="date" className="h-8 text-sm mt-0.5" value={newDay.date} onChange={e => setNewDay(d => ({ ...d, date: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs">Start Time</Label>
            <Input type="time" className="h-8 text-sm mt-0.5" value={newDay.startTime} onChange={e => setNewDay(d => ({ ...d, startTime: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs">End Time</Label>
            <Input type="time" className="h-8 text-sm mt-0.5" value={newDay.endTime} onChange={e => setNewDay(d => ({ ...d, endTime: e.target.value }))} />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Notes (optional)</Label>
            <Input className="h-8 text-sm mt-0.5" placeholder="e.g. Bring cleats, indoor session" value={newDay.notes} onChange={e => setNewDay(d => ({ ...d, notes: e.target.value }))} />
          </div>
        </div>
        <Button type="button" size="sm" onClick={addDay} disabled={!newDay.date} className="w-full">
          <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Day
        </Button>
      </Card>

      {state.days.length === 0 ? (
        <div className="text-center py-8 border border-dashed rounded-lg text-muted-foreground text-sm">
          No camp days added yet. Add at least one day above.
        </div>
      ) : (
        <div className="space-y-2">
          {state.days.map(day => (
            <div key={day.id} className="border rounded-lg bg-background overflow-hidden">
              {editingId === day.id ? (
                <div className="p-3 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="col-span-2">
                      <Label className="text-xs">Date</Label>
                      <Input type="date" className="h-7 text-xs mt-0.5" value={editDay.date} onChange={e => setEditDay(d => ({ ...d, date: e.target.value }))} />
                    </div>
                    <div>
                      <Label className="text-xs">Start</Label>
                      <Input type="time" className="h-7 text-xs mt-0.5" value={editDay.startTime} onChange={e => setEditDay(d => ({ ...d, startTime: e.target.value }))} />
                    </div>
                    <div>
                      <Label className="text-xs">End</Label>
                      <Input type="time" className="h-7 text-xs mt-0.5" value={editDay.endTime} onChange={e => setEditDay(d => ({ ...d, endTime: e.target.value }))} />
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs">Notes</Label>
                      <Input className="h-7 text-xs mt-0.5" value={editDay.notes} onChange={e => setEditDay(d => ({ ...d, notes: e.target.value }))} />
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditingId(null)}>Cancel</Button>
                    <Button size="sm" className="h-7 text-xs" onClick={() => saveEdit(day.id)}>Save</Button>
                  </div>
                </div>
              ) : (
                <div className="p-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Calendar className="h-4 w-4 text-primary flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{format(parseISO(day.date + "T12:00:00"), "EEE, MMM d, yyyy")}</p>
                      <p className="text-xs text-muted-foreground">
                        {day.startTime} – {day.endTime}
                        {day.notes && <span className="ml-1.5">· {day.notes}</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => startEdit(day)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => removeDay(day.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
          <p className="text-xs text-muted-foreground text-right">{state.days.length} day{state.days.length !== 1 ? "s" : ""} total</p>
        </div>
      )}
    </div>
  );
}

// ─── Step 3 — Participants ─────────────────────────────────────────────────────

function Step3Participants({ state, onChange, courts }: {
  state: CampWizardState;
  onChange: (s: Partial<CampWizardState>) => void;
  courts: any[];
}) {
  return (
    <div className="space-y-5">
      <div>
        <Label className="text-sm font-semibold">Age Group</Label>
        <p className="text-xs text-muted-foreground mt-0.5">Select all age groups this camp is open to.</p>
        <div className="flex flex-wrap gap-x-5 gap-y-2 mt-2">
          {AGE_GROUPS.map(ag => (
            <label key={ag.value} className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={state.ageGroup.includes(ag.value)}
                onChange={e => {
                  let next: string[];
                  if (e.target.checked) {
                    next = ag.value === "all_ages"
                      ? ["all_ages"]
                      : [...state.ageGroup.filter(g => g !== "all_ages"), ag.value];
                  } else {
                    next = state.ageGroup.filter(g => g !== ag.value);
                  }
                  if (next.length > 0) onChange({ ageGroup: next });
                }}
                className="h-4 w-4 accent-primary"
              />
              {ag.label}
            </label>
          ))}
        </div>
        {state.ageGroup.length === 0 && (
          <p className="text-xs text-destructive mt-1">Select at least one age group.</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Max Participants</Label>
          <Input type="number" min="1" className="mt-1" value={state.maxParticipants} onChange={e => onChange({ maxParticipants: e.target.value })} />
          <p className="text-xs text-muted-foreground mt-1">Total spots across all registered campers.</p>
        </div>
        <div>
          <Label>Gender</Label>
          <select className="w-full h-10 rounded border border-input bg-background px-3 text-sm mt-1" value={state.gender} onChange={e => onChange({ gender: e.target.value })}>
            {GENDER_OPTIONS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Camp Price ($)</Label>
          <Input type="number" step="0.01" min="0" className="mt-1" value={state.price} onChange={e => onChange({ price: e.target.value })} />
          <p className="text-xs text-muted-foreground mt-1">Per-participant fee. Set 0 for free.</p>
        </div>
        <div>
          <Label>Court / Facility Area</Label>
          <select className="w-full h-10 rounded border border-input bg-background px-3 text-sm mt-1" value={state.courtId} onChange={e => onChange({ courtId: e.target.value })}>
            <option value="">Select court…</option>
            {courts.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <p className="text-xs text-muted-foreground mt-1">Primary court or field for this camp.</p>
        </div>
      </div>

      <div className="space-y-3">
        <Label className="text-sm font-semibold">Registration</Label>
        <label className="flex items-center gap-2 cursor-pointer text-sm">
          <input type="checkbox" checked={state.registrationOpen} onChange={e => onChange({ registrationOpen: e.target.checked })} className="h-4 w-4 accent-primary" />
          Open registration immediately on publish
        </label>
        <div>
          <Label className="text-xs">Registration Deadline (optional)</Label>
          <Input type="datetime-local" className="h-8 text-sm mt-0.5" value={state.registrationDeadline} onChange={e => onChange({ registrationDeadline: e.target.value })} />
          <p className="text-xs text-muted-foreground mt-0.5">Leave blank for no deadline.</p>
        </div>
      </div>
    </div>
  );
}

// ─── Step 4 — Staff ───────────────────────────────────────────────────────────

function Step4Staff({ state, onChange }: {
  state: CampWizardState;
  onChange: (s: Partial<CampWizardState>) => void;
}) {
  const getHeaders = useAuthHeaders();
  const { data: staff = [] } = useQuery({
    queryKey: ["staff-list"],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/staff-profiles`, { headers });
      return r.ok ? r.json() : [];
    },
  });

  const [newCoach, setNewCoach] = useState({ staffUserId: "", role: "coach", compensationAmount: "" });

  function addCoach() {
    if (!newCoach.staffUserId) return;
    const entry: CoachEntry = { id: uid(), ...newCoach };
    onChange({ coaches: [...state.coaches, entry] });
    setNewCoach({ staffUserId: "", role: "coach", compensationAmount: "" });
  }

  function removeCoach(id: string) {
    onChange({ coaches: state.coaches.filter(c => c.id !== id) });
  }

  function staffName(userId: string) {
    const s = (staff as any[]).find(s => String(s.id) === userId || String(s.userId) === userId);
    if (!s) return `Staff #${userId}`;
    return `${s.firstName || s.user?.firstName || ""} ${s.lastName || s.user?.lastName || ""}`.trim() || s.email || s.user?.email || `Staff #${userId}`;
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">Assign coaches to this camp. You can add more after creation too.</p>

      <Card className="p-4 space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Add Coach</p>
        <div className="grid grid-cols-1 gap-3">
          <div>
            <Label className="text-xs">Staff Member</Label>
            <select className="w-full h-8 rounded border border-input bg-background px-2 text-sm mt-0.5" value={newCoach.staffUserId} onChange={e => setNewCoach(c => ({ ...c, staffUserId: e.target.value }))}>
              <option value="">Select staff member…</option>
              {(staff as any[]).map((s: any) => {
                const name = `${s.firstName || s.user?.firstName || ""} ${s.lastName || s.user?.lastName || ""}`.trim() || s.email || s.user?.email || `#${s.id}`;
                const uid = s.userId ?? s.id;
                return <option key={uid} value={uid}>{name}</option>;
              })}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Role</Label>
              <select className="w-full h-8 rounded border border-input bg-background px-2 text-sm mt-0.5" value={newCoach.role} onChange={e => setNewCoach(c => ({ ...c, role: e.target.value }))}>
                {COACH_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">Compensation ($)</Label>
              <Input type="number" step="0.01" min="0" className="h-8 text-sm mt-0.5" placeholder="0.00" value={newCoach.compensationAmount} onChange={e => setNewCoach(c => ({ ...c, compensationAmount: e.target.value }))} />
            </div>
          </div>
          <Button type="button" size="sm" onClick={addCoach} disabled={!newCoach.staffUserId} className="w-full">
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Coach
          </Button>
        </div>
      </Card>

      {state.coaches.length === 0 ? (
        <div className="text-center py-8 border border-dashed rounded-lg text-muted-foreground text-sm">
          No coaches assigned. You can skip this step and assign coaches later.
        </div>
      ) : (
        <div className="space-y-2">
          {state.coaches.map(c => (
            <div key={c.id} className="border rounded-lg p-3 flex items-center justify-between gap-3 bg-background">
              <div className="min-w-0">
                <p className="text-sm font-medium">{staffName(c.staffUserId)}</p>
                <div className="flex gap-2 mt-0.5">
                  <Badge variant="secondary" className="text-xs capitalize">{c.role.replace("_", " ")}</Badge>
                  {c.compensationAmount && Number(c.compensationAmount) > 0 && (
                    <Badge variant="outline" className="text-xs">${Number(c.compensationAmount).toFixed(2)}</Badge>
                  )}
                </div>
              </div>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive flex-shrink-0" onClick={() => removeCoach(c.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Step 5 — Review ──────────────────────────────────────────────────────────

function Step5Review({ state, courts, venues }: {
  state: CampWizardState;
  courts: any[];
  venues: any[];
}) {
  const getHeaders = useAuthHeaders();
  const [conflictWarnings, setConflictWarnings] = useState<string[]>([]);

  useEffect(() => {
    if (!state.courtId || state.days.length === 0) return;
    let cancelled = false;
    async function check() {
      const warnings: string[] = [];
      const headers = await getHeaders();
      for (const day of state.days) {
        try {
          const startsAt = `${day.date}T${day.startTime}:00`;
          const [sh, sm] = day.startTime.split(":").map(Number);
          const [eh, em] = day.endTime.split(":").map(Number);
          const duration = (eh * 60 + em) - (sh * 60 + sm);
          const r = await fetch(
            `${API}/courts/${state.courtId}/conflicts?startsAt=${encodeURIComponent(startsAt)}&duration=${duration}`,
            { headers }
          );
          if (r.ok) {
            const data = await r.json();
            if (data.hasConflict) {
              const courtName = courts.find((c: any) => String(c.id) === state.courtId)?.name ?? `Court ${state.courtId}`;
              warnings.push(`${courtName} has a conflict on ${format(parseISO(day.date + "T12:00:00"), "MMM d")} at ${day.startTime}`);
            }
          }
        } catch {}
      }
      if (!cancelled) setConflictWarnings(warnings);
    }
    check();
    return () => { cancelled = true; };
  }, [state.courtId, state.days]);

  const venueName = venues.find((v: any) => String(v.id) === state.venueId)?.name ?? "";
  const courtName = courts.find((c: any) => String(c.id) === state.courtId)?.name ?? "";
  const dateRange = state.days.length > 0
    ? `${format(parseISO(state.days[0].date + "T12:00:00"), "MMM d")} – ${format(parseISO(state.days[state.days.length - 1].date + "T12:00:00"), "MMM d, yyyy")}`
    : "No days set";

  const missingRequired: string[] = [];
  if (!state.name.trim()) missingRequired.push("Camp name");
  if (state.days.length === 0) missingRequired.push("At least one camp day");
  if (state.ageGroup.length === 0) missingRequired.push("At least one age group");
  if (!state.courtId) missingRequired.push("Court / facility area");

  return (
    <div className="space-y-5">
      {missingRequired.length > 0 && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 space-y-1">
          <p className="text-xs font-semibold text-destructive uppercase tracking-wide">Required fields missing</p>
          {missingRequired.map((m, i) => <p key={i} className="text-xs text-destructive">• {m}</p>)}
          <p className="text-xs text-muted-foreground mt-1">Go back and fill in the required fields before publishing.</p>
        </div>
      )}

      {conflictWarnings.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-1">
          <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide">⚠ Scheduling Conflicts Detected</p>
          {conflictWarnings.map((w, i) => <p key={i} className="text-xs text-amber-700">{w}</p>)}
          <p className="text-xs text-muted-foreground mt-1">You can still save as draft and resolve conflicts before publishing.</p>
        </div>
      )}

      <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
        {state.imageUrl && (
          <img src={state.imageUrl} alt="" className="h-24 w-full object-cover rounded-lg border"
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
        )}
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Camp</p>
          <p className="text-base font-bold mt-0.5">{state.name || <span className="italic text-muted-foreground">Untitled</span>}</p>
          <div className="flex flex-wrap gap-2 mt-1">
            <Badge variant="outline" className="text-xs">{SPORTS.find(s => s.value === state.sport)?.label ?? state.sport}</Badge>
            {venueName && <Badge variant="outline" className="text-xs">{venueName}</Badge>}
            {state.gender && <Badge variant="outline" className="text-xs capitalize">{state.gender}</Badge>}
          </div>
          {state.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{state.description}</p>}
        </div>

        <div className="border-t pt-2">
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Schedule</p>
          <p className="text-sm mt-0.5">{dateRange}</p>
          <p className="text-xs text-muted-foreground">{state.days.length} day{state.days.length !== 1 ? "s" : ""}</p>
          {state.days.slice(0, 3).map(d => (
            <p key={d.id} className="text-xs text-muted-foreground">
              {format(parseISO(d.date + "T12:00:00"), "EEE MMM d")} · {d.startTime}–{d.endTime}
              {d.notes && ` · ${d.notes}`}
            </p>
          ))}
          {state.days.length > 3 && <p className="text-xs text-muted-foreground">…and {state.days.length - 3} more days</p>}
        </div>

        <div className="border-t pt-2">
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Participants</p>
          <p className="text-sm mt-0.5">{state.ageGroup.join(", ")} · Max {state.maxParticipants} participants</p>
          <p className="text-xs text-muted-foreground">
            {Number(state.price) > 0 ? `$${Number(state.price).toFixed(2)} per camper` : "Free"}
            {courtName && ` · ${courtName}`}
            {state.registrationOpen ? " · Registration open on publish" : ""}
          </p>
        </div>

        {state.coaches.length > 0 && (
          <div className="border-t pt-2">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Staff ({state.coaches.length})</p>
            {state.coaches.map(c => (
              <p key={c.id} className="text-sm mt-0.5 capitalize">
                {c.role.replace("_", " ")}
                {c.compensationAmount && Number(c.compensationAmount) > 0 && ` · $${Number(c.compensationAmount).toFixed(2)}`}
              </p>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}

// ─── Main Wizard ──────────────────────────────────────────────────────────────

const STEPS = ["Basics", "Schedule", "Participants", "Staff", "Review"];
const AUTOSAVE_KEY = "camp_wizard_draft_v1";
const AUTOSAVE_ID_KEY = "camp_wizard_draft_id_v1";

export default function CampNewWizard() {
  const { canManageCamps } = useAdminPermissions();
  const getHeaders = useAuthHeaders();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [step, setStep] = useState(0);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [scheduledPublishAt, setScheduledPublishAt] = useState("");

  // Initialize state from localStorage (draft restore)
  const [state, setState] = useState<CampWizardState>(() => {
    try {
      const saved = localStorage.getItem(AUTOSAVE_KEY);
      if (saved) return { ...defaultState(), ...JSON.parse(saved) };
    } catch {}
    return defaultState();
  });

  // Shared autosave hook: localStorage + remote draft backend
  const { restoredFromDraft, clearDraft, publishedRef, remoteRestoreState } = useDraftAutosave({
    localStorageKey: AUTOSAVE_KEY,
    draftIdKey: AUTOSAVE_ID_KEY,
    remoteDraftBaseUrl: `${API}/camps/drafts`,
    state,
    getHeaders,
  });

  // Apply remote restore state as authoritative (replaces local state entirely, applied once)
  useEffect(() => {
    if (remoteRestoreState) {
      setState({ ...defaultState(), ...remoteRestoreState });
    }
  // remoteRestoreState arrives exactly once from the hook on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteRestoreState]);

  function onChange(updates: Partial<CampWizardState>) {
    setState(prev => ({ ...prev, ...updates }));
  }

  const { data: venues = [] } = useQuery({
    queryKey: ["venues"],
    queryFn: async () => { const r = await fetch(`${API}/venues`); return r.ok ? r.json() : []; },
  });

  const { data: courts = [] } = useQuery({
    queryKey: ["courts"],
    queryFn: async () => { const r = await fetch(`${API}/courts`); return r.ok ? r.json() : []; },
  });

  // Build camp payload and create via API
  async function createCamp(opts: { registrationOpen: boolean }) {
    const headers = await getHeaders();
    const sortedDays = [...state.days].sort((a, b) => a.date.localeCompare(b.date));
    const startDate = sortedDays[0]?.date ?? null;
    const endDate = sortedDays[sortedDays.length - 1]?.date ?? null;
    const startsAt = startDate && sortedDays[0]?.startTime ? `${startDate}T${sortedDays[0].startTime}:00` : null;
    const endsAt = endDate && sortedDays[sortedDays.length - 1]?.endTime
      ? `${endDate}T${sortedDays[sortedDays.length - 1].endTime}:00`
      : null;

    const campRes = await fetch(`${API}/camps`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: state.name,
        ageGroup: state.ageGroup,
        gender: state.gender || null,
        courtId: Number(state.courtId),
        status: "upcoming",
        price: state.price,
        maxParticipants: Number(state.maxParticipants),
        registrationOpen: opts.registrationOpen,
        registrationDeadline: state.registrationDeadline ? new Date(state.registrationDeadline).toISOString() : null,
        startDate,
        endDate,
        startsAt: startsAt ? new Date(startsAt).toISOString() : null,
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
        description: state.description || null,
        imageUrl: state.imageUrl || null,
      }),
    });
    if (!campRes.ok) {
      const err = await campRes.json().catch(() => ({}));
      throw new Error(err.error ?? "Failed to create camp");
    }
    const camp = await campRes.json();

    // Create camp days
    await Promise.all(state.days.map(d =>
      fetch(`${API}/camps/${camp.id}/days`, {
        method: "POST",
        headers,
        body: JSON.stringify({ date: d.date, startTime: d.startTime, endTime: d.endTime, notes: d.notes || null }),
      })
    ));

    // Assign coaches
    await Promise.all(state.coaches.map(c =>
      fetch(`${API}/camps/${camp.id}/coaches`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          staffUserId: Number(c.staffUserId),
          role: c.role,
          compensationAmount: c.compensationAmount || null,
        }),
      })
    ));

    return camp;
  }

  const publish = useMutation({
    mutationFn: () => createCamp({ registrationOpen: state.registrationOpen }),
    onSuccess: () => {
      publishedRef.current = true;
      clearDraft();
      qc.invalidateQueries({ queryKey: ["admin-camps"] });
      toast({ title: "Camp published!", description: "The camp is now live and visible to players." });
      navigate("/admin/camps");
    },
    onError: (e: any) => toast({ title: "Failed to create camp", description: e.message, variant: "destructive" }),
  });

  // Schedule publish: saves state as a draft with scheduledPublishAt set.
  // The API server's 30s scheduler polls the draft store and publishes automatically
  // when the time arrives — no immediate camp record is created.
  const schedulePublish = useMutation({
    mutationFn: async () => {
      if (!scheduledPublishAt) throw new Error("Please pick a date and time");
      const headers = await getHeaders();
      const body = JSON.stringify({ ...state, scheduledPublishAt, registrationOpen: true });
      const r = await fetch(`${API}/camps/drafts`, { method: "POST", headers, body });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to schedule camp");
      }
      return r.json();
    },
    onSuccess: () => {
      publishedRef.current = true;
      clearDraft();
      const dateLabel = new Date(scheduledPublishAt).toLocaleString();
      toast({
        title: "Camp scheduled!",
        description: `The camp will be published automatically at ${dateLabel} with registration open.`,
      });
      navigate("/admin/camps");
    },
    onError: (e: any) => toast({ title: "Failed to schedule camp", description: e.message, variant: "destructive" }),
  });

  // Save Draft: autosave hook has already persisted state to localStorage + remote.
  // Just navigate away — do NOT clear the draft. Only "Discard draft" should clear.
  function handleSaveDraft() {
    toast({ title: "Draft saved!", description: "Your progress is saved. Return here to continue." });
    navigate("/admin/camps");
  }

  if (!canManageCamps) {
    return <Layout><div className="p-8 text-center text-muted-foreground">Access denied.</div></Layout>;
  }

  const isLastStep = step === STEPS.length - 1;
  const canProceed = step === 0 ? !!state.name.trim() : true;
  const isSaving = publish.isPending || schedulePublish.isPending;
  const missingRequired: string[] = [];
  if (!state.name.trim()) missingRequired.push("Camp name");
  if (state.days.length === 0) missingRequired.push("At least one camp day");
  if (state.ageGroup.length === 0) missingRequired.push("At least one age group");
  if (!state.courtId) missingRequired.push("Court / facility area");

  return (
    <>
      <WizardShell
        title="New Camp"
        backHref="/admin/camps"
        steps={STEPS}
        step={step}
        setStep={setStep}
        canProceed={canProceed}
        isLastStep={isLastStep}
        onSaveDraft={state.name.trim() ? handleSaveDraft : undefined}
        isSaving={isSaving}
        restoredFromDraft={restoredFromDraft}
        onDiscardDraft={() => { setState(defaultState()); clearDraft(); }}
        onPublish={isLastStep ? () => publish.mutate() : undefined}
        onSchedulePublish={isLastStep ? () => setScheduleDialogOpen(true) : undefined}
        publishDisabled={isSaving || missingRequired.length > 0}
      >
        {step === 0 && <Step1Basics state={state} onChange={onChange} venues={venues} />}
        {step === 1 && <Step2Schedule state={state} onChange={onChange} />}
        {step === 2 && <Step3Participants state={state} onChange={onChange} courts={courts} />}
        {step === 3 && <Step4Staff state={state} onChange={onChange} />}
        {step === 4 && (
          <Step5Review
            state={state}
            courts={courts}
            venues={venues}
          />
        )}
      </WizardShell>

      {scheduleDialogOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border rounded-xl p-6 w-full max-w-sm space-y-4">
            <h3 className="font-bold text-base">Schedule Publication</h3>
            <p className="text-sm text-muted-foreground">
              Choose when this camp should go live. It will be <strong>published automatically</strong> at
              the selected time, with registration open and visible to players.
            </p>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Publish date &amp; time</label>
              <input
                type="datetime-local"
                className="w-full h-9 rounded border border-input bg-background px-3 text-sm"
                value={scheduledPublishAt}
                onChange={e => setScheduledPublishAt(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              The camp is saved as a draft and published automatically at this time.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setScheduleDialogOpen(false)}>Cancel</Button>
              <Button
                size="sm"
                disabled={!scheduledPublishAt || isSaving}
                onClick={() => { setScheduleDialogOpen(false); schedulePublish.mutate(); }}
              >
                Schedule
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
