import React, { useState, useEffect } from "react";
import { useAuth } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Crown, Heart, Flame, Trophy, Users, Swords, Star } from "lucide-react";

const API = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

function authFetch(token: string | null, url: string) {
  return fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

export default function KotcLeaderboardPage() {
  const { getToken } = useAuth();
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>("");

  const { data: seasons = [] } = useQuery({
    queryKey: ["kotc-seasons-lb"],
    queryFn: async () => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/seasons`);
      if (!res.ok) return [];
      return res.json() as Promise<Array<Record<string, unknown>>>;
    },
  });

  // Auto-select the active season (or first) when seasons load — React Query v5 removed onSuccess
  useEffect(() => {
    if ((seasons as Array<Record<string, unknown>>).length > 0 && !selectedSeasonId) {
      const data = seasons as Array<Record<string, unknown>>;
      const active = data.find((s) => s.status === "active") ?? data[0];
      setSelectedSeasonId(String(active.id));
    }
  }, [seasons, selectedSeasonId]);

  const { data: leaderboard = [], isLoading: lbLoading } = useQuery({
    queryKey: ["kotc-leaderboard-lb", selectedSeasonId],
    enabled: !!selectedSeasonId,
    refetchInterval: 15_000,
    queryFn: async () => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/seasons/${selectedSeasonId}/leaderboard`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const selectedSeason = seasons.find((s: Record<string, unknown>) => String(s.id) === selectedSeasonId);

  return (
    <Layout>
      <div className="max-w-4xl mx-auto p-4 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <Crown className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Kings of The Court</h1>
              <p className="text-sm text-muted-foreground">Live season leaderboard</p>
            </div>
          </div>
          {seasons.length > 1 && (
            <Select value={selectedSeasonId} onValueChange={setSelectedSeasonId}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Select season" />
              </SelectTrigger>
              <SelectContent>
                {seasons.map((s: Record<string, unknown>) => (
                  <SelectItem key={String(s.id)} value={String(s.id)}>{String(s.name)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {selectedSeason && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Sport", value: String(selectedSeason.sport).charAt(0).toUpperCase() + String(selectedSeason.sport).slice(1), icon: Trophy },
              { label: "Format", value: `${selectedSeason.teamSize}v${selectedSeason.teamSize}`, icon: Users },
              { label: "Win Target", value: `${selectedSeason.winTarget} pts`, icon: Star },
              { label: "Status", value: String(selectedSeason.status).charAt(0).toUpperCase() + String(selectedSeason.status).slice(1), icon: Swords },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="rounded-xl border border-border bg-card p-3 text-center">
                <Icon className="h-4 w-4 text-muted-foreground mx-auto mb-1.5" />
                <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">{label}</p>
                <p className="text-sm font-bold text-foreground mt-0.5">{value}</p>
              </div>
            ))}
          </div>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Trophy className="h-4 w-4 text-amber-400" />
                Season Standings
              </span>
              <span className="text-[11px] text-muted-foreground font-normal">Updates live every 15s</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {lbLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
              </div>
            ) : leaderboard.length === 0 ? (
              <div className="text-center py-12">
                <Crown className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <p className="font-semibold text-foreground">No results yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {!selectedSeasonId ? "Select a season above" : "Games haven't been played yet."}
                </p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[11px] text-muted-foreground uppercase tracking-wider border-b border-border">
                        <th className="text-left pb-3 pr-3 w-10">Rank</th>
                        <th className="text-left pb-3 pr-3">Team</th>
                        <th className="text-right pb-3 pr-3">Wins</th>
                        <th className="text-right pb-3 pr-3 hidden sm:table-cell">Battles</th>
                        <th className="text-right pb-3 pr-3 hidden sm:table-cell">Win %</th>
                        <th className="text-right pb-3 pr-3">Lives</th>
                        <th className="text-right pb-3">Streak</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {leaderboard.map((row: Record<string, unknown>, i: number) => {
                        const rank = i + 1;
                        const isTop3 = rank <= 3;
                        const rankColor = rank === 1 ? "text-amber-400" : rank === 2 ? "text-slate-300" : rank === 3 ? "text-amber-600" : "text-muted-foreground";

                        return (
                          <tr key={String(row.teamId)} className={`hover:bg-muted/20 transition-colors ${rank === 1 ? "bg-amber-500/5" : ""}`}>
                            <td className="py-3 pr-3">
                              <span className={`font-bold text-base ${rankColor}`}>
                                {rank === 1 ? "👑" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`}
                              </span>
                            </td>
                            <td className="py-3 pr-3">
                              <div className="flex items-center gap-2.5">
                                <div
                                  className="w-7 h-7 rounded-full border border-border flex-shrink-0"
                                  style={{ backgroundColor: (String(row.teamColor || "#444")) + "40" }}
                                />
                                <div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-semibold text-foreground">{String(row.teamName)}</span>
                                    {!!row.isReigning && <Crown className="h-3.5 w-3.5 text-amber-400" />}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="py-3 pr-3 text-right">
                              <span className="font-bold text-green-400">{Number(row.wins)}</span>
                            </td>
                            <td className="py-3 pr-3 text-right hidden sm:table-cell text-muted-foreground">
                              {Number(row.battlesAttended)}
                            </td>
                            <td className="py-3 pr-3 text-right hidden sm:table-cell text-muted-foreground">
                              {(Number(row.winRate) * 100).toFixed(0)}%
                            </td>
                            <td className="py-3 pr-3 text-right">
                              <span className={`flex items-center justify-end gap-1 font-medium ${Number(row.livesRemaining) === 0 ? "text-red-400" : Number(row.livesRemaining) <= 2 ? "text-amber-400" : "text-foreground"}`}>
                                <Heart className="h-3.5 w-3.5" />
                                {Number(row.livesRemaining)}
                              </span>
                            </td>
                            <td className="py-3 text-right">
                              {Number(row.hotStreak) >= 3 ? (
                                <span className="inline-flex items-center gap-0.5 text-orange-400 font-bold text-xs">
                                  <Flame className="h-3.5 w-3.5" />
                                  {Number(row.hotStreak)}
                                </span>
                              ) : (
                                <span className="text-muted-foreground text-xs">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="mt-6 pt-4 border-t border-border">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Tiebreaker Order</p>
                  <div className="flex flex-wrap gap-2">
                    {["1. Total Wins", "2. Win Rate", "3. Head-to-Head", "4. Fewest Lives Consumed"].map((rule) => (
                      <span key={rule} className="text-[11px] bg-muted text-muted-foreground px-2 py-1 rounded">{rule}</span>
                    ))}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
