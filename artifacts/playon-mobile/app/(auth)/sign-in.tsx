import { palette } from "@workspace/brand";
import { useSignIn, useOAuth } from "@clerk/expo";
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

type Stage = "enter-email" | "enter-code" | "enter-password";

export default function SignInScreen() {
  const { signIn, isLoaded, setActive } = useSignIn();
  const { startOAuthFlow: startAppleOAuth } = useOAuth({ strategy: "oauth_apple" });
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [stage, setStage] = useState<Stage>("enter-email");
  const [usePassword, setUsePassword] = useState(true);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);

  function toggleMethod() {
    setUsePassword((v) => !v);
    setError("");
  }

  async function handleAppleSignIn() {
    setError("");
    setAppleLoading(true);
    try {
      const { createdSessionId, setActive: activate } = await startAppleOAuth();
      if (createdSessionId && activate) {
        await activate({ session: createdSessionId });
        router.replace("/" as Href);
      }
    } catch (e: any) {
      const msg = e?.errors?.[0]?.longMessage || e?.errors?.[0]?.message;
      if (msg) setError(msg);
    } finally {
      setAppleLoading(false);
    }
  }

  async function handleEmailSubmit() {
    if (!isLoaded || !signIn) return;
    setError("");
    setLoading(true);
    try {
      if (usePassword) {
        const result = await signIn.create({ identifier: email, password });
        if (result.status === "complete") {
          await setActive({ session: result.createdSessionId });
          router.replace("/" as Href);
        } else {
          setError("Sign-in could not be completed. Please try again.");
        }
      } else {
        await signIn.create({ strategy: "email_code", identifier: email });
        setCode("");
        setStage("enter-code");
      }
    } catch (e: any) {
      setError(e?.errors?.[0]?.longMessage || e?.errors?.[0]?.message || "Sign in failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyCode() {
    if (!isLoaded || !signIn) return;
    setError("");
    setLoading(true);
    try {
      const result = await signIn.attemptFirstFactor({
        strategy: "email_code",
        code,
      });
      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
        router.replace("/" as Href);
      } else {
        setError("Verification could not be completed. Please try again.");
      }
    } catch (e: any) {
      setError(e?.errors?.[0]?.longMessage || e?.errors?.[0]?.message || "Invalid or expired code.");
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (!isLoaded || !signIn) return;
    setError("");
    try {
      await signIn.create({ strategy: "email_code", identifier: email });
      setCode("");
    } catch (e: any) {
      setError(e?.errors?.[0]?.message || "Could not resend code.");
    }
  }

  const isSubmitDisabled =
    loading ||
    !email ||
    (usePassword && !password);

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
          <Text style={styles.tagline}>Futsal in Lexington, KY</Text>
        </View>

        {stage === "enter-email" && (
          <>
            <Text style={styles.title}>Welcome back</Text>
            <Text style={styles.subtitle}>Sign in to your PlayOn account</Text>

            {Platform.OS === "ios" && (
              <>
                <Pressable
                  style={({ pressed }) => [
                    styles.appleBtn,
                    pressed && styles.btnPressed,
                    appleLoading && styles.btnDisabled,
                  ]}
                  onPress={handleAppleSignIn}
                  disabled={appleLoading}
                >
                  {appleLoading ? (
                    <ActivityIndicator color="#000" />
                  ) : (
                    <Text style={styles.appleBtnText}> Sign in with Apple</Text>
                  )}
                </Pressable>

                <View style={styles.dividerRow}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>or</Text>
                  <View style={styles.dividerLine} />
                </View>
              </>
            )}

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
            />

            {usePassword && (
              <>
                <Text style={styles.label}>Password</Text>
                <TextInput
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  placeholderTextColor={palette.neutral500}
                  secureTextEntry
                  autoComplete="password"
                />
              </>
            )}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              style={({ pressed }) => [
                styles.btn,
                pressed && styles.btnPressed,
                isSubmitDisabled && styles.btnDisabled,
              ]}
              onPress={handleEmailSubmit}
              disabled={isSubmitDisabled}
            >
              {loading ? (
                <ActivityIndicator color={palette.neutral50} />
              ) : (
                <Text style={styles.btnText}>
                  {usePassword ? "Sign in" : "Send code"}
                </Text>
              )}
            </Pressable>

            {!usePassword && (
              <Text style={styles.hint}>
                We'll email you a 6-digit code — no password needed.
              </Text>
            )}

            <Pressable onPress={toggleMethod} style={styles.toggleRow}>
              <Text style={styles.toggleText}>
                {usePassword ? "Sign in with email code instead" : "Sign in with password instead"}
              </Text>
            </Pressable>

            <View style={styles.linkRow}>
              <Text style={styles.linkLabel}>New to PlayOn? </Text>
              <Link href="/(auth)/sign-up" asChild>
                <Pressable>
                  <Text style={styles.linkText}>Create account</Text>
                </Pressable>
              </Link>
            </View>
          </>
        )}

        {stage === "enter-code" && (
          <>
            <Text style={styles.title}>Check your email</Text>
            <Text style={styles.subtitle}>
              We sent a 6-digit code to{" "}
              <Text style={{ color: palette.neutral100, fontFamily: "Outfit_600SemiBold" }}>
                {email}
              </Text>
              . Enter it below to sign in.
            </Text>

            <Text style={styles.label}>6-digit code</Text>
            <TextInput
              style={[styles.input, styles.codeInput]}
              value={code}
              onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              placeholderTextColor={palette.neutral500}
              keyboardType="numeric"
              autoFocus
              autoComplete="one-time-code"
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              style={({ pressed }) => [
                styles.btn,
                pressed && styles.btnPressed,
                (loading || code.length < 6) && styles.btnDisabled,
              ]}
              onPress={handleVerifyCode}
              disabled={loading || code.length < 6}
            >
              {loading ? (
                <ActivityIndicator color={palette.neutral50} />
              ) : (
                <Text style={styles.btnText}>Verify & sign in</Text>
              )}
            </Pressable>

            <Pressable onPress={handleResend} style={styles.linkRow}>
              <Text style={styles.linkText}>Resend code</Text>
            </Pressable>

            <Pressable onPress={() => { setStage("enter-email"); setError(""); }} style={styles.linkRow}>
              <Text style={styles.toggleText}>← Back</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.teal900 },
  scroll: { paddingHorizontal: 28, flexGrow: 1 },
  brand: { alignItems: "center", marginBottom: 44 },
  logoImage: { width: 160, height: 72, marginBottom: 8 },
  tagline: { color: palette.neutral500, fontSize: 14, fontFamily: "Outfit_400Regular", marginTop: 4 },
  title: { color: palette.neutral100, fontSize: 24, fontFamily: "Outfit_700Bold", marginBottom: 6 },
  subtitle: { color: palette.neutral500, fontSize: 15, fontFamily: "Outfit_400Regular", marginBottom: 28 },
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
    textAlign: "center",
    letterSpacing: 8,
    fontSize: 22,
  },
  appleBtn: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
    marginBottom: 4,
  },
  appleBtnText: { color: "#000000", fontSize: 16, fontFamily: "Outfit_600SemiBold" },
  dividerRow: { flexDirection: "row", alignItems: "center", marginVertical: 16 },
  dividerLine: { flex: 1, height: 1, backgroundColor: palette.teal500 },
  dividerText: { color: palette.neutral500, fontSize: 13, fontFamily: "Outfit_400Regular", marginHorizontal: 12 },
  btn: {
    backgroundColor: palette.crimson700,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  btnPressed: { opacity: 0.8 },
  btnDisabled: { opacity: 0.45 },
  btnText: { color: palette.neutral50, fontSize: 16, fontFamily: "Outfit_600SemiBold" },
  error: { color: "#F03232", fontSize: 13, fontFamily: "Outfit_400Regular", marginBottom: 8, textAlign: "center" },
  hint: { color: palette.neutral500, fontSize: 12, fontFamily: "Outfit_400Regular", textAlign: "center", marginTop: 10 },
  toggleRow: { alignItems: "center", marginTop: 16 },
  toggleText: { color: palette.neutral500, fontSize: 14, fontFamily: "Outfit_400Regular" },
  linkRow: { flexDirection: "row", justifyContent: "center", marginTop: 20, alignItems: "center" },
  linkLabel: { color: palette.neutral500, fontSize: 14, fontFamily: "Outfit_400Regular" },
  linkText: { color: palette.crimson500, fontSize: 14, fontFamily: "Outfit_600SemiBold" },
});
