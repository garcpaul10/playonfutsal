/**
 * KotC Season Creation Wizard — 6 steps
 *
 * Step 1: Basics         — name, sport, venue, gender bracket, age bracket, notes
 * Step 2: Match Rules    — win mode toggle, win target, time limit, grace period, team size
 * Step 3: Registration   — lives required, max teams/court, life pack config (advanced)
 * Step 4: Season Dates   — start / end datetime with end > start validation
 * Step 5: Battles        — add battle cards with court checkbox list
 * Step 6: Review         — full read-only summary + Save Draft / Publish
 */

import React, { useState, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { WizardShell } from "@/components/admin/WizardShell";
import { useDraftAutosave } from "@/hooks/use-draft-autosave";
import { Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";

const API = (import.meta.env.VITE_API_URL ?? "https://workspaceapi-server-production-3488.up.railway.app").replace(/\/$/, "") + "/api";

const STEPS = ["Basics", "Match Rules", "Registration", "Dates", "Battles", "Review"];

export const SPORTS = [
  { value: "basketball", label: "🏀 Basketball" },
  { value: "soccer", label: "⚽ Soccer" },
  { value: "futsal", label: "⚽ Futsal" },
  { value: "volleyball", label: "🏐 Volleyball" },
  { value: "tennis", label: "🎾 Tennis" },
  { value: "pickleball", label: "🏓 Pickleball" },
  { value: "badminton", label: "🏸 Badminton" },
  { value: "hockey", label: "🏒 Hockey" },
  { value: "baseball", label: "⚾ Baseball" },
  { value: "other", label: "🏃 Other" },
];

export const KOTC_GENDER_BRACKETS = [
  { value: "coed", label: "Coed" },
  { value: "men", label: "Men" },
  { value: "women", label: "Women" },
  { value: "boys", label: "Boys" },
  { value: "girls", label: "Girls" },
];

export const KOTC_AGE_BRACKETS = [
  { value: "open", label: "Open" },
  { value: "adult", label: "Adult 18+" },
  { value: "u18", label: "U18" },
  { value: "u16", label: "U16" },
  { value: "u14", label: "U14" },
  { value: "u12", label: "U12" },
];

const DEFAULT_LIFE_PACKS = JSON.stringify(
  [
    { name: "Starter Pack", lives: 3, priceCents: 999 },
    { name: "Pro Pack", lives: 7, priceCents: 1999 },
    { name: "Elite Pack", lives: 15, priceCents: 3999 },
  ],
  null,
  2,
);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BattleEntry {
  scheduledAt: string;
  courtIds: number[];
  maxTeamsPerCourt: string;
  durationMinutes: string;
  notes: string;
}

export interface WizardState {
  name: string;
  sport: string;
  venueId: string;
  genderBracket: string;
  ageBracket: string;
  notes: string;
  winMode: "points" | "time_limit";
  winTarget: string;
  timeLimitMinutes: string;
  gracePeriodSeconds: string;
  teamSize: string;
  livesRequired: string;
  maxTeamsPerCourt: string;
  lifePacksJson: string;
  startsAt: string;
  endsAt: string;
  battles: BattleEntry[];
}

export function defaultWizardState(): WizardState {
  return {
    name: "",
    sport: "basketball",
    venueId: "",
    genderBracket: "coed",
    ageBracket: "open",
    notes: "",
    winMode: "points",
    winTarget: "7",
    timeLimitMinutes: "5",
    gracePeriodSeconds: "60",
    teamSize: "4",
    livesRequired: "3",
    maxTeamsPerCourt: "8",
    lifePacksJson: DEFAULT_LIFE_PACKS,
    startsAt: "",
    endsAt: "",
    battles: [],
  };
}

function defaultBattle(maxTeamsPerCourt: string): BattleEntry {
  return {
    scheduledAt: "",
    courtIds: [],
    maxTeamsPerCourt,
    durationMinutes: "120",
    notes: "",
  };
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

function useAuthHeaders() {
  const { getToken } = useAuth();
  return useCallback(async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  }, [getToken]);
}

// ─── Step 1 — Basics ─────────────────────────────────────────────────────────

export function Step1Basics({
  state,
  onChange,
  venues,
}: {
  state: WizardState;
  onChange: (s: Partial<WizardState>) => void;
  venues: any[];
}) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Set the season name, sport, venue, and bracket restrictions. Courts shown in Step 5 are
        filtered to the venue you select here.
      </p>

      <div>
        <Label>Season Name</Label>
        <Input
          className="mt-1"
          placeholder="e.g. Summer 2026 Basketball"
          value={state.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <p className="text-xs text-muted-foreground mt-1">
          Players and admins see this name on the season card.
        </p>
      </div>

      <div>
        <Label>Sport</Label>
        <div className="grid grid-cols-3 gap-2 mt-2">
          {SPORTS.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => onChange({ sport: s.value })}
              className={[
                "rounded-lg border px-3 py-2 text-sm text-left transition-all",
                state.sport === s.value
                  ? "border-primary bg-primary/10 text-primary font-medium"
                  : "border-border bg-card hover:border-primary/40",
              ].join(" ")}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <Label>Venue</Label>
        <select
          className="w-full h-9 rounded border border-input bg-background px-2 text-sm mt-1"
          value={state.venueId}
          onChange={(e) => onChange({ venueId: e.target.value })}
        >
          <option value="">Select venue…</option>
          {venues.map((v: any) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground mt-1">
          The facility where battles take place. Courts are loaded from this venue.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Gender Bracket</Label>
          <select
            className="w-full h-9 rounded border border-input bg-background px-2 text-sm mt-1"
            value={state.genderBracket}
            onChange={(e) => onChange({ genderBracket: e.target.value })}
          >
            {KOTC_GENDER_BRACKETS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground mt-1">
            Restricts registration to the selected gender. Choose Coed for mixed play.
          </p>
        </div>
        <div>
          <Label>Age Bracket</Label>
          <select
            className="w-full h-9 rounded border border-input bg-background px-2 text-sm mt-1"
            value={state.ageBracket}
            onChange={(e) => onChange({ ageBracket: e.target.value })}
          >
            {KOTC_AGE_BRACKETS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground mt-1">
            Sets the age range for this season.
          </p>
        </div>
      </div>

      <div>
        <Label>Notes / Description</Label>
        <Textarea
          className="mt-1"
          rows={3}
          placeholder="Any details admins or players should know about this season…"
          value={state.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
        />
        <p className="text-xs text-muted-foreground mt-1">
          Any details admins or players should know about this season.
        </p>
      </div>
    </div>
  );
}

// ─── Step 2 — Match Rules ─────────────────────────────────────────────────────

export function Step2MatchRules({
  state,
  onChange,
}: {
  state: WizardState;
  onChange: (s: Partial<WizardState>) => void;
}) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        These rules apply to every battle in the season. You can override them on individual battles later.
      </p>

      <div>
        <Label>Win Mode</Label>
        <div className="flex gap-2 mt-2">
          {[
            { value: "points", label: "Points Only" },
            { value: "time_limit", label: "Points + Time Limit" },
          ].map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => onChange({ winMode: m.value as WizardState["winMode"] })}
              className={[
                "flex-1 rounded-lg border px-3 py-2.5 text-sm text-center transition-all",
                state.winMode === m.value
                  ? "border-primary bg-primary/10 text-primary font-medium"
                  : "border-border bg-card hover:border-primary/40",
              ].join(" ")}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Win Target (points)</Label>
          <Input
            type="number"
            min="1"
            className="mt-1"
            value={state.winTarget}
            onChange={(e) => onChange({ winTarget: e.target.value })}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Number of points a team must score to win the battle.
          </p>
        </div>

        {state.winMode === "time_limit" && (
          <div>
            <Label>Time Limit (minutes)</Label>
            <Input
              type="number"
              min="1"
              className="mt-1"
              value={state.timeLimitMinutes}
              onChange={(e) => onChange({ timeLimitMinutes: e.target.value })}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Maximum minutes per battle. If time expires, the team with more points wins.
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Grace Period (seconds)</Label>
          <Input
            type="number"
            min="0"
            className="mt-1"
            value={state.gracePeriodSeconds}
            onChange={(e) => onChange({ gracePeriodSeconds: e.target.value })}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Seconds a late team has to show up before the battle is forfeited.
          </p>
        </div>
        <div>
          <Label>Team Size</Label>
          <Input
            type="number"
            min="1"
            className="mt-1"
            value={state.teamSize}
            onChange={(e) => onChange({ teamSize: e.target.value })}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Number of players on each team per battle — e.g. 3 for 3-on-3.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Step 3 — Registration & Economy ─────────────────────────────────────────

export function Step3Registration({
  state,
  onChange,
}: {
  state: WizardState;
  onChange: (s: Partial<WizardState>) => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Control who can enter and how the life economy works for this season.
      </p>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Lives Required to Register</Label>
          <Input
            type="number"
            min="0"
            className="mt-1"
            value={state.livesRequired}
            onChange={(e) => onChange({ livesRequired: e.target.value })}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Players must hold at least this many lives to register for the season.
          </p>
        </div>
        <div>
          <Label>Max Teams Per Court</Label>
          <Input
            type="number"
            min="1"
            className="mt-1"
            value={state.maxTeamsPerCourt}
            onChange={(e) => onChange({ maxTeamsPerCourt: e.target.value })}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Caps how many teams can queue at a single court at once.
          </p>
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <button
          type="button"
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          <span>Advanced settings — Life Pack config</span>
          {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {showAdvanced && (
          <div className="px-4 pb-4 pt-1 border-t">
            <Label>Life Pack Config (JSON)</Label>
            <Textarea
              className="mt-1 font-mono text-xs"
              rows={8}
              value={state.lifePacksJson}
              onChange={(e) => onChange({ lifePacksJson: e.target.value })}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Defines the life economy for this season. Leave as default unless you have specific requirements.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Step 4 — Season Dates ────────────────────────────────────────────────────

export function Step4Dates({
  state,
  onChange,
}: {
  state: WizardState;
  onChange: (s: Partial<WizardState>) => void;
}) {
  const endBeforeStart =
    state.startsAt && state.endsAt && state.endsAt <= state.startsAt;

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Defines the window during which battles can take place.
      </p>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Season Start</Label>
          <Input
            type="datetime-local"
            className="mt-1"
            value={state.startsAt}
            onChange={(e) => onChange({ startsAt: e.target.value })}
          />
          <p className="text-xs text-muted-foreground mt-1">
            The first date battles can be scheduled.
          </p>
        </div>
        <div>
          <Label>Season End</Label>
          <Input
            type="datetime-local"
            className="mt-1"
            value={state.endsAt}
            onChange={(e) => onChange({ endsAt: e.target.value })}
          />
          <p className="text-xs text-muted-foreground mt-1">
            After this date, no new battles can be scheduled.
          </p>
        </div>
      </div>

      {endBeforeStart && (
        <p className="text-sm text-destructive font-medium">
          ⚠️ Season end must be after season start.
        </p>
      )}
    </div>
  );
}

// ─── Step 5 — Battles ─────────────────────────────────────────────────────────

export function Step5Battles({
  state,
  onChange,
  courts,
  existingBattles,
}: {
  state: WizardState;
  onChange: (s: Partial<WizardState>) => void;
  courts: any[];
  existingBattles?: any[];
}) {
  const venueCourts = state.venueId
    ? courts.filter((c: any) => String(c.venueId) === String(state.venueId))
    : [];

  function addBattle() {
    onChange({ battles: [...state.battles, defaultBattle(state.maxTeamsPerCourt)] });
  }

  function removeBattle(i: number) {
    onChange({ battles: state.battles.filter((_, idx) => idx !== i) });
  }

  function updateBattle(i: number, patch: Partial<BattleEntry>) {
    onChange({
      battles: state.battles.map((b, idx) => (idx === i ? { ...b, ...patch } : b)),
    });
  }

  function toggleCourt(battleIdx: number, courtId: number) {
    const battle = state.battles[battleIdx];
    const ids = battle.courtIds.includes(courtId)
      ? battle.courtIds.filter((id) => id !== courtId)
      : [...battle.courtIds, courtId];
    updateBattle(battleIdx, { courtIds: ids });
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Schedule one or more battles for this season. You can add more from the season page at any time.
      </p>

      {existingBattles && existingBattles.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Existing Battles (read-only)
          </p>
          {existingBattles.map((b: any) => (
            <div
              key={b.id}
              className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm"
            >
              <p className="font-medium text-foreground">
                {b.scheduledAt
                  ? new Date(b.scheduledAt).toLocaleString()
                  : "—"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {b.courtCount} court{b.courtCount !== 1 ? "s" : ""} ·{" "}
                max {b.maxTeamsPerCourt} teams/court · {b.durationMinutes} min
              </p>
            </div>
          ))}
        </div>
      )}

      {state.battles.length > 0 && (
        <div className="space-y-4">
          {existingBattles && existingBattles.length > 0 && (
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              New Battles
            </p>
          )}
          {state.battles.map((battle, i) => (
            <div key={i} className="rounded-lg border border-border bg-background p-4 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Battle {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removeBattle(i)}
                  className="text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div>
                <Label className="text-xs">Date & Time</Label>
                <Input
                  type="datetime-local"
                  className="mt-1 h-8"
                  value={battle.scheduledAt}
                  onChange={(e) => updateBattle(i, { scheduledAt: e.target.value })}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  When this battle session starts.
                </p>
              </div>

              <div>
                <Label className="text-xs">Courts</Label>
                {!state.venueId ? (
                  <p className="text-xs text-muted-foreground mt-1 italic">
                    Select a venue in Step 1 to pick courts.
                  </p>
                ) : venueCourts.length === 0 ? (
                  <p className="text-xs text-muted-foreground mt-1 italic">
                    No courts found for the selected venue.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-x-5 gap-y-2 mt-2">
                    {venueCourts.map((court: any) => (
                      <label
                        key={court.id}
                        className="flex items-center gap-1.5 text-xs cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={battle.courtIds.includes(court.id)}
                          onChange={() => toggleCourt(i, court.id)}
                          className="h-3.5 w-3.5 accent-primary"
                        />
                        {court.name}
                      </label>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  Select which courts at the venue will run during this battle. Each checked court runs in parallel.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Max Teams Per Court</Label>
                  <Input
                    type="number"
                    min="1"
                    className="mt-1 h-8"
                    value={battle.maxTeamsPerCourt}
                    onChange={(e) => updateBattle(i, { maxTeamsPerCourt: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Override the season default for this specific battle.
                  </p>
                </div>
                <div>
                  <Label className="text-xs">Duration (minutes)</Label>
                  <Input
                    type="number"
                    min="1"
                    className="mt-1 h-8"
                    value={battle.durationMinutes}
                    onChange={(e) => updateBattle(i, { durationMinutes: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Total window allocated for this battle session.
                  </p>
                </div>
              </div>

              <div>
                <Label className="text-xs">Notes (optional)</Label>
                <Textarea
                  className="mt-1 text-xs"
                  rows={2}
                  placeholder="Venue details, special instructions, etc."
                  value={battle.notes}
                  onChange={(e) => updateBattle(i, { notes: e.target.value })}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Venue details, special instructions, etc.
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      <Button type="button" variant="outline" onClick={addBattle} className="w-full gap-2">
        <Plus className="h-4 w-4" />
        Add Battle
      </Button>
    </div>
  );
}

// ─── Step 6 — Review ──────────────────────────────────────────────────────────

export function Step6Review({
  state,
  venues,
  courts,
  isEditMode,
}: {
  state: WizardState;
  venues: any[];
  courts: any[];
  isEditMode?: boolean;
}) {
  const venueName = venues.find((v: any) => String(v.id) === state.venueId)?.name ?? "—";
  const genderLabel =
    KOTC_GENDER_BRACKETS.find((g) => g.value === state.genderBracket)?.label ?? state.genderBracket;
  const ageLabel =
    KOTC_AGE_BRACKETS.find((a) => a.value === state.ageBracket)?.label ?? state.ageBracket;
  const sportLabel = SPORTS.find((s) => s.value === state.sport)?.label ?? state.sport;

  function courtNames(courtIds: number[]) {
    return courtIds
      .map((id) => courts.find((c: any) => c.id === id)?.name ?? `Court ${id}`)
      .join(", ");
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        {isEditMode
          ? "Review your changes before saving."
          : "Review all settings before publishing your season."}
      </p>

      <ReviewSection title="Basics">
        <ReviewRow label="Season Name" value={state.name || "—"} />
        <ReviewRow label="Sport" value={sportLabel} />
        <ReviewRow label="Venue" value={venueName} />
        <ReviewRow label="Gender Bracket" value={genderLabel} />
        <ReviewRow label="Age Bracket" value={ageLabel} />
        {state.notes && <ReviewRow label="Notes" value={state.notes} />}
      </ReviewSection>

      <ReviewSection title="Match Rules">
        <ReviewRow
          label="Win Mode"
          value={state.winMode === "time_limit" ? "Points + Time Limit" : "Points Only"}
        />
        <ReviewRow label="Win Target" value={`${state.winTarget} pts`} />
        {state.winMode === "time_limit" && (
          <ReviewRow label="Time Limit" value={`${state.timeLimitMinutes} min`} />
        )}
        <ReviewRow label="Grace Period" value={`${state.gracePeriodSeconds}s`} />
        <ReviewRow label="Team Size" value={`${state.teamSize}v${state.teamSize}`} />
      </ReviewSection>

      <ReviewSection title="Registration & Economy">
        <ReviewRow label="Lives Required" value={state.livesRequired} />
        <ReviewRow label="Max Teams / Court" value={state.maxTeamsPerCourt} />
      </ReviewSection>

      <ReviewSection title="Season Dates">
        <ReviewRow
          label="Starts"
          value={state.startsAt ? new Date(state.startsAt).toLocaleString() : "—"}
        />
        <ReviewRow
          label="Ends"
          value={state.endsAt ? new Date(state.endsAt).toLocaleString() : "—"}
        />
      </ReviewSection>

      {state.battles.length > 0 && (
        <ReviewSection title={`Battles (${state.battles.length})`}>
          {state.battles.map((b, i) => (
            <div key={i} className="text-sm py-1.5 border-b last:border-0">
              <p className="font-medium text-foreground">
                {b.scheduledAt ? new Date(b.scheduledAt).toLocaleString() : "—"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {b.courtIds.length > 0
                  ? `Courts: ${courtNames(b.courtIds)}`
                  : "No courts selected"}{" "}
                · max {b.maxTeamsPerCourt}/court · {b.durationMinutes} min
              </p>
            </div>
          ))}
        </ReviewSection>
      )}
    </div>
  );
}

function ReviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-2">
      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">
        {title}
      </p>
      {children}
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="font-medium text-foreground text-right">{value}</span>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function KotcNewPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const getHeaders = useAuthHeaders();

  const [step, setStep] = useState(0);
  const [isSaving, setIsSaving] = useState(false);

  const savedRaw = (() => {
    try {
      const s = localStorage.getItem("kotc-season-draft");
      return s ? JSON.parse(s) : null;
    } catch {
      return null;
    }
  })();

  const [state, setState] = useState<WizardState>(() => ({
    ...defaultWizardState(),
    ...(savedRaw ?? {}),
  }));

  function onChange(patch: Partial<WizardState>) {
    setState((s) => ({ ...s, ...patch }));
  }

  const { restoredFromDraft, setRestoredFromDraft, clearDraft, publishedRef } =
    useDraftAutosave<WizardState>({
      localStorageKey: "kotc-season-draft",
      draftIdKey: "kotc-season-draft-id",
      remoteDraftBaseUrl: `${API}/kotc/drafts`,
      state,
      getHeaders,
      enableRemoteSave: false,
    });

  useEffect(() => {
    if (savedRaw) setRestoredFromDraft(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const endInvalid = state.startsAt && state.endsAt && state.endsAt <= state.startsAt;

  const canProceed: Record<number, boolean> = {
    0: !!state.name.trim(),
    1: !!state.winTarget,
    2: true,
    3: !endInvalid,
    4: true,
    5: true,
  };

  async function handlePublish() {
    setIsSaving(true);
    try {
      const headers = await getHeaders();

      let lifePacks: any;
      try {
        lifePacks = state.lifePacksJson.trim() ? JSON.parse(state.lifePacksJson) : [];
      } catch {
        toast({ title: "Invalid life pack JSON", variant: "destructive" });
        setIsSaving(false);
        return;
      }

      const r = await fetch(`${API}/kotc/seasons`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: state.name,
          sport: state.sport,
          venueId: state.venueId ? Number(state.venueId) : null,
          genderBracket: state.genderBracket,
          ageBracket: state.ageBracket,
          teamSize: Number(state.teamSize),
          winCondition: state.winMode,
          winTarget: Number(state.winTarget),
          timeLimitMinutes: state.winMode === "time_limit" ? Number(state.timeLimitMinutes) : undefined,
          gracePeriodSeconds: Number(state.gracePeriodSeconds),
          livesRequired: Number(state.livesRequired),
          maxTeamsPerCourt: Number(state.maxTeamsPerCourt),
          startsAt: state.startsAt || null,
          endsAt: state.endsAt || null,
          notes: state.notes || null,
          lifePacks,
        }),
      });

      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: "Failed to create season" }));
        throw new Error(err.error ?? "Failed to create season");
      }

      const season = await r.json();

      for (const battle of state.battles) {
        if (!battle.scheduledAt) continue;
        await fetch(`${API}/kotc/seasons/${season.id}/battles`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            scheduledAt: battle.scheduledAt,
            courtIds: battle.courtIds.length > 0 ? battle.courtIds : undefined,
            maxTeamsPerCourt: Number(battle.maxTeamsPerCourt),
            durationMinutes: Number(battle.durationMinutes),
            notes: battle.notes || null,
          }),
        });
      }

      publishedRef.current = true;
      clearDraft();
      toast({ title: "Season published!" });
      setLocation("/admin/kings-of-the-court");
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }

  function handleSaveDraft() {
    try {
      localStorage.setItem("kotc-season-draft", JSON.stringify(state));
      toast({ title: "Draft saved" });
      setLocation("/admin/kings-of-the-court");
    } catch {
      toast({ title: "Could not save draft", variant: "destructive" });
    }
  }

  const isLastStep = step === STEPS.length - 1;

  return (
    <WizardShell
      title="New KotC Season"
      backHref="/admin/kings-of-the-court"
      steps={STEPS}
      step={step}
      setStep={setStep}
      canProceed={canProceed[step] !== false}
      isLastStep={isLastStep}
      onSaveDraft={handleSaveDraft}
      isSaving={isSaving}
      restoredFromDraft={restoredFromDraft}
      onDiscardDraft={() => {
        clearDraft();
        setState(defaultWizardState());
      }}
      onPublish={isLastStep ? handlePublish : undefined}
      publishLabel="Publish Season"
      publishDisabled={isSaving || !state.name.trim()}
    >
      {step === 0 && <Step1Basics state={state} onChange={onChange} venues={venues} />}
      {step === 1 && <Step2MatchRules state={state} onChange={onChange} />}
      {step === 2 && <Step3Registration state={state} onChange={onChange} />}
      {step === 3 && <Step4Dates state={state} onChange={onChange} />}
      {step === 4 && (
        <Step5Battles state={state} onChange={onChange} courts={courts} />
      )}
      {step === 5 && (
        <Step6Review state={state} venues={venues} courts={courts} isEditMode={false} />
      )}
    </WizardShell>
  );
}
