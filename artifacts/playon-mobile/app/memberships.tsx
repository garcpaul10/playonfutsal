import { palette } from "@workspace/brand";
import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

export default function MembershipsScreen() {
  const { getToken } = useAuth();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [plans, setPlans] = useState<any[]>([]);
  const [myMembership, setMyMembership] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState<number | null>(null);

  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  const baseUrl = domain ? `https://${domain}` : "";

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const headers: Record<string, string> = token
        ? { Authorization: `Bearer ${token}` }
        : {};

      const [plansRes, membershipRes] = await Promise.all([
        fetch(`${baseUrl}/api/membership-plans`),
        fetch(`${baseUrl}/api/memberships/my`, { headers }),
      ]);

      if (plansRes.ok) setPlans(await plansRes.json());
      if (membershipRes.ok) setMyMembership(await membershipRes.json());
    } catch {}
    setLoading(false);
  };

  const handleSubscribe = async (planId: number) => {
    setSubscribing(planId);
    try {
      const token = await getToken();
      const res = await fetch(`${baseUrl}/api/memberships/subscribe`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          planId,
          successUrl: `${baseUrl}/profile?membership=success`,
          cancelUrl: `${baseUrl}/memberships`,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.checkoutUrl) {
          await WebBrowser.openBrowserAsync(data.checkoutUrl);
          loadData();
        }
      }
    } catch {}
    setSubscribing(null);
  };

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
        <Text style={[styles.pageTitle, { color: colors.foreground }]}>Membership</Text>
      </View>

      <View style={styles.hero}>
        <View style={[styles.crownCircle, { backgroundColor: "#F59E0B20", borderColor: "#F59E0B40" }]}>
          <Feather name="star" size={32} color="#F59E0B" />
        </View>
        <Text style={[styles.heroTitle, { color: colors.foreground }]}>PlayOn Membership</Text>
        <Text style={[styles.heroSub, { color: colors.mutedForeground }]}>
          Unlock exclusive pricing on leagues, drop-ins, camps, and more.
        </Text>
      </View>

      {myMembership && (
        <View style={[styles.activeBanner, { backgroundColor: "#F59E0B18", borderColor: "#F59E0B40" }]}>
          <Feather name="star" size={16} color="#F59E0B" />
          <Text style={styles.activeBannerText}>
            Active {myMembership.plan?.name ?? "membership"} — renews automatically
          </Text>
        </View>
      )}

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : plans.length === 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="inbox" size={28} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            No membership plans available yet. Check back soon!
          </Text>
        </View>
      ) : (
        <View style={styles.plansContainer}>
          {plans.map((plan: any, i: number) => {
            const isCurrent = myMembership?.planId === plan.id;
            const isPopular = i === 0 && plans.length > 1;
            return (
              <View
                key={plan.id}
                style={[
                  styles.planCard,
                  {
                    backgroundColor: colors.card,
                    borderColor: isCurrent ? "#F59E0B" : isPopular ? colors.primary : colors.border,
                  },
                ]}
              >
                {isPopular && !isCurrent && (
                  <View style={[styles.badge, { backgroundColor: colors.primary }]}>
                    <Text style={styles.badgeText}>Most Popular</Text>
                  </View>
                )}
                {isCurrent && (
                  <View style={[styles.badge, { backgroundColor: "#F59E0B" }]}>
                    <Feather name="check" size={11} color="#fff" />
                    <Text style={styles.badgeText}>Your Plan</Text>
                  </View>
                )}

                <View style={styles.planHeader}>
                  <View>
                    <Text style={[styles.planName, { color: colors.foreground }]}>{plan.name}</Text>
                    {plan.description && (
                      <Text style={[styles.planDesc, { color: colors.mutedForeground }]}>
                        {plan.description}
                      </Text>
                    )}
                  </View>
                  <View style={styles.priceBlock}>
                    <Text style={[styles.planPrice, { color: colors.foreground }]}>
                      ${Number(plan.price).toFixed(2)}
                    </Text>
                    <Text style={[styles.planCycle, { color: colors.mutedForeground }]}>
                      /{plan.billingCycle}
                    </Text>
                  </View>
                </View>

                {plan.features?.length > 0 && (
                  <View style={styles.featureList}>
                    {plan.features.map((f: string, fi: number) => (
                      <View key={fi} style={styles.featureRow}>
                        <Feather name="check-circle" size={14} color="#22C55E" />
                        <Text style={[styles.featureText, { color: colors.foreground }]}>{f}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {plan.trialDays > 0 && (
                  <Text style={[styles.trialNote, { color: colors.mutedForeground }]}>
                    Includes a {plan.trialDays}-day free trial
                  </Text>
                )}

                {isCurrent ? (
                  <View style={[styles.planBtnDisabled, { backgroundColor: colors.muted }]}>
                    <Text style={[styles.planBtnText, { color: colors.mutedForeground }]}>Current Plan</Text>
                  </View>
                ) : (
                  <Pressable
                    style={({ pressed }) => [
                      styles.planBtn,
                      { backgroundColor: colors.primary },
                      pressed && { opacity: 0.8 },
                      (!!myMembership || subscribing === plan.id) && { opacity: 0.5 },
                    ]}
                    onPress={() => handleSubscribe(plan.id)}
                    disabled={!!myMembership || subscribing !== null}
                  >
                    {subscribing === plan.id ? (
                      <ActivityIndicator color={palette.neutral50} size="small" />
                    ) : (
                      <Text style={styles.planBtnText}>
                        {myMembership ? "Already a Member" : "Get Started"}
                      </Text>
                    )}
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>
      )}

      <Text style={[styles.footer, { color: colors.mutedForeground }]}>
        Memberships renew automatically. Cancel anytime from your profile.
      </Text>
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
  crownCircle: {
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
  activeBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  activeBannerText: { color: "#F59E0B", fontSize: 14, fontFamily: "Outfit_600SemiBold" },
  plansContainer: { paddingHorizontal: 16, gap: 16 },
  planCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    overflow: "hidden",
    position: "relative",
    paddingTop: 28,
  },
  badge: {
    position: "absolute",
    top: -1,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
  },
  badgeText: { color: "#fff", fontSize: 11, fontFamily: "Outfit_700Bold" },
  planHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 },
  planName: { fontSize: 18, fontFamily: "Outfit_700Bold" },
  planDesc: { fontSize: 12, fontFamily: "Outfit_400Regular", marginTop: 2 },
  priceBlock: { alignItems: "flex-end" },
  planPrice: { fontSize: 28, fontFamily: "Outfit_700Bold" },
  planCycle: { fontSize: 12, fontFamily: "Outfit_400Regular" },
  featureList: { gap: 8, marginBottom: 16 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  featureText: { fontSize: 13, fontFamily: "Outfit_400Regular", flex: 1 },
  trialNote: { fontSize: 12, fontFamily: "Outfit_400Regular", marginBottom: 12 },
  planBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  planBtnDisabled: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  planBtnText: { color: palette.neutral50, fontSize: 15, fontFamily: "Outfit_600SemiBold" },
  emptyCard: {
    marginHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    padding: 32,
    alignItems: "center",
    gap: 12,
  },
  emptyText: { fontSize: 14, fontFamily: "Outfit_400Regular", textAlign: "center" },
  footer: {
    fontSize: 12,
    fontFamily: "Outfit_400Regular",
    textAlign: "center",
    marginTop: 20,
    marginBottom: 8,
    paddingHorizontal: 24,
  },
});
