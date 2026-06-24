import { palette } from "@workspace/brand";
import { useAuth, useUser } from "@clerk/expo";
import {
  setAuthTokenGetter,
  useGetMyProfile,
  useListRegistrations,
  RegistrationProgramType,
} from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

const STATUS_COLORS: Record<string, string> = {
  confirmed:  "#22C55E",
  waitlisted: "#F59E0B",
  cancelled:  "#EF4444",
  pending:    "#6B7280",
};

type InnerTab = "registrations" | "stats";

const domain = process.env.EXPO_PUBLIC_DOMAIN;
const baseUrl = domain ? `https://${domain}` : "";

export default function MyPlayOnScreen() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topPaddingWeb = Platform.OS === "web" ? 67 : 0;

  const [innerTab, setInnerTab] = useState<InnerTab>("registrations");
  const [stats, setStats] = useState<any>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [leagueStandings, setLeagueStandings] = useState<any[]>([]);
  const [standingsLoading, setStandingsLoading] = useState(false);
  const [campRegs, setCampRegs] = useState<any[]>([]);
  const [leagueRegsWl, setLeagueRegsWl] = useState<any[]>([]);
  const [tournamentRegsWl, setTournamentRegsWl] = useState<any[]>([]);
  const [guardianChildren, setGuardianChildren] = useState<any[]>([]);
  const [reEnrollSuggestions, setReEnrollSuggestions] = useState<any[]>([]);

  useEffect(() => {
    setAuthTokenGetter(() => getToken());
  }, [getToken]);

  const { data: profile } = useGetMyProfile();

  const {
    data: registrations,
    isLoading: regLoading,
    refetch: refetchReg,
  } = useListRegistrations({});

  const regs = registrations || [];
  const active = regs.filter((r) => r.status !== "cancelled");
  const upcoming = regs.filter((r) => r.status === "confirmed").slice(0, 3);
  const isNewUser = !regLoading && upcoming.length === 0;
  const heroReg = upcoming[0] ?? null;
  const leagueRegs = active.filter((r) => r.programType === RegistrationProgramType.league);

  useEffect(() => {
    async function loadWaitlists() {
      try {
        const token = await getToken();
        const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };
        const [campRes, leagueRes, tournamentRes] = await Promise.all([
          fetch(`${baseUrl}/api/me/camp-registrations`, { headers }),
          fetch(`${baseUrl}/api/me/league-registrations`, { headers }),
          fetch(`${baseUrl}/api/me/tournament-registrations`, { headers }),
        ]);
        if (campRes.ok) setCampRegs(await campRes.json());
        if (leagueRes.ok) setLeagueRegsWl((await leagueRes.json()).filter((r: any) => r.status === "waitlisted"));
        if (tournamentRes.ok) setTournamentRegsWl((await tournamentRes.json()).filter((r: any) => r.status === "waitlisted"));
      } catch {}
    }
    loadWaitlists();
  }, []);

  const waitlistedCamps = campRegs.filter((r) => r.status === "waitlisted");

  useEffect(() => {
    if (innerTab !== "stats") return;
    fetchStats();
    if (leagueRegs.length > 0) fetchStandings();
  }, [innerTab, leagueRegs.length]);

  useEffect(() => {
    async function loadFamilyAndReEnroll() {
      try {
        const token = await getToken();
        const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };
        const [childrenRes, reEnrollRes] = await Promise.all([
          fetch(`${baseUrl}/api/me/guardian-links`, { headers }),
          fetch(`${baseUrl}/api/registrations/re-enrollment`, { headers }),
        ]);
        if (childrenRes.ok) setGuardianChildren(await childrenRes.json());
        if (reEnrollRes.ok) setReEnrollSuggestions(await reEnrollRes.json());
      } catch {}
    }
    loadFamilyAndReEnroll();
  }, []);

  const fetchStats = async () => {
    setStatsLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${baseUrl}/api/player-stats/me`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (res.ok) setStats(await res.json());
    } catch {}
    setStatsLoading(false);
  };

  const fetchStandings = async () => {
    setStandingsLoading(true);
    const token = await getToken();
    const results: any[] = [];
    for (const reg of leagueRegs.slice(0, 2)) {
      try {
        const res = await fetch(`${baseUrl}/api/leagues/${reg.programId}/standings`, {
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        if (res.ok) results.push({ leagueId: reg.programId, standings: await res.json() });
      } catch {}
    }
    setLeagueStandings(results);
    setStandingsLoading(false);
  };

  const navigateToProgram = (reg: any) => {
    const { programType, programId } = reg;
    if (!programId || !programType) return;
    router.push({ pathname: "/program/[id]", params: { id: programId, type: programType } });
  };

  const typeLabel = (type: string) => {
    const map: Record<string, string> = { league: "League", camp: "Camp", drop_in: "Drop-in", tournament: "Tournament" };
    return map[type] || type;
  };

  const StatBox = ({ label, value }: { label: string; value: any }) => (
    <View style={[styles.statBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.statValue, { color: colors.foreground }]}>{value ?? "—"}</Text>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );

  const renderReg = ({ item }: { item: any }) => {
    const statusColor = STATUS_COLORS[item.status] || "#6B7280";
    return (
      <Pressable
        style={({ pressed }) => [
          styles.regCard,
          { backgroundColor: colors.card, borderColor: colors.border },
          pressed && { opacity: 0.8 },
        ]}
        onPress={() => navigateToProgram(item)}
      >
        <View style={[styles.typeTag, { backgroundColor: colors.primary + "20" }]}>
          <Text style={[styles.typeText, { color: colors.primary }]}>{typeLabel(item.programType)}</Text>
        </View>
        <View style={styles.regBody}>
          <Text style={[styles.regTitle, { color: colors.foreground }]}>
            {item.programName || `Registration #${item.id}`}
          </Text>
          <View style={styles.regMeta}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.regStatus, { color: statusColor }]}>{item.status?.replace("_", " ")}</Text>
          </View>
        </View>
        <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
      </Pressable>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Sticky header */}
      <View style={[styles.header, { paddingTop: insets.top + topPaddingWeb, backgroundColor: colors.background }]}>
        {/* Hero gradient bar */}
        <LinearGradient
          colors={[palette.teal900, palette.teal800]}
          style={styles.heroBar}
        >
          <View style={styles.heroRow}>
            <View>
              <Text style={styles.greeting}>
                {(() => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; })()}
              </Text>
              <Text style={styles.userName}>
                {user?.firstName || user?.emailAddresses?.[0]?.emailAddress?.split("@")[0] || "Player"}
              </Text>
            </View>
            <Pressable
              style={styles.exploreBtn}
              onPress={() => router.push("/(tabs)/explore")}
            >
              <Feather name="search" size={16} color={palette.neutral50} />
              <Text style={styles.exploreBtnText}>Explore</Text>
            </Pressable>
          </View>
        </LinearGradient>

        {/* Hero reg card (upcoming) */}
        {!regLoading && (isNewUser ? (
          <Pressable
            style={({ pressed }) => [
              styles.heroCard,
              { backgroundColor: colors.primary },
              pressed && { opacity: 0.9 },
            ]}
            onPress={() => router.push("/(tabs)/explore")}
          >
            <View style={styles.heroBadge}>
              <Feather name="search" size={13} color={palette.neutral50} />
              <Text style={styles.heroBadgeText}>Discover</Text>
            </View>
            <Text style={styles.heroTitle}>Find your next program</Text>
            <Text style={styles.heroSub}>Leagues, camps, drop-ins and tournaments</Text>
            <View style={styles.heroAction}>
              <Text style={styles.heroActionText}>Browse programs</Text>
              <Feather name="arrow-right" size={15} color={palette.neutral50} />
            </View>
          </Pressable>
        ) : heroReg ? (
          <Pressable
            style={({ pressed }) => [
              styles.heroCard,
              { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 },
              pressed && { opacity: 0.9 },
            ]}
            onPress={() => navigateToProgram(heroReg)}
          >
            <View style={[styles.heroBadge, { backgroundColor: colors.primary + "20" }]}>
              <Feather name="calendar" size={13} color={colors.primary} />
              <Text style={[styles.heroBadgeText, { color: colors.primary }]}>Upcoming</Text>
            </View>
            <Text style={[styles.heroTitle, { color: colors.foreground }]}>
              {heroReg.programName || "Your next session"}
            </Text>
            <Text style={[styles.heroSub, { color: colors.mutedForeground }]}>
              {typeLabel(heroReg.programType)} · {heroReg.status}
            </Text>
            <View style={styles.heroAction}>
              <Text style={[styles.heroActionText, { color: colors.primary }]}>View details</Text>
              <Feather name="chevron-right" size={15} color={colors.primary} />
            </View>
          </Pressable>
        ) : null)}

        {/* Inner tabs */}
        <View style={[styles.tabRow, { backgroundColor: colors.muted }]}>
          {(["registrations", "stats"] as InnerTab[]).map((tab) => (
            <Pressable
              key={tab}
              style={[styles.tabBtn, innerTab === tab && { backgroundColor: colors.card }]}
              onPress={() => setInnerTab(tab)}
            >
              <Text style={[styles.tabText, {
                color: innerTab === tab ? colors.foreground : colors.mutedForeground,
                fontFamily: innerTab === tab ? "Outfit_600SemiBold" : "Outfit_400Regular",
              }]}>
                {tab === "registrations" ? "Registrations" : "Stats & Standings"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Registrations tab */}
      {innerTab === "registrations" ? (
        regLoading ? (
          <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>
        ) : active.length === 0 ? (
          <View style={styles.center}>
            <Feather name="calendar" size={48} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No registrations yet</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Browse and sign up to see your schedule here</Text>
            <Pressable style={[styles.ctaBtn, { backgroundColor: colors.primary }]} onPress={() => router.push("/(tabs)/explore")}>
              <Text style={styles.ctaBtnText}>Browse Programs</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            data={active}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderReg}
            ListHeaderComponent={() => (
              <>
                {(waitlistedCamps.length > 0 || leagueRegsWl.length > 0 || tournamentRegsWl.length > 0) && (
                  <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>WAITLIST</Text>
                )}
                {[...waitlistedCamps.map((c: any) => ({ ...c, _type: "camp", _name: c.campName || `Camp #${c.campId}` })),
                  ...leagueRegsWl.map((l: any) => ({ ...l, _type: "league", _name: l.leagueName || `League #${l.leagueId}` })),
                  ...tournamentRegsWl.map((t: any) => ({ ...t, _type: "tournament", _name: t.tournamentName || `Tournament #${t.tournamentId}` })),
                ].map((item: any, i: number) => (
                  <View key={`wl-${i}`} style={[styles.regCard, { backgroundColor: colors.card, borderColor: "#F59E0B", borderLeftWidth: 4 }]}>
                    <View style={[styles.typeTag, { backgroundColor: "#F59E0B20" }]}>
                      <Text style={[styles.typeText, { color: "#F59E0B" }]}>{typeLabel(item._type)}</Text>
                    </View>
                    <View style={styles.regBody}>
                      <Text style={[styles.regTitle, { color: colors.foreground }]}>{item._name}</Text>
                      <View style={styles.regMeta}>
                        <View style={[styles.statusDot, { backgroundColor: "#F59E0B" }]} />
                        <Text style={[styles.regStatus, { color: "#F59E0B" }]}>Waitlisted{item.waitlistPosition != null ? ` #${item.waitlistPosition}` : ""}</Text>
                      </View>
                    </View>
                  </View>
                ))}
                {active.length > 0 && (
                  <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
                    {active.length} ACTIVE REGISTRATION{active.length !== 1 ? "S" : ""}
                  </Text>
                )}
              </>
            )}
            ListFooterComponent={() => (
              <View>
                {reEnrollSuggestions.length > 0 && (
                  <>
                    <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 16 }]}>RE-ENROLL</Text>
                    {reEnrollSuggestions.map((s: any, i: number) => (
                      <Pressable
                        key={`re-${i}`}
                        style={({ pressed }) => [
                          styles.regCard,
                          { backgroundColor: colors.card, borderColor: colors.border },
                          pressed && { opacity: 0.8 },
                        ]}
                        onPress={() => router.push({ pathname: "/program/[id]", params: { id: s.programId, type: s.programType } })}
                      >
                        <View style={[styles.typeTag, { backgroundColor: colors.primary + "20" }]}>
                          <Text style={[styles.typeText, { color: colors.primary }]}>{typeLabel(s.programType)}</Text>
                        </View>
                        <View style={styles.regBody}>
                          <Text style={[styles.regTitle, { color: colors.foreground }]}>{s.programName || "Re-enroll"}</Text>
                          <Text style={[styles.regStatus, { color: colors.mutedForeground, marginTop: 4 }]}>Available for re-enrollment</Text>
                        </View>
                        <Feather name="rotate-cw" size={16} color={colors.primary} />
                      </Pressable>
                    ))}
                  </>
                )}

                {guardianChildren.length > 0 && (
                  <>
                    <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 16 }]}>FAMILY</Text>
                    {guardianChildren.map((child: any, i: number) => (
                      <Pressable
                        key={`child-${i}`}
                        style={({ pressed }) => [
                          styles.regCard,
                          { backgroundColor: colors.card, borderColor: colors.border },
                          pressed && { opacity: 0.8 },
                        ]}
                        onPress={() => router.push({ pathname: "/family/child-detail", params: { youthUserId: child.youthUserId } })}
                      >
                        <View style={[styles.typeTag, { backgroundColor: colors.muted }]}>
                          <Feather name="user" size={13} color={colors.mutedForeground} />
                        </View>
                        <View style={styles.regBody}>
                          <Text style={[styles.regTitle, { color: colors.foreground }]}>
                            {`${child.youthFirstName || ""} ${child.youthLastName || ""}`.trim() || "Child"}
                          </Text>
                          <Text style={[styles.regStatus, { color: colors.mutedForeground, marginTop: 4 }]}>View registrations</Text>
                        </View>
                        <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                      </Pressable>
                    ))}
                  </>
                )}

                <Pressable
                  style={({ pressed }) => [
                    styles.assistantBtn,
                    { backgroundColor: colors.card, borderColor: colors.border },
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={() => router.push("/assistant")}
                >
                  <View style={[styles.assistantIcon, { backgroundColor: colors.primary + "20" }]}>
                    <Feather name="cpu" size={20} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.assistantTitle, { color: colors.foreground }]}>AI Assistant</Text>
                    <Text style={[styles.assistantSub, { color: colors.mutedForeground }]}>Ask questions about your schedule and registrations</Text>
                  </View>
                  <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                </Pressable>
              </View>
            )}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: Platform.OS === "web" ? 34 : 100 }}
            onRefresh={refetchReg}
            refreshing={regLoading}
            showsVerticalScrollIndicator={false}
          />
        )
      ) : (
        /* Stats tab */
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: Platform.OS === "web" ? 34 : 100 }} showsVerticalScrollIndicator={false}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>PERSONAL STATS</Text>
          {statsLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 20 }} />
          ) : stats ? (
            <View style={styles.statsGrid}>
              <StatBox label="Goals" value={stats.goals} />
              <StatBox label="Assists" value={stats.assists} />
              <StatBox label="Games Played" value={stats.gamesPlayed} />
              <StatBox label="Clean Sheets" value={stats.cleanSheets} />
            </View>
          ) : (
            <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="bar-chart-2" size={28} color={colors.mutedForeground} />
              <Text style={[styles.emptyCardText, { color: colors.mutedForeground }]}>Play some games to see your stats here</Text>
            </View>
          )}

          {leagueRegs.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 20 }]}>LEAGUE STANDINGS</Text>
              {standingsLoading ? (
                <ActivityIndicator color={colors.primary} style={{ marginVertical: 20 }} />
              ) : leagueStandings.length === 0 ? (
                <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.emptyCardText, { color: colors.mutedForeground }]}>Standings not yet available</Text>
                </View>
              ) : (
                leagueStandings.map((ls: any, idx: number) => (
                  <View key={idx} style={[styles.standingsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Text style={[styles.standingsTitle, { color: colors.foreground }]}>League #{ls.leagueId}</Text>
                    <View style={styles.standingsHeader}>
                      {["Team", "W", "D", "L", "Pts"].map((h) => (
                        <Text key={h} style={[styles.standingsHeaderText, { color: colors.mutedForeground, flex: h === "Team" ? 3 : 1 }]}>{h}</Text>
                      ))}
                    </View>
                    {(Array.isArray(ls.standings) ? ls.standings : ls.standings?.entries || []).slice(0, 8).map((row: any, rowIdx: number) => (
                      <View key={rowIdx} style={[styles.standingsRow, rowIdx % 2 === 0 && { backgroundColor: colors.accent }]}>
                        <View style={{ flex: 3, flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text style={[styles.standingsPos, { color: colors.mutedForeground }]}>{rowIdx + 1}</Text>
                          <Text style={[styles.standingsTeam, { color: colors.foreground }]} numberOfLines={1}>{row.teamName || row.name || `Team ${rowIdx + 1}`}</Text>
                        </View>
                        {["wins", "draws", "losses"].map((k) => (
                          <Text key={k} style={[styles.standingsStat, { color: colors.foreground, flex: 1 }]}>{row[k] ?? "—"}</Text>
                        ))}
                        <Text style={[styles.standingsStat, { color: colors.primary, flex: 1, fontFamily: "Outfit_700Bold" }]}>{row.points ?? "—"}</Text>
                      </View>
                    ))}
                  </View>
                ))
              )}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexShrink: 0 },
  heroBar: { paddingHorizontal: 20, paddingBottom: 16, paddingTop: 16 },
  heroRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  greeting: { color: palette.neutral500, fontSize: 13, fontFamily: "Outfit_400Regular" },
  userName: { color: palette.neutral100, fontSize: 20, fontFamily: "Outfit_700Bold", marginTop: 2 },
  exploreBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(255,255,255,0.15)", paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1, borderColor: "rgba(255,255,255,0.2)",
  },
  exploreBtnText: { color: palette.neutral50, fontSize: 13, fontFamily: "Outfit_600SemiBold" },

  heroCard: { marginHorizontal: 16, marginTop: 12, borderRadius: 14, padding: 16, gap: 5 },
  heroBadge: {
    flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start",
    paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.18)", marginBottom: 2,
  },
  heroBadgeText: { fontSize: 11, fontFamily: "Outfit_600SemiBold", color: palette.neutral50 },
  heroTitle: { fontSize: 18, fontFamily: "Outfit_700Bold", color: palette.neutral50 },
  heroSub: { fontSize: 12, fontFamily: "Outfit_400Regular", color: palette.neutral50 + "BB" },
  heroAction: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 6 },
  heroActionText: { fontSize: 13, fontFamily: "Outfit_600SemiBold", color: palette.neutral50 },

  tabRow: { flexDirection: "row", borderRadius: 10, padding: 3, margin: 16, marginTop: 12, marginBottom: 0 },
  tabBtn: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: 8 },
  tabText: { fontSize: 13 },

  sectionLabel: { fontSize: 12, fontFamily: "Outfit_600SemiBold", letterSpacing: 0.5, marginBottom: 10, marginTop: 4 },
  regCard: {
    flexDirection: "row", alignItems: "center", borderRadius: 14,
    padding: 14, marginBottom: 10, borderWidth: 1, gap: 10,
  },
  typeTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, alignSelf: "flex-start" },
  typeText: { fontSize: 11, fontFamily: "Outfit_600SemiBold" },
  regBody: { flex: 1 },
  regTitle: { fontSize: 15, fontFamily: "Outfit_600SemiBold" },
  regMeta: { flexDirection: "row", alignItems: "center", marginTop: 6, gap: 4 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  regStatus: { fontSize: 12, fontFamily: "Outfit_500Medium", textTransform: "capitalize" },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 20, fontFamily: "Outfit_700Bold", textAlign: "center" },
  emptyText: { fontSize: 14, fontFamily: "Outfit_400Regular", textAlign: "center", lineHeight: 20 },
  ctaBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, marginTop: 8 },
  ctaBtnText: { color: palette.neutral50, fontSize: 15, fontFamily: "Outfit_600SemiBold" },

  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 8 },
  statBox: { flex: 1, minWidth: "44%", borderRadius: 12, padding: 16, alignItems: "center", borderWidth: 1 },
  statValue: { fontSize: 28, fontFamily: "Outfit_700Bold" },
  statLabel: { fontSize: 12, fontFamily: "Outfit_500Medium", marginTop: 4 },
  emptyCard: { borderRadius: 12, borderWidth: 1, padding: 20, alignItems: "center", gap: 10 },
  emptyCardText: { fontSize: 14, fontFamily: "Outfit_400Regular", textAlign: "center" },

  standingsCard: { borderRadius: 14, borderWidth: 1, overflow: "hidden", marginBottom: 12 },
  standingsTitle: { fontSize: 15, fontFamily: "Outfit_700Bold", padding: 12, paddingBottom: 6 },
  standingsHeader: { flexDirection: "row", paddingHorizontal: 12, paddingVertical: 6 },
  standingsHeaderText: { fontSize: 11, fontFamily: "Outfit_600SemiBold", textAlign: "center" },
  standingsRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8 },
  standingsPos: { fontSize: 12, fontFamily: "Outfit_400Regular", width: 16 },
  standingsTeam: { fontSize: 13, fontFamily: "Outfit_500Medium" },
  standingsStat: { fontSize: 13, textAlign: "center" },

  assistantBtn: {
    flexDirection: "row", alignItems: "center", borderRadius: 14,
    padding: 14, marginTop: 16, marginBottom: 10, borderWidth: 1, gap: 12,
  },
  assistantIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  assistantTitle: { fontSize: 15, fontFamily: "Outfit_600SemiBold" },
  assistantSub: { fontSize: 12, fontFamily: "Outfit_400Regular", marginTop: 2 },
});
