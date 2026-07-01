import { API_BASE } from "@/lib/api-base";
import React, { useEffect, useRef, useCallback, useState } from "react";
import { DashboardTabContext } from "@/contexts/dashboard-tab-context";
import { ClerkProvider, HandleSSOCallback, useClerk, useAuth } from '@clerk/react';
import { useProfileGate } from "@/hooks/use-profile-gate";
import { shadcn } from '@clerk/themes';
import { Switch, Route, Redirect, useLocation, Router as WouterRouter } from 'wouter';
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { setAuthTokenGetter } from "@workspace/api-client-react";

import { Layout } from "@/components/layout";
import { PwaInstallBanner } from "@/components/PwaInstallBanner";
import { OfflineShell } from "@/components/OfflineShell";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";


const clerkPubKey =
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ??
  "pk_test_cG9zaXRpdmUtY29yZ2ktMTYuY2xlcmsuYWNjb3VudHMuZGV2JA";
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL || undefined;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || "/" : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/playon-logo.png`,
  },
  variables: {
    colorPrimary: "hsl(349, 78%, 26%)",
    colorBackground: "hsl(195, 14%, 14%)",
    colorForeground: "hsl(0, 11%, 92%)",
    colorMutedForeground: "hsl(180, 5%, 55%)",
    colorDanger: "hsl(0, 84%, 60%)",
    colorInput: "hsl(195, 14%, 24%)",
    colorInputForeground: "hsl(0, 11%, 92%)",
    colorNeutral: "hsl(195, 14%, 22%)",
    fontFamily: "'Outfit', sans-serif",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-[var(--brand-teal-900)] rounded-2xl w-[440px] max-w-full overflow-hidden border border-[var(--brand-teal-700)] shadow-xl",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-white text-xl font-bold",
    headerSubtitle: "text-[hsl(180,5%,55%)]",
    socialButtonsBlockButtonText: "text-white font-medium",
    formFieldLabel: "text-white font-medium",
    footerActionLink: "text-primary hover:text-primary/80",
    footerActionText: "text-[hsl(180,5%,55%)]",
    dividerText: "text-[hsl(180,5%,55%)]",
    identityPreviewEditButton: "text-primary",
    formFieldSuccessText: "text-green-500",
    alertText: "text-white",
    logoBox: "mb-4",
    logoImage: "h-10",
    socialButtonsBlockButton: "border-[var(--brand-teal-700)] bg-[var(--brand-teal-700)]/50 hover:bg-[var(--brand-teal-700)]",
    formButtonPrimary: "bg-primary hover:bg-primary/85 text-primary-foreground",
    formFieldInput: "bg-[var(--brand-teal-700)] border-[var(--brand-teal-600)] text-white placeholder:text-[hsl(180,5%,55%)] focus:border-primary focus:ring-primary",
    footerAction: "bg-[var(--brand-teal-900)]",
    dividerLine: "bg-[var(--brand-teal-600)]",
    alert: "bg-[var(--brand-teal-700)] border-[var(--brand-teal-600)]",
    otpCodeFieldInput: "bg-[var(--brand-teal-700)] border-[var(--brand-teal-600)] text-white",
    formFieldRow: "mb-4",
    main: "p-6",
  },
};

const clerkLocalization = {
  signIn: {
    start: {
      title: "Welcome back",
      subtitle: "Sign in to your PlayOn account",
    },
  },
  signUp: {
    start: {
      title: "Create your account",
      subtitle: "Join PlayOn — futsal in Lexington, KY",
    },
  },
};

function SSOCallbackPage() {
  const [, setLocation] = useLocation();
  const { isLoaded, isSignedIn } = useAuth();
  const { checkAndRedirect } = useProfileGate();
  const doneRef = useRef(false);

  const handleInviteAndRedirect = useCallback(async () => {
    if (doneRef.current) return;
    doneRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const inviteToken = params.get("invite");
    if (inviteToken) {
      try {
        await fetch(`${API_BASE}/me`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inviteToken }),
        });
      } catch {}
      setLocation("/dashboard");
      return;
    }

    // Staff invite token stored in sessionStorage before OAuth redirect (sign-up with ?invite= param)
    const ssInviteToken = sessionStorage.getItem("signupInviteToken");
    if (ssInviteToken) {
      try {
        await fetch(`${API_BASE}/me`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inviteToken: ssInviteToken }),
        });
      } catch {}
      sessionStorage.removeItem("signupInviteToken");
      setLocation("/dashboard");
      return;
    }

    // Team invite token stored in sessionStorage before OAuth redirect
    const ssTeamToken = sessionStorage.getItem("signupTeamInviteToken");
    if (ssTeamToken) {
      try {
        const claimRes = await fetch(`${API_BASE}/me/claim-team-invite`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: ssTeamToken }),
        });
        sessionStorage.removeItem("signupTeamInviteToken");
        if (!claimRes.ok) {
          const body = await claimRes.json().catch(() => ({}));
          console.warn("[team-invite] claim failed:", body?.error);
          setLocation(`/onboarding?invite_error=${encodeURIComponent(body?.error ?? "Invite could not be claimed")}`);
          return;
        }
      } catch {
        sessionStorage.removeItem("signupTeamInviteToken");
      }
      setLocation("/dashboard");
      return;
    }

    // For non-invite SSO signups, persist any pre-Clerk info collected before the Clerk widget,
    // then check if the user has already completed onboarding.
    const signupInfoRaw = sessionStorage.getItem("signupInfo");
    if (signupInfoRaw) {
      try {
        const signupInfo = JSON.parse(signupInfoRaw);
        await fetch(`${API_BASE}/me`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            firstName: signupInfo.firstName || undefined,
            lastName: signupInfo.lastName || undefined,
            phone: signupInfo.phone || undefined,
            dateOfBirth: signupInfo.dateOfBirth || undefined,
          }),
        });
      } catch {}
      sessionStorage.removeItem("signupInfo");
    }

    // Use shared profile gate: routes to /onboarding if roles missing or waiver unsigned/expired,
    // otherwise to /dashboard. Same logic used by the direct sign-in path.
    await checkAndRedirect();
  }, [setLocation, checkAndRedirect]);

  // Handle the case where the user is already signed in (e.g. after email OTP sign-up redirect)
  useEffect(() => {
    if (isLoaded && isSignedIn) {
      handleInviteAndRedirect();
    }
  }, [isLoaded, isSignedIn, handleInviteAndRedirect]);

  return (
    <HandleSSOCallback
      navigateToApp={handleInviteAndRedirect}
      navigateToSignIn={() => setLocation("/sign-in")}
      navigateToSignUp={() => setLocation("/sign-up")}
    />
  );
}

import SignInPage from "@/pages/sign-in";
import SignUpPage from "@/pages/sign-up";
import OnboardingPage from "@/pages/onboarding";
import ExplorePage from "@/pages/explore";
import MyPlayOnPage from "@/pages/me";
import AccountPage from "@/pages/account";
import LeaguesList from "@/pages/leagues/index";
import LeagueDetail from "@/pages/leagues/[id]";
import LeagueJoin from "@/pages/leagues/join/[token]";
import CampsList from "@/pages/camps/index";
import CampDetail from "@/pages/camps/[id]";
import CampHealthPacket from "@/pages/camps/health-packet";
import DropinsList from "@/pages/dropins/index";
import DropinDetail from "@/pages/dropins/[id]";
import DropinOccurrenceDetail from "@/pages/dropins/occurrence";
import TournamentsList from "@/pages/tournaments/index";
import TournamentDetail from "@/pages/tournaments/[id]";
import TournamentSelfCheckin from "@/pages/tournaments/self-checkin";
import Dashboard from "@/pages/dashboard";
import Profile from "@/pages/profile";
import ProfileQR from "@/pages/profile-qr";
import Admin from "@/pages/admin/index";
import { AdminLayout } from "@/components/admin-layout";
import AdminCourts from "@/pages/admin/courts";
import AdminVenues from "@/pages/admin/venues";
import AdminAgeGroups from "@/pages/admin/age-groups";
import AdminGuardians from "@/pages/admin/guardians";
import AdminStaff from "@/pages/admin/staff";
import AdminPlayers from "@/pages/admin/players";
import AdminPricing from "@/pages/admin/pricing";
import AdminSplits from "@/pages/admin/splits";
import AdminFeeConfig from "@/pages/admin/fee-config";
import AdminRevenue from "@/pages/admin/revenue";
import AdminAuditLog from "@/pages/admin/audit-log";
import AdminDropins from "@/pages/admin/dropins";
import AdminDropinsNew from "@/pages/admin/dropins/new";
import AdminDropinsEdit from "@/pages/admin/dropins/edit";
import AdminDropinCheckin from "@/pages/admin/dropins-checkin";
import AdminDropinAttendance from "@/pages/admin/dropins-attendance";
import AdminCamps from "@/pages/admin/camps";
import AdminCampsNew from "@/pages/admin/camps/new";
import AdminCampsCheckin from "@/pages/admin/camps-checkin";
import AdminCampsAttendance from "@/pages/admin/camps-attendance";
import AdminLeagues from "@/pages/admin/leagues";
import AdminLeaguesCheckin from "@/pages/admin/leagues-checkin";
import AdminLeaguesAttendance from "@/pages/admin/leagues-attendance";
import AdminTournaments from "@/pages/admin/tournaments";
import AdminTournamentsCheckin from "@/pages/admin/tournaments-checkin";
import AdminTournamentsAttendance from "@/pages/admin/tournaments-attendance";
import AdminPayments from "@/pages/admin/payments";
import AdminDiscountCodes from "@/pages/admin/discount-codes";
import AdminRefundPolicies from "@/pages/admin/refund-policies";
import AdminPayouts from "@/pages/admin/payouts";
import AdminAiScheduling from "@/pages/admin/ai-scheduling";
import AdminAiAssistant from "@/pages/admin/ai-assistant";
import AdminCreate from "@/pages/admin/create";
import AdminRentals from "@/pages/admin/rentals";
import NewRentalWizard from "@/pages/admin/rentals/new";
import RentalSetupWizard from "@/pages/admin/rentals/setup";
import RentalsPage from "@/pages/rentals";
import WaiverRentalPage from "@/pages/waiver-rental";
import StaffEarnings from "@/pages/staff/earnings";
import StaffGameCards from "@/pages/staff/game-cards";
import GameCardDetail from "@/pages/staff/game-card-detail";
import AdminGameCards from "@/pages/admin/game-cards";
import GamePanel from "@/pages/staff/game-panel";
import StaffTraining from "@/pages/staff/training";
import TrainingSectionPage from "@/pages/staff/training-section";
import FixtureGameCard from "@/pages/fixtures/[id]/game-card";
import ChildDetail from "@/pages/guardian/child-detail";
import ScannerPage from "@/pages/scanner";
import Checkout from "@/pages/checkout";
import CheckoutComplete from "@/pages/checkout-complete";
import ConnectComplete from "@/pages/connect/complete";
import ConnectRefresh from "@/pages/connect/refresh";
import AdminSubRefAlerts from "@/pages/admin/sub-ref-alerts";
import AdminNotificationPreferences from "@/pages/admin/notification-preferences";
import RefAlerts from "@/pages/ref-alerts";
import AdminCourtCalendar from "@/pages/admin/court-calendar";
import BlockCourtWizard from "@/pages/admin/court-calendar/block";
import AdminIncidentReports from "@/pages/admin/incident-reports";
import AdminInsurance from "@/pages/admin/insurance";
import AdminPrivacy from "@/pages/admin/privacy";
import AdminFixtureOps from "@/pages/admin/fixtures";
import AdminMemberships from "@/pages/admin/memberships";
import AdminReferrals from "@/pages/admin/referrals";
import ParticipationReport from "@/pages/admin/reports/participation";
import RetentionReport from "@/pages/admin/reports/retention";
import AdminInvites from "@/pages/admin/invites";
import AdminWaivers from "@/pages/admin/waivers";
import AdminRoles from "@/pages/admin/roles";
import AdminUsers from "@/pages/admin/users";
import AdminUserDetail from "@/pages/admin/user-detail";
import AdminAgeGroupWaivers from "@/pages/admin/age-group-waivers";
import AdminDisputes from "@/pages/admin/disputes";
import AdminMessaging from "@/pages/admin/messaging";
import AdminKingsOfTheCourt from "@/pages/admin/kings-of-the-court";
import KotcNewPage from "@/pages/admin/kotc/new";
import KotcEditPage from "@/pages/admin/kotc/edit";
import BattleModeratorPage from "@/pages/battle-moderator";
import KotcMyTeamsPage from "@/pages/kotc-my-teams";
import KotcTeamPage from "@/pages/kotc-team";
import KotcLeaderboardPage from "@/pages/kotc-leaderboard";
import KotcSeasonDetailPage from "@/pages/kotc-season-detail";
import KotcBattleLivePage from "@/pages/kotc-battle-live";
import FamilyDashboard from "@/pages/family/dashboard";

function ClerkAuthTokenWirer() {
  const { getToken, isSignedIn } = useAuth();
  useEffect(() => {
    setAuthTokenGetter(isSignedIn ? () => getToken() : null);
    return () => setAuthTokenGetter(null);
  }, [isSignedIn, getToken]);
  return null;
}

function ReferralAutoClaimHandler() {
  const { isSignedIn, getToken } = useAuth();
  const prevSignedInRef = useRef<boolean | undefined>(undefined);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref) {
      sessionStorage.setItem("pendingRefCode", ref);
    }
  }, []);

  useEffect(() => {
    if (prevSignedInRef.current === false && isSignedIn === true) {
      const code = sessionStorage.getItem("pendingRefCode");
      if (code) {
        getToken().then(token => {
          if (!token) return;
          return fetch(`${API_BASE}/referrals/claim`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ code }),
          });
        }).then(r => {
          if (r && (r.ok || r.status === 409)) {
            sessionStorage.removeItem("pendingRefCode");
          }
        }).catch(() => {});
      }
    }
    prevSignedInRef.current = isSignedIn ?? false;
  }, [isSignedIn, getToken]);

  return null;
}

// IdVerifiedGate removed: ID verification is no longer required at signup.
// Waiver collection happens at first program registration instead.

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  const [activeDashTab, setActiveDashTab] = useState(() =>
    typeof window !== "undefined" ? window.location.hash.replace("#", "") : ""
  );

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      localization={clerkLocalization}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkAuthTokenWirer />
        <ClerkQueryClientCacheInvalidator />
        <ReferralAutoClaimHandler />
        <DashboardTabContext.Provider value={{ activeDashTab, setActiveDashTab }}>
          <TooltipProvider>
          <Switch>
            {/* New consolidated routes */}
            <Route path="/" component={Home} />
            <Route path="/explore" component={ExplorePage} />
            <Route path="/me" component={MyPlayOnPage} />
            <Route path="/account" component={AccountPage} />

            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            <Route path="/sso-callback" component={SSOCallbackPage} />
            <Route path="/onboarding" component={OnboardingPage} />

            {/* Old routes → redirect to new consolidated pages */}
            <Route path="/dashboard">{() => <Redirect to="/me" />}</Route>
            <Route path="/profile/qr">{() => <Redirect to="/account?tab=qr" />}</Route>
            <Route path="/profile">{() => <Redirect to="/account" />}</Route>
            <Route path="/notification-preferences">{() => <Redirect to="/account?tab=notifications" />}</Route>
            <Route path="/assistant">{() => <Redirect to="/me?tab=assistant" />}</Route>
            <Route path="/memberships">{() => <Redirect to="/me?tab=memberships" />}</Route>
            <Route path="/referrals">{() => <Redirect to="/me?tab=referrals" />}</Route>
            <Route path="/family">{() => <Redirect to="/me?tab=family" />}</Route>
            <Route path="/re-enroll">{() => <Redirect to="/me?tab=activity" />}</Route>
            <Route path="/admin">{() => <AdminLayout><Admin /></AdminLayout>}</Route>
            <Route path="/admin/courts">{() => <AdminLayout><AdminCourts /></AdminLayout>}</Route>
            <Route path="/admin/venues">{() => <AdminLayout><AdminVenues /></AdminLayout>}</Route>
            <Route path="/admin/age-groups">{() => <AdminLayout><AdminAgeGroups /></AdminLayout>}</Route>
            <Route path="/admin/guardians">{() => <AdminLayout><AdminGuardians /></AdminLayout>}</Route>
            <Route path="/admin/staff">{() => <AdminLayout><AdminStaff /></AdminLayout>}</Route>
            <Route path="/admin/players">{() => <AdminLayout><AdminPlayers /></AdminLayout>}</Route>
            <Route path="/admin/pricing">{() => <AdminLayout><AdminPricing /></AdminLayout>}</Route>
            <Route path="/admin/splits">{() => <AdminLayout><AdminSplits /></AdminLayout>}</Route>
            <Route path="/admin/fee-config">{() => <AdminLayout><AdminFeeConfig /></AdminLayout>}</Route>
            <Route path="/admin/revenue">{() => <AdminLayout><AdminRevenue /></AdminLayout>}</Route>
            <Route path="/admin/audit-log">{() => <AdminLayout><AdminAuditLog /></AdminLayout>}</Route>
            <Route path="/admin/dropins/new">{() => <AdminDropinsNew />}</Route>
            <Route path="/admin/dropins/:id/edit">{() => <AdminDropinsEdit />}</Route>
            <Route path="/admin/dropins">{() => <AdminLayout><AdminDropins /></AdminLayout>}</Route>
            <Route path="/admin/dropins/:id/checkin">{() => <AdminLayout><AdminDropinCheckin /></AdminLayout>}</Route>
            <Route path="/admin/dropins/:id/attendance">{() => <AdminLayout><AdminDropinAttendance /></AdminLayout>}</Route>
            <Route path="/admin/camps/new">{() => <AdminCampsNew />}</Route>
            <Route path="/admin/camps">{() => <AdminLayout><AdminCamps /></AdminLayout>}</Route>
            <Route path="/admin/camps/:campId/checkin/:dayId">{() => <AdminLayout><AdminCampsCheckin /></AdminLayout>}</Route>
            <Route path="/admin/camps/:campId/attendance/:dayId">{() => <AdminLayout><AdminCampsAttendance /></AdminLayout>}</Route>
            <Route path="/admin/leagues">{() => <AdminLayout><AdminLeagues /></AdminLayout>}</Route>
            <Route path="/admin/leagues/fixtures/:fixtureId/checkin">{() => <AdminLayout><AdminLeaguesCheckin /></AdminLayout>}</Route>
            <Route path="/admin/leagues/fixtures/:fixtureId/attendance">{() => <AdminLayout><AdminLeaguesAttendance /></AdminLayout>}</Route>
            <Route path="/admin/tournaments">{() => <AdminLayout><AdminTournaments /></AdminLayout>}</Route>
            <Route path="/admin/tournaments/fixtures/:fixtureId/checkin">{() => <AdminLayout><AdminTournamentsCheckin /></AdminLayout>}</Route>
            <Route path="/admin/tournaments/:id/fixtures/:fixtureId/attendance">{() => <AdminLayout><AdminTournamentsAttendance /></AdminLayout>}</Route>
            <Route path="/admin/payments">{() => <AdminLayout><AdminPayments /></AdminLayout>}</Route>
            <Route path="/admin/discount-codes">{() => <AdminLayout><AdminDiscountCodes /></AdminLayout>}</Route>
            <Route path="/admin/refund-policies">{() => <AdminLayout><AdminRefundPolicies /></AdminLayout>}</Route>
            <Route path="/admin/payouts">{() => <AdminLayout><AdminPayouts /></AdminLayout>}</Route>
            <Route path="/admin/ai-scheduling">{() => <AdminLayout><AdminAiScheduling /></AdminLayout>}</Route>
            <Route path="/admin/ai-assistant">{() => <AdminLayout><AdminAiAssistant /></AdminLayout>}</Route>
            <Route path="/admin/create" component={AdminCreate} />
            <Route path="/admin/rentals/setup" component={RentalSetupWizard} />
            <Route path="/admin/rentals/new" component={NewRentalWizard} />
            <Route path="/admin/rentals">{() => <AdminLayout><AdminRentals /></AdminLayout>}</Route>

            <Route path="/staff/earnings" component={StaffEarnings} />
            <Route path="/staff/game-cards/:id" component={GameCardDetail} />
            <Route path="/staff/game-cards" component={StaffGameCards} />
            <Route path="/staff/game-panel/:id" component={GamePanel} />
            <Route path="/staff/training/:id" component={TrainingSectionPage} />
            <Route path="/staff/training" component={StaffTraining} />
            <Route path="/fixtures/:id/game-card" component={FixtureGameCard} />

            <Route path="/family/dashboard" component={FamilyDashboard} />
            <Route path="/guardian/children/qr">{() => <Redirect to="/me?tab=family" />}</Route>
            <Route path="/guardian/children">{() => <Redirect to="/me?tab=family" />}</Route>
            <Route path="/guardian/children/:youthUserId" component={ChildDetail} />
            <Route path="/scanner" component={ScannerPage} />

            <Route path="/admin/sub-ref-alerts">{() => <AdminLayout><AdminSubRefAlerts /></AdminLayout>}</Route>
            <Route path="/admin/notification-preferences">{() => <AdminLayout><AdminNotificationPreferences /></AdminLayout>}</Route>
            <Route path="/admin/court-calendar">{() => <AdminLayout><AdminCourtCalendar /></AdminLayout>}</Route>
            <Route path="/admin/court-calendar/block" component={BlockCourtWizard} />
            <Route path="/admin/incident-reports">{() => <AdminLayout><AdminIncidentReports /></AdminLayout>}</Route>
            <Route path="/admin/insurance">{() => <AdminLayout><AdminInsurance /></AdminLayout>}</Route>
            <Route path="/admin/privacy">{() => <AdminLayout><AdminPrivacy /></AdminLayout>}</Route>
            <Route path="/admin/fixtures">{() => <AdminLayout><AdminFixtureOps /></AdminLayout>}</Route>
            <Route path="/admin/game-cards">{() => <AdminLayout><AdminGameCards /></AdminLayout>}</Route>
            <Route path="/admin/memberships">{() => <AdminLayout><AdminMemberships /></AdminLayout>}</Route>
            <Route path="/admin/referrals">{() => <AdminLayout><AdminReferrals /></AdminLayout>}</Route>
            <Route path="/admin/reports/participation">{() => <AdminLayout><ParticipationReport /></AdminLayout>}</Route>
            <Route path="/admin/reports/retention">{() => <AdminLayout><RetentionReport /></AdminLayout>}</Route>
            <Route path="/admin/invites">{() => <AdminLayout><AdminInvites /></AdminLayout>}</Route>
            <Route path="/admin/waivers">{() => <AdminLayout><AdminWaivers /></AdminLayout>}</Route>
            <Route path="/admin/roles">{() => <AdminLayout><AdminRoles /></AdminLayout>}</Route>
            <Route path="/admin/users/:clerkId">{(params) => <AdminLayout><AdminUserDetail clerkId={params.clerkId} /></AdminLayout>}</Route>
            <Route path="/admin/users">{() => <AdminLayout><AdminUsers /></AdminLayout>}</Route>
            <Route path="/admin/age-group-waivers">{() => <AdminLayout><AdminAgeGroupWaivers /></AdminLayout>}</Route>
            <Route path="/admin/disputes">{() => <AdminLayout><AdminDisputes /></AdminLayout>}</Route>
            <Route path="/admin/messaging">{() => <AdminMessaging />}</Route>
            <Route path="/admin/kotc/new">{() => <KotcNewPage />}</Route>
            <Route path="/admin/kotc/:id/edit">{() => <KotcEditPage />}</Route>
            <Route path="/admin/kings-of-the-court">{() => <AdminLayout><AdminKingsOfTheCourt /></AdminLayout>}</Route>
            <Route path="/battle-mod/:battleId">{() => <BattleModeratorPage />}</Route>
            <Route path="/kotc/seasons/:id">{() => <KotcSeasonDetailPage />}</Route>
            <Route path="/kotc/my-teams">{() => <KotcMyTeamsPage />}</Route>
            <Route path="/kotc/teams/:teamId">{() => <KotcTeamPage />}</Route>
            <Route path="/kotc/leaderboard">{() => <KotcLeaderboardPage />}</Route>
            <Route path="/kotc/battles/:battleId/live">{() => <KotcBattleLivePage />}</Route>
            <Route path="/rentals" component={RentalsPage} />
            <Route path="/waiver/rental/:token">{(params) => <WaiverRentalPage params={params} />}</Route>
            <Route path="/ref-alerts" component={RefAlerts} />

            <Route path="/checkout" component={Checkout} />
            <Route path="/checkout/complete" component={CheckoutComplete} />

            <Route path="/connect/complete" component={ConnectComplete} />
            <Route path="/connect/refresh" component={ConnectRefresh} />

            <Route path="/leagues/join/:token" component={LeagueJoin} />
            <Route path="/leagues">{() => <Redirect to="/explore?type=league" />}</Route>
            <Route path="/leagues/:id" component={LeagueDetail} />
            
            <Route path="/camps/:id/health-packet" component={CampHealthPacket} />
            <Route path="/camps">{() => <Redirect to="/explore?type=camp" />}</Route>
            <Route path="/camps/:id" component={CampDetail} />
            
            <Route path="/dropins">{() => <Redirect to="/explore?type=drop_in" />}</Route>
            <Route path="/dropins/occ/:templateId/:date" component={DropinOccurrenceDetail} />
            <Route path="/dropins/:id" component={DropinDetail} />
            
            <Route path="/tournaments">{() => <Redirect to="/explore?type=tournament" />}</Route>
            <Route path="/tournaments/:id/self-checkin" component={TournamentSelfCheckin} />
            <Route path="/tournaments/:id" component={TournamentDetail} />
            
            <Route component={() => <Layout><NotFound /></Layout>} />
          </Switch>
          <Toaster />
          <PwaInstallBanner />
          <OfflineShell />
        </TooltipProvider>
        </DashboardTabContext.Provider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;