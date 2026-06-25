import React, { useState, useEffect } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { useGetTournament, getGetTournamentQueryKey, useGetMyProfile } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar, Users, Trophy, ChevronLeft, GitBranch, DollarSign, CheckCircle2, Clock, ClipboardList, Star, MapPin, TrendingUp, Medal, Loader2, ChevronRight, Save, UserPlus, Trash2, AlertCircle, Users2 } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { Show, useAuth } from "@clerk/react";
import { SectionEntry } from "@/components/brand-ui";
import { useIsRegistered } from "@/hooks/useIsRegistered";
import { LockedTab } from "@/components/locked-tab";
import { useWaiverGate } from "@/components/waiver-modal";
import { InlinePaymentDialog } from "@/components/inline-payment-dialog";

import { API_BASE as API } from "@/lib/api-base";

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

function LiveScoreBadge({ fixtureId }: { fixtureId: number }) {
  const { data } = useQuery({
    queryKey: ["live-score", fixtureId],
    queryFn: async () => {
      const r = await fetch(`${API}/fixtures/${fixtureId}/events`);
      if (!r.ok) return null;
      return r.json();
    },
    refetchInterval: 20_000,
    staleTime: 10_000,
  });

  if (!data) return <span className="text-white/30 text-xs">vs</span>;

  return (
    <span className="font-bold text-[#ef4444] text-sm">
      {data.homeScore}–{data.awayScore}
      <span className="ml-1 text-xs font-normal text-amber-400 animate-pulse">LIVE</span>
    </span>
  );
}

function BracketView({ tournamentId, divisionId }: { tournamentId: number; divisionId?: number | null }) {
  const fixturesUrl = divisionId
    ? `${API}/tournaments/${tournamentId}/fixtures?divisionId=${divisionId}`
    : `${API}/tournaments/${tournamentId}/fixtures`;

  const { data: fixtures, isLoading } = useQuery({
    queryKey: ["tournament-fixtures-public", tournamentId, divisionId ?? null],
    queryFn: async () => {
      const r = await fetch(fixturesUrl);
      if (!r.ok) return [];
      return r.json();
    },
    refetchInterval: 30_000,
  });

  if (isLoading) return <Skeleton className="h-40 bg-white/10 rounded-xl" />;
  if (!fixtures?.length) return (
    <p className="text-white/30 text-sm">Bracket not yet generated. Check back soon.</p>
  );

  const phases = ["group", "winners", "losers", "playoff", "consolation", "grand_final"];
  const byPhase: Record<string, any[]> = {};
  for (const p of phases) byPhase[p] = fixtures.filter((f: any) => f.phase === p);

  const statusBadge = (f: any) => {
    if (f.status === "completed") return <span className="font-bold text-white">{f.homeScore}–{f.awayScore}</span>;
    if (f.status === "in_progress") return <LiveScoreBadge fixtureId={f.id} />;
    if (f.status === "forfeited") return <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/20">Forfeit</span>;
    if (f.status === "bye") return <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-white/10 text-white/40 border border-white/10">Bye</span>;
    if (f.status === "pending") return <span className="text-white/30 text-xs">TBD</span>;
    return <span className="text-white/30 text-xs">vs</span>;
  };

  return (
    <div className="space-y-8">
      {phases.map((phase) =>
        byPhase[phase]?.length > 0 ? (
          <div key={phase}>
            <h3 className="font-bold uppercase text-xs tracking-widest text-white/30 mb-4">
              {phase === "group" ? "Group Stage"
                : phase === "consolation" ? "3rd Place Match"
                : phase === "winners" ? "Winners Bracket"
                : phase === "losers" ? "Losers Bracket"
                : phase === "grand_final" ? "Grand Final"
                : "Knockout / Playoff"}
            </h3>
            {phase === "group" ? (
              <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
                {byPhase[phase].map((f: any, i: number) => (
                  <div key={f.id} className={`flex items-center justify-between px-4 py-3 ${i > 0 ? "border-t border-white/5" : ""}`}>
                    <div className="flex items-center gap-4 min-w-0 flex-1">
                      {f.notes && <span className="text-xs font-bold px-2 py-0.5 rounded border border-white/10 text-white/40">{f.notes}</span>}
                      <span className="font-medium text-white truncate">{f.homeTeam?.name || "TBD"}</span>
                      <div className="flex-shrink-0">{statusBadge(f)}</div>
                      <span className="font-medium text-white truncate">{f.awayTeam?.name || "TBD"}</span>
                    </div>
                    {f.scheduledAt && (
                      <span className="text-xs text-white/30 flex-shrink-0 ml-4">
                        {format(new Date(f.scheduledAt), "MMM d, h:mm a")}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-6">
                {Array.from(new Set(byPhase[phase].map((f: any) => f.round))).sort((a: any, b: any) => a - b).map((round) => {
                  const roundFixtures = byPhase[phase].filter((f: any) => f.round === round);
                  const maxRound = Math.max(...byPhase[phase].map((f: any) => f.round));
                  const roundLabel =
                    phase === "consolation" ? "3rd Place" :
                    phase === "grand_final" ? "Grand Final" :
                    phase === "losers" ? `Losers R${round}` :
                    round === maxRound ? "Final" :
                    round === maxRound - 1 ? "Semi-final" :
                    `Round ${round}`;
                  return (
                    <div key={round}>
                      <div className="text-xs font-bold uppercase tracking-widest text-white/30 mb-2">{roundLabel}</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {roundFixtures.map((f: any) => (
                          <div key={f.id} className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
                            <div className={`flex justify-between items-center ${f.status === "completed" && f.homeScore > f.awayScore ? "font-bold text-[#ef4444]" : ""}`}>
                              <span className="truncate flex-1 text-white">{f.homeTeam?.name || "TBD"}</span>
                              <span className="text-right font-bold w-8 text-center text-white">
                                {f.status === "completed" ? f.homeScore : ""}
                              </span>
                            </div>
                            <div className="border-t border-white/10" />
                            <div className={`flex justify-between items-center ${f.status === "completed" && f.awayScore > f.homeScore ? "font-bold text-[#ef4444]" : ""}`}>
                              <span className="truncate flex-1 text-white">{f.awayTeam?.name || "TBD"}</span>
                              <span className="text-right font-bold w-8 text-center text-white">
                                {f.status === "completed" ? f.awayScore : ""}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <div>{statusBadge(f)}</div>
                              <div className="flex items-center gap-2">
                                {f.scheduledAt && (
                                  <span className="text-xs text-white/30">
                                    {format(new Date(f.scheduledAt), "MMM d, h:mm a")}
                                  </span>
                                )}
                                {f.status === "completed" && (
                                  <Link href={`/fixtures/${f.id}/game-card`}>
                                    <button className="text-white/30 hover:text-white transition-colors" title="View game card">
                                      <ClipboardList className="h-4 w-4" />
                                    </button>
                                  </Link>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null,
      )}
    </div>
  );
}

type RegStep = "team" | "division" | "roster" | "rules" | "payment";
const REG_STEPS: RegStep[] = ["team", "division", "roster", "rules", "payment"];
const STEP_LABELS: Record<RegStep, string> = {
  team: "Team", division: "Division", roster: "Roster", rules: "Rules", payment: "Pay",
};
const FUTSAL_POSITIONS_T = ["GK", "DEF", "MID", "FWD", "UTL"];

interface RosterPlayer {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  jerseyNumber: string;
  position: string;
  isGuest: boolean;
}

function RegistrationPanel({ tournament, divisions = [] }: { tournament: any; divisions?: any[] }) {
  const { getToken } = useAuth();
  const { data: profile } = useGetMyProfile();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { ensureProfile, WaiverModalElement } = useWaiverGate();

  // Skip division step when only 0–1 divisions exist (auto-assign)
  const hasManyDivisions = divisions.length > 1;
  const activeSteps: RegStep[] = hasManyDivisions
    ? ["team", "division", "roster", "rules", "payment"]
    : ["team", "roster", "rules", "payment"];

  const [step, setStep] = useState<RegStep>("team");
  const [teamId, setTeamId] = useState("");
  const [divisionId, setDivisionId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [rosterPlayers, setRosterPlayers] = useState<RosterPlayer[]>([]);
  const [rulesAccepted, setRulesAccepted] = useState(false);
  const [registered, setRegistered] = useState<any>(null);
  const [paymentData, setPaymentData] = useState<{ clientSecret: string; publishableKey: string; amount: number; regData: any } | null>(null);

  const DRAFT_KEY = `tourney-reg-draft-${tournament.id}`;

  useEffect(() => {
    try {
      const draft = localStorage.getItem(DRAFT_KEY);
      if (draft) {
        const parsed = JSON.parse(draft);
        if (parsed.teamId) setTeamId(parsed.teamId);
        if (parsed.rosterPlayers) setRosterPlayers(parsed.rosterPlayers);
      }
    } catch {}
  }, []);

  const saveDraft = () => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ teamId, rosterPlayers }));
      toast({ title: "Progress saved", description: "Your draft will be here when you return." });
    } catch {}
  };

  const addPlayer = () => setRosterPlayers((prev) => [...prev, {
    id: crypto.randomUUID(), firstName: "", lastName: "",
    dateOfBirth: "", jerseyNumber: "", position: "", isGuest: false,
  }]);
  const removePlayer = (id: string) => setRosterPlayers((prev) => prev.filter((p) => p.id !== id));
  const updatePlayer = (id: string, field: keyof RosterPlayer, value: any) =>
    setRosterPlayers((prev) => prev.map((p) => p.id === id ? { ...p, [field]: value } : p));

  const { data: myTeams } = useQuery({
    queryKey: ["my-teams"],
    queryFn: async () => {
      const token = await getToken();
      const r = await fetch(`${API}/teams?myTeams=true`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!profile,
  });

  const isFull = (tournament.teamsRegistered || 0) >= tournament.maxTeams;
  const isActive = computeIsEventActive(tournament);
  const canRegister = isActive && tournament.registrationOpen && !isFull && tournament.status === "upcoming";
  const depositAmount = tournament.depositAmount != null ? Number(tournament.depositAmount) : Number(tournament.teamPrice);
  const stepIndex = activeSteps.indexOf(step);
  const goNext = () => { if (stepIndex < activeSteps.length - 1) setStep(activeSteps[stepIndex + 1]); };
  const goPrev = () => { if (stepIndex > 0) setStep(activeSteps[stepIndex - 1]); };

  const canAdvance = (): boolean => {
    if (step === "team") return !!teamId;
    if (step === "division") return divisionId != null;
    if (step === "roster") return rosterPlayers.length > 0 && rosterPlayers.every((p) => p.firstName && p.lastName);
    if (step === "rules") return rulesAccepted;
    return true;
  };

  // Resolved division: selected by user or auto-assigned for single-division tournaments
  const resolvedDivisionId = hasManyDivisions ? divisionId : (divisions[0]?.id ?? null);

  const handleRegister = async () => {
    if (!teamId) { toast({ title: "Select a team first", variant: "destructive" }); return; }
    setLoading(true);
    try {
      const token = await getToken();
      const rosterJson = JSON.stringify(rosterPlayers.map((p) => ({
        name: `${p.firstName} ${p.lastName}`.trim(),
        jersey: p.jerseyNumber, position: p.position,
        dob: p.dateOfBirth, isGuest: p.isGuest,
      })));
      const r = await fetch(`${API}/tournaments/${tournament.id}/registrations`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: Number(teamId), divisionId: resolvedDivisionId, selfCheckinRosterJson: rosterJson }),
      });
      const data = await r.json();
      if (!r.ok) {
        const e: any = new Error(data.error || "Registration failed");
        e.status = r.status;
        throw e;
      }
      qc.invalidateQueries({ queryKey: getGetTournamentQueryKey(tournament.id) });
      localStorage.removeItem(DRAFT_KEY);

      // If a deposit is required and spot is not waitlisted, open inline payment
      const regDepositAmount = data.depositAmount ?? depositAmount;
      if (regDepositAmount > 0 && !data.waitlisted && data.id) {
        const checkoutR = await fetch(`${API}/tournaments/${tournament.id}/deposit-checkout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ registrationId: data.id }),
        });
        const checkoutData = await checkoutR.json();
        if (!checkoutR.ok || !checkoutData.clientSecret) {
          setRegistered(data);
          toast({ title: "Registered!", description: "Please contact us to arrange deposit payment.", variant: "default" });
          return;
        }
        setPaymentData({ clientSecret: checkoutData.clientSecret, publishableKey: checkoutData.publishableKey, amount: checkoutData.amount, regData: data });
        return;
      }

      setRegistered(data);
    } catch (e: any) {
      if ((e as any).status === 409) {
        toast({ title: "Already registered", description: "This team is already registered for this tournament. View it on your dashboard.", variant: "default" });
      } else {
        toast({ title: "Registration failed", description: e.message, variant: "destructive" });
      }
    } finally {
      setLoading(false);
    }
  };

  // Registered success state
  if (registered) {
    return (
      <div className="rounded-2xl border border-white/10 bg-[#111118] overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.6)]">
        <div className="p-5 space-y-4">
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-400 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-emerald-400">Team Registered!</p>
              <p className="text-sm text-white/50 mt-1">Deposit due: <span className="font-semibold text-white">${registered.depositAmount ?? depositAmount}</span></p>
            </div>
          </div>
          <Button variant="outline" className="w-full border-white/20 text-white hover:bg-white/10" asChild>
            <Link href="/dashboard">Go to Dashboard</Link>
          </Button>
        </div>
      </div>
    );
  }

  // Info panel (pricing, dates, format) — always visible
  const InfoPanel = (
    <div className="space-y-3 pb-5 border-b border-white/10">
      <div className="flex justify-between items-center">
        <span className="text-white/50">Entry Fee</span>
        <span className="text-3xl font-black text-[#fbbf24]">${tournament.teamPrice}</span>
      </div>
      {tournament.depositAmount != null && (
        <div className="flex justify-between items-center">
          <span className="text-white/40 text-sm">Deposit Required</span>
          <span className="text-lg font-semibold text-white">${depositAmount}</span>
        </div>
      )}
      {tournament.registrationDeadline && (
        <div className="flex justify-between items-center">
          <span className="text-white/40 text-sm flex items-center gap-1"><Clock className="h-3 w-3" />Reg. Deadline</span>
          <span className="text-sm text-white">{format(new Date(tournament.registrationDeadline), "MMM d, yyyy")}</span>
        </div>
      )}
      <div className="flex items-center justify-between text-xs text-white/30">
        <span>{tournament.teamsRegistered || 0}/{tournament.maxTeams} teams</span>
        <span className="capitalize">{tournament.bracketFormat?.replace(/_/g, " ") || "Single Elim."}</span>
        {tournament.prizePot && <span className="text-[#fbbf24]">💰 ${tournament.prizePot} prize</span>}
      </div>
    </div>
  );

  return (
    <>
    <div className="rounded-2xl border border-white/10 bg-[#111118] overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.6)]">
      <div className="bg-white/5 border-b border-white/10 px-5 py-4">
        <p className="text-xs text-white/30 uppercase tracking-widest font-bold mb-0.5">Register</p>
        <p className="text-white/50 text-sm">Secure your team's spot</p>
      </div>
      <div className="p-5 space-y-5">
        {InfoPanel}

        <Show when="signed-out">
          <Button className="w-full h-12 text-base font-semibold bg-[#dc2626] hover:bg-[#b91c1c] border-none" asChild>
            <Link href="/sign-in">Sign in to Register</Link>
          </Button>
        </Show>

        <Show when="signed-in">
          {!canRegister ? (
            <Button className="w-full h-12 text-base font-semibold" disabled>
              {!isActive ? "Not Currently Active" : isFull ? "Tournament Full" : !tournament.registrationOpen ? "Registration Closed" : "Not Available"}
            </Button>
          ) : (
            <div className="space-y-4">
              {/* Step progress indicator */}
              <div className="flex items-center gap-1">
                {activeSteps.map((s, i) => (
                  <React.Fragment key={s}>
                    <div className={`flex items-center justify-center h-6 w-6 rounded-full text-xs font-bold border transition-all ${
                      i < stepIndex ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400" :
                      i === stepIndex ? "bg-[#dc2626] border-[#dc2626] text-white" :
                      "bg-white/5 border-white/10 text-white/30"
                    }`}>
                      {i < stepIndex ? "✓" : i + 1}
                    </div>
                    {i < activeSteps.length - 1 && (
                      <div className={`flex-1 h-0.5 ${i < stepIndex ? "bg-emerald-500/30" : "bg-white/10"}`} />
                    )}
                  </React.Fragment>
                ))}
              </div>
              <p className="text-xs text-white/40 font-semibold uppercase tracking-widest">{STEP_LABELS[step]}</p>

              {/* Step 1: Team selection */}
              {step === "team" && (
                <div className="space-y-3">
                  {myTeams?.length > 0 ? (
                    <div>
                      <Label className="text-xs text-white/50 mb-1.5 block">Select your team</Label>
                      <select
                        className="w-full rounded-xl border border-white/10 bg-white/5 text-white px-3 py-2.5 text-sm focus:border-[#dc2626] focus:outline-none"
                        value={teamId} onChange={(e) => setTeamId(e.target.value)}
                      >
                        <option value="" className="bg-[#111118]">— Choose a team —</option>
                        {myTeams.map((t: any) => (
                          <option key={t.id} value={t.id} className="bg-[#111118]">{t.name}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                      <AlertCircle className="h-5 w-5 text-amber-400 mb-2" />
                      <p className="text-sm text-amber-400 font-medium">No teams found</p>
                      <p className="text-xs text-white/40 mt-1">Contact an admin to create a team for you.</p>
                    </div>
                  )}
                </div>
              )}

              {/* Step 2: Division selection (only shown for multi-division tournaments) */}
              {step === "division" && (
                <div className="space-y-2">
                  <p className="text-xs text-white/40">Select the division your team is competing in. Check the age group to confirm eligibility.</p>
                  {divisions.map((d: any) => {
                    const ageGroups: string[] = Array.isArray(d.ageGroups) ? d.ageGroups : (d.ageGroups ? [d.ageGroups] : []);
                    const bracketLabel = (d.bracketFormat ?? tournament.bracketFormat)?.replace(/_/g, " ") || "Single Elimination";
                    const selected = divisionId === d.id;
                    return (
                      <button
                        key={d.id}
                        onClick={() => setDivisionId(d.id)}
                        className={`w-full text-left rounded-xl border p-4 transition-all ${
                          selected
                            ? "bg-[#dc2626]/10 border-[#dc2626] text-white"
                            : "bg-white/5 border-white/10 text-white/70 hover:border-white/30 hover:text-white"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-sm">{d.name}</span>
                          {selected && <span className="text-[#dc2626] text-xs font-bold">✓ Selected</span>}
                        </div>
                        {ageGroups.length > 0 && (
                          <p className="text-xs mt-1 opacity-60">{ageGroups.map((ag: string) => ag.toUpperCase()).join(" · ")}</p>
                        )}
                        <p className="text-xs mt-0.5 opacity-50 capitalize">{bracketLabel}</p>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Step 3: Roster builder */}
              {step === "roster" && (
                <div className="space-y-3">
                  <p className="text-xs text-white/40">Add all players who will compete. Mark guests as such (they won't need an account).</p>
                  {rosterPlayers.length === 0 && (
                    <div className="text-center py-4 text-white/30 text-sm">No players added yet. Click below to start.</div>
                  )}
                  {rosterPlayers.map((p, i) => (
                    <div key={p.id} className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-white/40">Player {i + 1}</span>
                        <div className="flex items-center gap-2">
                          <label className="flex items-center gap-1.5 text-xs text-white/40 cursor-pointer">
                            <input type="checkbox" className="accent-amber-400" checked={p.isGuest} onChange={(e) => updatePlayer(p.id, "isGuest", e.target.checked)} />
                            Guest
                          </label>
                          <button onClick={() => removePlayer(p.id)} className="text-white/20 hover:text-red-400 transition-colors">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Input className="h-8 text-xs bg-black/30 border-white/10 text-white placeholder:text-white/20" placeholder="First name *"
                          value={p.firstName} onChange={(e) => updatePlayer(p.id, "firstName", e.target.value)} />
                        <Input className="h-8 text-xs bg-black/30 border-white/10 text-white placeholder:text-white/20" placeholder="Last name *"
                          value={p.lastName} onChange={(e) => updatePlayer(p.id, "lastName", e.target.value)} />
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <input type="date" className="h-8 col-span-2 text-xs rounded-md border border-white/10 bg-black/30 text-white px-2 focus:border-[#dc2626] focus:outline-none"
                          value={p.dateOfBirth} onChange={(e) => updatePlayer(p.id, "dateOfBirth", e.target.value)} />
                        <Input className="h-8 text-xs bg-black/30 border-white/10 text-white placeholder:text-white/20" placeholder="#"
                          type="number" min="1" max="99" value={p.jerseyNumber} onChange={(e) => updatePlayer(p.id, "jerseyNumber", e.target.value)} />
                      </div>
                      <select className="w-full h-8 text-xs rounded-md border border-white/10 bg-black/30 text-white px-2 focus:border-[#dc2626] focus:outline-none"
                        value={p.position} onChange={(e) => updatePlayer(p.id, "position", e.target.value)}>
                        <option value="">Position…</option>
                        {FUTSAL_POSITIONS_T.map((pos) => <option key={pos} value={pos}>{pos}</option>)}
                      </select>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" className="w-full border-white/20 text-white/60 hover:text-white" onClick={addPlayer}>
                    <UserPlus className="h-3.5 w-3.5 mr-2" /> Add Player
                  </Button>
                  <Button size="sm" variant="ghost" className="w-full text-white/30 hover:text-white" onClick={saveDraft}>
                    <Save className="h-3.5 w-3.5 mr-2" /> Save Draft
                  </Button>
                </div>
              )}

              {/* Step 4: Rules acknowledgment */}
              {step === "rules" && (
                <div className="space-y-4">
                  <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-sm text-white/50 space-y-2 max-h-40 overflow-y-auto">
                    <p className="font-semibold text-white">Tournament Rules</p>
                    <p>• All players must present valid ID before their first match.</p>
                    <p>• Guest players are limited to 2 per team per match.</p>
                    <p>• Yellow cards carry over between rounds.</p>
                    <p>• Two yellow cards = one-match ban.</p>
                    <p>• The tournament committee's decisions are final.</p>
                    <p>• Deposit is non-refundable within 7 days of tournament start.</p>
                    <p>• Teams must be ready 15 minutes before their scheduled match time.</p>
                  </div>
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input type="checkbox" className="mt-0.5 accent-[#dc2626] shrink-0" checked={rulesAccepted} onChange={(e) => setRulesAccepted(e.target.checked)} />
                    <span className="text-sm text-white/70">I have read and agree to all tournament rules and understand the deposit policy.</span>
                  </label>
                </div>
              )}

              {/* Step 5: Payment confirmation */}
              {step === "payment" && (
                <div className="space-y-4">
                  <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                    <p className="text-sm font-semibold text-white">Registration Summary</p>
                    <div className="flex justify-between text-sm">
                      <span className="text-white/50">Team</span>
                      <span className="text-white">{myTeams?.find((t: any) => String(t.id) === teamId)?.name ?? "—"}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-white/50">Roster</span>
                      <span className="text-white">{rosterPlayers.length} player{rosterPlayers.length !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="flex justify-between text-sm font-semibold pt-2 border-t border-white/10">
                      <span className="text-white/50">Deposit Due</span>
                      <span className="text-[#fbbf24] text-lg">${depositAmount}</span>
                    </div>
                    {tournament.balanceDueDate && (
                      <p className="text-xs text-white/30">Balance due: {format(new Date(tournament.balanceDueDate), "MMM d, yyyy")}</p>
                    )}
                  </div>
                  <p className="text-xs text-white/30">Payment will be arranged separately by the tournament organizer after registration is confirmed.</p>
                </div>
              )}

              {/* Navigation */}
              <div className="flex gap-2 pt-1">
                {stepIndex > 0 && (
                  <Button variant="outline" className="border-white/20 text-white hover:bg-white/10" onClick={goPrev}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                )}
                {step !== "payment" ? (
                  <Button className="flex-1 bg-[#dc2626] hover:bg-[#b91c1c] border-none" disabled={!canAdvance()} onClick={goNext}>
                    {STEP_LABELS[activeSteps[stepIndex + 1]]} <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                ) : (
                  <Button className="flex-1 h-12 text-base font-semibold bg-[#dc2626] hover:bg-[#b91c1c] border-none"
                    onClick={() => ensureProfile(handleRegister)} disabled={loading}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Confirm Registration · ${depositAmount} deposit
                  </Button>
                )}
              </div>
            </div>
          )}
        </Show>
        {WaiverModalElement}
      </div>
    </div>

    {paymentData && (
      <InlinePaymentDialog
        open={!!paymentData}
        clientSecret={paymentData.clientSecret}
        publishableKey={paymentData.publishableKey}
        amount={paymentData.amount}
        title="Pay Tournament Deposit"
        label={`Pay Deposit — $${Number(paymentData.amount).toFixed(2)}`}
        onSuccess={() => {
          setPaymentData(null);
          setRegistered(paymentData.regData);
          toast({ title: "Deposit paid!", description: "Your team's spot is confirmed." });
        }}
        onCancel={() => {
          setPaymentData(null);
          setRegistered(paymentData.regData);
          toast({ title: "Registered (deposit pending)", description: "Pay your deposit from the dashboard." });
        }}
      />
    )}
    </>
  );
}

type LbMetric = "goals" | "assists" | "games" | "streak";
const LB_METRICS: Record<LbMetric, { label: string; icon: React.ReactNode; valueKey: string; color: string }> = {
  goals: { label: "Goals", icon: <Trophy className="h-4 w-4" />, valueKey: "goalsScored", color: "#ef4444" },
  assists: { label: "Assists", icon: <Star className="h-4 w-4" />, valueKey: "assists", color: "#60a5fa" },
  games: { label: "Games", icon: <Medal className="h-4 w-4" />, valueKey: "gamesPlayed", color: "#4ade80" },
  streak: { label: "Best Streak", icon: <TrendingUp className="h-4 w-4" />, valueKey: "bestAttendanceStreak", color: "#fbbf24" },
};

function TournamentLeaderboard({ tournamentId }: { tournamentId: number }) {
  const [metric, setMetric] = useState<LbMetric>("goals");
  const { data, isLoading, error } = useQuery({
    queryKey: ["event-leaderboard", "tournament", tournamentId, metric],
    queryFn: async () => {
      const r = await fetch(`${API}/player-stats/leaderboard?entityType=tournament&entityId=${tournamentId}&metric=${metric}&limit=10`);
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? "Failed to load leaderboard");
      return json as any[];
    },
  });
  const cfg = LB_METRICS[metric];
  return (
    <section>
      <h2 className="text-xl font-black uppercase tracking-tight text-white mb-4 flex items-center gap-2">
        <Trophy className="h-5 w-5 text-[#ef4444]" /> Leaderboard
      </h2>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(LB_METRICS) as LbMetric[]).map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                metric === m ? "bg-[#dc2626] border-[#dc2626] text-white" : "bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white"
              }`}
            >
              {LB_METRICS[m].icon}
              {LB_METRICS[m].label}
            </button>
          ))}
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
          <div className="bg-white/5 border-b border-white/10 px-4 py-3 flex items-center gap-2">
            <span style={{ color: cfg.color }}>{cfg.icon}</span>
            <span className="text-white text-sm font-bold">Top 10 by {cfg.label}</span>
          </div>
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-white/30" /></div>
          ) : error ? (
            <div className="text-center py-10"><p className="text-white/30 text-sm">{(error as Error).message}</p></div>
          ) : !data?.length ? (
            <div className="text-center py-12">
              <Trophy className="h-10 w-10 text-white/10 mx-auto mb-3" />
              <p className="text-white/30 text-sm">No stats recorded yet.</p>
            </div>
          ) : (
            <ol>
              {data.map((e: any) => (
                <li key={e.userId} className={`flex items-center gap-3 px-4 py-3 border-b border-white/5 last:border-0 ${e.rank <= 3 ? "bg-white/[0.02]" : ""}`}>
                  <div className="w-8 shrink-0 flex items-center justify-center">
                    {e.rank === 1 ? <span className="text-xl">🥇</span> : e.rank === 2 ? <span className="text-xl">🥈</span> : e.rank === 3 ? <span className="text-xl">🥉</span> : <span className="text-white/30 font-black text-base">{e.rank}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-semibold truncate">{e.displayName}</p>
                    <p className="text-white/30 text-xs">{e.gamesPlayed} games · {e.goalsScored}G {e.assists}A</p>
                  </div>
                  <div className="shrink-0 px-2.5 py-1 rounded-full text-sm font-black border" style={{ background: `${cfg.color}15`, color: cfg.color, borderColor: `${cfg.color}25` }}>
                    {e[cfg.valueKey]}
                    <span className="text-xs font-normal ml-1 opacity-70">{metric === "streak" ? "in a row" : cfg.label.toLowerCase()}</span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
        <p className="text-xs text-white/20">Stats updated by PlayOn staff after each approved game card.</p>
      </div>
    </section>
  );
}

function SeedsView({ tournamentId, divisionId }: { tournamentId: number; divisionId?: number | null }) {
  const seedsUrl = divisionId
    ? `${API}/tournaments/${tournamentId}/seeds?divisionId=${divisionId}`
    : `${API}/tournaments/${tournamentId}/seeds`;

  const { data: seeds, isLoading } = useQuery({
    queryKey: ["tournament-seeds-public", tournamentId, divisionId ?? null],
    queryFn: async () => {
      const r = await fetch(seedsUrl);
      if (!r.ok) return [];
      return r.json();
    },
  });

  if (isLoading) return <Skeleton className="h-24 bg-white/10 rounded-xl" />;
  if (!seeds?.length) return null;

  return (
    <section>
      <h2 className="text-xl font-black uppercase tracking-tight text-white mb-4">Seeding</h2>
      <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
        {seeds.map((s: any, i: number) => (
          <div key={s.id} className={`flex items-center gap-4 px-4 py-3 ${i > 0 ? "border-t border-white/5" : ""}`}>
            <span className="text-xl font-black text-[#fbbf24] w-8">#{s.seed}</span>
            <span className="font-medium text-white">{s.team?.name || `Team #${s.teamId}`}</span>
            {s.groupName && (
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-white/10 text-white/50 border border-white/10">
                Group {s.groupName}
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function TournamentDetail() {
  const [, params] = useRoute("/tournaments/:id");
  const id = Number(params?.id);
  const [activeDivId, setActiveDivId] = useState<number | null>(null);

  const { data: tournament, isLoading } = useGetTournament(id, {
    query: { enabled: !!id, queryKey: getGetTournamentQueryKey(id) },
  });

  const { data: divisions } = useQuery({
    queryKey: ["tournament-divisions-public", id],
    queryFn: async () => {
      const r = await fetch(`${API}/tournaments/${id}/divisions`);
      return r.ok ? r.json() : [];
    },
    enabled: !!id,
  });

  const resolvedDivId = activeDivId ?? (divisions?.[0]?.id ?? null);
  const isMultiDivision = divisions && divisions.length > 1;

  const { isRegistered, isLoading: regCheckLoading } = useIsRegistered("tournament", id);

  if (isLoading) {
    return (
      <Layout>
        <div className="bg-[#050508] min-h-screen">
          <Skeleton className="h-80 w-full bg-white/10" />
          <div className="container mx-auto px-4 py-8">
            <Skeleton className="h-96 w-full bg-white/5 rounded-2xl" />
          </div>
        </div>
      </Layout>
    );
  }

  if (!tournament) {
    return (
      <Layout>
        <div className="bg-[#050508] min-h-screen flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-white mb-4">Tournament not found</h1>
            <Button asChild className="bg-[#dc2626] hover:bg-[#b91c1c]"><Link href="/tournaments">Back to Tournaments</Link></Button>
          </div>
        </div>
      </Layout>
    );
  }

  const isActive = tournament.status === "active" || tournament.status === "completed";

  const tnIsFull = (tournament.teamsRegistered || 0) >= tournament.maxTeams;
  const tnDisplayStatus: "Open" | "Full" | "Upcoming" = tnIsFull ? "Full" : tournament.registrationOpen === true ? "Open" : "Upcoming";
  const tnStatusStyles: Record<string, string> = {
    Open: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    Full: "bg-red-500/20 text-red-400 border-red-500/30",
    Upcoming: "bg-white/10 text-white/60 border-white/20",
  };

  return (
    <Layout>
      <div className="dark bg-[#050508] text-white min-h-screen">
        {/* Compact header */}
        <div className="bg-gradient-to-b from-[#100d02] to-[#050508] border-b border-white/10 pt-6 pb-7">
          <div className="container mx-auto px-4">
            <Button variant="ghost" size="sm" className="mb-4 text-white/50 hover:text-white -ml-2 h-8" asChild>
              <Link href="/tournaments"><ChevronLeft className="mr-1 h-4 w-4" /> All Tournaments</Link>
            </Button>
            <div className="flex flex-wrap gap-1.5 mb-3 items-center">
              <span className="inline-flex items-center bg-[#92400e]/80 text-[#fbbf24] text-xs font-bold px-2.5 py-1 rounded-full border border-[#fbbf24]/20">
                Tournament
              </span>
              {tournament.format && (
                <span className="inline-flex items-center bg-white/10 text-white text-xs font-bold px-2.5 py-1 rounded-full border border-white/20 uppercase">{tournament.format}</span>
              )}
              <span className={`inline-flex items-center text-xs font-bold px-2.5 py-1 rounded-full border ${tnStatusStyles[tnDisplayStatus]}`}>
                {tnDisplayStatus}
              </span>
            </div>
            <h1 className="text-2xl md:text-4xl font-black text-white uppercase tracking-tight mb-3">{tournament.name}</h1>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-white/50">
              {tournament.startDate && (
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-[#fbbf24]" />
                  {format(new Date(tournament.startDate), "MMM d")}{tournament.endDate ? ` – ${format(new Date(tournament.endDate), "MMM d, yyyy")}` : ""}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-[#fbbf24]" />
                Alumni Center · Lexington, KY
              </span>
              <span className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-[#fbbf24]" />
                {tournament.teamsRegistered || 0}/{tournament.maxTeams} teams
              </span>
              <span className="font-semibold text-[#fbbf24]">${tournament.teamPrice} / team</span>
              {(tournament as any).prizePot && (
                <span className="text-[#fbbf24] text-xs font-bold">💰 ${(tournament as any).prizePot} prize pot</span>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="bg-[#0a0a10] py-10">
          <div className="container mx-auto px-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <SectionEntry direction="left" className="lg:col-span-2 space-y-10">
                {tournament.description && (
                  <section>
                    <h2 className="text-lg font-black uppercase tracking-tight text-white mb-3">About</h2>
                    <p className="text-white/50 leading-relaxed whitespace-pre-line">{tournament.description}</p>
                  </section>
                )}

                {isActive && (
                  <section>
                    <h2 className="text-lg font-black uppercase tracking-tight text-white mb-4 flex items-center gap-2">
                      <GitBranch className="h-4 w-4 text-[#fbbf24]" /> Bracket
                    </h2>
                    {isMultiDivision && (
                      <div className="flex flex-wrap gap-2 mb-4">
                        {divisions.map((d: any) => (
                          <button
                            key={d.id}
                            onClick={() => setActiveDivId(d.id)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                              resolvedDivId === d.id
                                ? "bg-[#dc2626] text-white border-[#dc2626]"
                                : "bg-white/5 text-white/50 border-white/10 hover:bg-white/10 hover:text-white"
                            }`}
                          >
                            {d.name}
                          </button>
                        ))}
                      </div>
                    )}
                    <LockedTab isRegistered={isRegistered} isLoading={regCheckLoading}>
                      <div className="relative">
                        <div className="overflow-x-auto -mx-1 px-1 pb-2">
                          <div className="min-w-[600px]">
                            <BracketView tournamentId={id} divisionId={resolvedDivId} />
                          </div>
                        </div>
                        <p className="text-xs text-white/25 mt-2 flex items-center gap-1 sm:hidden">
                          <span>←</span> Scroll to see full bracket <span>→</span>
                        </p>
                      </div>
                    </LockedTab>
                  </section>
                )}

                <LockedTab isRegistered={isRegistered} isLoading={regCheckLoading}>
                  <SeedsView tournamentId={id} divisionId={resolvedDivId} />
                </LockedTab>

                <TournamentLeaderboard tournamentId={id} />

                {/* Registration panel shown inline below content on mobile */}
                <div className="lg:hidden space-y-4">
                  <RegistrationPanel tournament={tournament} divisions={divisions ?? []} />
                  <Show when="signed-in">
                    <div className="rounded-2xl border border-white/10 bg-[#111118] p-5">
                      <p className="text-sm text-white/40 mb-3">Already registered? Confirm your team's roster.</p>
                      <Button variant="outline" className="w-full border-white/20 text-white hover:bg-white/10" asChild>
                        <Link href={`/tournaments/${id}/self-checkin`}>
                          <CheckCircle2 className="mr-2 h-4 w-4" /> Confirm Team Roster
                        </Link>
                      </Button>
                    </div>
                  </Show>
                </div>
              </SectionEntry>

              {/* Sidebar — desktop only */}
              <SectionEntry delay={0.15} direction="right" className="hidden lg:block space-y-4">
                <RegistrationPanel tournament={tournament} divisions={divisions ?? []} />
                <Show when="signed-in">
                  <div className="rounded-2xl border border-white/10 bg-[#111118] p-5">
                    <p className="text-sm text-white/40 mb-3">
                      Already registered? Confirm your team's roster for tournament day.
                    </p>
                    <Button variant="outline" className="w-full border-white/20 text-white hover:bg-white/10" asChild>
                      <Link href={`/tournaments/${id}/self-checkin`}>
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        Confirm Team Roster
                      </Link>
                    </Button>
                  </div>
                </Show>
              </SectionEntry>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
