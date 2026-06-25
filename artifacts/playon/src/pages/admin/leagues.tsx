import React, { useState } from "react";
import { Redirect, Link } from "wouter";
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
import { useGetMyProfile } from "@workspace/api-client-react";
import { useAdminPermissions } from "@/hooks/use-admin-permissions";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { toEasternISOString, toEasternLocalString } from "@/lib/timezone";
import {
  Plus, Pencil, Trash2, ChevronDown, ChevronUp, Users, Calendar,
  Trophy, Settings, Play, RefreshCw, CheckCircle2, AlertCircle,
  DollarSign, ClipboardList, UserPlus, Zap, Target, BarChart2, XCircle, Clock,
  Globe, Star, Smartphone, Layers,
} from "lucide-react";
import { EventSplitPanel } from "@/components/event-split-panel";

import { AGE_GROUPS } from "@workspace/brand";

import { API_BASE as API } from "@/lib/api-base";
const GENDER_OPTIONS = [
  { value: "boy", label: "Boys" },
  { value: "girl", label: "Girls" },
  { value: "men", label: "Men" },
  { value: "women", label: "Women" },
  { value: "coed", label: "Coed" },
];
const FORMATS = [
  { value: "5v5", label: "5v5 (Full Court)" },
  { value: "4v4", label: "4v4 (Small Court)" },
  { value: "3v3", label: "3v3 (Small Court)" },
];
const STATUSES = [
  { value: "upcoming", label: "Upcoming" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
];
const PAYMENT_STATUSES = [
  { value: "unpaid", label: "Unpaid" },
  { value: "partial", label: "Partial" },
  { value: "paid", label: "Paid" },
  { value: "waived", label: "Waived" },
];

function useAuthHeaders() {
  const { getToken } = useAuth();
  return async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  };
}

const paymentBadge = (status: string) => {
  if (status === "paid") return <Badge className="bg-green-600 text-white">Paid</Badge>;
  if (status === "partial") return <Badge className="bg-amber-500 text-white">Partial</Badge>;
  return <Badge variant="destructive">Unpaid</Badge>;
};

// ─── Standings Panel ────────────────────────────────────────────────────────────

function StandingsPanel({ leagueId }: { leagueId: number }) {
  const getHeaders = useAuthHeaders();
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: standings, isLoading } = useQuery({
    queryKey: ["league-standings", leagueId],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/leagues/${leagueId}/standings`, { headers });
      return r.json();
    },
  });

  const recompute = useMutation({
    mutationFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/leagues/${leagueId}/standings/recompute`, { method: "POST", headers });
      if (!r.ok) throw new Error("Recompute failed");
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["league-standings", leagueId] }); toast({ title: "Standings updated" }); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  if (isLoading) return <div className="px-4 pb-4"><Skeleton className="h-20" /></div>;

  return (
    <div className="border-t bg-muted/30 px-4 py-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Standings</span>
        <Button size="sm" variant="outline" onClick={() => recompute.mutate()} disabled={recompute.isPending}>
          <RefreshCw className="h-3 w-3 mr-1" /> Recompute
        </Button>
      </div>
      {(() => {
        const isGrouped = standings && !Array.isArray(standings) && standings.type === "grouped";
        const rows: any[] = isGrouped ? [] : (standings ?? []);
        if (!isGrouped && !rows.length) {
          return <p className="text-sm text-muted-foreground">No standings yet. Enter results to build standings.</p>;
        }
        const renderTable = (list: any[]) => (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b">
                  <th className="text-left pb-2 font-medium">#</th>
                  <th className="text-left pb-2 font-medium">Team</th>
                  <th className="text-center pb-2 font-medium">GP</th>
                  <th className="text-center pb-2 font-medium">W</th>
                  <th className="text-center pb-2 font-medium">D</th>
                  <th className="text-center pb-2 font-medium">L</th>
                  <th className="text-center pb-2 font-medium">GF</th>
                  <th className="text-center pb-2 font-medium">GA</th>
                  <th className="text-center pb-2 font-medium">GD</th>
                  <th className="text-center pb-2 font-medium font-bold">Pts</th>
                </tr>
              </thead>
              <tbody>
                {list.map((s: any) => (
                  <tr key={s.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="py-2 text-muted-foreground">{s.rank}</td>
                    <td className="py-2 font-medium">{s.team?.name ?? `Team #${s.teamId}`}</td>
                    <td className="py-2 text-center">{s.gamesPlayed}</td>
                    <td className="py-2 text-center text-green-500">{s.wins}</td>
                    <td className="py-2 text-center text-amber-500">{s.draws}</td>
                    <td className="py-2 text-center text-red-500">{s.losses}</td>
                    <td className="py-2 text-center">{s.goalsFor}</td>
                    <td className="py-2 text-center">{s.goalsAgainst}</td>
                    <td className="py-2 text-center">{s.goalDifference > 0 ? `+${s.goalDifference}` : s.goalDifference}</td>
                    <td className="py-2 text-center font-bold">{s.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        if (isGrouped) {
          return (
            <div className="space-y-4">
              {standings.divisions.map((d: any) => (
                <div key={d.division.id}>
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
                    <Layers className="h-3 w-3" /> {d.division.name}
                  </p>
                  {d.standings.length ? renderTable(d.standings) : <p className="text-xs text-muted-foreground ml-4">No games played yet.</p>}
                </div>
              ))}
            </div>
          );
        }
        return renderTable(rows);
      })()}
    </div>
  );
}

// ─── Free Agents Panel ──────────────────────────────────────────────────────────

const FA_STATUS: Record<string, { label: string; color: string }> = {
  unmatched:       { label: "Needs Placement",          color: "bg-red-500/10 text-red-500 border-red-500/30" },
  team_reviewing:  { label: "Pending Team Approval",    color: "bg-violet-500/10 text-violet-500 border-violet-500/30" },
  player_reviewing:{ label: "Pending Player Acceptance",color: "bg-amber-500/10 text-amber-500 border-amber-500/30" },
  matched:         { label: "Matched",                  color: "bg-green-500/10 text-green-600 border-green-500/30" },
  assigned:        { label: "Confirmed",                color: "bg-blue-500/10 text-blue-500 border-blue-500/30" },
};

function FreeAgentsPanel({ leagueId, teams }: { leagueId: number; teams: any[] }) {
  const getHeaders = useAuthHeaders();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [assigningId, setAssigningId] = useState<number | null>(null);
  const [assignTeamId, setAssignTeamId] = useState("");

  const { data: agents, isLoading } = useQuery({
    queryKey: ["league-free-agents-queue", leagueId],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/leagues/${leagueId}/free-agents/queue`, { headers });
      return r.json();
    },
  });

  const assign = useMutation({
    mutationFn: async ({ faId, teamId }: { faId: number; teamId: number }) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/leagues/${leagueId}/free-agents/${faId}/assign`, {
        method: "PATCH", headers, body: JSON.stringify({ teamId }),
      });
      if (!r.ok) throw new Error("Assignment failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["league-free-agents-queue", leagueId] });
      qc.invalidateQueries({ queryKey: ["league-teams", leagueId] });
      toast({ title: "Free agent assigned to team" });
      setAssigningId(null); setAssignTeamId("");
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const retryMatch = useMutation({
    mutationFn: async (faId: number) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/leagues/${leagueId}/free-agents/${faId}/retry-match`, {
        method: "POST", headers,
      });
      if (!r.ok) throw new Error("Retry failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["league-free-agents-queue", leagueId] });
      toast({ title: "Re-matching triggered" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Admin approve/decline — advances the state machine on behalf of either party.
  // team_reviewing: approve → player_reviewing; decline → unmatched
  // player_reviewing: approve → matched/assigned; decline → unmatched
  const adminRespond = useMutation({
    mutationFn: async ({ faId, stage, decision }: { faId: number; stage: "team" | "player"; decision: "approve" | "decline" | "accept" }) => {
      const headers = await getHeaders();
      const endpoint = stage === "team"
        ? `${API}/leagues/${leagueId}/free-agents/${faId}/team-respond`
        : `${API}/leagues/${leagueId}/free-agents/${faId}/player-respond`;
      const r = await fetch(endpoint, {
        method: "PATCH", headers, body: JSON.stringify({ decision }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error ?? "Request failed"); }
      return r.json();
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["league-free-agents-queue", leagueId] });
      qc.invalidateQueries({ queryKey: ["league-teams", leagueId] });
      toast({ title: vars.decision === "decline" ? "FA declined — re-queued" : "FA advanced to next stage" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="px-4 pb-4"><Skeleton className="h-12" /></div>;

  return (
    <div className="border-t bg-muted/30 px-4 py-4">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Free Agent Queue ({agents?.length ?? 0})</span>
        <div className="flex gap-1.5 flex-wrap">
          {Object.entries(FA_STATUS).map(([k, v]) => {
            const count = (agents ?? []).filter((a: any) => (a.matchStatus ?? "unmatched") === k).length;
            if (!count) return null;
            return <span key={k} className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${v.color}`}>{count} {v.label}</span>;
          })}
        </div>
      </div>
      {!agents?.length ? (
        <p className="text-sm text-muted-foreground">No free agents registered.</p>
      ) : (
        <div className="space-y-2">
          {agents.map((a: any) => {
            const status = a.matchStatus ?? "unmatched";
            const statusMeta = FA_STATUS[status] ?? FA_STATUS.unmatched;
            const isSettled = status === "assigned" || status === "matched";
            return (
              <div key={a.id} className="flex flex-col bg-background rounded-lg border px-3 py-2 gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{a.user?.firstName} {a.user?.lastName}</span>
                      <span className="text-xs text-muted-foreground">{a.user?.email}</span>
                      {a.positions?.length > 0 && (
                        <span className="text-[11px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded capitalize">{a.positions.join(", ")}</span>
                      )}
                    </div>
                    {a.proposedTeam && (
                      <p className="text-xs text-muted-foreground mt-0.5">Proposed: <span className="font-medium text-foreground">{a.proposedTeam.name}</span></p>
                    )}
                    {a.assignedTeam && (
                      <p className="text-xs text-green-600 mt-0.5">Assigned to: <span className="font-medium">{a.assignedTeam.name}</span></p>
                    )}
                    {a.matchReasoning && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1 italic">{a.matchReasoning}</p>
                    )}
                  </div>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium whitespace-nowrap shrink-0 ${statusMeta.color}`}>{statusMeta.label}</span>
                </div>
                {!isSettled && (
                  <div className="flex gap-1.5 flex-wrap">
                    {/* Admin approve/decline on behalf of the reviewing party */}
                    {status === "team_reviewing" && (
                      <>
                        <Button size="sm" className="h-7 text-xs gap-1 bg-green-600 hover:bg-green-700 text-white"
                          onClick={() => adminRespond.mutate({ faId: a.id, stage: "team", decision: "approve" })}
                          disabled={adminRespond.isPending}>
                          <CheckCircle2 className="h-3 w-3" /> Approve
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-red-500 border-red-300 hover:bg-red-50"
                          onClick={() => adminRespond.mutate({ faId: a.id, stage: "team", decision: "decline" })}
                          disabled={adminRespond.isPending}>
                          <XCircle className="h-3 w-3" /> Decline
                        </Button>
                      </>
                    )}
                    {status === "player_reviewing" && (
                      <>
                        <Button size="sm" className="h-7 text-xs gap-1 bg-green-600 hover:bg-green-700 text-white"
                          onClick={() => adminRespond.mutate({ faId: a.id, stage: "player", decision: "accept" })}
                          disabled={adminRespond.isPending}>
                          <CheckCircle2 className="h-3 w-3" /> Confirm
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-red-500 border-red-300 hover:bg-red-50"
                          onClick={() => adminRespond.mutate({ faId: a.id, stage: "player", decision: "decline" })}
                          disabled={adminRespond.isPending}>
                          <XCircle className="h-3 w-3" /> Decline
                        </Button>
                      </>
                    )}
                    {(status === "unmatched" || status === "team_reviewing") && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-primary" onClick={() => retryMatch.mutate(a.id)} disabled={retryMatch.isPending}>
                        <RefreshCw className="h-3 w-3" /> Re-match
                      </Button>
                    )}
                    {assigningId === a.id ? (
                      <div className="flex gap-1.5 items-center">
                        <Select value={assignTeamId} onValueChange={setAssignTeamId}>
                          <SelectTrigger className="w-36 h-7 text-xs"><SelectValue placeholder="Pick team" /></SelectTrigger>
                          <SelectContent>
                            {teams.map((t: any) => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Button size="sm" className="h-7 text-xs" disabled={!assignTeamId || assign.isPending}
                          onClick={() => assign.mutate({ faId: a.id, teamId: Number(assignTeamId) })}>
                          Assign
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAssigningId(null)}>Cancel</Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => { setAssigningId(a.id); setAssignTeamId(""); }}>
                        <UserPlus className="h-3 w-3" /> Override Assign
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Fixtures Panel ─────────────────────────────────────────────────────────────

function FixturesPanel({ league }: { league: any }) {
  const getHeaders = useAuthHeaders();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [generating, setGenerating] = useState(false);
  const [genConfig, setGenConfig] = useState({ startDate: "", dayOfWeek: "6", startHour: "18", doubleRoundRobin: false, divisionId: "" });

  const { data: fixtureDivisions } = useQuery({
    queryKey: ["league-divisions", league.id],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/leagues/${league.id}/divisions`, { headers });
      return r.json() as Promise<any[]>;
    },
  });
  const hasMultipleDivisions = Array.isArray(fixtureDivisions) && fixtureDivisions.length > 1;
  const [enteringResult, setEnteringResult] = useState<number | null>(null);
  const [result, setResult] = useState({ homeScore: "", awayScore: "" });
  const [forfeitPending, setForfeitPending] = useState<{ fid: number; teamId: number; teamName: string } | null>(null);
  const [editingFixture, setEditingFixture] = useState<any>(null);

  const { data: fixtures, isLoading } = useQuery({
    queryKey: ["league-fixtures", league.id],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/leagues/${league.id}/fixtures`, { headers });
      return r.json();
    },
  });

  const generateSchedule = useMutation({
    mutationFn: async () => {
      const headers = await getHeaders();
      const payload: any = { ...genConfig, dayOfWeek: Number(genConfig.dayOfWeek), startHour: Number(genConfig.startHour) };
      if (genConfig.divisionId) payload.divisionId = Number(genConfig.divisionId);
      else delete payload.divisionId;
      const r = await fetch(`${API}/leagues/${league.id}/fixtures/generate`, {
        method: "POST", headers,
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["league-fixtures", league.id] });
      toast({ title: `Generated ${data.generated} fixtures` });
      setGenerating(false);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const enterResult = useMutation({
    mutationFn: async (fid: number) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/leagues/${league.id}/fixtures/${fid}/result`, {
        method: "POST", headers,
        body: JSON.stringify({ homeScore: Number(result.homeScore), awayScore: Number(result.awayScore) }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["league-fixtures", league.id] });
      qc.invalidateQueries({ queryKey: ["league-standings", league.id] });
      toast({ title: "Result saved & standings updated" });
      setEnteringResult(null); setResult({ homeScore: "", awayScore: "" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const forfeit = useMutation({
    mutationFn: async ({ fid, teamId }: { fid: number; teamId: number }) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/leagues/${league.id}/fixtures/${fid}/forfeit`, {
        method: "POST", headers, body: JSON.stringify({ forfeitingTeamId: teamId }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["league-fixtures", league.id] });
      qc.invalidateQueries({ queryKey: ["league-standings", league.id] });
      toast({ title: "Forfeit recorded" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateFixture = useMutation({
    mutationFn: async () => {
      if (!editingFixture) return;
      const headers = await getHeaders();
      const payload = { ...editingFixture, scheduledAt: editingFixture.scheduledAt ? toEasternISOString(editingFixture.scheduledAt) : editingFixture.scheduledAt };
      const r = await fetch(`${API}/leagues/${league.id}/fixtures/${editingFixture.id}`, {
        method: "PATCH", headers, body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["league-fixtures", league.id] });
      toast({ title: "Fixture updated" });
      setEditingFixture(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const groupedByRound = fixtures?.reduce((acc: any, f: any) => {
    const r = f.round ?? 0;
    if (!acc[r]) acc[r] = [];
    acc[r].push(f);
    return acc;
  }, {});

  if (isLoading) return <div className="px-4 pb-4"><Skeleton className="h-20" /></div>;

  return (
    <div className="border-t bg-muted/30 px-4 py-4">
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Schedule ({fixtures?.length ?? 0} games)</span>
        <Button size="sm" onClick={() => setGenerating(!generating)}>
          <Calendar className="h-3 w-3 mr-1" /> Generate Schedule
        </Button>
      </div>

      {generating && (
        <div className="bg-background rounded-lg border p-4 mb-4 space-y-3">
          <p className="text-sm font-medium text-muted-foreground">Round-Robin Schedule Generator</p>
          {hasMultipleDivisions && (
            <div className="mb-2">
              <Label className="text-xs">Division (required for multi-division leagues)</Label>
              <Select value={genConfig.divisionId} onValueChange={(v) => setGenConfig({ ...genConfig, divisionId: v })}>
                <SelectTrigger className="h-8 text-sm mt-1"><SelectValue placeholder="Select a division…" /></SelectTrigger>
                <SelectContent>
                  {(fixtureDivisions ?? []).map((d: any) => (
                    <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!genConfig.divisionId && <p className="text-xs text-amber-600 mt-1">Select a division to scope this schedule generation.</p>}
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">Start Date</Label>
              <Input type="date" className="h-8 text-sm mt-1" value={genConfig.startDate}
                onChange={(e) => setGenConfig({ ...genConfig, startDate: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Day of Week</Label>
              <Select value={genConfig.dayOfWeek} onValueChange={(v) => setGenConfig({ ...genConfig, dayOfWeek: v })}>
                <SelectTrigger className="h-8 text-sm mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d,i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Start Hour (24h)</Label>
              <Input type="number" min="0" max="23" className="h-8 text-sm mt-1" value={genConfig.startHour}
                onChange={(e) => setGenConfig({ ...genConfig, startHour: e.target.value })} />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={genConfig.doubleRoundRobin}
                  onChange={(e) => setGenConfig({ ...genConfig, doubleRoundRobin: e.target.checked })} />
                Double RR
              </label>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => generateSchedule.mutate()} disabled={generateSchedule.isPending}>
              {generateSchedule.isPending ? "Generating…" : "Generate"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setGenerating(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {editingFixture && (
        <div className="bg-background rounded-lg border p-4 mb-4 space-y-3">
          <p className="text-sm font-medium">Edit Fixture</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Date & Time</Label>
              <Input type="datetime-local" className="h-8 text-sm mt-1"
                value={editingFixture.scheduledAt ? toEasternLocalString(editingFixture.scheduledAt) : ""}
                onChange={(e) => setEditingFixture({ ...editingFixture, scheduledAt: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Notes</Label>
              <Input className="h-8 text-sm mt-1" value={editingFixture.notes ?? ""}
                onChange={(e) => setEditingFixture({ ...editingFixture, notes: e.target.value })} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => updateFixture.mutate()} disabled={updateFixture.isPending}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditingFixture(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {!groupedByRound || Object.keys(groupedByRound).length === 0 ? (
        <p className="text-sm text-muted-foreground">No fixtures yet. Generate a schedule above.</p>
      ) : (
        Object.keys(groupedByRound).sort((a, b) => Number(a) - Number(b)).map((round) => (
          <div key={round} className="mb-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">
              {Number(round) > 0 ? `Round ${round}` : "Playoff"}
            </p>
            <div className="space-y-2">
              {groupedByRound[round].map((f: any) => (
                <div key={f.id} className="bg-background rounded-lg border px-3 py-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-1">
                      <span className="font-medium text-sm">{f.homeTeam?.name ?? "TBD"}</span>
                      <span className="text-muted-foreground text-xs">vs</span>
                      <span className="font-medium text-sm">{f.awayTeam?.name ?? "TBD"}</span>
                      {f.status === "completed" && (
                        <Badge variant="secondary" className="text-xs ml-2">
                          {f.homeScore} – {f.awayScore}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {f.scheduledAt && (
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(f.scheduledAt), "MMM d, h:mm a")}
                        </span>
                      )}
                      <Badge variant={f.status === "completed" ? "secondary" : f.status === "cancelled" ? "destructive" : "outline"} className="text-xs">
                        {f.status}
                      </Badge>
                      {f.status !== "completed" && (
                        <>
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs"
                            onClick={() => { setEnteringResult(f.id); setResult({ homeScore: "", awayScore: "" }); }}>
                            Score
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" asChild title="Check-in">
                            <Link href={`/admin/leagues/fixtures/${f.id}/checkin`}>
                              <ClipboardList className="h-3 w-3" />
                            </Link>
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" asChild title="Attendance history">
                            <Link href={`/admin/leagues/fixtures/${f.id}/attendance`}>
                              <BarChart2 className="h-3 w-3" />
                            </Link>
                          </Button>
                        </>
                      )}
                      <Button size="sm" variant="ghost" className="h-6 px-2"
                        onClick={() => setEditingFixture({ ...f })}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>

                  {enteringResult === f.id && (
                    <div className="mt-2 flex items-center gap-2 pt-2 border-t">
                      <span className="text-xs text-muted-foreground w-24 truncate">{f.homeTeam?.name}</span>
                      <Input type="number" min="0" className="h-7 w-16 text-center text-sm" placeholder="0"
                        value={result.homeScore} onChange={(e) => setResult({ ...result, homeScore: e.target.value })} />
                      <span className="text-muted-foreground text-xs">–</span>
                      <Input type="number" min="0" className="h-7 w-16 text-center text-sm" placeholder="0"
                        value={result.awayScore} onChange={(e) => setResult({ ...result, awayScore: e.target.value })} />
                      <span className="text-xs text-muted-foreground w-24 truncate">{f.awayTeam?.name}</span>
                      <Button size="sm" className="h-7 text-xs" onClick={() => enterResult.mutate(f.id)}
                        disabled={enterResult.isPending || result.homeScore === "" || result.awayScore === ""}>
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEnteringResult(null)}>
                        <span>✕</span>
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs text-red-500 ml-auto"
                        onClick={() => setForfeitPending({ fid: f.id, teamId: f.homeTeamId, teamName: f.homeTeam?.name ?? "Home Team" })}>
                        Forfeit Home
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))
      )}
      <AlertDialog open={forfeitPending !== null} onOpenChange={(open) => { if (!open) setForfeitPending(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Record forfeit?</AlertDialogTitle>
            <AlertDialogDescription>This will record a forfeit loss for {forfeitPending?.teamName}. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (forfeitPending) { forfeit.mutate({ fid: forfeitPending.fid, teamId: forfeitPending.teamId }); setForfeitPending(null); } }}
            >
              Record Forfeit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Teams Panel ────────────────────────────────────────────────────────────────

function TeamsPanel({ league }: { league: any }) {
  const getHeaders = useAuthHeaders();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { canManageLeagues } = useAdminPermissions();
  const [adding, setAdding] = useState(false);
  const [newTeam, setNewTeam] = useState({ name: "", captainUserId: "", depositPaid: false });
  const [updatingReg, setUpdatingReg] = useState<{ teamId: number; field: string } | null>(null);
  const [editTeam, setEditTeam] = useState<{ id: number; name: string } | null>(null);

  const { data: teams, isLoading } = useQuery({
    queryKey: ["league-teams", league.id],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/leagues/${league.id}/teams`, { headers });
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const addTeam = useMutation({
    mutationFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/leagues/${league.id}/teams`, {
        method: "POST", headers, body: JSON.stringify(newTeam),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["league-teams", league.id] });
      qc.invalidateQueries({ queryKey: ["leagues"] });
      toast({ title: "Team added" });
      setAdding(false); setNewTeam({ name: "", captainUserId: "", depositPaid: false });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateReg = useMutation({
    mutationFn: async ({ teamId, updates }: { teamId: number; updates: any }) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/leagues/${league.id}/teams/${teamId}/registration`, {
        method: "PATCH", headers, body: JSON.stringify(updates),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["league-teams", league.id] });
      toast({ title: "Registration updated" });
      setUpdatingReg(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addMember = useMutation({
    mutationFn: async ({ teamId, userId }: { teamId: number; userId: string }) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/teams/${teamId}/members`, {
        method: "POST", headers, body: JSON.stringify({ userId, role: "player" }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["league-teams", league.id] }); toast({ title: "Player added to roster" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const patchTeam = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/teams/${id}`, {
        method: "PATCH", headers, body: JSON.stringify({ name }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["league-teams", league.id] });
      toast({ title: "Team updated" });
      setEditTeam(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="px-4 pb-4"><Skeleton className="h-20" /></div>;

  const maxTeams = league.maxTeams ?? 0;
  const registeredCount = teams?.length ?? 0;
  const fillPct = maxTeams > 0 ? Math.min(100, Math.round((registeredCount / maxTeams) * 100)) : 0;
  const openSlots = Math.max(0, maxTeams - registeredCount);
  const fillColor = fillPct >= 90 ? "bg-red-500" : fillPct >= 60 ? "bg-amber-500" : "bg-green-500";

  return (
    <div className="border-t bg-muted/30 px-4 py-4">
      {/* Live roster fill view */}
      {maxTeams > 0 && (
        <div className="mb-4 p-3 bg-background rounded-lg border">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Roster Fill</span>
            <span className="text-xs font-medium">
              {registeredCount}/{maxTeams} teams
              {openSlots > 0 && <span className="text-green-500 ml-1.5">· {openSlots} open</span>}
              {openSlots === 0 && <span className="text-red-500 ml-1.5">· Full</span>}
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-500 ${fillColor}`} style={{ width: `${fillPct}%` }} />
          </div>
          {fillPct >= 90 && openSlots === 0 && (
            <p className="text-xs text-red-500 mt-1">League is at full capacity. New teams will be waitlisted.</p>
          )}
          {fillPct >= 60 && openSlots > 0 && (
            <p className="text-xs text-amber-500 mt-1">Filling up — {openSlots} spot{openSlots === 1 ? "" : "s"} remaining.</p>
          )}
        </div>
      )}
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Teams ({registeredCount})</span>
        {canManageLeagues && (
          <Button size="sm" onClick={() => setAdding(!adding)}>
            <Plus className="h-3 w-3 mr-1" /> Add Team
          </Button>
        )}
      </div>

      {adding && (
        <div className="bg-background rounded-lg border p-3 mb-3 space-y-3">
          <p className="text-sm font-medium">Add Team</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Team Name *</Label>
              <Input className="h-8 text-sm mt-1" value={newTeam.name}
                onChange={(e) => setNewTeam({ ...newTeam, name: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Captain Clerk User ID</Label>
              <Input className="h-8 text-sm mt-1" placeholder="user_xxx" value={newTeam.captainUserId}
                onChange={(e) => setNewTeam({ ...newTeam, captainUserId: e.target.value })} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={newTeam.depositPaid}
              onChange={(e) => setNewTeam({ ...newTeam, depositPaid: e.target.checked })} />
            Deposit paid
          </label>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => addTeam.mutate()} disabled={addTeam.isPending || !newTeam.name}>Add</Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {!teams?.length ? (
        <p className="text-sm text-muted-foreground">No teams registered yet.</p>
      ) : (
        <div className="space-y-3">
          {teams.map((t: any) => (
            <div key={t.id} className="bg-background rounded-lg border overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-2">
                  {editTeam?.id === t.id ? (
                    <div className="flex items-center gap-1.5">
                      <Input
                        className="h-6 text-xs w-36"
                        value={editTeam.name}
                        onChange={(e) => setEditTeam({ ...editTeam, name: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Enter") patchTeam.mutate(editTeam); if (e.key === "Escape") setEditTeam(null); }}
                        autoFocus
                      />
                      <Button size="sm" className="h-6 text-xs px-2" onClick={() => patchTeam.mutate(editTeam)} disabled={patchTeam.isPending}>Save</Button>
                      <Button size="sm" variant="ghost" className="h-6 text-xs px-1" onClick={() => setEditTeam(null)}>✕</Button>
                    </div>
                  ) : (
                    <>
                      <span className="font-medium text-sm">{t.name}</span>
                      {canManageLeagues && (
                        <button className="text-muted-foreground hover:text-foreground" onClick={() => setEditTeam({ id: t.id, name: t.name })} title="Edit team name">
                          <Pencil className="h-3 w-3" />
                        </button>
                      )}
                    </>
                  )}
                  <Badge variant={t.status === "active" ? "secondary" : t.status === "pending" ? "outline" : "destructive"} className="text-xs">
                    {t.status}
                  </Badge>
                  {t.registration && paymentBadge(t.registration.paymentStatus)}
                </div>
                <div className="flex items-center gap-2">
                  {t.registration && (
                    <span className="text-xs text-muted-foreground">
                      ${Number(t.registration.amountPaid).toFixed(2)} / ${Number(t.registration.totalAmount).toFixed(2)}
                    </span>
                  )}
                  {canManageLeagues && (
                  <Select
                    value={t.registration?.paymentStatus ?? "unpaid"}
                    onValueChange={(v) => updateReg.mutate({ teamId: t.id, updates: { paymentStatus: v, status: v === "paid" ? "confirmed" : undefined } })}>
                    <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAYMENT_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                </div>
              </div>
              {/* Members */}
              <div className="bg-muted/30 border-t px-3 py-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-muted-foreground">
                    {t.members?.filter((m: any) => ["player","captain"].includes(m.role)).length ?? 0} player(s) ·{" "}
                    {t.members?.filter((m: any) => m.role === "coach").length ?? 0} coach ·{" "}
                    {t.members?.filter((m: any) => m.role === "manager").length ?? 0} manager
                  </span>
                  {canManageLeagues && <AddMemberInline teamId={t.id} onAdd={(userId) => addMember.mutate({ teamId: t.id, userId })} />}
                </div>
                {t.members?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {t.members.map((m: any) => {
                      const name = m.user?.firstName
                        ? `${m.user.firstName}${m.user.lastName ? ` ${m.user.lastName[0]}.` : ""}`
                        : m.user?.email ?? m.userId;
                      const roleBadge =
                        m.role === "captain"  ? <span className="ml-1 text-amber-400">⭐</span> :
                        m.role === "coach"    ? <Badge className="ml-1 h-3.5 px-1 text-[9px] bg-blue-600 text-white">Coach</Badge> :
                        m.role === "manager"  ? <Badge className="ml-1 h-3.5 px-1 text-[9px] bg-violet-600 text-white">Mgr</Badge> :
                        null;
                      return (
                        <span key={m.id} className={`inline-flex items-center text-xs border rounded px-2 py-0.5 ${
                          m.role === "coach"   ? "bg-blue-950/30 border-blue-800/40 text-blue-300" :
                          m.role === "manager" ? "bg-violet-950/30 border-violet-800/40 text-violet-300" :
                          m.role === "captain" ? "bg-amber-950/30 border-amber-800/40 text-amber-300" :
                          "bg-background"
                        }`}>
                          {name}{roleBadge}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddMemberInline({ teamId, onAdd }: { teamId: number; onAdd: (userId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [uid, setUid] = useState("");
  return open ? (
    <div className="flex gap-1">
      <Input className="h-6 text-xs w-40" placeholder="Clerk user_id" value={uid} onChange={(e) => setUid(e.target.value)} />
      <Button size="sm" className="h-6 text-xs px-2" onClick={() => { onAdd(uid); setUid(""); setOpen(false); }}>Add</Button>
      <Button size="sm" variant="ghost" className="h-6 text-xs px-1" onClick={() => setOpen(false)}>✕</Button>
    </div>
  ) : (
    <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setOpen(true)}>
      <UserPlus className="h-3 w-3 mr-1" /> Add Player
    </Button>
  );
}

// ─── League Waitlist Panel ────────────────────────────────────────────────────

function LeagueWaitlistPanel({ leagueId }: { leagueId: number }) {
  const { canManageLeagues } = useAdminPermissions();
  const qc = useQueryClient();
  const { toast } = useToast();
  const getHeaders = useAuthHeaders();

  const { data: waitlist, isLoading } = useQuery({
    queryKey: ["league-waitlist", leagueId],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/leagues/${leagueId}/waitlist`, { headers });
      return r.ok ? r.json() : [];
    },
  });

  const promote = useMutation({
    mutationFn: async (regId: number) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/leagues/${leagueId}/waitlist/${regId}/promote`, { method: "POST", headers });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["league-waitlist", leagueId] });
      qc.invalidateQueries({ queryKey: ["league-teams", leagueId] });
      toast({ title: "Team promoted to active" });
    },
    onError: (e: any) => toast({ title: "Promote failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="px-4 pb-4"><div className="h-12 bg-muted rounded animate-pulse" /></div>;

  return (
    <div className="border-t bg-muted/30 px-4 py-4 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Waitlist ({waitlist?.length ?? 0})
        </span>
      </div>
      {(!waitlist || waitlist.length === 0) && (
        <p className="text-xs text-muted-foreground">No teams on the waitlist.</p>
      )}
      <div className="space-y-2">
        {waitlist?.map((r: any) => (
          <div key={r.id} className="bg-background border rounded-lg p-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex-shrink-0 h-7 w-7 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 flex items-center justify-center text-xs font-bold">
                #{r.waitlistPosition ?? "?"}
              </span>
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{r.team?.name ?? `Team #${r.teamId}`}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Joined {r.createdAt ? format(new Date(r.createdAt), "MMM d, yyyy") : "—"}
                </div>
              </div>
            </div>
            {canManageLeagues && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1 flex-shrink-0"
                onClick={() => promote.mutate(r.id)}
                disabled={promote.isPending}
              >
                <UserPlus className="h-3.5 w-3.5" /> Promote
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── League Row ─────────────────────────────────────────────────────────────────

function VisibilityToggleGroup({ eventType, eventId, isPublished, isFeatured, showOnMobile, canManage, queryKey }: {
  eventType: string; eventId: number;
  isPublished: boolean; isFeatured: boolean; showOnMobile: boolean;
  canManage: boolean; queryKey: string[];
}) {
  const getHeaders = useAuthHeaders();
  const qc = useQueryClient();
  const { toast } = useToast();

  const patchVisibility = useMutation({
    mutationFn: async (patch: { isPublished?: boolean; isFeatured?: boolean; showOnMobile?: boolean }) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/programs/${eventType}s/${eventId}/visibility`, {
        method: "PATCH", headers, body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey }); },
    onError: (e: any) => toast({ title: "Error saving visibility", description: e.message, variant: "destructive" }),
  });

  if (!canManage) return null;

  return (
    <div className="flex items-center gap-0.5 border rounded-md overflow-hidden" title="Visibility controls">
      <button
        type="button"
        className={`h-7 w-8 flex items-center justify-center transition-colors ${isPublished ? "bg-green-500/15 text-green-500 hover:bg-green-500/25" : "text-muted-foreground/40 hover:bg-muted"}`}
        title={isPublished ? "Published — click to unpublish" : "Unpublished — click to publish"}
        onClick={(e) => { e.stopPropagation(); patchVisibility.mutate({ isPublished: !isPublished }); }}
      >
        <Globe className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className={`h-7 w-8 flex items-center justify-center transition-colors border-l ${isFeatured ? "bg-amber-500/15 text-amber-500 hover:bg-amber-500/25" : "text-muted-foreground/40 hover:bg-muted"}`}
        title={isFeatured ? "Featured on homepage — click to unfeature" : "Not featured — click to feature on homepage"}
        onClick={(e) => { e.stopPropagation(); patchVisibility.mutate({ isFeatured: !isFeatured }); }}
      >
        <Star className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className={`h-7 w-8 flex items-center justify-center transition-colors border-l ${showOnMobile ? "bg-blue-500/15 text-blue-500 hover:bg-blue-500/25" : "text-muted-foreground/40 hover:bg-muted"}`}
        title={showOnMobile ? "Visible in mobile app — click to hide" : "Hidden from mobile app — click to show"}
        onClick={(e) => { e.stopPropagation(); patchVisibility.mutate({ showOnMobile: !showOnMobile }); }}
      >
        <Smartphone className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function LeagueRow({ league, seasons, courts, onEdit, onDelete, onOverride }: any) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const getHeaders = useAuthHeaders();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { canManageLeagues, isSuperAdmin } = useAdminPermissions();

  const { data: teams } = useQuery({
    queryKey: ["league-teams", league.id],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/leagues/${league.id}/teams`, { headers });
      return r.json();
    },
    enabled: expanded === "teams" || expanded === "free-agents",
  });

  const generateBracket = useMutation({
    mutationFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/leagues/${league.id}/brackets/generate`, { method: "POST", headers });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: (data) => toast({ title: `Bracket generated — ${data.generated} playoff fixtures` }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const season = seasons?.find((s: any) => s.id === league.seasonId);
  const court = courts?.find((c: any) => c.id === league.courtId);

  return (
    <Card className="overflow-hidden">
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(null)}
      >
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold">{league.name}</span>
              <Badge variant={league.status === "active" ? "default" : league.status === "completed" ? "secondary" : "outline"} className="text-xs">
                {league.status}
              </Badge>
              <Badge variant="outline" className="text-xs">{league.format}</Badge>
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
              <span>{AGE_GROUPS.find(a => a.value === league.ageGroup)?.label ?? league.ageGroup}</span>
              {season && <span>· {season.name}</span>}
              {court && <span>· {court.name}</span>}
              {league.registrationOpen && <Badge variant="outline" className="text-xs text-green-500 border-green-500/50">Reg Open</Badge>}
            </div>
            {/* Live roster fill bar */}
            {league.maxTeams > 0 && (
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 max-w-[160px] h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      (league.teamsRegistered / league.maxTeams) >= 0.9
                        ? "bg-red-500"
                        : (league.teamsRegistered / league.maxTeams) >= 0.6
                        ? "bg-amber-500"
                        : "bg-green-500"
                    }`}
                    style={{ width: `${Math.min(100, Math.round((league.teamsRegistered / league.maxTeams) * 100))}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground">
                  {league.teamsRegistered}/{league.maxTeams} teams
                  {league.maxTeams - league.teamsRegistered > 0 && (
                    <span className="text-green-500 ml-1">· {league.maxTeams - league.teamsRegistered} open</span>
                  )}
                  {league.teamsRegistered >= league.maxTeams && (
                    <span className="text-red-500 ml-1">· Full</span>
                  )}
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <VisibilityToggleGroup
            eventType="league"
            eventId={league.id}
            isPublished={league.isPublished ?? true}
            isFeatured={league.isFeatured ?? false}
            showOnMobile={league.showOnMobile ?? true}
            canManage={canManageLeagues}
            queryKey={["leagues"]}
          />
          {league.playoffEnabled && (
            <Button size="sm" variant="outline" className="h-7 text-xs"
              onClick={(e) => { e.stopPropagation(); generateBracket.mutate(); }}>
              <Trophy className="h-3 w-3 mr-1" /> Bracket
            </Button>
          )}
          {onOverride && (
            <Button
              size="sm"
              variant={league.activeOverride === "active" ? "default" : league.activeOverride === "closed" ? "destructive" : "outline"}
              className="h-7 text-xs"
              title={`Active override: ${league.activeOverride ?? "auto"}`}
              onClick={(e) => {
                e.stopPropagation();
                const next = league.activeOverride === "active" ? null : league.activeOverride === "closed" ? "active" : "closed";
                onOverride(league.id, next);
              }}
            >
              {league.activeOverride === "active" ? "Force On" : league.activeOverride === "closed" ? "Force Off" : "Auto"}
            </Button>
          )}
          {onEdit && (
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={(e) => { e.stopPropagation(); onEdit(league); }}>
              <Pencil className="h-3 w-3" />
            </Button>
          )}
          {onDelete && (
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500" onClick={(e) => { e.stopPropagation(); onDelete(league.id); }}>
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      <div className="border-t">
        <div className="flex flex-wrap">
          {["divisions", "teams", "fixtures", "standings", "free-agents", "waitlist", "revenue-split"].map((tab) => (
            <button
              key={tab}
              onClick={() => setExpanded(expanded === tab ? null : tab)}
              className={`flex-1 py-2 text-xs font-medium capitalize transition-colors min-w-[5rem] ${expanded === tab ? "bg-primary text-primary-foreground" : "hover:bg-muted/50 text-muted-foreground"}`}
            >
              {tab === "free-agents" ? "Free Agents" : tab === "revenue-split" ? "Revenue Split" : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
        {expanded === "divisions" && <DivisionManagementPanel leagueId={league.id} />}
        {expanded === "teams" && <TeamsPanel league={league} />}
        {expanded === "fixtures" && <FixturesPanel league={league} />}
        {expanded === "standings" && <StandingsPanel leagueId={league.id} />}
        {expanded === "free-agents" && <FreeAgentsPanel leagueId={league.id} teams={teams ?? []} />}
        {expanded === "waitlist" && <LeagueWaitlistPanel leagueId={league.id} />}
        {expanded === "revenue-split" && (
          <EventSplitPanel
            offeringType="league"
            offeringId={league.id}
            venueId={court?.venueId ?? null}
            eventName={league.name}
            isSuperAdmin={isSuperAdmin}
          />
        )}
      </div>
    </Card>
  );
}

// ─── Division Management Panel ──────────────────────────────────────────────────

function DivisionManagementPanel({ leagueId }: { leagueId: number }) {
  const getHeaders = useAuthHeaders();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [newDiv, setNewDiv] = useState({ name: "", format: "", ageGroups: [] as string[] });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<any>({});

  const { data: divisions, isLoading } = useQuery({
    queryKey: ["league-divisions", leagueId],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/leagues/${leagueId}/divisions`, { headers });
      return r.json();
    },
  });

  const addDiv = useMutation({
    mutationFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/leagues/${leagueId}/divisions`, {
        method: "POST", headers, body: JSON.stringify({
          name: newDiv.name.trim(),
          format: newDiv.format || null,
          ageGroups: newDiv.ageGroups,
          divisionOrder: (divisions?.length ?? 0),
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["league-divisions", leagueId] });
      toast({ title: "Division added" });
      setAdding(false); setNewDiv({ name: "", format: "", ageGroups: [] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const patchDiv = useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: any }) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/leagues/${leagueId}/divisions/${id}`, {
        method: "PATCH", headers, body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["league-divisions", leagueId] });
      toast({ title: "Division updated" });
      setEditingId(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteDiv = useMutation({
    mutationFn: async (id: number) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/leagues/${leagueId}/divisions/${id}`, { method: "DELETE", headers });
      if (!r.ok) throw new Error(await r.text());
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["league-divisions", leagueId] });
      toast({ title: "Division deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="border-t bg-muted/30 px-4 py-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5" /> Divisions
        </span>
        <Button size="sm" variant="outline" onClick={() => setAdding(!adding)}>
          <Plus className="h-3 w-3 mr-1" /> Add Division
        </Button>
      </div>

      {adding && (
        <div className="bg-background border rounded-lg p-3 mb-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Division Name *</Label>
              <Input className="h-8 text-sm mt-1" placeholder="e.g. Elite, Intermediate"
                value={newDiv.name} onChange={(e) => setNewDiv({ ...newDiv, name: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Format (optional)</Label>
              <Select value={newDiv.format || "none"} onValueChange={(v) => setNewDiv({ ...newDiv, format: v === "none" ? "" : v })}>
                <SelectTrigger className="h-8 text-sm mt-1"><SelectValue placeholder="Inherit from league" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Inherit from league</SelectItem>
                  {FORMATS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Age Groups <span className="text-muted-foreground font-normal">(select all that apply)</span></Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {AGE_GROUPS.map((a) => (
                  <label key={a.value} className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox"
                      checked={newDiv.ageGroups.includes(a.value)}
                      onChange={(e) => setNewDiv((d) => ({ ...d, ageGroups: e.target.checked ? [...d.ageGroups, a.value] : d.ageGroups.filter((v) => v !== a.value) }))}
                      className="h-4 w-4 rounded border-input accent-primary" />
                    <span className="text-xs">{a.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-2 mt-2">
            <Button size="sm" onClick={() => addDiv.mutate()} disabled={!newDiv.name.trim() || addDiv.isPending}>
              {addDiv.isPending ? "Saving…" : "Save Division"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <Skeleton className="h-16" />
      ) : !divisions?.length ? (
        <p className="text-sm text-muted-foreground">No divisions yet. Add one above.</p>
      ) : (
        <div className="space-y-2">
          {divisions.map((d: any) => (
            <div key={d.id} className="bg-background border rounded-lg p-3">
              {editingId === d.id ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Name</Label>
                      <Input className="h-8 text-sm mt-1" value={editForm.name ?? d.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs">Format</Label>
                      <Select value={editForm.format ?? d.format ?? "none"} onValueChange={(v) => setEditForm({ ...editForm, format: v === "none" ? null : v })}>
                        <SelectTrigger className="h-8 text-sm mt-1"><SelectValue placeholder="Inherit" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Inherit from league</SelectItem>
                          {FORMATS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs">Age Groups</Label>
                      <div className="flex flex-wrap gap-2 mt-1">
                        {AGE_GROUPS.map((a) => {
                          const current: string[] = editForm.ageGroups ?? d.ageGroups ?? [];
                          return (
                            <label key={a.value} className="flex items-center gap-1.5 cursor-pointer">
                              <input type="checkbox"
                                checked={current.includes(a.value)}
                                onChange={(e) => setEditForm((f: any) => ({ ...f, ageGroups: e.target.checked ? [...current, a.value] : current.filter((v) => v !== a.value) }))}
                                className="h-4 w-4 rounded border-input accent-primary" />
                              <span className="text-xs">{a.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => patchDiv.mutate({ id: d.id, patch: editForm })} disabled={patchDiv.isPending}>
                      {patchDiv.isPending ? "Saving…" : "Save"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-sm">{d.name}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {d.format && <Badge variant="outline" className="text-xs">{d.format}</Badge>}
                      {(d.ageGroups ?? []).map((ag: string) => (
                        <Badge key={ag} variant="secondary" className="text-xs">{AGE_GROUPS.find(a => a.value === ag)?.label ?? ag}</Badge>
                      ))}
                      <span className="text-xs text-muted-foreground">{d.teamCount ?? 0} team{d.teamCount !== 1 ? "s" : ""}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
                      onClick={() => { setEditingId(d.id); setEditForm({ name: d.name, format: d.format, ageGroups: d.ageGroups ?? [] }); }}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500"
                      onClick={() => deleteDiv.mutate(d.id)}
                      disabled={deleteDiv.isPending || (divisions?.length ?? 0) <= 1}
                      title={(divisions?.length ?? 0) <= 1 ? "Cannot delete the only division" : "Delete division"}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── League Form Modal ──────────────────────────────────────────────────────────

function LeagueFormModal({ league, seasons, courts, onClose, onSave }: any) {
  const getHeaders = useAuthHeaders();
  const [form, setForm] = useState(league ? { ...league, gender: league.gender ?? "any", ageGroup: Array.isArray(league.ageGroup) ? league.ageGroup : league.ageGroup ? [league.ageGroup] : ["adult"], activeOverride: league.activeOverride ?? "auto" } : {
    name: "", ageGroup: ["adult"] as string[], gender: "any", format: "5v5", courtId: "", seasonId: "",
    status: "upcoming", registrationPrice: "0", maxTeams: 8,
    registrationOpen: false, startDate: "", endDate: "", startsAt: "", endsAt: "",
    description: "", activeOverride: "auto",
    playoffEnabled: false, playoffTeams: 4, allowFreeAgents: true,
  });

  const { data: divisionList } = useQuery({
    queryKey: ["league-divisions", league?.id],
    enabled: !!league?.id,
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/leagues/${league.id}/divisions`, { headers });
      return r.json() as Promise<any[]>;
    },
  });
  const hasMultipleDivisions = Array.isArray(divisionList) && divisionList.length > 1;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background rounded-2xl border w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 space-y-4">
          <h2 className="text-xl font-bold">{league ? "Edit League" : "Create League"}</h2>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label className="text-xs">League Name *</Label>
              <Input className="mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Spring 2026 Adult Coed" />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Age Group * <span className="text-muted-foreground font-normal">(select all that apply)</span></Label>
              {hasMultipleDivisions ? (
                <div className="mt-1 rounded-lg border border-input bg-muted/40 px-3 py-2">
                  <p className="text-xs text-muted-foreground">Age groups are managed per division. Edit each division's settings in the Divisions tab.</p>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {[...new Set((divisionList ?? []).flatMap((d: any) => Array.isArray(d.ageGroups) ? d.ageGroups : []))].map((ag: any) => (
                      <span key={ag} className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">{AGE_GROUPS.find(a => a.value === ag)?.label ?? ag}</span>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {AGE_GROUPS.map((a) => (
                      <label key={a.value} className="flex items-center gap-1.5 cursor-pointer">
                        <input type="checkbox"
                          checked={((form.ageGroup as string[]) || []).includes(a.value)}
                          onChange={e => setForm((f: any) => ({ ...f, ageGroup: e.target.checked ? [...(f.ageGroup || []), a.value] : (f.ageGroup || []).filter((v: string) => v !== a.value) }))}
                          className="h-4 w-4 rounded border-input accent-primary" />
                        <span className="text-xs">{a.label}</span>
                      </label>
                    ))}
                  </div>
                  {((form.ageGroup as string[]) || []).length === 0 && <p className="text-xs text-destructive mt-1">Select at least one age group</p>}
                </>
              )}
            </div>
            <div>
              <Label className="text-xs">Gender</Label>
              <Select value={form.gender ?? "any"} onValueChange={(v) => setForm({ ...form, gender: v })}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Any" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  {GENDER_OPTIONS.map((g) => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Format *</Label>
              <Select value={form.format} onValueChange={(v) => setForm({ ...form, format: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{FORMATS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Season *</Label>
              <Select value={String(form.seasonId)} onValueChange={(v) => setForm({ ...form, seasonId: Number(v) })}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Pick season" /></SelectTrigger>
                <SelectContent>{seasons?.map((s: any) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Court *</Label>
              <Select value={String(form.courtId)} onValueChange={(v) => setForm({ ...form, courtId: Number(v) })}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Pick court" /></SelectTrigger>
                <SelectContent>{courts?.map((c: any) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Team Fee ($)</Label>
              <Input type="number" min="0" className="mt-1" value={form.registrationPrice}
                onChange={(e) => setForm({ ...form, registrationPrice: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Max Teams</Label>
              <Input type="number" min="2" className="mt-1" value={form.maxTeams}
                onChange={(e) => setForm({ ...form, maxTeams: Number(e.target.value) })} />
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Playoff Teams</Label>
              <Input type="number" min="2" className="mt-1" value={form.playoffTeams ?? 4}
                onChange={(e) => setForm({ ...form, playoffTeams: Number(e.target.value) })} />
            </div>
            <div>
              <Label className="text-xs">Start Date</Label>
              <Input type="date" className="mt-1" value={form.startDate ?? ""}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">End Date</Label>
              <Input type="date" className="mt-1" value={form.endDate ?? ""}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Active Window Start</Label>
              <Input type="datetime-local" className="mt-1" value={form.startsAt ?? ""}
                onChange={(e) => setForm({ ...form, startsAt: e.target.value ? new Date(e.target.value).toISOString() : "" })} />
            </div>
            <div>
              <Label className="text-xs">Active Window End</Label>
              <Input type="datetime-local" className="mt-1" value={form.endsAt ? form.endsAt.replace("Z", "").substring(0, 16) : ""}
                onChange={(e) => setForm({ ...form, endsAt: e.target.value ? new Date(e.target.value).toISOString() : "" })} />
            </div>
            <div>
              <Label className="text-xs">Active Override</Label>
              <Select value={form.activeOverride ?? "auto"} onValueChange={(v) => setForm({ ...form, activeOverride: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (use time window)</SelectItem>
                  <SelectItem value="active">Force Active</SelectItem>
                  <SelectItem value="closed">Force Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Description</Label>
              <Input className="mt-1" value={form.description ?? ""}
                onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Image URL (optional)</Label>
              <Input type="url" className="mt-1" value={form.imageUrl ?? ""}
                onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} placeholder="https://..." />
            </div>
          </div>

          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.registrationOpen}
                onChange={(e) => setForm({ ...form, registrationOpen: e.target.checked })} />
              Registration Open
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.playoffEnabled}
                onChange={(e) => setForm({ ...form, playoffEnabled: e.target.checked })} />
              Playoffs Enabled
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.allowFreeAgents}
                onChange={(e) => setForm({ ...form, allowFreeAgents: e.target.checked })} />
              Allow Free Agents
            </label>
          </div>

          <div className="flex gap-2 pt-2">
            <Button className="flex-1" onClick={() => onSave({ ...form, activeOverride: form.activeOverride === "auto" ? null : form.activeOverride, startsAt: form.startsAt || null, endsAt: form.endsAt || null })} disabled={!form.name || !form.seasonId || !form.courtId || !((form.ageGroup as string[]) || []).length}>
              {league ? "Save Changes" : "Create League"}
            </Button>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────────

export default function AdminLeagues() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { canManageLeagues } = useAdminPermissions();
  const getHeaders = useAuthHeaders();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [modal, setModal] = useState<null | "create" | any>(null);
  const [filterSeason, setFilterSeason] = useState<string>("all");
  const [leagueToDelete, setLeagueToDelete] = useState<number | null>(null);

  const { data: leagues, isLoading } = useQuery({
    queryKey: ["leagues"],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/leagues`, { headers });
      return r.json();
    },
  });

  const { data: seasons } = useQuery({
    queryKey: ["seasons"],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/seasons`, { headers });
      return r.json();
    },
  });

  const { data: courts } = useQuery({
    queryKey: ["courts"],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/courts`, { headers });
      return r.json();
    },
  });

  const saveLeague = useMutation({
    mutationFn: async (form: any) => {
      const headers = await getHeaders();
      const isEdit = !!form.id;
      const url = isEdit ? `${API}/leagues/${form.id}` : `${API}/leagues`;
      const r = await fetch(url, {
        method: isEdit ? "PATCH" : "POST", headers, body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leagues"] });
      toast({ title: modal?.id ? "League updated" : "League created" });
      setModal(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteLeague = useMutation({
    mutationFn: async (id: number) => {
      const headers = await getHeaders();
      await fetch(`${API}/leagues/${id}`, { method: "DELETE", headers });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["leagues"] }); toast({ title: "League deleted" }); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const overrideLeague = useMutation({
    mutationFn: async ({ id, activeOverride }: { id: number; activeOverride: string | null }) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/leagues/${id}/override`, { method: "PATCH", headers, body: JSON.stringify({ activeOverride }) });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["leagues"] }); toast({ title: "Active window override updated" }); },
    onError: (e: any) => toast({ title: "Override failed", description: e.message, variant: "destructive" }),
  });

  if (profileLoading) return <Layout><div className="container mx-auto px-4 py-8"><Skeleton className="h-96" /></div></Layout>;
  if (!profile || (profile.role !== "admin" && profile.role !== "staff" && profile.adminLevel !== "super" && profile.adminLevel !== "admin")) return <Redirect to="/" />;

  const filtered = filterSeason === "all" ? leagues : leagues?.filter((l: any) => l.seasonId === Number(filterSeason));

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold uppercase tracking-tight">League Management</h1>
            <p className="text-muted-foreground text-sm mt-1">Seasons · Teams · Schedules · Standings · Playoffs</p>
          </div>
          {canManageLeagues && (
            <Button onClick={() => setModal("create")}>
              <Plus className="h-4 w-4 mr-2" /> New League
            </Button>
          )}
        </div>

        <div className="flex items-center gap-3 mb-6">
          <Select value={filterSeason} onValueChange={setFilterSeason}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Filter by season" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Seasons</SelectItem>
              {seasons?.map((s: any) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">{filtered?.length ?? 0} league(s)</span>
        </div>

        {isLoading ? (
          <div className="space-y-4">{[1,2,3].map(i => <Skeleton key={i} className="h-24" />)}</div>
        ) : !filtered?.length ? (
          <Card className="text-center py-16 border-dashed">
            <Trophy className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No leagues found. Create one to get started.</p>
            {canManageLeagues && <Button className="mt-4" onClick={() => setModal("create")}><Plus className="h-4 w-4 mr-2" /> New League</Button>}
          </Card>
        ) : (
          <div className="space-y-4">
            {filtered.map((league: any) => (
              <LeagueRow
                key={league.id}
                league={league}
                seasons={seasons}
                courts={courts}
                onEdit={canManageLeagues ? (l: any) => setModal(l) : undefined}
                onDelete={canManageLeagues ? (id: number) => setLeagueToDelete(id) : undefined}
                onOverride={canManageLeagues ? (id: number, v: string | null) => overrideLeague.mutate({ id, activeOverride: v }) : undefined}
              />
            ))}
          </div>
        )}
      </div>

      {modal && (
        <LeagueFormModal
          league={modal === "create" ? null : modal}
          seasons={seasons}
          courts={courts}
          onClose={() => setModal(null)}
          onSave={(form: any) => {
            const data = { ...form, gender: form.gender === "any" ? null : (form.gender || null) };
            saveLeague.mutate(modal === "create" ? data : { ...data, id: modal.id });
          }}
        />
      )}

      <AlertDialog open={leagueToDelete !== null} onOpenChange={(open) => { if (!open) setLeagueToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete league?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete the league along with all its fixtures and standings. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (leagueToDelete !== null) { deleteLeague.mutate(leagueToDelete); setLeagueToDelete(null); } }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
