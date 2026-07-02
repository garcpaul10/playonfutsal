import React, { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@clerk/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Crown, Plus, Calendar, Users, Heart, Flame, Trophy,
  Settings, Swords, Clock,
  UserCheck, Edit2, Trash2, Pause, Play, Timer, X, Zap, ShoppingBag,
  AlertTriangle, ListOrdered,
} from "lucide-react";
import { format } from "date-fns";

const API = (import.meta.env.VITE_API_URL ?? "https://workspaceapi-server-production-3488.up.railway.app").replace(/\/$/, "") + "/api";

function authFetch(token: string | null, url: string, opts?: RequestInit) {
  return fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts?.headers ?? {}),
    },
  });
}

const STATUS_COLORS: Record<string, string> = {
  upcoming: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  active: "bg-green-500/10 text-green-400 border-green-500/20",
  completed: "bg-muted text-muted-foreground border-border",
  cancelled: "bg-red-500/10 text-red-400 border-red-500/20",
  scheduled: "bg-blue-500/10 text-blue-400 border-blue-500/20",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded border ${STATUS_COLORS[status] ?? "bg-muted text-muted-foreground"}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export default function AdminKingsOfTheCourt() {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();

  const [selectedSeasonId, setSelectedSeasonId] = useState<number | null>(null);
  const [showCreditForm, setShowCreditForm] = useState<number | null>(null);
  const [showModDialog, setShowModDialog] = useState<number | null>(null);
  const [modForm, setModForm] = useState({ userId: "", courtNumber: 1 });

  // Phase 2 state
  const [showDramaForm, setShowDramaForm] = useState(false);
  const [editDramaRule, setEditDramaRule] = useState<Record<string, unknown> | null>(null);
  const [dramaForm, setDramaForm] = useState({ name: "", triggerType: "consecutive_wins", threshold: 3, rewardLives: 1, notificationMessage: "" });
  const [extendBattleId, setExtendBattleId] = useState<number | null>(null);
  const [extendMinutes, setExtendMinutes] = useState(15);
  const [showLifePacksForm, setShowLifePacksForm] = useState(false);
  const [lifePacksJson, setLifePacksJson] = useState("");
  const [waitlistWindowInput, setWaitlistWindowInput] = useState(15);
  const [showWaitlist, setShowWaitlist] = useState<number | null>(null);
  const [disputeCardId, setDisputeCardId] = useState<number | null>(null);
  const [disputeForm, setDisputeForm] = useState({ newWinnerTeamId: "", overrideNotes: "" });

  const [creditForm, setCreditForm] = useState({ amount: 3, reason: "" });
  const [deleteSeasonId, setDeleteSeasonId] = useState<number | null>(null);
  const [deleteConflict, setDeleteConflict] = useState<string | null>(null);

  const { data: seasons = [], isLoading: seasonsLoading } = useQuery({
    queryKey: ["kotc-seasons"],
    queryFn: async () => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/seasons`);
      if (!res.ok) throw new Error("Failed to load seasons");
      return res.json();
    },
  });

  const { data: battles = [], isLoading: battlesLoading } = useQuery({
    queryKey: ["kotc-battles", selectedSeasonId],
    enabled: !!selectedSeasonId,
    queryFn: async () => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/seasons/${selectedSeasonId}/battles`);
      if (!res.ok) throw new Error("Failed to load battles");
      return res.json();
    },
  });

  const { data: teams = [], isLoading: teamsLoading } = useQuery({
    queryKey: ["kotc-teams", selectedSeasonId],
    enabled: !!selectedSeasonId,
    queryFn: async () => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/seasons/${selectedSeasonId}/teams`);
      if (!res.ok) throw new Error("Failed to load teams");
      return res.json();
    },
  });

  const { data: leaderboard = [] } = useQuery({
    queryKey: ["kotc-leaderboard", selectedSeasonId],
    enabled: !!selectedSeasonId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/seasons/${selectedSeasonId}/leaderboard`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: dramaRules = [] } = useQuery({
    queryKey: ["kotc-drama-rules", selectedSeasonId],
    enabled: !!selectedSeasonId,
    queryFn: async () => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/seasons/${selectedSeasonId}/drama-rules`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: waitlistEntries = [] } = useQuery({
    queryKey: ["kotc-waitlist", showWaitlist],
    enabled: !!showWaitlist,
    queryFn: async () => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/battles/${showWaitlist}/waitlist`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: gameCards = [] } = useQuery({
    queryKey: ["kotc-game-cards", selectedSeasonId],
    enabled: !!selectedSeasonId,
    refetchInterval: 15_000,
    queryFn: async () => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/seasons/${selectedSeasonId}/game-cards`);
      if (!res.ok) return [];
      return res.json() as Promise<Array<{
        id: number; battleId: number; courtNumber: number;
        team1Id: number; team2Id: number; winnerTeamId: number | null;
        loserTeamId: number | null; status: string; isDisputed: boolean;
        scannedAt: string; completedAt: string | null; notes: string | null;
      }>>;
    },
  });

  const resolveDispute = useMutation({
    mutationFn: async ({ cardId, newWinnerTeamId, overrideNotes }: { cardId: number; newWinnerTeamId: number; overrideNotes: string }) => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/game-cards/${cardId}/dispute`, {
        method: "POST",
        body: JSON.stringify({ newWinnerTeamId, overrideNotes }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kotc-game-cards", selectedSeasonId] });
      qc.invalidateQueries({ queryKey: ["kotc-teams", selectedSeasonId] });
      qc.invalidateQueries({ queryKey: ["kotc-leaderboard", selectedSeasonId] });
      toast({ title: "Dispute resolved — lives adjusted" });
      setDisputeCardId(null);
      setDisputeForm({ newWinnerTeamId: "", overrideNotes: "" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const createDramaRule = useMutation({
    mutationFn: async (data: typeof dramaForm) => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/seasons/${selectedSeasonId}/drama-rules`, {
        method: "POST",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kotc-drama-rules", selectedSeasonId] });
      toast({ title: "Drama rule created!" });
      setShowDramaForm(false);
      setDramaForm({ name: "", triggerType: "consecutive_wins", threshold: 3, rewardLives: 1, notificationMessage: "" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateDramaRule = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Record<string, unknown> }) => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/drama-rules/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kotc-drama-rules", selectedSeasonId] });
      toast({ title: "Drama rule updated!" });
      setEditDramaRule(null);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteDramaRule = useMutation({
    mutationFn: async (id: number) => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/drama-rules/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kotc-drama-rules", selectedSeasonId] });
      toast({ title: "Drama rule deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const pauseBattle = useMutation({
    mutationFn: async (battleId: number) => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/battles/${battleId}/pause`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kotc-battles", selectedSeasonId] });
      toast({ title: "Battle paused" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const resumeBattle = useMutation({
    mutationFn: async (battleId: number) => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/battles/${battleId}/resume`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kotc-battles", selectedSeasonId] });
      toast({ title: "Battle resumed" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const extendBattle = useMutation({
    mutationFn: async ({ battleId, additionalMinutes }: { battleId: number; additionalMinutes: number }) => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/battles/${battleId}/extend`, {
        method: "POST",
        body: JSON.stringify({ additionalMinutes }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kotc-battles", selectedSeasonId] });
      toast({ title: "Battle extended!" });
      setExtendBattleId(null);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const cancelBattle = useMutation({
    mutationFn: async (battleId: number) => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/battles/${battleId}/cancel`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kotc-battles", selectedSeasonId] });
      toast({ title: "Battle cancelled — lives carried forward" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const promoteWaitlist = useMutation({
    mutationFn: async (waitlistId: number) => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/waitlist/${waitlistId}/promote`, {
        method: "POST",
        body: JSON.stringify({ courtNumber: 1 }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kotc-waitlist", showWaitlist] });
      toast({ title: "Team promoted from waitlist!" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const removeWaitlist = useMutation({
    mutationFn: async (waitlistId: number) => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/waitlist/${waitlistId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kotc-waitlist", showWaitlist] });
      toast({ title: "Team removed from waitlist" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const saveLifePacks = useMutation({
    mutationFn: async () => {
      let parsed;
      try { parsed = JSON.parse(lifePacksJson); } catch { throw new Error("Invalid JSON for life packs"); }
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/seasons/${selectedSeasonId}`, {
        method: "PATCH",
        body: JSON.stringify({ lifePacks: parsed, waitlistWindowMinutes: waitlistWindowInput }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kotc-seasons"] });
      toast({ title: "Life packs saved!" });
      setShowLifePacksForm(false);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const creditLives = useMutation({
    mutationFn: async ({ teamId, ...data }: { teamId: number; amount: number; reason: string }) => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/teams/${teamId}/credit-lives`, {
        method: "POST",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kotc-teams", selectedSeasonId] });
      qc.invalidateQueries({ queryKey: ["kotc-leaderboard", selectedSeasonId] });
      toast({ title: "Lives credited!" });
      setShowCreditForm(null);
      setCreditForm({ amount: 3, reason: "" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const assignMod = useMutation({
    mutationFn: async ({ battleId, userId, courtNumber }: { battleId: number; userId: number; courtNumber: number }) => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/battles/${battleId}/mods`, {
        method: "POST",
        body: JSON.stringify({ userId, courtNumber }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kotc-battles", selectedSeasonId] });
      toast({ title: "Moderator assigned!" });
      setShowModDialog(null);
      setModForm({ userId: "", courtNumber: 1 });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleVisibility = useMutation({
    mutationFn: async ({ id, field, value }: { id: number; field: "isPublished" | "isFeatured" | "showOnMobile"; value: boolean }) => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/programs/kotc/${id}/visibility`, {
        method: "PATCH",
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kotc-seasons"] });
      toast({ title: "Visibility updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteSeason = useMutation({
    mutationFn: async ({ id, force }: { id: number; force?: boolean }) => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/seasons/${id}${force ? "?force=1" : ""}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const message = (err as Record<string, string>).error ?? "Failed to delete season";
        if ((err as Record<string, boolean>).requiresForce) {
          const conflictErr = new Error(message);
          (conflictErr as Error & { requiresForce?: boolean }).requiresForce = true;
          throw conflictErr;
        }
        throw new Error(message);
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["kotc-seasons"] });
      if (selectedSeasonId === variables.id) setSelectedSeasonId(null);
      setDeleteSeasonId(null);
      setDeleteConflict(null);
      toast({ title: "Season deleted" });
    },
    onError: (e: Error & { requiresForce?: boolean }) => {
      if (e.requiresForce) {
        setDeleteConflict(e.message);
      } else {
        toast({ title: "Error", description: e.message, variant: "destructive" });
        setDeleteSeasonId(null);
        setDeleteConflict(null);
      }
    },
  });

  const selectedSeason = seasons.find((s: Record<string, unknown>) => s.id === selectedSeasonId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <Crown className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Kings of The Court</h1>
            <p className="text-sm text-muted-foreground">Manage seasons, battles, and the rotation engine</p>
          </div>
        </div>
        <Button onClick={() => setLocation("/admin/kotc/new")} className="gap-2">
          <Plus className="h-4 w-4" />
          New Season
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {seasonsLoading ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />) : null}
        {seasons.map((s: Record<string, unknown>) => (
          <div
            key={String(s.id)}
            className={`rounded-xl border p-4 text-left transition-all ${
              selectedSeasonId === Number(s.id)
                ? "border-amber-500/60 bg-amber-500/5"
                : "border-border bg-card"
            }`}
          >
            <button
              className="w-full text-left"
              onClick={() => setSelectedSeasonId(Number(s.id))}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="font-semibold text-sm text-foreground leading-tight">{String(s.name)}</p>
                <StatusBadge status={String(s.status)} />
              </div>
              <p className="text-xs text-muted-foreground capitalize">{String(s.sport)} · {String(s.genderBracket)}</p>
            </button>
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              <button
                onClick={(e) => { e.stopPropagation(); toggleVisibility.mutate({ id: Number(s.id), field: "isPublished", value: !s.isPublished }); }}
                className={`text-[10px] font-bold px-2 py-0.5 rounded border transition-colors ${s.isPublished ? "bg-green-500/20 text-green-400 border-green-500/30 hover:bg-green-500/30" : "bg-white/5 text-muted-foreground border-border hover:border-amber-500/30"}`}
                title={s.isPublished ? "Click to unpublish" : "Click to publish"}
              >
                {s.isPublished ? "Published" : "Unpublished"}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); toggleVisibility.mutate({ id: Number(s.id), field: "isFeatured", value: !s.isFeatured }); }}
                className={`text-[10px] font-bold px-2 py-0.5 rounded border transition-colors ${s.isFeatured ? "bg-amber-500/20 text-amber-400 border-amber-500/30 hover:bg-amber-500/30" : "bg-white/5 text-muted-foreground border-border hover:border-amber-500/30"}`}
                title={s.isFeatured ? "Click to unfeature" : "Click to feature"}
              >
                {s.isFeatured ? "Featured" : "Not Featured"}
              </button>
            </div>
            <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-border/60">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs gap-1 flex-1"
                onClick={(e) => { e.stopPropagation(); setLocation(`/admin/kotc/${s.id}/edit`); }}
              >
                <Edit2 className="h-3 w-3" />Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs gap-1 flex-1 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                onClick={(e) => { e.stopPropagation(); setDeleteSeasonId(Number(s.id)); setDeleteConflict(null); }}
              >
                <Trash2 className="h-3 w-3" />Delete
              </Button>
            </div>
          </div>
        ))}
      </div>

      {selectedSeason && (
        <Tabs defaultValue="battles" className="space-y-4">
          <div className="flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="battles" className="gap-2"><Swords className="h-3.5 w-3.5" />Battles</TabsTrigger>
              <TabsTrigger value="teams" className="gap-2"><Users className="h-3.5 w-3.5" />Teams</TabsTrigger>
              <TabsTrigger value="leaderboard" className="gap-2"><Trophy className="h-3.5 w-3.5" />Leaderboard</TabsTrigger>
              <TabsTrigger value="game-cards" className="gap-2"><AlertTriangle className="h-3.5 w-3.5" />Game Cards</TabsTrigger>
              <TabsTrigger value="drama" className="gap-2"><Zap className="h-3.5 w-3.5" />Drama</TabsTrigger>
              <TabsTrigger value="config" className="gap-2"><Settings className="h-3.5 w-3.5" />Config</TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Crown className="h-4 w-4 text-amber-400" />
              <span className="font-semibold text-foreground">{String(selectedSeason.name)}</span>
            </div>
          </div>

          <TabsContent value="battles" className="space-y-4">
            <div className="flex justify-end">
              <Button onClick={() => setLocation(`/admin/kotc/${selectedSeasonId}/edit`)} size="sm" className="gap-2">
                <Plus className="h-4 w-4" />
                Schedule Battle
              </Button>
            </div>
            {battlesLoading && <Skeleton className="h-32" />}
            {!battlesLoading && battles.length === 0 && (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                  <Calendar className="h-10 w-10 text-muted-foreground mb-3" />
                  <p className="font-semibold text-foreground">No battles scheduled</p>
                  <p className="text-sm text-muted-foreground">Schedule the first battle to get started.</p>
                </CardContent>
              </Card>
            )}
            <div className="space-y-3">
              {battles.map((b: Record<string, unknown>) => (
                <Card key={String(b.id)}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
                          <Swords className="h-4 w-4 text-amber-400" />
                        </div>
                        <div>
                          <p className="font-semibold text-sm text-foreground">
                            {format(new Date(String(b.scheduledAt)), "EEE, MMM d, yyyy h:mm a")}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {Number(b.courtCount)} court{Number(b.courtCount) > 1 ? "s" : ""} ·{" "}
                            max {Number(b.maxTeamsPerCourt)} teams/court ·{" "}
                            {Number(b.durationMinutes)} min
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={String(b.status)} />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { setShowModDialog(Number(b.id)); setModForm({ userId: "", courtNumber: 1 }); }}
                          className="gap-1 text-xs"
                        >
                          <UserCheck className="h-3 w-3" />
                          Assign Mod
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => window.open(`/battle-mod/${b.id}`, "_blank")}
                          className="gap-1 text-xs"
                        >
                          <UserCheck className="h-3 w-3" />
                          Mod View
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => window.open(`/kotc/battles/${b.id}/live`, "_blank")}
                          className="gap-1 text-xs text-green-600 border-green-500/30"
                        >
                          <Swords className="h-3 w-3" />
                          Live Queue
                        </Button>
                        {String(b.status) === "active" && (
                          <>
                            {(b as any).pausedAt ? (
                              <Button size="sm" variant="outline" className="gap-1 text-xs text-green-400 border-green-500/30" onClick={() => resumeBattle.mutate(Number(b.id))} disabled={resumeBattle.isPending}>
                                <Play className="h-3 w-3" />Resume
                              </Button>
                            ) : (
                              <Button size="sm" variant="outline" className="gap-1 text-xs text-amber-400 border-amber-500/30" onClick={() => pauseBattle.mutate(Number(b.id))} disabled={pauseBattle.isPending}>
                                <Pause className="h-3 w-3" />Pause
                              </Button>
                            )}
                            <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => { setExtendBattleId(Number(b.id)); setExtendMinutes(15); }}>
                              <Timer className="h-3 w-3" />+Time
                            </Button>
                          </>
                        )}
                        {String(b.status) !== "cancelled" && String(b.status) !== "completed" && (
                          <Button size="sm" variant="outline" className="gap-1 text-xs text-red-400 border-red-500/30" onClick={() => { if (confirm("Cancel battle? Lives will carry forward for all registered teams.")) cancelBattle.mutate(Number(b.id)); }} disabled={cancelBattle.isPending}>
                            <X className="h-3 w-3" />Cancel
                          </Button>
                        )}
                        <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => setShowWaitlist(Number(b.id))}>
                          <ListOrdered className="h-3 w-3" />Waitlist
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="teams" className="space-y-4">
            {teamsLoading && <Skeleton className="h-32" />}
            {!teamsLoading && teams.length === 0 && (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                  <Users className="h-10 w-10 text-muted-foreground mb-3" />
                  <p className="font-semibold text-foreground">No teams yet</p>
                  <p className="text-sm text-muted-foreground">Teams will appear here once captains create them.</p>
                </CardContent>
              </Card>
            )}
            <div className="space-y-3">
              {teams.map((t: Record<string, unknown>) => (
                <Card key={String(t.id)}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-9 h-9 rounded-full border-2 border-border flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: String(t.color || "#444") + "40", borderColor: String(t.color || "#888") + "80" }}
                        >
                          <Users className="h-4 w-4 text-foreground" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-sm text-foreground">{String(t.name)}</p>
                            {!!t.isReigning && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                <Crown className="h-2.5 w-2.5" />REIGNING
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5">
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Heart className="h-3 w-3 text-red-400" />
                              {Number(t.livesBalance)} lives
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {Array.isArray(t.players) ? t.players.length : 0} players
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={String(t.status)} />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setShowCreditForm(Number(t.id))}
                          className="gap-1 text-xs"
                        >
                          <Heart className="h-3 w-3" />
                          Credit Lives
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="drama" className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Drama Rules</h2>
              <Button size="sm" onClick={() => setShowDramaForm(true)} className="gap-2">
                <Plus className="h-4 w-4" />Add Rule
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Drama rules automatically reward bonus lives when special in-battle moments occur.</p>
            {dramaRules.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center">
                  <Zap className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No drama rules yet. Add one to spice things up!</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {(dramaRules as Array<Record<string, unknown>>).map((rule) => (
                  <Card key={String(rule.id)}>
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
                          <Zap className="h-4 w-4 text-amber-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-sm text-foreground">{String(rule.name)}</p>
                            {!rule.isActive && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Inactive</span>}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 capitalize">
                            Trigger: {String(rule.triggerType).replace(/_/g, " ")} ×{Number(rule.threshold)} → +{Number(rule.rewardLives)} life
                          </p>
                          <p className="text-xs text-muted-foreground mt-1 italic">"{String(rule.notificationMessage)}"</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setEditDramaRule(rule)} className="h-7 w-7 p-0">
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => deleteDramaRule.mutate(Number(rule.id))} className="h-7 w-7 p-0 text-red-400 hover:text-red-300">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="leaderboard" className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-amber-400" />
                  Season Leaderboard
                </CardTitle>
              </CardHeader>
              <CardContent>
                {leaderboard.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No games played yet</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-[11px] text-muted-foreground uppercase tracking-wider border-b border-border">
                          <th className="text-left pb-2 pr-4">Rank</th>
                          <th className="text-left pb-2 pr-4">Team</th>
                          <th className="text-right pb-2 pr-4">Wins</th>
                          <th className="text-right pb-2 pr-4">Battles</th>
                          <th className="text-right pb-2 pr-4">Win %</th>
                          <th className="text-right pb-2 pr-4">Lives</th>
                          <th className="text-right pb-2">Streak</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {leaderboard.map((row: Record<string, unknown>, i: number) => (
                          <tr key={String(row.teamId)} className="hover:bg-muted/30 transition-colors">
                            <td className="py-2.5 pr-4">
                              <span className={`font-bold ${i === 0 ? "text-amber-400" : i === 1 ? "text-slate-300" : i === 2 ? "text-amber-600" : "text-muted-foreground"}`}>
                                #{i + 1}
                              </span>
                            </td>
                            <td className="py-2.5 pr-4">
                              <div className="flex items-center gap-2">
                                <div className="w-6 h-6 rounded-full border border-border flex-shrink-0" style={{ backgroundColor: String(row.teamColor || "#444") + "40" }} />
                                <span className="font-medium text-foreground">{String(row.teamName)}</span>
                                {!!row.isReigning && <Crown className="h-3.5 w-3.5 text-amber-400" />}
                                {Number(row.hotStreak) >= 3 && (
                                  <span className="text-orange-400 flex items-center gap-0.5 text-xs font-bold">
                                    <Flame className="h-3 w-3" />{Number(row.hotStreak)}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 pr-4 text-right font-bold text-green-400">{Number(row.wins)}</td>
                            <td className="py-2.5 pr-4 text-right text-muted-foreground">{Number(row.battlesAttended)}</td>
                            <td className="py-2.5 pr-4 text-right text-muted-foreground">
                              {(Number(row.winRate) * 100).toFixed(0)}%
                            </td>
                            <td className="py-2.5 pr-4 text-right">
                              <span className={`flex items-center justify-end gap-1 ${Number(row.livesRemaining) <= 1 ? "text-red-400" : Number(row.livesRemaining) <= 2 ? "text-amber-400" : "text-foreground"}`}>
                                <Heart className="h-3 w-3" />{Number(row.livesRemaining)}
                              </span>
                            </td>
                            <td className="py-2.5 text-right">
                              {Number(row.hotStreak) >= 3
                                ? <span className="text-orange-400 flex items-center justify-end gap-0.5"><Flame className="h-3.5 w-3.5" />{Number(row.hotStreak)}</span>
                                : <span className="text-muted-foreground">—</span>
                              }
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="game-cards" className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                  Game Cards & Disputes
                </CardTitle>
              </CardHeader>
              <CardContent>
                {gameCards.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No game cards recorded yet for this season.</p>
                ) : (
                  <div className="space-y-2">
                    {gameCards.map((card) => {
                      const battle = battles.find((b: Record<string, unknown>) => Number(b.id) === card.battleId);
                      const team1 = teams.find((t: Record<string, unknown>) => Number(t.id) === card.team1Id);
                      const team2 = teams.find((t: Record<string, unknown>) => Number(t.id) === card.team2Id);
                      const winner = teams.find((t: Record<string, unknown>) => Number(t.id) === card.winnerTeamId);
                      const isInProgress = card.status === "in_progress";
                      return (
                        <div
                          key={card.id}
                          className={`rounded-xl border p-3 flex items-center gap-3 ${
                            card.isDisputed ? "border-amber-500/30 bg-amber-500/5" :
                            isInProgress ? "border-green-500/30 bg-green-500/5" :
                            "border-border bg-card"
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap text-sm">
                              <span className="font-medium text-foreground">{String(team1?.name ?? card.team1Id)}</span>
                              <span className="text-muted-foreground text-xs">vs</span>
                              <span className="font-medium text-foreground">{String(team2?.name ?? card.team2Id)}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                              {battle && <span>Battle {format(new Date(String((battle as Record<string, unknown>).scheduledAt)), "MMM d")}</span>}
                              <span>Court {card.courtNumber}</span>
                              {winner && !isInProgress && (
                                <span className="text-green-600 font-medium">Winner: {String(winner.name)}</span>
                              )}
                              {card.isDisputed && (
                                <span className="text-amber-600 font-semibold flex items-center gap-1">
                                  <AlertTriangle className="h-3 w-3" />Disputed
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-[11px] px-2 py-0.5 rounded font-medium border ${
                              isInProgress ? "bg-green-500/10 text-green-600 border-green-500/20" :
                              card.isDisputed ? "bg-amber-500/10 text-amber-600 border-amber-500/20" :
                              "bg-muted text-muted-foreground border-border"
                            }`}>
                              {isInProgress ? "Live" : card.isDisputed ? "Disputed" : "Completed"}
                            </span>
                            {card.status === "completed" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1 text-xs text-amber-600 border-amber-500/30 hover:bg-amber-500/10"
                                onClick={() => { setDisputeCardId(card.id); setDisputeForm({ newWinnerTeamId: "", overrideNotes: "" }); }}
                              >
                                <AlertTriangle className="h-3 w-3" />
                                Dispute
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="config" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between">
                  <span className="flex items-center gap-2"><Settings className="h-4 w-4" />Season Configuration</span>
                  <Button size="sm" variant="outline" onClick={() => setLocation(`/admin/kotc/${selectedSeasonId}/edit`)} className="gap-2">
                    <Edit2 className="h-3.5 w-3.5" />Edit
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {[
                    { label: "Sport", value: selectedSeason.sport },
                    { label: "Gender Bracket", value: selectedSeason.genderBracket },
                    { label: "Age Bracket", value: selectedSeason.ageBracket },
                    { label: "Team Size", value: `${selectedSeason.teamSize}v${selectedSeason.teamSize}` },
                    { label: "Win Target", value: `${selectedSeason.winTarget} ${selectedSeason.winCondition}` },
                    { label: "Time Limit", value: `${selectedSeason.timeLimitMinutes} min` },
                    { label: "Grace Period", value: `${selectedSeason.gracePeriodSeconds}s` },
                    { label: "Lives Required", value: selectedSeason.livesRequired },
                    { label: "Max Teams/Court", value: selectedSeason.maxTeamsPerCourt },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <dt className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</dt>
                      <dd className="mt-1 text-sm font-medium text-foreground capitalize">{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between">
                  <span className="flex items-center gap-2"><ShoppingBag className="h-4 w-4 text-green-400" />Life Packs</span>
                  <Button size="sm" variant="outline" onClick={() => {
                    setLifePacksJson(JSON.stringify((selectedSeason as any).lifePacks ?? [], null, 2));
                    setWaitlistWindowInput((selectedSeason as any).waitlistWindowMinutes ?? 15);
                    setShowLifePacksForm(true);
                  }} className="gap-2">
                    <Edit2 className="h-3.5 w-3.5" />Edit
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {((selectedSeason as any).lifePacks ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No life packs configured. Teams can only receive admin-credited lives.</p>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {((selectedSeason as any).lifePacks as Array<{ name: string; lives: number; priceCents: number }>).map((pack, i) => (
                      <div key={i} className="rounded-xl border border-border bg-card p-3">
                        <p className="font-semibold text-sm text-foreground">{pack.name}</p>
                        <p className="text-xs text-muted-foreground mt-1">{pack.lives} lives · ${(pack.priceCents / 100).toFixed(2)}</p>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-3">Waitlist lock window: {(selectedSeason as any).waitlistWindowMinutes ?? 15} min before battle start</p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {!selectedSeasonId && !seasonsLoading && seasons.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Crown className="h-14 w-14 text-amber-400 mb-4" />
            <h3 className="text-xl font-bold text-foreground mb-2">No seasons yet</h3>
            <p className="text-muted-foreground mb-6">Create your first Kings of The Court season to get started.</p>
            <Button onClick={() => setLocation("/admin/kotc/new")} className="gap-2">
              <Plus className="h-4 w-4" />
              Create First Season
            </Button>
          </CardContent>
        </Card>
      )}

      <Dialog open={showDramaForm} onOpenChange={setShowDramaForm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Zap className="h-5 w-5 text-amber-400" />New Drama Rule</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Rule Name</Label>
              <Input value={dramaForm.name} onChange={(e) => setDramaForm((f) => ({ ...f, name: e.target.value }))} placeholder='e.g. "Hot Streak"' className="mt-1" />
            </div>
            <div>
              <Label>Trigger Type</Label>
              <Select value={dramaForm.triggerType} onValueChange={(v) => setDramaForm((f) => ({ ...f, triggerType: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="consecutive_wins">Consecutive Wins</SelectItem>
                  <SelectItem value="game_without_loss">Games Played Without a Loss</SelectItem>
                  <SelectItem value="comeback_wins">Comeback Wins (won after being down)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Threshold</Label>
                <Input type="number" value={dramaForm.threshold} onChange={(e) => setDramaForm((f) => ({ ...f, threshold: Number(e.target.value) }))} className="mt-1" min={1} />
              </div>
              <div>
                <Label>Reward Lives</Label>
                <Input type="number" value={dramaForm.rewardLives} onChange={(e) => setDramaForm((f) => ({ ...f, rewardLives: Number(e.target.value) }))} className="mt-1" min={1} />
              </div>
            </div>
            <div>
              <Label>Notification Message</Label>
              <Input value={dramaForm.notificationMessage} onChange={(e) => setDramaForm((f) => ({ ...f, notificationMessage: e.target.value }))} placeholder='e.g. "🔥 Hot Streak! You earned a bonus life!"' className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDramaForm(false)}>Cancel</Button>
            <Button onClick={() => createDramaRule.mutate(dramaForm)} disabled={!dramaForm.name || createDramaRule.isPending}>
              {createDramaRule.isPending ? "Creating..." : "Create Rule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {editDramaRule && (
        <Dialog open={!!editDramaRule} onOpenChange={() => setEditDramaRule(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Zap className="h-5 w-5 text-amber-400" />Edit Drama Rule</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Rule Name</Label>
                <Input value={String(editDramaRule.name ?? "")} onChange={(e) => setEditDramaRule((r) => r ? { ...r, name: e.target.value } : r)} className="mt-1" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Threshold</Label>
                  <Input type="number" value={Number(editDramaRule.threshold)} onChange={(e) => setEditDramaRule((r) => r ? { ...r, threshold: Number(e.target.value) } : r)} className="mt-1" min={1} />
                </div>
                <div>
                  <Label>Reward Lives</Label>
                  <Input type="number" value={Number(editDramaRule.rewardLives)} onChange={(e) => setEditDramaRule((r) => r ? { ...r, rewardLives: Number(e.target.value) } : r)} className="mt-1" min={1} />
                </div>
              </div>
              <div>
                <Label>Notification Message</Label>
                <Input value={String(editDramaRule.notificationMessage ?? "")} onChange={(e) => setEditDramaRule((r) => r ? { ...r, notificationMessage: e.target.value } : r)} className="mt-1" />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="drama-active" checked={Boolean(editDramaRule.isActive)} onChange={(e) => setEditDramaRule((r) => r ? { ...r, isActive: e.target.checked } : r)} className="rounded" />
                <Label htmlFor="drama-active">Active</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditDramaRule(null)}>Cancel</Button>
              <Button onClick={() => updateDramaRule.mutate({ id: Number(editDramaRule.id), data: editDramaRule })} disabled={updateDramaRule.isPending}>
                {updateDramaRule.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={extendBattleId !== null} onOpenChange={() => setExtendBattleId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Timer className="h-5 w-5 text-amber-400" />Extend Battle Time</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Additional Minutes</Label>
              <Input type="number" value={extendMinutes} onChange={(e) => setExtendMinutes(Number(e.target.value))} className="mt-1" min={1} max={120} />
            </div>
            <p className="text-xs text-muted-foreground">This adds time to the current battle's window across all courts.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtendBattleId(null)}>Cancel</Button>
            <Button onClick={() => extendBattleId !== null && extendBattle.mutate({ battleId: extendBattleId, additionalMinutes: extendMinutes })} disabled={extendBattle.isPending}>
              {extendBattle.isPending ? "Extending..." : `+${extendMinutes} min`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showLifePacksForm} onOpenChange={setShowLifePacksForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShoppingBag className="h-5 w-5 text-green-400" />Configure Life Packs</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Waitlist Lock Window (minutes before battle)</Label>
              <Input type="number" value={waitlistWindowInput} onChange={(e) => setWaitlistWindowInput(Number(e.target.value))} className="mt-1" min={0} max={120} />
              <p className="text-xs text-muted-foreground mt-1">Teams can join/leave the waitlist until this many minutes before battle start.</p>
            </div>
            <div>
              <Label>Life Packs (JSON array)</Label>
              <Textarea
                value={lifePacksJson}
                onChange={(e) => setLifePacksJson(e.target.value)}
                className="mt-1 font-mono text-xs"
                rows={10}
                placeholder={`[\n  { "name": "Starter Pack", "lives": 3, "priceCents": 999 },\n  { "name": "Team Bundle", "lives": 10, "priceCents": 2999 }\n]`}
              />
              <p className="text-xs text-muted-foreground mt-1">Each pack needs: name (string), lives (number), priceCents (integer).</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLifePacksForm(false)}>Cancel</Button>
            <Button onClick={() => saveLifePacks.mutate()} disabled={saveLifePacks.isPending}>
              {saveLifePacks.isPending ? "Saving..." : "Save Life Packs"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showWaitlist !== null} onOpenChange={() => setShowWaitlist(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ListOrdered className="h-5 w-5 text-amber-400" />Battle Waitlist</DialogTitle>
          </DialogHeader>
          {waitlistEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No teams on the waitlist for this battle.</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {(waitlistEntries as Array<Record<string, unknown>>).map((entry, idx) => (
                <div key={String(entry.id)} className="rounded-xl border border-border bg-card p-3 flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground flex-shrink-0">
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">Team #{String(entry.teamId)}</p>
                    <p className="text-xs text-muted-foreground capitalize">{String(entry.status).replace(/_/g, " ")}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    {String(entry.status) === "waiting" && (
                      <Button size="sm" variant="outline" className="gap-1 text-xs text-green-400 border-green-500/30" onClick={() => promoteWaitlist.mutate(Number(entry.id))} disabled={promoteWaitlist.isPending}>
                        <Play className="h-3 w-3" />Promote
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => removeWaitlist.mutate(Number(entry.id))} disabled={removeWaitlist.isPending} className="h-7 w-7 p-0 text-red-400">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowWaitlist(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showModDialog !== null} onOpenChange={() => setShowModDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-amber-400" />
              Assign Battle Moderator
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>User ID</Label>
              <Input
                type="number"
                value={modForm.userId}
                onChange={(e) => setModForm((f) => ({ ...f, userId: e.target.value }))}
                placeholder="DB user ID of the moderator"
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">Enter the moderator's database user ID. Find it in the Users admin page.</p>
            </div>
            <div>
              <Label>Court Number</Label>
              <Select value={String(modForm.courtNumber)} onValueChange={(v) => setModForm((f) => ({ ...f, courtNumber: Number(v) }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Court 1</SelectItem>
                  <SelectItem value="2">Court 2</SelectItem>
                  <SelectItem value="3">Court 3</SelectItem>
                  <SelectItem value="4">Court 4</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => setShowModDialog(null)}>Cancel</Button>
            <Button
              onClick={() => showModDialog !== null && modForm.userId && assignMod.mutate({ battleId: showModDialog, userId: Number(modForm.userId), courtNumber: modForm.courtNumber })}
              disabled={!modForm.userId || assignMod.isPending}
            >
              {assignMod.isPending ? "Assigning..." : "Assign Moderator"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCreditForm !== null} onOpenChange={() => setShowCreditForm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Heart className="h-5 w-5 text-red-400" />
              Credit Lives
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Lives to Add</Label>
              <Input
                type="number"
                value={creditForm.amount}
                onChange={(e) => setCreditForm((f) => ({ ...f, amount: Number(e.target.value) }))}
                className="mt-1"
                min={1}
              />
            </div>
            <div>
              <Label>Reason</Label>
              <Input
                value={creditForm.reason}
                onChange={(e) => setCreditForm((f) => ({ ...f, reason: e.target.value }))}
                placeholder="e.g. Testing / admin override"
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => setShowCreditForm(null)}>Cancel</Button>
            <Button
              onClick={() => showCreditForm !== null && creditLives.mutate({ teamId: showCreditForm, ...creditForm })}
              disabled={creditLives.isPending}
            >
              {creditLives.isPending ? "Crediting..." : `Add ${creditForm.amount} Lives`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dispute Resolution Dialog */}
      <Dialog open={disputeCardId !== null} onOpenChange={() => setDisputeCardId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Resolve Dispute
            </DialogTitle>
          </DialogHeader>
          {disputeCardId !== null && (() => {
            const card = gameCards.find((c) => c.id === disputeCardId);
            if (!card) return null;
            const team1 = teams.find((t: Record<string, unknown>) => Number(t.id) === card.team1Id);
            const team2 = teams.find((t: Record<string, unknown>) => Number(t.id) === card.team2Id);
            return (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Override the winner for:{" "}
                  <span className="font-semibold text-foreground">{String(team1?.name ?? card.team1Id)}</span>
                  {" vs "}
                  <span className="font-semibold text-foreground">{String(team2?.name ?? card.team2Id)}</span>
                </p>
                <div>
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">New Winner</Label>
                  <Select value={disputeForm.newWinnerTeamId} onValueChange={(v) => setDisputeForm((f) => ({ ...f, newWinnerTeamId: v }))}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select the correct winner" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={String(card.team1Id)}>{String(team1?.name ?? card.team1Id)}</SelectItem>
                      <SelectItem value={String(card.team2Id)}>{String(team2?.name ?? card.team2Id)}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Override Notes</Label>
                  <Textarea
                    className="mt-1"
                    rows={3}
                    placeholder="Why is this result being overridden?"
                    value={disputeForm.overrideNotes}
                    onChange={(e) => setDisputeForm((f) => ({ ...f, overrideNotes: e.target.value }))}
                  />
                </div>
                <p className="text-xs text-muted-foreground bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
                  This will reverse the life deduction from the previous loser and apply it to the new loser. Lives cannot be restored if a team is already bowed out.
                </p>
              </div>
            );
          })()}
          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => setDisputeCardId(null)}>Cancel</Button>
            <Button
              className="gap-1 bg-amber-600 hover:bg-amber-700 text-white"
              disabled={!disputeForm.newWinnerTeamId || resolveDispute.isPending}
              onClick={() => disputeCardId !== null && resolveDispute.mutate({ cardId: disputeCardId, newWinnerTeamId: Number(disputeForm.newWinnerTeamId), overrideNotes: disputeForm.overrideNotes })}
            >
              {resolveDispute.isPending ? "Saving…" : "Override Result"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteSeasonId !== null} onOpenChange={(open) => { if (!open) { setDeleteSeasonId(null); setDeleteConflict(null); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-500">
              <Trash2 className="h-5 w-5" />Delete Season
            </DialogTitle>
          </DialogHeader>
          {deleteConflict ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-foreground">
              {deleteConflict}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              This permanently deletes the season along with all its teams, battles, and life history. This cannot be undone.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteSeasonId(null); setDeleteConflict(null); }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteSeason.isPending}
              onClick={() => deleteSeasonId !== null && deleteSeason.mutate({ id: deleteSeasonId, force: !!deleteConflict })}
            >
              {deleteSeason.isPending ? "Deleting…" : deleteConflict ? "Delete Anyway" : "Delete Season"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
