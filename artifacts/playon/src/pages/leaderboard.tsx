import { API_BASE } from "@/lib/api-base";
import { useEffect, useState } from "react";
import { Layout } from "@/components/layout";
import { Trophy, Medal, Star, TrendingUp, Loader2 } from "lucide-react";
import { motion } from "framer-motion";


interface LeaderboardEntry {
  rank: number;
  userId: number;
  displayName: string;
  goalsScored: number;
  assists: number;
  gamesPlayed: number;
  gamesAttended: number;
  attendanceStreak: number;
  bestAttendanceStreak: number;
}

type Metric = "goals" | "assists" | "games" | "streak";

const METRIC_CONFIG: Record<Metric, { label: string; icon: React.ReactNode; valueKey: keyof LeaderboardEntry; color: string }> = {
  goals: { label: "Goals", icon: <Trophy className="h-4 w-4" />, valueKey: "goalsScored", color: "#ef4444" },
  assists: { label: "Assists", icon: <Star className="h-4 w-4" />, valueKey: "assists", color: "#60a5fa" },
  games: { label: "Games", icon: <Medal className="h-4 w-4" />, valueKey: "gamesPlayed", color: "#4ade80" },
  streak: { label: "Best Streak", icon: <TrendingUp className="h-4 w-4" />, valueKey: "bestAttendanceStreak", color: "#fbbf24" },
};

function RankDisplay({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-2xl">🥇</span>;
  if (rank === 2) return <span className="text-2xl">🥈</span>;
  if (rank === 3) return <span className="text-2xl">🥉</span>;
  return (
    <span className="text-white/30 font-black text-lg w-8 text-center block">{rank}</span>
  );
}

export default function Leaderboard() {
  const [metric, setMetric] = useState<Metric>("goals");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/player-stats/leaderboard?metric=${metric}&limit=10`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setEntries(data);
        else setError(data.error ?? "Failed to load leaderboard");
      })
      .catch(() => setError("Failed to load leaderboard"))
      .finally(() => setLoading(false));
  }, [metric]);

  const cfg = METRIC_CONFIG[metric];

  return (
    <Layout>
      {/* Dark hero */}
      <div className="relative bg-[#050508] pt-32 pb-20 overflow-hidden">
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full pointer-events-none"
          style={{ background: "radial-gradient(ellipse, rgba(157,20,40,0.18) 0%, transparent 70%)", filter: "blur(60px)" }}
        />
        <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-[0.03]" preserveAspectRatio="xMidYMid slice">
          <defs>
            <pattern id="lb-lines" x="0" y="0" width="60" height="60" patternUnits="userSpaceOnUse">
              <circle cx="30" cy="30" r="20" stroke="white" strokeWidth="1" fill="none" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#lb-lines)" />
        </svg>
        <div className="container mx-auto px-4 relative z-10 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#dc2626]/20 border border-[#dc2626]/30 mb-6">
              <Trophy className="h-8 w-8 text-[#ef4444]" />
            </div>
            <p className="text-[#ef4444] text-xs font-bold uppercase tracking-widest mb-3">Player Rankings</p>
            <h1 className="text-5xl md:text-7xl font-black uppercase tracking-tight text-white leading-none mb-4">
              Leaderboard
            </h1>
            <p className="text-white/50 max-w-xl mx-auto text-lg">
              Adult and competitive player rankings. Stats updated by PlayOn staff after each game.
            </p>
          </motion.div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-[#0a0a10] to-transparent pointer-events-none" />
      </div>

      {/* Content */}
      <div className="bg-[#0a0a10] min-h-screen py-16">
        <div className="container mx-auto px-4 max-w-2xl">
          {/* Metric selector */}
          <div className="flex flex-wrap gap-2 justify-center mb-10">
            {(Object.keys(METRIC_CONFIG) as Metric[]).map((m) => (
              <button
                key={m}
                onClick={() => setMetric(m)}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border transition-all duration-200 ${
                  metric === m
                    ? "bg-[#dc2626] border-[#dc2626] text-white shadow-[0_0_20px_rgba(220,38,38,0.3)]"
                    : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:text-white hover:border-white/20"
                }`}
              >
                {METRIC_CONFIG[m].icon}
                {METRIC_CONFIG[m].label}
              </button>
            ))}
          </div>

          {/* Leaderboard card */}
          <div className="rounded-2xl border border-white/10 bg-[#111118] overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.6)]">
            <div className="bg-white/5 border-b border-white/10 px-6 py-4 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${cfg.color}20`, border: `1px solid ${cfg.color}30` }}>
                <span style={{ color: cfg.color }}>{cfg.icon}</span>
              </div>
              <div>
                <p className="text-white font-bold">Top 10 by {cfg.label}</p>
                <p className="text-white/30 text-xs">Youth stats are private</p>
              </div>
            </div>

            {loading ? (
              <div className="flex justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-white/30" />
              </div>
            ) : error ? (
              <div className="text-center py-16">
                <p className="text-white/30 text-sm">{error}</p>
              </div>
            ) : entries.length === 0 ? (
              <div className="text-center py-16">
                <Trophy className="h-12 w-12 text-white/10 mx-auto mb-4" />
                <p className="text-white/30 text-sm">No stats recorded yet.</p>
                <p className="text-white/20 text-xs mt-1">Check back after the season starts.</p>
              </div>
            ) : (
              <ol>
                {entries.map((e, i) => (
                  <motion.li
                    key={e.userId}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: i * 0.05 }}
                    className={`flex items-center gap-4 px-6 py-4 border-b border-white/5 last:border-0 transition-colors ${
                      e.rank <= 3 ? "bg-white/[0.03]" : "hover:bg-white/5"
                    }`}
                  >
                    <div className="w-10 flex items-center justify-center shrink-0">
                      <RankDisplay rank={e.rank} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-semibold text-sm truncate">{e.displayName}</p>
                      <p className="text-white/30 text-xs mt-0.5">
                        {e.gamesPlayed} games · {e.goalsScored}G {e.assists}A
                      </p>
                    </div>
                    <div
                      className="shrink-0 px-3 py-1 rounded-full text-sm font-black tabular-nums border"
                      style={{
                        background: `${cfg.color}15`,
                        color: cfg.color,
                        borderColor: `${cfg.color}25`,
                      }}
                    >
                      {String(e[cfg.valueKey])}
                      <span className="text-xs font-normal ml-1 opacity-70">
                        {cfg.label === "Best Streak" ? "in a row" : cfg.label.toLowerCase()}
                      </span>
                    </div>
                  </motion.li>
                ))}
              </ol>
            )}
          </div>

          <p className="text-center text-xs text-white/20 mt-6">
            Only players 16+ are included in the public leaderboard. Stats are updated by PlayOn staff after each game.
          </p>
        </div>
      </div>
    </Layout>
  );
}
