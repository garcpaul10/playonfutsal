import { palette } from "@workspace/brand";
import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
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

const domain = process.env.EXPO_PUBLIC_DOMAIN;
const BASE_URL = domain ? `https://${domain}` : "";

type ChildDetail = {
  child: {
    id: number;
    firstName: string | null;
    lastName: string | null;
    dateOfBirth: string | null;
    relationship: string;
  };
  registrations: Array<{
    id: number;
    programType: string;
    programName: string | null;
    status: string;
    paymentStatus: string;
    amountPaid: string;
    createdAt: string;
  }>;
  campRegistrations: Array<{
    id: number;
    campName: string;
    startDate: string | null;
    endDate: string | null;
    status: string;
    paymentStatus: string;
    pricePaid: string | null;
    createdAt: string;
  }>;
  dropinSpots: Array<{
    id: number;
    dropinName: string;
    startsAt: string;
    status: string;
    paymentStatus: string;
    createdAt: string;
  }>;
};

type EditForm = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship: string;
  primaryPosition: string;
};

function paymentColor(status: string) {
  if (status === "paid") return "#22C55E";
  if (status === "partial") return "#F59E0B";
  return "#EF4444";
}

function paymentLabel(status: string) {
  if (status === "paid") return "Paid";
  if (status === "partial") return "Partial";
  return "Unpaid";
}

function formatDate(dt: string | null | undefined) {
  if (!dt) return "TBD";
  return new Date(dt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function dobToDisplay(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

function FieldInput({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  colors,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "phone-pad";
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={fieldStyles.wrapper}>
      <Text style={[fieldStyles.label, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        style={[
          fieldStyles.input,
          { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border },
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        keyboardType={keyboardType ?? "default"}
      />
    </View>
  );
}

const fieldStyles = StyleSheet.create({
  wrapper: { marginBottom: 12 },
  label: { fontSize: 12, fontFamily: "Outfit_600SemiBold", marginBottom: 4, letterSpacing: 0.3 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "Outfit_400Regular",
  },
});

export default function ChildDetailScreen() {
  const { youthUserId } = useLocalSearchParams<{ youthUserId: string }>();
  const { getToken } = useAuth();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [data, setData] = useState<ChildDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<EditForm>({
    firstName: "",
    lastName: "",
    dateOfBirth: "",
    gender: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    emergencyContactRelationship: "",
    primaryPosition: "",
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  async function loadData() {
    if (!youthUserId) return;
    setLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(
        `${BASE_URL}/api/family-dashboard/child/${youthUserId}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
      if (res.ok) {
        setData(await res.json());
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Failed to load child details");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [youthUserId]);

  function openEdit() {
    const child = data?.child;
    setForm({
      firstName: child?.firstName ?? "",
      lastName: child?.lastName ?? "",
      dateOfBirth: dobToDisplay(child?.dateOfBirth),
      gender: "",
      emergencyContactName: "",
      emergencyContactPhone: "",
      emergencyContactRelationship: "",
      primaryPosition: "",
    });
    setSaveError("");
    setEditOpen(true);
  }

  async function handleSave() {
    if (!youthUserId) return;
    setSaving(true);
    setSaveError("");
    try {
      const token = await getToken();
      const body: Record<string, string> = {};
      if (form.firstName) body.firstName = form.firstName;
      if (form.lastName) body.lastName = form.lastName;
      if (form.dateOfBirth) body.dateOfBirth = form.dateOfBirth;
      if (form.gender) body.gender = form.gender;
      if (form.emergencyContactName) body.emergencyContactName = form.emergencyContactName;
      if (form.emergencyContactPhone) body.emergencyContactPhone = form.emergencyContactPhone;
      if (form.emergencyContactRelationship) body.emergencyContactRelationship = form.emergencyContactRelationship;
      if (form.primaryPosition) body.primaryPosition = form.primaryPosition;

      const res = await fetch(`${BASE_URL}/api/youth/${youthUserId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setSaveError(err.error ?? "Failed to save changes");
        return;
      }

      setEditOpen(false);
      await loadData();
    } catch {
      setSaveError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0) + 12;
  const child = data?.child;
  const displayName =
    [child?.firstName, child?.lastName].filter(Boolean).join(" ") || "Child";

  const totalRegs =
    (data?.registrations.length ?? 0) +
    (data?.campRegistrations.length ?? 0) +
    (data?.dropinSpots.length ?? 0);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          { paddingTop: topPad, backgroundColor: colors.background },
        ]}
      >
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
          {displayName}
        </Text>
        {!loading && data && (
          <Pressable onPress={openEdit} style={styles.editBtn} hitSlop={8}>
            <Feather name="edit-2" size={18} color={colors.primary} />
          </Pressable>
        )}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : error ? (
        <View style={styles.errorBox}>
          <Feather name="alert-circle" size={20} color="#EF4444" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : !data ? null : (
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 8,
            paddingBottom: Platform.OS === "web" ? 40 : 100,
            gap: 20,
          }}
          showsVerticalScrollIndicator={false}
        >
          {/* Profile card */}
          <View style={[styles.profileCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
              <Text style={styles.avatarText}>
                {(child?.firstName?.[0] ?? "?").toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.profileName, { color: colors.foreground }]}>{displayName}</Text>
              {child?.relationship && (
                <Text style={[styles.profileSub, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {child.relationship.charAt(0).toUpperCase() + child.relationship.slice(1)}
                </Text>
              )}
              {child?.dateOfBirth && (
                <Text style={[styles.profileSub, { color: colors.mutedForeground }]}>
                  Born {formatDate(child.dateOfBirth)}
                </Text>
              )}
            </View>
            <View style={[styles.regBadge, { backgroundColor: colors.primary + "18" }]}>
              <Text style={[styles.regBadgeNum, { color: colors.primary }]}>{totalRegs}</Text>
              <Text style={[styles.regBadgeLabel, { color: colors.primary }]}>registrations</Text>
            </View>
          </View>

          {/* League/Tournament registrations */}
          {data.registrations.length > 0 && (
            <View>
              <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
                LEAGUES & TOURNAMENTS
              </Text>
              {data.registrations.map((reg) => (
                <View
                  key={reg.id}
                  style={[styles.regCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <View style={[styles.regIcon, { backgroundColor: colors.primary + "18" }]}>
                    <Feather name="award" size={16} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.regTitle, { color: colors.foreground }]} numberOfLines={1}>
                      {reg.programName ?? `Registration #${reg.id}`}
                    </Text>
                    <Text style={[styles.regMeta, { color: colors.mutedForeground }]}>
                      {reg.programType} · {formatDate(reg.createdAt)}
                    </Text>
                  </View>
                  <View style={[styles.payChip, { backgroundColor: paymentColor(reg.paymentStatus) + "20" }]}>
                    <Text style={[styles.payChipText, { color: paymentColor(reg.paymentStatus) }]}>
                      {paymentLabel(reg.paymentStatus)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Camp registrations */}
          {data.campRegistrations.length > 0 && (
            <View>
              <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>CAMPS</Text>
              {data.campRegistrations.map((cr) => (
                <View
                  key={cr.id}
                  style={[styles.regCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <View style={[styles.regIcon, { backgroundColor: "#8B5CF620" }]}>
                    <Feather name="sun" size={16} color="#8B5CF6" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.regTitle, { color: colors.foreground }]} numberOfLines={1}>
                      {cr.campName}
                    </Text>
                    <Text style={[styles.regMeta, { color: colors.mutedForeground }]}>
                      {formatDate(cr.startDate)}
                      {cr.endDate && cr.endDate !== cr.startDate ? ` – ${formatDate(cr.endDate)}` : ""}
                    </Text>
                  </View>
                  <View style={[styles.payChip, { backgroundColor: paymentColor(cr.paymentStatus) + "20" }]}>
                    <Text style={[styles.payChipText, { color: paymentColor(cr.paymentStatus) }]}>
                      {paymentLabel(cr.paymentStatus)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Drop-in spots */}
          {data.dropinSpots.length > 0 && (
            <View>
              <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>DROP-INS</Text>
              {data.dropinSpots.map((spot) => (
                <View
                  key={spot.id}
                  style={[styles.regCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <View style={[styles.regIcon, { backgroundColor: "#F59E0B20" }]}>
                    <Feather name="zap" size={16} color="#F59E0B" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.regTitle, { color: colors.foreground }]} numberOfLines={1}>
                      {spot.dropinName}
                    </Text>
                    <Text style={[styles.regMeta, { color: colors.mutedForeground }]}>
                      {formatDate(spot.startsAt)}
                    </Text>
                  </View>
                  <View style={[styles.payChip, { backgroundColor: paymentColor(spot.paymentStatus) + "20" }]}>
                    <Text style={[styles.payChipText, { color: paymentColor(spot.paymentStatus) }]}>
                      {paymentLabel(spot.paymentStatus)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {totalRegs === 0 && (
            <View style={[styles.emptyBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="inbox" size={28} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                No registrations yet
              </Text>
            </View>
          )}
        </ScrollView>
      )}

      {/* Edit Modal */}
      <Modal
        visible={editOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setEditOpen(false)}
      >
        <KeyboardAvoidingView
          style={[styles.modalContainer, { backgroundColor: colors.background }]}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          {/* Modal Header */}
          <View style={[styles.modalHeader, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
            <Pressable onPress={() => setEditOpen(false)} hitSlop={8}>
              <Text style={[styles.modalCancel, { color: colors.mutedForeground }]}>Cancel</Text>
            </Pressable>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Edit Profile</Text>
            <Pressable onPress={handleSave} disabled={saving} hitSlop={8}>
              <Text style={[styles.modalSave, { color: saving ? colors.mutedForeground : colors.primary }]}>
                {saving ? "Saving…" : "Save"}
              </Text>
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={[styles.sectionHeading, { color: colors.mutedForeground }]}>BASIC INFO</Text>

            <FieldInput label="First Name" value={form.firstName} onChangeText={(v) => setForm((f) => ({ ...f, firstName: v }))} placeholder="First name" colors={colors} />
            <FieldInput label="Last Name" value={form.lastName} onChangeText={(v) => setForm((f) => ({ ...f, lastName: v }))} placeholder="Last name" colors={colors} />
            <FieldInput label="Date of Birth" value={form.dateOfBirth} onChangeText={(v) => setForm((f) => ({ ...f, dateOfBirth: v }))} placeholder="MM/DD/YYYY" colors={colors} />
            <FieldInput label="Gender" value={form.gender} onChangeText={(v) => setForm((f) => ({ ...f, gender: v }))} placeholder="e.g. Male, Female, Non-binary" colors={colors} />
            <FieldInput label="Primary Position" value={form.primaryPosition} onChangeText={(v) => setForm((f) => ({ ...f, primaryPosition: v }))} placeholder="e.g. Forward, Goalkeeper" colors={colors} />

            <Text style={[styles.sectionHeading, { color: colors.mutedForeground, marginTop: 8 }]}>EMERGENCY CONTACT</Text>

            <FieldInput label="Contact Name" value={form.emergencyContactName} onChangeText={(v) => setForm((f) => ({ ...f, emergencyContactName: v }))} placeholder="Full name" colors={colors} />
            <FieldInput label="Phone" value={form.emergencyContactPhone} onChangeText={(v) => setForm((f) => ({ ...f, emergencyContactPhone: v }))} placeholder="(555) 000-0000" keyboardType="phone-pad" colors={colors} />
            <FieldInput label="Relationship" value={form.emergencyContactRelationship} onChangeText={(v) => setForm((f) => ({ ...f, emergencyContactRelationship: v }))} placeholder="e.g. Mother, Coach" colors={colors} />

            {saveError !== "" && (
              <View style={styles.errorInline}>
                <Feather name="alert-circle" size={14} color="#EF4444" />
                <Text style={styles.errorInlineText}>{saveError}</Text>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
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
  editBtn: { padding: 4 },
  title: { flex: 1, fontSize: 22, fontFamily: "Outfit_700Bold" },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    margin: 24,
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#EF444418",
  },
  errorText: { color: "#EF4444", fontSize: 14, fontFamily: "Outfit_400Regular", flex: 1 },
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: palette.neutral50, fontSize: 20, fontFamily: "Outfit_700Bold" },
  profileName: { fontSize: 17, fontFamily: "Outfit_700Bold" },
  profileSub: { fontSize: 12, fontFamily: "Outfit_400Regular" },
  regBadge: {
    borderRadius: 10,
    padding: 10,
    alignItems: "center",
    minWidth: 60,
  },
  regBadgeNum: { fontSize: 20, fontFamily: "Outfit_700Bold" },
  regBadgeLabel: { fontSize: 10, fontFamily: "Outfit_500Medium", marginTop: 1 },
  sectionTitle: {
    fontSize: 12,
    fontFamily: "Outfit_600SemiBold",
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 4,
  },
  regCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
  },
  regIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  regTitle: { fontSize: 14, fontFamily: "Outfit_600SemiBold" },
  regMeta: { fontSize: 12, fontFamily: "Outfit_400Regular", marginTop: 2 },
  payChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  payChipText: { fontSize: 11, fontFamily: "Outfit_600SemiBold" },
  emptyBox: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 32,
    alignItems: "center",
    gap: 10,
  },
  emptyText: { fontSize: 14, fontFamily: "Outfit_400Regular" },
  // Modal styles
  modalContainer: { flex: 1 },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: { fontSize: 17, fontFamily: "Outfit_700Bold" },
  modalCancel: { fontSize: 15, fontFamily: "Outfit_400Regular" },
  modalSave: { fontSize: 15, fontFamily: "Outfit_700Bold" },
  sectionHeading: {
    fontSize: 11,
    fontFamily: "Outfit_600SemiBold",
    letterSpacing: 0.5,
    marginBottom: 10,
    marginTop: 4,
  },
  errorInline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#EF444418",
  },
  errorInlineText: { color: "#EF4444", fontSize: 13, fontFamily: "Outfit_400Regular", flex: 1 },
});
