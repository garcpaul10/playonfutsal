import { Feather } from "@expo/vector-icons";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

type Program = {
  id: number;
  type?: string;
  name?: string;
  title?: string;
  description?: string;
  ageGroup?: string;
  gender?: string;
  status?: string;
  priceInCents?: number;
  priceCents?: number;
  spotPriceInCents?: number;
  startDate?: string;
  sessionDate?: string;
  spotsAvailable?: number;
  spotsTotal?: number;
  imageUrl?: string | null;
};

const TYPE_ICONS: Record<string, string> = {
  league: "list",
  camp: "sun",
  drop_in: "zap",
  tournament: "award",
};

const TYPE_LABELS: Record<string, string> = {
  league: "League",
  camp: "Camp",
  drop_in: "Drop-in",
  tournament: "Tournament",
};

const TYPE_TINT: Record<string, string> = {
  league: "#3a0a0a",
  camp: "#0a1a2e",
  drop_in: "#0a1a0e",
  tournament: "#2a1a02",
};

const STATUS_COLORS: Record<string, string> = {
  upcoming: "#22C55E",
  active: "#3B82F6",
  completed: "#6B7280",
  cancelled: "#EF4444",
};

function formatDate(d?: string | null) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return d;
  }
}

function formatPrice(cents?: number | null) {
  if (!cents && cents !== 0) return null;
  return `$${(cents / 100).toFixed(0)}`;
}

type Props = {
  program: Program;
  onPress: () => void;
};

export function ProgramCard({ program, onPress }: Props) {
  const colors = useColors();
  const type = program.type || "";
  const icon = TYPE_ICONS[type] || "calendar";
  const typeLabel = TYPE_LABELS[type] || type;
  const name = program.name || program.title || `${typeLabel} #${program.id}`;
  const price = program.priceInCents || program.priceCents || program.spotPriceInCents;
  const date = program.startDate || program.sessionDate;
  const statusColor = STATUS_COLORS[program.status || ""] || colors.mutedForeground;
  const tint = TYPE_TINT[type] || "#111118";

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
        pressed && { opacity: 0.8 },
      ]}
      onPress={onPress}
    >
      {program.imageUrl ? (
        <View style={styles.iconBox}>
          <Image
            source={{ uri: program.imageUrl }}
            style={StyleSheet.absoluteFillObject}
            resizeMode="cover"
          />
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: tint, opacity: 0.65 }]} />
          <Feather name={icon as any} size={20} color="#ffffff" style={{ opacity: 0.85 }} />
        </View>
      ) : (
        <View style={[styles.iconBox, { backgroundColor: colors.primary + "18" }]}>
          <Feather name={icon as any} size={22} color={colors.primary} />
        </View>
      )}

      <View style={styles.body}>
        <View style={styles.topRow}>
          <View style={[styles.typeChip, { backgroundColor: colors.accent }]}>
            <Text style={[styles.typeText, { color: colors.mutedForeground }]}>{typeLabel}</Text>
          </View>
          {program.status && (
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          )}
        </View>

        <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={2}>
          {name}
        </Text>

        <View style={styles.metaRow}>
          {program.ageGroup && (
            <View style={[styles.metaChip, { backgroundColor: colors.muted }]}>
              <Text style={[styles.metaChipText, { color: colors.mutedForeground }]}>
                {Array.isArray(program.ageGroup)
                  ? (program.ageGroup as string[]).includes("all_ages")
                    ? "All Ages"
                    : (program.ageGroup as string[]).join(" · ")
                  : program.ageGroup === "all_ages"
                  ? "All Ages"
                  : program.ageGroup}
              </Text>
            </View>
          )}
          {program.gender && (
            <View style={[styles.metaChip, { backgroundColor: "#3b1d5c" }]}>
              <Text style={[styles.metaChipText, { color: "#c4b5fd" }]}>
                {program.gender.charAt(0).toUpperCase() + program.gender.slice(1)}
              </Text>
            </View>
          )}
          {date && (
            <Text style={[styles.date, { color: colors.mutedForeground }]}>
              {formatDate(date)}
            </Text>
          )}
          {price != null && (
            <Text style={[styles.price, { color: colors.foreground }]}>
              {formatPrice(price)}
            </Text>
          )}
        </View>

        {program.spotsTotal != null && (
          <View style={styles.capacityRow}>
            {program.spotsAvailable === 0 ? (
              <View style={styles.fullBadge}>
                <Text style={styles.fullBadgeText}>Full</Text>
              </View>
            ) : (
              <>
                <Feather name="users" size={11} color={
                  (program.spotsAvailable ?? 0) <= Math.ceil((program.spotsTotal ?? 1) * 0.3)
                    ? "#F59E0B"
                    : colors.mutedForeground
                } />
                <Text style={[
                  styles.spotsText,
                  {
                    color: (program.spotsAvailable ?? 0) <= Math.ceil((program.spotsTotal ?? 1) * 0.3)
                      ? "#F59E0B"
                      : colors.mutedForeground,
                  },
                ]}>
                  {program.spotsTotal - (program.spotsAvailable ?? 0)} / {program.spotsTotal} filled
                </Text>
              </>
            )}
          </View>
        )}
      </View>

      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    gap: 12,
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  body: { flex: 1 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  typeChip: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  typeText: { fontSize: 11, fontFamily: "Outfit_500Medium" },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  name: { fontSize: 15, fontFamily: "Outfit_600SemiBold", lineHeight: 20 },
  metaRow: { flexDirection: "row", alignItems: "center", marginTop: 5, gap: 8, flexWrap: "wrap" },
  metaChip: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  metaChipText: { fontSize: 11, fontFamily: "Outfit_400Regular" },
  date: { fontSize: 12, fontFamily: "Outfit_400Regular" },
  price: { fontSize: 14, fontFamily: "Outfit_700Bold", marginLeft: "auto" },
  capacityRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
    gap: 5,
  },
  spotsText: { fontSize: 11, fontFamily: "Outfit_400Regular" },
  fullBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: "#EF444420",
    borderWidth: 1,
    borderColor: "#EF444440",
  },
  fullBadgeText: {
    fontSize: 11,
    fontFamily: "Outfit_600SemiBold",
    color: "#EF4444",
  },
});
