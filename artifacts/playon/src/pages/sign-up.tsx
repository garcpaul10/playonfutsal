import { API_BASE } from "@/lib/api-base";
import React, { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { SignUp, useAuth } from "@clerk/react";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck, AlertCircle } from "lucide-react";
import playonLogo from "@assets/PlayOn_RBG_Trans_1780083327599.png";
import { useProfileGate } from "@/hooks/use-profile-gate";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const PRIVILEGED_ROLE_LABELS: Record<string, string> = {
  ref: "Referee",
  coach: "Coach",
  scorekeeper: "Scorekeeper",
  manager: "Team Manager",
  team_manager: "Team Manager",
  team_coach: "Team Coach",
};

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(195,14%,14%)] px-4 py-12">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}

function SignUpCompletePage() {
  const [, setLocation] = useLocation();
  const { isLoaded } = useAuth();
  const { checkAndRedirect } = useProfileGate();
  const doneRef = useRef(false);

  useEffect(() => {
    if (!isLoaded) return;
    if (doneRef.current) return;
    doneRef.current = true;

    const inviteToken = sessionStorage.getItem("signupInviteToken");

    const save = async () => {
      try {
        if (inviteToken) {
          await fetch(`${API_BASE}/me`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ inviteToken }),
          });
          sessionStorage.removeItem("signupInviteToken");
          setLocation("/dashboard");
          return;
        }

        const teamToken = sessionStorage.getItem("signupTeamInviteToken");
        if (teamToken) {
          const claimRes = await fetch(`${API_BASE}/me/claim-team-invite`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: teamToken }),
          });
          sessionStorage.removeItem("signupTeamInviteToken");
          if (!claimRes.ok) {
            const body = await claimRes.json().catch(() => ({}));
            console.warn("[team-invite] claim failed:", body?.error);
            setLocation(`/onboarding?invite_error=${encodeURIComponent(body?.error ?? "Invite could not be claimed")}`);
            return;
          }
          setLocation("/dashboard");
          return;
        }
      } catch {}

      // Check whether this user already has a complete profile (e.g. migrating from
      // the old Clerk instance). If so, skip onboarding and go straight to /dashboard.
      await checkAndRedirect();
    };

    save();
  }, [isLoaded, setLocation, checkAndRedirect]);

  return (
    <PageShell>
      <div className="bg-[#222E2E] rounded-2xl border border-[#2b353a] shadow-2xl overflow-hidden p-8 flex flex-col items-center justify-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-[#99a1a3] text-sm">Setting up your account…</p>
      </div>
    </PageShell>
  );
}

export default function SignUpPage() {
  const isComplete =
    window.location.pathname === `${basePath}/sign-up/complete` ||
    window.location.pathname.endsWith("/sign-up/complete");

  if (isComplete) {
    return <SignUpCompletePage />;
  }

  return <SignUpFlow />;
}

function SignUpFlow() {
  const { isSignedIn, isLoaded: authLoaded } = useAuth();
  const [, setLocation] = useLocation();
  const { checkAndRedirect } = useProfileGate();
  const gateCalledRef = useRef(false);

  useEffect(() => {
    if (!authLoaded || !isSignedIn || gateCalledRef.current) return;

    // Invite flows (staff invite or team invite) must complete their claim step
    // inside SSOCallbackPage / SignUpCompletePage before a profile check is safe.
    // Skip the gate entirely so those pages can finish processing.
    const params = new URLSearchParams(window.location.search);
    const hasInviteParam = params.has("invite") || params.has("team_invite");
    const hasInviteSession =
      !!sessionStorage.getItem("signupInviteToken") ||
      !!sessionStorage.getItem("signupTeamInviteToken");
    if (hasInviteParam || hasInviteSession) return;

    gateCalledRef.current = true;
    checkAndRedirect();
  }, [authLoaded, isSignedIn, checkAndRedirect]);

  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [inviteRole, setInviteRole] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteChecked, setInviteChecked] = useState(false);
  const fetchedRef = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const staffToken = params.get("invite");
    const teamToken  = params.get("team_invite");

    if (!staffToken && !teamToken) {
      setInviteChecked(true);
      return;
    }
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    setInviteLoading(true);

    const endpoint = teamToken
      ? `${API_BASE}/invites/team/${teamToken}`
      : `${API_BASE}/invites/${staffToken}`;
    const rawToken = teamToken ?? staffToken;
    const storageKey = teamToken ? "signupTeamInviteToken" : "signupInviteToken";

    fetch(endpoint)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setInviteError(body?.error || "This invite link is no longer valid.");
          return;
        }
        const data = await res.json();
        setInviteToken(rawToken ?? null);
        setInviteRole(teamToken ? (data.role === "manager" ? "team_manager" : "team_coach") : data.role);
        setInviteEmail(data.email);
        if (rawToken) sessionStorage.setItem(storageKey, rawToken);
      })
      .catch(() => {
        setInviteError("Could not validate invite. Please check your connection.");
      })
      .finally(() => {
        setInviteLoading(false);
        setInviteChecked(true);
      });
  }, []);

  if (inviteLoading || !inviteChecked) {
    return (
      <PageShell>
        <div className="bg-[#222E2E] rounded-2xl border border-[#2b353a] shadow-2xl overflow-hidden p-8 flex flex-col items-center justify-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-[#99a1a3] text-sm">Validating your invite…</p>
        </div>
      </PageShell>
    );
  }

  if (inviteError) {
    return (
      <PageShell>
        <div className="bg-[#222E2E] rounded-2xl border border-[#2b353a] shadow-2xl overflow-hidden p-8">
          <div className="flex items-center justify-center w-14 h-14 rounded-full bg-red-900/20 border border-red-800/40 mx-auto mb-6">
            <AlertCircle className="h-6 w-6 text-red-400" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2 text-center">Invite link invalid</h1>
          <p className="text-[#99a1a3] text-sm text-center mb-6">{inviteError}</p>
          <p className="text-[#99a1a3] text-xs text-center mb-6">
            If you believe this is a mistake, ask your admin to send a new invite.
          </p>
          <Link href="/">
            <Button className="w-full h-11 bg-primary hover:bg-primary/85 text-primary-foreground font-semibold text-sm">
              Back to home
            </Button>
          </Link>
        </div>
      </PageShell>
    );
  }

  const inviteBadge = inviteRole && (
    <div className="rounded-xl bg-primary/15 border border-primary/40 px-4 py-3 flex items-start gap-3 mb-6">
      <ShieldCheck className="h-4 w-4 text-primary shrink-0 mt-0.5" />
      <div>
        <p className="text-white text-sm font-semibold">
          You've been invited as a {PRIVILEGED_ROLE_LABELS[inviteRole] ?? inviteRole}
        </p>
        {inviteEmail && (
          <p className="text-[#99a1a3] text-xs mt-0.5">
            Invite sent to <span className="text-white">{inviteEmail}</span>
          </p>
        )}
      </div>
    </div>
  );

  const handleSignInToClaim = () => {
    // Token is already saved to sessionStorage during validation above.
    // Just navigate to sign-in — SSOCallbackPage will pick it up after login.
    setLocation("/sign-in");
  };

  return (
    <PageShell>
      {inviteBadge && (
        <div className="mb-4">{inviteBadge}</div>
      )}
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        afterSignUpUrl={`${basePath}/sso-callback`}
        initialValues={inviteEmail ? { emailAddress: inviteEmail } : undefined}
      />
      {inviteToken && (
        <div className="mt-4 text-center">
          <p className="text-[#99a1a3] text-sm mb-2">Already have a PlayOn account?</p>
          <Button
            variant="outline"
            className="w-full h-10 border-[#2b353a] bg-transparent text-white hover:bg-[#2b353a] text-sm font-medium"
            onClick={handleSignInToClaim}
          >
            Sign in to claim this invite
          </Button>
        </div>
      )}
    </PageShell>
  );
}
