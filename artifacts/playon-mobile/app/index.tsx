import { palette } from "@workspace/brand";
import { useAuth } from "@clerk/expo";
import { Href, Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";

const domain = process.env.EXPO_PUBLIC_DOMAIN;
const baseUrl = domain ? `https://${domain}` : "";

type Gate = "loading" | "tabs" | "role-select" | "waiver";

export default function Index() {
  const { isSignedIn, isLoaded, getToken } = useAuth();
  const [gate, setGate] = useState<Gate>("loading");

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      setGate("tabs");
      return;
    }

    let cancelled = false;

    async function checkProfile() {
      try {
        const token = await getToken();
        const res = await fetch(`${baseUrl}/api/me`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (!res.ok) {
          if (!cancelled) setGate("role-select");
          return;
        }

        const profile = await res.json();

        // Admin/staff bypass all completeness checks
        if (profile.role === "admin" || profile.role === "staff") {
          if (!cancelled) setGate("tabs");
          return;
        }

        const hasRoles = Array.isArray(profile.roles) && profile.roles.length > 0;
        const isManagerOnly =
          profile.roles?.includes("team_manager") &&
          !profile.roles?.includes("player") &&
          !profile.roles?.includes("team_coach");
        const waiverOk =
          isManagerOnly || (profile.waiverSigned && !profile.waiverExpired);

        if (!cancelled) {
          if (!hasRoles) {
            setGate("role-select");
          } else if (!waiverOk) {
            setGate("waiver");
          } else {
            setGate("tabs");
          }
        }
      } catch {
        if (!cancelled) setGate("tabs");
      }
    }

    checkProfile();
    return () => { cancelled = true; };
  }, [isLoaded, isSignedIn, getToken]);

  if (!isLoaded || (isSignedIn && gate === "loading")) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: palette.teal900 }}>
        <ActivityIndicator color={palette.crimson700} size="large" />
      </View>
    );
  }

  if (!isSignedIn) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  if (gate === "role-select") {
    return <Redirect href={"/(auth)/sign-up" as Href} />;
  }

  if (gate === "waiver") {
    return <Redirect href={"/waiver" as Href} />;
  }

  return <Redirect href="/(tabs)" />;
}
