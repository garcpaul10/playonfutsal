import React, { useState, useRef } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { useGetLeague, getGetLeagueQueryKey } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar, Users, Trophy, ChevronLeft, DollarSign, Clock, CheckCircle2, AlertCircle, Shield, ArrowRight, ClipboardList, Star, TrendingUp, Medal, Loader2, Copy, Link2, RefreshCw, UserCheck, XCircle, MapPin } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { Show, useAuth } from "@clerk/react";
import { SectionEntry } from "@/components/brand-ui";
import { useIsRegistered } from "@/hooks/useIsRegistered";
import { LockedTab } from "@/components/locked-tab";
import { useWaiverGate } from "@/components/waiver-modal";

const API = "/api";

const ACTIVE_BUFFER_MS = 30 * 60 * 1000;
function computeIsEventActive(event: any): boolean {
  if (!event) return false;
  if (event.activeOverride === "active") return true;
  if (event.activeOverride === "closed") return false;
  if (!event.startsAt) return false;
  const start = new Date(event.startsAt).getTime();
  let end: number | null = null;
  if (event.endsAt) end = new Date(event.endsAt).getTime();
  else if (event.durationMinutes) end = start + Number(event.durationMinutes) * 60 * 1000;
  if (end === null) return false;
  const now = Date.now();
  return now >= start - ACTIVE_BUFFER_MS && now <= end + ACTIVE_BUFFER_MS;
}

function LiveScoreBadge({ fixtureId }: { fixtureId: number }) {
  const { data } = useQuery({
    queryKey: ["live-score", fixtureId],
    queryFn: async () => {
      const r = await fetch(`${API}/fixtures/${fixtureId}/events`);
      if (!r.ok) return null;
      return r.json();
    },
    refetchInterval: 20_000,
    staleTime: 10_000,
  });

  if (!data) return <span className="text-white/30 text-sm font-medium">vs</span>;

  return (
    <span className="font-bold text-lg text-[#ef4444]">
      {data.homeScore} – {data.awayScore}
      <span className="ml-1 text-xs font-normal text-amber-400 animate-pulse">LIVE</span>
    </span>
  );
}

function useAuthHeaders() {
  const { getToken } = useAuth();
  return async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  };
}

function FixtureRoundGroup({ fixtures }: { fixtures: any[] }) {
  const grouped: Record<number, any[]> = {};
  fixtures?.forEach((f: any) => {
    const r = f.round ?? 0;
    if (!grouped[r]) grouped[r] = [];
    grouped[r].push(f);
  });
  return (
    <div className="space-y-6">
      {Object.keys(grouped).sort((a, b) => Number(a) - Number(b)).map((round) => (
        <div key={round}>
          <h3 className="text-xs font-bold uppercase tracking-widest text-white/40 mb-3">
            {Number(round) > 0 ? `Round ${round}` : "Playoffs"}
          </h3>
          <div className="space-y-2">
            {grouped[Number(round)].map((f: any) => (
              <div key={f.id} className="bg-white/5 border border-white/10 rounded-xl px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-1">
                    <span className="font-semibold text-sm w-32 text-right truncate text-white">{f.homeTeam?.name ?? "TBD"}</span>
                    <div className="flex items-center gap-1 mx-2">
                      {f.status === "completed" ? (
                        <span className="font-bold text-lg text-white">{f.homeScore} – {f.awayScore}</span>
                      ) : f.status === "in_progress" ? (
                        <LiveScoreBadge fixtureId={f.id} />
                      ) : (
                        <span className="text-white/30 text-sm font-medium">vs</span>
                      )}
                    </div>
                    <span className="font-semibold text-sm w-32 truncate text-white">{f.awayTeam?.name ?? "TBD"}</span>
                  </div>
                  <div className="flex items-center gap-3 ml-4">
                    {f.scheduledAt && (
                      <span className="text-xs text-white/30 whitespace-nowrap">
                        {format(new Date(f.scheduledAt), "MMM d · h:mm a")}
                      </span>
                    )}
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                      f.status === "completed" ? "bg-white/10 text-white/50 border-white/10" :
                      f.status === "cancelled" ? "bg-red-500/20 text-red-400 border-red-500/20" :
                      "bg-white/5 text-white/30 border-white/10"
                    }`}>{f.status}</span>
                    {f.phase === "playoff" && <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/20">Playoff</span>}
                    {f.status === "completed" && (
                      <Link href={`/fixtures/${f.id}/game-card`}>
                        <button className="text-white/30 hover:text-white transition-colors" title="View game card">
                          <ClipboardList className="h-4 w-4" />
                        </button>
                      </Link>
                    )}
                  </div>
                </div>
                {f.referee && (
                  <p className="text-xs text-white/25 mt-1 text-right">Ref: {f.referee.firstName} {f.referee.lastName}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ScheduleTab({ leagueId }: { leagueId: number }) {
  const { data: fixtures, isLoading } = useQuery({
    queryKey: ["league-fixtures-public", leagueId],
    queryFn: async () => {
      const r = await fetch(`${API}/leagues/${leagueId}/fixtures`);
      return r.json();
    },
  });
  const { data: divisions } = useQuery({
    queryKey: ["league-divisions-public", leagueId],
    queryFn: async () => {
      const r = await fetch(`${API}/leagues/${leagueId}/divisions`);
      return r.json();
    },
  });

  if (isLoading) return <div className="space-y-3 py-4">{[1,2,3].map(i => <Skeleton key={i} className="h-14 bg-white/10" />)}</div>;

  const multiDiv = Array.isArray(divisions) && divisions.length > 1;

  if (!fixtures?.length) {
    return (
      <div className="text-center py-12 text-white/30">
        <Calendar className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p>No schedule published yet. Check back soon.</p>
      </div>
    );
  }

  if (multiDiv) {
    return (
      <div className="space-y-8 py-4">
        {divisions.map((d: any) => {
          const divFixtures = fixtures.filter((f: any) => f.divisionId === d.id);
          return (
            <div key={d.id}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-bold uppercase tracking-widest text-white/50">{d.name}</span>
                {d.format && <span className="text-xs text-white/30 border border-white/10 px-1.5 py-0.5 rounded">{d.format}</span>}
              </div>
              {divFixtures.length ? (
                <FixtureRoundGroup fixtures={divFixtures} />
              ) : (
                <p className="text-sm text-white/30 pl-2">No fixtures scheduled for this division yet.</p>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="py-4">
      <FixtureRoundGroup fixtures={fixtures} />
    </div>
  );
}

function StandingsTable({ rows }: { rows: any[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-white/30 border-b border-white/10">
            <th className="text-left pb-3 pl-2 font-medium">#</th>
            <th className="text-left pb-3 font-medium">Team</th>
            <th className="text-center pb-3 font-medium">GP</th>
            <th className="text-center pb-3 font-medium">W</th>
            <th className="text-center pb-3 font-medium">D</th>
            <th className="text-center pb-3 font-medium">L</th>
            <th className="text-center pb-3 font-medium hidden sm:table-cell">GF</th>
            <th className="text-center pb-3 font-medium hidden sm:table-cell">GA</th>
            <th className="text-center pb-3 font-medium hidden sm:table-cell">GD</th>
            <th className="text-center pb-3 font-bold text-white/60">Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s: any, i: number) => (
            <tr key={s.id} className={`border-b border-white/5 last:border-0 ${i === 0 ? "bg-[#dc2626]/5" : ""}`}>
              <td className="py-3 pl-2 text-white/40">
                {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : s.rank}
              </td>
              <td className="py-3 font-semibold text-white">{s.team?.name ?? `Team #${s.teamId}`}</td>
              <td className="py-3 text-center text-white/40">{s.gamesPlayed}</td>
              <td className="py-3 text-center font-medium text-emerald-400">{s.wins}</td>
              <td className="py-3 text-center font-medium text-amber-400">{s.draws}</td>
              <td className="py-3 text-center font-medium text-red-400">{s.losses}</td>
              <td className="py-3 text-center text-white/40 hidden sm:table-cell">{s.goalsFor}</td>
              <td className="py-3 text-center text-white/40 hidden sm:table-cell">{s.goalsAgainst}</td>
              <td className="py-3 text-center text-white/40 hidden sm:table-cell">
                {s.goalDifference > 0 ? `+${s.goalDifference}` : s.goalDifference}
              </td>
              <td className="py-3 text-center font-bold text-lg text-white">{s.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StandingsTab({ leagueId }: { leagueId: number }) {
  const { data: standings, isLoading } = useQuery({
    queryKey: ["league-standings-public", leagueId],
    queryFn: async () => {
      const r = await fetch(`${API}/leagues/${leagueId}/standings`);
      return r.json();
    },
  });

  if (isLoading) return <Skeleton className="h-48 mt-4 bg-white/10" />;

  const isGrouped = standings && !Array.isArray(standings) && standings.type === "grouped";
  const flatRows: any[] = Array.isArray(standings) ? standings : [];

  if (!isGrouped && !flatRows.length) {
    return (
      <div className="text-center py-12 text-white/30">
        <Trophy className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p>Standings will appear once games are played.</p>
      </div>
    );
  }

  if (isGrouped) {
    return (
      <div className="space-y-8 py-4">
        {standings.divisions.map((d: any) => (
          <div key={d.division.id}>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-bold uppercase tracking-widest text-white/50">{d.division.name}</span>
              {d.division.format && <span className="text-xs text-white/30 border border-white/10 px-1.5 py-0.5 rounded">{d.division.format}</span>}
            </div>
            {d.standings.length ? (
              <StandingsTable rows={d.standings} />
            ) : (
              <p className="text-sm text-white/30 pl-2">Standings will appear once games are played.</p>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="py-4">
      <StandingsTable rows={flatRows} />
    </div>
  );
}

function TeamsTab({ leagueId }: { leagueId: number }) {
  const { data: teams, isLoading } = useQuery({
    queryKey: ["league-teams-public", leagueId],
    queryFn: async () => {
      const r = await fetch(`${API}/leagues/${leagueId}/teams`);
      return r.json();
    },
  });

  if (isLoading) return <div className="space-y-3 py-4">{[1,2,3].map(i => <Skeleton key={i} className="h-20 bg-white/10" />)}</div>;

  if (!teams?.length) {
    return (
      <div className="text-center py-12 text-white/30">
        <Users className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p>No teams registered yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 py-4">
      {teams.map((t: any) => (
        <div key={t.id} className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-[#dc2626]/10 border border-[#dc2626]/20 flex items-center justify-center">
              <Shield className="h-5 w-5 text-[#ef4444]" />
            </div>
            <div>
              <p className="font-semibold text-white">{t.name}</p>
              <p className="text-xs text-white/40">{t.members?.length ?? 0} players</p>
            </div>
          </div>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border capitalize ${
            t.status === "active" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/20" :
            "bg-white/5 text-white/40 border-white/10"
          }`}>{t.status}</span>
        </div>
      ))}
    </div>
  );
}

type LeaderboardMetric = "goals" | "assists" | "games" | "streak";

const METRIC_CONFIG: Record<LeaderboardMetric, { label: string; icon: React.ReactNode; valueKey: string; color: string }> = {
  goals: { label: "Goals", icon: <Trophy className="h-4 w-4" />, valueKey: "goalsScored", color: "#ef4444" },
  assists: { label: "Assists", icon: <Star className="h-4 w-4" />, valueKey: "assists", color: "#60a5fa" },
  games: { label: "Games", icon: <Medal className="h-4 w-4" />, valueKey: "gamesPlayed", color: "#4ade80" },
  streak: { label: "Best Streak", icon: <TrendingUp className="h-4 w-4" />, valueKey: "bestAttendanceStreak", color: "#fbbf24" },
};

function LeaderboardTab({ leagueId }: { leagueId: number }) {
  const [metric, setMetric] = useState<LeaderboardMetric>("goals");
  const { data, isLoading, error } = useQuery({
    queryKey: ["event-leaderboard", "league", leagueId, metric],
    queryFn: async () => {
      const r = await fetch(`${API}/player-stats/leaderboard?entityType=league&entityId=${leagueId}&metric=${metric}&limit=10`);
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? "Failed to load leaderboard");
      return json as any[];
    },
  });

  const cfg = METRIC_CONFIG[metric];

  return (
    <div className="py-4 space-y-4">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(METRIC_CONFIG) as LeaderboardMetric[]).map((m) => (
          <button
            key={m}
            onClick={() => setMetric(m)}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
              metric === m
                ? "bg-[#dc2626] border-[#dc2626] text-white"
                : "bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white"
            }`}
          >
            {METRIC_CONFIG[m].icon}
            {METRIC_CONFIG[m].label}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
        <div className="bg-white/5 border-b border-white/10 px-4 py-3 flex items-center gap-2">
          <span style={{ color: cfg.color }}>{cfg.icon}</span>
          <span className="text-white text-sm font-bold">Top 10 by {cfg.label}</span>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-white/30" />
          </div>
        ) : error ? (
          <div className="text-center py-10">
            <p className="text-white/30 text-sm">{(error as Error).message}</p>
          </div>
        ) : !data?.length ? (
          <div className="text-center py-12">
            <Trophy className="h-10 w-10 text-white/10 mx-auto mb-3" />
            <p className="text-white/30 text-sm">No stats recorded yet.</p>
            <p className="text-white/20 text-xs mt-1">Stats appear after games are played and approved.</p>
          </div>
        ) : (
          <ol>
            {data.map((e: any, i: number) => (
              <li
                key={e.userId}
                className={`flex items-center gap-3 px-4 py-3 border-b border-white/5 last:border-0 ${e.rank <= 3 ? "bg-white/[0.02]" : ""}`}
              >
                <div className="w-8 shrink-0 flex items-center justify-center">
                  {e.rank === 1 ? <span className="text-xl">🥇</span> : e.rank === 2 ? <span className="text-xl">🥈</span> : e.rank === 3 ? <span className="text-xl">🥉</span> : <span className="text-white/30 font-black text-base">{e.rank}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-semibold truncate">{e.displayName}</p>
                  <p className="text-white/30 text-xs">{e.gamesPlayed} games · {e.goalsScored}G {e.assists}A</p>
                </div>
                <div
                  className="shrink-0 px-2.5 py-1 rounded-full text-sm font-black border"
                  style={{ background: `${cfg.color}15`, color: cfg.color, borderColor: `${cfg.color}25` }}
                >
                  {e[cfg.valueKey]}
                  <span className="text-xs font-normal ml-1 opacity-70">
                    {metric === "streak" ? "in a row" : cfg.label.toLowerCase()}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
      <p className="text-xs text-white/20">Stats are updated by PlayOn staff after each approved game card.</p>
    </div>
  );
}

const FUTSAL_POSITIONS = ["Goalkeeper", "Defender", "Midfielder", "Attacker", "Utility"];
const SKILL_LEVELS = [
  { value: "beginner", label: "Beginner", desc: "Just getting started" },
  { value: "intermediate", label: "Intermediate", desc: "Regular recreational player" },
  { value: "competitive", label: "Competitive", desc: "Experienced / tournament player" },
];
const JERSEY_COLORS = ["Red", "Blue", "Green", "Yellow", "White", "Black", "Orange", "Purple", "Navy", "Maroon"];
const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const TIME_PREFS = ["Mornings", "Afternoons", "Evenings", "Weekends only", "Flexible"];

const FA_MATCH_STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode; detail: string }> = {
  unmatched: { label: "Looking for a team…", color: "amber", icon: <Loader2 className="h-4 w-4 animate-spin" />, detail: "Our AI is searching for the best team fit for you." },
  team_reviewing: { label: "Team is reviewing your profile", color: "blue", icon: <UserCheck className="h-4 w-4" />, detail: "A team has been proposed — waiting for their captain to approve." },
  player_reviewing: { label: "Team approved! Your turn to respond", color: "emerald", icon: <CheckCircle2 className="h-4 w-4" />, detail: "The team captain approved your match. Do you want to join?" },
  matched: { label: "Matched!", color: "emerald", icon: <CheckCircle2 className="h-4 w-4" />, detail: "You've been added to a team." },
  declined: { label: "No match found", color: "red", icon: <XCircle className="h-4 w-4" />, detail: "We couldn't find a match. Contact the league admin." },
};

function FreeAgentMatchStatus({ leagueId, agentId, proposedTeam, matchStatus, matchReasoning, onRefresh }: {
  leagueId: number; agentId: number; proposedTeam?: string | null;
  matchStatus: string; matchReasoning?: string | null; onRefresh: () => void;
}) {
  const getHeaders = useAuthHeaders();
  const { toast } = useToast();
  const cfg = FA_MATCH_STATUS_CONFIG[matchStatus] ?? FA_MATCH_STATUS_CONFIG.unmatched;

  const respond = useMutation({
    mutationFn: async (decision: "accept" | "decline") => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/leagues/${leagueId}/free-agents/${agentId}/player-respond`, {
        method: "PATCH", headers,
        body: JSON.stringify({ decision }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Failed");
      return r.json();
    },
    onSuccess: (_data, decision) => {
      toast({ title: decision === "accept" ? "Welcome to the team! 🎉" : "Looking for another match…" });
      onRefresh();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const colorMap: Record<string, string> = {
    amber: "amber-400", blue: "blue-400", emerald: "emerald-400", red: "red-400",
  };
  const iconColorClass = `text-${colorMap[cfg.color] ?? "white/50"}`;
  const bgClass = `bg-${colorMap[cfg.color] ?? "white"}/10 border-${colorMap[cfg.color] ?? "white"}/20`;

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${bgClass}`}>
      <div className="flex items-center gap-2">
        <span className={iconColorClass}>{cfg.icon}</span>
        <p className={`font-semibold text-sm text-${colorMap[cfg.color] ?? "white/70"}`}>{cfg.label}</p>
      </div>
      <p className="text-sm text-white/50">{cfg.detail}</p>
      {proposedTeam && matchStatus !== "matched" && (
        <p className="text-sm text-white/70">Proposed team: <span className="font-semibold text-white">{proposedTeam}</span></p>
      )}
      {matchReasoning && (
        <p className="text-xs text-white/30 italic">AI reasoning: {matchReasoning}</p>
      )}
      {matchStatus === "player_reviewing" && (
        <div className="flex gap-2 pt-1">
          <Button size="sm" className="flex-1 bg-emerald-600 hover:bg-emerald-700 border-none" disabled={respond.isPending} onClick={() => respond.mutate("accept")}>
            {respond.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "✓ Join Team"}
          </Button>
          <Button size="sm" variant="outline" className="flex-1 border-white/20 text-white/70 hover:text-white" disabled={respond.isPending} onClick={() => respond.mutate("decline")}>
            Pass — find another
          </Button>
        </div>
      )}
      {matchStatus === "unmatched" && (
        <Button size="sm" variant="ghost" className="text-white/30 hover:text-white text-xs" onClick={onRefresh}>
          <RefreshCw className="h-3 w-3 mr-1" /> Refresh status
        </Button>
      )}
    </div>
  );
}

function InviteLinkPanel({ leagueId, teamId, teamName }: { leagueId: number; teamId: number; teamName: string }) {
  const getHeaders = useAuthHeaders();
  const { toast } = useToast();
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const generateInvite = async () => {
    setLoading(true);
    try {
      const headers = await getHeaders();
      const r = await fetch(`${API}/leagues/${leagueId}/teams/${teamId}/player-invite`, { method: "POST", headers });
      if (!r.ok) throw new Error((await r.json()).error ?? "Failed");
      const data = await r.json();
      setInviteUrl(data.inviteUrl);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const copy = () => {
    if (inviteUrl) {
      navigator.clipboard.writeText(inviteUrl);
      toast({ title: "Link copied!", description: "Share it with your players." });
    }
  };

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Link2 className="h-4 w-4 text-[#ef4444]" />
        <p className="font-semibold text-sm text-white">Invite Players to {teamName}</p>
      </div>
      <p className="text-xs text-white/40">Generate a shareable link that players can use to join your team roster.</p>
      {!inviteUrl ? (
        <Button size="sm" variant="outline" className="w-full border-white/20 text-white hover:bg-white/10" onClick={generateInvite} disabled={loading}>
          {loading ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : <Link2 className="h-3 w-3 mr-2" />}
          Generate Invite Link
        </Button>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 bg-black/30 border border-white/10 rounded-lg px-3 py-2">
            <span className="text-xs text-white/50 truncate flex-1">{inviteUrl}</span>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-white/40 hover:text-white shrink-0" onClick={copy}>
              <Copy className="h-3 w-3" />
            </Button>
          </div>
          <p className="text-xs text-white/30">This link expires in 14 days. Players click it, sign in, and submit their position and waiver.</p>
          <Button size="sm" variant="ghost" className="text-white/30 hover:text-white text-xs px-0" onClick={generateInvite}>
            <RefreshCw className="h-3 w-3 mr-1" /> Generate new link
          </Button>
        </div>
      )}
    </div>
  );
}

function RegisterTab({ league, myStatus, onStatusRefresh }: { league: any; myStatus: any; onStatusRefresh: () => void }) {
  const getHeaders = useAuthHeaders();
  const { toast } = useToast();
  const [teamName, setTeamName] = useState("");
  const [jerseyColor, setJerseyColor] = useState("");
  const [estimatedRosterSize, setEstimatedRosterSize] = useState("8");
  const [blackoutDates, setBlackoutDates] = useState<[string, string]>(["", ""]);
  const [waiverChecked, setWaiverChecked] = useState(false);
  const [regMode, setRegMode] = useState<"team" | "freeagent" | null>(null);
  const [registeredTeam, setRegisteredTeam] = useState<{ id: number; name: string } | null>(null);
  const [selectedDivisionId, setSelectedDivisionId] = useState<number | null>(null);
  const [teamAgeGroup, setTeamAgeGroup] = useState<string>("");

  // Free agent form state
  const [faPositions, setFaPositions] = useState<string[]>([]);
  const [faSkillLevel, setFaSkillLevel] = useState("intermediate");
  const [faAvailDays, setFaAvailDays] = useState<string[]>([]);
  const [faAvailTime, setFaAvailTime] = useState("Flexible");

  const { ensureProfile, WaiverModalElement } = useWaiverGate();

  const { data: divisions } = useQuery({
    queryKey: ["league-divisions-public", league.id],
    queryFn: async () => {
      const r = await fetch(`${API}/leagues/${league.id}/divisions`);
      if (!r.ok) return [] as any[];
      return r.json() as Promise<any[]>;
    },
  });
  const multiDiv = Array.isArray(divisions) && divisions.length > 1;
  // All distinct age groups offered across divisions (for eligibility filter)
  const allDivisionAgeGroups: string[] = multiDiv
    ? [...new Set((divisions as any[]).flatMap((d: any) => Array.isArray(d.ageGroups) ? d.ageGroups : []))]
    : [];
  // Filter divisions shown: when an age group is selected, show only matching divisions (skip untagged)
  const eligibleDivisions = multiDiv
    ? (divisions as any[]).filter((d: any) => {
        const dAgs: string[] = Array.isArray(d.ageGroups) ? d.ageGroups : [];
        return !teamAgeGroup || dAgs.length === 0 || dAgs.includes(teamAgeGroup);
      })
    : (divisions ?? []);

  const togglePosition = (pos: string) =>
    setFaPositions((prev) => prev.includes(pos) ? prev.filter((p) => p !== pos) : [...prev, pos]);
  const toggleDay = (day: string) =>
    setFaAvailDays((prev) => prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]);

  const registerTeam = useMutation({
    mutationFn: async () => {
      if (multiDiv && !selectedDivisionId) throw new Error("Please select a division before registering.");
      const headers = await getHeaders();
      const r = await fetch(`${API}/leagues/${league.id}/register`, {
        method: "POST", headers,
        body: JSON.stringify({
          teamName,
          waiverSigned: waiverChecked,
          jerseyColor: jerseyColor || undefined,
          estimatedRosterSize: estimatedRosterSize ? Number(estimatedRosterSize) : undefined,
          blackoutDates: blackoutDates.filter(Boolean),
          divisionId: selectedDivisionId ?? undefined,
          teamAgeGroup: teamAgeGroup || undefined,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: "Registration failed" }));
        const e: any = new Error(err.error ?? "Registration failed");
        e.status = r.status;
        throw e;
      }
      return r.json();
    },
    onSuccess: (data) => {
      toast({ title: "Team registered! 🎉", description: "Now generate an invite link to recruit players." });
      onStatusRefresh();
      const teamId = data.team?.id ?? data.teamId;
      if (teamId) setRegisteredTeam({ id: teamId, name: teamName });
      setRegMode(null);
    },
    onError: (e: any) => {
      if (e.status === 409) {
        toast({ title: "Already registered", description: "You are already registered in this league. View your team on the dashboard.", variant: "default" });
        onStatusRefresh();
      } else {
        toast({ title: "Registration failed", description: e.message, variant: "destructive" });
      }
    },
  });

  const registerFreeAgent = useMutation({
    mutationFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/leagues/${league.id}/free-agents`, {
        method: "POST", headers,
        body: JSON.stringify({
          waiverSigned: waiverChecked,
          positions: faPositions,
          skillLevel: faSkillLevel,
          availability: { days: faAvailDays, timePreference: faAvailTime },
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: "Registration failed" }));
        throw new Error(err.error ?? "Registration failed");
      }
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Registered as free agent!", description: "Our AI will find the best team match for you." });
      onStatusRefresh();
      setRegMode(null);
    },
    onError: (e: any) => toast({ title: "Registration failed", description: e.message, variant: "destructive" }),
  });

  const isFull = (league.teamsRegistered || 0) >= league.maxTeams;
  const isActive = computeIsEventActive(league);
  const canRegister = isActive && league.registrationOpen && league.status !== "completed";

  // Registered state
  if (myStatus?.myTeam || myStatus?.freeAgent) {
    const fa = myStatus.freeAgent;
    const team = registeredTeam ?? (myStatus.myTeam ? { id: myStatus.myTeam.id, name: myStatus.myTeam.name } : null);
    const isCaptain = myStatus.myMembership?.role === "captain";

    return (
      <div className="py-4 space-y-4">
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-400 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold text-emerald-400">You're registered!</p>
            {myStatus.myTeam && (
              <p className="text-sm text-white/50 mt-1">
                Team: <span className="font-medium text-white">{myStatus.myTeam.name}</span>
                {isCaptain && " (Captain)"}
              </p>
            )}
            {fa && fa.matchStatus !== "matched" && (
              <FreeAgentMatchStatus
                leagueId={league.id}
                agentId={fa.id}
                matchStatus={fa.matchStatus ?? "unmatched"}
                proposedTeam={fa.proposedTeam?.name}
                matchReasoning={fa.matchReasoning}
                onRefresh={onStatusRefresh}
              />
            )}
            {myStatus.registration && (
              <div className="mt-3 pt-3 border-t border-emerald-500/20 space-y-1">
                <p className="text-xs text-white/40">
                  Paid: <span className="font-medium text-white">${Number(myStatus.registration.amountPaid).toFixed(2)}</span> of ${Number(myStatus.registration.totalAmount).toFixed(2)}
                </p>
                {Number(myStatus.registration.balanceDue) > 0 && (
                  <p className="text-xs text-amber-400 font-medium">
                    Balance due: ${Number(myStatus.registration.balanceDue).toFixed(2)}
                    {myStatus.registration.balanceDueDate && ` by ${format(new Date(myStatus.registration.balanceDueDate), "MMM d")}`}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {isCaptain && team && (
          <InviteLinkPanel leagueId={league.id} teamId={team.id} teamName={team.name} />
        )}

        <Button variant="outline" asChild className="w-full border-white/20 text-white hover:bg-white/10">
          <Link href="/dashboard">Go to Dashboard <ArrowRight className="h-4 w-4 ml-2" /></Link>
        </Button>
      </div>
    );
  }

  // Newly registered team (just submitted) — show invite panel immediately
  if (registeredTeam) {
    return (
      <div className="py-4 space-y-4">
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-400 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold text-emerald-400">Team registered!</p>
            <p className="text-sm text-white/50 mt-1">{registeredTeam.name} is in the league.</p>
          </div>
        </div>
        <InviteLinkPanel leagueId={league.id} teamId={registeredTeam.id} teamName={registeredTeam.name} />
        <Button variant="outline" asChild className="w-full border-white/20 text-white hover:bg-white/10">
          <Link href="/dashboard">Go to Dashboard <ArrowRight className="h-4 w-4 ml-2" /></Link>
        </Button>
      </div>
    );
  }

  if (!canRegister) {
    return (
      <div className="py-6 text-center space-y-3">
        <AlertCircle className="h-10 w-10 text-white/20 mx-auto" />
        <p className="text-white/40">
          {!isActive ? "This league is not currently active." :
           !league.registrationOpen ? "Registration is currently closed." :
           league.status === "completed" ? "This season has ended." :
           isFull ? "This league is full." : "Registration unavailable."}
        </p>
      </div>
    );
  }

  return (
    <div className="py-4 space-y-4">
      <p className="text-sm text-white/50">
        Team fee: <span className="font-semibold text-white">${league.registrationPrice}</span>
        {" · "}
        Deposit (50%): <span className="font-semibold text-white">${(Number(league.registrationPrice) * 0.5).toFixed(2)}</span>
      </p>

      {!regMode ? (
        <div className="grid grid-cols-1 gap-3">
          <Button className="h-14 text-base bg-[#dc2626] hover:bg-[#b91c1c] border-none" onClick={() => ensureProfile(() => setRegMode("team"))}>
            <Users className="h-5 w-5 mr-2" /> Register a Team
          </Button>
          {league.allowFreeAgents && (
            <Button variant="outline" className="h-14 text-base border-white/20 text-white hover:bg-white/10" onClick={() => ensureProfile(() => setRegMode("freeagent"))}>
              <Trophy className="h-5 w-5 mr-2" /> Register as Free Agent
            </Button>
          )}
        </div>
      ) : regMode === "team" ? (
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-white">Register a Team</h3>
            <Button variant="ghost" size="sm" className="text-white/40 hover:text-white" onClick={() => setRegMode(null)}>✕</Button>
          </div>

          <div>
            <Label className="text-xs text-white/50">Team Name *</Label>
            <Input className="mt-1 bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-[#dc2626]"
              placeholder="e.g. The Ballers" value={teamName} onChange={(e) => setTeamName(e.target.value)} />
          </div>

          {multiDiv && (
            <div className="space-y-3">
              {allDivisionAgeGroups.length > 0 && (
                <div>
                  <Label className="text-xs text-white/50">Team Age Group</Label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {allDivisionAgeGroups.map((ag) => (
                      <button
                        key={ag}
                        type="button"
                        onClick={() => { setTeamAgeGroup(teamAgeGroup === ag ? "" : ag); setSelectedDivisionId(null); }}
                        className={`px-3 py-1 rounded-lg text-xs font-medium border transition-all ${
                          teamAgeGroup === ag
                            ? "bg-white/20 border-white/40 text-white"
                            : "bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white"
                        }`}
                      >
                        {ag}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <Label className="text-xs text-white/50">Division *</Label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {eligibleDivisions.map((d: any) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setSelectedDivisionId(d.id)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                        selectedDivisionId === d.id
                          ? "bg-[#dc2626] border-[#dc2626] text-white"
                          : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      {d.name}
                      {d.ageGroups?.length ? <span className="ml-1.5 text-xs opacity-70">{d.ageGroups.join(", ")}</span> : null}
                    </button>
                  ))}
                </div>
                {!selectedDivisionId && <p className="text-xs text-amber-400/70 mt-1">Select the division you want to play in.</p>}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-white/50">Jersey Color</Label>
              <select
                className="mt-1 w-full bg-white/5 border border-white/10 text-white rounded-md px-3 py-2 text-sm focus:border-[#dc2626] focus:outline-none"
                value={jerseyColor} onChange={(e) => setJerseyColor(e.target.value)}
              >
                <option value="">Select…</option>
                {JERSEY_COLORS.map((c) => <option key={c} value={c.toLowerCase()}>{c}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs text-white/50">Est. Roster Size</Label>
              <Input className="mt-1 bg-white/5 border-white/10 text-white placeholder:text-white/30" type="number" min="5" max="20"
                value={estimatedRosterSize} onChange={(e) => setEstimatedRosterSize(e.target.value)} />
            </div>
          </div>

          <div>
            <Label className="text-xs text-white/50">Blackout Dates (optional — up to 2 dates you can't play)</Label>
            <div className="flex gap-2 mt-1">
              {blackoutDates.map((d, i) => (
                <Input key={i} type="date" className="flex-1 bg-white/5 border-white/10 text-white text-sm"
                  value={d} onChange={(e) => setBlackoutDates((prev) => { const n = [...prev] as [string, string]; n[i] = e.target.value; return n; })} />
              ))}
            </div>
          </div>

          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" className="mt-0.5 accent-[#dc2626]" checked={waiverChecked} onChange={(e) => setWaiverChecked(e.target.checked)} />
            <span className="text-sm text-white/70">I confirm I have read and agree to the liability waiver</span>
          </label>

          <Button className="w-full bg-[#dc2626] hover:bg-[#b91c1c] border-none" disabled={!waiverChecked || !teamName || registerTeam.isPending}
            onClick={() => registerTeam.mutate()}>
            {registerTeam.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Confirm Team Registration
          </Button>
        </div>
      ) : (
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-white">Register as Free Agent</h3>
            <Button variant="ghost" size="sm" className="text-white/40 hover:text-white" onClick={() => setRegMode(null)}>✕</Button>
          </div>

          <p className="text-xs text-white/40">Our AI matches you with the best available team based on your profile. You and the team both approve before it's final.</p>

          <div>
            <Label className="text-xs text-white/50 mb-2 block">Positions you can play</Label>
            <div className="flex flex-wrap gap-2">
              {FUTSAL_POSITIONS.map((pos) => (
                <button key={pos} type="button"
                  className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-all ${faPositions.includes(pos) ? "bg-[#dc2626] border-[#dc2626] text-white" : "bg-white/5 border-white/10 text-white/50 hover:border-white/30"}`}
                  onClick={() => togglePosition(pos)}>
                  {pos}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs text-white/50 mb-2 block">Skill Level</Label>
            <div className="grid grid-cols-3 gap-2">
              {SKILL_LEVELS.map((sl) => (
                <button key={sl.value} type="button"
                  className={`text-left p-2.5 rounded-xl border transition-all ${faSkillLevel === sl.value ? "bg-[#dc2626]/20 border-[#dc2626] text-white" : "bg-white/5 border-white/10 text-white/50 hover:border-white/30"}`}
                  onClick={() => setFaSkillLevel(sl.value)}>
                  <div className="text-xs font-semibold">{sl.label}</div>
                  <div className="text-xs opacity-60 mt-0.5 leading-tight">{sl.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs text-white/50 mb-2 block">Available Days</Label>
            <div className="flex flex-wrap gap-1.5">
              {DAYS_OF_WEEK.map((day) => (
                <button key={day} type="button"
                  className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-all ${faAvailDays.includes(day) ? "bg-[#dc2626] border-[#dc2626] text-white" : "bg-white/5 border-white/10 text-white/50 hover:border-white/30"}`}
                  onClick={() => toggleDay(day)}>
                  {day.slice(0, 3)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs text-white/50">Time Preference</Label>
            <select className="mt-1 w-full bg-white/5 border border-white/10 text-white rounded-md px-3 py-2 text-sm focus:border-[#dc2626] focus:outline-none"
              value={faAvailTime} onChange={(e) => setFaAvailTime(e.target.value)}>
              {TIME_PREFS.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>

          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" className="mt-0.5 accent-[#dc2626]" checked={waiverChecked} onChange={(e) => setWaiverChecked(e.target.checked)} />
            <span className="text-sm text-white/70">I confirm I have read and agree to the liability waiver</span>
          </label>

          <Button className="w-full bg-[#dc2626] hover:bg-[#b91c1c] border-none"
            disabled={!waiverChecked || faPositions.length === 0 || registerFreeAgent.isPending}
            onClick={() => registerFreeAgent.mutate()}>
            {registerFreeAgent.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Submit Free Agent Registration
          </Button>
          {faPositions.length === 0 && <p className="text-xs text-amber-400/80 text-center">Select at least one position to continue</p>}
        </div>
      )}

      <p className="text-xs text-white/30">
        A 50% deposit holds your spot. Balance is due before the first game. Contact admin to arrange payment.
      </p>

      {WaiverModalElement}
    </div>
  );
}

export default function LeagueDetail() {
  const [, params] = useRoute("/leagues/:id");
  const id = Number(params?.id);
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("about");

  const { data: league, isLoading } = useGetLeague(id, {
    query: { enabled: !!id, queryKey: getGetLeagueQueryKey(id) },
  });

  const { isRegistered, isLoading: regCheckLoading } = useIsRegistered("league", id);

  const { data: myStatus, refetch: refetchStatus } = useQuery({
    queryKey: ["league-my-status", id],
    queryFn: async () => {
      const token = await getToken();
      if (!token) return null;
      const r = await fetch(`${API}/leagues/${id}/my-status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return r.ok ? r.json() : null;
    },
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <Layout>
        <div className="bg-[#050508] min-h-screen">
          <Skeleton className="h-72 w-full bg-white/10" />
          <div className="container mx-auto px-4 py-8">
            <Skeleton className="h-96 w-full bg-white/5 rounded-2xl" />
          </div>
        </div>
      </Layout>
    );
  }

  if (!league) {
    return (
      <Layout>
        <div className="bg-[#050508] min-h-screen flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-white mb-4">League not found</h1>
            <Button asChild className="bg-[#dc2626] hover:bg-[#b91c1c]"><Link href="/leagues">Back to Leagues</Link></Button>
          </div>
        </div>
      </Layout>
    );
  }

  const isFull = (league.teamsRegistered || 0) >= league.maxTeams;
  const displayStatus: "Open" | "Full" | "Upcoming" = isFull ? "Full" : league.registrationOpen === true ? "Open" : "Upcoming";
  const statusStyles: Record<string, string> = {
    Open: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    Full: "bg-red-500/20 text-red-400 border-red-500/30",
    Upcoming: "bg-white/10 text-white/60 border-white/20",
  };

  return (
    <Layout>
      <div className="dark bg-[#050508] text-white min-h-screen">
        {/* Compact header */}
        <div className="bg-gradient-to-b from-[#0d0005] to-[#050508] border-b border-white/10 pt-6 pb-7">
          <div className="container mx-auto px-4">
            <Button variant="ghost" size="sm" className="mb-4 text-white/50 hover:text-white -ml-2 h-8" asChild>
              <Link href="/leagues"><ChevronLeft className="mr-1 h-4 w-4" /> All Leagues</Link>
            </Button>
            <div className="flex flex-wrap gap-1.5 mb-3 items-center">
              <span className="inline-flex items-center bg-[#dc2626]/80 text-white text-xs font-bold px-2.5 py-1 rounded-full border border-[#dc2626]/50">
                League
              </span>
              {league.format && (
                <span className="inline-flex items-center bg-white/10 text-white text-xs font-bold px-2.5 py-1 rounded-full border border-white/20 uppercase">{league.format}</span>
              )}
              <span className={`inline-flex items-center text-xs font-bold px-2.5 py-1 rounded-full border ${statusStyles[displayStatus]}`}>
                {displayStatus}
              </span>
            </div>
            <h1 className="text-2xl md:text-4xl font-black text-white uppercase tracking-tight mb-3">{league.name}</h1>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-white/50">
              {league.startDate && (
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-[#ef4444]" />
                  {format(new Date(league.startDate), "MMM d")}{league.endDate ? ` – ${format(new Date(league.endDate), "MMM d, yyyy")}` : ""}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-[#ef4444]" />
                Alumni Center · Lexington, KY
              </span>
              <span className="flex items-center gap-1.5">
                <DollarSign className="h-3.5 w-3.5 text-[#ef4444]" />
                ${league.registrationPrice} / team
              </span>
              <span className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-[#ef4444]" />
                {league.teamsRegistered}/{league.maxTeams} teams
              </span>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="bg-[#0a0a10] py-10">
          <div className="container mx-auto px-4 max-w-5xl">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Tabs */}
              <SectionEntry direction="left" className="lg:col-span-2">
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                  <TabsList className="bg-white/10 border border-white/10 mb-6 p-1 rounded-xl flex-wrap h-auto gap-1">
                    <TabsTrigger value="about" className="data-[state=active]:bg-[#dc2626] data-[state=active]:text-white text-white/60 rounded-lg">About</TabsTrigger>
                    <TabsTrigger value="schedule" className="data-[state=active]:bg-[#dc2626] data-[state=active]:text-white text-white/60 rounded-lg">Schedule</TabsTrigger>
                    <TabsTrigger value="standings" className="data-[state=active]:bg-[#dc2626] data-[state=active]:text-white text-white/60 rounded-lg">Standings</TabsTrigger>
                    <TabsTrigger value="teams" className="data-[state=active]:bg-[#dc2626] data-[state=active]:text-white text-white/60 rounded-lg">Teams</TabsTrigger>
                    <TabsTrigger value="leaderboard" className="data-[state=active]:bg-[#dc2626] data-[state=active]:text-white text-white/60 rounded-lg">Leaderboard</TabsTrigger>
                  </TabsList>

                  <TabsContent value="about">
                    <p className="text-white/50 leading-relaxed whitespace-pre-line mt-2">
                      {league.description || "No description provided."}
                    </p>
                    {league.registrationDeadline && (
                      <div className="mt-5 flex items-start gap-3">
                        <Clock className="h-4 w-4 text-[#ef4444] mt-0.5 shrink-0" />
                        <div>
                          <p className="text-xs text-white/30">Registration Deadline</p>
                          <p className="text-sm font-medium text-white">{format(new Date(league.registrationDeadline), "MMM d, yyyy")}</p>
                        </div>
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="schedule">
                    <LockedTab
                      isRegistered={isRegistered}
                      isLoading={regCheckLoading}
                      onRegisterClick={() => setActiveTab("about")}
                    >
                      <ScheduleTab leagueId={id} />
                    </LockedTab>
                  </TabsContent>

                  <TabsContent value="standings">
                    <LockedTab
                      isRegistered={isRegistered}
                      isLoading={regCheckLoading}
                      onRegisterClick={() => setActiveTab("about")}
                    >
                      <StandingsTab leagueId={id} />
                    </LockedTab>
                  </TabsContent>

                  <TabsContent value="teams">
                    <LockedTab
                      isRegistered={isRegistered}
                      isLoading={regCheckLoading}
                      onRegisterClick={() => setActiveTab("about")}
                    >
                      <TeamsTab leagueId={id} />
                    </LockedTab>
                  </TabsContent>

                  <TabsContent value="leaderboard">
                    <LeaderboardTab leagueId={id} />
                  </TabsContent>
                </Tabs>
              </SectionEntry>

              {/* Sidebar */}
              <SectionEntry delay={0.15} direction="right">
                <div className="sticky top-24 rounded-2xl overflow-hidden border border-white/10 bg-[#111118] shadow-[0_8px_32px_rgba(0,0,0,0.6)]">
                  <div className="bg-white/5 border-b border-white/10 px-5 py-4">
                    <p className="text-xs text-white/30 uppercase tracking-widest font-bold mb-0.5">Registration</p>
                    <p className="text-white/50 text-sm">
                      {isFull ? "League is full" : league.registrationOpen ? "Spots available" : "Registration closed"}
                    </p>
                  </div>
                  <div className="px-5 py-4">
                    <Show when="signed-out">
                      <div className="space-y-3">
                        <p className="text-sm text-white/50">Sign in to register your team or join as a free agent.</p>
                        <Button className="w-full bg-[#dc2626] hover:bg-[#b91c1c] border-none" asChild>
                          <Link href="/sign-in">Sign In to Register</Link>
                        </Button>
                      </div>
                    </Show>
                    <Show when="signed-in">
                      <RegisterTab league={league} myStatus={myStatus} onStatusRefresh={refetchStatus} />
                    </Show>
                  </div>
                </div>
              </SectionEntry>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
