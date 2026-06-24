import { palette } from "@workspace/brand";
import { useAuth, useUser } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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

type GuardianLink = {
  id: number;
  youthUserId: string;
  status: "pending" | "approved" | "rejected";
  relationship?: string;
  notes?: string;
  canRegister?: boolean;
  canPickup?: boolean;
  firstName?: string;
  lastName?: string;
  email?: string;
};

type DashboardChild = {
  youthUserId: number;
  firstName: string | null;
  lastName: string | null;
  relationship: string;
  dateOfBirth: string | null;
  registrations: number;
  campRegistrations: number;
  upcomingEvent: {
    type: string;
    childName: string;
    description: string;
    scheduledAt: string | null;
  } | null;
  unpaidCount: number;
};

type FamilyDashboard = {
  children?: DashboardChild[];
  upcomingRegistrations?: any[];
  totalRegistrations?: number;
};

const GUARDIAN_CONSENT_TEXT =
  "I confirm that I am the legal parent or guardian of the youth player I am adding. " +
  "I consent to their participation in PlayOn programs at the Alumni Center and authorise " +
  "staff to act in loco parentis in the event of a medical emergency. " +
  "I understand that the youth account will remain pending until reviewed and approved by PlayOn staff.";

type YouthForm = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  addressLine1: string;
  city: string;
  state: string;
  zip: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship: string;
  primaryPosition: string;
  relationship: string;
};

const EMPTY_FORM: YouthForm = {
  firstName: "",
  lastName: "",
  dateOfBirth: "",
  gender: "",
  addressLine1: "",
  city: "",
  state: "",
  zip: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  emergencyContactRelationship: "",
  primaryPosition: "",
  relationship: "parent",
};

export default function FamilyScreen() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [links, setLinks] = useState<GuardianLink[]>([]);
  const [dashboard, setDashboard] = useState<FamilyDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [consentExpanded, setConsentExpanded] = useState(false);
  const [form, setForm] = useState<YouthForm>(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [formSection, setFormSection] = useState<"player" | "sports" | "consent">("player");

  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  const baseUrl = domain ? `https://${domain}` : "";

  const fetchData = async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const headers: Record<string, string> = {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
      };

      const [linksRes, dashRes] = await Promise.all([
        fetch(`${baseUrl}/api/me/guardian-links`, { headers }),
        fetch(`${baseUrl}/api/family-dashboard`, { headers }),
      ]);

      if (linksRes.ok) {
        const data = await linksRes.json();
        setLinks(Array.isArray(data) ? data : data.links || []);
      }
      if (dashRes.ok) {
        setDashboard(await dashRes.json());
      }
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setConsentAccepted(false);
    setConsentExpanded(false);
    setFormError("");
    setFormSection("player");
  };

  const setField = (key: keyof YouthForm) => (val: string) => {
    setForm((f) => ({ ...f, [key]: val }));
  };

  const formatDobInput = (text: string) => {
    const digits = text.replace(/\D/g, "").slice(0, 8);
    let formatted = "";
    if (digits.length > 0) formatted = digits.slice(0, 2);
    if (digits.length > 2) formatted += "/" + digits.slice(2, 4);
    if (digits.length > 4) formatted += "/" + digits.slice(4, 8);
    setField("dateOfBirth")(formatted);
  };

  const validatePlayerSection = () => {
    if (!form.firstName.trim()) return "First name is required.";
    if (!form.lastName.trim()) return "Last name is required.";
    if (!form.dateOfBirth.trim()) return "Date of birth is required.";
    if (!form.emergencyContactName.trim()) return "Emergency contact name is required.";
    if (!form.emergencyContactPhone.trim()) return "Emergency contact phone is required.";
    return null;
  };

  const handleNextSection = () => {
    if (formSection === "player") {
      const err = validatePlayerSection();
      if (err) { setFormError(err); return; }
      setFormError("");
      setFormSection("sports");
    } else if (formSection === "sports") {
      setFormError("");
      setFormSection("consent");
    }
  };

  const handleSubmitYouth = async () => {
    if (!consentAccepted) {
      Alert.alert("Guardian Consent Required", "Please read and accept the guardian consent statement before adding a youth player.");
      return;
    }
    const err = validatePlayerSection();
    if (err) { setFormError(err); return; }

    setLinking(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const token = await getToken();
      const res = await fetch(`${baseUrl}/api/youth`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          dateOfBirth: form.dateOfBirth.trim(),
          gender: form.gender.trim() || undefined,
          addressLine1: form.addressLine1.trim() || undefined,
          city: form.city.trim() || undefined,
          state: form.state.trim() || undefined,
          zip: form.zip.trim() || undefined,
          emergencyContactName: form.emergencyContactName.trim(),
          emergencyContactPhone: form.emergencyContactPhone.trim(),
          emergencyContactRelationship: form.emergencyContactRelationship.trim() || undefined,
          primaryPosition: form.primaryPosition.trim() || undefined,
          relationship: form.relationship.trim() || "parent",
          guardianConsentGiven: true,
        }),
      });
      if (res.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        resetForm();
        setShowForm(false);
        await fetchData();
      } else {
        const data = await res.json().catch(() => ({}));
        setFormError(data.error || "Could not add youth player. Please try again.");
      }
    } catch {
      setFormError("Network error. Please try again.");
    }
    setLinking(false);
  };

  const handleRemove = (link: GuardianLink) => {
    if (Platform.OS === "web") {
      removeLink(link.id);
      return;
    }
    Alert.alert(
      "Remove account",
      `Remove ${link.firstName || "this youth account"} from your family?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => removeLink(link.id) },
      ]
    );
  };

  const removeLink = async (linkId: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const token = await getToken();
      await fetch(`${baseUrl}/api/guardians/${linkId}`, {
        method: "DELETE",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      await fetchData();
    } catch {}
  };

  const statusColor = (status: string) => {
    if (status === "approved") return "#22C55E";
    if (status === "pending") return "#F59E0B";
    return "#EF4444";
  };

  const topPaddingWeb = Platform.OS === "web" ? 67 : 0;

  const InputField = ({
    label, value, onChange, placeholder, keyboardType, maxLength, autoCapitalize, editable,
  }: any) => (
    <View>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.accent, color: colors.foreground, borderColor: colors.border }]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        keyboardType={keyboardType}
        maxLength={maxLength}
        autoCapitalize={autoCapitalize ?? "sentences"}
        editable={editable !== false}
      />
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + topPaddingWeb + 12, backgroundColor: colors.background },
        ]}
      >
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>Family</Text>
        <Pressable
          onPress={() => {
            if (showForm) {
              resetForm();
              setShowForm(false);
            } else {
              setShowForm(true);
              setFormSection("player");
            }
          }}
          style={[styles.addBtn, { backgroundColor: colors.primary }]}
        >
          <Feather name={showForm ? "x" : "plus"} size={18} color={palette.neutral50} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 8,
          paddingBottom: Platform.OS === "web" ? 34 : 100,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Add youth player form */}
        {showForm && (
          <View style={[styles.formCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.formTitle, { color: colors.foreground }]}>Add Youth Player</Text>

            {/* Section tabs */}
            <View style={[styles.sectionTabs, { backgroundColor: colors.accent, borderColor: colors.border }]}>
              {(["player", "sports", "consent"] as const).map((s) => (
                <Pressable
                  key={s}
                  style={[styles.sectionTab, formSection === s && { backgroundColor: colors.primary }]}
                  onPress={() => setFormSection(s)}
                >
                  <Text style={[styles.sectionTabText, { color: formSection === s ? palette.neutral50 : colors.mutedForeground }]}>
                    {s === "player" ? "Player" : s === "sports" ? "Sports" : "Consent"}
                  </Text>
                </Pressable>
              ))}
            </View>

            {formSection === "player" && (
              <>
                <View style={styles.row}>
                  <View style={{ flex: 1, marginRight: 6 }}>
                    <InputField label="First name *" value={form.firstName} onChange={setField("firstName")} placeholder="Alex" autoCapitalize="words" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <InputField label="Last name *" value={form.lastName} onChange={setField("lastName")} placeholder="Smith" autoCapitalize="words" />
                  </View>
                </View>

                <InputField
                  label="Date of birth *"
                  value={form.dateOfBirth}
                  onChange={formatDobInput}
                  placeholder="MM/DD/YYYY"
                  keyboardType="numeric"
                />

                <InputField
                  label="Gender"
                  value={form.gender}
                  onChange={setField("gender")}
                  placeholder="Male / Female / Non-binary"
                  autoCapitalize="words"
                />

                <Text style={[styles.sectionHeader, { color: colors.mutedForeground }]}>ADDRESS (optional)</Text>
                <InputField label="Street address" value={form.addressLine1} onChange={setField("addressLine1")} placeholder="123 Main St" autoCapitalize="words" />
                <View style={styles.row}>
                  <View style={{ flex: 2, marginRight: 6 }}>
                    <InputField label="City" value={form.city} onChange={setField("city")} placeholder="Lexington" autoCapitalize="words" />
                  </View>
                  <View style={{ flex: 1, marginRight: 6 }}>
                    <InputField label="State" value={form.state} onChange={(v: string) => setField("state")(v.toUpperCase().slice(0, 2))} placeholder="KY" autoCapitalize="characters" maxLength={2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <InputField label="ZIP" value={form.zip} onChange={setField("zip")} placeholder="40422" keyboardType="numeric" maxLength={5} />
                  </View>
                </View>

                <Text style={[styles.sectionHeader, { color: colors.mutedForeground }]}>EMERGENCY CONTACT *</Text>
                <InputField label="Name *" value={form.emergencyContactName} onChange={setField("emergencyContactName")} placeholder="Jane Smith" autoCapitalize="words" />
                <InputField label="Phone *" value={form.emergencyContactPhone} onChange={setField("emergencyContactPhone")} placeholder="(555) 000-0000" keyboardType="phone-pad" />
                <InputField label="Relationship" value={form.emergencyContactRelationship} onChange={setField("emergencyContactRelationship")} placeholder="Mother / Father / Guardian" autoCapitalize="words" />

                <Text style={[styles.sectionHeader, { color: colors.mutedForeground }]}>GUARDIAN RELATIONSHIP</Text>
                <InputField label="Your relationship to this player" value={form.relationship} onChange={setField("relationship")} placeholder="Parent / Guardian / Step-parent" autoCapitalize="words" />
              </>
            )}

            {formSection === "sports" && (
              <>
                <Text style={[styles.formDesc, { color: colors.mutedForeground }]}>
                  Sports profile fields are optional and help match players to the right programs.
                </Text>
                <InputField label="Primary position" value={form.primaryPosition} onChange={setField("primaryPosition")} placeholder="Forward / Goalkeeper / etc." autoCapitalize="words" />
              </>
            )}

            {formSection === "consent" && (
              <View
                style={[
                  styles.consentCard,
                  {
                    backgroundColor: colors.accent,
                    borderColor: consentAccepted ? "#22C55E40" : colors.border,
                  },
                ]}
              >
                <View style={styles.consentHeader}>
                  <Feather name="shield" size={14} color={colors.primary} />
                  <Text style={[styles.consentTitle, { color: colors.foreground }]}>
                    Guardian Consent
                  </Text>
                  <Text style={[styles.consentRequired, { color: colors.primary }]}>Required</Text>
                </View>

                <Pressable
                  onPress={() => setConsentExpanded(!consentExpanded)}
                  style={styles.consentToggle}
                >
                  <Text style={[styles.consentToggleText, { color: colors.mutedForeground }]}>
                    {consentExpanded ? "Hide" : "Read consent statement"}
                  </Text>
                  <Feather
                    name={consentExpanded ? "chevron-up" : "chevron-down"}
                    size={13}
                    color={colors.mutedForeground}
                  />
                </Pressable>

                {consentExpanded && (
                  <Text style={[styles.consentText, { color: colors.mutedForeground }]}>
                    {GUARDIAN_CONSENT_TEXT}
                  </Text>
                )}

                <Pressable
                  style={styles.consentCheckRow}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setConsentAccepted(!consentAccepted);
                  }}
                >
                  <View
                    style={[
                      styles.checkbox,
                      {
                        borderColor: consentAccepted ? "#22C55E" : colors.border,
                        backgroundColor: consentAccepted ? "#22C55E" : "transparent",
                      },
                    ]}
                  >
                    {consentAccepted && <Feather name="check" size={11} color="#FFFFFF" />}
                  </View>
                  <Text style={[styles.consentCheckText, { color: colors.foreground }]}>
                    I confirm I am the legal parent/guardian and consent to participation
                  </Text>
                </Pressable>
              </View>
            )}

            {formError ? (
              <Text style={styles.formError}>{formError}</Text>
            ) : null}

            <View style={styles.formBtns}>
              <Pressable
                style={({ pressed }) => [
                  styles.cancelBtn,
                  { borderColor: colors.border },
                  pressed && { opacity: 0.7 },
                ]}
                onPress={() => {
                  resetForm();
                  setShowForm(false);
                }}
              >
                <Text style={[styles.cancelBtnText, { color: colors.foreground }]}>Cancel</Text>
              </Pressable>

              {formSection !== "consent" ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.linkBtn,
                    { backgroundColor: colors.primary },
                    pressed && { opacity: 0.85 },
                  ]}
                  onPress={handleNextSection}
                >
                  <Text style={styles.linkBtnText}>Next</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={({ pressed }) => [
                    styles.linkBtn,
                    {
                      backgroundColor: linking || !consentAccepted ? colors.muted : colors.primary,
                    },
                    pressed && { opacity: 0.85 },
                  ]}
                  onPress={handleSubmitYouth}
                  disabled={linking || !consentAccepted}
                >
                  {linking ? (
                    <ActivityIndicator color={palette.neutral50} size="small" />
                  ) : (
                    <Text
                      style={[
                        styles.linkBtnText,
                        !consentAccepted && { color: colors.mutedForeground },
                      ]}
                    >
                      Add Player
                    </Text>
                  )}
                </Pressable>
              )}
            </View>
          </View>
        )}

        {/* Family summary */}
        {dashboard && (
          <View style={styles.summaryRow}>
            <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.summaryValue, { color: colors.foreground }]}>
                {links.filter((l) => l.status === "approved").length}
              </Text>
              <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Players</Text>
            </View>
            <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.summaryValue, { color: colors.foreground }]}>
                {dashboard.totalRegistrations ?? (dashboard.upcomingRegistrations?.length ?? 0)}
              </Text>
              <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Registrations</Text>
            </View>
          </View>
        )}

        {/* Check-in QR Codes shortcut */}
        {(() => {
          const today = new Date().toDateString();
          const hasEventToday = dashboard?.children?.some(c =>
            c.upcomingEvent?.scheduledAt &&
            new Date(c.upcomingEvent.scheduledAt).toDateString() === today
          ) ?? false;
          const approvedCount = links.filter(l => l.status === "approved").length;
          if (approvedCount === 0) return null;
          return (
            <Pressable
              style={({ pressed }) => [
                styles.qrShortcutCard,
                {
                  backgroundColor: hasEventToday ? colors.primary + "18" : colors.card,
                  borderColor: hasEventToday ? colors.primary + "50" : colors.border,
                },
                pressed && { opacity: 0.8 },
              ]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push("/(tabs)/account");
              }}
            >
              <View style={[styles.qrShortcutIcon, { backgroundColor: colors.primary + "20" }]}>
                <Feather name="maximize" size={22} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.qrShortcutTitle, { color: colors.foreground }]}>
                  Check-in QR Codes
                </Text>
                <Text style={[styles.qrShortcutSub, { color: colors.mutedForeground }]}>
                  {hasEventToday
                    ? "A child has an event today — tap to show their QR"
                    : "Tap to show your children's check-in codes"}
                </Text>
              </View>
              {hasEventToday && (
                <View style={[styles.qrTodayBadge, { backgroundColor: colors.primary }]}>
                  <Text style={styles.qrTodayBadgeText}>Today</Text>
                </View>
              )}
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </Pressable>
          );
        })()}

        {/* Linked youth accounts */}
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>LINKED ACCOUNTS</Text>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} />
        ) : links.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="users" size={32} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No linked accounts</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Tap the + button to add a youth player to your family
            </Text>
          </View>
        ) : (
          links.map((link) => {
            const dashChild = dashboard?.children?.find(
              (c) => c.firstName === link.firstName && c.lastName === link.lastName
            ) ?? null;
            const totalRegs = dashChild
              ? dashChild.registrations + dashChild.campRegistrations
              : null;
            const upcomingEvent = dashChild?.upcomingEvent ?? null;
            const unpaidCount = dashChild?.unpaidCount ?? 0;

            return (
              <Pressable
                key={link.id}
                style={({ pressed }) => [
                  styles.linkCard,
                  { backgroundColor: colors.card, borderColor: colors.border },
                  pressed && { opacity: 0.85 },
                ]}
                onPress={() => router.push({ pathname: "/family/child-detail", params: { youthUserId: String(dashChild?.youthUserId ?? "") } } as any)}
              >
                <View style={[styles.linkAvatar, { backgroundColor: colors.primary }]}>
                  <Text style={styles.linkAvatarText}>
                    {(link.firstName?.[0] || "?").toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.linkName, { color: colors.foreground }]}>
                    {[link.firstName, link.lastName].filter(Boolean).join(" ") || "Youth Player"}
                  </Text>
                  {link.relationship && (
                    <Text style={[styles.linkRelationship, { color: colors.mutedForeground }]}>
                      {link.relationship}
                    </Text>
                  )}
                  {totalRegs !== null && (
                    <Text style={[styles.linkRelationship, { color: colors.mutedForeground }]}>
                      {totalRegs} registration{totalRegs !== 1 ? "s" : ""}
                    </Text>
                  )}
                  <View
                    style={[
                      styles.statusChip,
                      { backgroundColor: statusColor(link.status) + "20" },
                    ]}
                  >
                    <View style={[styles.statusDot, { backgroundColor: statusColor(link.status) }]} />
                    <Text style={[styles.statusText, { color: statusColor(link.status) }]}>
                      {link.status.charAt(0).toUpperCase() + link.status.slice(1)}
                    </Text>
                  </View>
                  {link.status === "pending" && (
                    <Text style={[styles.pendingNote, { color: colors.mutedForeground }]}>
                      Awaiting staff approval
                    </Text>
                  )}
                  {upcomingEvent && (
                    <View style={[styles.upcomingEventChip, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "30" }]}>
                      <Feather name="calendar" size={11} color={colors.primary} />
                      <Text style={[styles.upcomingEventText, { color: colors.primary }]} numberOfLines={1}>
                        {upcomingEvent.description}
                        {upcomingEvent.scheduledAt
                          ? " · " + new Date(upcomingEvent.scheduledAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                          : ""}
                      </Text>
                    </View>
                  )}
                  {unpaidCount > 0 && (
                    <View style={[styles.unpaidChip, { backgroundColor: "#F59E0B18", borderColor: "#F59E0B30" }]}>
                      <Feather name="alert-circle" size={11} color="#F59E0B" />
                      <Text style={[styles.unpaidChipText, { color: "#F59E0B" }]}>
                        {unpaidCount} unpaid balance{unpaidCount > 1 ? "s" : ""}
                      </Text>
                    </View>
                  )}
                </View>
                <Pressable
                  onPress={() => handleRemove(link)}
                  style={({ pressed }) => [styles.removeBtn, pressed && { opacity: 0.6 }]}
                  hitSlop={8}
                >
                  <Feather name="x" size={18} color={colors.mutedForeground} />
                </Pressable>
              </Pressable>
            );
          })
        )}

        {/* Upcoming family registrations */}
        {dashboard && (dashboard.upcomingRegistrations?.length ?? 0) > 0 && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground, marginTop: 20 }]}>
              UPCOMING
            </Text>
            {dashboard.upcomingRegistrations!.slice(0, 5).map((reg: any, idx: number) => (
              <View
                key={idx}
                style={[styles.upcomingCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <View style={[styles.dot, { backgroundColor: colors.primary }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.upcomingTitle, { color: colors.foreground }]}>
                    {reg.programName || `Registration #${reg.id}`}
                  </Text>
                  {reg.playerName && (
                    <Text style={[styles.upcomingSub, { color: colors.mutedForeground }]}>
                      {reg.playerName}
                    </Text>
                  )}
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
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
  title: { flex: 1, fontSize: 24, fontFamily: "Outfit_700Bold" },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  formCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginBottom: 14,
    gap: 10,
  },
  formTitle: { fontSize: 16, fontFamily: "Outfit_700Bold" },
  formDesc: { fontSize: 13, fontFamily: "Outfit_400Regular", lineHeight: 18 },
  sectionTabs: {
    flexDirection: "row",
    borderRadius: 8,
    borderWidth: 1,
    padding: 3,
    gap: 3,
    marginBottom: 4,
  },
  sectionTab: {
    flex: 1,
    borderRadius: 6,
    paddingVertical: 7,
    alignItems: "center",
  },
  sectionTabText: { fontSize: 12, fontFamily: "Outfit_600SemiBold" },
  sectionHeader: { fontSize: 11, fontFamily: "Outfit_600SemiBold", letterSpacing: 0.5, marginTop: 4, marginBottom: 2 },
  row: { flexDirection: "row" },
  label: { fontSize: 12, fontFamily: "Outfit_500Medium", marginBottom: 4, marginTop: 2 },
  input: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    fontFamily: "Outfit_400Regular",
    borderWidth: 1,
    marginBottom: 8,
  },
  consentCard: {
    borderRadius: 10,
    borderWidth: 1.5,
    padding: 12,
    gap: 8,
  },
  consentHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  consentTitle: { flex: 1, fontSize: 14, fontFamily: "Outfit_700Bold" },
  consentRequired: { fontSize: 11, fontFamily: "Outfit_600SemiBold" },
  consentToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  consentToggleText: { fontSize: 12, fontFamily: "Outfit_400Regular" },
  consentText: {
    fontSize: 12,
    fontFamily: "Outfit_400Regular",
    lineHeight: 18,
  },
  consentCheckRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingTop: 2,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  consentCheckText: { flex: 1, fontSize: 12, fontFamily: "Outfit_500Medium", lineHeight: 18 },
  formError: { color: "#F03232", fontSize: 13, fontFamily: "Outfit_400Regular", textAlign: "center" },
  formBtns: { flexDirection: "row", gap: 10, marginTop: 4 },
  cancelBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
  },
  cancelBtnText: { fontSize: 14, fontFamily: "Outfit_500Medium" },
  linkBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  linkBtnText: { color: palette.neutral50, fontSize: 14, fontFamily: "Outfit_600SemiBold" },
  summaryRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  summaryCard: {
    flex: 1,
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    borderWidth: 1,
  },
  summaryValue: { fontSize: 26, fontFamily: "Outfit_700Bold" },
  summaryLabel: { fontSize: 12, fontFamily: "Outfit_500Medium", marginTop: 2 },
  sectionTitle: { fontSize: 12, fontFamily: "Outfit_600SemiBold", letterSpacing: 0.5, marginBottom: 10 },
  emptyCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 28,
    alignItems: "center",
    gap: 10,
  },
  emptyTitle: { fontSize: 16, fontFamily: "Outfit_600SemiBold", textAlign: "center" },
  emptyText: { fontSize: 13, fontFamily: "Outfit_400Regular", textAlign: "center", lineHeight: 18 },
  linkCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    gap: 12,
  },
  linkAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  linkAvatarText: { color: palette.neutral50, fontSize: 18, fontFamily: "Outfit_700Bold" },
  linkName: { fontSize: 15, fontFamily: "Outfit_600SemiBold" },
  linkEmail: { fontSize: 12, fontFamily: "Outfit_400Regular", marginTop: 2 },
  linkRelationship: { fontSize: 12, fontFamily: "Outfit_400Regular", marginTop: 1 },
  statusChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    marginTop: 5,
    gap: 4,
  },
  statusDot: { width: 5, height: 5, borderRadius: 2.5 },
  statusText: { fontSize: 11, fontFamily: "Outfit_600SemiBold" },
  pendingNote: { fontSize: 11, fontFamily: "Outfit_400Regular", marginTop: 3 },
  removeBtn: { padding: 4 },
  upcomingEventChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    marginTop: 4,
    gap: 4,
    borderWidth: 1,
  },
  upcomingEventText: { fontSize: 11, fontFamily: "Outfit_500Medium", flexShrink: 1 },
  unpaidChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    marginTop: 4,
    gap: 4,
    borderWidth: 1,
  },
  unpaidChipText: { fontSize: 11, fontFamily: "Outfit_500Medium" },
  upcomingCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    gap: 10,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  upcomingTitle: { fontSize: 14, fontFamily: "Outfit_600SemiBold" },
  upcomingSub: { fontSize: 12, fontFamily: "Outfit_400Regular", marginTop: 2 },
  qrShortcutCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    gap: 12,
  },
  qrShortcutIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  qrShortcutTitle: { fontSize: 15, fontFamily: "Outfit_600SemiBold" },
  qrShortcutSub: { fontSize: 12, fontFamily: "Outfit_400Regular", marginTop: 2, lineHeight: 16 },
  qrTodayBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    flexShrink: 0,
  },
  qrTodayBadgeText: { color: "#fff", fontSize: 11, fontFamily: "Outfit_600SemiBold" },
});
