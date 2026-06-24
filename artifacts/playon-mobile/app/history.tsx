import { useAuth } from "@clerk/expo";
import { useGetMyProfile } from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState, useCallback } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

const domain = process.env.EXPO_PUBLIC_DOMAIN;
const baseUrl = domain ? `https://${domain}` : "";

type HistoryItem = {
  id: string;
  type: "league" | "camp" | "tournament" | "dropin";
  eventId: number;
  eventName: string | null;
  startDate: string | null;
  endDate: string | null;
  venueName: string | null;
  teamId: number | null;
  teamName: string | null;
  status: string;
  paymentStatus: string;
  createdAt: string;
};

type ChildOption = { youthUserId: number; name: string };

const TYPE_LABEL: Record<string, string> = {
  league: "League",
  camp: "Camp",
  tournament: "Tournament",
  dropin: "Drop-In",
};

const TYPE_ICON: Record<string, string> = {
  league: "shield",
  camp: "sun",
  tournament: "award",
  dropin: "zap",
};

function statusColor(status: string) {
  if (status === "cancelled") return "#EF4444";
  if (status === "confirmed" || status === "active") return "#22C55E";
  return "#6B7280";
}

function paymentColor(ps: string) {
  if (ps === "paid_inapp" || ps === "paid_external") return "#22C55E";
  if (ps === "refunded") return "#EF4444";
  return "#6B7280";
}

function formatDate(d: string | null) {
  if (!d) return null;
  const dt = new Date(d);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getYear(item: HistoryItem) {
  const d = item.startDate || item.createdAt;
  return new Date(d).getFullYear().toString();
}

export default function HistoryScreen() {
  const { getToken } = useAuth();
  const { data: profile } = useGetMyProfile();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topPaddingWeb = Platform.OS === "web" ? 67 : 0;

  const isParent = (profile as any)?.roles?.includes("parent") ?? false;

  const [children, setChildren] = useState<ChildOption[]>([]);
  const [selectedYouthId, setSelectedYouthId] = useState<number | null>(null);

  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const LIMIT = 20;

  useEffect(() => {
    if (!isParent) return;
    getToken().then((token) => {
      fetch(`${baseUrl}/api/family/dashboard`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.children) {
            setChildren(
              data.children.map((c: any) => ({
                youthUserId: c.youthUserId,
                name: [c.firstName, c.lastName].filter(Boolean).join(" ") || "Child",
              }))
            );
          }
        })
        .catch(() => {});
    });
  }, [isParent]);

  const loadHistory = useCallback(
    async (pageNum: number, youthId: number | null, reset: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const token = await getToken();
        const params = new URLSearchParams({ page: String(pageNum), limit: String(LIMIT) });
        if (youthId != null) params.set("youthUserId", String(youthId));
        const res = await fetch(`${baseUrl}/api/me/registration-history?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("Failed to load history");
        const data = await res.json();
        setTotal(data.total);
        setItems((prev) => (reset ? data.items : [...prev, ...data.items]));
        setPage(pageNum);
      } catch (e: any) {
        setError(e.message ?? "Something went wrong");
      } finally {
        setLoading(false);
      }
    },
    [getToken]
  );

  useEffect(() => {
    loadHistory(1, selectedYouthId, true);
  }, [selectedYouthId]);

  const switchPlayer = (youthId: number | null) => {
    if (youthId === selectedYouthId) return;
    setSelectedYouthId(youthId);
    setItems([]);
    setPage(1);
  };

  const loadMore = () => {
    if (loading || items.length >= total) return;
    loadHistory(page + 1, selectedYouthId, false);
  };

  // Group items by year
  type Group = { year: string; data: HistoryItem[] };
  const grouped: Group[] = [];
  for (const item of items) {
    const year = getYear(item);
    const existing = grouped.find((g) => g.year === year);
    if (existing) existing.data.push(item);
    else grouped.push({ year, data: [item] });
  }

  const renderItem = ({ item }: { item: HistoryItem }) => (
    <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.typeIcon, { backgroundColor: colors.accent }]}>
        <Feather name={TYPE_ICON[item.type] as any} size={16} color={colors.primary} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={styles.rowTop}>
          <Text style={[styles.eventName, { color: colors.foreground }]} numberOfLines={1}>
            {item.eventName ?? "—"}
          </Text>
          <Text style={[styles.typeLabel, { color: colors.primary, backgroundColor: colors.primary + "18" }]}>
            {TYPE_LABEL[item.type]}
          </Text>
        </View>
        {item.teamName && (
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>
            <Feather name="users" size={11} /> {item.teamName}
          </Text>
        )}
        <View style={styles.metaRow}>
          {item.startDate && (
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>
              {formatDate(item.startDate)}
              {item.endDate && item.endDate !== item.startDate ? ` – ${formatDate(item.endDate)}` : ""}
            </Text>
          )}
          {item.venueName && (
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>· {item.venueName}</Text>
          )}
        </View>
        <View style={styles.badgeRow}>
          <View style={[styles.badge, { backgroundColor: statusColor(item.status) + "20" }]}>
            <Text style={[styles.badgeText, { color: statusColor(item.status) }]}>{item.status}</Text>
          </View>
          <View style={[styles.badge, { backgroundColor: paymentColor(item.paymentStatus) + "20" }]}>
            <Text style={[styles.badgeText, { color: paymentColor(item.paymentStatus) }]}>
              {item.paymentStatus.replace("_", " ")}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + topPaddingWeb + 16, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="chevron-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>History</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Player switcher (parents) */}
      {(isParent && children.length > 0) && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.switcherRow}>
          <Pressable
            onPress={() => switchPlayer(null)}
            style={[styles.chip, selectedYouthId === null
              ? { backgroundColor: colors.primary }
              : { backgroundColor: colors.muted, borderColor: colors.border, borderWidth: 1 }]}
          >
            <Text style={[styles.chipText, { color: selectedYouthId === null ? "#fff" : colors.foreground }]}>Me</Text>
          </Pressable>
          {children.map((c) => (
            <Pressable
              key={c.youthUserId}
              onPress={() => switchPlayer(c.youthUserId)}
              style={[styles.chip, selectedYouthId === c.youthUserId
                ? { backgroundColor: colors.primary }
                : { backgroundColor: colors.muted, borderColor: colors.border, borderWidth: 1 }]}
            >
              <Text style={[styles.chipText, { color: selectedYouthId === c.youthUserId ? "#fff" : colors.foreground }]}>
                {c.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* Content */}
      {loading && items.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Feather name="alert-circle" size={32} color={colors.destructive} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground, marginTop: 8 }]}>{error}</Text>
          <Pressable onPress={() => loadHistory(1, selectedYouthId, true)} style={[styles.retryBtn, { backgroundColor: colors.primary }]}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : grouped.length === 0 ? (
        <View style={styles.centered}>
          <Feather name="clock" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No history yet</Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Past events will appear here once they've ended.
          </Text>
        </View>
      ) : (
        <FlatList
          data={grouped}
          keyExtractor={(g) => g.year}
          contentContainerStyle={{ padding: 16, paddingBottom: Platform.OS === "web" ? 34 : 100 }}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            loading ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} /> : null
          }
          renderItem={({ item: group }) => (
            <View style={{ marginBottom: 20 }}>
              <Text style={[styles.yearLabel, { color: colors.mutedForeground }]}>{group.year}</Text>
              {group.data.map((item) => (
                <View key={item.id} style={{ marginBottom: 8 }}>
                  {renderItem({ item })}
                </View>
              ))}
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  backBtn: { width: 40, alignItems: "flex-start" },
  title: { fontSize: 20, fontFamily: "Outfit_700Bold" },

  switcherRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  chip: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20 },
  chipText: { fontSize: 13, fontFamily: "Outfit_600SemiBold" },

  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 8 },
  emptyTitle: { fontSize: 17, fontFamily: "Outfit_700Bold", marginTop: 8 },
  emptyText: { fontSize: 14, fontFamily: "Outfit_400Regular", textAlign: "center" },
  retryBtn: { marginTop: 12, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  retryText: { color: "#fff", fontSize: 14, fontFamily: "Outfit_600SemiBold" },

  yearLabel: { fontSize: 12, fontFamily: "Outfit_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 },

  row: { flexDirection: "row", gap: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  typeIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", marginTop: 2 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  eventName: { fontSize: 14, fontFamily: "Outfit_600SemiBold", flex: 1 },
  typeLabel: { fontSize: 10, fontFamily: "Outfit_600SemiBold", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  meta: { fontSize: 12, fontFamily: "Outfit_400Regular" },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  badgeRow: { flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: 2 },
  badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  badgeText: { fontSize: 11, fontFamily: "Outfit_500Medium" },
});
