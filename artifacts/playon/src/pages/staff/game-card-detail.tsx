import React, { useState, useEffect, useRef } from "react";
import { Redirect, Link, useParams } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { format } from "date-fns";
import {
  ClipboardList, Calendar, MapPin, Users, CheckCircle2, Circle,
  Plus, Minus, AlertTriangle, Lock, ChevronLeft, Flag, Clock,
  Play, Pause, Shield, UserCheck, CheckCheck, Edit3, Send,
  RefreshCw,
} from "lucide-react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

interface RosterPlayer {
  userId: string;
  dbUserId: number;
  firstName: string | null;
  lastName: string | null;
  jerseyNumber: string | null;
  role: string;
  guardianContact: { name: string | null; phone: string | null } | null;
}

interface ClockState {
  startedAt: number | null;
  pausedAt: number | null;
  totalPausedMs: number;
}

interface AccumulatedFouls {
  home: number;
  away: number;
  half: 1 | 2;
}

interface Correction {
  description: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  timestamp: string;
}

interface GameCard {
  id: number;
  fixtureId: number;
  entityType: string;
  entityId: number;
  homeTeamId: number | null;
  awayTeamId: number | null;
  homeTeamName: string | null;
  awayTeamName: string | null;
  homeRoster: RosterPlayer[];
  awayRoster: RosterPlayer[];
  refUserIds: number[];
  scorekeeperId: number | null;
  scorekeeperName: string | null;
  refNames: string[];
  homeScore: number;
  awayScore: number;
  homePresent: boolean;
  awayPresent: boolean;
  status: string;
  fouls: { playerId?: number; playerName: string; team: string; description: string; timestamp: string }[];
  disciplinaryActions: { playerId?: number; playerName: string; team: string; type: string; description: string; timestamp: string }[];
  disciplinaryFlagged: boolean;
  clockState: ClockState | null;
  accumulatedFouls: AccumulatedFouls;
  goals: { team: string; playerName: string | null; score: number; timestamp: string }[];
  corrections: Correction[];
  notes: string | null;
  completedAt: string | null;
  lockedAt: string | null;
  approvedAt: string | null;
  fixture: { scheduledAt: string | null; durationMinutes: number; status: string } | null;
  court: { id: number; name: string } | null;
}

const STATUS_COLORS: Record<string, string> = {
  upcoming:          "bg-blue-100 text-blue-800",
  in_progress:       "bg-amber-100 text-amber-800",
  pending_approval:  "bg-purple-100 text-purple-800",
  approved:          "bg-green-100 text-green-800",
  completed:         "bg-green-100 text-green-800",
  cancelled:         "bg-red-100 text-red-800",
};

function computeElapsedSeconds(clockState: ClockState | null): number {
  if (!clockState || !clockState.startedAt) return 0;
  const now = Date.now();
  const end = clockState.pausedAt ?? now;
  const elapsed = end - clockState.startedAt - (clockState.totalPausedMs ?? 0);
  return Math.max(0, Math.floor(elapsed / 1000));
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function useGameCardLive(id: string | undefined, enabled: boolean) {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const { data: card, isLoading } = useQuery<GameCard>({
    queryKey: ["game-card", id],
    enabled: enabled && !!id,
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/game-cards/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load game card");
      const data = await res.json();
      setLastUpdated(new Date());
      return data;
    },
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });

  return { card, isLoading, lastUpdated };
}

function ClockDisplay({
  clockState,
  isRef,
  isLocked,
  onClock,
}: {
  clockState: ClockState | null;
  isRef: boolean;
  isLocked: boolean;
  onClock: (action: "start" | "pause" | "resume") => void;
}) {
  const [elapsed, setElapsed] = useState(computeElapsedSeconds(clockState));

  useEffect(() => {
    setElapsed(computeElapsedSeconds(clockState));
    if (!clockState?.startedAt || clockState.pausedAt) return;
    const interval = setInterval(() => {
      setElapsed(computeElapsedSeconds(clockState));
    }, 1000);
    return () => clearInterval(interval);
  }, [clockState]);

  const isRunning = !!clockState?.startedAt && !clockState.pausedAt;
  const isPaused = !!clockState?.startedAt && !!clockState.pausedAt;
  const notStarted = !clockState?.startedAt;

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-muted-foreground" />
        <span className="font-mono text-2xl font-bold tabular-nums">
          {formatElapsed(elapsed)}
        </span>
        {isRunning && (
          <span className="inline-block h-2 w-2 rounded-full bg-green-500 animate-pulse" />
        )}
        {isPaused && (
          <span className="text-xs text-amber-600 font-medium">PAUSED</span>
        )}
      </div>
      {isRef && !isLocked && (
        <div className="flex gap-1">
          {notStarted && (
            <Button size="sm" variant="outline" onClick={() => onClock("start")} className="gap-1">
              <Play className="h-3.5 w-3.5" /> Start
            </Button>
          )}
          {isRunning && (
            <Button size="sm" variant="outline" onClick={() => onClock("pause")} className="gap-1">
              <Pause className="h-3.5 w-3.5" /> Pause
            </Button>
          )}
          {isPaused && (
            <Button size="sm" variant="outline" onClick={() => onClock("resume")} className="gap-1">
              <Play className="h-3.5 w-3.5" /> Resume
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export default function GameCardDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { getToken } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [addFoulForm, setAddFoulForm] = useState({ team: "home", playerName: "", description: "" });
  const [addDiscForm, setAddDiscForm] = useState({ team: "home", playerName: "", type: "yellow_card", description: "" });
  const [showFoulForm, setShowFoulForm] = useState(false);
  const [showDiscForm, setShowDiscForm] = useState(false);
  const [notes, setNotes] = useState("");
  const [correctionText, setCorrectionText] = useState("");
  const [showCorrectionForm, setShowCorrectionForm] = useState(false);
  const [correctionDraft, setCorrectionDraft] = useState<{
    homeScore: number; awayScore: number;
  } | null>(null);
  const [goalScorerForm, setGoalScorerForm] = useState<{
    team: "home" | "away";
    visible: boolean;
    scorer: string;
    pendingScore: number;
  } | null>(null);

  const roleStr = profile?.role as string | undefined;

  const isStaff = !profileLoading && (
    roleStr === "staff" || roleStr === "admin" ||
    roleStr === "ref" || roleStr === "coach" ||
    roleStr === "scorekeeper"
  );

  const { card, isLoading, lastUpdated } = useGameCardLive(id, isStaff && !!id);

  const viewerRole: "referee" | "scorekeeper" | "admin" | "read-only" = (() => {
    if (!card || !profile) return "read-only";
    if (roleStr === "admin") return "admin";
    const dbId = profile.id;
    const refIds: number[] = Array.isArray(card.refUserIds) ? card.refUserIds : [];
    const isAssignedRef = refIds.includes(dbId) || roleStr === "ref" || roleStr === "referee";
    const isAssignedSk = card.scorekeeperId === dbId || roleStr === "scorekeeper";
    if (isAssignedRef) return "referee";
    if (isAssignedSk) return "scorekeeper";
    return "read-only";
  })();

  const isRef = viewerRole === "referee" || viewerRole === "admin";
  const isScorekeeper = viewerRole === "scorekeeper";

  async function apiCall(path: string, method: string, body?: object) {
    const token = await getToken();
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error ?? "Failed");
    return d;
  }

  const checkInMutation = useMutation({
    mutationFn: (team: "home" | "away") => apiCall(`/game-cards/${id}/check-in`, "POST", { team }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["game-card", id] }),
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const updateScoreMutation = useMutation({
    mutationFn: (body: { homeScore?: number; awayScore?: number }) =>
      apiCall(`/game-cards/${id}`, "PATCH", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["game-card", id] }),
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const updateAccumFoulsMutation = useMutation({
    mutationFn: (accumulatedFouls: AccumulatedFouls) =>
      apiCall(`/game-cards/${id}`, "PATCH", { accumulatedFouls }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["game-card", id] }),
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const addFoulMutation = useMutation({
    mutationFn: async () => {
      if (!card) return;
      const newFoul = {
        playerName: addFoulForm.playerName,
        team: addFoulForm.team,
        description: addFoulForm.description,
        timestamp: new Date().toISOString(),
      };
      return apiCall(`/game-cards/${id}`, "PATCH", { fouls: [...card.fouls, newFoul] });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["game-card", id] });
      setAddFoulForm({ team: "home", playerName: "", description: "" });
      setShowFoulForm(false);
    },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const addDiscMutation = useMutation({
    mutationFn: async () => {
      if (!card) return;
      const newAction = {
        playerName: addDiscForm.playerName,
        team: addDiscForm.team,
        type: addDiscForm.type,
        description: addDiscForm.description,
        timestamp: new Date().toISOString(),
      };
      return apiCall(`/game-cards/${id}`, "PATCH", { disciplinaryActions: [...card.disciplinaryActions, newAction] });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["game-card", id] });
      setAddDiscForm({ team: "home", playerName: "", type: "yellow_card", description: "" });
      setShowDiscForm(false);
    },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const saveNotesMutation = useMutation({
    mutationFn: () => apiCall(`/game-cards/${id}`, "PATCH", { notes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["game-card", id] });
      toast({ title: "Notes saved" });
    },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const clockMutation = useMutation({
    mutationFn: (action: "start" | "pause" | "resume") =>
      apiCall(`/game-cards/${id}/clock`, "POST", { action }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["game-card", id] }),
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const submitForApprovalMutation = useMutation({
    mutationFn: () => apiCall(`/game-cards/${id}/submit-for-approval`, "POST"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["game-card", id] });
      qc.invalidateQueries({ queryKey: ["my-game-cards"] });
      toast({ title: "Submitted for referee approval" });
    },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: () =>
      apiCall(`/game-cards/${id}/approve`, "POST", {
        homeScore: card?.homeScore,
        awayScore: card?.awayScore,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["game-card", id] });
      qc.invalidateQueries({ queryKey: ["my-game-cards"] });
      toast({ title: "Game card approved and locked" });
    },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const correctionMutation = useMutation({
    mutationFn: () =>
      apiCall(`/game-cards/${id}/correction`, "POST", { description: correctionText }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["game-card", id] });
      setCorrectionText("");
      setShowCorrectionForm(false);
      toast({ title: "Correction logged" });
    },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const recordGoalMutation = useMutation({
    mutationFn: async (payload: { team: "home" | "away"; playerName: string | null; score: number }) =>
      apiCall(`/game-cards/${id}/goal`, "POST", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["game-card", id] });
    },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      if (!card) return;
      return apiCall(`/game-cards/${id}/complete`, "POST", {
        homeScore: card.homeScore,
        awayScore: card.awayScore,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["game-card", id] });
      qc.invalidateQueries({ queryKey: ["my-game-cards"] });
      toast({ title: "Game card completed and locked" });
    },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  if (profileLoading) return <Layout><div className="p-12"><Skeleton className="h-64" /></div></Layout>;
  if (!isStaff) return <Redirect to="/dashboard" />;

  if (isLoading) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-12 max-w-3xl">
          <Skeleton className="h-8 w-48 mb-6" />
          <Skeleton className="h-64" />
        </div>
      </Layout>
    );
  }

  if (!card) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-12 max-w-3xl">
          <p className="text-muted-foreground">Game card not found.</p>
        </div>
      </Layout>
    );
  }

  const isLocked = !!card.lockedAt || card.status === "approved" || card.status === "completed";
  const isPendingApproval = card.status === "pending_approval";
  const scheduledAt = card.fixture?.scheduledAt ? new Date(card.fixture.scheduledAt) : null;
  const statusColor = STATUS_COLORS[card.status] ?? "bg-gray-100 text-gray-800";

  const accFouls: AccumulatedFouls = card.accumulatedFouls ?? { home: 0, away: 0, half: 1 };

  function incrementAccumFoul(team: "home" | "away") {
    if (!card) return;
    const updated = { ...accFouls, [team]: accFouls[team] + 1 };
    updateAccumFoulsMutation.mutate(updated);
  }

  function halftimeReset() {
    if (!card) return;
    const updated: AccumulatedFouls = { home: 0, away: 0, half: (accFouls.half === 1 ? 2 : 1) as 1 | 2 };
    updateAccumFoulsMutation.mutate(updated);
  }

  const RosterTable = ({ roster, teamName }: { roster: RosterPlayer[]; teamName: string | null }) => (
    <div>
      <h3 className="font-semibold mb-2">{teamName ?? "Team"}</h3>
      {roster.length === 0 ? (
        <p className="text-sm text-muted-foreground">No roster on file</p>
      ) : (
        <div className="space-y-1">
          {roster.map((p, i) => (
            <div key={i} className="flex items-center gap-2 text-sm py-1.5 border-b last:border-0">
              {p.jerseyNumber && (
                <span className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                  {p.jerseyNumber}
                </span>
              )}
              <span className="font-medium">{p.firstName} {p.lastName}</span>
              <span className="text-xs text-muted-foreground capitalize">{p.role}</span>
              {p.guardianContact?.name && (
                <span className="ml-auto text-xs text-muted-foreground">
                  Guardian: {p.guardianContact.name}{p.guardianContact.phone ? ` · ${p.guardianContact.phone}` : ""}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <Link href="/staff/game-cards" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
          <ChevronLeft className="h-4 w-4" />
          My Games
        </Link>

        {/* Header */}
        <div className="flex items-start gap-3 mb-6">
          <ClipboardList className="h-7 w-7 text-primary mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold font-sans uppercase tracking-tight text-primary">
                {card.homeTeamName ?? "TBD"} vs {card.awayTeamName ?? "TBD"}
              </h1>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColor}`}>
                {card.status.replace(/_/g, " ")}
              </span>
              {isLocked && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Lock className="h-3 w-3" /> Locked
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground flex-wrap">
              {scheduledAt && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  {format(scheduledAt, "EEEE, MMMM d, yyyy · h:mm a")}
                </span>
              )}
              {card.court && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {card.court.name}
                </span>
              )}
              <span className="capitalize text-xs">{card.entityType} #{card.entityId}</span>
            </div>

            {/* Role badge + live sync indicator */}
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              {viewerRole !== "read-only" && (
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                  viewerRole === "referee" || viewerRole === "admin"
                    ? "bg-blue-100 text-blue-800"
                    : "bg-orange-100 text-orange-800"
                }`}>
                  <Shield className="h-3 w-3" />
                  {viewerRole === "admin" ? "Admin" : viewerRole === "referee" ? "Referee" : "Scorekeeper"}
                </span>
              )}
              {lastUpdated && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <RefreshCw className="h-3 w-3" />
                  Updated {format(lastUpdated, "h:mm:ss a")}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── Pending Approval Banner (ref/admin view) ── */}
        {isPendingApproval && isRef && (
          <Card className="mb-6 border-purple-300 bg-purple-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2 text-purple-800">
                <AlertTriangle className="h-4 w-4" />
                Pending Your Approval
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-purple-700">
                The scorekeeper has submitted this card for your review. Please check the summary below and approve or make corrections.
              </p>
              <div className="grid grid-cols-3 text-center bg-white rounded-lg p-3 border">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">{card.homeTeamName ?? "Home"}</p>
                  <p className="text-3xl font-bold">{card.homeScore}</p>
                </div>
                <div className="text-2xl font-bold text-muted-foreground self-center">–</div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">{card.awayTeamName ?? "Away"}</p>
                  <p className="text-3xl font-bold">{card.awayScore}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="font-medium">Fouls recorded:</span> {card.fouls.length}</div>
                <div><span className="font-medium">Cards issued:</span> {card.disciplinaryActions.length}</div>
                <div><span className="font-medium">Acc. fouls (home):</span> {accFouls.home}</div>
                <div><span className="font-medium">Acc. fouls (away):</span> {accFouls.away}</div>
              </div>

              {/* Goal Log */}
              {card.goals.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Goals ({card.goals.length})</p>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {card.goals.map((g, i) => (
                      <div key={i} className="text-xs flex items-center gap-2 bg-white rounded px-2 py-1 border">
                        <span className={`font-semibold ${g.team === "home" ? "text-blue-700" : "text-rose-700"}`}>
                          {g.team === "home" ? card.homeTeamName ?? "Home" : card.awayTeamName ?? "Away"}
                        </span>
                        <span>{g.playerName ?? "Unknown scorer"}</span>
                        <span className="ml-auto text-muted-foreground">{format(new Date(g.timestamp), "h:mm a")}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {card.corrections.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Corrections logged:</p>
                  <div className="space-y-1">
                    {card.corrections.map((c, i) => (
                      <div key={i} className="text-xs bg-white rounded px-2 py-1 border">
                        {c.description} <span className="text-muted-foreground">— {format(new Date(c.timestamp), "h:mm a")}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <Button
                  className="gap-2 flex-1"
                  onClick={() => {
                    if (!confirm("Approve and finalize this game card? This will lock the card and update standings.")) return;
                    approveMutation.mutate();
                  }}
                  disabled={approveMutation.isPending}
                >
                  <CheckCheck className="h-4 w-4" />
                  Approve &amp; Finalize
                </Button>
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => {
                    setShowCorrectionForm(!showCorrectionForm);
                    setCorrectionDraft({ homeScore: card.homeScore, awayScore: card.awayScore });
                    setCorrectionText("");
                  }}
                >
                  <Edit3 className="h-4 w-4" />
                  Make a Correction
                </Button>
              </div>
              {showCorrectionForm && correctionDraft && (
                <div className="bg-white rounded-lg border p-4 space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Edit &amp; Log Correction</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs mb-1 block">{card.homeTeamName ?? "Home"} Score</Label>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="outline" className="h-7 w-7"
                          onClick={() => setCorrectionDraft(d => d ? { ...d, homeScore: Math.max(0, d.homeScore - 1) } : d)}>
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-8 text-center font-bold text-lg">{correctionDraft.homeScore}</span>
                        <Button size="icon" variant="outline" className="h-7 w-7"
                          onClick={() => setCorrectionDraft(d => d ? { ...d, homeScore: d.homeScore + 1 } : d)}>
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs mb-1 block">{card.awayTeamName ?? "Away"} Score</Label>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="outline" className="h-7 w-7"
                          onClick={() => setCorrectionDraft(d => d ? { ...d, awayScore: Math.max(0, d.awayScore - 1) } : d)}>
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-8 text-center font-bold text-lg">{correctionDraft.awayScore}</span>
                        <Button size="icon" variant="outline" className="h-7 w-7"
                          onClick={() => setCorrectionDraft(d => d ? { ...d, awayScore: d.awayScore + 1 } : d)}>
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">Correction note (required)</Label>
                    <Input
                      placeholder="e.g. Home score corrected from 3 to 4 — goal missed by scorekeeper"
                      value={correctionText}
                      onChange={(e) => setCorrectionText(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={async () => {
                        if (!correctionText) return;
                        const scoreChanged =
                          correctionDraft.homeScore !== card.homeScore ||
                          correctionDraft.awayScore !== card.awayScore;
                        await apiCall(`/game-cards/${id}/correction`, "POST", {
                          description: correctionText,
                          ...(scoreChanged ? {
                            homeScore: correctionDraft.homeScore,
                            awayScore: correctionDraft.awayScore,
                          } : {}),
                        });
                        qc.invalidateQueries({ queryKey: ["game-card", id] });
                        toast({ title: "Correction saved" });
                        setShowCorrectionForm(false);
                        setCorrectionDraft(null);
                        setCorrectionText("");
                      }}
                      disabled={!correctionText || correctionMutation.isPending}
                    >
                      Save Correction
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setShowCorrectionForm(false); setCorrectionDraft(null); }}>Cancel</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Scorekeeper: Awaiting approval state ── */}
        {isPendingApproval && isScorekeeper && (
          <Card className="mb-6 border-purple-300 bg-purple-50">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-purple-800">
                <CheckCircle2 className="h-5 w-5" />
                <div>
                  <p className="font-semibold">Awaiting Referee Approval</p>
                  <p className="text-sm text-purple-700">
                    You submitted this card for referee review. The ref will approve or make corrections shortly.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Clock Display ── */}
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Clock — Half {accFouls.half}</CardTitle>
          </CardHeader>
          <CardContent>
            <ClockDisplay
              clockState={card.clockState}
              isRef={isRef}
              isLocked={isLocked}
              onClock={(action) => clockMutation.mutate(action)}
            />
            {isScorekeeper && (
              <p className="text-xs text-muted-foreground mt-2">Clock is controlled by the referee.</p>
            )}
          </CardContent>
        </Card>

        {/* ── Officials ── */}
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <UserCheck className="h-4 w-4" /> Officials
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {card.refNames && card.refNames.length > 0 ? (
                card.refNames.map((name, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      <Shield className="h-3 w-3" /> Referee
                    </span>
                    <span className="text-sm font-medium">{name}</span>
                  </div>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">No referee assigned</span>
              )}
              {card.scorekeeperName ? (
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                    <ClipboardList className="h-3 w-3" /> Scorekeeper
                  </span>
                  <span className="text-sm font-medium">{card.scorekeeperName}</span>
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">No scorekeeper assigned</span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── Team Check-In (ref only) ── */}
        {!isLocked && !isPendingApproval && isRef && (
          <Card className="mb-6">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Team Check-In</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col items-center gap-2">
                  <p className="text-sm font-medium text-center">{card.homeTeamName ?? "Home"}</p>
                  {card.homePresent ? (
                    <span className="inline-flex items-center gap-1 text-green-600 text-sm">
                      <CheckCircle2 className="h-4 w-4" /> Present & Ready
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => checkInMutation.mutate("home")}
                      disabled={checkInMutation.isPending}
                    >
                      <Circle className="h-4 w-4 mr-1" />
                      Mark Present
                    </Button>
                  )}
                </div>
                <div className="flex flex-col items-center gap-2">
                  <p className="text-sm font-medium text-center">{card.awayTeamName ?? "Away"}</p>
                  {card.awayPresent ? (
                    <span className="inline-flex items-center gap-1 text-green-600 text-sm">
                      <CheckCircle2 className="h-4 w-4" /> Present & Ready
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => checkInMutation.mutate("away")}
                      disabled={checkInMutation.isPending}
                    >
                      <Circle className="h-4 w-4 mr-1" />
                      Mark Present
                    </Button>
                  )}
                </div>
              </div>
              {card.homePresent && card.awayPresent && card.status === "upcoming" && (
                <p className="text-sm text-center text-muted-foreground mt-3">Both teams ready — game can begin</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Score ── */}
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Score</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 items-center text-center gap-4">
              {(["home", "away"] as const).map((team, idx) => {
                const score = team === "home" ? card.homeScore : card.awayScore;
                const teamName = team === "home" ? card.homeTeamName : card.awayTeamName;
                return (
                  <React.Fragment key={team}>
                    {idx === 1 && <div className="text-2xl font-bold text-muted-foreground">–</div>}
                    <div>
                      <p className="text-sm text-muted-foreground mb-1 truncate">{teamName ?? (team === "home" ? "Home" : "Away")}</p>
                      <div className="flex items-center justify-center gap-2">
                        {!isLocked && !isPendingApproval && (isRef || isScorekeeper) && (
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-8 w-8"
                            onClick={() => {
                              const newScore = Math.max(0, score - 1);
                              updateScoreMutation.mutate(team === "home" ? { homeScore: newScore } : { awayScore: newScore });
                            }}
                            disabled={updateScoreMutation.isPending || score <= 0}
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                        )}
                        <span className="text-4xl font-bold w-12">{score}</span>
                        {!isLocked && !isPendingApproval && (isRef || isScorekeeper) && (
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-8 w-8"
                            onClick={() => {
                              const newScore = score + 1;
                              if (isScorekeeper) {
                                setGoalScorerForm({ team, visible: true, scorer: "", pendingScore: newScore });
                              } else {
                                updateScoreMutation.mutate(team === "home" ? { homeScore: newScore } : { awayScore: newScore });
                              }
                            }}
                            disabled={updateScoreMutation.isPending}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>

            {/* Goal Scorer Form (scorekeeper) */}
            {goalScorerForm?.visible && (
              <div className="mt-4 bg-muted/30 rounded-lg p-3 space-y-3">
                <p className="text-sm font-medium">
                  Goal for {goalScorerForm.team === "home" ? card.homeTeamName ?? "Home" : card.awayTeamName ?? "Away"} — record scorer (optional)
                </p>
                <div className="space-y-1">
                  <Label className="text-xs">Scorer name</Label>
                  <select
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={goalScorerForm.scorer}
                    onChange={(e) => setGoalScorerForm((f) => f ? { ...f, scorer: e.target.value } : f)}
                  >
                    <option value="">— Unknown / unrecorded —</option>
                    {(goalScorerForm.team === "home" ? card.homeRoster : card.awayRoster).map((p, i) => (
                      <option key={i} value={`${p.firstName ?? ""} ${p.lastName ?? ""}`.trim()}>
                        {p.jerseyNumber ? `#${p.jerseyNumber} ` : ""}{p.firstName} {p.lastName}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={async () => {
                      if (!goalScorerForm) return;
                      const { team, pendingScore, scorer } = goalScorerForm;
                      await recordGoalMutation.mutateAsync({
                        team,
                        playerName: scorer || null,
                        score: pendingScore,
                      });
                      toast({ title: `Goal recorded${scorer ? ` — ${scorer}` : ""}` });
                      setGoalScorerForm(null);
                    }}
                    disabled={recordGoalMutation.isPending}
                  >
                    Confirm Goal
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setGoalScorerForm(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Accumulated Fouls (both roles see; scorekeeper can increment) ── */}
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                Accumulated Fouls — Half {accFouls.half}
              </CardTitle>
              {!isLocked && !isPendingApproval && (isRef || isScorekeeper) && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs"
                  onClick={() => {
                    if (!confirm(`Reset accumulated fouls for half ${accFouls.half === 1 ? 2 : 1}?`)) return;
                    halftimeReset();
                  }}
                  disabled={updateAccumFoulsMutation.isPending}
                >
                  Halftime Reset
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              {(["home", "away"] as const).map((team) => {
                const count = accFouls[team];
                const isHigh = count >= 6;
                return (
                  <div key={team} className={`rounded-lg p-3 text-center border ${isHigh ? "border-red-400 bg-red-50" : "border-border"}`}>
                    <p className="text-xs text-muted-foreground mb-1 font-medium">
                      {team === "home" ? card.homeTeamName ?? "Home" : card.awayTeamName ?? "Away"}
                    </p>
                    <div className="flex items-center justify-center gap-2">
                      {!isLocked && !isPendingApproval && (isRef || isScorekeeper) && (
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-7 w-7"
                          onClick={() => {
                            const updated = { ...accFouls, [team]: Math.max(0, accFouls[team] - 1) };
                            updateAccumFoulsMutation.mutate(updated);
                          }}
                          disabled={updateAccumFoulsMutation.isPending || count <= 0}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                      )}
                      <span className={`text-3xl font-bold tabular-nums ${isHigh ? "text-red-600" : ""}`}>
                        {count}
                      </span>
                      {!isLocked && !isPendingApproval && (isRef || isScorekeeper) && (
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-7 w-7"
                          onClick={() => incrementAccumFoul(team)}
                          disabled={updateAccumFoulsMutation.isPending}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                    {isHigh && (
                      <p className="text-xs text-red-600 font-semibold mt-1 flex items-center justify-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> 2nd Penalty Spot Active
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* ── Rosters ── */}
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" /> Rosters
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <RosterTable roster={card.homeRoster} teamName={card.homeTeamName} />
              <RosterTable roster={card.awayRoster} teamName={card.awayTeamName} />
            </div>
          </CardContent>
        </Card>

        {/* ── Fouls (ref controls; scorekeeper reads) ── */}
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Fouls</CardTitle>
              {!isLocked && !isPendingApproval && isRef && (
                <Button size="sm" variant="outline" onClick={() => setShowFoulForm(!showFoulForm)}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add Foul
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {showFoulForm && !isLocked && isRef && (
              <div className="bg-muted/30 rounded-lg p-3 mb-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Team</Label>
                    <select
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                      value={addFoulForm.team}
                      onChange={(e) => setAddFoulForm((f) => ({ ...f, team: e.target.value }))}
                    >
                      <option value="home">{card.homeTeamName ?? "Home"}</option>
                      <option value="away">{card.awayTeamName ?? "Away"}</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Player name</Label>
                    <Input
                      placeholder="Player name"
                      value={addFoulForm.playerName}
                      onChange={(e) => setAddFoulForm((f) => ({ ...f, playerName: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Notes (optional)</Label>
                  <Input
                    placeholder="Brief description"
                    value={addFoulForm.description}
                    onChange={(e) => setAddFoulForm((f) => ({ ...f, description: e.target.value }))}
                  />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => addFoulMutation.mutate()} disabled={!addFoulForm.playerName || addFoulMutation.isPending}>
                    Save Foul
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowFoulForm(false)}>Cancel</Button>
                </div>
              </div>
            )}
            {card.fouls.length === 0 ? (
              <p className="text-sm text-muted-foreground">No fouls recorded.</p>
            ) : (
              <div className="space-y-1">
                {card.fouls.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm py-1 border-b last:border-0">
                    <span className="font-medium">{f.playerName}</span>
                    <span className="text-xs text-muted-foreground capitalize">({f.team})</span>
                    {f.description && <span className="text-xs text-muted-foreground">— {f.description}</span>}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {format(new Date(f.timestamp), "h:mm a")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Disciplinary Actions (ref only controls) ── */}
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Flag className="h-4 w-4" /> Disciplinary Actions
                {card.disciplinaryFlagged && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                    <AlertTriangle className="h-3 w-3" /> Flagged for review
                  </span>
                )}
              </CardTitle>
              {!isLocked && !isPendingApproval && isRef && (
                <Button size="sm" variant="outline" onClick={() => setShowDiscForm(!showDiscForm)}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add Action
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {showDiscForm && !isLocked && isRef && (
              <div className="bg-muted/30 rounded-lg p-3 mb-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Team</Label>
                    <select
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                      value={addDiscForm.team}
                      onChange={(e) => setAddDiscForm((f) => ({ ...f, team: e.target.value }))}
                    >
                      <option value="home">{card.homeTeamName ?? "Home"}</option>
                      <option value="away">{card.awayTeamName ?? "Away"}</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Player name</Label>
                    <Input
                      placeholder="Player name"
                      value={addDiscForm.playerName}
                      onChange={(e) => setAddDiscForm((f) => ({ ...f, playerName: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Action type</Label>
                    <select
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                      value={addDiscForm.type}
                      onChange={(e) => setAddDiscForm((f) => ({ ...f, type: e.target.value }))}
                    >
                      <option value="yellow_card">Yellow Card</option>
                      <option value="red_card">Red Card</option>
                      <option value="blue_card">Blue Card</option>
                      <option value="ejection">Ejection</option>
                      <option value="warning">Warning</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Description</Label>
                    <Input
                      placeholder="Reason / details"
                      value={addDiscForm.description}
                      onChange={(e) => setAddDiscForm((f) => ({ ...f, description: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => addDiscMutation.mutate()} disabled={!addDiscForm.playerName || addDiscMutation.isPending}>
                    Save Action
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowDiscForm(false)}>Cancel</Button>
                </div>
              </div>
            )}
            {card.disciplinaryActions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No disciplinary actions recorded.</p>
            ) : (
              <div className="space-y-1">
                {card.disciplinaryActions.map((a, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm py-1 border-b last:border-0">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-bold ${
                      a.type === "red_card" ? "bg-red-600 text-white" :
                      a.type === "yellow_card" ? "bg-yellow-400 text-black" :
                      "bg-blue-600 text-white"
                    }`}>
                      {a.type.replace(/_/g, " ")}
                    </span>
                    <span className="font-medium">{a.playerName}</span>
                    <span className="text-xs text-muted-foreground capitalize">({a.team})</span>
                    {a.description && <span className="text-xs text-muted-foreground">— {a.description}</span>}
                    <span className="ml-auto text-xs text-muted-foreground">{format(new Date(a.timestamp), "h:mm a")}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Notes (ref only) ── */}
        {!isLocked && isRef && !isPendingApproval && (
          <Card className="mb-6">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <textarea
                className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none min-h-[80px]"
                placeholder="Add game notes..."
                value={notes || card.notes || ""}
                onChange={(e) => setNotes(e.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => saveNotesMutation.mutate()}
                disabled={saveNotesMutation.isPending}
              >
                Save Notes
              </Button>
            </CardContent>
          </Card>
        )}

        {card.notes && isLocked && (
          <Card className="mb-6">
            <CardHeader className="pb-2"><CardTitle className="text-base">Notes</CardTitle></CardHeader>
            <CardContent><p className="text-sm">{card.notes}</p></CardContent>
          </Card>
        )}

        {/* ── Corrections log ── */}
        {card.corrections && card.corrections.length > 0 && (
          <Card className="mb-6">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Edit3 className="h-4 w-4" /> Corrections
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {card.corrections.map((c, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm py-1 border-b last:border-0">
                    <span className="text-muted-foreground shrink-0">{format(new Date(c.timestamp), "h:mm a")}</span>
                    <span>{c.description}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Action buttons ── */}
        {!isLocked && !isPendingApproval && (
          <div className="flex justify-end gap-2 flex-wrap">
            {isScorekeeper && (
              <Button
                className="gap-2"
                variant="outline"
                onClick={() => {
                  if (!confirm("Submit this game card to the referee for approval?")) return;
                  submitForApprovalMutation.mutate();
                }}
                disabled={submitForApprovalMutation.isPending}
              >
                <Send className="h-4 w-4" />
                Submit for Ref Approval
              </Button>
            )}
            {isRef && !card.scorekeeperId && (
              <Button
                className="gap-2"
                onClick={() => {
                  if (!confirm("Mark this game as complete? The card will be locked and cannot be edited.")) return;
                  completeMutation.mutate();
                }}
                disabled={completeMutation.isPending}
              >
                <Lock className="h-4 w-4" />
                Complete &amp; Lock Game Card
              </Button>
            )}
          </div>
        )}

        {isLocked && card.completedAt && (
          <div className="text-center text-sm text-muted-foreground mt-4">
            Completed {format(new Date(card.completedAt), "MMMM d, yyyy 'at' h:mm a")}
            {card.approvedAt && (
              <span> · Approved {format(new Date(card.approvedAt), "MMMM d, yyyy 'at' h:mm a")}</span>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
