import { palette, AGE_GROUPS } from "@workspace/brand";
import { useAuth } from "@clerk/expo";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { useListPrograms } from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { ProgramCard } from "@/components/ProgramCard";

type ProgramType = "all" | "league" | "camp" | "drop_in" | "tournament";

const FILTERS: { label: string; value: ProgramType; icon: string }[] = [
  { label: "All", value: "all", icon: "grid" },
  { label: "Leagues", value: "league", icon: "list" },
  { label: "Camps", value: "camp", icon: "sun" },
  { label: "Drop-ins", value: "drop_in", icon: "zap" },
  { label: "Tournaments", value: "tournament", icon: "award" },
];

const AGE_FILTERS = [
  { value: "all", label: "All Ages" },
  ...AGE_GROUPS,
];

export default function ExploreScreen() {
  const { getToken } = useAuth();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ type?: string }>();

  const [activeFilter, setActiveFilter] = useState<ProgramType>(
    (params.type as ProgramType) || "all"
  );
  const [ageFilter, setAgeFilter] = useState("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    setAuthTokenGetter(() => getToken());
  }, [getToken]);

  const { data: programs, isLoading, refetch } = useListPrograms(
    activeFilter !== "all" ? { type: activeFilter, mobile: true } : { mobile: true }
  );

  const filtered = (programs || []).filter((p: any) => {
    if (ageFilter !== "all") {
      const groups: string[] = Array.isArray(p.ageGroup)
        ? p.ageGroup
        : p.ageGroup
        ? [String(p.ageGroup)]
        : [];
      if (!groups.includes(ageFilter)) return false;
    }
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (p.name || "").toLowerCase().includes(q) ||
      (p.description || "").toLowerCase().includes(q) ||
      (Array.isArray(p.ageGroup) ? p.ageGroup.join(" ") : p.ageGroup || "").toLowerCase().includes(q)
    );
  });

  const topPaddingWeb = Platform.OS === "web" ? 67 : 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          { backgroundColor: colors.background, paddingTop: insets.top + topPaddingWeb + 12 },
        ]}
      >
        <Text style={[styles.title, { color: colors.foreground }]}>Explore</Text>
        <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="search" size={16} color={colors.mutedForeground} style={{ marginRight: 8 }} />
          <TextInput
            style={[styles.searchInput, { color: colors.foreground }]}
            value={search}
            onChangeText={setSearch}
            placeholder="Search programs..."
            placeholderTextColor={colors.mutedForeground}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")}>
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Program-type filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        style={{ flexGrow: 0 }}
      >
        {FILTERS.map((f) => (
          <Pressable
            key={f.value}
            style={[
              styles.chip,
              {
                backgroundColor: activeFilter === f.value ? colors.primary : colors.card,
                borderColor: activeFilter === f.value ? colors.primary : colors.border,
              },
            ]}
            onPress={() => setActiveFilter(f.value)}
          >
            <Feather
              name={f.icon as any}
              size={13}
              color={activeFilter === f.value ? palette.neutral50 : colors.mutedForeground}
            />
            <Text
              style={[
                styles.chipText,
                { color: activeFilter === f.value ? palette.neutral50 : colors.foreground },
              ]}
            >
              {f.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Age-group filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.chips, { paddingTop: 0 }]}
        style={{ flexGrow: 0 }}
      >
        {AGE_FILTERS.map((f) => (
          <Pressable
            key={f.value}
            style={[
              styles.ageChip,
              {
                backgroundColor: ageFilter === f.value ? colors.primary : colors.card,
                borderColor: ageFilter === f.value ? colors.primary : colors.border,
              },
            ]}
            onPress={() => setAgeFilter(f.value)}
          >
            <Text
              style={[
                styles.chipText,
                { color: ageFilter === f.value ? palette.neutral50 : colors.mutedForeground },
              ]}
            >
              {f.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Results */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <Feather name="inbox" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No programs found</Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            {search ? "Try a different search" : ageFilter !== "all" ? "No programs for this age group yet" : "Check back soon for new offerings"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item: any) => `${item.type}-${item.id}`}
          renderItem={({ item }) => (
            <ProgramCard
              program={item}
              onPress={() =>
                router.push({ pathname: "/program/[id]", params: { id: item.id, type: item.type } })
              }
            />
          )}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 8,
            paddingBottom: Platform.OS === "web" ? 34 : 100,
          }}
          onRefresh={refetch}
          refreshing={isLoading}
          showsVerticalScrollIndicator={false}
          scrollEnabled={filtered.length > 0}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 0 },
  title: { fontSize: 28, fontFamily: "Outfit_700Bold", marginBottom: 12 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Outfit_400Regular" },
  chips: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    gap: 5,
  },
  ageChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: { fontSize: 13, fontFamily: "Outfit_500Medium" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  emptyTitle: { fontSize: 18, fontFamily: "Outfit_600SemiBold" },
  emptyText: { fontSize: 14, fontFamily: "Outfit_400Regular", textAlign: "center", paddingHorizontal: 32 },
});
