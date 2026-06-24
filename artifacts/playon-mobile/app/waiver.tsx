import { palette } from "@workspace/brand";
import { getGetMyProfileQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
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

interface WaiverTemplate {
  id: number;
  name: string;
  version: number;
  body: string;
  applicableTo: string;
}

type ScreenState = "loading" | "error" | "form" | "submitting" | "success";

export default function WaiverScreen() {
  const { getToken } = useAuth();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  const baseUrl = domain ? `https://${domain}` : "";

  const [state, setState] = useState<ScreenState>("loading");
  const [template, setTemplate] = useState<WaiverTemplate | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [signatureName, setSignatureName] = useState("");
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    fetchTemplate();
  }, []);

  async function fetchTemplate() {
    setState("loading");
    try {
      const res = await fetch(`${baseUrl}/api/waivers/active`);
      if (res.status === 404) {
        setErrorMsg("No active waiver template is currently available. Please contact PlayOn staff.");
        setState("error");
        return;
      }
      if (!res.ok) {
        setErrorMsg("Failed to load the waiver. Please try again.");
        setState("error");
        return;
      }
      const data: WaiverTemplate = await res.json();
      setTemplate(data);
      setState("form");
    } catch {
      setErrorMsg("Could not connect to the server. Check your connection and try again.");
      setState("error");
    }
  }

  async function handleSubmit() {
    if (!signatureName.trim()) {
      setSubmitError("Please type your full name to sign the waiver.");
      return;
    }
    if (!template) return;

    setState("submitting");
    setSubmitError("");

    try {
      const token = await getToken();
      const res = await fetch(`${baseUrl}/api/me/waiver-signature`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          templateId: template.id,
          signatureData: signatureName.trim(),
          signatureType: "typed",
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSubmitError(body.error || "Failed to submit signature. Please try again.");
        setState("form");
        return;
      }

      await queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
      setState("success");
    } catch {
      setSubmitError("Could not connect to the server. Please try again.");
      setState("form");
    }
  }

  const canGoBack = router.canGoBack();

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) + 16,
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
          },
        ]}
      >
        {canGoBack && (
          <Pressable
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
            onPress={() => router.back()}
            hitSlop={12}
          >
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </Pressable>
        )}
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Sign Waiver</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Body */}
      {state === "loading" && (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
            Loading waiver…
          </Text>
        </View>
      )}

      {state === "error" && (
        <View style={styles.centered}>
          <View style={[styles.iconCircle, { backgroundColor: colors.destructive + "20" }]}>
            <Feather name="alert-circle" size={32} color={colors.destructive} />
          </View>
          <Text style={[styles.errorTitle, { color: colors.foreground }]}>
            Waiver Unavailable
          </Text>
          <Text style={[styles.errorBody, { color: colors.mutedForeground }]}>{errorMsg}</Text>
          <Pressable
            style={({ pressed }) => [
              styles.retryBtn,
              { backgroundColor: colors.primary },
              pressed && { opacity: 0.8 },
            ]}
            onPress={fetchTemplate}
          >
            <Text style={styles.retryBtnText}>Try again</Text>
          </Pressable>
        </View>
      )}

      {(state === "form" || state === "submitting") && template && (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.formContent, { paddingBottom: insets.bottom + 32 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Waiver info card */}
          <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.iconCircle, { backgroundColor: colors.primary + "20" }]}>
              <Feather name="shield" size={22} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.waiverName, { color: colors.foreground }]}>{template.name}</Text>
              <Text style={[styles.waiverVersion, { color: colors.mutedForeground }]}>
                Version {template.version} · PlayOn Sports
              </Text>
            </View>
          </View>

          {/* Legal text */}
          <View style={[styles.legalBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.legalText, { color: colors.foreground }]}>
              {template.body}
            </Text>
          </View>

          {/* Signature section */}
          <View style={[styles.signatureCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.signatureLabel, { color: colors.foreground }]}>
              Your full name (typed signature)
            </Text>
            <TextInput
              style={[
                styles.signatureInput,
                {
                  backgroundColor: colors.accent,
                  color: colors.foreground,
                  borderColor: submitError ? colors.destructive : colors.border,
                },
              ]}
              value={signatureName}
              onChangeText={(t) => {
                setSignatureName(t);
                if (submitError) setSubmitError("");
              }}
              placeholder="Type your full legal name"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="words"
              autoCorrect={false}
              editable={state === "form"}
              returnKeyType="done"
            />
            {!!submitError && (
              <Text style={[styles.submitError, { color: colors.destructive }]}>{submitError}</Text>
            )}
            <Text style={[styles.signatureHint, { color: colors.mutedForeground }]}>
              By typing your name above and tapping "Sign Waiver" you agree to the terms of the
              liability release above. This constitutes a legally binding electronic signature.
            </Text>
          </View>

          {/* Submit button */}
          <Pressable
            style={({ pressed }) => [
              styles.submitBtn,
              { backgroundColor: state === "submitting" ? colors.muted : colors.primary },
              pressed && state === "form" && { opacity: 0.85 },
            ]}
            onPress={handleSubmit}
            disabled={state === "submitting"}
          >
            {state === "submitting" ? (
              <ActivityIndicator color={palette.neutral50} />
            ) : (
              <>
                <Feather name="check" size={18} color={palette.neutral50} />
                <Text style={styles.submitBtnText}>Sign Waiver</Text>
              </>
            )}
          </Pressable>
        </ScrollView>
      )}

      {state === "success" && (
        <View style={styles.centered}>
          <View style={[styles.iconCircle, { backgroundColor: colors.primary + "20" }]}>
            <Feather name="check-circle" size={36} color={colors.primary} />
          </View>
          <Text style={[styles.successTitle, { color: colors.foreground }]}>Waiver Signed!</Text>
          <Text style={[styles.successBody, { color: colors.mutedForeground }]}>
            Your waiver has been recorded. You're all set to participate in PlayOn activities.
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.retryBtn,
              { backgroundColor: colors.primary },
              pressed && { opacity: 0.8 },
            ]}
            onPress={() => (canGoBack ? router.back() : router.replace("/(tabs)"))}
          >
            <Text style={styles.retryBtnText}>Back to Home</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    gap: 12,
  },
  backBtn: { padding: 2 },
  headerTitle: { fontSize: 20, fontFamily: "Outfit_700Bold", flex: 1 },
  headerSpacer: { width: 34 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: { fontSize: 15, fontFamily: "Outfit_400Regular", marginTop: 8 },
  errorTitle: { fontSize: 20, fontFamily: "Outfit_700Bold", textAlign: "center" },
  errorBody: {
    fontSize: 14,
    fontFamily: "Outfit_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },
  retryBtn: {
    marginTop: 8,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 12,
  },
  retryBtnText: {
    color: palette.neutral50,
    fontSize: 15,
    fontFamily: "Outfit_600SemiBold",
  },
  formContent: { padding: 16, gap: 14 },
  infoCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
  },
  waiverName: { fontSize: 15, fontFamily: "Outfit_600SemiBold" },
  waiverVersion: { fontSize: 12, fontFamily: "Outfit_400Regular", marginTop: 2 },
  legalBox: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  legalText: {
    fontSize: 13,
    fontFamily: "Outfit_400Regular",
    lineHeight: 20,
  },
  signatureCard: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
  },
  signatureLabel: { fontSize: 14, fontFamily: "Outfit_600SemiBold" },
  signatureInput: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: "Outfit_500Medium",
  },
  submitError: { fontSize: 13, fontFamily: "Outfit_400Regular" },
  signatureHint: { fontSize: 12, fontFamily: "Outfit_400Regular", lineHeight: 18 },
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    borderRadius: 14,
    gap: 8,
  },
  submitBtnText: {
    color: palette.neutral50,
    fontSize: 16,
    fontFamily: "Outfit_700Bold",
  },
  successTitle: { fontSize: 22, fontFamily: "Outfit_700Bold", textAlign: "center" },
  successBody: {
    fontSize: 14,
    fontFamily: "Outfit_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },
});
