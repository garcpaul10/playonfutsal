import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

const PUSH_GRANTED_KEY = "playon:push:granted";
const PUSH_TOKEN_KEY = "playon:push:token";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowList: true,
  }),
});

export type PushState = {
  granted: boolean;
  token: string | null;
  requesting: boolean;
  request: () => Promise<void>;
};

/**
 * Register the device push token with the PlayOn backend.
 * Attempts PATCH /me/player-profile so the server can fan out push events
 * (waitlist promotions, session reminders, payment confirmations, rainouts).
 * Fails silently so the UI is never blocked by a network error.
 */
async function registerTokenWithBackend(
  token: string,
  getAuthToken: () => Promise<string | null>
): Promise<void> {
  try {
    const domain = process.env.EXPO_PUBLIC_DOMAIN;
    if (!domain) return;
    const authToken = await getAuthToken();
    await fetch(`https://${domain}/api/me/player-profile`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({ pushToken: token }),
    });
  } catch {
    // Non-fatal — token is persisted in AsyncStorage for retry on next session
  }
}

export function usePushNotifications(
  getAuthToken?: () => Promise<string | null>
): PushState {
  const [granted, setGranted] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    (async () => {
      const storedGranted = await AsyncStorage.getItem(PUSH_GRANTED_KEY);
      if (storedGranted === "true") setGranted(true);
      const storedToken = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
      if (storedToken) setToken(storedToken);
    })();

    notificationListener.current = Notifications.addNotificationReceivedListener(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    });

    responseListener.current = Notifications.addNotificationResponseReceivedListener(() => {});

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, []);

  const request = async () => {
    if (Platform.OS === "web") {
      setGranted(true);
      await AsyncStorage.setItem(PUSH_GRANTED_KEY, "true");
      return;
    }
    setRequesting(true);
    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== "granted") {
        const { status } = await Notifications.requestPermissionsAsync({
          ios: {
            allowAlert: true,
            allowBadge: true,
            allowSound: true,
          },
        });
        finalStatus = status;
      }

      const isGranted = finalStatus === "granted";
      setGranted(isGranted);
      await AsyncStorage.setItem(PUSH_GRANTED_KEY, isGranted ? "true" : "false");

      if (isGranted) {
        if (Platform.OS === "android") {
          await Notifications.setNotificationChannelAsync("playon-events", {
            name: "PlayOn Events",
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 250, 250, 250],
            sound: "default",
          });
          await Notifications.setNotificationChannelAsync("playon-reminders", {
            name: "Game Reminders",
            importance: Notifications.AndroidImportance.HIGH,
            sound: "default",
          });
          await Notifications.setNotificationChannelAsync("playon-payments", {
            name: "Payments & Registration",
            importance: Notifications.AndroidImportance.DEFAULT,
            sound: "default",
          });
        }

        let deviceToken: string | null = null;
        try {
          const result = await Notifications.getDevicePushTokenAsync();
          deviceToken = result.data;
        } catch {
          deviceToken = "device-token-unavailable-in-expo-go";
        }

        if (deviceToken) {
          setToken(deviceToken);
          await AsyncStorage.setItem(PUSH_TOKEN_KEY, deviceToken);
          // Register with PlayOn backend so server can fan out push events
          if (getAuthToken) {
            await registerTokenWithBackend(deviceToken, getAuthToken);
          }
        }
      }
    } finally {
      setRequesting(false);
    }
  };

  return { granted, token, requesting, request };
}

export async function scheduleLocalReminder(
  title: string,
  body: string,
  secondsFromNow: number
) {
  if (Platform.OS === "web") return;
  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: "default" },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: secondsFromNow,
    },
  });
}
