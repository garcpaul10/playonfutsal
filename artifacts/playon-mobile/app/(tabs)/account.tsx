import { palette, resolveUserRoles, getAvailableDashboards } from "@workspace/brand";
import { useAuth, useUser } from "@clerk/expo";
import { setAuthTokenGetter, useGetMyProfile } from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import * as FileSystem from "expo-file-system";
import { useRouter, usePathname } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import QRCode from "react-native-qrcode-svg";

import { useColors } from "@/hooks/useColors";
import { usePushNotifications } from "@/hooks/usePushNotifications";

interface NotifPref {
  notificationType: string;
  label: string;
  channelPush: boolean;
}

const DEFAULT_CATEGORIES = [
  { notificationType: "game_reminder",     label: "Game Reminders" },
  { notificationType: "waitlist_movement", label: "Waitlist Updates" },
  { notificationType: "payment_receipt",   label: "Payment Receipts" },
  { notificationType: "schedule_change",   label: "Schedule Changes" },
];

interface ChildQrEntry {
  youthUserId: number;
  firstName: string | null;
  lastName: string | null;
  qrCode: string | null;
  hasEventsToday: boolean;
  todayEvents: any[];
}

const domain = process.env.EXPO_PUBLIC_DOMAIN;
const baseUrl = domain ? `https://${domain}` : "";

export default function AccountScreen() {
  const { getToken, signOut } = useAuth();
  const { user } = useUser();
  const colors = useColors();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const topPaddingWeb = Platform.OS === "web" ? 67 : 0;

  // QR state
  const [brightness, setBrightness] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [childrenQr, setChildrenQr] = useState<ChildQrEntry[]>([]);
  const [walletLoading, setWalletLoading] = useState<"apple" | "google" | null>(null);
  const [walletDismissed, setWalletDismissed] = useState(false);

  // Notif state
  const { granted: pushGranted, requesting: pushRequesting, request: requestPush } = usePushNotifications(getToken);
  const [notifPrefs, setNotifPrefs] = useState<NotifPref[]>([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifSaving, setNotifSaving] = useState(false);

  useEffect(() => {
    setAuthTokenGetter(() => getToken());
  }, [getToken]);

  const { data: profile } = useGetMyProfile();
  const isParent = (profile as any)?.roles?.includes("parent") ?? false;

  useEffect(() => {
    if (!isParent) return;
    getToken().then((token) => {
      fetch(`${baseUrl}/api/me/children-qr-today`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.children) setChildrenQr(data.children.filter((c: ChildQrEntry) => c.qrCode));
        })
        .catch(() => {});
    });
  }, [isParent]);

  useEffect(() => {
    if (pushGranted) loadNotifPrefs();
  }, [pushGranted]);

  const loadNotifPrefs = async () => {
    setNotifLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${baseUrl}/api/notification-preferences`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data: NotifPref[] = await res.json();
        setNotifPrefs(data.length > 0 ? data : DEFAULT_CATEGORIES.map((c) => ({ ...c, channelPush: true })));
      } else {
        setNotifPrefs(DEFAULT_CATEGORIES.map((c) => ({ ...c, channelPush: true })));
      }
    } catch {
      setNotifPrefs(DEFAULT_CATEGORIES.map((c) => ({ ...c, channelPush: true })));
    }
    setNotifLoading(false);
  };

  const toggleNotifPref = async (index: number) => {
    const updated = notifPrefs.map((p, i) => (i === index ? { ...p, channelPush: !p.channelPush } : p));
    setNotifPrefs(updated);
    setNotifSaving(true);
    try {
      const token = await getToken();
      await fetch(`${baseUrl}/api/notification-preferences`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(updated),
      });
    } catch {}
    setNotifSaving(false);
  };

  // QR helpers
  const selfQrValue = (profile as any)?.qrCode ?? (user?.id ? `playon:player:${user.id}` : "playon:player:unknown");
  const selfDisplayName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.emailAddresses?.[0]?.emailAddress || "Player";
  const selfInitials = [user?.firstName?.[0], user?.lastName?.[0]].filter(Boolean).join("").toUpperCase() || "P";

  const qrProfiles = [
    { label: "My QR", name: selfDisplayName, initials: selfInitials, qrValue: selfQrValue, hasEventToday: false, isChild: false },
    ...childrenQr.map((c) => ({
      label: c.firstName ?? "Child",
      name: `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Child",
      initials: (c.firstName?.[0] ?? "C").toUpperCase(),
      qrValue: c.qrCode!,
      hasEventToday: c.hasEventsToday,
      isChild: true,
    })),
  ];
  const safeIdx = Math.min(selectedIdx, qrProfiles.length - 1);
  const activeQr = qrProfiles[safeIdx];

  const handleAppleWallet = async () => {
    if (walletLoading) return;
    setWalletLoading("apple");
    try {
      const token = await getToken();
      const destPath = `${FileSystem.cacheDirectory}playon-pass.pkpass`;
      const result = await FileSystem.downloadAsync(`${baseUrl}/api/me/wallet/apple`, destPath, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (result.status === 503) { Alert.alert("Not Available", "Apple Wallet export is not set up yet."); return; }
      if (result.status !== 200) throw new Error();
      await Linking.openURL(result.uri);
      setWalletDismissed(true);
    } catch { Alert.alert("Error", "Could not generate your Apple Wallet pass."); }
    finally { setWalletLoading(null); }
  };

  const handleGoogleWallet = async () => {
    if (walletLoading) return;
    setWalletLoading("google");
    try {
      const token = await getToken();
      const res = await fetch(`${baseUrl}/api/me/wallet/google`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 503) { Alert.alert("Not Available", "Google Wallet export is not set up yet."); return; }
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data?.saveUrl) { await Linking.openURL(data.saveUrl); setWalletDismissed(true); }
    } catch { Alert.alert("Error", "Could not generate your Google Wallet pass."); }
    finally { setWalletLoading(null); }
  };

  const handleSignOut = () => {
    if (Platform.OS === "web") { signOut(); return; }
    Alert.alert("Sign out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); signOut(); } },
    ]);
  };

  // Dashboard switcher
  const userRoles = resolveUserRoles(profile);
  const MOBILE_ROUTE_MAP: Record<string, string> = { player: "/(tabs)/my-playon", family: "/family" };
  const MOBILE_ICON_MAP: Record<string, string> = { admin: "shield", staff: "clipboard", earnings: "dollar-sign", "ref-alerts": "alert-triangle", family: "users", player: "home" };
  const availableDashboards = getAvailableDashboards(userRoles).map((d) => ({
    ...d,
    icon: MOBILE_ICON_MAP[d.id] ?? "grid",
    mobileRoute: MOBILE_ROUTE_MAP[d.id] ?? null,
  }));
  const isMultiRole = userRoles.length > 1;
  function isActiveDashboard(entry: (typeof availableDashboards)[number]): boolean {
    if (!entry.mobileRoute) return false;
    if (entry.id === "player") return pathname === "/" || pathname.includes("my-playon");
    if (entry.id === "family") return pathname.startsWith("/family");
    return false;
  }

  const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.emailAddresses?.[0]?.emailAddress?.split("@")[0] || "Player";
  const email = user?.emailAddresses?.[0]?.emailAddress || "";
  const initials = [user?.firstName?.[0], user?.lastName?.[0]].filter(Boolean).join("").toUpperCase() || "P";
  const role = (profile as any)?.role || "player";

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: brightness ? "#FFFFFF" : colors.background }]}
      contentContainerStyle={{ paddingBottom: Platform.OS === "web" ? 34 : 100 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + topPaddingWeb + 16, backgroundColor: brightness ? "#FFFFFF" : colors.background }]}>
        <Text style={[styles.pageTitle, { color: brightness ? "#111" : colors.foreground }]}>Account</Text>
      </View>

      {/* Avatar card */}
      <View style={[styles.avatarCard, { backgroundColor: brightness ? "#F9FAFB" : colors.card, borderColor: brightness ? "#E5E7EB" : colors.border }]}>
        <View style={[styles.avatarCircle, { backgroundColor: colors.primary }]}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, { color: brightness ? "#111" : colors.foreground }]}>{displayName}</Text>
          <Text style={[styles.emailText, { color: colors.mutedForeground }]}>{email}</Text>
          <View style={[styles.roleChip, { backgroundColor: colors.primary + "20" }]}>
            <Text style={[styles.roleText, { color: colors.primary }]}>{role.charAt(0).toUpperCase() + role.slice(1)}</Text>
          </View>
        </View>
      </View>

      {/* Venue card */}
      <View style={[styles.venueCard, { backgroundColor: colors.primary }]}>
        <Feather name="map-pin" size={15} color={palette.neutral50} />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={styles.venueTitle}>Alumni Center, Lexington KY</Text>
          <Text style={styles.venueSub}>Your PlayOn home court</Text>
        </View>
      </View>

      {/* ── QR Code section ── */}
      <View style={[styles.sectionCard, { backgroundColor: brightness ? "#F9FAFB" : colors.card, borderColor: brightness ? "#E5E7EB" : colors.border }]}>
        <View style={styles.qrSectionHeader}>
          <View>
            <Text style={[styles.sectionTitle, { color: brightness ? "#111" : colors.foreground }]}>PlayOn ID / QR Code</Text>
            <Text style={[styles.sectionSub, { color: colors.mutedForeground }]}>Show at any PlayOn event to check in</Text>
          </View>
          <Pressable onPress={() => { setBrightness(!brightness); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }} style={styles.brightnessBtn}>
            <Feather name={brightness ? "sun" : "moon"} size={18} color={brightness ? "#F59E0B" : colors.mutedForeground} />
          </Pressable>
        </View>

        {/* Profile switcher for parents */}
        {qrProfiles.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.qrChipsRow}>
            {qrProfiles.map((p, i) => (
              <Pressable
                key={i}
                onPress={() => { setSelectedIdx(i); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                style={[styles.qrChip, i === safeIdx
                  ? { backgroundColor: colors.primary }
                  : { backgroundColor: brightness ? "#F3F4F6" : colors.muted, borderColor: brightness ? "#E5E7EB" : colors.border, borderWidth: 1 }]}
              >
                <Text style={[styles.qrChipText, { color: i === safeIdx ? "#fff" : colors.foreground }]}>{p.label}</Text>
                {p.hasEventToday && (
                  <View style={[styles.todayDot, { backgroundColor: i === safeIdx ? "rgba(255,255,255,0.4)" : colors.primary }]}>
                    <Text style={styles.todayDotText}>Today</Text>
                  </View>
                )}
              </Pressable>
            ))}
          </ScrollView>
        )}

        {/* Wallet banner */}
        {!walletDismissed && !brightness && safeIdx === 0 && (
          <View style={[styles.walletBanner, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
              <Feather name="credit-card" size={14} color={colors.primary} />
              <Text style={[styles.walletText, { color: colors.foreground }]}>Add to Wallet for instant access</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
              {Platform.OS === "ios" && (
                <Pressable onPress={handleAppleWallet} disabled={walletLoading === "apple"}
                  style={[styles.walletBtn, { backgroundColor: colors.foreground }]}>
                  <Text style={[styles.walletBtnText, { color: colors.background }]}>{walletLoading === "apple" ? "…" : "Apple"}</Text>
                </Pressable>
              )}
              {Platform.OS === "android" && (
                <Pressable onPress={handleGoogleWallet} disabled={walletLoading === "google"}
                  style={[styles.walletBtn, { backgroundColor: colors.primary }]}>
                  <Text style={[styles.walletBtnText, { color: "#fff" }]}>{walletLoading === "google" ? "…" : "Google"}</Text>
                </Pressable>
              )}
              <Pressable onPress={() => setWalletDismissed(true)}><Feather name="x" size={15} color={colors.mutedForeground} /></Pressable>
            </View>
          </View>
        )}

        {/* QR Code */}
        <View style={styles.qrCenter}>
          <View style={[styles.qrCard, { backgroundColor: brightness ? "#fff" : colors.card, borderColor: brightness ? "#E5E7EB" : colors.border }]}>
            <QRCode value={activeQr.qrValue} size={200} color={palette.teal900} backgroundColor="transparent" />
          </View>
          <Text style={[styles.qrHint, { color: brightness ? "#6B7280" : colors.mutedForeground }]}>
            Show this to check in at any PlayOn event
          </Text>
        </View>
      </View>

      {/* ── Notification Preferences ── */}
      <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.notifHeaderRow}>
          <View style={[styles.notifIconBox, { backgroundColor: colors.accent }]}>
            <Feather name="bell" size={18} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Notifications</Text>
            <Text style={[styles.sectionSub, { color: colors.mutedForeground }]}>
              {pushGranted ? "Manage your notification preferences" : "Enable push notifications to stay in the loop"}
            </Text>
          </View>
          {!pushGranted && (
            <Switch value={false} onValueChange={() => requestPush()} trackColor={{ false: colors.muted, true: colors.primary }} thumbColor="#FFFFFF" disabled={pushRequesting} />
          )}
        </View>

        {pushGranted && (
          <>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            {notifLoading ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: 12 }} />
            ) : notifPrefs.map((pref, i) => (
              <View key={pref.notificationType} style={[styles.notifRow, i < notifPrefs.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
                <Text style={[styles.notifLabel, { color: colors.foreground }]}>{pref.label}</Text>
                <Switch value={pref.channelPush} onValueChange={() => toggleNotifPref(i)} trackColor={{ false: colors.muted, true: colors.primary }} thumbColor="#FFFFFF" disabled={notifSaving} />
              </View>
            ))}
          </>
        )}
      </View>

      {/* ── Dashboard Switcher (multi-role) ── */}
      {isMultiRole && (
        <View style={[styles.menuCard, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 12 }]}>
          <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 6 }}>
            <Text style={[styles.sectionLabelSm, { color: colors.mutedForeground }]}>Switch Dashboard</Text>
          </View>
          {availableDashboards.map((entry, idx) => {
            const active = isActiveDashboard(entry);
            const isWebOnly = !entry.mobileRoute;
            return (
              <Pressable key={entry.id} style={({ pressed }) => [styles.menuRow, idx < availableDashboards.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }, active && { backgroundColor: colors.primary + "10" }, pressed && { opacity: 0.7 }]}
                onPress={() => { if (entry.mobileRoute) router.push(entry.mobileRoute as any); else if (domain) Linking.openURL(`https://${domain}${entry.webPath}`); }}>
                <View style={[styles.menuIcon, { backgroundColor: active ? colors.primary + "20" : colors.accent }]}>
                  <Feather name={entry.icon as any} size={18} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.menuLabel, { color: active ? colors.primary : colors.foreground }]}>{entry.label}</Text>
                  <Text style={[styles.menuDesc, { color: colors.mutedForeground }]}>{entry.description}</Text>
                </View>
                {active ? <Feather name="check" size={16} color={colors.primary} /> : <Feather name={isWebOnly ? "external-link" : "chevron-right"} size={16} color={colors.mutedForeground} />}
              </Pressable>
            );
          })}
        </View>
      )}

      {/* ── Menu rows ── */}
      <View style={[styles.menuCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {[
          { icon: "clock",          label: "History",         desc: "Your past events & registrations",       onPress: () => router.push("/history") },
          { icon: "message-square", label: "AI Assistant",    desc: "Ask anything about PlayOn",             onPress: () => router.push("/assistant") },
          { icon: "star",           label: "Memberships",     desc: "Monthly & annual plans",                 onPress: () => router.push("/memberships") },
          { icon: "gift",           label: "Referrals",       desc: "Earn credit for inviting friends",       onPress: () => router.push("/referrals") },
          { icon: "users",          label: "Family",          desc: "Manage youth player accounts",           onPress: () => router.push("/family") },
          { icon: "search",         label: "Browse Programs", desc: "Leagues, camps, drop-ins",               onPress: () => router.push("/(tabs)/explore") },
        ].map((row, idx, arr) => (
          <Pressable key={row.label} style={({ pressed }) => [styles.menuRow, idx < arr.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }, pressed && { opacity: 0.7 }]} onPress={row.onPress}>
            <View style={[styles.menuIcon, { backgroundColor: colors.accent }]}>
              <Feather name={row.icon as any} size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.menuLabel, { color: colors.foreground }]}>{row.label}</Text>
              <Text style={[styles.menuDesc, { color: colors.mutedForeground }]}>{row.desc}</Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </Pressable>
        ))}
      </View>

      {/* Sign out */}
      <Pressable style={({ pressed }) => [styles.signOutBtn, { backgroundColor: colors.card, borderColor: colors.border }, pressed && { opacity: 0.7 }]} onPress={handleSignOut}>
        <Feather name="log-out" size={18} color={colors.destructive} />
        <Text style={[styles.signOutText, { color: colors.destructive }]}>Sign out</Text>
      </Pressable>

      <Text style={[styles.version, { color: colors.mutedForeground }]}>PlayOn v1.0 · Alumni Center, Lexington KY</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 12 },
  pageTitle: { fontSize: 28, fontFamily: "Outfit_700Bold" },

  avatarCard: { flexDirection: "row", alignItems: "center", marginHorizontal: 16, marginBottom: 12, padding: 16, borderRadius: 16, borderWidth: 1, gap: 14 },
  avatarCircle: { width: 58, height: 58, borderRadius: 29, alignItems: "center", justifyContent: "center" },
  avatarText: { color: palette.neutral50, fontSize: 22, fontFamily: "Outfit_700Bold" },
  name: { fontSize: 17, fontFamily: "Outfit_700Bold" },
  emailText: { fontSize: 13, fontFamily: "Outfit_400Regular", marginTop: 2 },
  roleChip: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, marginTop: 6 },
  roleText: { fontSize: 12, fontFamily: "Outfit_600SemiBold" },

  venueCard: { flexDirection: "row", alignItems: "center", marginHorizontal: 16, marginBottom: 12, padding: 12, borderRadius: 12 },
  venueTitle: { color: palette.neutral50, fontSize: 13, fontFamily: "Outfit_600SemiBold" },
  venueSub: { color: palette.neutral50 + "BB", fontSize: 11, fontFamily: "Outfit_400Regular", marginTop: 1 },

  sectionCard: { marginHorizontal: 16, marginBottom: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  qrSectionHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 },
  sectionTitle: { fontSize: 15, fontFamily: "Outfit_600SemiBold" },
  sectionSub: { fontSize: 12, fontFamily: "Outfit_400Regular", marginTop: 2 },
  brightnessBtn: { padding: 6 },

  qrChipsRow: { flexDirection: "row", gap: 8, paddingVertical: 2, marginBottom: 10 },
  qrChip: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, gap: 6 },
  qrChipText: { fontSize: 13, fontFamily: "Outfit_600SemiBold" },
  todayDot: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  todayDotText: { fontSize: 10, fontFamily: "Outfit_700Bold", color: "#fff" },

  walletBanner: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 10, borderRadius: 10, borderWidth: 1, marginBottom: 12, gap: 8 },
  walletText: { fontSize: 12, fontFamily: "Outfit_500Medium", flex: 1 },
  walletBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  walletBtnText: { fontSize: 12, fontFamily: "Outfit_600SemiBold" },

  qrCenter: { alignItems: "center", paddingTop: 4 },
  qrCard: { padding: 20, borderRadius: 18, borderWidth: 1, marginBottom: 12 },
  qrHint: { fontSize: 13, fontFamily: "Outfit_400Regular", textAlign: "center" },

  notifHeaderRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  notifIconBox: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  divider: { height: 1, marginVertical: 12, marginHorizontal: -14 },
  notifRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10 },
  notifLabel: { fontSize: 14, fontFamily: "Outfit_500Medium" },

  sectionLabelSm: { fontSize: 11, fontFamily: "Outfit_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8 },
  menuCard: { marginHorizontal: 16, marginBottom: 12, borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  menuRow: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  menuIcon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  menuLabel: { fontSize: 15, fontFamily: "Outfit_600SemiBold" },
  menuDesc: { fontSize: 12, fontFamily: "Outfit_400Regular", marginTop: 1 },

  signOutBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginHorizontal: 16, marginBottom: 8, paddingVertical: 14, borderRadius: 14, borderWidth: 1 },
  signOutText: { fontSize: 15, fontFamily: "Outfit_600SemiBold" },
  version: { fontSize: 12, fontFamily: "Outfit_400Regular", textAlign: "center", marginVertical: 8 },
});
