import { API_BASE } from "@/lib/api-base";
import React, { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { format } from "date-fns";
import { Minus, Plus, Flag, Clock, RefreshCw, Trash2, ArrowLeft } from "lucide-react";


interface GameEventsResponse {
  fixtureId: number;
  homeScore: number;
  awayScore: number;
  homeTeam: { id: number; name: string } | null;
  awayTeam: { id: number; name: string } | null;
  homeFouls: number;
  awayFouls: number;
  events: Array<{
    id: number;
    eventType: string;
    teamId: number | null;
    playerId: number | null;
    value: number;
    occurredAt: string;
    recordedByUserId: number;
  }>;
}

const EVENT_TYPE_LABEL: Record<string, string> = {
  score: "⚽ Goal",
  foul: "🟨 Foul",
  timeout: "⏱ Timeout",
};

export default function GamePanelPage() {
  const { id } = useParams<{ id: string }>();
  const fixtureId = parseInt(id ?? "0");
  const [, setLocation] = useLocation();
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { getToken } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const isAllowed = !profileLoading && (
    profile?.role === "admin" ||
    profile?.role === "staff" ||
    (profile?.roles ?? []).some((r: string) => ["admin", "staff", "scorekeeper", "ref", "coach"].includes(r))
  );

  const { data: gameData, isLoading } = useQuery<GameEventsResponse>({
    queryKey: ["game-events", fixtureId],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/fixtures/${fixtureId}/events`);
      if (!res.ok) throw new Error("Failed to load game events");
      return res.json();
    },
    enabled: !isNaN(fixtureId) && fixtureId > 0,
    refetchInterval: 30_000,
  });

  async function postEvent(eventType: string, teamId: number | null, value = 1) {
    const token = await getToken();
    const res = await fetch(`${API_BASE}/fixtures/${fixtureId}/events`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ eventType, teamId, value }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? "Failed to record event");
    }
    return res.json();
  }

  const recordEvent = useMutation({
    mutationFn: ({ eventType, teamId, value }: { eventType: string; teamId: number | null; value?: number }) =>
      postEvent(eventType, teamId, value),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["game-events", fixtureId] }),
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const deleteEvent = useMutation({
    mutationFn: async (eventId: number) => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/fixtures/${fixtureId}/events/${eventId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to delete event");
      return res.json();
    },
    onSuccess: () => {
      setDeletingId(null);
      qc.invalidateQueries({ queryKey: ["game-events", fixtureId] });
      toast({ title: "Event removed" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  if (profileLoading) {
    return <Layout><div className="p-12"><Skeleton className="h-64" /></div></Layout>;
  }

  if (!isAllowed) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-12 text-center">
          <p className="text-muted-foreground">You must be assigned to this fixture as a scorekeeper, ref, coach, or admin to access this panel.</p>
          <Button className="mt-4" onClick={() => setLocation("/dashboard")}>Back to Dashboard</Button>
        </div>
      </Layout>
    );
  }

  const homeTeam = gameData?.homeTeam;
  const awayTeam = gameData?.awayTeam;
  const isAdmin = profile?.role === "admin" || profile?.role === "staff";

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <button
          onClick={() => setLocation("/dashboard")}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Dashboard
        </button>

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-primary uppercase tracking-tight">Live Game Panel</h1>
            <p className="text-sm text-muted-foreground">Fixture #{fixtureId}</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => qc.invalidateQueries({ queryKey: ["game-events", fixtureId] })}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
          </Button>
        </div>

        {isLoading ? (
          <Skeleton className="h-48 w-full mb-6" />
        ) : (
          <>
            {/* Scoreboard */}
            <Card className="mb-6 border-2 border-primary/20">
              <CardContent className="pt-6 pb-6">
                <div className="grid grid-cols-3 items-center text-center gap-4">
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase mb-2 truncate">
                      {homeTeam?.name ?? "Home"}
                    </p>
                    <p className="text-6xl font-black text-primary">{gameData?.homeScore ?? 0}</p>
                    <p className="text-xs text-muted-foreground mt-2">
                      {gameData?.homeFouls ?? 0} foul{(gameData?.homeFouls ?? 0) !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className="text-muted-foreground font-bold text-xl">VS</div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase mb-2 truncate">
                      {awayTeam?.name ?? "Away"}
                    </p>
                    <p className="text-6xl font-black text-primary">{gameData?.awayScore ?? 0}</p>
                    <p className="text-xs text-muted-foreground mt-2">
                      {gameData?.awayFouls ?? 0} foul{(gameData?.awayFouls ?? 0) !== 1 ? "s" : ""}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Action buttons */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              {/* Home team */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase text-center">
                  {homeTeam?.name ?? "Home"}
                </p>
                <Button
                  className="w-full gap-2"
                  onClick={() => recordEvent.mutate({ eventType: "score", teamId: homeTeam?.id ?? null })}
                  disabled={recordEvent.isPending}
                >
                  <Plus className="h-4 w-4" /> Goal
                </Button>
                <Button
                  variant="outline"
                  className="w-full gap-2 text-amber-600 border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                  onClick={() => recordEvent.mutate({ eventType: "foul", teamId: homeTeam?.id ?? null })}
                  disabled={recordEvent.isPending}
                >
                  <Flag className="h-4 w-4" /> Foul
                </Button>
              </div>

              {/* Away team */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase text-center">
                  {awayTeam?.name ?? "Away"}
                </p>
                <Button
                  className="w-full gap-2"
                  onClick={() => recordEvent.mutate({ eventType: "score", teamId: awayTeam?.id ?? null })}
                  disabled={recordEvent.isPending}
                >
                  <Plus className="h-4 w-4" /> Goal
                </Button>
                <Button
                  variant="outline"
                  className="w-full gap-2 text-amber-600 border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                  onClick={() => recordEvent.mutate({ eventType: "foul", teamId: awayTeam?.id ?? null })}
                  disabled={recordEvent.isPending}
                >
                  <Flag className="h-4 w-4" /> Foul
                </Button>
              </div>
            </div>

            {/* Timeout button */}
            <Button
              variant="outline"
              className="w-full mb-8 gap-2"
              onClick={() => recordEvent.mutate({ eventType: "timeout", teamId: null })}
              disabled={recordEvent.isPending}
            >
              <Clock className="h-4 w-4" /> Record Timeout
            </Button>

            {/* Event log */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Event Log</CardTitle>
              </CardHeader>
              <CardContent>
                {gameData?.events.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No events recorded yet.</p>
                ) : (
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {[...(gameData?.events ?? [])].reverse().map((ev) => {
                      const isHome = ev.teamId === homeTeam?.id;
                      const teamLabel = ev.teamId
                        ? isHome ? (homeTeam?.name ?? "Home") : (awayTeam?.name ?? "Away")
                        : "—";
                      return (
                        <div key={ev.id} className="flex items-center justify-between gap-3 py-1.5 border-b last:border-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <Badge variant="outline" className="text-xs shrink-0">
                              {EVENT_TYPE_LABEL[ev.eventType] ?? ev.eventType}
                            </Badge>
                            <span className="text-sm text-muted-foreground truncate">{teamLabel}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-xs text-muted-foreground">
                              {format(new Date(ev.occurredAt), "h:mm a")}
                            </span>
                            {isAdmin && (
                              <button
                                onClick={() => {
                                  setDeletingId(ev.id);
                                  deleteEvent.mutate(ev.id);
                                }}
                                disabled={deleteEvent.isPending && deletingId === ev.id}
                                className="text-muted-foreground hover:text-destructive transition-colors"
                                title="Remove event"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </Layout>
  );
}
