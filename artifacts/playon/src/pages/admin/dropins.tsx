/**
 * Admin Drop-in List — grouped view
 *
 * Section A: New-style series/templates (from GET /dropin-templates)
 *   Each template row shows: series name, sport, venue, next 3 occurrence dates
 *   with a fill bar per pool, and quick-action controls.
 *   "Manage dates" opens a bulk calendar sheet.
 *
 * Section B: Legacy standalone sessions (from GET /dropins, not linked to a new template)
 *   Flat list with the same basic controls.
 */

import React, { useState, useCallback } from "react";
import { Redirect, Link, useLocation } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { useAdminPermissions } from "@/hooks/use-admin-permissions";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { useToast } from "@/hooks/use-toast";
import { format, addMonths, startOfMonth, endOfMonth, eachDayOfInterval, getDay, parseISO } from "date-fns";
import {
  Plus, Pencil, Trash2, CalendarDays, ClipboardList, ChevronDown, ChevronUp,
  Lock, Unlock, RefreshCw, Repeat, SkipForward, Copy, CalendarX, Settings,
  ChevronLeft, ChevronRight, Users, Activity, Filter, Star, Smartphone, Eye, XCircle,
  DollarSign,
} from "lucide-react";
import { EventSplitPanel } from "@/components/event-split-panel";

const API = "/api";

function useAuthHeaders() {
  const { getToken } = useAuth();
  return useCallback(async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  }, [getToken]);
}

const SPORT_EMOJIS: Record<string, string> = {
  basketball: "🏀", soccer: "⚽", volleyball: "🏐", tennis: "🎾",
  pickleball: "🏓", badminton: "🏸", hockey: "🏒", baseball: "⚾",
  football: "🏈", softball: "🥎", lacrosse: "🥍", swimming: "🏊", other: "🏃",
};

// ─── Fill Bar ─────────────────────────────────────────────────────────────────

function FillBar({ taken, cap }: { taken: number; cap: number }) {
  const pct = cap > 0 ? Math.min(100, Math.round((taken / cap) * 100)) : 0;
  const color = pct >= 100 ? "bg-red-500" : pct >= 75 ? "bg-orange-400" : pct >= 50 ? "bg-yellow-400" : "bg-emerald-500";
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={pct >= 100 ? "text-red-500 font-medium" : "text-muted-foreground"}>{taken}/{cap}</span>
    </div>
  );
}

// ─── Bulk Date Manager ────────────────────────────────────────────────────────

function BulkDateManager({ template, onClose }: { template: any; onClose: () => void }) {
  const getHeaders = useAuthHeaders();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [viewMonth, setViewMonth] = useState(startOfMonth(new Date()));
  const rule = template.recurrenceRule ?? {};
  const skippedDates: string[] = rule.skippedDates ?? [];

  const upcomingDates = new Set<string>(
    (template.upcomingOccurrences ?? []).map((o: any) => o.occurrenceDate)
  );

  const days = eachDayOfInterval({ start: startOfMonth(viewMonth), end: endOfMonth(viewMonth) });
  const firstDayOfWeek = getDay(startOfMonth(viewMonth));
  const blanks = Array.from({ length: firstDayOfWeek });

  const toggleSkip = useMutation({
    mutationFn: async ({ date, unskip }: { date: string; unskip: boolean }) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/dropin-occurrences/${template.id}/${date}/skip`, {
        method: "POST", headers, body: JSON.stringify({ unskip }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["dropin-templates"] }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setViewMonth(d => addMonths(d, -1))} className="p-1.5 hover:bg-muted rounded"><ChevronLeft className="h-4 w-4" /></button>
        <span className="font-semibold text-sm">{format(viewMonth, "MMMM yyyy")}</span>
        <button type="button" onClick={() => setViewMonth(d => addMonths(d, 1))} className="p-1.5 hover:bg-muted rounded"><ChevronRight className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] font-semibold text-muted-foreground pb-1">
        {["S","M","T","W","T","F","S"].map((d, i) => <div key={i}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {blanks.map((_, i) => <div key={`b${i}`} />)}
        {days.map(day => {
          const dateStr = format(day, "yyyy-MM-dd");
          const isOccurrence = upcomingDates.has(dateStr);
          const isSkipped = skippedDates.includes(dateStr);
          return (
            <button
              key={dateStr}
              type="button"
              disabled={!isOccurrence && !isSkipped}
              onClick={() => (isOccurrence || isSkipped) && toggleSkip.mutate({ date: dateStr, unskip: isSkipped })}
              className={[
                "text-xs py-1.5 rounded transition-colors",
                isOccurrence && !isSkipped ? "bg-primary text-primary-foreground font-semibold hover:bg-primary/80 cursor-pointer" : "",
                isSkipped ? "bg-muted text-muted-foreground line-through cursor-pointer hover:bg-muted/80" : "",
                !isOccurrence && !isSkipped ? "text-muted-foreground/40 cursor-default" : "",
              ].join(" ")}
            >
              {format(day, "d")}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground text-center">Click a date to skip or restore it. Skipped = strikethrough.</p>
    </div>
  );
}

// ─── Override Dialog (per-occurrence quick edits) ─────────────────────────────

function OccurrenceOverrideDialog({ template, occurrence, onClose }: { template: any; occurrence: any; onClose: () => void }) {
  const getHeaders = useAuthHeaders();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [cancelReason, setCancelReason] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);

  const callOverride = async (body: any) => {
    const headers = await getHeaders();
    const r = await fetch(`${API}/dropin-occurrences/${template.id}/${occurrence.occurrenceDate}/override`, {
      method: "POST", headers, body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error("Failed");
    return r.json();
  };

  // Field-level override (cap, price, registrationOpen) — stays open after success
  const setField = useMutation({
    mutationFn: callOverride,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dropin-templates"] });
      toast({ title: "Override saved", description: "This date has been updated." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Cancel — closes after success
  const cancel = useMutation({
    mutationFn: callOverride,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dropin-templates"] });
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const pools: any[] = occurrence.pools ?? template.pools ?? [];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Session on <strong>{format(parseISO(occurrence.occurrenceDate), "EEEE, MMMM d, yyyy")}</strong>
      </p>

      {/* Per-pool overrides: cap / price / registration toggle */}
      {pools.length > 0 && (
        <div className="space-y-3">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Pool Overrides</p>
          {pools.map((pool: any) => {
            const regOpen = pool.registrationOpen !== false;
            return (
              <div key={pool.id} className="border border-border rounded-lg p-3 space-y-2">
                <p className="text-xs font-medium">{pool.courtName ?? `Pool ${pool.id}`}</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wide block mb-0.5">Cap</label>
                    <input
                      type="number" min={1} defaultValue={pool.cap ?? 20}
                      className="w-full h-7 text-xs bg-muted border border-border rounded px-2 focus:outline-none focus:ring-1 focus:ring-primary"
                      onBlur={(e) => {
                        const val = parseInt(e.currentTarget.value, 10);
                        if (!isNaN(val) && val > 0) setField.mutate({ field: "cap", value: val, templatePoolId: pool.id });
                      }}
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wide block mb-0.5">Price ($)</label>
                    <input
                      type="number" min={0} step="0.01" defaultValue={Number(pool.price ?? 0).toFixed(2)}
                      className="w-full h-7 text-xs bg-muted border border-border rounded px-2 focus:outline-none focus:ring-1 focus:ring-primary"
                      onBlur={(e) => {
                        const val = parseFloat(e.currentTarget.value);
                        if (!isNaN(val) && val >= 0) setField.mutate({ field: "price", value: val, templatePoolId: pool.id });
                      }}
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Registration open</span>
                  <button
                    type="button"
                    disabled={setField.isPending}
                    onClick={() => setField.mutate({ field: "registrationOpen", value: !regOpen, templatePoolId: pool.id })}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${regOpen ? "bg-emerald-500" : "bg-muted-foreground/30"}`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${regOpen ? "translate-x-4" : "translate-x-0.5"}`} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Cancel this date */}
      {!confirmCancel ? (
        <Button variant="destructive" className="w-full" onClick={() => setConfirmCancel(true)}>
          <CalendarX className="h-4 w-4 mr-2" /> Cancel This Date
        </Button>
      ) : (
        <div className="space-y-2 border border-destructive/30 rounded p-3">
          <p className="text-sm font-medium text-destructive">Confirm cancellation</p>
          <Input placeholder="Cancellation reason (optional)" value={cancelReason} onChange={e => setCancelReason(e.target.value)} />
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" onClick={() => cancel.mutate({ cancel: true, cancelReason })} disabled={cancel.isPending}>
              {cancel.isPending ? "Cancelling…" : "Confirm cancel"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmCancel(false)}>Keep</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Drop-in Roster Dialog (with guest badge + email) ─────────────────────────

function DropinRosterDialog({ dropinId, occurrenceDate, onClose }: { dropinId: number; occurrenceDate?: string; onClose: () => void }) {
  const getHeaders = useAuthHeaders();

  const { data, isLoading } = useQuery({
    queryKey: ["checkin-view-roster", dropinId],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/dropins/${dropinId}/checkin`, { headers });
      if (!r.ok) throw new Error("Failed to load roster");
      return r.json();
    },
    staleTime: 30000,
  });

  const pools: any[] = data?.pools ?? [];
  const allSpots = pools.flatMap((pw: any) =>
    (pw.spots ?? []).map((s: any) => ({ ...s, _poolLabel: pw.pool ? `Court #${pw.pool.courtId}` : "Pool" }))
  );
  const active = allSpots.filter((s: any) => !s.waitlisted);
  const waitlisted = allSpots.filter((s: any) => s.waitlisted);

  const PAYMENT_LABELS: Record<string, string> = {
    unpaid: "Owes",
    paid_inapp: "Paid",
    paid_external: "Paid (ext.)",
    refunded: "Refunded",
    waived: "Waived",
  };

  function SpotItem({ spot }: { spot: any }) {
    const isGuest = !spot.userId && (spot.guestName || spot.guestEmail);
    const name = [spot.userFirstName, spot.userLastName].filter(Boolean).join(" ") || spot.guestName || spot.guestEmail || "Guest";
    return (
      <div className="flex items-center justify-between py-2 px-3 rounded-md bg-muted/40 text-sm">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            {spot.waitlisted && <span className="text-orange-400 text-xs font-medium">#{spot.waitlistPosition}</span>}
            <span className="font-medium text-sm truncate">{name}</span>
            {isGuest && (
              <Badge variant="outline" className="text-xs px-1 py-0 border-blue-400 text-blue-600 dark:text-blue-400">Guest</Badge>
            )}
            {spot.checkedIn && (
              <Badge variant="secondary" className="text-xs px-1 py-0 text-green-600">✓ In</Badge>
            )}
          </div>
          {isGuest && spot.guestEmail && (
            <p className="text-xs text-muted-foreground mt-0.5">{spot.guestEmail}</p>
          )}
          <p className="text-[10px] text-muted-foreground">{spot._poolLabel} · {PAYMENT_LABELS[spot.paymentStatus] ?? spot.paymentStatus}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
      {occurrenceDate && (
        <p className="text-xs text-muted-foreground">{format(parseISO(occurrenceDate), "EEEE, MMMM d, yyyy")}</p>
      )}
      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-12 rounded-md bg-muted animate-pulse" />)}</div>
      ) : allSpots.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No registrations yet.</p>
      ) : (
        <>
          {active.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Registered ({active.length})</p>
              {active.map((s: any) => <SpotItem key={s.id} spot={s} />)}
            </div>
          )}
          {waitlisted.length > 0 && (
            <div className="space-y-1 mt-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Waitlist ({waitlisted.length})</p>
              {waitlisted.map((s: any) => <SpotItem key={s.id} spot={s} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Scope Picker Dialog ──────────────────────────────────────────────────────

function ScopePickerDialog({ template, occurrence, onClose }: { template: any; occurrence: any | null; onClose: () => void }) {
  const [, navigate] = useLocation();
  const [scope, setScope] = useState<"single" | "forward" | "all">("all");
  const [showOverride, setShowOverride] = useState(false);

  if (showOverride && occurrence) {
    return (
      <div className="space-y-4">
        <button type="button" className="text-xs text-muted-foreground flex items-center gap-1 hover:text-foreground" onClick={() => setShowOverride(false)}>
          <ChevronLeft className="h-3 w-3" /> Back
        </button>
        <OccurrenceOverrideDialog template={template} occurrence={occurrence} onClose={onClose} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">What would you like to edit?</p>
      <div className="space-y-2">
        {occurrence && (
          <button type="button" onClick={() => setScope("single")} className={`w-full text-left p-3 rounded-lg border transition-colors ${scope === "single" ? "border-primary bg-primary/10" : "border-input hover:bg-muted"}`}>
            <p className="text-sm font-semibold">Just this session</p>
            <p className="text-xs text-muted-foreground">{occurrence.occurrenceDate ? format(parseISO(occurrence.occurrenceDate), "EEE, MMM d") : "Selected date"} — cancel, cap or price override</p>
          </button>
        )}
        {occurrence && (
          <button type="button" onClick={() => setScope("forward")} className={`w-full text-left p-3 rounded-lg border transition-colors ${scope === "forward" ? "border-primary bg-primary/10" : "border-input hover:bg-muted"}`}>
            <p className="text-sm font-semibold">From here forward</p>
            <p className="text-xs text-muted-foreground">Creates a new series starting from this date</p>
          </button>
        )}
        <button type="button" onClick={() => setScope("all")} className={`w-full text-left p-3 rounded-lg border transition-colors ${scope === "all" ? "border-primary bg-primary/10" : "border-input hover:bg-muted"}`}>
          <p className="text-sm font-semibold">All sessions in series</p>
          <p className="text-xs text-muted-foreground">Edits apply to every future occurrence</p>
        </button>
      </div>
      <Button className="w-full" onClick={() => {
        if (scope === "single" && occurrence) { setShowOverride(true); return; }
        navigate(`/admin/dropins/${template.id}/edit?scope=${scope}${occurrence ? `&from=${occurrence.occurrenceDate}` : ""}`);
        onClose();
      }}>
        Continue
      </Button>
    </div>
  );
}

// ─── Visibility Toggle Group for Templates ────────────────────────────────────

function TemplateVisibilityToggles({ template }: { template: any }) {
  const getHeaders = useAuthHeaders();
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dropin-templates"] }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const Toggle = ({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: any; label: string }) => (
    <button
      type="button"
      title={label}
      disabled={patchVisibility.isPending}
      onClick={onClick}
      className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded border transition-colors ${active ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border text-muted-foreground hover:bg-muted"}`}
    >
      <Icon className="h-2.5 w-2.5" />
      {label}
    </button>
  );

  return (
    <div className="flex items-center gap-1 flex-wrap">
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
  );
}

// ─── Template Series Row ──────────────────────────────────────────────────────

function TemplateSeriesRow({ template, onDelete, onDuplicate, isSuperAdmin }: {
  template: any;
  onDelete: () => void;
  onDuplicate: () => void;
  isSuperAdmin: boolean;
}) {
  const getHeaders = useAuthHeaders();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<null | "dates" | "revenue-split">(null);
  const [manageDatesOpen, setManageDatesOpen] = useState(false);
  const [scopeOpen, setScopeOpen] = useState<{ occurrence: any | null } | null>(null);
  const [cancelSessionOcc, setCancelSessionOcc] = useState<any | null>(null);
  const [rosterOcc, setRosterOcc] = useState<{ dropinId: number; occurrenceDate: string } | null>(null);

  const upcomingOccurrences: any[] = template.upcomingOccurrences ?? [];
  const pools: any[] = template.pools ?? [];
  const rule = template.recurrenceRule ?? {};
  const sport = template.sport ?? "other";

  const toggleReg = useMutation({
    mutationFn: async ({ occurrenceDate, poolId, value }: { occurrenceDate: string; poolId: number; value: boolean }) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/dropin-occurrences/${template.id}/${occurrenceDate}/override`, {
        method: "POST", headers,
        body: JSON.stringify({ field: "registrationOpen", value, templatePoolId: poolId }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dropin-templates"] }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const adjustCap = useMutation({
    mutationFn: async ({ occurrenceDate, poolId, cap }: { occurrenceDate: string; poolId: number; cap: number }) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/dropin-occurrences/${template.id}/${occurrenceDate}/override`, {
        method: "POST", headers,
        body: JSON.stringify({ field: "cap", value: cap, templatePoolId: poolId }),
      });
      if (!r.ok) throw new Error("Failed");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dropin-templates"] }),
  });

  const cancelSession = useMutation({
    mutationFn: async (dropinId: number) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/admin/cancellations/dropin`, {
        method: "POST", headers,
        body: JSON.stringify({ dropinId, cancellationReason: "Admin cancelled session" }),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error ?? "Failed to cancel session"); }
      return r.json();
    },
    onSuccess: () => {
      setCancelSessionOcc(null);
      qc.invalidateQueries({ queryKey: ["dropin-templates"] });
      toast({ title: "Session cancelled", description: "All registered players have been notified." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const statusColor = template.isDraft ? "bg-yellow-500/20 text-yellow-600 border-yellow-500/20" : template.isPublished ? "bg-emerald-500/20 text-emerald-600 border-emerald-500/20" : "bg-muted text-muted-foreground border-muted";
  const statusLabel = template.isDraft ? "Draft" : template.isPublished ? "Published" : "Unpublished";

  return (
    <>
      <div className="border rounded-xl overflow-hidden">
        {/* Header row */}
        <div className="flex items-center gap-3 px-4 py-3 bg-card">
          <span className="text-2xl">{SPORT_EMOJIS[sport] ?? "🏃"}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-sm truncate">{template.name}</p>
              <Badge variant="outline" className={`text-xs border ${statusColor}`}>{statusLabel}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {template.recurrenceDescription ?? (rule.type === "one_time" ? "One-time session" : "Recurring series")}
              {pools.length > 0 && ` · ${pools.length} pool${pools.length !== 1 ? "s" : ""}`}
            </p>
            <div className="mt-1.5">
              <TemplateVisibilityToggles template={template} />
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit series" onClick={() => setScopeOpen({ occurrence: null })}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Duplicate series" onClick={onDuplicate}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Manage dates" onClick={() => setManageDatesOpen(true)}>
              <CalendarDays className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive/70 hover:text-destructive hover:bg-destructive/10" title="Delete" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={`h-7 w-7 ${expanded === "revenue-split" ? "text-primary bg-primary/10" : ""}`}
              title="Revenue Split"
              onClick={() => setExpanded(v => v === "revenue-split" ? null : "revenue-split")}
            >
              <DollarSign className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setExpanded(v => v === "dates" ? null : "dates")}>
              {expanded === "dates" ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>

        {/* Upcoming occurrence rows */}
        {upcomingOccurrences.slice(0, expanded === "dates" ? undefined : 3).map((occ: any) => (
          <div key={occ.id} className="border-t px-4 py-2.5 flex items-center gap-3 hover:bg-muted/30 transition-colors group">
            <div className="w-24 shrink-0">
              <p className="text-xs font-semibold">{format(parseISO(occ.occurrenceDate), "EEE, MMM d")}</p>
              <p className="text-[10px] text-muted-foreground">{rule.startTime ? `${rule.startTime} · ` : ""}{rule.durationMinutes}min</p>
            </div>
            <div className="flex-1 flex flex-wrap gap-2">
              {(occ.pools ?? pools).map((pool: any) => {
                const regOpen = pool.registrationOpen !== false;
                return (
                  <div key={pool.id} className="flex flex-col gap-0.5">
                    <FillBar taken={pool.spotsTaken ?? 0} cap={pool.cap ?? 0} />
                    <div className="flex items-center gap-1">
                      <p className="text-[10px] text-muted-foreground">
                        {Number(pool.price ?? 0) > 0 ? `$${Number(pool.price).toFixed(2)}` : "Free"}
                        {pool.gender ? ` · ${pool.gender}` : ""}
                      </p>
                      {/* Inline cap adjustment — visible on row hover */}
                      <input
                        type="number"
                        min={1}
                        defaultValue={pool.cap ?? 0}
                        title="Adjust cap for this occurrence"
                        className="opacity-0 group-hover:opacity-100 transition-opacity w-10 h-4 text-[10px] bg-muted border border-border rounded px-1 text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        onBlur={(e) => {
                          const val = parseInt(e.currentTarget.value, 10);
                          if (!isNaN(val) && val > 0 && val !== pool.cap) {
                            adjustCap.mutate({ occurrenceDate: occ.occurrenceDate, poolId: pool.id, cap: val });
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                      />
                      <button
                        type="button"
                        title={regOpen ? "Close registration" : "Open registration"}
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => toggleReg.mutate({ occurrenceDate: occ.occurrenceDate, poolId: pool.id, value: !regOpen })}
                      >
                        {regOpen
                          ? <Unlock className="h-2.5 w-2.5 text-emerald-500" />
                          : <Lock className="h-2.5 w-2.5 text-muted-foreground" />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <Button variant="ghost" size="icon" className="h-6 w-6" title="Edit this occurrence" onClick={() => setScopeOpen({ occurrence: occ })}>
                <Pencil className="h-3 w-3" />
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6" title="Skip this date" onClick={() => {
                getHeaders().then(h => fetch(`${API}/dropin-occurrences/${template.id}/${occ.occurrenceDate}/skip`, { method: "POST", headers: h, body: JSON.stringify({ unskip: false }) })).then(() => qc.invalidateQueries({ queryKey: ["dropin-templates"] }));
              }}>
                <SkipForward className="h-3 w-3" />
              </Button>
              {occ.materializedDropinId ? (
                <>
                  <Button
                    variant="ghost" size="icon" className="h-6 w-6"
                    title="View registered players"
                    onClick={() => setRosterOcc({ dropinId: occ.materializedDropinId, occurrenceDate: occ.occurrenceDate })}
                  >
                    <Users className="h-3 w-3" />
                  </Button>
                  <Link href={`/admin/dropins/${occ.materializedDropinId}/attendance`}>
                    <Button variant="ghost" size="icon" className="h-6 w-6" title="Attendance history">
                      <ClipboardList className="h-3 w-3" />
                    </Button>
                  </Link>
                  <Button
                    variant="ghost" size="icon"
                    className="h-6 w-6 text-destructive/60 hover:text-destructive hover:bg-destructive/10"
                    title="Cancel session — refunds all registered players"
                    onClick={() => setCancelSessionOcc(occ)}
                  >
                    <XCircle className="h-3 w-3" />
                  </Button>
                </>
              ) : (
                <Button variant="ghost" size="icon" className="h-6 w-6" title="Attendance (available after first registration)" disabled>
                  <ClipboardList className="h-3 w-3 opacity-30" />
                </Button>
              )}
            </div>
          </div>
        ))}

        {upcomingOccurrences.length === 0 && (
          <div className="border-t px-4 py-3 text-xs text-muted-foreground italic">
            No upcoming occurrences in the next 14 days. Check recurrence rule or end date.
          </div>
        )}

        {expanded !== "dates" && upcomingOccurrences.length > 3 && (
          <button type="button" onClick={() => setExpanded("dates")} className="w-full border-t px-4 py-2 text-xs text-muted-foreground hover:bg-muted/30 transition-colors text-center">
            Show {upcomingOccurrences.length - 3} more dates…
          </button>
        )}

        {/* Revenue Split panel */}
        {expanded === "revenue-split" && (
          <EventSplitPanel
            offeringType="drop_in"
            offeringId={template.id}
            venueId={template.venueId ?? null}
            eventName={template.name}
            isSuperAdmin={isSuperAdmin}
          />
        )}
      </div>

      {/* Manage Dates Dialog */}
      <Dialog open={manageDatesOpen} onOpenChange={setManageDatesOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Manage Dates — {template.name}</DialogTitle>
            <DialogDescription>Click a date to skip or restore it.</DialogDescription>
          </DialogHeader>
          <BulkDateManager template={template} onClose={() => setManageDatesOpen(false)} />
        </DialogContent>
      </Dialog>

      {/* Scope Picker / Edit Dialog */}
      <Dialog open={!!scopeOpen} onOpenChange={open => !open && setScopeOpen(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Drop-in</DialogTitle>
          </DialogHeader>
          {scopeOpen && <ScopePickerDialog template={template} occurrence={scopeOpen.occurrence} onClose={() => setScopeOpen(null)} />}
        </DialogContent>
      </Dialog>

      {/* Cancel Session Confirmation Dialog */}
      <Dialog open={!!cancelSessionOcc} onOpenChange={open => !open && setCancelSessionOcc(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Cancel Session</DialogTitle>
            <DialogDescription>
              {cancelSessionOcc && (
                <>
                  Cancel <strong>{format(parseISO(cancelSessionOcc.occurrenceDate), "EEEE, MMMM d")}</strong>?
                  All registered players will be removed from their spots. Paid spots will be processed for refunds per policy.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelSessionOcc(null)} disabled={cancelSession.isPending}>
              Keep session
            </Button>
            <Button
              variant="destructive"
              onClick={() => cancelSessionOcc?.materializedDropinId && cancelSession.mutate(cancelSessionOcc.materializedDropinId)}
              disabled={cancelSession.isPending}
            >
              {cancelSession.isPending ? "Cancelling…" : "Cancel session"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Roster Dialog */}
      <Dialog open={!!rosterOcc} onOpenChange={open => !open && setRosterOcc(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" /> Registrations
            </DialogTitle>
            <DialogDescription>
              Registered players for this session. Guest sign-ups are tagged with a "Guest" badge.
            </DialogDescription>
          </DialogHeader>
          {rosterOcc && (
            <DropinRosterDialog
              dropinId={rosterOcc.dropinId}
              occurrenceDate={rosterOcc.occurrenceDate}
              onClose={() => setRosterOcc(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Legacy Dropin Edit Panel ─────────────────────────────────────────────────

function LegacyEditPanel({ dropin, onClose }: { dropin: any; onClose: () => void }) {
  const getHeaders = useAuthHeaders();
  const { toast } = useToast();
  const qc = useQueryClient();

  const pools: any[] = dropin.pools ?? [];
  const freePools = pools.filter((p: any) => Number(p.price ?? 0) === 0);
  const isLegacy = pools.length === 0;

  const [saving, setSaving] = useState<number | null>(null);
  const [maxPlayers, setMaxPlayers] = useState(String(dropin.maxPlayers ?? ""));
  const [savingCap, setSavingCap] = useState(false);
  const [poolCaps, setPoolCaps] = useState<Record<number, string>>(() =>
    Object.fromEntries(pools.map((p: any) => [p.id, p.cap != null ? String(p.cap) : ""]))
  );
  const [savingPoolCap, setSavingPoolCap] = useState<Set<number>>(new Set());

  async function saveMaxPlayers() {
    setSavingCap(true);
    try {
      const headers = await getHeaders();
      const r = await fetch(`${API}/dropins/${dropin.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ maxPlayers: maxPlayers ? Number(maxPlayers) : null }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error ?? "Failed to update");
      }
      qc.invalidateQueries({ queryKey: ["dropins-admin"] });
      toast({ title: "Saved", description: "Spot cap updated." });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSavingCap(false);
    }
  }

  async function savePoolCap(pool: any) {
    setSavingPoolCap(prev => new Set(prev).add(pool.id));
    try {
      const headers = await getHeaders();
      const capVal = poolCaps[pool.id];
      const r = await fetch(`${API}/dropins/${dropin.id}/pools/${pool.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ cap: capVal ? Number(capVal) : null }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error ?? "Failed to update");
      }
      qc.invalidateQueries({ queryKey: ["dropins-admin"] });
      toast({ title: "Saved", description: "Spot cap updated." });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSavingPoolCap(prev => { const next = new Set(prev); next.delete(pool.id); return next; });
    }
  }

  async function toggleSimplified(pool: any) {
    setSaving(pool.id);
    try {
      const headers = await getHeaders();
      const r = await fetch(`${API}/dropins/${dropin.id}/pools/${pool.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ simplifiedRegistration: !(pool.simplifiedRegistration ?? false) }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error ?? "Failed to update");
      }
      qc.invalidateQueries({ queryKey: ["dropins-admin"] });
      toast({ title: "Saved", description: "Simplified registration updated." });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-semibold">{dropin.name}</p>
        <p className="text-xs text-muted-foreground">
          {dropin.startsAt ? format(new Date(dropin.startsAt), "EEE, MMM d · h:mm a") : "Date TBD"}
        </p>
      </div>

      {isLegacy && (
        <div className="border rounded-lg p-3 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Spot Cap</p>
          <p className="text-xs text-muted-foreground">Maximum number of players allowed to register for this session.</p>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min="1"
              placeholder="No limit"
              className="h-8 w-32 text-sm"
              value={maxPlayers}
              onChange={e => setMaxPlayers(e.target.value)}
            />
            <Button size="sm" className="h-8" onClick={saveMaxPlayers} disabled={savingCap}>
              {savingCap ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Simplified Registration</p>
        {pools.length === 0 && (
          <p className="text-xs text-muted-foreground italic">No pools configured for this session.</p>
        )}
        {pools.map((pool: any) => {
          const isFree = Number(pool.price ?? 0) === 0;
          const enabled = !!(pool.simplifiedRegistration ?? false);
          return (
            <div key={pool.id} className="border border-border rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium">Court #{pool.courtId} pool</p>
                  <p className="text-[10px] text-muted-foreground">{isFree ? "Free" : `$${Number(pool.price).toFixed(2)}`}</p>
                </div>
                {isFree ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">{enabled ? "On" : "Off"}</span>
                    <button
                      type="button"
                      disabled={saving === pool.id}
                      onClick={() => toggleSimplified(pool)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${enabled ? "bg-emerald-500" : "bg-muted-foreground/30"}`}
                    >
                      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${enabled ? "translate-x-4" : "translate-x-0.5"}`} />
                    </button>
                  </div>
                ) : (
                  <span className="text-[10px] text-muted-foreground italic">Paid pools only</span>
                )}
              </div>
              {enabled && (
                <p className="text-[10px] text-emerald-600 bg-emerald-50 rounded px-2 py-1">
                  Guests can register with name + email only
                </p>
              )}
              <div className="pt-1 border-t border-border/50">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Spot Cap</p>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="1"
                    placeholder="No limit"
                    className="h-7 w-28 text-xs"
                    value={poolCaps[pool.id] ?? ""}
                    onChange={e => setPoolCaps(prev => ({ ...prev, [pool.id]: e.target.value }))}
                  />
                  <Button
                    size="sm"
                    className="h-7 text-xs px-2"
                    onClick={() => savePoolCap(pool)}
                    disabled={savingPoolCap.has(pool.id)}
                  >
                    {savingPoolCap.has(pool.id) ? "Saving…" : "Save"}
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
        {pools.length > 0 && freePools.length === 0 && (
          <p className="text-xs text-muted-foreground italic">All pools are paid. Simplified registration is only available on $0 pools.</p>
        )}
      </div>

      <Button variant="outline" className="w-full" onClick={onClose}>Close</Button>
    </div>
  );
}

// ─── Legacy Dropin Row ────────────────────────────────────────────────────────

function LegacyDropinRow({ dropin }: { dropin: any }) {
  const spotsUsed = dropin.spotsTaken ?? 0;
  const spotsTotal = dropin.spotsTotal ?? dropin.maxPlayers ?? 0;
  const pct = spotsTotal > 0 ? Math.min(100, Math.round((spotsUsed / spotsTotal) * 100)) : 0;

  const [cancelDialog, setCancelDialog] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [editDialog, setEditDialog] = useState(false);
  const getHeaders = useAuthHeaders();
  const { toast } = useToast();
  const qc = useQueryClient();

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/dropins/${dropin.id}/cancel`, { method: "PATCH", headers });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? "Cancel failed");
      }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dropins-admin"] });
      setCancelDialog(false);
      toast({ title: "Session cancelled", description: `${dropin.name} has been cancelled.` });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/dropins/${dropin.id}`, { method: "DELETE", headers });
      if (r.status === 409) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? "Delete blocked");
      }
      if (!r.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dropins-admin"] });
      setDeleteDialog(false);
      toast({ title: "Session deleted", description: `${dropin.name} has been permanently deleted.` });
    },
    onError: (e: any) => {
      setDeleteDialog(false);
      toast({ title: "Cannot delete", description: e.message, variant: "destructive" });
    },
  });

  const isCancelled = dropin.status === "cancelled";

  return (
    <>
      <div className="border rounded-lg flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{dropin.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {dropin.startsAt ? format(new Date(dropin.startsAt), "EEE, MMM d · h:mm a") : "Date TBD"}
            {" · "}<span className={dropin.registrationOpen ? "text-emerald-600" : "text-muted-foreground"}>{dropin.registrationOpen ? "Open" : "Closed"}</span>
            {" · "}<Badge variant="outline" className="text-[10px]">{dropin.status}</Badge>
          </p>
          <div className="flex items-center gap-1.5 mt-1">
            <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden">
              <div className={`h-full rounded-full ${pct >= 100 ? "bg-red-500" : pct >= 75 ? "bg-orange-400" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs text-muted-foreground">{spotsUsed}/{spotsTotal}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Link href={`/admin/dropins/${dropin.id}/checkin`}>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1"><Activity className="h-3 w-3" />Check-in</Button>
          </Link>
          <Link href={`/admin/dropins/${dropin.id}/attendance`}>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1"><ClipboardList className="h-3 w-3" />Roster</Button>
          </Link>
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setEditDialog(true)}>
            <Settings className="h-3 w-3" />Edit
          </Button>
          {!isCancelled && (
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-orange-600 hover:text-orange-700 hover:bg-orange-50" onClick={() => setCancelDialog(true)}>
              <XCircle className="h-3 w-3" />Cancel
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => setDeleteDialog(true)}>
            <Trash2 className="h-3 w-3" />Delete
          </Button>
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={editDialog} onOpenChange={open => !open && setEditDialog(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Session</DialogTitle>
            <DialogDescription>Manage settings for this legacy drop-in session.</DialogDescription>
          </DialogHeader>
          <LegacyEditPanel dropin={dropin} onClose={() => setEditDialog(false)} />
        </DialogContent>
      </Dialog>

      {/* Cancel Confirmation Dialog */}
      <Dialog open={cancelDialog} onOpenChange={open => !open && setCancelDialog(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Cancel session?</DialogTitle>
            <DialogDescription>
              This will mark <strong>{dropin.name}</strong> as cancelled and close registration.
              {spotsUsed > 0 && (
                <span className="block mt-2 text-orange-700 font-medium">
                  Warning: {spotsUsed} registered spot{spotsUsed !== 1 ? "s" : ""} will be cancelled and players will be notified.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelDialog(false)} disabled={cancelMutation.isPending}>Keep session</Button>
            <Button variant="destructive" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}>
              {cancelMutation.isPending ? "Cancelling…" : "Cancel session"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialog} onOpenChange={open => !open && setDeleteDialog(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete session?</DialogTitle>
            <DialogDescription>
              This will permanently delete <strong>{dropin.name}</strong> and all its pools. This cannot be undone.
              {spotsUsed > 0 && (
                <span className="block mt-2 text-red-700 font-medium">
                  This session has {spotsUsed} registered spot{spotsUsed !== 1 ? "s" : ""}. Cancel the session first to remove all registrations before deleting.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog(false)} disabled={deleteMutation.isPending}>Keep session</Button>
            <Button variant="destructive" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "Deleting…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Main Admin Dropins Page ──────────────────────────────────────────────────

export default function AdminDropins() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { canManageDropins, isSuperAdmin } = useAdminPermissions();
  const getHeaders = useAuthHeaders();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [sportFilter, setSportFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "published" | "draft">("all");
  const [venueFilter, setVenueFilter] = useState("");
  const [dateFromFilter, setDateFromFilter] = useState("");
  const [dateToFilter, setDateToFilter] = useState("");
  const [fillFilter, setFillFilter] = useState<"all" | "available" | "full">("all");
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const { data: templates = [], isLoading: templatesLoading } = useQuery({
    queryKey: ["dropin-templates"],
    enabled: canManageDropins,
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/dropin-templates?includeDrafts=true`, { headers });
      return r.ok ? r.json() : [];
    },
  });

  const { data: venues = [] } = useQuery({
    queryKey: ["venues"],
    enabled: canManageDropins,
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/venues`, { headers });
      return r.ok ? r.json() : [];
    },
  });

  const { data: legacySessions = [], isLoading: legacyLoading } = useQuery({
    queryKey: ["dropins-admin"],
    enabled: canManageDropins,
    queryFn: async () => {
      const r = await fetch(`${API}/dropins?includeCancelled=false`);
      return r.ok ? r.json() : [];
    },
  });

  const deleteTemplate = useMutation({
    mutationFn: async (id: number) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/dropin-templates/${id}`, { method: "DELETE", headers });
      if (!r.ok) throw new Error("Delete failed");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["dropin-templates"] }); setDeleteConfirm(null); toast({ title: "Template deleted" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const duplicateTemplate = useMutation({
    mutationFn: async (id: number) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/dropin-templates/${id}/duplicate`, { method: "POST", headers });
      if (!r.ok) throw new Error("Duplicate failed");
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["dropin-templates"] }); toast({ title: "Series duplicated as draft" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (profileLoading) return <Layout><div className="p-8 text-center text-muted-foreground">Loading…</div></Layout>;
  if (!canManageDropins) return <Redirect to="/" />;

  const filteredTemplates = (templates as any[]).filter(t => {
    if (sportFilter && t.sport !== sportFilter) return false;
    if (statusFilter === "published" && !t.isPublished) return false;
    if (statusFilter === "draft" && !t.isDraft) return false;
    if (venueFilter && String(t.venueId) !== venueFilter) return false;
    // Date range: filter by template recurrence window (startDate / endDate)
    const rule = t.recurrenceRule ?? {};
    if (dateFromFilter && rule.endDate && rule.endDate < dateFromFilter) return false;
    if (dateToFilter && rule.startDate && rule.startDate > dateToFilter) return false;
    // Fill status: computed from pool-level spotsTaken / cap
    if (fillFilter !== "all") {
      const pools: any[] = t.pools ?? [];
      const totalCap = pools.reduce((s: number, p: any) => s + (p.cap ?? 0), 0);
      const totalTaken = pools.reduce((s: number, p: any) => s + (p.spotsTaken ?? 0), 0);
      const isFull = totalCap > 0 && totalTaken >= totalCap;
      if (fillFilter === "full" && !isFull) return false;
      if (fillFilter === "available" && isFull) return false;
    }
    return true;
  });

  const sports = [...new Set((templates as any[]).map((t: any) => t.sport).filter(Boolean))];
  const hasActiveFilters = sportFilter || statusFilter !== "all" || venueFilter || dateFromFilter || dateToFilter || fillFilter !== "all";

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-5xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Drop-in Sessions</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Manage templates, series, and standalone sessions</p>
          </div>
          <Link href="/admin/dropins/new">
            <Button className="gap-2">
              <Plus className="h-4 w-4" /> New Drop-in
            </Button>
          </Link>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground font-medium">Filter:</span>
          </div>
          <select className="h-8 rounded border border-input bg-background px-2 text-xs" value={sportFilter} onChange={e => setSportFilter(e.target.value)}>
            <option value="">All sports</option>
            {sports.map((s: string) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="h-8 rounded border border-input bg-background px-2 text-xs" value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}>
            <option value="all">All statuses</option>
            <option value="published">Published</option>
            <option value="draft">Drafts</option>
          </select>
          <select className="h-8 rounded border border-input bg-background px-2 text-xs" value={venueFilter} onChange={e => setVenueFilter(e.target.value)}>
            <option value="">All venues</option>
            {(venues as any[]).map((v: any) => <option key={v.id} value={String(v.id)}>{v.name}</option>)}
          </select>
          <select className="h-8 rounded border border-input bg-background px-2 text-xs" value={fillFilter} onChange={e => setFillFilter(e.target.value as any)}>
            <option value="all">Any fill</option>
            <option value="available">Has spots</option>
            <option value="full">Full / waitlist</option>
          </select>
          <input type="date" className="h-8 rounded border border-input bg-background px-2 text-xs" value={dateFromFilter} onChange={e => setDateFromFilter(e.target.value)} title="From date" placeholder="From" />
          <input type="date" className="h-8 rounded border border-input bg-background px-2 text-xs" value={dateToFilter} onChange={e => setDateToFilter(e.target.value)} title="To date" placeholder="To" />
          {hasActiveFilters && (
            <button type="button" className="text-xs text-muted-foreground hover:text-foreground underline" onClick={() => { setSportFilter(""); setStatusFilter("all"); setVenueFilter(""); setDateFromFilter(""); setDateToFilter(""); setFillFilter("all"); }}>Clear all</button>
          )}
        </div>

        {/* Section A: New-style templates */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
            <Repeat className="h-3.5 w-3.5" /> Series & Templates
          </h2>
          {templatesLoading ? (
            <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
          ) : filteredTemplates.length === 0 ? (
            <div className="border rounded-xl p-8 text-center text-muted-foreground">
              <Repeat className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No templates yet.</p>
              <Link href="/admin/dropins/new">
                <Button variant="outline" size="sm" className="mt-3 gap-1.5"><Plus className="h-3.5 w-3.5" />Create your first drop-in</Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredTemplates.map((t: any) => (
                <TemplateSeriesRow
                  key={t.id}
                  template={t}
                  onDelete={() => setDeleteConfirm(t.id)}
                  onDuplicate={() => duplicateTemplate.mutate(t.id)}
                  isSuperAdmin={isSuperAdmin}
                />
              ))}
            </div>
          )}
        </section>

        {/* Section B: Legacy sessions */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
            <CalendarDays className="h-3.5 w-3.5" /> Legacy Standalone Sessions
          </h2>
          {legacyLoading ? (
            <div className="space-y-2">{[1, 2].map(i => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
          ) : (legacySessions as any[]).length === 0 ? (
            <p className="text-sm text-muted-foreground italic px-2">No standalone sessions.</p>
          ) : (
            <div className="space-y-2">
              {(legacySessions as any[]).map((d: any) => <LegacyDropinRow key={d.id} dropin={d} />)}
            </div>
          )}
        </section>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirm !== null} onOpenChange={open => !open && setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete template?</DialogTitle>
            <DialogDescription>This will delete the template and all future occurrences. Existing spots and registrations are not affected.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteConfirm && deleteTemplate.mutate(deleteConfirm)} disabled={deleteTemplate.isPending}>
              {deleteTemplate.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
