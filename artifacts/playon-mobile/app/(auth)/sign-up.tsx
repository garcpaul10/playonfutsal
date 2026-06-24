import { palette } from "@workspace/brand";
import { useAuth, useSignUp, useOAuth } from "@clerk/expo";
import { Href, Link, useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const ROLE_OPTIONS = [
  { value: "player", label: "Player", description: "I play futsal" },
  { value: "parent", label: "Parent / Guardian", description: "My child plays" },
  { value: "team_coach", label: "Team Coach", description: "On the bench or field" },
  { value: "team_manager", label: "Team Manager", description: "Admin & registration" },
];

const domain = process.env.EXPO_PUBLIC_DOMAIN;
const baseUrl = domain ? `https://${domain}` : "";

export default function SignUpScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signUp, isLoaded, setActive } = useSignUp();
  const { getToken } = useAuth();
  const { startOAuthFlow: startAppleOAuth } = useOAuth({ strategy: "oauth_apple" });

  const [email, setEmail] = useState("");
  const [roles, setRoles] = useState<string[]>(["player"]);
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"role" | "email" | "verify">("role");
  const [loading, setLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [error, setError] = useState("");

  const handleAppleSignUp = async () => {
    setError("");
    setAppleLoading(true);
    try {
      const { createdSessionId, setActive: activate } = await startAppleOAuth();
      if (createdSessionId && activate) {
        await activate({ session: createdSessionId });
        try {
          const token = await getToken();
          await fetch(`${baseUrl}/api/me`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ roles }),
          });
        } catch {}
        router.replace("/(tabs)" as Href);
      }
    } catch (e: any) {
      const msg = e?.errors?.[0]?.longMessage || e?.errors?.[0]?.message;
      if (msg) setError(msg);
    } finally {
      setAppleLoading(false);
    }
  };

  const handleSendCode = async () => {
    if (!isLoaded || !signUp || !email) return;
    setError("");
    setLoading(true);
    try {
      await signUp.create({ emailAddress: email });
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      setStage("verify");
    } catch (e: any) {
      setError(e?.errors?.[0]?.message || "Could not send code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const toggleRole = (value: string) => {
    setRoles((prev) =>
      prev.includes(value) ? prev.filter((r) => r !== value) : [...prev, value]
    );
  };

  const handleVerify = async () => {
    if (!isLoaded || !signUp || !code) return;
    setError("");
    setLoading(true);
    try {
      const result = await signUp.attemptEmailAddressVerification({ code });
      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
        try {
          const token = await getToken();
          await fetch(`${baseUrl}/api/me`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ roles }),
          });
        } catch {}
        router.replace("/(tabs)" as Href);
      } else {
        setError("Verification could not be completed. Please try again.");
      }
    } catch (e: any) {
      setError(e?.errors?.[0]?.message || "Invalid code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!isLoaded || !signUp) return;
    try {
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
    } catch {}
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <Image
            source={require("../../assets/images/playon-logo.png")}
            style={styles.logoImage}
            resizeMode="contain"
          />
        </View>

        {stage === "role" && (
          <>
            <Text style={styles.title}>Join PlayOn</Text>
            <Text style={styles.subtitle}>What describes you? Select all that apply.</Text>

            <Text style={styles.label}>I AM A…</Text>
            <View style={styles.roleList}>
              {ROLE_OPTIONS.map((opt) => {
                const active = roles.includes(opt.value);
                return (
                  <Pressable
                    key={opt.value}
                    style={[styles.roleCard, active && styles.roleCardActive]}
                    onPress={() => toggleRole(opt.value)}
                  >
                    <View style={styles.roleCardInner}>
                      <Text style={[styles.roleCardTitle, active && styles.roleCardTitleActive]}>
                        {opt.label}
                      </Text>
                      <Text style={styles.roleCardDesc}>{opt.description}</Text>
                    </View>
                    {active && (
                      <View style={styles.roleCheckBadge}>
                        <Text style={styles.roleCheckMark}>✓</Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>

            {roles.includes("team_manager") && (
              <View style={styles.infoBox}>
                <Text style={styles.infoText}>
                  Team Managers handle admin and registration — no waiver required. Team Coaches appear on the official roster and do need to sign a waiver.
                </Text>
              </View>
            )}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              style={({ pressed }) => [
                styles.btn,
                pressed && styles.btnPressed,
                roles.length === 0 && styles.btnDisabled,
              ]}
              onPress={() => { setError(""); setStage("email"); }}
              disabled={roles.length === 0}
            >
              <Text style={styles.btnText}>Continue with email →</Text>
            </Pressable>

            {Platform.OS === "ios" && (
              <>
                <View style={styles.dividerRow}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>or</Text>
                  <View style={styles.dividerLine} />
                </View>

                <Pressable
                  style={({ pressed }) => [
                    styles.appleBtn,
                    pressed && styles.btnPressed,
                    (appleLoading || roles.length === 0) && styles.btnDisabled,
                  ]}
                  onPress={handleAppleSignUp}
                  disabled={appleLoading || roles.length === 0}
                >
                  {appleLoading ? (
                    <ActivityIndicator color="#000" />
                  ) : (
                    <Text style={styles.appleBtnText}> Sign up with Apple</Text>
                  )}
                </Pressable>
              </>
            )}

            <View style={styles.linkRow}>
              <Text style={styles.linkLabel}>Already have an account? </Text>
              <Link href="/(auth)/sign-in" asChild>
                <Pressable>
                  <Text style={styles.linkText}>Sign in</Text>
                </Pressable>
              </Link>
            </View>
          </>
        )}

        {stage === "email" && (
          <>
            <Text style={styles.title}>Enter your email</Text>
            <Text style={styles.subtitle}>
              We'll send you a verification code — no password needed.
            </Text>

            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="your@email.com"
              placeholderTextColor={palette.neutral500}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              autoFocus
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              style={({ pressed }) => [
                styles.btn,
                pressed && styles.btnPressed,
                (loading || !email) && styles.btnDisabled,
              ]}
              onPress={handleSendCode}
              disabled={loading || !email}
            >
              {loading ? (
                <ActivityIndicator color={palette.neutral50} />
              ) : (
                <Text style={styles.btnText}>Send verification code →</Text>
              )}
            </Pressable>

            <Pressable
              style={styles.backBtn}
              onPress={() => { setStage("role"); setError(""); }}
            >
              <Text style={styles.linkLabel}>← Back</Text>
            </Pressable>
          </>
        )}

        {stage === "verify" && (
          <>
            <Text style={styles.title}>Check your email</Text>
            <Text style={styles.subtitle}>
              We sent a 6-digit code to{"\n"}
              <Text style={{ color: palette.neutral100, fontFamily: "Outfit_600SemiBold" }}>{email}</Text>
            </Text>

            <TextInput
              style={[styles.input, styles.codeInput]}
              value={code}
              onChangeText={setCode}
              placeholder="000000"
              placeholderTextColor={palette.neutral600}
              keyboardType="numeric"
              autoFocus
              maxLength={6}
              textAlign="center"
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              style={({ pressed }) => [
                styles.btn,
                pressed && styles.btnPressed,
                (loading || code.length < 6) && styles.btnDisabled,
              ]}
              onPress={handleVerify}
              disabled={loading || code.length < 6}
            >
              {loading ? (
                <ActivityIndicator color={palette.neutral50} />
              ) : (
                <Text style={styles.btnText}>Verify & Create Account</Text>
              )}
            </Pressable>

            <View style={styles.linkRow}>
              <Pressable onPress={handleResend}>
                <Text style={styles.linkText}>Resend code</Text>
              </Pressable>
              <Text style={styles.linkLabel}> · </Text>
              <Pressable onPress={() => { setStage("email"); setCode(""); setError(""); }}>
                <Text style={styles.linkText}>Change email</Text>
              </Pressable>
            </View>
          </>
        )}

        <View nativeID="clerk-captcha" />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.teal900 },
  scroll: { paddingHorizontal: 28, flexGrow: 1 },
  brand: { alignItems: "center", marginBottom: 40 },
  logoImage: { width: 160, height: 72 },
  title: { color: palette.neutral100, fontSize: 24, fontFamily: "Outfit_700Bold", marginBottom: 8 },
  subtitle: { color: palette.neutral500, fontSize: 14, fontFamily: "Outfit_400Regular", marginBottom: 28, lineHeight: 20 },
  label: { color: palette.neutral500, fontSize: 13, fontFamily: "Outfit_500Medium", marginBottom: 8, marginTop: 4 },
  input: {
    backgroundColor: palette.teal700,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    fontFamily: "Outfit_400Regular",
    color: palette.neutral100,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: palette.teal500,
  },
  codeInput: {
    fontSize: 28,
    fontFamily: "Outfit_700Bold",
    letterSpacing: 10,
    textAlign: "center",
    marginBottom: 14,
  },
  appleBtn: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
  },
  appleBtnText: { color: "#000000", fontSize: 16, fontFamily: "Outfit_600SemiBold" },
  dividerRow: { flexDirection: "row", alignItems: "center", marginVertical: 14 },
  dividerLine: { flex: 1, height: 1, backgroundColor: palette.teal500 },
  dividerText: { color: palette.neutral500, fontSize: 13, fontFamily: "Outfit_400Regular", marginHorizontal: 12 },
  btn: {
    backgroundColor: palette.crimson700,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 4,
  },
  btnPressed: { opacity: 0.8 },
  btnDisabled: { opacity: 0.45 },
  btnText: { color: palette.neutral50, fontSize: 16, fontFamily: "Outfit_600SemiBold" },
  error: { color: "#F03232", fontSize: 13, fontFamily: "Outfit_400Regular", marginBottom: 8, textAlign: "center" },
  linkRow: { flexDirection: "row", justifyContent: "center", marginTop: 20, alignItems: "center" },
  linkLabel: { color: palette.neutral500, fontSize: 14, fontFamily: "Outfit_400Regular" },
  linkText: { color: palette.crimson500, fontSize: 14, fontFamily: "Outfit_600SemiBold" },
  roleList: { gap: 10, marginBottom: 20 },
  roleCard: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.teal500,
    backgroundColor: palette.teal700,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  roleCardActive: {
    borderColor: palette.crimson500,
    backgroundColor: palette.crimson700 + "30",
  },
  roleCardInner: { flex: 1 },
  roleCardTitle: { color: palette.neutral500, fontSize: 14, fontFamily: "Outfit_500Medium" },
  roleCardTitleActive: { color: palette.crimson500, fontFamily: "Outfit_700Bold" },
  roleCardDesc: { color: palette.neutral600, fontSize: 12, fontFamily: "Outfit_400Regular", marginTop: 2 },
  roleCheckBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: palette.crimson500,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 10,
  },
  roleCheckMark: { color: palette.neutral50, fontSize: 12, fontFamily: "Outfit_700Bold" },
  infoBox: {
    backgroundColor: palette.teal700,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.teal500,
    padding: 12,
    marginBottom: 16,
  },
  infoText: { color: palette.neutral500, fontSize: 12, fontFamily: "Outfit_400Regular", lineHeight: 18 },
  backBtn: { alignItems: "center", marginTop: 16 },
});
