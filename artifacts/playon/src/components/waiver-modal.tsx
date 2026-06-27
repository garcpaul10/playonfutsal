import React, { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@clerk/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WaiverForm, type WaiverData } from "@/components/waiver-form";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { API_BASE as API } from "@/lib/api-base";

export function useParticipantProfile() {
  const { getToken, isSignedIn } = useAuth();

  return useQuery({
    queryKey: ["me", "participant-profile"],
    queryFn: async () => {
      const token = await getToken();
      const r = await fetch(`${API}/me/player-profile`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.status === 404) return null;
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!isSignedIn,
    staleTime: 5 * 60 * 1000,
  });
}

interface WaiverModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

export function WaiverModal({ open, onOpenChange, onComplete }: WaiverModalProps) {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function handleWaiverSubmit(data: WaiverData) {
    setSubmitting(true);
    setError("");
    try {
      const token = await getToken();

      if (data.isForChild) {
        const r = await fetch(`${API}/youth`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            firstName: data.firstName,
            lastName: data.lastName,
            dateOfBirth: data.dateOfBirth,
            emergencyContactName: data.emergencyContactName,
            emergencyContactPhone: data.emergencyContactPhone,
            relationship: "parent",
            guardianConsentGiven: true,
            signatureData: data.signatureData,
            signatureType: data.signatureType,
            templateId: data.templateId,
          }),
        });

        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body?.error || "Failed to create child profile.");
        }

        // Also create the parent's own player profile so the waiver gate passes
        // on subsequent registrations. Ignore 409 (already exists).
        await fetch(`${API}/me/player-profile`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            emergencyContactName: data.emergencyContactName,
            emergencyContactPhone: data.emergencyContactPhone,
            signatureData: data.signatureData,
            signatureType: data.signatureType,
            templateId: data.templateId,
          }),
        }).catch(() => {});
      } else {
        const displayName = `${data.firstName} ${data.lastName}`.trim();
        const r = await fetch(`${API}/me/player-profile`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            displayName,
            dateOfBirth: data.dateOfBirth,
            emergencyContactName: data.emergencyContactName,
            emergencyContactPhone: data.emergencyContactPhone,
            signatureData: data.signatureData,
            signatureType: data.signatureType,
            templateId: data.templateId,
          }),
        });

        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          if (r.status === 409) {
            // Profile exists; still record the waiver signature
            await fetch(`${API}/me/waiver-signature`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                templateId: data.templateId,
                signatureData: data.signatureData,
                signatureType: data.signatureType,
              }),
            }).catch(() => {});

            qc.invalidateQueries({ queryKey: ["me", "participant-profile"] });
            setDone(true);
            setTimeout(() => {
              setDone(false);
              onComplete();
              onOpenChange(false);
            }, 800);
            return;
          }
          throw new Error(body?.error || "Failed to create participant profile.");
        }
      }

      qc.invalidateQueries({ queryKey: ["me", "participant-profile"] });
      setDone(true);
      setTimeout(() => {
        setDone(false);
        onComplete();
        onOpenChange(false);
      }, 800);
    } catch (err: any) {
      setError(err?.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#222E2E] border border-[#2b353a] text-white max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white text-xl font-bold">
            Before you register
          </DialogTitle>
          <DialogDescription className="text-[#99a1a3]">
            Complete this once and you'll never see it again.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="flex flex-col items-center justify-center py-10 gap-3">
            <CheckCircle2 className="h-12 w-12 text-green-400" />
            <p className="text-white font-semibold text-lg">Profile saved!</p>
            <p className="text-[#99a1a3] text-sm">Continuing to registration…</p>
          </div>
        ) : (
          <>
            <WaiverForm
              onSubmit={handleWaiverSubmit}
              disabled={submitting}
              submitLabel={submitting ? "Saving…" : "Save & Continue →"}
            />
            {error && (
              <div className="rounded-lg bg-red-900/30 border border-red-800/50 px-4 py-3 mt-2">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface UseWaiverGateResult {
  profileLoading: boolean;
  hasProfile: boolean;
  waiverOpen: boolean;
  setWaiverOpen: (v: boolean) => void;
  ensureProfile: (onReady: () => void) => void;
  pendingAction: (() => void) | null;
  WaiverModalElement: React.ReactElement;
}

function useTopLevelProfile() {
  const { getToken, isSignedIn } = useAuth();
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const token = await getToken();
      const r = await fetch(
        `${API}/me`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!isSignedIn,
    staleTime: 5 * 60 * 1000,
  });
}

export function useWaiverGate(): UseWaiverGateResult {
  const { data: profile, isLoading: profileLoading } = useParticipantProfile();
  const { data: topProfile, isLoading: topProfileLoading } = useTopLevelProfile();
  const [, setLocation] = useLocation();
  const [waiverOpen, setWaiverOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  // Users who completed the new onboarding flow have waiverSigned:true on their
  // top-level profile — skip the gate for them even if player-profile is somehow absent.
  const hasProfile = !!profile || (!!topProfile && topProfile.waiverSigned === true && topProfile.waiverExpired === false);

  function ensureProfile(onReady: () => void) {
    // While the top-level profile is still loading, treat as not-yet-onboarded (safe default).
    if (topProfileLoading) {
      return;
    }
    // Gate on completed onboarding: must have at least one role AND idVerified.
    const roles: string[] = Array.isArray(topProfile?.roles) ? topProfile.roles : [];
    if (!topProfile || roles.length === 0 || !topProfile.idVerified) {
      setLocation("/onboarding");
      return;
    }
    // Onboarding complete — proceed to waiver check.
    if (hasProfile) {
      onReady();
    } else {
      setPendingAction(() => onReady);
      setWaiverOpen(true);
    }
  }

  function handleWaiverComplete() {
    if (pendingAction) {
      pendingAction();
      setPendingAction(null);
    }
  }

  const WaiverModalElement = (
    <WaiverModal
      open={waiverOpen}
      onOpenChange={setWaiverOpen}
      onComplete={handleWaiverComplete}
    />
  );

  return {
    profileLoading,
    hasProfile,
    waiverOpen,
    setWaiverOpen,
    ensureProfile,
    pendingAction,
    WaiverModalElement,
  };
}

// ── Child waiver status hook ───────────────────────────────────────────────────
// Fetches GET /me/waiver-status?youthUserId=:childId for a specific linked child.
// Returns null while loading; hasSigned=false when no valid signature exists.

export function useChildWaiverStatus(childId: number | null) {
  const { getToken, isSignedIn } = useAuth();
  return useQuery({
    queryKey: ["child-waiver-status", childId],
    queryFn: async () => {
      const token = await getToken();
      const r = await fetch(`${API}/me/waiver-status?youthUserId=${childId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.status === 403) return { hasSigned: false, isExpired: true, signature: null };
      if (!r.ok) return { hasSigned: false, isExpired: true, signature: null };
      return r.json() as Promise<{ hasSigned: boolean; isExpired: boolean; signature: any | null }>;
    },
    enabled: !!isSignedIn && childId != null,
    staleTime: 2 * 60 * 1000,
  });
}

// ── Sign-for-child modal ───────────────────────────────────────────────────────
// Used when a parent needs to sign the liability waiver specifically for an
// already-linked child (existing profile). Posts to /me/waiver-signature with
// youthUserId, without creating a new child profile.

interface ChildWaiverSignModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  childId: number;
  childName: string;
  onComplete: () => void;
}

export function ChildWaiverSignModal({ open, onOpenChange, childId, childName, onComplete }: ChildWaiverSignModalProps) {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const [signatureName, setSignatureName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const { data: template, isLoading: tplLoading } = useQuery({
    queryKey: ["waiver", "active"],
    queryFn: async () => {
      const r = await fetch(`${API}/waivers/active`);
      if (!r.ok) throw new Error("Failed to load waiver");
      return r.json() as Promise<{ id: number; name: string; version: number; body: string }>;
    },
    staleTime: 10 * 60 * 1000,
    enabled: open,
  });

  async function handleSign() {
    if (!signatureName.trim()) { setError("Please type your full legal name to sign."); return; }
    if (!agreed) { setError("You must read and accept the waiver to continue."); return; }
    if (!template) return;
    setSubmitting(true);
    setError("");
    try {
      const token = await getToken();
      const r = await fetch(`${API}/me/waiver-signature`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          templateId: template.id,
          signatureData: signatureName.trim(),
          signatureType: "typed",
          youthUserId: childId,
        }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.error || "Failed to submit signature.");
      }
      qc.invalidateQueries({ queryKey: ["child-waiver-status", childId] });
      setDone(true);
      setTimeout(() => {
        setDone(false);
        setSignatureName("");
        setAgreed(false);
        onComplete();
        onOpenChange(false);
      }, 800);
    } catch (err: any) {
      setError(err?.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!submitting) { setError(""); setSignatureName(""); setAgreed(false); setDone(false); onOpenChange(v); } }}>
      <DialogContent className="bg-[#222E2E] border border-[#2b353a] text-white max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white text-xl font-bold">Sign Waiver for {childName}</DialogTitle>
          <DialogDescription className="text-[#99a1a3]">
            As the parent/guardian, you must sign the liability waiver on behalf of {childName} before registering them.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="flex flex-col items-center justify-center py-10 gap-3">
            <CheckCircle2 className="h-12 w-12 text-green-400" />
            <p className="text-white font-semibold text-lg">Waiver signed!</p>
          </div>
        ) : tplLoading ? (
          <div className="flex items-center justify-center py-8 gap-2">
            <Loader2 className="h-5 w-5 text-primary animate-spin" />
            <span className="text-[#99a1a3] text-sm">Loading waiver…</span>
          </div>
        ) : !template ? (
          <div className="rounded-lg bg-red-900/20 border border-red-800/40 p-4">
            <p className="text-red-400 text-sm">Failed to load waiver. Please refresh and try again.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl bg-[#1a2626] border border-[#3b474c] p-4 max-h-56 overflow-y-auto">
              <p className="text-[#99a1a3] text-xs leading-relaxed whitespace-pre-wrap">{template.body}</p>
            </div>

            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => { setAgreed(e.target.checked); if (error) setError(""); }}
                className="mt-0.5 accent-primary"
              />
              <span className="text-[#99a1a3] text-sm leading-relaxed">
                I have read and agree to the terms of this waiver on behalf of {childName}.
              </span>
            </label>

            <div className="space-y-1.5">
              <label className="text-white text-sm font-medium">Your full legal name (typed signature)</label>
              <Input
                placeholder="Type your full name"
                value={signatureName}
                onChange={(e) => { setSignatureName(e.target.value); if (error) setError(""); }}
                className="bg-[#2b353a] border-[#3b474c] text-white placeholder:text-[#99a1a3] h-11"
                disabled={submitting}
              />
            </div>

            {error && (
              <div className="rounded-lg bg-red-900/30 border border-red-800/50 px-4 py-3 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}
          </div>
        )}

        {!done && template && (
          <DialogFooter className="gap-2 mt-2">
            <Button variant="outline" className="border-[#3b474c] text-white hover:bg-white/10" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button className="bg-primary hover:bg-primary/85 text-primary-foreground font-semibold" onClick={handleSign} disabled={submitting || !agreed || !signatureName.trim()}>
              {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Signing…</> : "Sign Waiver"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
