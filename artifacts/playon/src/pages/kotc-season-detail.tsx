import React, { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useAuth } from "@clerk/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Crown, Users, Heart, Swords, Calendar, Trophy, Plus,
  UserPlus, ChevronRight, Shield, Flame,
} from "lucide-react";
import { format } from "date-fns";

const API = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

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

function bracketLabel(gender: string, age: string): string {
  const g = gender === "coed" ? "Coed" : gender === "men" ? "Men" : gender === "women" ? "Women" : gender === "boys" ? "Boys" : gender === "girls" ? "Girls" : gender;
  const a = age === "open" ? "Open" : age === "adult" ? "Adult" : age.toUpperCase();
  return `${g} · ${a}`;
}

export default function KotcSeasonDetailPage() {
  const [, params] = useRoute("/kotc/seasons/:id");
  const seasonId = Number(params?.id);
  const { getToken, isSignedIn } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [requestingTeamId, setRequestingTeamId] = useState<number | null>(null);

  const { data: season, isLoading: seasonLoading } = useQuery({
    queryKey: ["kotc-season-public", seasonId],
    queryFn: async () => {
      const token = await getToken().catch(() => null);
      const res = await authFetch(token, `${API}/kotc/seasons/${seasonId}`);
      if (!res.ok) throw new Error("Season not found");
      return res.json();
    },
    enabled: !!seasonId,
  });

  const { data: battles = [] } = useQuery({
    queryKey: ["kotc-battles-public", seasonId],
    queryFn: async () => {
      const token = await getToken().catch(() => null);
      const res = await authFetch(token, `${API}/kotc/seasons/${seasonId}/battles`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!seasonId,
  });

  const { data: teams = [] } = useQuery({
    queryKey: ["kotc-teams-public", seasonId],
    queryFn: async () => {
      const token = await getToken().catch(() => null);
      const res = await authFetch(token, `${API}/kotc/seasons/${seasonId}/teams`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!seasonId,
  });

  const sendJoinRequest = useMutation({
    mutationFn: async (teamId: number) => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/teams/${teamId}/join-request`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error ?? "Failed to send request");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Join request sent!", description: "The captain will be notified." });
      setRequestingTeamId(null);
      qc.invalidateQueries({ queryKey: ["kotc-teams-public", seasonId] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (seasonLoading) {
    return (
      <Layout>
        <div className="max-w-2xl mx-auto p-4 space-y-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      </Layout>
    );
  }

  if (!season) {
    return (
      <Layout>
        <div className="p-8 text-center">
          <Crown className="h-12 w-12 text-amber-400/40 mx-auto mb-3" />
          <p className="text-muted-foreground">Season not found.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate("/explore?type=kotc")}>
            Browse Programs
          </Button>
        </div>
      </Layout>
    );
  }

  const lifePacks: Array<{ label: string; lives: number; price: number }> = Array.isArray(season.lifePacks) ? season.lifePacks : [];
  const upcomingBattles = (battles as any[]).filter((b: any) => b.status === "scheduled" || b.status === "upcoming").slice(0, 5);
  const openTeams = (teams as any[]).filter((t: any) => t.status === "active" && (t.players?.filter((p: any) => p.status === "active").length ?? 0) < (season.teamSize ?? 4));

  return (
    <Layout>
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Season header */}
        <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/5 to-transparent p-6">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
              <Crown className="h-7 w-7 text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center text-xs font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 uppercase">
                  King of the Court
                </span>
                <span className={`inline-flex items-center text-xs font-bold px-2 py-0.5 rounded border ${
                  season.status === "active" ? "bg-green-500/20 text-green-400 border-green-500/30"
                  : season.status === "completed" ? "bg-muted text-muted-foreground border-border"
                  : "bg-blue-500/20 text-blue-400 border-blue-500/20"
                }`}>
                  {(season.status as string).charAt(0).toUpperCase() + (season.status as string).slice(1)}
                </span>
              </div>
              <h1 className="text-2xl font-bold text-foreground mt-1">{season.name}</h1>
              <p className="text-sm text-muted-foreground mt-0.5 capitalize">
                {(season.sport as string).toUpperCase()} · {bracketLabel(season.genderBracket, season.ageBracket)}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 mt-5">
            <div className="rounded-xl bg-white/5 border border-white/10 p-3 text-center">
              <Users className="h-4 w-4 text-amber-400 mx-auto mb-1" />
              <p className="text-lg font-bold text-foreground">{season.teamSize}</p>
              <p className="text-xs text-muted-foreground">per team</p>
            </div>
            <div className="rounded-xl bg-white/5 border border-white/10 p-3 text-center">
              <Heart className="h-4 w-4 text-red-400 mx-auto mb-1" />
              <p className="text-lg font-bold text-foreground">{season.livesRequired}</p>
              <p className="text-xs text-muted-foreground">lives to play</p>
            </div>
            <div className="rounded-xl bg-white/5 border border-white/10 p-3 text-center">
              <Swords className="h-4 w-4 text-amber-400 mx-auto mb-1" />
              <p className="text-lg font-bold text-foreground">{season.winTarget}</p>
              <p className="text-xs text-muted-foreground">points to win</p>
            </div>
          </div>

          {season.notes && (
            <p className="mt-4 text-sm text-muted-foreground border-t border-white/10 pt-4 leading-relaxed">{season.notes}</p>
          )}
        </div>

        {/* CTAs */}
        <div className="flex gap-3">
          <Button
            className="flex-1 bg-amber-500 hover:bg-amber-600 text-black font-bold gap-2"
            onClick={() => isSignedIn ? navigate(`/kotc/my-teams`) : navigate("/sign-in")}
          >
            <Plus className="h-4 w-4" />
            Create a Team
          </Button>
        </div>

        {/* Life packs */}
        {lifePacks.length > 0 && (
          <div>
            <h2 className="text-base font-bold text-foreground mb-3 flex items-center gap-2">
              <Flame className="h-4 w-4 text-amber-400" /> Life Packs
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {lifePacks.map((pack, i) => (
                <div key={i} className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex items-center justify-between">
                  <div>
                    <p className="font-bold text-foreground">{pack.label}</p>
                    <p className="text-sm text-muted-foreground flex items-center gap-1">
                      <Heart className="h-3 w-3 text-red-400" /> {pack.lives} lives
                    </p>
                  </div>
                  <span className="text-lg font-black text-amber-400">${pack.price}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">Purchase life packs from your team page after joining.</p>
          </div>
        )}

        {/* Rules summary */}
        <div>
          <h2 className="text-base font-bold text-foreground mb-3 flex items-center gap-2">
            <Shield className="h-4 w-4 text-amber-400" /> How It Works
          </h2>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3 text-sm text-muted-foreground">
            <p><span className="text-foreground font-semibold">Team Size:</span> {season.teamSize} players per team</p>
            <p><span className="text-foreground font-semibold">Win Condition:</span> {season.winCondition === "points" ? `First to ${season.winTarget} points` : `${season.timeLimitMinutes}-minute time limit`}</p>
            <p><span className="text-foreground font-semibold">Lives System:</span> Each team needs {season.livesRequired} lives to register for a battle. Winning preserves lives; losing costs one. When you run out, purchase more to keep competing.</p>
            <p><span className="text-foreground font-semibold">Court Rotation:</span> The winning team stays on the court and challenges the next team in the queue.</p>
            {season.gracePeriodSeconds > 0 && (
              <p><span className="text-foreground font-semibold">Grace Period:</span> {season.gracePeriodSeconds}s grace period for late arrivals at the start of a battle.</p>
            )}
          </div>
        </div>

        {/* Upcoming battles */}
        {upcomingBattles.length > 0 && (
          <div>
            <h2 className="text-base font-bold text-foreground mb-3 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-amber-400" /> Upcoming Battles
            </h2>
            <div className="space-y-2">
              {upcomingBattles.map((b: any) => (
                <div key={b.id} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-sm text-foreground">
                      {format(new Date(b.scheduledAt), "EEE, MMM d · h:mm a")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {b.courtCount} court{b.courtCount > 1 ? "s" : ""} · {b.durationMinutes} min
                    </p>
                  </div>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/20 capitalize">
                    {b.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Open teams */}
        <div>
          <h2 className="text-base font-bold text-foreground mb-3 flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-400" /> Teams Accepting Players
          </h2>
          {openTeams.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground text-sm">
                No teams are currently accepting players. Be the first to create one!
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {openTeams.map((team: any) => {
                const color = String(team.color ?? "#888");
                const activePlayers = (team.players ?? []).filter((p: any) => p.status === "active").length;
                const spotsLeft = (season.teamSize ?? 4) - activePlayers;
                return (
                  <div key={team.id} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-full border-2 flex-shrink-0"
                      style={{ backgroundColor: color + "40", borderColor: color + "80" }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm text-foreground truncate">{team.name}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Users className="h-3 w-3" /> {activePlayers}/{season.teamSize} players · {spotsLeft} spot{spotsLeft !== 1 ? "s" : ""} left
                      </p>
                    </div>
                    {isSignedIn ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 text-xs flex-shrink-0 border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                        disabled={requestingTeamId === team.id && sendJoinRequest.isPending}
                        onClick={() => { setRequestingTeamId(team.id); sendJoinRequest.mutate(team.id); }}
                      >
                        <UserPlus className="h-3 w-3" />
                        {requestingTeamId === team.id && sendJoinRequest.isPending ? "Sending…" : "Request to Join"}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 text-xs flex-shrink-0"
                        onClick={() => navigate("/sign-in")}
                      >
                        Sign in to Join
                        <ChevronRight className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
