import React, { useEffect, useState } from "react";
import { useRoute, Link } from "wouter";
import { useAuth } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Crown, Swords, Clock, Heart, ChevronLeft, Radio,
  AlertTriangle, Trophy, Users,
} from "lucide-react";
import { formatDistanceToNow, differenceInSeconds } from "date-fns";

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

const TEAM_COLORS: Record<string, string> = {
  red: "#ef4444",
  blue: "#3b82f6",
  green: "#22c55e",
  yellow: "#eab308",
  purple: "#a855f7",
  orange: "#f97316",
  pink: "#ec4899",
  cyan: "#06b6d4",
  teal: "#14b8a6",
  indigo: "#6366f1",
  amber: "#f59e0b",
  lime: "#84cc16",
};

function resolveColor(color: string | null | undefined): string {
  if (!color) return "#6b7280";
  return TEAM_COLORS[color.toLowerCase()] ?? color;
}

function TeamDot({ color }: { color: string | null | undefined }) {
  return (
    <span
      className="inline-block w-3 h-3 rounded-full flex-shrink-0"
      style={{ backgroundColor: resolveColor(color) }}
    />
  );
}

function LiveClock({ startedAt }: { startedAt: string | null | undefined }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!startedAt) return;
    const tick = () => setElapsed(differenceInSeconds(new Date(), new Date(startedAt)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  const str = h > 0
    ? `${h}h ${String(m).padStart(2, "0")}m`
    : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;

  return <span className="font-mono tabular-nums">{str}</span>;
}

function GraceCountdown({ expiresAt }: { expiresAt: string | null | undefined }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => setSecs(Math.max(0, differenceInSeconds(new Date(expiresAt), new Date())));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  if (!expiresAt || secs <= 0) return null;
  return (
    <span className="text-xs font-mono text-amber-500 ml-1">
      ⏰ {secs}s grace
    </span>
  );
}

interface QueueEntry {
  id: number;
  teamId: number;
  courtNumber: number;
  position: number;
  status: string;
  graceExpiresAt: string | null;
  teamName: string | null;
  teamColor: string | null;
  livesBalance: number | null;
}

interface ActiveCard {
  id: number;
  courtNumber: number;
  team1Id: number;
  team2Id: number;
  scannedAt: string;
  status: string;
}

interface LiveState {
  battle: {
    id: number;
    seasonId: number;
    scheduledAt: string;
    courtCount: number;
    durationMinutes: number;
    status: string;
    startedAt: string | null;
    pausedAt: string | null;
    pausedDurationSeconds: number;
    notes: string | null;
  };
  queues: QueueEntry[];
  activeCards: ActiveCard[];
}

function CourtCard({
  courtNumber,
  entries,
  activeCard,
  myTeamId,
}: {
  courtNumber: number;
  entries: QueueEntry[];
  activeCard: ActiveCard | undefined;
  myTeamId: number | null;
}) {
  const onCourt = entries.filter((e) => e.status === "on_court");
  const queued = entries.filter((e) => e.status === "queued");
  const graceTeams = entries.filter((e) => e.status === "grace");
  const onDeck = queued[0];
  const remaining = queued.slice(1);
  const allActive = [...onCourt, ...graceTeams, ...queued];
  const myPos = allActive.findIndex((e) => e.teamId === myTeamId);

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* Court header */}
      <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <Trophy className="h-4 w-4 text-amber-500" />
          </div>
          <span className="font-semibold text-foreground">Court {courtNumber}</span>
        </div>
        <div className="flex items-center gap-2">
          {myPos >= 0 && (
            <Badge variant="outline" className="text-xs border-blue-500/40 text-blue-600 bg-blue-500/10">
              You're #{myPos + 1}
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">{allActive.length} teams</span>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* On Court */}
        {onCourt.length > 0 ? (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Swords className="h-3.5 w-3.5 text-red-500" />
              <span className="text-xs font-semibold text-red-500 uppercase tracking-wide">On Court</span>
              {activeCard && (
                <span className="text-xs text-muted-foreground ml-auto">
                  {formatDistanceToNow(new Date(activeCard.scannedAt), { addSuffix: false })} ago
                </span>
              )}
            </div>
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 space-y-2">
              {onCourt.map((team, i) => (
                <React.Fragment key={team.id}>
                  {i === 1 && (
                    <div className="text-center text-xs text-muted-foreground font-medium">vs</div>
                  )}
                  <TeamRow team={team} highlight={team.teamId === myTeamId} />
                </React.Fragment>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            <Swords className="h-5 w-5 mx-auto mb-1 opacity-40" />
            No game in progress
          </div>
        )}

        {/* Grace teams */}
        {graceTeams.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-xs font-semibold text-amber-500 uppercase tracking-wide">Grace Period</span>
            </div>
            <div className="space-y-1.5">
              {graceTeams.map((team) => (
                <div key={team.id} className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                  <TeamRow team={team} highlight={team.teamId === myTeamId} />
                  <GraceCountdown expiresAt={team.graceExpiresAt} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* On Deck */}
        {onDeck && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Clock className="h-3.5 w-3.5 text-blue-500" />
              <span className="text-xs font-semibold text-blue-500 uppercase tracking-wide">On Deck</span>
            </div>
            <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 px-3 py-2.5">
              <TeamRow team={onDeck} highlight={onDeck.teamId === myTeamId} />
            </div>
          </div>
        )}

        {/* Queue */}
        {remaining.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Queue</span>
            </div>
            <div className="space-y-1">
              {remaining.map((team, i) => (
                <div
                  key={team.id}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors ${
                    team.teamId === myTeamId ? "bg-blue-500/10 border border-blue-500/20" : "hover:bg-muted/50"
                  }`}
                >
                  <span className="text-xs text-muted-foreground w-5 text-right flex-shrink-0">
                    {i + 2}.
                  </span>
                  <TeamDot color={team.teamColor} />
                  <span className={`text-sm flex-1 truncate ${team.teamId === myTeamId ? "font-semibold text-foreground" : "text-foreground/80"}`}>
                    {team.teamName ?? "—"}
                  </span>
                  <LivesBadge lives={team.livesBalance} />
                </div>
              ))}
            </div>
          </div>
        )}

        {entries.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-4">
            No teams registered for this court.
          </div>
        )}
      </div>
    </div>
  );
}

function TeamRow({ team, highlight }: { team: QueueEntry; highlight: boolean }) {
  return (
    <div className={`flex items-center gap-2.5 ${highlight ? "font-semibold" : ""}`}>
      <TeamDot color={team.teamColor} />
      <span className={`text-sm flex-1 truncate ${highlight ? "text-foreground" : "text-foreground/90"}`}>
        {team.teamName ?? "—"}
        {highlight && <span className="ml-1 text-xs text-blue-500">(You)</span>}
      </span>
      <LivesBadge lives={team.livesBalance} />
    </div>
  );
}

function LivesBadge({ lives }: { lives: number | null | undefined }) {
  if (lives === null || lives === undefined) return null;
  const color = lives <= 1 ? "text-red-500" : lives <= 2 ? "text-amber-500" : "text-emerald-500";
  return (
    <div className={`flex items-center gap-0.5 text-xs font-medium ${color}`}>
      <Heart className="h-3 w-3" />
      <span>{lives}</span>
    </div>
  );
}

export default function KotcBattleLivePage() {
  const [, params] = useRoute("/kotc/battles/:battleId/live");
  const { getToken } = useAuth();
  const battleId = Number(params?.battleId);

  // Fetch my teams so we can highlight "You" in the queue
  const { data: myTeams } = useQuery<{ id: number; seasonId: number }[]>({
    queryKey: ["kotc-my-teams"],
    queryFn: async () => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/my-teams`);
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 60_000,
  });

  const { data, isLoading, error, dataUpdatedAt } = useQuery<LiveState>({
    queryKey: ["kotc-live-state", battleId],
    queryFn: async () => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/battles/${battleId}/live-state`);
      if (!res.ok) throw new Error("Failed to load battle");
      return res.json();
    },
    refetchInterval: 10_000,
    enabled: !!battleId,
  });

  const battle = data?.battle;
  const queues = data?.queues ?? [];
  const activeCards = data?.activeCards ?? [];

  // Find this user's team IDs for this battle's season
  const myTeamIds = new Set(
    (myTeams ?? [])
      .filter((t) => t.seasonId === battle?.seasonId)
      .map((t) => t.id)
  );
  // Find the first team in the queue that belongs to us
  const myQueueTeamId = queues.find((q) => myTeamIds.has(q.teamId))?.teamId ?? null;

  const courts = Array.from({ length: battle?.courtCount ?? 0 }, (_, i) => i + 1);

  const statusBadge =
    battle?.status === "active"
      ? <Badge className="bg-green-500/10 text-green-600 border-green-500/30 gap-1"><Radio className="h-3 w-3 animate-pulse" />Live</Badge>
      : battle?.status === "paused"
      ? <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/30">Paused</Badge>
      : <Badge variant="outline" className="text-muted-foreground">Not Started</Badge>;

  return (
    <Layout>
      <div className="max-w-4xl mx-auto px-4 pb-12 pt-6 space-y-6">
        {/* Header */}
        <div className="flex items-start gap-3">
          <Link href="/kotc/my-teams">
            <Button variant="ghost" size="icon" className="mt-0.5 flex-shrink-0">
              <ChevronLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
                <Crown className="h-5 w-5 text-amber-500" />
              </div>
              <h1 className="text-xl font-bold text-foreground">Live Battle</h1>
              {statusBadge}
            </div>
            {battle && (
              <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground flex-wrap">
                {battle.startedAt && battle.status === "active" && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    <LiveClock startedAt={battle.startedAt} />
                    {" / "}
                    {battle.durationMinutes}m
                  </span>
                )}
                <span>{courts.length} court{courts.length !== 1 ? "s" : ""}</span>
                {dataUpdatedAt > 0 && (
                  <span className="text-xs opacity-60">
                    Updated {formatDistanceToNow(dataUpdatedAt, { addSuffix: true })}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="grid gap-4 sm:grid-cols-2">
            {[1, 2].map((n) => (
              <div key={n} className="rounded-2xl border border-border overflow-hidden">
                <div className="px-4 py-3 border-b border-border bg-muted/30">
                  <Skeleton className="h-5 w-24" />
                </div>
                <div className="p-4 space-y-3">
                  <Skeleton className="h-16 w-full rounded-xl" />
                  <Skeleton className="h-10 w-full rounded-xl" />
                  <Skeleton className="h-20 w-full rounded-xl" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-6 text-center">
            <AlertTriangle className="h-8 w-8 text-red-500 mx-auto mb-2" />
            <p className="text-sm text-red-600 font-medium">Failed to load battle state</p>
            <p className="text-xs text-muted-foreground mt-1">Check back in a moment — auto-refreshing every 10s</p>
          </div>
        )}

        {/* Not started */}
        {battle && battle.status === "scheduled" && (
          <div className="rounded-xl border border-dashed border-border p-8 text-center space-y-2">
            <Crown className="h-10 w-10 text-amber-400 mx-auto opacity-50" />
            <p className="text-foreground font-medium">Battle hasn't started yet</p>
            <p className="text-sm text-muted-foreground">This page will auto-update when the battle goes live.</p>
          </div>
        )}

        {/* Courts grid */}
        {battle && battle.status !== "scheduled" && courts.length > 0 && (
          <div className={`grid gap-4 ${courts.length >= 2 ? "sm:grid-cols-2" : ""}`}>
            {courts.map((courtNum) => (
              <CourtCard
                key={courtNum}
                courtNumber={courtNum}
                entries={queues.filter((q) => q.courtNumber === courtNum)}
                activeCard={activeCards.find((c) => c.courtNumber === courtNum)}
                myTeamId={myQueueTeamId}
              />
            ))}
          </div>
        )}

        {/* Legend */}
        <div className="rounded-xl border border-border bg-muted/20 p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Legend</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Swords className="h-3.5 w-3.5 text-red-500" />
              <span>On Court — playing now</span>
            </div>
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              <span>Grace — check in fast</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-blue-500" />
              <span>On Deck — you're next</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Heart className="h-3.5 w-3.5 text-emerald-500" />
              <span>Lives remaining</span>
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Auto-refreshes every 10 seconds
        </p>
      </div>
    </Layout>
  );
}
