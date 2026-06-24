import { palette } from "@workspace/brand";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useAuth } from "@clerk/expo";
import { useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, ActivityIndicator, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "";

interface LeaderboardRow {
  teamId: number;
  teamName: string;
  teamColor: string | null;
  wins: number;
  battlesAttended: number;
  winRate: number;
  livesRemaining: number;
  hotStreak: number;
  isReigning: boolean;
}

interface Season {
  id: number;
  name: string;
  sport: string;
  status: string;
  teamSize: number;
  genderBracket: string;
  ageBracket: string;
}

function LivesIcon({ count }: { count: number }) {
  const color = count === 0 ? palette.crimson500 : count <= 2 ? "#f59e0b" : palette.neutral100;
  return (
    <View style={styles.livesRow}>
      <Feather name="heart" size={12} color={color} />
      <Text style={[styles.livesText, { color }]}>{count}</Text>
    </View>
  );
}

export default function KotcLeaderboardScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();

  const [seasons, setSeasons] = useState<Season[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<Season | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchSeasons() {
    try {
      const token = await getToken();
      const res = await fetch(`${BASE_URL}/api/kotc/seasons`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Failed to load seasons");
      const data: Season[] = await res.json();
      setSeasons(data);
      if (data.length > 0) {
        const active = data.find((s) => s.status === "active") ?? data[0];
        setSelectedSeason(active);
        return active;
      }
      return null;
    } catch (e) {
      setError("Could not load seasons");
      return null;
    }
  }

  async function fetchLeaderboard(seasonId: number) {
    try {
      const token = await getToken();
      const res = await fetch(`${BASE_URL}/api/kotc/seasons/${seasonId}/leaderboard`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Failed to load leaderboard");
      const data: LeaderboardRow[] = await res.json();
      setLeaderboard(data);
    } catch (e) {
      setError("Could not load leaderboard");
    }
  }

  async function load() {
    setLoading(true);
    setError(null);
    const season = await fetchSeasons();
    if (season) await fetchLeaderboard(season.id);
    setLoading(false);
  }

  async function refresh() {
    setRefreshing(true);
    if (selectedSeason) await fetchLeaderboard(selectedSeason.id);
    setRefreshing(false);
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!selectedSeason) return;
    fetchLeaderboard(selectedSeason.id);
  }, [selectedSeason]);

  const rankMedal = (i: number) => {
    if (i === 0) return "👑";
    if (i === 1) return "🥈";
    if (i === 2) return "🥉";
    return `#${i + 1}`;
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <LinearGradient
        colors={[palette.teal900, palette.teal700]}
        style={[
          styles.heroGradient,
          { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) + 16 },
        ]}
      >
        <View style={styles.heroHeader}>
          <View style={styles.crownIcon}>
            <Feather name="award" size={20} color="#f59e0b" />
          </View>
          <View>
            <Text style={styles.heroLabel}>KINGS OF THE COURT</Text>
            {selectedSeason && (
              <Text style={styles.heroTitle}>{selectedSeason.name}</Text>
            )}
          </View>
        </View>
        {selectedSeason && (
          <View style={styles.seasonMeta}>
            <Text style={styles.metaPill}>
              {selectedSeason.sport.charAt(0).toUpperCase() + selectedSeason.sport.slice(1)}
            </Text>
            <Text style={styles.metaPill}>
              {selectedSeason.teamSize}v{selectedSeason.teamSize}
            </Text>
            <Text style={styles.metaPill}>
              {selectedSeason.genderBracket.charAt(0).toUpperCase() + selectedSeason.genderBracket.slice(1)}
            </Text>
            <View style={[styles.statusPill, selectedSeason.status === "active" ? styles.statusActive : styles.statusOther]}>
              <Text style={[styles.statusText, selectedSeason.status === "active" ? styles.statusActiveText : styles.statusOtherText]}>
                {selectedSeason.status.toUpperCase()}
              </Text>
            </View>
          </View>
        )}
      </LinearGradient>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Loading leaderboard...</Text>
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Feather name="alert-circle" size={40} color={colors.mutedForeground} />
          <Text style={[styles.errorText, { color: colors.mutedForeground }]}>{error}</Text>
          <Pressable onPress={load} style={[styles.retryBtn, { backgroundColor: colors.primary }]}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </Pressable>
        </View>
      ) : leaderboard.length === 0 ? (
        <View style={styles.centered}>
          <Feather name="award" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No games yet</Text>
          <Text style={[styles.emptySubtitle, { color: colors.mutedForeground }]}>
            {seasons.length === 0 ? "No active seasons found." : "Games haven't been played yet."}
          </Text>
        </View>
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
          contentContainerStyle={styles.scrollContent}
        >
          <View style={[styles.tableHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.thRank, { color: colors.mutedForeground }]}>Rank</Text>
            <Text style={[styles.thTeam, { color: colors.mutedForeground }]}>Team</Text>
            <Text style={[styles.thStat, { color: colors.mutedForeground }]}>W</Text>
            <Text style={[styles.thStat, { color: colors.mutedForeground }]}>Win%</Text>
            <Text style={[styles.thStat, { color: colors.mutedForeground }]}>Lives</Text>
            <Text style={[styles.thStat, { color: colors.mutedForeground }]}>🔥</Text>
          </View>

          {leaderboard.map((row, i) => (
            <View
              key={row.teamId}
              style={[
                styles.row,
                { borderBottomColor: colors.border, backgroundColor: i === 0 ? "#f59e0b08" : "transparent" },
              ]}
            >
              <Text style={[styles.rank, { color: i < 3 ? "#f59e0b" : colors.mutedForeground }]}>
                {rankMedal(i)}
              </Text>
              <View style={styles.teamCell}>
                <View
                  style={[styles.teamDot, { backgroundColor: (row.teamColor ?? "#444") + "60" }]}
                />
                <Text style={[styles.teamName, { color: colors.foreground }]} numberOfLines={1}>
                  {row.teamName}
                </Text>
                {row.isReigning && (
                  <Feather name="award" size={11} color="#f59e0b" style={{ marginLeft: 2 }} />
                )}
              </View>
              <Text style={[styles.stat, { color: "#4ade80", fontFamily: "Outfit_700Bold" }]}>{row.wins}</Text>
              <Text style={[styles.stat, { color: colors.mutedForeground }]}>
                {(row.winRate * 100).toFixed(0)}%
              </Text>
              <LivesIcon count={row.livesRemaining} />
              <View style={styles.statCell}>
                {row.hotStreak >= 3 ? (
                  <Text style={styles.streak}>{row.hotStreak}</Text>
                ) : (
                  <Text style={[styles.stat, { color: colors.mutedForeground }]}>—</Text>
                )}
              </View>
            </View>
          ))}

          <View style={styles.footer}>
            <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
              Tiebreaker: Total Wins → Win Rate → Head-to-Head → Fewest Lives Consumed
            </Text>
            <Text style={[styles.footerNote, { color: colors.mutedForeground }]}>
              🔥 Hot streak = 3+ consecutive wins in current battle
            </Text>
          </View>

          {seasons.length > 1 && (
            <View style={styles.seasonSelector}>
              <Text style={[styles.seasonSelectorLabel, { color: colors.mutedForeground }]}>Other Seasons</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.seasonScroll}>
                {seasons.map((s) => (
                  <Pressable
                    key={s.id}
                    onPress={() => setSelectedSeason(s)}
                    style={[
                      styles.seasonChip,
                      {
                        backgroundColor: selectedSeason?.id === s.id ? colors.primary + "20" : colors.card,
                        borderColor: selectedSeason?.id === s.id ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text style={[styles.seasonChipText, { color: selectedSeason?.id === s.id ? colors.primary : colors.mutedForeground }]}>
                      {s.name}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  heroGradient: { paddingHorizontal: 20, paddingBottom: 20 },
  heroHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  crownIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: "#f59e0b20", borderWidth: 1, borderColor: "#f59e0b40",
    alignItems: "center", justifyContent: "center",
  },
  heroLabel: { color: "#f59e0b", fontSize: 10, fontFamily: "Outfit_700Bold", letterSpacing: 1.5 },
  heroTitle: { color: palette.neutral100, fontSize: 20, fontFamily: "Outfit_700Bold", marginTop: 2 },
  seasonMeta: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  metaPill: {
    fontSize: 11, fontFamily: "Outfit_600SemiBold", color: palette.neutral300,
    backgroundColor: "rgba(255,255,255,0.08)", paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 100,
  },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 100 },
  statusActive: { backgroundColor: "#22c55e20" },
  statusOther: { backgroundColor: "rgba(255,255,255,0.06)" },
  statusText: { fontSize: 11, fontFamily: "Outfit_700Bold", letterSpacing: 0.5 },
  statusActiveText: { color: "#4ade80" },
  statusOtherText: { color: palette.neutral400 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
  loadingText: { fontSize: 14, fontFamily: "Outfit_400Regular", marginTop: 8 },
  errorText: { fontSize: 14, fontFamily: "Outfit_400Regular", textAlign: "center" },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, marginTop: 8 },
  retryBtnText: { color: "#fff", fontFamily: "Outfit_700Bold", fontSize: 14 },
  emptyTitle: { fontSize: 18, fontFamily: "Outfit_700Bold" },
  emptySubtitle: { fontSize: 14, fontFamily: "Outfit_400Regular", textAlign: "center" },
  scrollContent: { paddingBottom: 40 },
  tableHeader: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1,
  },
  thRank: { width: 44, fontSize: 10, fontFamily: "Outfit_700Bold", letterSpacing: 0.8 },
  thTeam: { flex: 1, fontSize: 10, fontFamily: "Outfit_700Bold", letterSpacing: 0.8 },
  thStat: { width: 40, fontSize: 10, fontFamily: "Outfit_700Bold", letterSpacing: 0.8, textAlign: "right" },
  row: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1,
  },
  rank: { width: 44, fontSize: 13, fontFamily: "Outfit_700Bold" },
  teamCell: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  teamDot: { width: 20, height: 20, borderRadius: 10 },
  teamName: { flex: 1, fontSize: 13, fontFamily: "Outfit_600SemiBold" },
  stat: { width: 40, fontSize: 13, fontFamily: "Outfit_600SemiBold", textAlign: "right" },
  statCell: { width: 40, alignItems: "flex-end" },
  livesRow: { width: 40, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 3 },
  livesText: { fontSize: 13, fontFamily: "Outfit_700Bold" },
  streak: { fontSize: 12, color: "#fb923c", fontFamily: "Outfit_700Bold" },
  footer: { padding: 20, gap: 4 },
  footerText: { fontSize: 11, fontFamily: "Outfit_400Regular", textAlign: "center" },
  footerNote: { fontSize: 11, fontFamily: "Outfit_400Regular", textAlign: "center" },
  seasonSelector: { paddingHorizontal: 16, paddingBottom: 16 },
  seasonSelectorLabel: { fontSize: 11, fontFamily: "Outfit_700Bold", letterSpacing: 0.8, marginBottom: 8 },
  seasonScroll: {},
  seasonChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 100, borderWidth: 1, marginRight: 8,
  },
  seasonChipText: { fontSize: 12, fontFamily: "Outfit_600SemiBold" },
});
