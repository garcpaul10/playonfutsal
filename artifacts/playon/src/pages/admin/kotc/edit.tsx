/**
 * KotC Division Edit Wizard — pre-populates all steps from existing division data.
 *
 * Reuses all step components from new.tsx.
 * Existing battles are listed in Step 4 for reference; edit or delete them from the
 * division's Battles tab on the admin dashboard (admin/kings-of-the-court.tsx). New
 * battle cards can be added here.
 * Roster size, grace period, lives-to-register, and life pack pricing are platform-wide
 * now — edit them from KotC Settings on the dashboard, not here.
 * Save fires PATCH /api/kotc/seasons/:id then POSTs any new battle cards.
 */

import React, { useState, useCallback, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { useAuth } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { WizardShell } from "@/components/admin/WizardShell";
import { useDraftAutosave } from "@/hooks/use-draft-autosave";
import {
  WizardState,
  BattleEntry,
  defaultWizardState,
  Step1Basics,
  Step2MatchRules,
  Step4Dates,
  Step5Battles,
  Step6Review,
} from "./new";

const API = (import.meta.env.VITE_API_URL ?? "https://workspaceapi-server-production-3488.up.railway.app").replace(/\/$/, "") + "/api";
const STEPS = ["Basics", "Match Rules", "Dates", "Battles", "Review"];

function useAuthHeaders() {
  const { getToken } = useAuth();
  return useCallback(async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  }, [getToken]);
}

function seasonToWizardState(season: any): WizardState {
  const base = defaultWizardState();
  return {
    ...base,
    name: season.name ?? "",
    sport: season.sport ?? "basketball",
    genderBracket: season.genderBracket ?? "coed",
    ageBracket: season.ageBracket ?? "open",
    notes: season.notes ?? "",
    winMode: (season.winCondition === "time_limit" ? "time_limit" : "points") as WizardState["winMode"],
    winTarget: String(season.winTarget ?? 7),
    timeLimitMinutes: String(season.timeLimitMinutes ?? 5),
    teamSize: String(season.teamSize ?? 4),
    startsAt: season.startsAt
      ? new Date(season.startsAt).toISOString().slice(0, 16)
      : "",
    endsAt: season.endsAt
      ? new Date(season.endsAt).toISOString().slice(0, 16)
      : "",
    battles: [],
  };
}

export default function KotcEditPage() {
  const [, params] = useRoute("/admin/kotc/:id/edit");
  const seasonId = Number(params?.id);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const getHeaders = useAuthHeaders();

  const [step, setStep] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const [state, setState] = useState<WizardState>(defaultWizardState);

  function onChange(patch: Partial<WizardState>) {
    setState((s) => ({ ...s, ...patch }));
  }

  const { data: season, isLoading: seasonLoading } = useQuery({
    queryKey: ["kotc-season-edit", seasonId],
    enabled: !!seasonId,
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/kotc/seasons/${seasonId}`, { headers });
      if (!r.ok) throw new Error("Season not found");
      return r.json();
    },
  });

  const { data: existingBattles = [] } = useQuery({
    queryKey: ["kotc-battles-edit", seasonId],
    enabled: !!seasonId,
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/kotc/seasons/${seasonId}/battles`, { headers });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const { data: venues = [] } = useQuery({
    queryKey: ["venues"],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/venues`, { headers });
      return r.json();
    },
  });

  const { data: courts = [] } = useQuery({
    queryKey: ["courts"],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/courts`, { headers });
      return r.json();
    },
  });

  useEffect(() => {
    if (season && !hydrated) {
      const draftKey = `kotc-season-draft-${seasonId}`;
      const savedRaw = (() => {
        try {
          const s = localStorage.getItem(draftKey);
          return s ? JSON.parse(s) : null;
        } catch {
          return null;
        }
      })();
      setState(savedRaw ? { ...seasonToWizardState(season), ...savedRaw } : seasonToWizardState(season));
      setHydrated(true);
    }
  }, [season, hydrated, seasonId]);

  const { restoredFromDraft, setRestoredFromDraft, clearDraft, publishedRef } =
    useDraftAutosave<WizardState>({
      localStorageKey: `kotc-season-draft-${seasonId}`,
      draftIdKey: `kotc-season-draft-${seasonId}-id`,
      remoteDraftBaseUrl: `${API}/kotc/drafts`,
      state,
      getHeaders,
      enableRemoteSave: false,
      enabled: hydrated,
    });

  const endInvalid = state.startsAt && state.endsAt && state.endsAt <= state.startsAt;

  const canProceed: Record<number, boolean> = {
    0: !!state.name.trim(),
    1: !!state.winTarget,
    2: !endInvalid,
    3: true,
    4: true,
  };

  async function handleSaveChanges() {
    setIsSaving(true);
    try {
      const headers = await getHeaders();

      const r = await fetch(`${API}/kotc/seasons/${seasonId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          name: state.name,
          sport: state.sport,
          genderBracket: state.genderBracket,
          ageBracket: state.ageBracket,
          teamSize: Number(state.teamSize),
          winCondition: state.winMode,
          winTarget: Number(state.winTarget),
          timeLimitMinutes: state.winMode === "time_limit" ? Number(state.timeLimitMinutes) : undefined,
          startsAt: state.startsAt || null,
          endsAt: state.endsAt || null,
          notes: state.notes || null,
        }),
      });

      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: "Failed to update division" }));
        throw new Error(err.error ?? "Failed to update division");
      }

      for (const battle of state.battles) {
        if (!battle.scheduledAt) continue;
        await fetch(`${API}/kotc/seasons/${seasonId}/battles`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            scheduledAt: battle.scheduledAt,
            venueId: state.venueId ? Number(state.venueId) : null,
            courtIds: battle.courtIds.length > 0 ? battle.courtIds : undefined,
            maxTeamsPerCourt: Number(battle.maxTeamsPerCourt),
            durationMinutes: Number(battle.durationMinutes),
            notes: battle.notes || null,
          }),
        });
      }

      publishedRef.current = true;
      clearDraft();
      toast({ title: "Division saved!" });
      setLocation("/admin/kings-of-the-court");
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }

  if (seasonLoading || !hydrated) {
    return (
      <div className="min-h-screen bg-background p-8 max-w-2xl mx-auto space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const isLastStep = step === STEPS.length - 1;

  return (
    <WizardShell
      title="Edit KotC Division"
      backHref="/admin/kings-of-the-court"
      steps={STEPS}
      step={step}
      setStep={setStep}
      canProceed={canProceed[step] !== false}
      isLastStep={isLastStep}
      isSaving={isSaving}
      restoredFromDraft={restoredFromDraft}
      onDiscardDraft={() => {
        clearDraft();
        if (season) setState(seasonToWizardState(season));
      }}
      onPublish={isLastStep ? handleSaveChanges : undefined}
      publishLabel="Save Changes"
      publishDisabled={isSaving || !state.name.trim()}
    >
      {step === 0 && <Step1Basics state={state} onChange={onChange} venues={venues} />}
      {step === 1 && <Step2MatchRules state={state} onChange={onChange} />}
      {step === 2 && <Step4Dates state={state} onChange={onChange} />}
      {step === 3 && (
        <Step5Battles
          state={state}
          onChange={onChange}
          courts={courts}
          existingBattles={existingBattles}
        />
      )}
      {step === 4 && (
        <Step6Review state={state} venues={venues} courts={courts} isEditMode={true} />
      )}
    </WizardShell>
  );
}
