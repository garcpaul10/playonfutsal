/**
 * 5-Step Drop-in Creation Wizard
 *
 * Step 1: Basics     — name, sport, venue, description, image
 * Step 2: Schedule   — one-time vs recurring; live calendar preview; skip dates inline
 * Step 3: Pools      — court, cap, price, age groups, skill, gender, early bird; presets
 * Step 4: Settings   — registration opens, cutoff, waitlist, auto-cancel, staff
 * Step 5: Review     — full summary + Save Draft / Publish / Schedule Publish
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAdminPermissions } from "@/hooks/use-admin-permissions";
import { useAuth } from "@clerk/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Save, Rocket, Clock,
  Plus, Trash2, ChevronLeft, ChevronRight, Star, Users, DollarSign,
  CalendarX, Settings, Eye,
} from "lucide-react";
import { AGE_GROUPS } from "@workspace/brand";
import { format, addMonths, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameMonth, parseISO, isBefore, isAfter } from "date-fns";
import { Layout } from "@/components/layout";
import { WizardShell } from "@/components/admin/WizardShell";
import { useDraftAutosave } from "@/hooks/use-draft-autosave";

import { API_BASE as API } from "@/lib/api-base";

function useAuthHeaders() {
  const { getToken } = useAuth();
  return useCallback(async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  }, [getToken]);
}

// ─── Types ────────────────────────────────────────────────────────────────────

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

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const GENDER_OPTIONS = [{ value: "", label: "Any" }, { value: "men", label: "Men" }, { value: "women", label: "Women" }, { value: "coed", label: "Coed" }, { value: "boy", label: "Boys" }, { value: "girl", label: "Girls" }];
const SKILL_OPTIONS = [{ value: "all", label: "All Levels" }, { value: "beginner", label: "Beginner" }, { value: "intermediate", label: "Intermediate" }, { value: "advanced", label: "Advanced" }];

interface PoolFormEntry {
  id?: number;
  courtId: string;
  cap: string;
  price: string;
  ageGroup: string[];
  skillLevel: string;
  gender: string;
  offerWindowMinutes: string;
  earlyBirdEnabled: boolean;
  earlyBirdPrice: string;
  earlyBirdTriggerType: "date" | "spots_taken";
  earlyBirdTriggerDate: string;
  earlyBirdTriggerSpots: string;
  customTime: boolean;
  startTime: string;
  durationMinutes: string;
  simplifiedRegistration: boolean;
}

function defaultPool(overrides?: Partial<PoolFormEntry>): PoolFormEntry {
  return {
    courtId: "",
    cap: "15",
    price: "0",
    ageGroup: ["adult"],
    skillLevel: "all",
    gender: "",
    offerWindowMinutes: "240",
    earlyBirdEnabled: false,
    earlyBirdPrice: "0",
    earlyBirdTriggerType: "date",
    earlyBirdTriggerDate: "",
    earlyBirdTriggerSpots: "5",
    customTime: false,
    startTime: "",
    durationMinutes: "",
    simplifiedRegistration: false,
    ...overrides,
  };
}

interface WizardState {
  // Step 1
  name: string;
  sport: string;
  venueId: string;
  description: string;
  imageUrl: string;
  // Step 2
  scheduleType: "one_time" | "recurring";
  startDate: string;
  startTime: string;
  durationMinutes: string;
  dayOfWeek: string;
  intervalPreset: "weekly" | "biweekly" | "monthly" | "custom";
  intervalNum: string;
  intervalUnit: "week" | "month";
  endCondition: "never" | "on_date" | "after_n";
  endDate: string;
  endAfterN: string;
  skippedDates: string[];
  // Step 3
  pools: PoolFormEntry[];
  // Step 4
  registrationOpens: "immediately" | "on_date" | "manual";
  registrationOpensAt: string;
  registrationCutoffMinutes: string;
  waitlistEnabled: boolean;
  autoPromoteEnabled: boolean;
  autoCancelThreshold: string;
  staffUserId: string;
}

function defaultWizardState(): WizardState {
  const today = new Date();
  return {
    name: "",
    sport: "basketball",
    venueId: "",
    description: "",
    imageUrl: "",
    scheduleType: "recurring",
    startDate: format(today, "yyyy-MM-dd"),
    startTime: "17:30",
    durationMinutes: "120",
    dayOfWeek: String(getDay(today)),
    intervalPreset: "weekly",
    intervalNum: "1",
    intervalUnit: "week",
    endCondition: "never",
    endDate: "",
    endAfterN: "",
    skippedDates: [],
    pools: [defaultPool()],
    registrationOpens: "immediately",
    registrationOpensAt: "",
    registrationCutoffMinutes: "",
    waitlistEnabled: true,
    autoPromoteEnabled: false,
    autoCancelThreshold: "",
    staffUserId: "",
  };
}

// ─── Calendar Preview ─────────────────────────────────────────────────────────

function buildRecurrenceRule(s: WizardState) {
  const skippedDates = s.skippedDates;
  if (s.scheduleType === "one_time") {
    return { type: "one_time" as const, startDate: s.startDate, startTime: s.startTime, durationMinutes: Number(s.durationMinutes), skippedDates };
  }
  let intervalNum = Number(s.intervalNum) || 1;
  let intervalUnit: "week" | "month" = s.intervalUnit;
  if (s.intervalPreset === "weekly") { intervalNum = 1; intervalUnit = "week"; }
  if (s.intervalPreset === "biweekly") { intervalNum = 2; intervalUnit = "week"; }
  if (s.intervalPreset === "monthly") { intervalNum = 1; intervalUnit = "month"; }

  return {
    type: "recurring" as const,
    startDate: s.startDate,
    startTime: s.startTime,
    durationMinutes: Number(s.durationMinutes),
    dayOfWeek: Number(s.dayOfWeek),
    intervalNum,
    intervalUnit,
    endCondition: s.endCondition,
    endDate: s.endCondition === "on_date" ? s.endDate : null,
    endAfterN: s.endCondition === "after_n" ? Number(s.endAfterN) : null,
    skippedDates,
  };
}

function computeOccurrenceDatesClient(s: WizardState, from: Date, to: Date): string[] {
  const rule = buildRecurrenceRule(s);
  const skipped = new Set(rule.skippedDates ?? []);
  const results: string[] = [];

  if (rule.type === "one_time") {
    if (rule.startDate && rule.startDate >= format(from, "yyyy-MM-dd") && rule.startDate <= format(to, "yyyy-MM-dd")) {
      if (!skipped.has(rule.startDate)) results.push(rule.startDate);
    }
    return results;
  }

  // Recurring
  const pad = (n: number) => String(n).padStart(2, "0");
  const parseDate = (d: string) => {
    const [y, m, dd] = d.split("-").map(Number);
    return new Date(y, m - 1, dd);
  };
  const formatDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  let current = parseDate(rule.startDate ?? format(from, "yyyy-MM-dd"));
  const dayOfWeek = rule.dayOfWeek ?? 1;
  const daysToFirst = (dayOfWeek - current.getDay() + 7) % 7;
  current = new Date(current.getFullYear(), current.getMonth(), current.getDate() + daysToFirst);

  let iterations = 0;
  while (iterations++ < 10000) {
    const dateStr = formatDate(current);
    if (isAfter(current, to)) break;
    if (rule.endCondition === "on_date" && rule.endDate && dateStr > rule.endDate) break;
    if (rule.endCondition === "after_n" && rule.endAfterN && results.length >= rule.endAfterN) break;

    if (!isBefore(current, from) && !skipped.has(dateStr)) {
      results.push(dateStr);
    }

    if (rule.intervalUnit === "month") {
      const next = new Date(current.getFullYear(), current.getMonth() + (rule.intervalNum ?? 1), current.getDate());
      const diff = (dayOfWeek - next.getDay() + 7) % 7;
      current = new Date(next.getFullYear(), next.getMonth(), next.getDate() + diff);
    } else {
      current = new Date(current.getFullYear(), current.getMonth(), current.getDate() + (rule.intervalNum ?? 1) * 7);
    }
  }

  return results;
}

function CalendarPreview({ state, onToggleSkip }: { state: WizardState; onToggleSkip: (date: string) => void }) {
  const [viewMonth, setViewMonth] = useState(() => {
    if (state.startDate) {
      const [y, m] = state.startDate.split("-").map(Number);
      return new Date(y, m - 1, 1);
    }
    return startOfMonth(new Date());
  });

  const monthStart = startOfMonth(viewMonth);
  const monthEnd = endOfMonth(viewMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const from = new Date();
  const to = addMonths(new Date(), 6);
  const occurrenceDates = useMemo(() => new Set(computeOccurrenceDatesClient(state, from, to)), [state]);
  const skippedSet = new Set(state.skippedDates);

  const firstDayOfWeek = getDay(monthStart);
  const blanks = Array.from({ length: firstDayOfWeek }, (_, i) => i);

  return (
    <div className="border rounded-lg bg-muted/30 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setViewMonth(d => addMonths(d, -1))} className="p-1 hover:bg-muted rounded"><ChevronLeft className="h-4 w-4" /></button>
        <span className="text-sm font-semibold">{format(viewMonth, "MMMM yyyy")}</span>
        <button type="button" onClick={() => setViewMonth(d => addMonths(d, 1))} className="p-1 hover:bg-muted rounded"><ChevronRight className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {DAYS.map(d => <div key={d} className="text-[10px] font-semibold text-muted-foreground py-0.5">{d}</div>)}
        {blanks.map(i => <div key={`b${i}`} />)}
        {days.map(day => {
          const dateStr = format(day, "yyyy-MM-dd");
          const isOccurrence = occurrenceDates.has(dateStr);
          const isSkipped = skippedSet.has(dateStr);
          const isToday = dateStr === format(new Date(), "yyyy-MM-dd");
          return (
            <button
              key={dateStr}
              type="button"
              onClick={() => isOccurrence || isSkipped ? onToggleSkip(dateStr) : undefined}
              disabled={!isOccurrence && !isSkipped}
              className={[
                "text-xs py-1 rounded transition-colors relative",
                isToday ? "ring-1 ring-primary/50" : "",
                isOccurrence && !isSkipped ? "bg-primary text-primary-foreground hover:bg-primary/80 cursor-pointer font-semibold" : "",
                isSkipped ? "bg-muted text-muted-foreground line-through cursor-pointer" : "",
                !isOccurrence && !isSkipped ? "text-muted-foreground/50 cursor-default" : "",
              ].join(" ")}
            >
              {format(day, "d")}
              {isSkipped && <span className="absolute -top-0.5 -right-0.5 text-[8px] text-orange-400">✕</span>}
            </button>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground text-center">
        {occurrenceDates.size > 0 ? `${occurrenceDates.size} session${occurrenceDates.size !== 1 ? "s" : ""} in next 6 months` : "No sessions in view"}
        {" — Click a highlighted date to skip/restore"}
      </p>
    </div>
  );
}

// ─── Pool Card ────────────────────────────────────────────────────────────────

function PoolCard({ pool, courts, presets, index, onUpdate, onRemove, onSavePreset, onLoadPreset, canRemove }: {
  pool: PoolFormEntry;
  courts: any[];
  presets: any[];
  index: number;
  onUpdate: (p: PoolFormEntry) => void;
  onRemove: () => void;
  onSavePreset: (p: PoolFormEntry) => void;
  onLoadPreset: (presetId: number) => void;
  canRemove: boolean;
}) {
  const [presetName, setPresetName] = useState("");
  const [showSavePreset, setShowSavePreset] = useState(false);

  return (
    <div className="border rounded-lg p-4 space-y-3 bg-background">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Pool {index + 1}</span>
        <div className="flex items-center gap-2">
          {presets.length > 0 && (
            <select
              className="h-7 text-xs rounded border border-input bg-muted px-2"
              onChange={e => e.target.value && onLoadPreset(Number(e.target.value))}
              value=""
            >
              <option value="">Use preset…</option>
              {presets.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <button type="button" onClick={() => setShowSavePreset(v => !v)} className="text-xs text-muted-foreground hover:text-foreground underline">Save as preset</button>
          {canRemove && <button type="button" onClick={onRemove} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>}
        </div>
      </div>

      {showSavePreset && (
        <div className="flex gap-2 items-center">
          <Input placeholder="Preset name…" className="h-7 text-xs" value={presetName} onChange={e => setPresetName(e.target.value)} />
          <Button size="sm" className="h-7 text-xs" onClick={() => { onSavePreset({ ...pool, id: undefined }); setShowSavePreset(false); setPresetName(""); }}>Save</Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Court</Label>
          <select className="w-full h-8 rounded border border-input bg-background px-2 text-sm mt-1" value={pool.courtId} onChange={e => onUpdate({ ...pool, courtId: e.target.value })}>
            <option value="">Select court…</option>
            {courts.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <Label className="text-xs">Cap (players)</Label>
          <Input type="number" min="1" className="h-8 mt-1" value={pool.cap} onChange={e => onUpdate({ ...pool, cap: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Price ($)</Label>
          <Input type="number" step="0.01" min="0" className="h-8 mt-1" value={pool.price} onChange={e => onUpdate({ ...pool, price: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Skill Level</Label>
          <select className="w-full h-8 rounded border border-input bg-background px-2 text-sm mt-1" value={pool.skillLevel} onChange={e => onUpdate({ ...pool, skillLevel: e.target.value })}>
            {SKILL_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <Label className="text-xs">Gender</Label>
          <select className="w-full h-8 rounded border border-input bg-background px-2 text-sm mt-1" value={pool.gender} onChange={e => onUpdate({ ...pool, gender: e.target.value })}>
            {GENDER_OPTIONS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
        </div>
        <div>
          <Label className="text-xs">Offer Window (min)</Label>
          <Input type="number" min="30" className="h-8 mt-1" value={pool.offerWindowMinutes} onChange={e => onUpdate({ ...pool, offerWindowMinutes: e.target.value })} />
        </div>
      </div>

      <div>
        <Label className="text-xs">Age Group</Label>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-1.5">
          {AGE_GROUPS.map(ag => (
            <label key={ag.value} className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input type="checkbox"
                checked={pool.ageGroup.includes(ag.value)}
                onChange={e => {
                  let next: string[];
                  if (e.target.checked) {
                    next = ag.value === "all_ages" ? ["all_ages"] : [...pool.ageGroup.filter(g => g !== "all_ages"), ag.value];
                  } else {
                    next = pool.ageGroup.filter(g => g !== ag.value);
                  }
                  if (next.length > 0) onUpdate({ ...pool, ageGroup: next });
                }}
                className="h-3.5 w-3.5 accent-primary"
              />
              {ag.label}
            </label>
          ))}
        </div>
      </div>

      <div className="border rounded-md p-2.5 space-y-2">
        <label className="flex items-center gap-2 text-xs cursor-pointer font-medium">
          <input type="checkbox" checked={pool.customTime} onChange={e => onUpdate({ ...pool, customTime: e.target.checked, startTime: e.target.checked ? pool.startTime : "", durationMinutes: e.target.checked ? pool.durationMinutes : "" })} className="h-3.5 w-3.5 accent-primary" />
          Custom time for this pool
        </label>
        {pool.customTime && (
          <div className="grid grid-cols-2 gap-2 pl-4">
            <div>
              <Label className="text-xs">Start time</Label>
              <Input type="time" className="h-7 text-xs mt-0.5" value={pool.startTime} onChange={e => onUpdate({ ...pool, startTime: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Duration (min)</Label>
              <Input type="number" min="15" step="15" className="h-7 text-xs mt-0.5" placeholder="e.g. 90" value={pool.durationMinutes} onChange={e => onUpdate({ ...pool, durationMinutes: e.target.value })} />
            </div>
          </div>
        )}
      </div>

      <div className="border rounded-md p-2.5 space-y-2">
        <label className="flex items-center gap-2 text-xs cursor-pointer font-medium">
          <input type="checkbox" checked={pool.earlyBirdEnabled} onChange={e => onUpdate({ ...pool, earlyBirdEnabled: e.target.checked })} className="h-3.5 w-3.5 accent-primary" />
          Early bird pricing
        </label>
        {pool.earlyBirdEnabled && (
          <div className="grid grid-cols-2 gap-2 pl-4">
            <div>
              <Label className="text-xs">Early price ($)</Label>
              <Input type="number" step="0.01" min="0" className="h-7 text-xs mt-0.5" value={pool.earlyBirdPrice} onChange={e => onUpdate({ ...pool, earlyBirdPrice: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Trigger by</Label>
              <select className="w-full h-7 rounded border border-input bg-background px-2 text-xs mt-0.5" value={pool.earlyBirdTriggerType} onChange={e => onUpdate({ ...pool, earlyBirdTriggerType: e.target.value as "date" | "spots_taken" })}>
                <option value="date">Date</option>
                <option value="spots_taken">Spots taken</option>
              </select>
            </div>
            {pool.earlyBirdTriggerType === "date" ? (
              <div className="col-span-2">
                <Label className="text-xs">End date (early bird ends)</Label>
                <Input type="date" className="h-7 text-xs mt-0.5" value={pool.earlyBirdTriggerDate} onChange={e => onUpdate({ ...pool, earlyBirdTriggerDate: e.target.value })} />
              </div>
            ) : (
              <div className="col-span-2">
                <Label className="text-xs">After N spots taken</Label>
                <Input type="number" min="1" className="h-7 text-xs mt-0.5" value={pool.earlyBirdTriggerSpots} onChange={e => onUpdate({ ...pool, earlyBirdTriggerSpots: e.target.value })} />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="border rounded-md p-2.5">
        {Number(pool.price) > 0 ? (
          <span
            className="flex items-center gap-2 text-xs font-medium text-muted-foreground cursor-not-allowed"
            title="Guest registration is only available for free ($0) pools"
          >
            <input type="checkbox" disabled checked={false} className="h-3.5 w-3.5 opacity-40 cursor-not-allowed" />
            Allow guest registration (no account required)
            <span className="text-[10px] text-muted-foreground/70 italic">— disabled for paid pools</span>
          </span>
        ) : (
          <label className="flex items-center gap-2 text-xs cursor-pointer font-medium">
            <input
              type="checkbox"
              checked={pool.simplifiedRegistration}
              onChange={e => onUpdate({ ...pool, simplifiedRegistration: e.target.checked })}
              className="h-3.5 w-3.5 accent-primary"
            />
            Allow guest registration (no account required)
          </label>
        )}
      </div>
    </div>
  );
}

// ─── Step Components ──────────────────────────────────────────────────────────

function Step1Basics({ state, onChange, venues }: { state: WizardState; onChange: (s: Partial<WizardState>) => void; venues: any[] }) {
  return (
    <div className="space-y-5">
      <div>
        <Label>Session Name</Label>
        <Input className="mt-1" placeholder="e.g. Friday Night Open Basketball" value={state.name} onChange={e => onChange({ name: e.target.value })} required />
        <p className="text-xs text-muted-foreground mt-1">Keep it short and descriptive. Players will see this in the listing.</p>
      </div>
      <div>
        <Label>Sport</Label>
        <div className="grid grid-cols-3 gap-2 mt-2">
          {SPORTS.map(s => (
            <button
              key={s.value}
              type="button"
              onClick={() => onChange({ sport: s.value })}
              className={`text-sm py-2 px-3 rounded-lg border transition-colors text-left ${state.sport === s.value ? "border-primary bg-primary/10 text-primary font-semibold" : "border-input hover:bg-muted"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <Label>Venue / Facility</Label>
        <select className="w-full h-10 rounded border border-input bg-background px-3 text-sm mt-1" value={state.venueId} onChange={e => onChange({ venueId: e.target.value })}>
          <option value="">Select venue (optional)</option>
          {venues.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </div>
      <div>
        <Label>Description (optional)</Label>
        <Textarea className="mt-1 resize-none" rows={3} placeholder="Any details players should know — parking, dress code, level of play expected…" value={state.description} onChange={e => onChange({ description: e.target.value })} />
      </div>
      <div>
        <Label>Card Image URL (optional)</Label>
        <Input className="mt-1" placeholder="https://example.com/image.jpg" value={state.imageUrl} onChange={e => onChange({ imageUrl: e.target.value })} />
        <p className="text-xs text-muted-foreground mt-1">Paste a public image URL. This photo appears on the listing card.</p>
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

function Step2Schedule({ state, onChange }: { state: WizardState; onChange: (s: Partial<WizardState>) => void }) {
  const toggleSkip = useCallback((date: string) => {
    const current = state.skippedDates ?? [];
    const next = current.includes(date) ? current.filter(d => d !== date) : [...current, date];
    onChange({ skippedDates: next });
  }, [state.skippedDates, onChange]);

  return (
    <div className="space-y-5">
      <div>
        <Label>Session Type</Label>
        <div className="flex gap-3 mt-2">
          {[{ v: "one_time", l: "One-time session" }, { v: "recurring", l: "Recurring series" }].map(opt => (
            <button key={opt.v} type="button" onClick={() => onChange({ scheduleType: opt.v as any })}
              className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${state.scheduleType === opt.v ? "border-primary bg-primary/10 text-primary" : "border-input hover:bg-muted"}`}>
              {opt.l}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="text-sm">{state.scheduleType === "one_time" ? "Date" : "Series Start Date"}</Label>
          <Input type="date" className="mt-1" value={state.startDate} onChange={e => onChange({ startDate: e.target.value })} required />
        </div>
        <div>
          <Label className="text-sm">Start Time</Label>
          <Input type="time" className="mt-1" value={state.startTime} onChange={e => onChange({ startTime: e.target.value })} required />
        </div>
        <div className="col-span-2">
          <Label className="text-sm">Duration</Label>
          <div className="flex gap-2 mt-1 flex-wrap">
            {[30, 60, 90, 120, 150, 180].map(m => (
              <button key={m} type="button" onClick={() => onChange({ durationMinutes: String(m) })}
                className={`px-3 py-1.5 rounded border text-xs transition-colors ${Number(state.durationMinutes) === m ? "border-primary bg-primary/10 text-primary font-semibold" : "border-input hover:bg-muted"}`}>
                {m < 60 ? `${m}m` : m === 60 ? "1h" : `${m / 60}h`}
              </button>
            ))}
            <Input type="number" min="15" max="480" placeholder="Custom min" className="h-8 w-28 text-xs" value={Number(state.durationMinutes) % 30 !== 0 ? state.durationMinutes : ""} onChange={e => onChange({ durationMinutes: e.target.value })} />
          </div>
        </div>
      </div>

      {state.scheduleType === "recurring" && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm">Repeats On</Label>
              <select className="w-full h-10 rounded border border-input bg-background px-3 text-sm mt-1" value={state.dayOfWeek} onChange={e => onChange({ dayOfWeek: e.target.value })}>
                {DAYS_LONG.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-sm">Frequency</Label>
              <select className="w-full h-10 rounded border border-input bg-background px-3 text-sm mt-1" value={state.intervalPreset} onChange={e => {
                const p = e.target.value as any;
                const updates: Partial<WizardState> = { intervalPreset: p };
                if (p === "weekly") { updates.intervalNum = "1"; updates.intervalUnit = "week"; }
                if (p === "biweekly") { updates.intervalNum = "2"; updates.intervalUnit = "week"; }
                if (p === "monthly") { updates.intervalNum = "1"; updates.intervalUnit = "month"; }
                onChange(updates);
              }}>
                <option value="weekly">Every week</option>
                <option value="biweekly">Every 2 weeks</option>
                <option value="monthly">Monthly</option>
                <option value="custom">Custom…</option>
              </select>
            </div>
          </div>

          {state.intervalPreset === "custom" && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Every</span>
              <Input type="number" min="1" max="52" className="h-8 w-20 text-sm" value={state.intervalNum} onChange={e => onChange({ intervalNum: e.target.value })} />
              <select className="h-8 rounded border border-input bg-background px-2 text-sm" value={state.intervalUnit} onChange={e => onChange({ intervalUnit: e.target.value as any })}>
                <option value="week">week(s)</option>
                <option value="month">month(s)</option>
              </select>
            </div>
          )}

          <div>
            <Label className="text-sm">Series Ends</Label>
            <div className="flex gap-3 mt-1.5">
              {[{ v: "never", l: "Never" }, { v: "on_date", l: "On date" }, { v: "after_n", l: "After N sessions" }].map(opt => (
                <button key={opt.v} type="button" onClick={() => onChange({ endCondition: opt.v as any })}
                  className={`flex-1 py-1.5 rounded border text-sm transition-colors ${state.endCondition === opt.v ? "border-primary bg-primary/10 text-primary" : "border-input hover:bg-muted"}`}>
                  {opt.l}
                </button>
              ))}
            </div>
            {state.endCondition === "on_date" && (
              <Input type="date" className="mt-2" value={state.endDate} onChange={e => onChange({ endDate: e.target.value })} />
            )}
            {state.endCondition === "after_n" && (
              <div className="flex items-center gap-2 mt-2">
                <Input type="number" min="1" className="h-8 w-24" value={state.endAfterN} onChange={e => onChange({ endAfterN: e.target.value })} />
                <span className="text-sm text-muted-foreground">sessions</span>
              </div>
            )}
          </div>
        </>
      )}

      <div>
        <Label className="text-sm mb-2 block">Calendar Preview</Label>
        <CalendarPreview state={state} onToggleSkip={toggleSkip} />
        {state.skippedDates.length > 0 && (
          <p className="text-xs text-muted-foreground mt-1.5">
            Skipped: {state.skippedDates.sort().map(d => format(parseISO(d), "MMM d")).join(", ")}
          </p>
        )}
      </div>
    </div>
  );
}

function Step3Pools({ state, onChange, courts, presets, onSavePreset }: {
  state: WizardState;
  onChange: (s: Partial<WizardState>) => void;
  courts: any[];
  presets: any[];
  onSavePreset: (name: string, pool: PoolFormEntry) => void;
}) {
  function updatePool(index: number, updated: PoolFormEntry) {
    const next = [...state.pools];
    next[index] = updated;
    onChange({ pools: next });
  }

  function addPool() {
    onChange({ pools: [...state.pools, defaultPool({ courtId: courts[0]?.id?.toString() ?? "" })] });
  }

  function removePool(index: number) {
    onChange({ pools: state.pools.filter((_, i) => i !== index) });
  }

  function loadPreset(index: number, presetId: number) {
    const preset = presets.find((p: any) => p.id === presetId);
    if (!preset?.config) return;
    const { courtId, cap, price, ageGroup, skillLevel, gender, offerWindowMinutes } = preset.config;
    updatePool(index, {
      ...state.pools[index],
      courtId: String(courtId ?? ""),
      cap: String(cap ?? 15),
      price: String(price ?? "0"),
      ageGroup: ageGroup ?? ["adult"],
      skillLevel: skillLevel ?? "all",
      gender: gender ?? "",
      offerWindowMinutes: String(offerWindowMinutes ?? 240),
    });
  }

  const [presetSaveIdx, setPresetSaveIdx] = useState<number | null>(null);
  const [presetSaveName, setPresetSaveName] = useState("");

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Define one or more pools (courts) for each session. Pool settings apply to every occurrence in the series.</p>
      {state.pools.map((pool, i) => (
        <PoolCard
          key={i}
          pool={pool}
          courts={courts}
          presets={presets}
          index={i}
          onUpdate={updated => updatePool(i, updated)}
          onRemove={() => removePool(i)}
          onSavePreset={(p) => {
            setPresetSaveIdx(i);
            setPresetSaveName(`Court ${p.courtId} · ${p.skillLevel} · $${p.price}`);
          }}
          onLoadPreset={presetId => loadPreset(i, presetId)}
          canRemove={state.pools.length > 1}
        />
      ))}
      {presetSaveIdx !== null && (
        <div className="flex gap-2 items-center border rounded p-2 bg-muted/30">
          <Input placeholder="Preset name…" className="h-8 text-sm flex-1" value={presetSaveName} onChange={e => setPresetSaveName(e.target.value)} />
          <Button size="sm" className="h-8" onClick={() => { onSavePreset(presetSaveName, state.pools[presetSaveIdx!]); setPresetSaveIdx(null); }}>Save Preset</Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={() => setPresetSaveIdx(null)}>Cancel</Button>
        </div>
      )}
      <Button type="button" variant="outline" className="w-full" onClick={addPool}>
        <Plus className="h-4 w-4 mr-2" /> Add Pool
      </Button>
    </div>
  );
}

function Step4Settings({ state, onChange, users }: {
  state: WizardState;
  onChange: (s: Partial<WizardState>) => void;
  users: any[];
}) {
  return (
    <div className="space-y-5">
      <div>
        <Label className="text-sm font-semibold">Registration Opens</Label>
        <div className="flex gap-3 mt-2">
          {[{ v: "immediately", l: "Immediately when published" }, { v: "on_date", l: "On a specific date" }, { v: "manual", l: "Manually (I'll open it)" }].map(opt => (
            <button key={opt.v} type="button" onClick={() => onChange({ registrationOpens: opt.v as any })}
              className={`flex-1 py-2 px-3 rounded-lg border text-xs font-medium transition-colors ${state.registrationOpens === opt.v ? "border-primary bg-primary/10 text-primary" : "border-input hover:bg-muted"}`}>
              {opt.l}
            </button>
          ))}
        </div>
        {state.registrationOpens === "on_date" && (
          <Input type="datetime-local" className="mt-2" value={state.registrationOpensAt} onChange={e => onChange({ registrationOpensAt: e.target.value })} />
        )}
      </div>

      <div>
        <Label className="text-sm font-semibold">Registration Cutoff</Label>
        <p className="text-xs text-muted-foreground mt-0.5">How far in advance should registration close before each session?</p>
        <div className="flex items-center gap-3 mt-2">
          <div className="flex gap-2">
            {[{ l: "None", v: "" }, { l: "1h", v: "60" }, { l: "2h", v: "120" }, { l: "24h", v: "1440" }, { l: "48h", v: "2880" }].map(opt => (
              <button key={opt.l} type="button" onClick={() => onChange({ registrationCutoffMinutes: opt.v })}
                className={`px-3 py-1.5 rounded border text-xs transition-colors ${state.registrationCutoffMinutes === opt.v ? "border-primary bg-primary/10 text-primary font-semibold" : "border-input hover:bg-muted"}`}>
                {opt.l}
              </button>
            ))}
          </div>
          <Input type="number" min="0" placeholder="Custom min" className="h-8 w-28 text-xs" value={!["", "60", "120", "1440", "2880"].includes(state.registrationCutoffMinutes) ? state.registrationCutoffMinutes : ""} onChange={e => onChange({ registrationCutoffMinutes: e.target.value })} />
        </div>
      </div>

      <div className="space-y-3">
        <Label className="text-sm font-semibold">Waitlist</Label>
        <label className="flex items-center gap-2 cursor-pointer text-sm">
          <input type="checkbox" checked={state.waitlistEnabled} onChange={e => onChange({ waitlistEnabled: e.target.checked })} className="h-4 w-4 accent-primary" />
          Enable waitlist when pool is full
        </label>
        <label className="flex items-center gap-2 cursor-pointer text-sm">
          <input type="checkbox" checked={state.autoPromoteEnabled} onChange={e => onChange({ autoPromoteEnabled: e.target.checked })} disabled={!state.waitlistEnabled} className="h-4 w-4 accent-primary" />
          Auto-promote waitlisted players when a spot opens
        </label>
      </div>

      <div>
        <Label className="text-sm font-semibold">Auto-cancel Threshold</Label>
        <p className="text-xs text-muted-foreground mt-0.5">If fewer than this many players are registered 24h before start, automatically cancel and notify everyone.</p>
        <div className="flex items-center gap-2 mt-2">
          <Input type="number" min="0" placeholder="No threshold" className="h-8 w-32 text-sm" value={state.autoCancelThreshold} onChange={e => onChange({ autoCancelThreshold: e.target.value })} />
          <span className="text-sm text-muted-foreground">min players (leave blank to disable)</span>
        </div>
      </div>

      <div>
        <Label className="text-sm font-semibold">Staff Assignment</Label>
        <p className="text-xs text-muted-foreground mt-0.5">Assign a coach or referee to this session.</p>
        <select className="w-full h-10 rounded border border-input bg-background px-3 text-sm mt-2" value={state.staffUserId} onChange={e => onChange({ staffUserId: e.target.value })}>
          <option value="">No staff assigned</option>
          {users.filter((u: any) => u.roles?.includes("staff") || u.roles?.includes("coach") || u.roles?.includes("referee") || u.adminLevel).map((u: any) => (
            <option key={u.id} value={u.id}>{u.firstName} {u.lastName} ({u.email})</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function Step5Review({ state, onSaveDraft, onPublish, onSchedule, isSaving, courts, venues, getHeaders }: {
  state: WizardState;
  onSaveDraft: () => void;
  onPublish: () => void;
  onSchedule: () => void;
  isSaving: boolean;
  courts: any[];
  venues: any[];
  getHeaders: () => Promise<Record<string, string>>;
}) {
  const [conflictWarnings, setConflictWarnings] = useState<string[]>([]);

  // Check court-time conflicts against existing scheduled sessions on mount
  useEffect(() => {
    let cancelled = false;
    async function check() {
      const warnings: string[] = [];
      const now = new Date();
      const to = addMonths(now, 3);
      const dates = computeOccurrenceDatesClient(state, now, to);
      if (dates.length === 0) return;
      const firstDate = dates[0];
      const duration = Number(state.durationMinutes) || 120;
      const startsAt = `${firstDate}T${state.startTime || "18:00"}:00`;
      const headers = await getHeaders();
      for (const pool of state.pools) {
        if (!pool.courtId) continue;
        try {
          const r = await fetch(
            `${API}/courts/${pool.courtId}/conflicts?startsAt=${encodeURIComponent(startsAt)}&duration=${duration}`,
            { headers }
          );
          if (r.ok) {
            const data = await r.json();
            if (data.hasConflict) {
              const courtName = courts.find((c: any) => String(c.id) === pool.courtId)?.name ?? `Court ${pool.courtId}`;
              warnings.push(`${courtName} has a scheduling conflict at ${state.startTime || "18:00"} on ${firstDate}`);
            }
          }
        } catch {}
      }
      if (!cancelled) setConflictWarnings(warnings);
    }
    check();
    return () => { cancelled = true; };
  }, [state.pools, state.startTime, state.durationMinutes]);

  const rule = buildRecurrenceRule(state);
  const court = (id: string) => courts.find((c: any) => String(c.id) === id)?.name ?? id;
  const venue = venues.find((v: any) => String(v.id) === state.venueId)?.name ?? "";

  const now = new Date();
  const to = addMonths(now, 3);
  const occurrenceDates = computeOccurrenceDatesClient(state, now, to);
  const totalRevCapacity = state.pools.reduce((sum, p) => sum + Number(p.cap) * Number(p.price), 0);

  return (
    <div className="space-y-5">
      {conflictWarnings.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-1">
          <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide">⚠ Scheduling Conflicts Detected</p>
          {conflictWarnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-700">{w}</p>
          ))}
          <p className="text-xs text-muted-foreground mt-1">Review the conflicts above before publishing. You can still save as draft.</p>
        </div>
      )}
      <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Session</p>
          {state.imageUrl && (
            <img
              src={state.imageUrl}
              alt="Card preview"
              className="mt-1 mb-2 h-24 w-full object-cover rounded-lg border"
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              onLoad={e => { (e.currentTarget as HTMLImageElement).style.display = "block"; }}
            />
          )}
          <p className="text-base font-bold mt-0.5">{state.name || <span className="text-muted-foreground italic">Untitled</span>}</p>
          <div className="flex flex-wrap gap-2 mt-1">
            <Badge variant="outline" className="text-xs">{SPORTS.find(s => s.value === state.sport)?.label ?? state.sport}</Badge>
            {venue && <Badge variant="outline" className="text-xs">{venue}</Badge>}
          </div>
          {state.description && <p className="text-xs text-muted-foreground mt-1">{state.description}</p>}
        </div>

        <div className="border-t pt-2">
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Schedule</p>
          <p className="text-sm mt-0.5">
            {state.scheduleType === "one_time" ? `One-time: ${state.startDate}` : `Recurring ${DAYS_LONG[Number(state.dayOfWeek)]} at ${state.startTime}`}
            {" · "}{state.durationMinutes} min
          </p>
          {state.scheduleType === "recurring" && (
            <p className="text-xs text-muted-foreground">
              {occurrenceDates.length} session{occurrenceDates.length !== 1 ? "s" : ""} in next 3 months
              {state.endCondition !== "never" && ` · ends ${state.endCondition === "on_date" ? state.endDate : `after ${state.endAfterN} sessions`}`}
            </p>
          )}
          {state.skippedDates.length > 0 && <p className="text-xs text-orange-500">{state.skippedDates.length} date{state.skippedDates.length !== 1 ? "s" : ""} skipped</p>}
        </div>

        <div className="border-t pt-2">
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">{state.pools.length} Pool{state.pools.length !== 1 ? "s" : ""}</p>
          {state.pools.map((p, i) => (
            <div key={i} className="flex justify-between text-sm mt-1">
              <span>{court(p.courtId)} · {p.ageGroup.join(", ")} · {p.skillLevel}</span>
              <span className="text-muted-foreground">{p.cap} spots · {Number(p.price) > 0 ? `$${Number(p.price).toFixed(2)}` : "Free"}</span>
            </div>
          ))}
          {totalRevCapacity > 0 && <p className="text-xs text-muted-foreground mt-1">Max revenue per session: ${totalRevCapacity.toFixed(2)}</p>}
        </div>

        <div className="border-t pt-2">
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Registration</p>
          <p className="text-sm">Opens {state.registrationOpens === "immediately" ? "immediately when published" : state.registrationOpens === "manual" ? "manually" : `on ${state.registrationOpensAt}`}</p>
          {state.registrationCutoffMinutes && <p className="text-xs text-muted-foreground">Cutoff: {Number(state.registrationCutoffMinutes) < 60 ? `${state.registrationCutoffMinutes}m` : `${Number(state.registrationCutoffMinutes) / 60}h`} before start</p>}
          {state.waitlistEnabled && <p className="text-xs text-muted-foreground">Waitlist enabled{state.autoPromoteEnabled ? " · Auto-promote on" : ""}</p>}
          {state.autoCancelThreshold && <p className="text-xs text-muted-foreground">Auto-cancel if &lt;{state.autoCancelThreshold} players at 24h</p>}
        </div>
      </div>

      <div className="border-t pt-4 space-y-2">
        <Button className="w-full" onClick={onPublish} disabled={isSaving}>
          <Rocket className="h-4 w-4 mr-2" /> {isSaving ? "Publishing…" : "Publish Now"}
        </Button>
        <Button variant="outline" className="w-full" onClick={onSchedule} disabled={isSaving}>
          <Clock className="h-4 w-4 mr-2" /> Schedule Publish
        </Button>
        <Button variant="ghost" className="w-full text-muted-foreground" onClick={onSaveDraft} disabled={isSaving}>
          <Save className="h-4 w-4 mr-2" /> Save as Draft
        </Button>
      </div>
    </div>
  );
}

// ─── Main Wizard ──────────────────────────────────────────────────────────────

const STEPS = ["Basics", "Schedule", "Pools", "Settings", "Review"];

const AUTOSAVE_KEY = "dropin_wizard_draft_v1";
const AUTOSAVE_ID_KEY = "dropin_wizard_draft_id_v1";

export default function DropinNewWizard() {
  const { canManageDropins } = useAdminPermissions();
  const getHeaders = useAuthHeaders();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [step, setStep] = useState(0);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [scheduledPublishAt, setScheduledPublishAt] = useState("");

  const backendDraftId = useRef<number | null>(null);
  const backendAutosaving = useRef(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveAbortRef = useRef<AbortController | null>(null);

  const [state, setState] = useState<WizardState>(() => {
    try {
      const saved = localStorage.getItem(AUTOSAVE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return { ...defaultWizardState(), ...parsed };
      }
    } catch {}
    return defaultWizardState();
  });

  // Shared hook: localStorage debounced save, draft-restored banner, publishedRef guard.
  // Remote dropin-template autosave is still managed inline below (dropin-specific payload).
  const { restoredFromDraft, clearDraft: clearLocalDraft, publishedRef } = useDraftAutosave({
    localStorageKey: AUTOSAVE_KEY,
    draftIdKey: AUTOSAVE_ID_KEY,
    remoteDraftBaseUrl: `${API}/dropin-templates`,
    state,
    getHeaders,
    enableRemoteSave: false, // remote save managed inline below (dropin-specific payload)
  });

  // Load the stored backend draft id on mount (dropin-specific restore)
  useEffect(() => {
    try {
      const storedId = localStorage.getItem(AUTOSAVE_ID_KEY);
      if (storedId) backendDraftId.current = Number(storedId);
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!state.name.trim()) return;
    if (publishedRef.current) return;
    const timer = setTimeout(async () => {
      if (publishedRef.current) return;
      if (backendAutosaving.current) return;
      backendAutosaving.current = true;
      const controller = new AbortController();
      autosaveAbortRef.current = controller;
      try {
        const headers = await getHeaders();
        if (publishedRef.current) { backendAutosaving.current = false; return; }
        const rule = buildRecurrenceRule(state);
        const body = {
          name: state.name,
          sport: state.sport,
          venueId: state.venueId || null,
          description: state.description || null,
          imageUrl: state.imageUrl || null,
          recurrenceRule: rule,
          isDraft: true,
          pools: state.pools.map((p) => ({
            courtId: Number(p.courtId),
            cap: Number(p.cap),
            price: p.price,
            ageGroup: p.ageGroup,
            skillLevel: p.skillLevel,
            gender: p.gender || null,
            offerWindowMinutes: Number(p.offerWindowMinutes),
            startTime: p.customTime && p.startTime ? p.startTime : null,
            durationMinutes: p.customTime && p.durationMinutes ? Number(p.durationMinutes) : null,
            simplifiedRegistration: Number(p.price) > 0 ? false : p.simplifiedRegistration,
          })),
        };
        if (backendDraftId.current) {
          await fetch(`${API}/dropin-templates/${backendDraftId.current}`, {
            method: "PATCH",
            headers,
            body: JSON.stringify({ ...body, scope: "all" }),
            signal: controller.signal,
          });
        } else {
          const r = await fetch(`${API}/dropin-templates`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          if (r.ok) {
            const data = await r.json();
            backendDraftId.current = data.id;
            try { localStorage.setItem(AUTOSAVE_ID_KEY, String(data.id)); } catch {}
          }
        }
      } catch (e: any) {
        if (e?.name !== "AbortError") { /* ignore */ }
      }
      if (autosaveAbortRef.current === controller) autosaveAbortRef.current = null;
      backendAutosaving.current = false;
    }, 3000);
    autosaveTimerRef.current = timer;
    return () => {
      clearTimeout(timer);
      autosaveTimerRef.current = null;
    };
  }, [state]);

  function onChange(updates: Partial<WizardState>) {
    setState(prev => ({ ...prev, ...updates }));
  }

  function clearDraft() {
    clearLocalDraft();
    backendDraftId.current = null;
  }

  const { data: courts = [] } = useQuery({
    queryKey: ["courts"],
    queryFn: async () => {
      const r = await fetch(`${API}/courts`);
      return r.ok ? r.json() : [];
    },
  });

  const { data: venues = [] } = useQuery({
    queryKey: ["venues"],
    queryFn: async () => {
      const r = await fetch(`${API}/venues`);
      return r.ok ? r.json() : [];
    },
  });

  const { data: presets = [], refetch: refetchPresets } = useQuery({
    queryKey: ["dropin-presets"],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/dropin-presets`, { headers });
      return r.ok ? r.json() : [];
    },
  });

  const { data: users = [] } = useQuery({
    queryKey: ["admin-users-list"],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/admin/users?limit=200`, { headers });
      return r.ok ? r.json() : [];
    },
  });

  const save = useMutation({
    mutationFn: async ({ isDraft, publishAt: pa }: { isDraft: boolean; publishAt?: string }) => {
      const headers = await getHeaders();
      const rule = buildRecurrenceRule(state);
      const body = {
        name: state.name,
        sport: state.sport,
        venueId: state.venueId || null,
        description: state.description || null,
        imageUrl: state.imageUrl || null,
        recurrenceRule: rule,
        isDraft,
        publishAt: pa || null,
        staffUserId: state.staffUserId || null,
        autoCancelThreshold: state.autoCancelThreshold ? Number(state.autoCancelThreshold) : null,
        registrationCutoffMinutes: state.registrationCutoffMinutes ? Number(state.registrationCutoffMinutes) : null,
        registrationOpens: state.registrationOpens,
        registrationOpensAt: state.registrationOpensAt || null,
        waitlistEnabled: state.waitlistEnabled,
        autoPromoteEnabled: state.autoPromoteEnabled,
        pools: state.pools.map(p => ({
          courtId: Number(p.courtId),
          cap: Number(p.cap),
          price: p.price,
          ageGroup: p.ageGroup,
          skillLevel: p.skillLevel,
          gender: p.gender || null,
          offerWindowMinutes: Number(p.offerWindowMinutes),
          startTime: p.customTime && p.startTime ? p.startTime : null,
          durationMinutes: p.customTime && p.durationMinutes ? Number(p.durationMinutes) : null,
          earlyBirdPricing: p.earlyBirdEnabled ? {
            price: Number(p.earlyBirdPrice),
            triggerType: p.earlyBirdTriggerType,
            ...(p.earlyBirdTriggerType === "date" ? { triggerDate: p.earlyBirdTriggerDate } : { triggerSpotsCount: Number(p.earlyBirdTriggerSpots) }),
          } : null,
          simplifiedRegistration: Number(p.price) > 0 ? false : p.simplifiedRegistration,
        })),
      };
      const r = backendDraftId.current
        ? await fetch(`${API}/dropin-templates/${backendDraftId.current}`, { method: "PATCH", headers, body: JSON.stringify({ ...body, scope: "all" }) })
        : await fetch(`${API}/dropin-templates`, { method: "POST", headers, body: JSON.stringify(body) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Save failed"); }
      return r.json();
    },
    onSuccess: (_, vars) => {
      const { isDraft, publishAt: pa } = vars;
      if (!isDraft) {
        publishedRef.current = true;
        if (autosaveTimerRef.current) {
          clearTimeout(autosaveTimerRef.current);
          autosaveTimerRef.current = null;
        }
        if (autosaveAbortRef.current) {
          autosaveAbortRef.current.abort();
          autosaveAbortRef.current = null;
        }
      }
      clearDraft();
      qc.invalidateQueries({ queryKey: ["dropin-templates"] });
      const title = isDraft ? "Draft saved!" : pa ? "Scheduled!" : "Published!";
      const description = isDraft ? "You can continue editing from the admin list." : pa ? `Will publish on ${new Date(pa).toLocaleString()}.` : "Your drop-in session is now live.";
      toast({ title, description });
      navigate("/admin/dropins");
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const savePreset = useMutation({
    mutationFn: async ({ name, pool }: { name: string; pool: PoolFormEntry }) => {
      const headers = await getHeaders();
      const body = {
        name,
        config: { courtId: Number(pool.courtId), cap: Number(pool.cap), price: pool.price, ageGroup: pool.ageGroup, skillLevel: pool.skillLevel, gender: pool.gender || null, offerWindowMinutes: Number(pool.offerWindowMinutes) },
      };
      const r = await fetch(`${API}/dropin-presets`, { method: "POST", headers, body: JSON.stringify(body) });
      if (!r.ok) throw new Error("Failed to save preset");
      return r.json();
    },
    onSuccess: () => { refetchPresets(); toast({ title: "Preset saved!" }); },
  });

  if (!canManageDropins) {
    return <Layout><div className="p-8 text-center text-muted-foreground">Access denied.</div></Layout>;
  }

  const isLastStep = step === STEPS.length - 1;
  const canProceed = step === 0 ? !!state.name.trim() : true;

  return (
    <>
      <WizardShell
        title="New Drop-in Session"
        backHref="/admin/dropins"
        steps={STEPS}
        step={step}
        setStep={setStep}
        canProceed={canProceed}
        isLastStep={isLastStep}
        onSaveDraft={state.name.trim() ? () => save.mutate({ isDraft: true }) : undefined}
        isSaving={save.isPending}
        restoredFromDraft={restoredFromDraft}
        onDiscardDraft={() => { setState(defaultWizardState()); clearDraft(); }}
      >
        {step === 0 && <Step1Basics state={state} onChange={onChange} venues={venues} />}
        {step === 1 && <Step2Schedule state={state} onChange={onChange} />}
        {step === 2 && <Step3Pools state={state} onChange={onChange} courts={courts} presets={presets} onSavePreset={(name, pool) => savePreset.mutate({ name, pool })} />}
        {step === 3 && <Step4Settings state={state} onChange={onChange} users={users} />}
        {step === 4 && (
          <Step5Review state={state} courts={courts} venues={venues}
            onSaveDraft={() => save.mutate({ isDraft: true })}
            onPublish={() => save.mutate({ isDraft: false })}
            onSchedule={() => setScheduleDialogOpen(true)}
            isSaving={save.isPending}
            getHeaders={getHeaders}
          />
        )}
      </WizardShell>

      {scheduleDialogOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border rounded-xl p-6 w-full max-w-sm space-y-4">
            <h3 className="font-bold text-base">Schedule Publish</h3>
            <p className="text-sm text-muted-foreground">Choose when this session should become visible to players.</p>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Publish at</label>
              <input
                type="datetime-local"
                className="w-full h-9 rounded border border-input bg-background px-3 text-sm"
                value={scheduledPublishAt}
                onChange={e => setScheduledPublishAt(e.target.value)}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setScheduleDialogOpen(false)}>Cancel</Button>
              <Button size="sm" disabled={!scheduledPublishAt || save.isPending}
                onClick={() => { setScheduleDialogOpen(false); save.mutate({ isDraft: false, publishAt: scheduledPublishAt }); }}>
                Schedule
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
