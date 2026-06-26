import { API_BASE } from "@/lib/api-base";
import React, { useState } from "react";
import { Redirect } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { format } from "date-fns";
import { toEasternISOString, toEasternLocalString } from "@/lib/timezone";
import {
  Calendar, Brain, CheckCircle2, XCircle, Clock, AlertTriangle,
  RefreshCw, Sparkles, Lock, ChevronRight, Eye, Edit3, Check
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CalendarSource {
  id: number; name: string; slug: string; sourceType: string;
  isActive: boolean; lastFetchedAt: string | null; totalDates: number; confirmedDates: number;
}

interface CalendarDate {
  id: number; sourceId: number; date: string; label: string | null;
  dateType: string; isConfirmed: boolean; notes: string | null;
}

interface EventSuggestion {
  id: number; entityType: string; title: string; description: string | null;
  suggestedAgeGroup: string | null; suggestedFormat: string | null;
  suggestedStartDate: string | null; suggestedEndDate: string | null;
  suggestedCapacity: number | null; suggestedDurationWeeks: number | null;
  suggestedFee: string | null; seasonAlignment: string | null;
  status: string; reviewNotes: string | null; lockedOfferingType: string | null;
  lockedOfferingId: number | null; lockedAt: string | null; createdAt: string;
}

interface ScheduleProposal {
  id: number; status: string; entityType: string | null; entityId: number | null;
  notes: string | null; conflictSummary: string | null; aiModel: string | null;
  reoptimizeCount: number | null; reviewedAt: string | null;
  approvedAt: string | null; createdAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending:            { label: "Pending Review",  variant: "secondary" },
  accepted:           { label: "Accepted",        variant: "default" },
  rejected:           { label: "Rejected",        variant: "destructive" },
  locked:             { label: "Locked",          variant: "default" },
  draft:              { label: "Draft",           variant: "secondary" },
  ready:              { label: "Ready",           variant: "outline" },
  approved:           { label: "Approved",        variant: "default" },
  partially_approved: { label: "Partial",         variant: "secondary" },
};

const DATE_TYPE_LABELS: Record<string, string> = {
  school_day:     "School Day",
  school_holiday: "School Holiday",
  break:          "School Break",
  blackout:       "Blackout",
  alignment_hint: "Alignment Hint",
};

const OFFERING_TYPE_LABELS: Record<string, string> = {
  league:     "League",
  camp:       "Camp",
  drop_in:    "Drop-in",
  tournament: "Tournament",
};

// ── Calendar Sources Tab ──────────────────────────────────────────────────────

function CalendarSourcesTab({ token }: { token: string | null }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showAddDate, setShowAddDate] = useState<number | null>(null);
  const [newDate, setNewDate] = useState({ date: "", label: "", dateType: "school_holiday", notes: "" });
  const [selectedSource, setSelectedSource] = useState<number | null>(null);
  const [bulkConfirming, setBulkConfirming] = useState(false);
  const [fetchingSourceId, setFetchingSourceId] = useState<number | null>(null);

  const { data: sources, isLoading } = useQuery<CalendarSource[]>({
    queryKey: ["ai-calendar-sources"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/admin/ai/calendar-sources`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: dates, isLoading: datesLoading } = useQuery<CalendarDate[]>({
    queryKey: ["ai-calendar-dates", selectedSource],
    enabled: selectedSource !== null,
    queryFn: async () => {
      const url = selectedSource ? `/api/admin/ai/calendar-dates?sourceId=${selectedSource}&limit=200` : "/api/admin/ai/calendar-dates?limit=200";
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  async function addDate(sourceId: number) {
    if (!newDate.date) { toast({ title: "Date is required", variant: "destructive" }); return; }
    const res = await fetch(`${API_BASE}/admin/ai/calendar-dates`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sourceId, ...newDate }),
    });
    if (!res.ok) { toast({ title: "Failed to add date", variant: "destructive" }); return; }
    queryClient.invalidateQueries({ queryKey: ["ai-calendar-dates", sourceId] });
    queryClient.invalidateQueries({ queryKey: ["ai-calendar-sources"] });
    setShowAddDate(null);
    setNewDate({ date: "", label: "", dateType: "school_holiday", notes: "" });
    toast({ title: "Date added" });
  }

  async function confirmDate(dateId: number, sourceId: number) {
    const res = await fetch(`${API_BASE}/admin/ai/calendar-dates/${dateId}/confirm`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    queryClient.invalidateQueries({ queryKey: ["ai-calendar-dates", sourceId] });
    queryClient.invalidateQueries({ queryKey: ["ai-calendar-sources"] });
  }

  async function fetchSource(sourceId: number) {
    setFetchingSourceId(sourceId);
    try {
      const res = await fetch(`${API_BASE}/admin/ai/calendar-sources/${sourceId}/fetch`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) { toast({ title: data.error ?? "Fetch failed", variant: "destructive" }); return; }
      queryClient.invalidateQueries({ queryKey: ["ai-calendar-dates", sourceId] });
      queryClient.invalidateQueries({ queryKey: ["ai-calendar-sources"] });
      toast({
        title: `Ingested ${data.ingested} dates (${data.skipped} already existed)`,
        description: data.errors?.length ? `${data.errors.length} errors` : `Format: ${data.format}. Dates need confirmation before AI can use them.`,
      });
    } finally {
      setFetchingSourceId(null);
    }
  }

  async function bulkConfirmSource(sourceId: number) {
    setBulkConfirming(true);
    try {
      const res = await fetch(`${API_BASE}/admin/ai/calendar-dates/bulk-confirm`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId }),
      });
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["ai-calendar-dates", sourceId] });
      queryClient.invalidateQueries({ queryKey: ["ai-calendar-sources"] });
      toast({ title: `Confirmed ${data.confirmed} dates` });
    } finally {
      setBulkConfirming(false);
    }
  }

  async function deleteDate(dateId: number, sourceId: number) {
    await fetch(`${API_BASE}/admin/ai/calendar-dates/${dateId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    queryClient.invalidateQueries({ queryKey: ["ai-calendar-dates", sourceId] });
    queryClient.invalidateQueries({ queryKey: ["ai-calendar-sources"] });
  }

  if (isLoading) return <div className="space-y-3">{[1,2,3,4].map(i => <Skeleton key={i} className="h-20" />)}</div>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        The AI only schedules on <strong>confirmed</strong> dates. Add and confirm school holidays, breaks, and alignment hints before triggering AI scheduling.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sources?.map(src => (
          <Card key={src.id} className={selectedSource === src.id ? "ring-2 ring-primary" : ""}>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-semibold">{src.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">{src.sourceType.replace("_", " ")}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-primary">{src.confirmedDates}/{src.totalDates}</p>
                  <p className="text-xs text-muted-foreground">confirmed</p>
                </div>
              </div>
              {src.totalDates > 0 && (
                <div className="w-full bg-muted rounded-full h-1.5 mb-3">
                  <div
                    className="bg-green-500 h-1.5 rounded-full transition-all"
                    style={{ width: `${Math.round((src.confirmedDates / src.totalDates) * 100)}%` }}
                  />
                </div>
              )}
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" variant="outline" onClick={() => setSelectedSource(selectedSource === src.id ? null : src.id)}>
                  <Eye className="h-3.5 w-3.5 mr-1" />
                  {selectedSource === src.id ? "Hide" : "Manage Dates"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowAddDate(showAddDate === src.id ? null : src.id)}>
                  + Add Date
                </Button>
                {src.totalDates > 0 && src.confirmedDates < src.totalDates && (
                  <Button size="sm" variant="outline" onClick={() => bulkConfirmSource(src.id)} disabled={bulkConfirming}>
                    <Check className="h-3.5 w-3.5 mr-1" />
                    Confirm All
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fetchSource(src.id)}
                  disabled={fetchingSourceId === src.id}
                  title="Fetch dates from the source's configured iCal or CSV URL"
                >
                  {fetchingSourceId === src.id
                    ? <><RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" />Fetching…</>
                    : <><RefreshCw className="h-3.5 w-3.5 mr-1" />Fetch from URL</>
                  }
                </Button>
              </div>

              {showAddDate === src.id && (
                <div className="mt-3 pt-3 border-t space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Date</Label>
                      <Input type="date" value={newDate.date} onChange={e => setNewDate(p => ({ ...p, date: e.target.value }))} className="h-8 text-sm" />
                    </div>
                    <div>
                      <Label className="text-xs">Type</Label>
                      <Select value={newDate.dateType} onValueChange={v => setNewDate(p => ({ ...p, dateType: v }))}>
                        <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(DATE_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Input placeholder="Label (e.g. Fall Break)" value={newDate.label} onChange={e => setNewDate(p => ({ ...p, label: e.target.value }))} className="h-8 text-sm" />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => addDate(src.id)} className="flex-1">Add Date</Button>
                    <Button size="sm" variant="outline" onClick={() => setShowAddDate(null)}>Cancel</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {selectedSource !== null && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Dates — {sources?.find(s => s.id === selectedSource)?.name}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {datesLoading ? <Skeleton className="h-40" /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="text-left pb-2 pr-3">Date</th>
                      <th className="text-left pb-2 pr-3">Label</th>
                      <th className="text-left pb-2 pr-3">Type</th>
                      <th className="text-left pb-2 pr-3">Confirmed</th>
                      <th className="text-left pb-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {dates?.map(d => (
                      <tr key={d.id} className="hover:bg-muted/30">
                        <td className="py-2 pr-3 font-mono text-xs">{d.date}</td>
                        <td className="py-2 pr-3">{d.label ?? <span className="text-muted-foreground">—</span>}</td>
                        <td className="py-2 pr-3">
                          <Badge variant="secondary" className="text-xs">{DATE_TYPE_LABELS[d.dateType] ?? d.dateType}</Badge>
                        </td>
                        <td className="py-2 pr-3">
                          {d.isConfirmed
                            ? <CheckCircle2 className="h-4 w-4 text-green-600" />
                            : <Clock className="h-4 w-4 text-muted-foreground" />}
                        </td>
                        <td className="py-2">
                          <div className="flex gap-1">
                            {!d.isConfirmed && (
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => confirmDate(d.id, selectedSource!)}>
                                Confirm
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive hover:text-destructive" onClick={() => deleteDate(d.id, selectedSource!)}>
                              Del
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!dates?.length && (
                      <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">No dates yet. Add some above.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Event Suggestions Tab ─────────────────────────────────────────────────────

function SuggestionsTab({ token }: { token: string | null }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [hint, setHint] = useState("");
  const [offeringType, setOfferingType] = useState("");
  const [generating, setGenerating] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [editData, setEditData] = useState<Record<string, any>>({});
  const [lockData, setLockData] = useState<Record<number, { offeringType: string; offeringId: string }>>({});
  const [statusFilter, setStatusFilter] = useState("pending");

  const { data: suggestions, isLoading } = useQuery<EventSuggestion[]>({
    queryKey: ["ai-suggestions", statusFilter],
    queryFn: async () => {
      const url = statusFilter ? `/api/admin/ai/suggestions?status=${statusFilter}` : "/api/admin/ai/suggestions";
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  async function generateSuggestions() {
    setGenerating(true);
    try {
      const res = await fetch(`${API_BASE}/admin/ai/suggest-events`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ hint: hint || undefined, offeringType: offeringType || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "AI request failed");
      }
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["ai-suggestions"] });
      toast({ title: `Generated ${data.suggestions?.length ?? 0} event suggestion(s)`, description: data.summary });
      setStatusFilter("pending");
    } catch (err: any) {
      toast({ title: "Generation failed", description: err.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  }

  async function updateSuggestion(id: number, patch: Record<string, any>) {
    const res = await fetch(`${API_BASE}/admin/ai/suggestions/${id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) { toast({ title: "Update failed", variant: "destructive" }); return; }
    queryClient.invalidateQueries({ queryKey: ["ai-suggestions"] });
    setEditId(null);
    toast({ title: "Updated" });
  }

  async function lockSuggestion(id: number) {
    const ld = lockData[id];
    if (!ld?.offeringType || !ld?.offeringId) {
      toast({ title: "Enter offering type and ID", variant: "destructive" }); return;
    }
    const res = await fetch(`${API_BASE}/admin/ai/suggestions/${id}/lock`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ offeringType: ld.offeringType, offeringId: Number(ld.offeringId) }),
    });
    if (!res.ok) { toast({ title: "Lock failed", variant: "destructive" }); return; }
    queryClient.invalidateQueries({ queryKey: ["ai-suggestions"] });
    toast({ title: "Locked — proceed to Stage 2 to generate a schedule" });
  }

  return (
    <div className="space-y-5">
      {/* Generate panel */}
      <Card className="border-dashed">
        <CardContent className="pt-5">
          <div className="flex items-start gap-3 mb-4">
            <Sparkles className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-sm">Stage 1 — AI Event Suggestions</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                The AI surveys your calendar data, existing offerings, and scheduling rules to recommend which events to run and when.
                Requires confirmed calendar dates.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <Label className="text-xs mb-1 block">Focus on (optional)</Label>
              <Select value={offeringType} onValueChange={setOfferingType}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="All offering types" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All types</SelectItem>
                  {Object.entries(OFFERING_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">Hint (optional)</Label>
              <Input
                placeholder="e.g. 'focus on fall break youth camps'"
                value={hint}
                onChange={e => setHint(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
          </div>
          <Button onClick={generateSuggestions} disabled={generating}>
            {generating ? <><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Generating…</> : <><Brain className="mr-2 h-4 w-4" />Generate Suggestions</>}
          </Button>
          {generating && <p className="text-xs text-muted-foreground mt-2">This may take 10–30 seconds…</p>}
        </CardContent>
      </Card>

      {/* Filter */}
      <div className="flex gap-2 flex-wrap">
        {["pending", "accepted", "rejected", "locked", ""].map(s => (
          <Button key={s} size="sm" variant={statusFilter === s ? "default" : "outline"} onClick={() => setStatusFilter(s)}>
            {s === "" ? "All" : STATUS_BADGE[s]?.label ?? s}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-28" />)}</div>
      ) : suggestions?.length ? (
        <div className="space-y-3">
          {suggestions.map(s => {
            const badge = STATUS_BADGE[s.status] ?? { label: s.status, variant: "secondary" as const };
            const isExpanded = expandedId === s.id;
            const isEditing = editId === s.id;
            return (
              <Card key={s.id}>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <Badge variant="outline" className="text-xs">{OFFERING_TYPE_LABELS[s.entityType] ?? s.entityType}</Badge>
                        <Badge variant={badge.variant} className="text-xs">{badge.label}</Badge>
                        {s.suggestedAgeGroup && <Badge variant="secondary" className="text-xs">{s.suggestedAgeGroup}</Badge>}
                      </div>
                      <p className="font-semibold truncate">{s.title}</p>
                      {s.description && !isExpanded && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{s.description}</p>
                      )}
                    </div>
                    <Button size="sm" variant="ghost" className="shrink-0" onClick={() => setExpandedId(isExpanded ? null : s.id)}>
                      {isExpanded ? "Collapse" : "Expand"}
                    </Button>
                  </div>

                  {isExpanded && (
                    <div className="space-y-3">
                      {s.description && <p className="text-sm text-muted-foreground">{s.description}</p>}

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                        {s.suggestedFormat && <div><span className="text-xs text-muted-foreground block">Format</span>{s.suggestedFormat}</div>}
                        {s.suggestedStartDate && <div><span className="text-xs text-muted-foreground block">Start</span>{s.suggestedStartDate}</div>}
                        {s.suggestedEndDate && <div><span className="text-xs text-muted-foreground block">End</span>{s.suggestedEndDate}</div>}
                        {s.suggestedCapacity && <div><span className="text-xs text-muted-foreground block">Capacity</span>{s.suggestedCapacity}</div>}
                        {s.suggestedDurationWeeks && <div><span className="text-xs text-muted-foreground block">Duration</span>{s.suggestedDurationWeeks} weeks</div>}
                        {s.suggestedFee && <div><span className="text-xs text-muted-foreground block">Suggested Fee</span>${Number(s.suggestedFee).toFixed(2)}</div>}
                      </div>

                      {s.seasonAlignment && (
                        <div className="bg-muted/50 rounded p-2 text-xs text-muted-foreground">
                          <span className="font-medium">Season alignment:</span> {s.seasonAlignment}
                        </div>
                      )}

                      {isEditing && (
                        <div className="border rounded p-3 space-y-2 bg-muted/30">
                          <p className="text-xs font-semibold uppercase text-muted-foreground">Adjust Details</p>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label className="text-xs">Age Group</Label>
                              <Input className="h-8 text-sm" value={editData.suggestedAgeGroup ?? s.suggestedAgeGroup ?? ""} onChange={e => setEditData(p => ({ ...p, suggestedAgeGroup: e.target.value }))} />
                            </div>
                            <div>
                              <Label className="text-xs">Format</Label>
                              <Input className="h-8 text-sm" value={editData.suggestedFormat ?? s.suggestedFormat ?? ""} onChange={e => setEditData(p => ({ ...p, suggestedFormat: e.target.value }))} />
                            </div>
                            <div>
                              <Label className="text-xs">Start Date</Label>
                              <Input type="date" className="h-8 text-sm" value={editData.suggestedStartDate ?? s.suggestedStartDate ?? ""} onChange={e => setEditData(p => ({ ...p, suggestedStartDate: e.target.value }))} />
                            </div>
                            <div>
                              <Label className="text-xs">End Date</Label>
                              <Input type="date" className="h-8 text-sm" value={editData.suggestedEndDate ?? s.suggestedEndDate ?? ""} onChange={e => setEditData(p => ({ ...p, suggestedEndDate: e.target.value }))} />
                            </div>
                            <div>
                              <Label className="text-xs">Capacity</Label>
                              <Input type="number" className="h-8 text-sm" value={editData.suggestedCapacity ?? s.suggestedCapacity ?? ""} onChange={e => setEditData(p => ({ ...p, suggestedCapacity: e.target.value ? Number(e.target.value) : null }))} />
                            </div>
                            <div>
                              <Label className="text-xs">Fee ($)</Label>
                              <Input type="number" step="0.01" className="h-8 text-sm" value={editData.suggestedFee ?? s.suggestedFee ?? ""} onChange={e => setEditData(p => ({ ...p, suggestedFee: e.target.value || null }))} />
                            </div>
                          </div>
                          <div>
                            <Label className="text-xs">Review Notes</Label>
                            <Textarea className="text-sm" rows={2} value={editData.reviewNotes ?? s.reviewNotes ?? ""} onChange={e => setEditData(p => ({ ...p, reviewNotes: e.target.value }))} />
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => updateSuggestion(s.id, editData)}>Save Changes</Button>
                            <Button size="sm" variant="outline" onClick={() => { setEditId(null); setEditData({}); }}>Cancel</Button>
                          </div>
                        </div>
                      )}

                      {s.status === "accepted" && !s.lockedOfferingId && (
                        <div className="border rounded p-3 space-y-2 bg-muted/30">
                          <p className="text-xs font-semibold uppercase text-muted-foreground">Lock to Offering</p>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label className="text-xs">Offering Type</Label>
                              <Select value={lockData[s.id]?.offeringType ?? ""} onValueChange={v => setLockData(p => ({ ...p, [s.id]: { ...p[s.id], offeringType: v } }))}>
                                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select type" /></SelectTrigger>
                                <SelectContent>
                                  {Object.entries(OFFERING_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label className="text-xs">Offering ID</Label>
                              <Input type="number" className="h-8 text-sm" placeholder="DB ID" value={lockData[s.id]?.offeringId ?? ""} onChange={e => setLockData(p => ({ ...p, [s.id]: { ...p[s.id], offeringId: e.target.value } }))} />
                            </div>
                          </div>
                          <Button size="sm" onClick={() => lockSuggestion(s.id)}>
                            <Lock className="h-3.5 w-3.5 mr-1" />Lock Suggestion
                          </Button>
                        </div>
                      )}

                      {s.lockedOfferingId && (
                        <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded p-2">
                          <Lock className="h-4 w-4" />
                          Locked to {OFFERING_TYPE_LABELS[s.lockedOfferingType ?? ""] ?? s.lockedOfferingType} #{s.lockedOfferingId}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex gap-2 mt-3 flex-wrap">
                    {s.status === "pending" && (
                      <>
                        <Button size="sm" variant="default" onClick={() => updateSuggestion(s.id, { status: "accepted" })}>
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" />Accept
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => updateSuggestion(s.id, { status: "rejected" })}>
                          <XCircle className="h-3.5 w-3.5 mr-1" />Reject
                        </Button>
                      </>
                    )}
                    {s.status !== "locked" && s.status !== "rejected" && (
                      <Button size="sm" variant="outline" onClick={() => { setEditId(editId === s.id ? null : s.id); setEditData({}); }}>
                        <Edit3 className="h-3.5 w-3.5 mr-1" />{editId === s.id ? "Cancel Edit" : "Adjust"}
                      </Button>
                    )}
                    {s.status === "rejected" && (
                      <Button size="sm" variant="outline" onClick={() => updateSuggestion(s.id, { status: "pending" })}>
                        Reconsider
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          <Brain className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p>No suggestions yet. {statusFilter ? `None with status "${statusFilter}".` : "Click 'Generate Suggestions' above."}</p>
        </div>
      )}
    </div>
  );
}

// ── Schedule Proposals Tab ────────────────────────────────────────────────────

function ProposalsTab({ token }: { token: string | null }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [entityType, setEntityType] = useState("league");
  const [entityId, setEntityId] = useState("");
  const [generating, setGenerating] = useState(false);
  const [reoptimizeId, setReoptimizeId] = useState<number | null>(null);
  const [reoptimizeText, setReoptimizeText] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingFixtureId, setEditingFixtureId] = useState<string | null>(null);
  const [editingProposalId, setEditingProposalId] = useState<number | null>(null);
  const [fixtureEdit, setFixtureEdit] = useState<Record<string, any>>({});
  const [statusFilter, setStatusFilter] = useState("");
  const [fullProposal, setFullProposal] = useState<any>(null);
  const [loadingFull, setLoadingFull] = useState(false);

  const { data: proposals, isLoading } = useQuery<ScheduleProposal[]>({
    queryKey: ["ai-proposals", statusFilter, entityType],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`${API_BASE}/admin/ai/proposals?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  async function generate() {
    if (!entityId) { toast({ title: "Entity ID is required", variant: "destructive" }); return; }
    setGenerating(true);
    try {
      const res = await fetch(`${API_BASE}/admin/ai/proposals/generate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ entityType, entityId: Number(entityId) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "AI request failed");
      }
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["ai-proposals"] });
      toast({ title: `Schedule proposal generated — ${data.proposalData?.fixtures?.length ?? 0} fixtures`, description: data.proposalData?.summary });
    } catch (err: any) {
      toast({ title: "Generation failed", description: err.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  }

  async function loadFull(id: number) {
    setLoadingFull(true);
    try {
      const res = await fetch(`${API_BASE}/admin/ai/proposals/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setFullProposal(data);
      setExpandedId(id);
    } finally {
      setLoadingFull(false);
    }
  }

  async function reoptimize(id: number) {
    if (!reoptimizeText) { toast({ title: "Enter optimization instructions", variant: "destructive" }); return; }
    setGenerating(true);
    try {
      const res = await fetch(`${API_BASE}/admin/ai/proposals/${id}/reoptimize`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reoptimizeRequest: reoptimizeText }),
      });
      if (!res.ok) throw new Error("Reoptimize failed");
      queryClient.invalidateQueries({ queryKey: ["ai-proposals"] });
      setReoptimizeId(null);
      setReoptimizeText("");
      loadFull(id);
      toast({ title: "Re-optimized successfully" });
    } catch (err: any) {
      toast({ title: "Re-optimization failed", description: err.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  }

  async function saveFixtureEdit(proposalId: number, fixtureId: string) {
    const payload = { ...fixtureEdit, scheduledAt: fixtureEdit.scheduledAt ? toEasternISOString(fixtureEdit.scheduledAt) : fixtureEdit.scheduledAt };
    const res = await fetch(`${API_BASE}/admin/ai/proposals/${proposalId}/fixture`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fixtureId, ...payload }),
    });
    if (!res.ok) { toast({ title: "Edit failed", variant: "destructive" }); return; }
    const data = await res.json();
    setFullProposal(data);
    setEditingFixtureId(null);
    setEditingProposalId(null);
    setFixtureEdit({});
    queryClient.invalidateQueries({ queryKey: ["ai-proposals"] });
    toast({ title: "Fixture updated" });
  }

  async function approveProposal(id: number) {
    const res = await fetch(`${API_BASE}/admin/ai/proposals/${id}/approve`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) {
      toast({ title: "Cannot approve", description: data.error ?? "Error", variant: "destructive" });
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["ai-proposals"] });
    toast({ title: `Approved — ${data.publishedFixtures} fixtures published`, description: data.skippedDueToConflicts > 0 ? `${data.skippedDueToConflicts} skipped due to conflicts` : undefined });
  }

  async function rejectProposal(id: number) {
    await fetch(`${API_BASE}/admin/ai/proposals/${id}/reject`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    queryClient.invalidateQueries({ queryKey: ["ai-proposals"] });
    toast({ title: "Proposal rejected" });
  }

  return (
    <div className="space-y-5">
      <Card className="border-dashed">
        <CardContent className="pt-5">
          <div className="flex items-start gap-3 mb-4">
            <Calendar className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-sm">Stage 2 — AI Schedule Generation</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                For a locked offering, the AI generates a full fixture schedule obeying all scheduling rules.
                You review, edit fixtures, and approve before anything publishes.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <Label className="text-xs mb-1 block">Offering Type</Label>
              <Select value={entityType} onValueChange={setEntityType}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(OFFERING_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">Offering ID</Label>
              <Input type="number" placeholder="DB ID of the offering" value={entityId} onChange={e => setEntityId(e.target.value)} className="h-9 text-sm" />
            </div>
          </div>
          <Button onClick={generate} disabled={generating}>
            {generating ? <><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Generating…</> : <><Brain className="mr-2 h-4 w-4" />Generate Schedule Proposal</>}
          </Button>
          {generating && <p className="text-xs text-muted-foreground mt-2">This may take 15–45 seconds depending on schedule complexity…</p>}
        </CardContent>
      </Card>

      <div className="flex gap-2 flex-wrap">
        {["", "draft", "ready", "approved", "rejected"].map(s => (
          <Button key={s} size="sm" variant={statusFilter === s ? "default" : "outline"} onClick={() => setStatusFilter(s)}>
            {s === "" ? "All" : STATUS_BADGE[s]?.label ?? s}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1,2].map(i => <Skeleton key={i} className="h-24" />)}</div>
      ) : proposals?.length ? (
        <div className="space-y-3">
          {proposals.map(p => {
            const badge = STATUS_BADGE[p.status] ?? { label: p.status, variant: "secondary" as const };
            const isExpanded = expandedId === p.id;
            const fixtures = fullProposal?.id === p.id ? fullProposal.proposalData?.fixtures ?? [] : [];
            return (
              <Card key={p.id}>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <Badge variant="outline" className="text-xs">{OFFERING_TYPE_LABELS[p.entityType ?? ""] ?? p.entityType} #{p.entityId}</Badge>
                        <Badge variant={badge.variant} className="text-xs">{badge.label}</Badge>
                        {(p.reoptimizeCount ?? 0) > 0 && <Badge variant="secondary" className="text-xs">{p.reoptimizeCount}× reopt.</Badge>}
                      </div>
                      {p.notes && <p className="text-sm text-muted-foreground line-clamp-2">{p.notes}</p>}
                      {p.conflictSummary && (
                        <div className="flex items-center gap-1 text-xs text-destructive mt-1">
                          <AlertTriangle className="h-3 w-3" />{p.conflictSummary}
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">{format(new Date(p.createdAt), "MMM d, yyyy h:mm a")}</p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => { if (isExpanded) { setExpandedId(null); setFullProposal(null); } else loadFull(p.id); }}>
                      {isExpanded ? "Collapse" : "View Fixtures"}
                    </Button>
                  </div>

                  {isExpanded && fullProposal?.id === p.id && (
                    <div className="mt-3 space-y-3">
                      {/* Re-optimize panel */}
                      {p.status !== "approved" && (
                        <div>
                          {reoptimizeId === p.id ? (
                            <div className="border rounded p-3 space-y-2 bg-muted/30">
                              <Label className="text-xs font-semibold uppercase text-muted-foreground">Re-optimize instructions</Label>
                              <Textarea
                                rows={2}
                                placeholder="e.g. 'Keep all youth games before 7:30pm' or 'Spread games over more weekends'"
                                value={reoptimizeText}
                                onChange={e => setReoptimizeText(e.target.value)}
                                className="text-sm"
                              />
                              <div className="flex gap-2">
                                <Button size="sm" onClick={() => reoptimize(p.id)} disabled={generating}>
                                  {generating ? <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
                                  Re-optimize
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => { setReoptimizeId(null); setReoptimizeText(""); }}>Cancel</Button>
                              </div>
                            </div>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => setReoptimizeId(p.id)}>
                              <Sparkles className="h-3.5 w-3.5 mr-1" />Request Re-optimization
                            </Button>
                          )}
                        </div>
                      )}

                      {/* Fixtures table */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b text-muted-foreground">
                              <th className="text-left pb-2 pr-2">#</th>
                              <th className="text-left pb-2 pr-2">Date/Time</th>
                              <th className="text-left pb-2 pr-2">Court</th>
                              <th className="text-left pb-2 pr-2">Home</th>
                              <th className="text-left pb-2 pr-2">Away</th>
                              <th className="text-left pb-2 pr-2">Round</th>
                              <th className="text-left pb-2"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {fixtures.map((f: any, idx: number) => {
                              const isEditingThis = editingFixtureId === f.id && editingProposalId === p.id;
                              return (
                                <tr key={f.id ?? idx} className="hover:bg-muted/30">
                                  <td className="py-1.5 pr-2 text-muted-foreground">{idx + 1}</td>
                                  <td className="py-1.5 pr-2">
                                    {isEditingThis
                                      ? <Input type="datetime-local" className="h-7 text-xs" value={fixtureEdit.scheduledAt ?? (f.scheduledAt ? toEasternLocalString(f.scheduledAt) : "")} onChange={e => setFixtureEdit(p => ({ ...p, scheduledAt: e.target.value }))} />
                                      : f.scheduledAt ? format(new Date(f.scheduledAt), "MMM d, h:mm a") : "—"
                                    }
                                  </td>
                                  <td className="py-1.5 pr-2">
                                    {isEditingThis
                                      ? <Input type="number" className="h-7 text-xs w-16" value={fixtureEdit.courtId ?? f.courtId ?? ""} onChange={e => setFixtureEdit(p => ({ ...p, courtId: e.target.value ? Number(e.target.value) : null }))} />
                                      : `Court ${f.courtId ?? "?"}`
                                    }
                                  </td>
                                  <td className="py-1.5 pr-2">{f.homeTeamId ? `#${f.homeTeamId}` : <span className="text-muted-foreground">—</span>}</td>
                                  <td className="py-1.5 pr-2">{f.awayTeamId ? `#${f.awayTeamId}` : <span className="text-muted-foreground">—</span>}</td>
                                  <td className="py-1.5 pr-2">{f.round ?? "—"}</td>
                                  <td className="py-1.5">
                                    {p.status !== "approved" && (
                                      isEditingThis ? (
                                        <div className="flex gap-1">
                                          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" onClick={() => saveFixtureEdit(p.id, f.id)}>Save</Button>
                                          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" onClick={() => { setEditingFixtureId(null); setEditingProposalId(null); setFixtureEdit({}); }}>×</Button>
                                        </div>
                                      ) : (
                                        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" onClick={() => { setEditingFixtureId(f.id); setEditingProposalId(p.id); setFixtureEdit({}); }}>Edit</Button>
                                      )
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                            {!fixtures.length && (
                              <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">No fixtures in this proposal.</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Proposal actions */}
                  {p.status !== "approved" && p.status !== "rejected" && (
                    <div className="flex gap-2 mt-3 flex-wrap">
                      {p.status === "ready" && (
                        <Button size="sm" onClick={() => approveProposal(p.id)}>
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" />Approve & Publish
                        </Button>
                      )}
                      {p.status === "draft" && (
                        <Button size="sm" variant="outline" disabled title="Resolve conflicts before approving">
                          <AlertTriangle className="h-3.5 w-3.5 mr-1" />Has Conflicts
                        </Button>
                      )}
                      <Button size="sm" variant="destructive" onClick={() => rejectProposal(p.id)}>
                        <XCircle className="h-3.5 w-3.5 mr-1" />Reject
                      </Button>
                    </div>
                  )}
                  {p.status === "approved" && (
                    <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 mt-2">
                      <CheckCircle2 className="h-4 w-4" />
                      Approved & published on {p.approvedAt ? format(new Date(p.approvedAt), "MMM d, yyyy") : "—"}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          <Calendar className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p>No proposals yet. Generate one above after accepting a Stage 1 suggestion.</p>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminAiScheduling() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { getToken } = useAuth();
  const [token, setToken] = useState<string | null>(null);

  React.useEffect(() => {
    getToken().then(t => setToken(t));
  }, [getToken]);

  if (profileLoading) return <Layout><div className="p-12"><Skeleton className="h-64" /></div></Layout>;
  if (!profile || (profile.role !== "admin" && profile.adminLevel !== "super" && profile.adminLevel !== "admin")) return <Redirect to="/dashboard" />;

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-5xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold font-sans uppercase tracking-tight text-primary">AI Scheduling</h1>
            <p className="text-muted-foreground mt-1">Two-stage AI scheduling assistant — suggest events, then generate detailed schedules</p>
          </div>
          <Button variant="outline" onClick={() => history.back()}>Back to Admin</Button>
        </div>

        <Tabs defaultValue="calendar">
          <TabsList className="mb-6">
            <TabsTrigger value="calendar">
              <Calendar className="h-4 w-4 mr-1.5" />Calendar Data
            </TabsTrigger>
            <TabsTrigger value="suggestions">
              <Brain className="h-4 w-4 mr-1.5" />Stage 1: Events
            </TabsTrigger>
            <TabsTrigger value="proposals">
              <Sparkles className="h-4 w-4 mr-1.5" />Stage 2: Schedules
            </TabsTrigger>
          </TabsList>

          <TabsContent value="calendar">
            <CalendarSourcesTab token={token} />
          </TabsContent>

          <TabsContent value="suggestions">
            <SuggestionsTab token={token} />
          </TabsContent>

          <TabsContent value="proposals">
            <ProposalsTab token={token} />
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
