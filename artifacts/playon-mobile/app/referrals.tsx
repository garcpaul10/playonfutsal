import { palette } from "@workspace/brand";
import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

function fmt(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function ReferralsScreen() {
  const { getToken } = useAuth();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  const baseUrl = domain ? `https://${domain}` : "";

  useEffect(() => {
    loadReferrals();
  }, []);

  const loadReferrals = async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${baseUrl}/api/referrals/my`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) setData(await res.json());
    } catch {}
    setLoading(false);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const token = await getToken();
      const res = await fetch(`${baseUrl}/api/referrals/generate`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) await loadReferrals();
      else Alert.alert("Error", "Could not generate referral link.");
    } catch {
      Alert.alert("Error", "Network error. Please try again.");
    }
    setGenerating(false);
  };

  const handleShare = async () => {
    if (!data?.link) return;
    try {
      await Share.share({
        message: `Join me on PlayOn! Sign up using my referral link: ${data.link}`,
        url: data.link,
      });
    } catch {}
  };

  const handleCopy = () => {
    if (!data?.link) return;
    Alert.alert("Referral link", data.link, [{ text: "OK" }]);
  };

  const reward = data?.rewardCreditCents ?? 1000;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: Platform.OS === "web" ? 34 : 100 }}
      showsVerticalScrollIndicator={false}
    >
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) + 16, backgroundColor: colors.background },
        ]}
      >
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.pageTitle, { color: colors.foreground }]}>Refer &amp; Earn</Text>
      </View>

      <View style={styles.hero}>
        <View style={[styles.giftCircle, { backgroundColor: colors.primary + "20", borderColor: colors.primary + "40" }]}>
          <Feather name="gift" size={32} color={colors.primary} />
        </View>
        <Text style={[styles.heroTitle, { color: colors.foreground }]}>Refer &amp; Earn</Text>
        <Text style={[styles.heroSub, { color: colors.mutedForeground }]}>
          Share PlayOn with friends. Earn{" "}
          <Text style={{ color: colors.foreground, fontFamily: "Outfit_600SemiBold" }}>{fmt(reward)}</Text>{" "}
          in account credit for each friend who signs up.
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : data?.isEnabled === false ? (
        <View style={[styles.pausedCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="pause-circle" size={28} color={colors.mutedForeground} />
          <Text style={[styles.pausedText, { color: colors.mutedForeground }]}>
            The referral program is currently paused. Check back soon!
          </Text>
        </View>
      ) : (
        <>
          <View style={[styles.linkCard, { backgroundColor: colors.card, borderColor: colors.primary + "40" }]}>
            <Text style={[styles.linkCardTitle, { color: colors.foreground }]}>Your Referral Link</Text>
            {data?.link ? (
              <>
                <View style={[styles.linkBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <Text style={[styles.linkText, { color: colors.foreground }]} numberOfLines={1}>
                    {data.link}
                  </Text>
                </View>
                <View style={styles.linkActions}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.actionBtn,
                      { backgroundColor: colors.primary },
                      pressed && { opacity: 0.8 },
                    ]}
                    onPress={handleShare}
                  >
                    <Feather name="share-2" size={16} color={palette.neutral50} />
                    <Text style={styles.actionBtnText}>Share</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [
                      styles.actionBtnOutline,
                      { borderColor: colors.border, backgroundColor: colors.background },
                      pressed && { opacity: 0.8 },
                    ]}
                    onPress={handleCopy}
                  >
                    <Feather name="copy" size={16} color={colors.foreground} />
                    <Text style={[styles.actionBtnOutlineText, { color: colors.foreground }]}>Copy</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <View style={styles.generateBlock}>
                <Text style={[styles.noLinkText, { color: colors.mutedForeground }]}>
                  You don't have a referral link yet.
                </Text>
                <Pressable
                  style={({ pressed }) => [
                    styles.actionBtn,
                    { backgroundColor: colors.primary },
                    pressed && { opacity: 0.8 },
                    generating && { opacity: 0.5 },
                  ]}
                  onPress={handleGenerate}
                  disabled={generating}
                >
                  {generating ? (
                    <ActivityIndicator color={palette.neutral50} size="small" />
                  ) : (
                    <>
                      <Feather name="link" size={16} color={palette.neutral50} />
                      <Text style={styles.actionBtnText}>Generate My Link</Text>
                    </>
                  )}
                </Pressable>
              </View>
            )}
          </View>

          <View style={styles.statsRow}>
            {[
              { label: "Links Shared", value: data?.referrals?.length ?? 0, color: colors.foreground },
              { label: "Completed", value: data?.completedCount ?? 0, color: "#22C55E" },
              {
                label: "Credits Earned",
                value: fmt((data?.completedCount ?? 0) * reward),
                color: colors.primary,
              },
            ].map((s) => (
              <View key={s.label} style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
              </View>
            ))}
          </View>

          <View style={[styles.historyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.historyHeader}>
              <Feather name="users" size={16} color={colors.foreground} />
              <Text style={[styles.historyTitle, { color: colors.foreground }]}>Referral History</Text>
            </View>
            {!data?.referrals?.length ? (
              <Text style={[styles.historyEmpty, { color: colors.mutedForeground }]}>
                No referrals yet. Share your link to get started!
              </Text>
            ) : (
              data.referrals.map((r: any) => (
                <View key={r.id} style={[styles.historyRow, { borderBottomColor: colors.border }]}>
                  <View style={[styles.codeChip, { backgroundColor: colors.accent }]}>
                    <Text style={[styles.codeText, { color: colors.foreground }]}>{r.code}</Text>
                  </View>
                  <Feather
                    name={r.status === "completed" ? "check-circle" : "clock"}
                    size={14}
                    color={r.status === "completed" ? "#22C55E" : colors.mutedForeground}
                  />
                  <Text style={[styles.historyDate, { color: colors.mutedForeground }]}>
                    {new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </Text>
                  {r.status === "completed" && (
                    <Text style={styles.creditEarned}>+{fmt(r.rewardCreditCents)}</Text>
                  )}
                </View>
              ))
            )}
          </View>

          <View style={[styles.howCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.howTitle, { color: colors.foreground }]}>How it works</Text>
            {[
              "Generate your unique referral link above.",
              "Share it with friends, teammates, or anyone interested in futsal.",
              `When they sign up and claim your code, you receive ${fmt(reward)} in account credit.`,
              "Credits apply automatically toward your next registration.",
            ].map((step, i) => (
              <View key={i} style={styles.howRow}>
                <Text style={[styles.howNum, { color: colors.primary }]}>{i + 1}.</Text>
                <Text style={[styles.howText, { color: colors.mutedForeground }]}>{step}</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
  },
  backBtn: { padding: 4 },
  pageTitle: { fontSize: 22, fontFamily: "Outfit_700Bold" },
  hero: { alignItems: "center", paddingHorizontal: 24, paddingTop: 20, paddingBottom: 24 },
  giftCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  heroTitle: { fontSize: 26, fontFamily: "Outfit_700Bold", textAlign: "center", marginBottom: 8 },
  heroSub: { fontSize: 14, fontFamily: "Outfit_400Regular", textAlign: "center", lineHeight: 20 },
  pausedCard: {
    marginHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    padding: 32,
    alignItems: "center",
    gap: 12,
  },
  pausedText: { fontSize: 14, fontFamily: "Outfit_400Regular", textAlign: "center" },
  linkCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  linkCardTitle: { fontSize: 16, fontFamily: "Outfit_700Bold", marginBottom: 12 },
  linkBox: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  linkText: { fontSize: 13, fontFamily: "Outfit_400Regular" },
  linkActions: { flexDirection: "row", gap: 10 },
  generateBlock: { gap: 12 },
  noLinkText: { fontSize: 13, fontFamily: "Outfit_400Regular" },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
  },
  actionBtnText: { color: palette.neutral50, fontSize: 14, fontFamily: "Outfit_600SemiBold" },
  actionBtnOutline: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  actionBtnOutlineText: { fontSize: 14, fontFamily: "Outfit_600SemiBold" },
  statsRow: { flexDirection: "row", paddingHorizontal: 16, gap: 10, marginBottom: 16 },
  statCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    alignItems: "center",
  },
  statValue: { fontSize: 20, fontFamily: "Outfit_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Outfit_400Regular", marginTop: 4, textAlign: "center" },
  historyCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  historyHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  historyTitle: { fontSize: 16, fontFamily: "Outfit_700Bold" },
  historyEmpty: { fontSize: 13, fontFamily: "Outfit_400Regular", textAlign: "center", paddingVertical: 16 },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  codeChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  codeText: { fontSize: 11, fontFamily: "Outfit_600SemiBold" },
  historyDate: { flex: 1, fontSize: 12, fontFamily: "Outfit_400Regular" },
  creditEarned: { fontSize: 13, fontFamily: "Outfit_600SemiBold", color: "#22C55E" },
  howCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  howTitle: { fontSize: 16, fontFamily: "Outfit_700Bold", marginBottom: 12 },
  howRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  howNum: { fontSize: 13, fontFamily: "Outfit_700Bold", minWidth: 16 },
  howText: { flex: 1, fontSize: 13, fontFamily: "Outfit_400Regular", lineHeight: 18 },
});
