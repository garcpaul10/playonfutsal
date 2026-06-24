/**
 * Edit Drop-in Template — 5-step pre-filled wizard (full parity with create wizard)
 *
 * Step 0: Basics    — name, sport, venue, description, image
 * Step 1: Schedule  — recurrenceType, frequency, day, startDate, startTime, duration quick-select,
 *                     end condition, calendar preview with skip-dates
 * Step 2: Pools     — court, cap, price, age groups, skill, gender dropdown,
 *                     early bird pricing, add/remove pools
 * Step 3: Settings  — registration opens, cutoff, waitlist, auto-promote,
 *                     auto-cancel, staff assignment
 * Step 4: Review    — full summary + Save Draft / Publish Now / Schedule Publish
 */

import React, { useState, useCallback, useEffect, useMemo } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { useAuth } from "@clerk/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ChevronLeft, ChevronRight, ArrowLeft, ArrowRight,
  Rocket, AlertTriangle, Eye, Star, Smartphone,
  Plus, Trash2, Save, Clock,
} from "lucide-react";
import { format, addMonths, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isBefore, isAfter, parseISO } from "date-fns";
import { AGE_GROUPS } from "@workspace/brand";
import { Layout } from "@/components/layout";

const API = "/api";

function useAuthHeaders() {
  const { getToken } = useAuth();
  return useCallback(async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  }, [getToken]);
}

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
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const GENDER_OPTIONS = [
  { value: "", label: "Any" },
  { value: "men", label: "Men" },
  { value: "women", label: "Women" },
  { value: "coed", label: "Coed" },
  { value: "boy", label: "Boys" },
  { value: "girl", label: "Girls" },
];
const SKILL_OPTIONS = [
  { value: "all", label: "All Levels" },
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
];
const STEPS = ["Basics", "Schedule", "Pools", "Settings", "Review"];

// ─── Types ────────────────────────────────────────────────────────────────────

interface PoolEntry {
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

function poolFromTemplate(p: any): PoolEntry {
  const eb = p.earlyBirdPricing ?? null;
  return {
    id: p.id,
    courtId: String(p.courtId ?? ""),
    cap: String(p.cap ?? 15),
    price: String(p.price ?? "0"),
    ageGroup: p.ageGroup ?? ["adult"],
    skillLevel: p.skillLevel ?? "all",
    gender: p.gender ?? "",
    offerWindowMinutes: String(p.offerWindowMinutes ?? 240),
    earlyBirdEnabled: !!eb,
    earlyBirdPrice: eb ? String(eb.price ?? "0") : "0",
    earlyBirdTriggerType: eb?.triggerType ?? "date",
    earlyBirdTriggerDate: eb?.triggerDate ?? "",
    earlyBirdTriggerSpots: String(eb?.triggerSpotsCount ?? "5"),
    customTime: !!(p.startTime),
    startTime: p.startTime ?? "",
    durationMinutes: p.durationMinutes != null ? String(p.durationMinutes) : "",
    simplifiedRegistration: !!(p.simplifiedRegistration),
  };
}

function defaultPool(courtId = ""): PoolEntry {
  return {
    courtId,
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
  };
}

// ─── Calendar (shared with new.tsx pattern) ───────────────────────────────────

interface CalendarState {
  scheduleType: "recurring" | "one_time";
  startDate: string;
  startTime: string;
  durationMinutes: string;
  dayOfWeek: string;
  intervalNum: string;
  intervalUnit: "week" | "month";
  endCondition: string;
  endDate: string;
  endAfterN: string;
  skippedDates: string[];
}

function computeOccurrences(s: CalendarState, from: Date, to: Date): string[] {
  const skipped = new Set(s.skippedDates ?? []);
  const results: string[] = [];
  const pad = (n: number) => String(n).padStart(2, "0");
  const parseDate = (d: string) => { const [y, m, dd] = d.split("-").map(Number); return new Date(y, m - 1, dd); };
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  if (s.scheduleType === "one_time") {
    if (s.startDate && s.startDate >= fmt(from) && s.startDate <= fmt(to) && !skipped.has(s.startDate))
      results.push(s.startDate);
    return results;
  }

  let current = parseDate(s.startDate || fmt(from));
  const dow = Number(s.dayOfWeek) || 1;
  const daysToFirst = (dow - current.getDay() + 7) % 7;
  current = new Date(current.getFullYear(), current.getMonth(), current.getDate() + daysToFirst);

  const intervalNum = Number(s.intervalNum) || 1;
  const intervalUnit = s.intervalUnit ?? "week";

  let iters = 0;
  while (iters++ < 10000) {
    const dateStr = fmt(current);
    if (isAfter(current, to)) break;
    if (s.endCondition === "on_date" && s.endDate && dateStr > s.endDate) break;
    if (s.endCondition === "after_n" && s.endAfterN && results.length >= Number(s.endAfterN)) break;
    if (!isBefore(current, from) && !skipped.has(dateStr)) results.push(dateStr);
    if (intervalUnit === "month") {
      const next = new Date(current.getFullYear(), current.getMonth() + intervalNum, current.getDate());
      const diff = (dow - next.getDay() + 7) % 7;
      current = new Date(next.getFullYear(), next.getMonth(), next.getDate() + diff);
    } else {
      current = new Date(current.getFullYear(), current.getMonth(), current.getDate() + intervalNum * 7);
    }
  }
  return results;
}

function CalendarPreview({ calState, onToggleSkip }: { calState: CalendarState; onToggleSkip: (d: string) => void }) {
  const [viewMonth, setViewMonth] = useState(() => {
    if (calState.startDate) {
      const [y, m] = calState.startDate.split("-").map(Number);
      return new Date(y, m - 1, 1);
    }
    return startOfMonth(new Date());
  });

  const from = new Date();
  const to = addMonths(new Date(), 6);
  const occurrenceDates = useMemo(() => new Set(computeOccurrences(calState, from, to)), [calState]);
  const skippedSet = new Set(calState.skippedDates);

  const monthStart = startOfMonth(viewMonth);
  const monthEnd = endOfMonth(viewMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const blanks = Array.from({ length: getDay(monthStart) }, (_, i) => i);

  return (
    <div className="border rounded-lg bg-muted/30 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setViewMonth(d => addMonths(d, -1))} className="p-1 hover:bg-muted rounded">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold">{format(viewMonth, "MMMM yyyy")}</span>
        <button type="button" onClick={() => setViewMonth(d => addMonths(d, 1))} className="p-1 hover:bg-muted rounded">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {DAYS_SHORT.map(d => <div key={d} className="text-[10px] font-semibold text-muted-foreground py-0.5">{d}</div>)}
        {blanks.map(i => <div key={`b${i}`} />)}
        {days.map(day => {
          const dateStr = format(day, "yyyy-MM-dd");
          const isOcc = occurrenceDates.has(dateStr);
          const isSkip = skippedSet.has(dateStr);
          const isToday = dateStr === format(new Date(), "yyyy-MM-dd");
          return (
            <button
              key={dateStr}
              type="button"
              onClick={() => (isOcc || isSkip) ? onToggleSkip(dateStr) : undefined}
              disabled={!isOcc && !isSkip}
              className={[
                "text-xs py-1 rounded transition-colors relative",
                isToday ? "ring-1 ring-primary/50" : "",
                isOcc && !isSkip ? "bg-primary text-primary-foreground hover:bg-primary/80 cursor-pointer font-semibold" : "",
                isSkip ? "bg-muted text-muted-foreground line-through cursor-pointer" : "",
                !isOcc && !isSkip ? "text-muted-foreground/50 cursor-default" : "",
              ].join(" ")}
            >
              {format(day, "d")}
              {isSkip && <span className="absolute -top-0.5 -right-0.5 text-[8px] text-orange-400">✕</span>}
            </button>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground text-center">
        {occurrenceDates.size} session{occurrenceDates.size !== 1 ? "s" : ""} in next 6 months
        {" — Click a highlighted date to skip/restore"}
      </p>
    </div>
  );
}

// ─── Pool Card ────────────────────────────────────────────────────────────────

function PoolCard({
  pool, courts, index, onUpdate, onRemove, canRemove,
}: {
  pool: PoolEntry;
  courts: any[];
  index: number;
  onUpdate: (p: PoolEntry) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  return (
    <div className="border rounded-lg p-4 space-y-3 bg-background">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Pool {index + 1}</span>
        {canRemove && (
          <button type="button" onClick={onRemove} className="text-muted-foreground hover:text-destructive transition-colors">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

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
              <input
                type="checkbox"
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

// ─── Visibility Section ───────────────────────────────────────────────────────

function VisibilitySection({ template, getHeaders }: { template: any; getHeaders: () => Promise<any> }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const patchVisibility = useMutation({
    mutationFn: async (patch: { isPublished?: boolean; isFeatured?: boolean; showOnMobile?: boolean }) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/programs/dropin-templates/${template.id}/visibility`, {
        method: "PATCH", headers, body: JSON.stringify(patch),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Failed"); }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dropin-templates"] });
      qc.invalidateQueries({ queryKey: ["dropin-template", template.id] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const Toggle = ({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: any; label: string }) => (
    <button
      type="button"
      disabled={patchVisibility.isPending}
      onClick={onClick}
      className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded border transition-colors ${active ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border text-muted-foreground hover:bg-muted"}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <p className="text-sm font-semibold">Visibility Settings</p>
      <div className="flex items-center gap-2 flex-wrap">
        <Toggle
          active={template.isPublished && !template.isDraft}
          onClick={() => patchVisibility.mutate({ isPublished: !(template.isPublished && !template.isDraft) })}
          icon={Eye}
          label="Published"
        />
        <Toggle
          active={!!template.isFeatured}
          onClick={() => patchVisibility.mutate({ isFeatured: !template.isFeatured })}
          icon={Star}
          label="Featured"
        />
        <Toggle
          active={!!template.showOnMobile}
          onClick={() => patchVisibility.mutate({ showOnMobile: !template.showOnMobile })}
          icon={Smartphone}
          label="Mobile"
        />
      </div>
      <p className="text-xs text-muted-foreground">Featured + Mobile = appears in /programs/featured for the home screen.</p>
    </div>
  );
}

// ─── Interval preset detector ─────────────────────────────────────────────────

function detectPreset(num: number, unit: string): "weekly" | "biweekly" | "monthly" | "custom" {
  if (num === 1 && unit === "week") return "weekly";
  if (num === 2 && unit === "week") return "biweekly";
  if (num === 1 && unit === "month") return "monthly";
  return "custom";
}

// ─── Edit Wizard Form ─────────────────────────────────────────────────────────

function EditWizardForm({
  template, courts, venues, users, scope, forkFromDate, onSave, isSaving, getHeaders,
}: {
  template: any;
  courts: any[];
  venues: any[];
  users: any[];
  scope: string;
  forkFromDate?: string;
  onSave: (body: any) => void;
  isSaving: boolean;
  getHeaders: () => Promise<Record<string, string>>;
}) {
  const rule = template.recurrenceRule ?? {};
  const [currentStep, setCurrentStep] = useState(0);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [scheduledPublishAt, setScheduledPublishAt] = useState("");

  // ── Step 0: Basics ──
  const [name, setName] = useState(template.name ?? "");
  const [sport, setSport] = useState(template.sport ?? "soccer");
  const [venueId, setVenueId] = useState(String(template.venueId ?? ""));
  const [description, setDescription] = useState(template.description ?? "");
  const [imageUrl, setImageUrl] = useState(template.imageUrl ?? "");

  // ── Step 1: Schedule ──
  const [recurrenceType, setRecurrenceType] = useState<"recurring" | "one_time">(rule.type ?? "recurring");
  const [startTime, setStartTime] = useState(rule.startTime ?? "18:00");
  const [durationMinutes, setDurationMinutes] = useState(String(rule.durationMinutes ?? 120));
  const [dayOfWeek, setDayOfWeek] = useState(rule.dayOfWeek != null ? String(rule.dayOfWeek) : "5");
  const [startDate, setStartDate] = useState(rule.startDate ?? "");
  const [intervalPreset, setIntervalPreset] = useState<"weekly" | "biweekly" | "monthly" | "custom">(
    detectPreset(rule.intervalNum ?? 1, rule.intervalUnit ?? "week")
  );
  const [intervalNum, setIntervalNum] = useState(String(rule.intervalNum ?? 1));
  const [intervalUnit, setIntervalUnit] = useState<"week" | "month">(rule.intervalUnit ?? "week");
  const [endCondition, setEndCondition] = useState(rule.endCondition ?? "never");
  const [endDate, setEndDate] = useState(rule.endDate ?? "");
  const [endAfterN, setEndAfterN] = useState(String(rule.endAfterN ?? ""));
  const [skippedDates, setSkippedDates] = useState<string[]>(rule.skippedDates ?? []);

  // ── Step 2: Pools ──
  const [pools, setPools] = useState<PoolEntry[]>(
    (template.pools ?? []).map((p: any) => poolFromTemplate(p))
  );

  // ── Step 3: Registration settings ──
  const [registrationOpens, setRegistrationOpens] = useState(template.registrationOpens ?? "immediately");
  const [registrationOpensAt, setRegistrationOpensAt] = useState(template.registrationOpensAt ?? "");
  const [registrationCutoffMinutes, setRegistrationCutoffMinutes] = useState(String(template.registrationCutoffMinutes ?? ""));
  const [waitlistEnabled, setWaitlistEnabled] = useState(template.waitlistEnabled ?? true);
  const [autoPromoteEnabled, setAutoPromoteEnabled] = useState(template.autoPromoteEnabled ?? false);
  const [autoCancelThreshold, setAutoCancelThreshold] = useState(String(template.autoCancelThreshold ?? ""));
  const [staffUserId, setStaffUserId] = useState(String(template.staffUserId ?? ""));

  // ── Step 4: Conflict check ──
  const [conflictWarnings, setConflictWarnings] = useState<string[]>([]);
  useEffect(() => {
    if (currentStep !== 4) return;
    let cancelled = false;
    async function check() {
      const warnings: string[] = [];
      const headers = await getHeaders();
      const duration = Number(durationMinutes) || 120;
      const checkDate = startDate || new Date().toISOString().slice(0, 10);
      const startsAt = `${checkDate}T${startTime}:00`;
      for (const pool of pools) {
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
              warnings.push(`${courtName} has a scheduling conflict at ${startTime} on ${checkDate}`);
            }
          }
        } catch {}
      }
      if (!cancelled) setConflictWarnings(warnings);
    }
    check();
    return () => { cancelled = true; };
  }, [currentStep, pools, startTime, durationMinutes, startDate]);

  // ── Calendar state ──
  const calState: CalendarState = {
    scheduleType: recurrenceType,
    startDate,
    startTime,
    durationMinutes,
    dayOfWeek,
    intervalNum: intervalPreset === "weekly" ? "1" : intervalPreset === "biweekly" ? "2" : intervalPreset === "monthly" ? "1" : intervalNum,
    intervalUnit: intervalPreset === "monthly" ? "month" : intervalUnit,
    endCondition,
    endDate,
    endAfterN,
    skippedDates,
  };

  function toggleSkip(date: string) {
    setSkippedDates(current =>
      current.includes(date) ? current.filter(d => d !== date) : [...current, date]
    );
  }

  function getEffectiveInterval() {
    if (intervalPreset === "weekly") return { num: 1, unit: "week" as const };
    if (intervalPreset === "biweekly") return { num: 2, unit: "week" as const };
    if (intervalPreset === "monthly") return { num: 1, unit: "month" as const };
    return { num: Number(intervalNum) || 1, unit: intervalUnit };
  }

  function buildBody(action: "publish" | "schedule" | "draft", publishAt?: string) {
    const { num, unit } = getEffectiveInterval();
    const publishFields =
      action === "publish" ? { publish: true } :
      action === "schedule" ? { publish: true, publishAt: publishAt ?? null } :
      { isDraft: true };
    return {
      name,
      sport,
      venueId: venueId ? Number(venueId) : null,
      description: description || null,
      imageUrl: imageUrl || null,
      ...publishFields,
      staffUserId: staffUserId ? Number(staffUserId) : null,
      recurrenceRule: {
        type: recurrenceType,
        startTime,
        durationMinutes: Number(durationMinutes) || 120,
        startDate: startDate || rule.startDate,
        ...(recurrenceType === "recurring" ? {
          dayOfWeek: Number(dayOfWeek),
          intervalNum: num,
          intervalUnit: unit,
        } : {}),
        endCondition,
        ...(endCondition === "on_date" ? { endDate } : {}),
        ...(endCondition === "after_n" ? { endAfterN: Number(endAfterN) } : {}),
        skippedDates,
      },
      registrationOpens,
      registrationOpensAt: registrationOpensAt || null,
      registrationCutoffMinutes: registrationCutoffMinutes ? Number(registrationCutoffMinutes) : null,
      waitlistEnabled,
      autoPromoteEnabled,
      autoCancelThreshold: autoCancelThreshold ? Number(autoCancelThreshold) : null,
      pools: pools.map(p => ({
        ...(p.id ? { id: p.id } : {}),
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
          ...(p.earlyBirdTriggerType === "date"
            ? { triggerDate: p.earlyBirdTriggerDate }
            : { triggerSpotsCount: Number(p.earlyBirdTriggerSpots) }),
        } : null,
        simplifiedRegistration: Number(p.price) > 0 ? false : p.simplifiedRegistration,
      })),
    };
  }

  const canNext = currentStep < STEPS.length - 1;
  const canBack = currentStep > 0;

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-1">
        {STEPS.map((label, i) => (
          <React.Fragment key={i}>
            <button
              type="button"
              onClick={() => setCurrentStep(i)}
              className={`text-xs px-2 py-1 rounded-full font-medium transition-colors ${i === currentStep ? "bg-primary text-primary-foreground" : i < currentStep ? "bg-primary/20 text-primary" : "text-muted-foreground"}`}
            >
              {i + 1}. {label}
            </button>
            {i < STEPS.length - 1 && <div className={`h-px flex-1 ${i < currentStep ? "bg-primary/40" : "bg-border"}`} />}
          </React.Fragment>
        ))}
      </div>

      {/* ── Step 0: Basics ── */}
      {currentStep === 0 && (
        <div className="border rounded-lg p-4 space-y-4">
          <h3 className="text-sm font-semibold">Basic Info</h3>
          <div>
            <Label className="text-sm font-medium">Session Name</Label>
            <Input className="mt-1" value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div>
            <Label className="text-sm">Sport</Label>
            <div className="grid grid-cols-3 gap-2 mt-2">
              {SPORTS.map(s => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setSport(s.value)}
                  className={`text-sm py-2 px-3 rounded-lg border transition-colors text-left ${sport === s.value ? "border-primary bg-primary/10 text-primary font-semibold" : "border-input hover:bg-muted"}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-sm font-medium">Venue / Facility</Label>
            <select
              className="w-full h-10 rounded border border-input bg-background px-3 text-sm mt-1"
              value={venueId}
              onChange={e => setVenueId(e.target.value)}
            >
              <option value="">Select venue (optional)</option>
              {venues.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-sm font-medium">Description (optional)</Label>
            <textarea
              className="w-full mt-1 rounded border border-input bg-background px-3 py-2 text-sm resize-none"
              rows={3}
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-sm font-medium">Card Image URL (optional)</Label>
            <Input className="mt-1" placeholder="https://example.com/image.jpg" value={imageUrl} onChange={e => setImageUrl(e.target.value)} />
            {imageUrl && (
              <img
                src={imageUrl}
                alt="Preview"
                className="mt-2 h-24 w-full object-cover rounded-lg border"
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                onLoad={e => { (e.currentTarget as HTMLImageElement).style.display = "block"; }}
              />
            )}
          </div>
        </div>
      )}

      {/* ── Step 1: Schedule ── */}
      {currentStep === 1 && (
        <div className="border rounded-lg p-4 space-y-4">
          <h3 className="text-sm font-semibold">Schedule</h3>
          <div>
            <Label className="text-sm">Session Type</Label>
            <div className="flex gap-3 mt-2">
              {[{ v: "one_time", l: "One-time session" }, { v: "recurring", l: "Recurring series" }].map(opt => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setRecurrenceType(opt.v as any)}
                  className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${recurrenceType === opt.v ? "border-primary bg-primary/10 text-primary" : "border-input hover:bg-muted"}`}
                >
                  {opt.l}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm">{recurrenceType === "one_time" ? "Date" : "Series Start Date"}</Label>
              <Input type="date" className="mt-1" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-sm">Start Time</Label>
              <Input type="time" className="mt-1" value={startTime} onChange={e => setStartTime(e.target.value)} />
            </div>
            <div className="col-span-2">
              <Label className="text-sm">Duration</Label>
              <div className="flex gap-2 mt-1 flex-wrap">
                {[30, 60, 90, 120, 150, 180].map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setDurationMinutes(String(m))}
                    className={`px-3 py-1.5 rounded border text-xs transition-colors ${Number(durationMinutes) === m ? "border-primary bg-primary/10 text-primary font-semibold" : "border-input hover:bg-muted"}`}
                  >
                    {m < 60 ? `${m}m` : m === 60 ? "1h" : `${m / 60}h`}
                  </button>
                ))}
                <Input
                  type="number"
                  min="15"
                  max="480"
                  placeholder="Custom min"
                  className="h-8 w-28 text-xs"
                  value={Number(durationMinutes) % 30 !== 0 ? durationMinutes : ""}
                  onChange={e => setDurationMinutes(e.target.value)}
                />
              </div>
            </div>
          </div>

          {recurrenceType === "recurring" && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm">Repeats On</Label>
                  <select className="w-full h-10 rounded border border-input bg-background px-3 text-sm mt-1" value={dayOfWeek} onChange={e => setDayOfWeek(e.target.value)}>
                    {DAYS_LONG.map((d, i) => <option key={i} value={i}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-sm">Frequency</Label>
                  <select
                    className="w-full h-10 rounded border border-input bg-background px-3 text-sm mt-1"
                    value={intervalPreset}
                    onChange={e => {
                      const p = e.target.value as typeof intervalPreset;
                      setIntervalPreset(p);
                      if (p === "weekly") { setIntervalNum("1"); setIntervalUnit("week"); }
                      if (p === "biweekly") { setIntervalNum("2"); setIntervalUnit("week"); }
                      if (p === "monthly") { setIntervalNum("1"); setIntervalUnit("month"); }
                    }}
                  >
                    <option value="weekly">Every week</option>
                    <option value="biweekly">Every 2 weeks</option>
                    <option value="monthly">Monthly</option>
                    <option value="custom">Custom…</option>
                  </select>
                </div>
              </div>

              {intervalPreset === "custom" && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Every</span>
                  <Input type="number" min="1" max="52" className="h-8 w-20 text-sm" value={intervalNum} onChange={e => setIntervalNum(e.target.value)} />
                  <select className="h-8 rounded border border-input bg-background px-2 text-sm" value={intervalUnit} onChange={e => setIntervalUnit(e.target.value as any)}>
                    <option value="week">week(s)</option>
                    <option value="month">month(s)</option>
                  </select>
                </div>
              )}

              <div>
                <Label className="text-sm">Series Ends</Label>
                <div className="flex gap-3 mt-1.5">
                  {[{ v: "never", l: "Never" }, { v: "on_date", l: "On date" }, { v: "after_n", l: "After N sessions" }].map(opt => (
                    <button
                      key={opt.v}
                      type="button"
                      onClick={() => setEndCondition(opt.v)}
                      className={`flex-1 py-1.5 rounded border text-sm transition-colors ${endCondition === opt.v ? "border-primary bg-primary/10 text-primary" : "border-input hover:bg-muted"}`}
                    >
                      {opt.l}
                    </button>
                  ))}
                </div>
                {endCondition === "on_date" && (
                  <Input type="date" className="mt-2" value={endDate} onChange={e => setEndDate(e.target.value)} />
                )}
                {endCondition === "after_n" && (
                  <div className="flex items-center gap-2 mt-2">
                    <Input type="number" min="1" className="h-8 w-24" value={endAfterN} onChange={e => setEndAfterN(e.target.value)} />
                    <span className="text-sm text-muted-foreground">sessions</span>
                  </div>
                )}
              </div>
            </>
          )}

          <div>
            <Label className="text-sm mb-2 block">Calendar Preview</Label>
            <CalendarPreview calState={calState} onToggleSkip={toggleSkip} />
            {skippedDates.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1.5">
                Skipped: {skippedDates.sort().map(d => format(parseISO(d), "MMM d")).join(", ")}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Step 2: Pools ── */}
      {currentStep === 2 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Define one or more pools (courts) for each session. Pool settings apply to every occurrence in the series.</p>
          {pools.map((pool, i) => (
            <PoolCard
              key={i}
              pool={pool}
              courts={courts}
              index={i}
              onUpdate={updated => { const next = [...pools]; next[i] = updated; setPools(next); }}
              onRemove={() => setPools(pools.filter((_, j) => j !== i))}
              canRemove={pools.length > 1}
            />
          ))}
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => setPools([...pools, defaultPool(String(courts[0]?.id ?? ""))])}
          >
            <Plus className="h-4 w-4 mr-2" /> Add Pool
          </Button>
        </div>
      )}

      {/* ── Step 3: Registration settings ── */}
      {currentStep === 3 && (
        <div className="border rounded-lg p-4 space-y-5">
          <h3 className="text-sm font-semibold">Registration Settings</h3>

          <div>
            <Label className="text-sm font-semibold">Registration Opens</Label>
            <div className="flex gap-3 mt-2">
              {[
                { v: "immediately", l: "Immediately when published" },
                { v: "on_date", l: "On a specific date" },
                { v: "manual", l: "Manually (I'll open it)" },
              ].map(opt => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setRegistrationOpens(opt.v)}
                  className={`flex-1 py-2 px-3 rounded-lg border text-xs font-medium transition-colors ${registrationOpens === opt.v ? "border-primary bg-primary/10 text-primary" : "border-input hover:bg-muted"}`}
                >
                  {opt.l}
                </button>
              ))}
            </div>
            {registrationOpens === "on_date" && (
              <Input type="datetime-local" className="mt-2" value={registrationOpensAt} onChange={e => setRegistrationOpensAt(e.target.value)} />
            )}
          </div>

          <div>
            <Label className="text-sm font-semibold">Registration Cutoff</Label>
            <p className="text-xs text-muted-foreground mt-0.5">How far in advance should registration close before each session?</p>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <div className="flex gap-2">
                {[{ l: "None", v: "" }, { l: "1h", v: "60" }, { l: "2h", v: "120" }, { l: "24h", v: "1440" }, { l: "48h", v: "2880" }].map(opt => (
                  <button
                    key={opt.l}
                    type="button"
                    onClick={() => setRegistrationCutoffMinutes(opt.v)}
                    className={`px-3 py-1.5 rounded border text-xs transition-colors ${registrationCutoffMinutes === opt.v ? "border-primary bg-primary/10 text-primary font-semibold" : "border-input hover:bg-muted"}`}
                  >
                    {opt.l}
                  </button>
                ))}
              </div>
              <Input
                type="number"
                min="0"
                placeholder="Custom min"
                className="h-8 w-28 text-xs"
                value={!["", "60", "120", "1440", "2880"].includes(registrationCutoffMinutes) ? registrationCutoffMinutes : ""}
                onChange={e => setRegistrationCutoffMinutes(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-3">
            <Label className="text-sm font-semibold">Waitlist</Label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input type="checkbox" checked={waitlistEnabled} onChange={e => setWaitlistEnabled(e.target.checked)} className="h-4 w-4 accent-primary" />
              Enable waitlist when pool is full
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input type="checkbox" checked={autoPromoteEnabled} onChange={e => setAutoPromoteEnabled(e.target.checked)} disabled={!waitlistEnabled} className="h-4 w-4 accent-primary" />
              Auto-promote waitlisted players when a spot opens
            </label>
          </div>

          <div>
            <Label className="text-sm font-semibold">Auto-cancel Threshold</Label>
            <p className="text-xs text-muted-foreground mt-0.5">If fewer than this many players are registered 24h before start, automatically cancel.</p>
            <div className="flex items-center gap-2 mt-2">
              <Input type="number" min="0" placeholder="No threshold" className="h-8 w-32 text-sm" value={autoCancelThreshold} onChange={e => setAutoCancelThreshold(e.target.value)} />
              <span className="text-sm text-muted-foreground">min players (leave blank to disable)</span>
            </div>
          </div>

          <div>
            <Label className="text-sm font-semibold">Staff Assignment</Label>
            <p className="text-xs text-muted-foreground mt-0.5">Assign a coach or referee to this session.</p>
            <select
              className="w-full h-10 rounded border border-input bg-background px-3 text-sm mt-2"
              value={staffUserId}
              onChange={e => setStaffUserId(e.target.value)}
            >
              <option value="">No staff assigned</option>
              {users
                .filter((u: any) => u.roles?.includes("staff") || u.roles?.includes("coach") || u.roles?.includes("referee") || u.adminLevel)
                .map((u: any) => (
                  <option key={u.id} value={u.id}>{u.firstName} {u.lastName} ({u.email})</option>
                ))}
            </select>
          </div>
        </div>
      )}

      {/* ── Step 4: Review ── */}
      {currentStep === 4 && (
        <div className="space-y-4">
          {conflictWarnings.length > 0 && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-1">
              <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" /> Scheduling Conflicts Detected
              </p>
              {conflictWarnings.map((w, i) => <p key={i} className="text-xs text-amber-700">{w}</p>)}
              <p className="text-xs text-muted-foreground mt-1">Review conflicts before saving. You can still save to update the template.</p>
            </div>
          )}

          <div className="border rounded-lg p-4 space-y-3 bg-muted/20">
            <h3 className="text-sm font-semibold">Review</h3>
            <div className="space-y-1.5 text-sm">
              <div className="flex gap-2"><span className="text-muted-foreground w-28 shrink-0">Name</span><span className="font-medium">{name}</span></div>
              <div className="flex gap-2"><span className="text-muted-foreground w-28 shrink-0">Sport</span><span>{SPORTS.find(s => s.value === sport)?.label ?? sport}</span></div>
              {venueId && <div className="flex gap-2"><span className="text-muted-foreground w-28 shrink-0">Venue</span><span>{venues.find((v: any) => String(v.id) === venueId)?.name ?? venueId}</span></div>}
              <div className="flex gap-2">
                <span className="text-muted-foreground w-28 shrink-0">Pattern</span>
                <span>
                  {recurrenceType === "recurring"
                    ? `${DAYS_LONG[Number(dayOfWeek)]} at ${startTime} · ${intervalPreset === "weekly" ? "Weekly" : intervalPreset === "biweekly" ? "Biweekly" : intervalPreset === "monthly" ? "Monthly" : `Every ${intervalNum} ${intervalUnit}(s)`}`
                    : `One-time on ${startDate}`}
                </span>
              </div>
              <div className="flex gap-2"><span className="text-muted-foreground w-28 shrink-0">Duration</span><span>{durationMinutes} min</span></div>
              <div className="flex gap-2"><span className="text-muted-foreground w-28 shrink-0">End</span><span>{endCondition === "never" ? "Never" : endCondition === "on_date" ? `On ${endDate}` : `After ${endAfterN} sessions`}</span></div>
              {skippedDates.length > 0 && <div className="flex gap-2"><span className="text-muted-foreground w-28 shrink-0">Skipped</span><span className="text-orange-500">{skippedDates.length} date{skippedDates.length !== 1 ? "s" : ""}</span></div>}
              <div className="flex gap-2"><span className="text-muted-foreground w-28 shrink-0">Pools</span><span>{pools.length} pool{pools.length !== 1 ? "s" : ""}</span></div>
              <div className="flex gap-2"><span className="text-muted-foreground w-28 shrink-0">Reg. Opens</span><span>{registrationOpens}</span></div>
              {registrationCutoffMinutes && <div className="flex gap-2"><span className="text-muted-foreground w-28 shrink-0">Cutoff</span><span>{registrationCutoffMinutes} min before start</span></div>}
              <div className="flex gap-2"><span className="text-muted-foreground w-28 shrink-0">Waitlist</span><span>{waitlistEnabled ? "Enabled" : "Disabled"}</span></div>
              {staffUserId && <div className="flex gap-2"><span className="text-muted-foreground w-28 shrink-0">Staff</span><span>{users.find((u: any) => String(u.id) === staffUserId)?.firstName ?? staffUserId}</span></div>}
              {scope === "forward" && <div className="flex gap-2"><span className="text-muted-foreground w-28 shrink-0">Fork from</span><span className="font-medium text-amber-600">{forkFromDate}</span></div>}
            </div>
          </div>

          <div className="space-y-2">
            <Button className="w-full" onClick={() => onSave(buildBody("publish"))} disabled={isSaving}>
              <Rocket className="h-4 w-4 mr-2" />
              {isSaving ? "Saving…" : scope === "forward" ? "Fork & Publish Changes" : "Publish Now"}
            </Button>
            <Button variant="outline" className="w-full" onClick={() => setScheduleDialogOpen(true)} disabled={isSaving}>
              <Clock className="h-4 w-4 mr-2" /> Schedule Publish
            </Button>
            <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => onSave(buildBody("draft"))} disabled={isSaving}>
              <Save className="h-4 w-4 mr-2" />
              {scope === "forward" ? "Fork & Save as Draft" : "Save as Draft"}
            </Button>
          </div>

          <VisibilitySection template={template} getHeaders={getHeaders} />
        </div>
      )}

      {/* Schedule Publish Dialog */}
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
              <Button
                size="sm"
                disabled={!scheduledPublishAt || isSaving}
                onClick={() => { setScheduleDialogOpen(false); onSave(buildBody("schedule", scheduledPublishAt)); }}
              >
                Schedule
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Step navigation */}
      <div className="flex gap-3 pt-2">
        {canBack && (
          <Button type="button" variant="outline" onClick={() => setCurrentStep(s => s - 1)} className="flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        )}
        {canNext && (
          <Button type="button" className="flex-1 flex items-center gap-1" onClick={() => setCurrentStep(s => s + 1)}>
            Next <ArrowRight className="h-4 w-4" />
          </Button>
        )}
        <Link href="/admin/dropins">
          <Button type="button" variant="ghost" className="text-muted-foreground">Cancel</Button>
        </Link>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DropinEditWizard() {
  const [, params] = useRoute("/admin/dropins/:templateId/edit");
  const templateId = Number(params?.templateId);
  const getHeaders = useAuthHeaders();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();

  const searchParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const scope = (searchParams.get("scope") ?? "all") as "all" | "forward";
  const forkFromDate = searchParams.get("from") ?? undefined;

  const { data: template, isLoading } = useQuery({
    queryKey: ["dropin-template", templateId],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/dropin-templates/${templateId}`, { headers });
      return r.ok ? r.json() : null;
    },
    enabled: !!templateId,
  });

  const { data: courts = [] } = useQuery({
    queryKey: ["courts"],
    queryFn: async () => { const r = await fetch(`${API}/courts`); return r.ok ? r.json() : []; },
  });

  const { data: venues = [] } = useQuery({
    queryKey: ["venues"],
    queryFn: async () => { const r = await fetch(`${API}/venues`); return r.ok ? r.json() : []; },
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
    mutationFn: async (body: any) => {
      const headers = await getHeaders();
      const payload = scope === "forward"
        ? { ...body, scope: "forward", forkFromDate }
        : { ...body, scope: "all" };
      const r = await fetch(`${API}/dropin-templates/${templateId}`, {
        method: "PATCH", headers, body: JSON.stringify(payload),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Save failed"); }
      return r.json();
    },
    onSuccess: (_, body) => {
      qc.invalidateQueries({ queryKey: ["dropin-templates"] });
      qc.invalidateQueries({ queryKey: ["dropin-template", templateId] });
      const isDraft = body.isDraft;
      const pa = body.publishAt;
      const title = isDraft ? "Draft saved!" : pa ? "Scheduled!" : (scope === "forward" ? "Series forked & saved!" : "Changes saved!");
      const description = isDraft
        ? "Template saved as draft."
        : pa ? `Will publish on ${new Date(pa).toLocaleString()}.`
        : "Drop-in template updated.";
      toast({ title, description });
      navigate("/admin/dropins");
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <Layout>
        <div className="max-w-2xl mx-auto px-6 py-8 space-y-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
        </div>
      </Layout>
    );
  }

  if (!template) {
    return (
      <Layout>
        <div className="max-w-2xl mx-auto px-6 py-8 text-center text-muted-foreground">Template not found.</div>
      </Layout>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link href="/admin/dropins">
            <button type="button" className="text-muted-foreground hover:text-foreground transition-colors">
              <ChevronLeft className="h-5 w-5" />
            </button>
          </Link>
          <div>
            <h1 className="font-bold text-lg">Edit: {template.name}</h1>
            <p className="text-xs text-muted-foreground">
              {scope === "forward" ? `Editing from ${forkFromDate} forward (will fork series)` : "Editing all sessions in series"}
            </p>
          </div>
          {scope === "forward" && <Badge variant="secondary" className="ml-auto text-xs">Fork from {forkFromDate}</Badge>}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        <EditWizardForm
          template={template}
          courts={courts}
          venues={venues}
          users={users}
          scope={scope}
          forkFromDate={forkFromDate}
          onSave={(body) => save.mutate(body)}
          isSaving={save.isPending}
          getHeaders={getHeaders}
        />
      </div>
    </div>
  );
}
