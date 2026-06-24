import { palette } from "@workspace/brand";
import { useAuth } from "@clerk/expo";
import {
  setAuthTokenGetter,
  useGetCamp,
  useGetDropin,
  useGetLeague,
  useGetTournament,
  useGetMyProfile,
  getGetLeagueQueryKey,
  getGetCampQueryKey,
  getGetDropinQueryKey,
  getGetTournamentQueryKey,
} from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import * as Sharing from "expo-sharing";
import * as WebBrowser from "expo-web-browser";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { checkEligibility } from "@/lib/eligibility";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { scheduleLocalReminder } from "@/hooks/usePushNotifications";

const ACTIVE_BUFFER_MS = 30 * 60 * 1000;
function computeIsEventActive(event: any): boolean {
  if (!event) return false;
  if (event.activeOverride === "active") return true;
  if (event.activeOverride === "closed") return false;
  if (!event.startsAt) return false;
  const start = new Date(event.startsAt).getTime();
  let end: number | null = null;
  if (event.endsAt) end = new Date(event.endsAt).getTime();
  else if (event.durationMinutes) end = start + Number(event.durationMinutes) * 60 * 1000;
  if (end === null) return false;
  const now = Date.now();
  return now >= start - ACTIVE_BUFFER_MS && now <= end + ACTIVE_BUFFER_MS;
}

const TYPE_LABELS: Record<string, string> = {
  league: "League",
  camp: "Camp",
  drop_in: "Drop-in Session",
  tournament: "Tournament",
};

const TYPE_ICONS: Record<string, string> = {
  league: "list",
  camp: "sun",
  drop_in: "zap",
  tournament: "award",
};

const MOBILE_AGE_RANGES: Record<string, { min: number; max: number }> = {
  u8:  { min: 8,  max: 8  }, u9:  { min: 9,  max: 9  }, u10: { min: 10, max: 10 },
  u11: { min: 11, max: 11 }, u12: { min: 12, max: 12 }, u13: { min: 13, max: 13 },
  u14: { min: 14, max: 14 }, u15: { min: 15, max: 15 }, u16: { min: 16, max: 16 },
  u17: { min: 17, max: 17 }, u18: { min: 18, max: 18 }, adult: { min: 18, max: 999 },
  u8_u11: { min: 8, max: 11 }, u12_u15: { min: 12, max: 15 },
};

function mobileAgeAtDate(dobStr: string, refDate: Date): number {
  const dob = new Date(dobStr);
  let age = refDate.getFullYear() - dob.getFullYear();
  const m = refDate.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && refDate.getDate() < dob.getDate())) age--;
  return age;
}

function mobileIsEligibleForPool(ageGroup: string, dob: string | null | undefined, startsAt?: string | null): boolean {
  const range = MOBILE_AGE_RANGES[ageGroup];
  if (!range) return true;
  if (!dob) return false;
  const refDate = startsAt ? new Date(startsAt) : new Date();
  const age = mobileAgeAtDate(dob, refDate);
  return age >= range.min && age <= range.max;
}

function formatDate(d?: string | null) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return d;
  }
}

function formatPrice(cents?: number | null) {
  if (!cents && cents !== 0) return null;
  return `$${(cents / 100).toFixed(2)}`;
}

function formatTime(d?: string | Date | null) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/New_York",
    }) + " ET";
  } catch {
    return null;
  }
}

function toIcsDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

function buildIcsContent(opts: {
  summary: string;
  location: string;
  description: string;
  startDate: Date;
  endDate: Date;
}): string {
  const uid = `playon-${Date.now()}@playon.app`;
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PlayOn//PlayOn Mobile//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${toIcsDate(new Date())}`,
    `DTSTART:${toIcsDate(opts.startDate)}`,
    `DTEND:${toIcsDate(opts.endDate)}`,
    `SUMMARY:${opts.summary}`,
    `LOCATION:${opts.location}`,
    `DESCRIPTION:${opts.description}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

async function addToCalendar(opts: {
  title: string;
  startsAt: string | null | undefined;
  durationMinutes: number;
  courtName?: string;
}): Promise<void> {
  const startDate = opts.startsAt ? new Date(opts.startsAt) : new Date();
  const endDate = new Date(startDate.getTime() + opts.durationMinutes * 60 * 1000);
  const court = opts.courtName ? ` — ${opts.courtName}` : "";
  const icsContent = buildIcsContent({
    summary: `${opts.title}${court}`,
    location: "Alumni Center, Lexington, KY",
    description: `PlayOn drop-in session: ${opts.title}${court}`,
    startDate,
    endDate,
  });

  if (Platform.OS === "web") {
    const blob = new Blob([icsContent], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "playon-session.ics";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return;
  }

  const fileUri = `${FileSystem.cacheDirectory}playon-session-${Date.now()}.ics`;
  await FileSystem.writeAsStringAsync(fileUri, icsContent, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  await Sharing.shareAsync(fileUri, {
    mimeType: "text/calendar",
    dialogTitle: "Add to Calendar",
    UTI: "public.calendar-event",
  });
}

type Pool = {
  id: number;
  courtName?: string;
  cap?: number;
  capacity?: number;
  spotsTaken?: number;
  isWaitlist?: boolean;
  ageGroup?: string;
  skillLevel?: string;
  startsAt?: string | null;
};

const WAIVER_TEXT =
  "I understand that futsal and related sports involve inherent risks of injury. " +
  "I voluntarily assume all risks and release the Alumni Center, PlayOn, its staff, " +
  "and volunteers from any liability arising from participation. I confirm that the " +
  "participant is medically fit to participate and I have read and agree to the full " +
  "PlayOn Terms of Participation.";

export default function ProgramDetailScreen() {
  const { getToken } = useAuth();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { id, type } = useLocalSearchParams<{ id: string; type: string }>();
  const [registering, setRegistering] = useState(false);
  const [pools, setPools] = useState<Pool[]>([]);
  const [poolsLoading, setPoolsLoading] = useState(false);
  const [myDropinSpots, setMyDropinSpots] = useState<any[]>([]);
  const [selectedPool, setSelectedPool] = useState<number | null>(null);
  const [rsvpResult, setRsvpResult] = useState<string | null>(null);
  const [calendarAdding, setCalendarAdding] = useState<number | null>(null);
  const [pendingPool, setPendingPool] = useState<Pool | null>(null);
  const [selectedChildId, setSelectedChildId] = useState<number | null>(null);
  const [guardianLinks, setGuardianLinks] = useState<any[]>([]);
  const [guardianLinksLoading, setGuardianLinksLoading] = useState(false);
  const [childWaiverStatus, setChildWaiverStatus] = useState<{ hasSigned: boolean; isExpired: boolean } | null>(null);
  const [childWaiverLoading, setChildWaiverLoading] = useState(false);
  const [waiverAccepted, setWaiverAccepted] = useState(false);
  const [waiverExpanded, setWaiverExpanded] = useState(false);
  const [isRegistered, setIsRegistered] = useState(false);
  const [lbMetric, setLbMetric] = useState<"goals" | "assists" | "games" | "streak">("goals");

  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  const baseUrl = domain ? `https://${domain}` : "";

  useEffect(() => {
    setAuthTokenGetter(() => getToken());
  }, [getToken]);

  const numId = Number(id) || 0;

  const lbEntityType = type === "league" ? "league" : type === "tournament" ? "tournament" : type === "drop_in" ? "dropin" : null;
  const { data: lbData, isLoading: lbLoading } = useQuery({
    queryKey: ["event-leaderboard", lbEntityType, numId, lbMetric],
    enabled: !!lbEntityType && numId > 0,
    queryFn: async () => {
      const res = await fetch(
        `${baseUrl}/api/player-stats/leaderboard?entityType=${lbEntityType}&entityId=${numId}&metric=${lbMetric}&limit=10`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load leaderboard");
      return json as any[];
    },
  });

  const { data: league, isLoading: lLoad } = useGetLeague(numId, {
    query: { enabled: type === "league" && numId > 0, queryKey: getGetLeagueQueryKey(numId) },
  });
  const { data: camp, isLoading: cLoad } = useGetCamp(numId, {
    query: { enabled: type === "camp" && numId > 0, queryKey: getGetCampQueryKey(numId) },
  });
  const { data: dropin, isLoading: dLoad } = useGetDropin(numId, {
    query: { enabled: type === "drop_in" && numId > 0, queryKey: getGetDropinQueryKey(numId) },
  });
  const { data: tournament, isLoading: tLoad } = useGetTournament(numId, {
    query: { enabled: type === "tournament" && numId > 0, queryKey: getGetTournamentQueryKey(numId) },
  });

  const isLoading = lLoad || cLoad || dLoad || tLoad;
  const program: any = league || camp || dropin || tournament;

  const needsWaiver = type === "league" || type === "camp" || type === "tournament";

  // Load current user profile for eligibility check
  const { data: myProfile } = useGetMyProfile();

  // Compute eligibility when program data is available
  const eligibilityRules = program?.eligibilityRules ?? program?.ageRules ?? null;
  const eligibility = eligibilityRules
    ? checkEligibility(
        (myProfile as any)?.dateOfBirth,
        (myProfile as any)?.state,
        eligibilityRules,
        undefined
      )
    : null;

  useEffect(() => {
    if (type !== "drop_in" || !numId) return;
    fetchPools();
  }, [type, numId]);

  useEffect(() => {
    if ((type !== "league" && type !== "tournament") || !numId) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const endpoint = type === "league"
          ? `${baseUrl}/api/leagues/${numId}/is-registered`
          : `${baseUrl}/api/tournaments/${numId}/is-registered`;
        const res = await fetch(endpoint, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!cancelled && res.ok) {
          const data = await res.json();
          setIsRegistered(data.isRegistered);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [type, numId]);

  const fetchPools = async () => {
    setPoolsLoading(true);
    try {
      const token = await getToken();
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const [poolsRes, spotsRes] = await Promise.all([
        fetch(`${baseUrl}/api/dropins/${numId}/pools`, { headers }),
        fetch(`${baseUrl}/api/dropins/${numId}/my-spots`, { headers }),
      ]);
      if (poolsRes.ok) {
        const data = await poolsRes.json();
        setPools(Array.isArray(data) ? data : data.pools || []);
      }
      if (spotsRes.ok) {
        const spots = await spotsRes.json();
        setMyDropinSpots(Array.isArray(spots) ? spots : []);
      }
    } catch {}
    setPoolsLoading(false);
  };

  const fetchGuardianLinks = async () => {
    setGuardianLinksLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${baseUrl}/api/me/guardian-links`, {
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (res.ok) setGuardianLinks(await res.json());
    } catch {}
    setGuardianLinksLoading(false);
  };

  useEffect(() => {
    if (!selectedChildId) {
      setChildWaiverStatus(null);
      return;
    }
    let cancelled = false;
    setChildWaiverLoading(true);
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${baseUrl}/api/me/waiver-status?youthUserId=${selectedChildId}`, {
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        if (!cancelled) {
          if (res.ok) {
            setChildWaiverStatus(await res.json());
          } else {
            setChildWaiverStatus({ hasSigned: false, isExpired: true });
          }
        }
      } catch {
        if (!cancelled) setChildWaiverStatus({ hasSigned: false, isExpired: true });
      }
      if (!cancelled) setChildWaiverLoading(false);
    })();
    return () => { cancelled = true; };
  }, [selectedChildId, baseUrl]);

  const handleDropinRsvp = async (poolId: number, playerUserId?: number) => {
    setSelectedPool(poolId);
    setRegistering(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const token = await getToken();
      const res = await fetch(`${baseUrl}/api/dropins/pools/${poolId}/rsvp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: playerUserId ? JSON.stringify({ playerUserId }) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        const isWaitlist = data.status === "waitlisted" || data.waitlisted;
        setRsvpResult(
          isWaitlist
            ? "You've been added to the waitlist. We'll notify you if a spot opens up!"
            : "You're registered! See you on the court."
        );
        if (!isWaitlist && program?.sessionDate) {
          try {
            const sessionMs = new Date(program.sessionDate).getTime() - Date.now() - 3600_000;
            if (sessionMs > 0) {
              await scheduleLocalReminder(
                "Drop-in starts soon",
                "Your PlayOn drop-in session starts in 1 hour.",
                sessionMs / 1000
              );
            }
          } catch {}
        }
        await fetchPools();
      } else {
        Alert.alert("RSVP failed", data.error || "Could not reserve your spot. Please try again.");
      }
    } catch {
      Alert.alert("Error", "Network error. Please check your connection.");
    } finally {
      setRegistering(false);
      setSelectedPool(null);
    }
  };

  const handleRegister = async () => {
    if (needsWaiver && !waiverAccepted) {
      Alert.alert(
        "Waiver Required",
        "Please read and accept the PlayOn waiver before registering."
      );
      return;
    }
    setRegistering(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const programName = program?.name || program?.title || `${typeLabel} #${numId}`;
      const programPrice = program?.priceInCents || program?.priceCents || program?.spotPriceInCents || program?.registrationPrice || 0;
      const qs = new URLSearchParams({
        programType: type,
        programId: String(numId),
        name: programName,
        price: String(Number(programPrice) / 100),
        mobile_return: "1",
      });
      const checkoutUrl = `${baseUrl}/checkout?${qs.toString()}`;
      const result = await WebBrowser.openAuthSessionAsync(checkoutUrl, `playon-mobile://`);
      const succeeded = result.type === "success";
      if (succeeded) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      const queryKey =
        type === "league" ? getGetLeagueQueryKey(numId) :
        type === "camp"   ? getGetCampQueryKey(numId) :
        type === "tournament" ? getGetTournamentQueryKey(numId) :
        getGetDropinQueryKey(numId);
      await queryClient.invalidateQueries({ queryKey });
      if (succeeded) {
        setIsRegistered(true);
      }
    } catch (e: any) {
      Alert.alert(
        "Registration",
        e?.message || "Could not start registration. Please try again."
      );
    } finally {
      setRegistering(false);
    }
  };

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!program) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Feather name="alert-circle" size={40} color={colors.mutedForeground} />
        <Text style={[styles.notFoundText, { color: colors.foreground }]}>Program not found</Text>
        <Pressable
          onPress={() => router.back()}
          style={[styles.backBtn, { borderColor: colors.border }]}
        >
          <Text style={[styles.backBtnText, { color: colors.foreground }]}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const typeLabel = TYPE_LABELS[type] || type;
  const typeIcon = TYPE_ICONS[type] || "calendar";
  const name = program.name || program.title || `${typeLabel} #${id}`;
  const description = program.description || program.notes;
  const startDate = program.startDate || program.sessionDate;
  const endDate = program.endDate;
  const price = program.priceInCents || program.priceCents || program.spotPriceInCents;
  const ageGroup = program.ageGroup;
  const gender = (program as any).gender;
  const status = program.status;

  const InfoRow = ({ icon, label, value }: { icon: string; label: string; value: string }) => (
    <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
      <View style={[styles.infoIcon, { backgroundColor: colors.accent }]}>
        <Feather name={icon as any} size={16} color={colors.primary} />
      </View>
      <View>
        <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>{label}</Text>
        <Text style={[styles.infoValue, { color: colors.foreground }]}>{value}</Text>
      </View>
    </View>
  );

  const isDropIn = type === "drop_in";
  const isActive = computeIsEventActive(program);

  // Derive capacity info per program type
  const spotsInfo = (() => {
    if (type === "league" || type === "tournament") {
      const taken = program.teamsRegistered ?? 0;
      const total = program.maxTeams ?? 0;
      if (!total) return null;
      return { taken, total, available: Math.max(0, total - taken), unit: "teams" };
    }
    if (type === "camp") {
      const taken = program.participantsRegistered ?? 0;
      const total = program.maxParticipants ?? 0;
      if (!total) return null;
      return { taken, total, available: Math.max(0, total - taken), unit: "spots" };
    }
    if (type === "drop_in") {
      const taken = program.spotsTaken ?? 0;
      const total = program.spotsTotal ?? 0;
      if (!total) return null;
      return { taken, total, available: program.spotsAvailable ?? Math.max(0, total - taken), unit: "spots" };
    }
    return null;
  })();

  const programIsFull = spotsInfo ? spotsInfo.available === 0 : false;
  const registrationOpen = program.registrationOpen ?? true;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View
          style={[
            styles.hero,
            {
              backgroundColor: colors.primary,
              paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) + 60,
            },
          ]}
        >
          <View style={[styles.typeChip, { backgroundColor: "#FFFFFF30" }]}>
            <Feather name={typeIcon as any} size={12} color={palette.neutral50} />
            <Text style={styles.typeChipText}>{typeLabel}</Text>
          </View>
          <Text style={styles.heroName}>{name}</Text>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {ageGroup && (
              <View style={[styles.ageChip, { backgroundColor: "#FFFFFF20" }]}>
                <Text style={styles.ageChipText}>
                  {Array.isArray(ageGroup)
                    ? (ageGroup as string[]).includes("all_ages")
                      ? "All Ages"
                      : (ageGroup as string[]).join(" · ")
                    : ageGroup === "all_ages"
                    ? "All Ages"
                    : ageGroup}
                </Text>
              </View>
            )}
            {gender && (
              <View style={[styles.ageChip, { backgroundColor: "#3b1d5c" }]}>
                <Text style={[styles.ageChipText, { color: "#c4b5fd" }]}>
                  {gender.charAt(0).toUpperCase() + gender.slice(1)}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Info cards */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {startDate && (
            <InfoRow icon="calendar" label="Start date" value={formatDate(startDate) || startDate} />
          )}
          {endDate && (
            <InfoRow icon="calendar" label="End date" value={formatDate(endDate) || endDate} />
          )}
          {price != null && (
            <InfoRow icon="dollar-sign" label="Price" value={formatPrice(price) || "$—"} />
          )}
          {spotsInfo && (
            <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
              <View style={[styles.infoIcon, { backgroundColor: colors.accent }]}>
                <Feather name="users" size={16} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Spots</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <Text style={[styles.infoValue, { color: colors.foreground }]}>
                    {spotsInfo.taken} / {spotsInfo.total} {spotsInfo.unit}
                  </Text>
                  {spotsInfo.available === 0 ? (
                    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: "#EF444420", borderWidth: 1, borderColor: "#EF444440" }}>
                      <Text style={{ fontSize: 11, fontFamily: "Outfit_600SemiBold", color: "#EF4444" }}>Full</Text>
                    </View>
                  ) : spotsInfo.available <= Math.ceil(spotsInfo.total * 0.3) ? (
                    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: "#F59E0B20", borderWidth: 1, borderColor: "#F59E0B40" }}>
                      <Text style={{ fontSize: 11, fontFamily: "Outfit_600SemiBold", color: "#F59E0B" }}>
                        {spotsInfo.available} left
                      </Text>
                    </View>
                  ) : (
                    <Text style={{ fontSize: 11, fontFamily: "Outfit_400Regular", color: colors.mutedForeground }}>
                      {spotsInfo.available} available
                    </Text>
                  )}
                </View>
              </View>
            </View>
          )}
          {status && (
            <InfoRow
              icon="info"
              label="Status"
              value={status.charAt(0).toUpperCase() + status.slice(1)}
            />
          )}
        </View>

        {description && (
          <View
            style={[styles.descCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Text style={[styles.descTitle, { color: colors.foreground }]}>About</Text>
            <Text style={[styles.descText, { color: colors.mutedForeground }]}>{description}</Text>
          </View>
        )}

        {/* Waiver consent — shown for league / camp / tournament */}
        {needsWaiver && (
          <View
            style={[styles.waiverCard, { backgroundColor: colors.card, borderColor: waiverAccepted ? "#22C55E40" : colors.border }]}
          >
            <View style={styles.waiverHeader}>
              <Feather name="file-text" size={16} color={colors.primary} />
              <Text style={[styles.waiverTitle, { color: colors.foreground }]}>
                Participation Waiver
              </Text>
              <Text style={[styles.waiverRequired, { color: colors.primary }]}>Required</Text>
            </View>

            <Pressable onPress={() => setWaiverExpanded(!waiverExpanded)} style={styles.waiverToggle}>
              <Text style={[styles.waiverToggleText, { color: colors.mutedForeground }]}>
                {waiverExpanded ? "Hide waiver text" : "Read full waiver"}
              </Text>
              <Feather
                name={waiverExpanded ? "chevron-up" : "chevron-down"}
                size={14}
                color={colors.mutedForeground}
              />
            </Pressable>

            {waiverExpanded && (
              <Text style={[styles.waiverText, { color: colors.mutedForeground }]}>
                {WAIVER_TEXT}
              </Text>
            )}

            <Pressable
              style={styles.waiverCheckRow}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setWaiverAccepted(!waiverAccepted);
              }}
            >
              <View
                style={[
                  styles.checkbox,
                  {
                    borderColor: waiverAccepted ? "#22C55E" : colors.border,
                    backgroundColor: waiverAccepted ? "#22C55E" : "transparent",
                  },
                ]}
              >
                {waiverAccepted && <Feather name="check" size={12} color="#FFFFFF" />}
              </View>
              <Text style={[styles.waiverCheckText, { color: colors.foreground }]}>
                I have read and agree to the PlayOn Participation Waiver
              </Text>
            </Pressable>
          </View>
        )}

        {/* RSVP result banner */}
        {rsvpResult && (
          <View
            style={[styles.successCard, { backgroundColor: "#22C55E18", borderColor: "#22C55E40" }]}
          >
            <Feather name="check-circle" size={18} color="#22C55E" />
            <Text style={[styles.successText, { color: colors.foreground }]}>{rsvpResult}</Text>
          </View>
        )}

        {/* Drop-in pools */}
        {isDropIn && (
          <View style={styles.poolsSection}>
            <Text style={[styles.poolsTitle, { color: colors.foreground }]}>Available Spots</Text>
            {poolsLoading ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} />
            ) : pools.length === 0 ? (
              <View
                style={[styles.emptyPoolCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Feather name="calendar" size={28} color={colors.mutedForeground} />
                <Text style={[styles.emptyPoolText, { color: colors.mutedForeground }]}>
                  No court pools available yet. Check back soon.
                </Text>
              </View>
            ) : (() => {
              // Determine whether all pools share the same start time.
              // Normalise to minute-level epoch so minor sub-minute drift is ignored.
              const sessionStartsAt: string | null = program?.startsAt ?? null;
              const poolMinutes = pools
                .map((p) => (p.startsAt ? Math.floor(new Date(p.startsAt).getTime() / 60_000) : null));
              const distinctMinutes = new Set(poolMinutes.filter((m): m is number => m !== null));
              const allPoolsSameTime = distinctMinutes.size <= 1;

              return pools.map((pool) => {
                const spotsLeft = (pool.cap || pool.capacity || 0) - (pool.spotsTaken || 0);
                const isFull = spotsLeft <= 0;
                const isSelected = selectedPool === pool.id;

                // Per-pool time: only shown when pools have different start times.
                // Falls back to the session-level startsAt when the pool has no individual time.
                const perPoolTime: string | null = allPoolsSameTime
                  ? null
                  : formatTime(pool.startsAt) ?? formatTime(sessionStartsAt);

                // Check if this player has an active waitlist offer or waitlist position for this pool
                const mySpotForPool = myDropinSpots.find(
                  (s: any) => s.poolId === pool.id && s.status !== "cancelled"
                ) ?? null;
                const offerSpot = (mySpotForPool?.waitlisted && mySpotForPool?.offerSentAt && !mySpotForPool?.paymentStatus?.startsWith("paid"))
                  ? mySpotForPool : null;
                const offerActive = offerSpot && offerSpot.offerExpiresAt && new Date(offerSpot.offerExpiresAt) > new Date();
                const myWaitlistPosition: number | null = (mySpotForPool?.waitlisted && !mySpotForPool?.offerSentAt && !mySpotForPool?.paymentStatus?.startsWith("paid"))
                  ? (mySpotForPool?.waitlistPosition ?? null) : null;
                const appUrl = (process.env.EXPO_PUBLIC_DOMAIN ?? baseUrl ?? "").replace(/\/$/, "");

                return (
                  <View key={pool.id}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.poolCard,
                      {
                        backgroundColor: colors.card,
                        borderColor: offerActive ? "#F59E0B" : isFull ? colors.border : colors.primary + "40",
                        borderBottomLeftRadius: offerActive ? 0 : undefined,
                        borderBottomRightRadius: offerActive ? 0 : undefined,
                        borderBottomWidth: offerActive ? 0 : undefined,
                      },
                      pressed && !isFull && !offerActive && { opacity: 0.8 },
                    ]}
                    onPress={() => {
                    const poolAgeGroupArr: string[] = Array.isArray(pool.ageGroup) ? pool.ageGroup : pool.ageGroup ? [pool.ageGroup] : ["adult"];
                    const isYouth = poolAgeGroupArr.some((ag: string) => ag !== "adult" && ag !== "all_ages");
                    const isPaid = Number(pool.price ?? program?.price ?? 0) > 0;
                    if (isFull && !offerActive) {
                      // Full paid pool: open web to join waitlist for free
                      if (isPaid) {
                        (async () => {
                          await WebBrowser.openAuthSessionAsync(`${baseUrl}/dropins/${numId}?mobile_return=1`, "playon-mobile://");
                          await fetchPools();
                        })();
                      }
                      return;
                    }
                    if (isYouth) {
                      setPendingPool(pool);
                      setSelectedChildId(null);
                      fetchGuardianLinks();
                    } else if (isPaid) {
                      (async () => {
                        await WebBrowser.openAuthSessionAsync(`${baseUrl}/dropins/${numId}?mobile_return=1`, "playon-mobile://");
                        await fetchPools();
                      })();
                    } else {
                      handleDropinRsvp(pool.id);
                    }
                  }}
                    disabled={registering || rsvpResult != null}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.poolName, { color: colors.foreground }]}>
                        {pool.courtName || `Court ${pool.id}`}
                      </Text>
                      {perPoolTime ? (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2, marginBottom: 2 }}>
                          <Feather name="clock" size={11} color={colors.mutedForeground} />
                          <Text style={{ fontSize: 12, fontFamily: "Outfit_400Regular", color: colors.mutedForeground }}>
                            {perPoolTime}
                          </Text>
                        </View>
                      ) : null}
                      <View style={styles.poolMeta}>
                        {pool.ageGroup && (
                          <View style={[styles.poolChip, { backgroundColor: colors.accent }]}>
                            <Text style={[styles.poolChipText, { color: colors.mutedForeground }]}>
                              {Array.isArray(pool.ageGroup)
                                ? (pool.ageGroup as string[]).includes("all_ages") ? "All Ages" : (pool.ageGroup as string[]).join(" · ")
                                : pool.ageGroup === "all_ages" ? "All Ages" : pool.ageGroup}
                            </Text>
                          </View>
                        )}
                        {pool.skillLevel && (
                          <View style={[styles.poolChip, { backgroundColor: colors.accent }]}>
                            <Text style={[styles.poolChipText, { color: colors.mutedForeground }]}>
                              {pool.skillLevel}
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>
                    <View style={styles.poolRight}>
                      <Text
                        style={[
                          styles.poolSpots,
                          {
                            color: isFull
                              ? colors.mutedForeground
                              : spotsLeft <= 3
                              ? "#F59E0B"
                              : colors.primary,
                          },
                        ]}
                      >
                        {isFull ? "Full" : `${spotsLeft} left`}
                      </Text>
                      {!isFull && !rsvpResult && (
                        <View
                          style={[
                            styles.rsvpBtn,
                            { backgroundColor: isSelected && registering ? colors.muted : colors.primary },
                          ]}
                        >
                          {isSelected && registering ? (
                            <ActivityIndicator color={palette.neutral50} size="small" />
                          ) : (
                            <Text style={styles.rsvpBtnText}>
                              {pool.isWaitlist ? "Join waitlist" : "RSVP"}
                            </Text>
                          )}
                        </View>
                      )}
                      {isFull && !myWaitlistPosition && !offerActive && (
                        <View style={[styles.rsvpBtn, { backgroundColor: colors.muted }]}>
                          <Text style={[styles.rsvpBtnText, { color: colors.mutedForeground }]}>
                            Waitlist
                          </Text>
                        </View>
                      )}
                      {myWaitlistPosition !== null && !offerActive && (
                        <View style={[styles.rsvpBtn, { backgroundColor: "#F59E0B22" }]}>
                          <Text style={{ fontSize: 11, fontFamily: "Outfit_600SemiBold", color: "#B45309" }}>
                            #{myWaitlistPosition} in line
                          </Text>
                        </View>
                      )}
                      <Pressable
                        hitSlop={8}
                        style={({ pressed }) => [
                          styles.calBtn,
                          { backgroundColor: colors.accent, borderColor: colors.border },
                          pressed && { opacity: 0.7 },
                        ]}
                        onPress={async (e) => {
                          e.stopPropagation?.();
                          if (calendarAdding === pool.id) return;
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          setCalendarAdding(pool.id);
                          try {
                            const startsAt = pool.startsAt ?? program?.startsAt ?? null;
                            const durationMinutes = Number(program?.durationMinutes ?? 60);
                            await addToCalendar({
                              title: name,
                              startsAt,
                              durationMinutes,
                              courtName: pool.courtName,
                            });
                          } catch {
                            Alert.alert("Calendar", "Could not open the calendar share sheet. Please try again.");
                          } finally {
                            setCalendarAdding(null);
                          }
                        }}
                      >
                        {calendarAdding === pool.id ? (
                          <ActivityIndicator size="small" color={colors.primary} />
                        ) : (
                          <Feather name="calendar" size={14} color={colors.primary} />
                        )}
                      </Pressable>
                    </View>
                  </Pressable>
                  {offerActive && offerSpot && (
                    <Pressable
                      style={({ pressed }) => ({
                        backgroundColor: "#FEF3C7",
                        borderColor: "#F59E0B",
                        borderWidth: 1,
                        borderTopWidth: 0,
                        borderBottomLeftRadius: 12,
                        borderBottomRightRadius: 12,
                        paddingHorizontal: 14,
                        paddingVertical: 10,
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        opacity: pressed ? 0.8 : 1,
                        marginBottom: 2,
                      })}
                      onPress={async () => {
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                        await WebBrowser.openAuthSessionAsync(
                          `${appUrl}/dropins/${numId}?offer_spot=${offerSpot.id}&mobile_return=1`,
                          "playon-mobile://"
                        );
                        await fetchPools();
                      }}
                    >
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={{ fontSize: 13, fontFamily: "Outfit_600SemiBold", color: "#92400E" }}>
                          🎉 A spot opened — pay to confirm!
                        </Text>
                        <Text style={{ fontSize: 11, fontFamily: "Outfit_400Regular", color: "#B45309" }}>
                          Expires {new Date(offerSpot.offerExpiresAt).toLocaleString("en-US", {
                            month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
                          })}
                        </Text>
                      </View>
                      <View style={{
                        backgroundColor: "#F59E0B", borderRadius: 8,
                        paddingHorizontal: 12, paddingVertical: 6, marginLeft: 10,
                      }}>
                        <Text style={{ fontSize: 13, fontFamily: "Outfit_600SemiBold", color: "#fff" }}>
                          Pay Now
                        </Text>
                      </View>
                    </Pressable>
                  )}
                  </View>
                );
              })
            })()}
          </View>
        )}

        {/* Participant picker for youth drop-in pools */}
        {pendingPool && (
          <View style={[styles.pickerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.pickerTitle, { color: colors.foreground }]}>
              Who is this spot for?
            </Text>
            <Text style={[styles.pickerSub, { color: colors.mutedForeground }]}>
              Only age-eligible children linked to your account are shown.
            </Text>
            {guardianLinksLoading ? (
              <ActivityIndicator color={colors.primary} style={{ paddingVertical: 16 }} />
            ) : (() => {
              const eligible = guardianLinks
                .filter((l: any) => l.status === "approved" && l.canRegister)
                .filter((l: any) => {
                  const poolAg = pendingPool.ageGroup;
                  const agArr: string[] = Array.isArray(poolAg) ? (poolAg as string[]) : poolAg ? [poolAg] : ["adult"];
                  if (agArr.includes("all_ages")) return true;
                  return agArr.some(ag => mobileIsEligibleForPool(ag, l.youthDateOfBirth, program?.startsAt));
                });
              if (!eligible.length) {
                return (
                  <View style={[styles.pickerEmpty, { borderColor: "#F59E0B40", backgroundColor: "#F59E0B0A" }]}>
                    <Feather name="alert-circle" size={16} color="#F59E0B" />
                    <Text style={[styles.pickerEmptyText, { color: "#F59E0B" }]}>
                      No eligible children found for this age group.
                    </Text>
                  </View>
                );
              }
              return (
                <View style={{ gap: 8, marginTop: 4 }}>
                  {eligible.map((link: any) => {
                    const isSelected = selectedChildId === link.youthUserId;
                    return (
                      <Pressable
                        key={link.youthUserId}
                        onPress={() => setSelectedChildId(link.youthUserId)}
                        style={[
                          styles.childItem,
                          {
                            borderColor: isSelected ? colors.primary : colors.border,
                            backgroundColor: isSelected ? colors.primary + "18" : colors.accent,
                          },
                        ]}
                      >
                        <View style={styles.childItemInner}>
                          <View style={[styles.childAvatar, { backgroundColor: colors.primary + "20", borderColor: colors.primary + "40" }]}>
                            <Feather name="user" size={14} color={colors.primary} />
                          </View>
                          <Text style={[styles.childName, { color: colors.foreground }]}>
                            {link.youthFirstName} {link.youthLastName}
                          </Text>
                        </View>
                        {isSelected && <Feather name="check-circle" size={18} color={colors.primary} />}
                      </Pressable>
                    );
                  })}
                </View>
              );
            })()}
            {selectedChildId && !childWaiverLoading && childWaiverStatus && (!childWaiverStatus.hasSigned || childWaiverStatus.isExpired) && (
              <View style={{
                marginTop: 8,
                padding: 10,
                borderRadius: 8,
                backgroundColor: "#F59E0B0A",
                borderWidth: 1,
                borderColor: "#F59E0B40",
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
              }}>
                <Feather name="alert-triangle" size={14} color="#F59E0B" />
                <Text style={{ color: "#F59E0B", fontSize: 12, fontFamily: "Outfit_400Regular", flex: 1 }}>
                  A liability waiver must be signed for this child before registering. Please sign it from the PlayOn web app.
                </Text>
              </View>
            )}
            <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
              <Pressable
                style={[styles.pickerBtn, { flex: 1, borderColor: colors.border, backgroundColor: colors.accent }]}
                onPress={() => { setPendingPool(null); setSelectedChildId(null); setChildWaiverStatus(null); }}
              >
                <Text style={[styles.pickerBtnText, { color: colors.foreground }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.pickerBtn,
                  {
                    flex: 2,
                    backgroundColor: (selectedChildId && !(childWaiverStatus && (!childWaiverStatus.hasSigned || childWaiverStatus.isExpired))) ? colors.primary : colors.muted,
                    borderColor: "transparent",
                    opacity: childWaiverLoading ? 0.6 : 1,
                  },
                ]}
                disabled={!selectedChildId || registering || childWaiverLoading || (!!childWaiverStatus && (!childWaiverStatus.hasSigned || childWaiverStatus.isExpired))}
                onPress={() => {
                  if (!selectedChildId || !pendingPool) return;
                  const poolId = pendingPool.id;
                  const isPaid = Number(program?.price ?? 0) > 0;
                  setPendingPool(null);
                  setSelectedChildId(null);
                  setChildWaiverStatus(null);
                  if (isPaid) {
                    (async () => {
                      await WebBrowser.openAuthSessionAsync(`${baseUrl}/dropins/${numId}?mobile_return=1`, "playon-mobile://");
                      await fetchPools();
                    })();
                  } else {
                    handleDropinRsvp(poolId, selectedChildId);
                  }
                }}
              >
                {(registering && selectedPool === pendingPool?.id) || childWaiverLoading ? (
                  <ActivityIndicator color={palette.neutral50} size="small" />
                ) : (
                  <Text style={[styles.pickerBtnText, { color: selectedChildId ? "#fff" : colors.mutedForeground }]}>
                    {Number(program?.price ?? 0) > 0 ? "Continue to Pay" : "Confirm RSVP"}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        )}

        {/* Locked details section for league / tournament non-registrants */}
        {(type === "league" || type === "tournament") && !isRegistered && (
          <View style={[styles.lockedCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.lockedIconWrap, { backgroundColor: colors.accent }]}>
              <Feather name="lock" size={22} color={colors.mutedForeground} />
            </View>
            <Text style={[styles.lockedTitle, { color: colors.foreground }]}>
              {type === "league" ? "Schedule, Standings & Teams" : "Bracket & Seedings"}
            </Text>
            <Text style={[styles.lockedSub, { color: colors.mutedForeground }]}>
              Register to unlock full details for this {type === "league" ? "league" : "tournament"}.
            </Text>
          </View>
        )}

        {/* Leaderboard — shown for leagues, tournaments, and drop-ins */}
        {lbEntityType && (
          <View style={styles.lbSection}>
            <View style={styles.lbHeader}>
              <Feather name="award" size={16} color={colors.primary} />
              <Text style={[styles.lbTitle, { color: colors.foreground }]}>Leaderboard</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.lbMetrics}
              style={{ flexGrow: 0 }}
            >
              {(["goals", "assists", "games", "streak"] as const).map((m) => {
                const labels: Record<string, string> = { goals: "Goals", assists: "Assists", games: "Games", streak: "Streak" };
                const colors2 = { goals: "#ef4444", assists: "#60a5fa", games: "#4ade80", streak: "#fbbf24" };
                return (
                  <Pressable
                    key={m}
                    onPress={() => setLbMetric(m)}
                    style={[
                      styles.lbMetricChip,
                      {
                        backgroundColor: lbMetric === m ? colors2[m] + "20" : colors.card,
                        borderColor: lbMetric === m ? colors2[m] : colors.border,
                      },
                    ]}
                  >
                    <Text style={[styles.lbMetricText, { color: lbMetric === m ? colors2[m] : colors.foreground }]}>
                      {labels[m]}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={[styles.lbCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {lbLoading ? (
                <ActivityIndicator color={colors.primary} style={{ paddingVertical: 24 }} />
              ) : !lbData?.length ? (
                <View style={styles.lbEmpty}>
                  <Feather name="award" size={28} color={colors.mutedForeground} />
                  <Text style={[styles.lbEmptyText, { color: colors.mutedForeground }]}>
                    No stats recorded yet for this event.
                  </Text>
                </View>
              ) : (
                lbData.map((e: any) => {
                  const valueMap: Record<string, number> = { goals: e.goalsScored, assists: e.assists, games: e.gamesPlayed, streak: e.bestAttendanceStreak };
                  const metricColors: Record<string, string> = { goals: "#ef4444", assists: "#60a5fa", games: "#4ade80", streak: "#fbbf24" };
                  const val = valueMap[lbMetric];
                  const mc = metricColors[lbMetric];
                  return (
                    <View key={e.userId} style={[styles.lbRow, { borderBottomColor: colors.border }]}>
                      <Text style={[styles.lbRank, { color: colors.mutedForeground }]}>
                        {e.rank === 1 ? "🥇" : e.rank === 2 ? "🥈" : e.rank === 3 ? "🥉" : String(e.rank)}
                      </Text>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.lbName, { color: colors.foreground }]}>{e.displayName}</Text>
                        <Text style={[styles.lbMeta, { color: colors.mutedForeground }]}>{e.gamesPlayed}G · {e.goalsScored}⚽ {e.assists}A</Text>
                      </View>
                      <View style={[styles.lbPill, { backgroundColor: mc + "18", borderColor: mc + "30" }]}>
                        <Text style={[styles.lbPillNum, { color: mc }]}>{val}</Text>
                        <Text style={[styles.lbPillLabel, { color: mc + "BB" }]}>{lbMetric === "streak" ? "row" : lbMetric}</Text>
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          </View>
        )}

        {/* Location */}
        <View
          style={[styles.locationCard, { backgroundColor: colors.accent, borderColor: colors.border }]}
        >
          <Feather name="map-pin" size={16} color={colors.primary} />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={[styles.locationTitle, { color: colors.foreground }]}>Alumni Center</Text>
            <Text style={[styles.locationSub, { color: colors.mutedForeground }]}>
              Lexington, KY · PlayOn facility
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Register CTA — non-drop-in only */}
      {!isDropIn && (
        <View
          style={[
            styles.ctaBar,
            {
              backgroundColor: colors.background,
              borderTopColor: colors.border,
              paddingBottom: insets.bottom || 16,
            },
          ]}
        >
          {/* Eligibility warning */}
          {eligibility && !eligibility.eligible && (
            <View style={[styles.eligibilityBanner, { backgroundColor: "#EF444415", borderColor: "#EF444440" }]}>
              <Feather name="alert-triangle" size={14} color="#EF4444" />
              <Text style={styles.eligibilityText}>{eligibility.reason}</Text>
            </View>
          )}

          {price != null && (
            <Text style={[styles.ctaPrice, { color: colors.foreground }]}>
              {formatPrice(price)}
            </Text>
          )}
          <View style={{ flex: 1 }}>
            {needsWaiver && !waiverAccepted && (
              <Text style={[styles.ctaWaiverNote, { color: colors.mutedForeground }]}>
                Accept waiver above to register
              </Text>
            )}
            <Pressable
              style={({ pressed }) => [
                styles.registerBtn,
                {
                  backgroundColor:
                    registering || !isActive || status === "completed" || (needsWaiver && !waiverAccepted) || (eligibility && !eligibility.eligible)
                      ? colors.muted
                      : programIsFull && registrationOpen
                      ? "#F59E0B"
                      : colors.primary,
                },
                pressed && { opacity: 0.85 },
              ]}
              onPress={handleRegister}
              disabled={registering || !isActive || status === "completed" || (needsWaiver && !waiverAccepted) || (eligibility != null && !eligibility.eligible)}
            >
              {registering ? (
                <ActivityIndicator color={palette.neutral50} />
              ) : (
                <Text
                  style={[
                    styles.registerBtnText,
                    (!isActive || (needsWaiver && !waiverAccepted)) && { color: colors.mutedForeground },
                    (eligibility && !eligibility.eligible) && { color: colors.mutedForeground },
                  ]}
                >
                  {!isActive
                    ? "Not Currently Active"
                    : status === "completed"
                    ? "Season Ended"
                    : eligibility && !eligibility.eligible
                    ? "Not Eligible"
                    : needsWaiver && !waiverAccepted
                    ? "Accept Waiver to Register"
                    : programIsFull && registrationOpen
                    ? "Join Waitlist"
                    : "Register"}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  pickerCard: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
  },
  pickerTitle: { fontSize: 16, fontFamily: "Outfit_700Bold" },
  pickerSub: { fontSize: 12, fontFamily: "Outfit_400Regular", marginTop: -4 },
  pickerEmpty: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 4,
  },
  pickerEmptyText: { fontSize: 13, fontFamily: "Outfit_500Medium", flex: 1 },
  childItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 12,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  childItemInner: { flexDirection: "row", alignItems: "center", gap: 10 },
  childAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  childName: { fontSize: 14, fontFamily: "Outfit_600SemiBold" },
  pickerBtn: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  pickerBtnText: { fontSize: 14, fontFamily: "Outfit_600SemiBold" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  notFoundText: { fontSize: 18, fontFamily: "Outfit_600SemiBold" },
  backBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 8,
  },
  backBtnText: { fontSize: 14, fontFamily: "Outfit_500Medium" },
  hero: { paddingHorizontal: 20, paddingBottom: 28 },
  typeChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    gap: 5,
    marginBottom: 12,
  },
  typeChipText: { color: palette.neutral50, fontSize: 12, fontFamily: "Outfit_600SemiBold" },
  heroName: { color: palette.neutral50, fontSize: 26, fontFamily: "Outfit_700Bold", lineHeight: 32 },
  ageChip: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    marginTop: 10,
  },
  ageChipText: { color: palette.neutral50, fontSize: 12, fontFamily: "Outfit_500Medium" },
  card: {
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderBottomWidth: 1,
    gap: 12,
  },
  infoIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  infoLabel: { fontSize: 12, fontFamily: "Outfit_400Regular" },
  infoValue: { fontSize: 15, fontFamily: "Outfit_600SemiBold", marginTop: 1 },
  descCard: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  descTitle: { fontSize: 16, fontFamily: "Outfit_700Bold", marginBottom: 8 },
  descText: { fontSize: 14, fontFamily: "Outfit_400Regular", lineHeight: 22 },
  waiverCard: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1.5,
    gap: 12,
  },
  waiverHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  waiverTitle: { flex: 1, fontSize: 15, fontFamily: "Outfit_700Bold" },
  waiverRequired: { fontSize: 12, fontFamily: "Outfit_600SemiBold" },
  waiverToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  waiverToggleText: { fontSize: 13, fontFamily: "Outfit_400Regular" },
  waiverText: {
    fontSize: 13,
    fontFamily: "Outfit_400Regular",
    lineHeight: 20,
  },
  waiverCheckRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingTop: 4,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  waiverCheckText: { flex: 1, fontSize: 13, fontFamily: "Outfit_500Medium", lineHeight: 20 },
  successCard: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
  },
  successText: { flex: 1, fontSize: 14, fontFamily: "Outfit_500Medium", lineHeight: 20 },
  poolsSection: { marginHorizontal: 16, marginTop: 16 },
  poolsTitle: { fontSize: 18, fontFamily: "Outfit_700Bold", marginBottom: 10 },
  emptyPoolCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    gap: 10,
  },
  emptyPoolText: { fontSize: 14, fontFamily: "Outfit_400Regular", textAlign: "center", lineHeight: 20 },
  poolCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1.5,
    gap: 12,
  },
  poolName: { fontSize: 15, fontFamily: "Outfit_600SemiBold" },
  poolMeta: { flexDirection: "row", gap: 6, marginTop: 5, flexWrap: "wrap" },
  poolChip: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  poolChipText: { fontSize: 11, fontFamily: "Outfit_400Regular" },
  poolRight: { alignItems: "flex-end", gap: 6 },
  poolSpots: { fontSize: 14, fontFamily: "Outfit_700Bold" },
  calBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  rsvpBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    minWidth: 72,
    alignItems: "center",
  },
  rsvpBtnText: { color: palette.neutral50, fontSize: 13, fontFamily: "Outfit_600SemiBold" },
  locationCard: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  locationTitle: { fontSize: 14, fontFamily: "Outfit_600SemiBold" },
  locationSub: { fontSize: 12, fontFamily: "Outfit_400Regular", marginTop: 2 },
  ctaBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    gap: 12,
  },
  ctaPrice: { fontSize: 22, fontFamily: "Outfit_700Bold" },
  ctaWaiverNote: { fontSize: 12, fontFamily: "Outfit_400Regular", marginBottom: 4, textAlign: "center" },
  registerBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  registerBtnText: { color: palette.neutral50, fontSize: 16, fontFamily: "Outfit_700Bold" },
  eligibilityBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
    flex: 1,
  },
  eligibilityText: { color: "#EF4444", fontSize: 12, fontFamily: "Outfit_500Medium", flex: 1, lineHeight: 17 },
  lockedCard: {
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 14,
    borderWidth: 1,
    padding: 20,
    alignItems: "center",
    gap: 10,
  },
  lockedIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  lockedTitle: { fontSize: 15, fontFamily: "Outfit_600SemiBold", textAlign: "center" },
  lockedSub: { fontSize: 13, fontFamily: "Outfit_400Regular", textAlign: "center", lineHeight: 19 },
  lbSection: { marginHorizontal: 16, marginTop: 16 },
  lbHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  lbTitle: { fontSize: 18, fontFamily: "Outfit_700Bold" },
  lbMetrics: { gap: 8, paddingBottom: 10 },
  lbMetricChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  lbMetricText: { fontSize: 13, fontFamily: "Outfit_600SemiBold" },
  lbCard: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  lbEmpty: { alignItems: "center", gap: 10, padding: 24 },
  lbEmptyText: { fontSize: 13, fontFamily: "Outfit_400Regular", textAlign: "center", lineHeight: 19 },
  lbRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 10,
  },
  lbRank: { width: 30, fontSize: 15, fontFamily: "Outfit_700Bold", textAlign: "center" },
  lbName: { fontSize: 14, fontFamily: "Outfit_600SemiBold" },
  lbMeta: { fontSize: 11, fontFamily: "Outfit_400Regular", marginTop: 2 },
  lbPill: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 3,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  lbPillNum: { fontSize: 14, fontFamily: "Outfit_700Bold" },
  lbPillLabel: { fontSize: 10, fontFamily: "Outfit_400Regular" },
});
