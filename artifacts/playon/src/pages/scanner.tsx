import React, { useState, useRef, useEffect } from "react";
import { Redirect, useLocation } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { formatEastern } from "@/lib/timezone";
import {
  QrCode, Camera, CheckCircle2, XCircle, AlertTriangle,
  UserPlus, ArrowLeft, Clock, Users, Shield, Tent, Zap,
} from "lucide-react";
import { QrScannerModal } from "@/components/qr-scanner-modal";

import { API_BASE as API } from "@/lib/api-base";

function useAuthHeaders() {
  const { getToken } = useAuth();
  return async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  };
}

type ScanStatus =
  | "confirmed"
  | "checked_in"
  | "walk_up_available"
  | "registered_pending_payment"
  | "at_capacity"
  | "league_walk_up"
  | "wrong_event"
  | "not_found";

interface ScanResult {
  status: ScanStatus;
  player?: { id: number; firstName: string | null; lastName: string | null; playonId?: string | null; jerseyNumber?: string | null };
  guestName?: string;
  event?: { type: string; id: number; name: string; price?: number; spotsLeft?: number; primaryPoolId?: number; campId?: number; team?: string };
  checkedInAt?: string;
  message?: string;
  paymentWarning?: string | null;
  hasLeagueReg?: boolean;
}

interface Session {
  type: "dropin" | "camp_day" | "league_fixture";
  id: number;
  name: string;
  startsAt: string;
  meta: Record<string, any>;
}

interface RosterPlayer {
  dbUserId: number;
  userId: string;
  firstName: string | null;
  lastName: string | null;
  jerseyNumber: string | null;
  role: string;
}

interface GameCard {
  id: number;
  fixtureId: number;
  homeTeamName: string | null;
  awayTeamName: string | null;
  homeRoster: RosterPlayer[];
  awayRoster: RosterPlayer[];
  status: string;
}

function SessionIcon({ type }: { type: string }) {
  if (type === "dropin") return <Zap className="h-4 w-4 text-orange-500" />;
  if (type === "camp_day") return <Tent className="h-4 w-4 text-blue-500" />;
  if (type === "league_fixture") return <Shield className="h-4 w-4 text-primary" />;
  return <Clock className="h-4 w-4 text-muted-foreground" />;
}

function RosterPanel({ gameCard }: { gameCard: GameCard }) {
  const home = gameCard.homeRoster ?? [];
  const away = gameCard.awayRoster ?? [];

  const RosterList = ({ players, label }: { players: RosterPlayer[]; label: string }) => (
    <div className="flex-1 min-w-0">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{label}</p>
      {players.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No roster</p>
      ) : (
        <ul className="space-y-0.5">
          {players.map((p) => (
            <li key={p.dbUserId} className="flex items-center gap-1.5 text-xs">
              {p.jerseyNumber && (
                <span className="font-mono font-bold text-primary w-5 text-right flex-shrink-0">
                  #{p.jerseyNumber}
                </span>
              )}
              <span className={p.jerseyNumber ? "" : "ml-6"}>
                {`${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || "Unknown"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <Card>
      <CardHeader className="pb-2 pt-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Users className="h-3.5 w-3.5" /> Game Card Roster
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-3">
        <div className="flex gap-4">
          <RosterList players={home} label={gameCard.homeTeamName ?? "Home"} />
          <div className="w-px bg-border flex-shrink-0" />
          <RosterList players={away} label={gameCard.awayTeamName ?? "Away"} />
        </div>
      </CardContent>
    </Card>
  );
}

function ScanResultCard({ result, onReset, onConfirmWalkup, confirmingWalkup, onLeagueOverride, confirmingOverride, onConfirmPayment, confirmingPayment }: {
  result: ScanResult;
  onReset: () => void;
  onConfirmWalkup?: () => void;
  confirmingWalkup: boolean;
  onLeagueOverride?: (reason: string) => void;
  confirmingOverride: boolean;
  onConfirmPayment?: () => void;
  confirmingPayment: boolean;
}) {
  const [overrideReason, setOverrideReason] = useState("");
  const ok = result.status === "confirmed" || result.status === "checked_in";
  const walkup = result.status === "walk_up_available";
  const pendingPayment = result.status === "registered_pending_payment";
  const leagueWalkup = result.status === "league_walk_up";
  const full = result.status === "at_capacity";
  const notFound = result.status === "not_found";

  const playerName = result.player
    ? `${result.player.firstName ?? ""} ${result.player.lastName ?? ""}`.trim()
    : result.guestName ?? null;

  return (
    <div className={`rounded-2xl border-2 p-6 text-center space-y-3 ${
      ok ? "border-green-500 bg-green-500/10" :
      walkup || leagueWalkup || pendingPayment ? "border-amber-500 bg-amber-500/10" :
      "border-destructive bg-destructive/10"
    }`}>
      <div className="flex justify-center">
        {ok ? <CheckCircle2 className="h-16 w-16 text-green-500" /> :
         walkup || leagueWalkup || pendingPayment ? <UserPlus className="h-16 w-16 text-amber-500" /> :
         <XCircle className="h-16 w-16 text-destructive" />}
      </div>

      <div>
        <p className={`text-2xl font-bold uppercase tracking-tight ${
          ok ? "text-green-600 dark:text-green-400" :
          walkup || leagueWalkup || pendingPayment ? "text-amber-600 dark:text-amber-400" :
          "text-destructive"
        }`}>
          {ok ? (result.status === "confirmed" ? "Already Checked In" : "Checked In") :
           walkup ? "Walk-up Available" :
           pendingPayment ? "Registered — Collect Payment" :
           leagueWalkup ? "Not on Roster" :
           full ? "Session Full" :
           notFound ? "Not Recognised" : "Denied"}
        </p>
        {playerName && (
          <p className="text-lg font-semibold mt-1">
            {result.player?.jerseyNumber && (
              <span className="text-primary font-mono mr-1.5">#{result.player.jerseyNumber}</span>
            )}
            {playerName}
          </p>
        )}
        {result.player?.playonId && <p className="text-xs text-muted-foreground font-mono">{result.player.playonId}</p>}
      </div>

      {result.event && (
        <div className="text-sm text-muted-foreground bg-background/60 rounded-lg p-2">
          <p className="font-medium text-foreground">{result.event.name}</p>
          {result.event.team && <p className="text-xs">Team: {result.event.team}</p>}
        </div>
      )}

      {result.checkedInAt && (
        <p className="text-xs text-muted-foreground">
          {formatEastern(new Date(result.checkedInAt), "h:mm:ss a 'ET'")}
        </p>
      )}

      {result.paymentWarning && (
        <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-lg p-2">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span>{result.paymentWarning}</span>
        </div>
      )}

      {walkup && result.event && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {result.event.spotsLeft} spot{result.event.spotsLeft !== 1 ? "s" : ""} available
            {result.event.price != null && result.event.price > 0 && ` · $${result.event.price.toFixed(2)}`}
          </p>
          {(result.event as any).requiresGuardianConfirmation ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400 bg-amber-500/10 rounded-lg p-3">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                <span className="font-medium">Youth camp — guardian not linked.<br />Tap below to confirm guardian is physically present.</span>
              </div>
              {onConfirmWalkup && (
                <Button className="w-full" onClick={onConfirmWalkup} disabled={confirmingWalkup}>
                  {confirmingWalkup ? "Registering..." : "Guardian Present — Register & Check In"}
                </Button>
              )}
            </div>
          ) : (
            <>
              {result.event.type === "camp_day" && (result.event as any).guardianRequired && !(result.event as any).hasLinkedGuardian && (
                <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded p-2">
                  Youth camp: guardian must be present to complete walk-up registration
                </div>
              )}
              {onConfirmWalkup && (
                <Button className="w-full" onClick={onConfirmWalkup} disabled={confirmingWalkup}>
                  {confirmingWalkup ? "Registering..." : "Register & Check In"}
                </Button>
              )}
            </>
          )}
        </div>
      )}

      {leagueWalkup && (
        <div className="space-y-3 text-sm text-left">
          <p className="text-muted-foreground text-center">
            {result.hasLeagueReg
              ? "Player is league-registered but not on this game's roster."
              : "Player is not registered in this league."}
          </p>
          {onLeagueOverride && result.hasLeagueReg && (
            <div className="space-y-2 pt-1">
              <p className="text-xs font-medium text-foreground">Override check-in (optional reason)</p>
              <Textarea
                placeholder="e.g. Sub approved by league coordinator"
                className="text-sm resize-none"
                rows={2}
                value={overrideReason}
                onChange={e => setOverrideReason(e.target.value)}
                disabled={confirmingOverride}
              />
              <Button
                className="w-full"
                onClick={() => onLeagueOverride(overrideReason)}
                disabled={confirmingOverride}
              >
                {confirmingOverride ? "Checking in..." : "Override & Check In"}
              </Button>
            </div>
          )}
          {!result.hasLeagueReg && (
            <p className="text-xs text-muted-foreground text-center">
              Player must register for this league before they can be checked in.
            </p>
          )}
        </div>
      )}

      {pendingPayment && (
        <div className="space-y-2 text-left">
          <p className="text-sm text-muted-foreground text-center">
            Spot reserved. Collect cash payment from the player, then confirm below.
          </p>
          {onConfirmPayment && (
            <Button className="w-full" onClick={onConfirmPayment} disabled={confirmingPayment}>
              {confirmingPayment ? "Confirming..." : "Confirm Payment & Check In"}
            </Button>
          )}
        </div>
      )}

      {result.message && !walkup && !leagueWalkup && !pendingPayment && (
        <p className="text-sm text-muted-foreground">{result.message}</p>
      )}

      <Button variant="outline" className="w-full mt-2" onClick={onReset}>
        <ArrowLeft className="h-4 w-4 mr-2" /> Scan Next
      </Button>
    </div>
  );
}

export default function ScannerPage() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const getHeaders = useAuthHeaders();
  const { toast } = useToast();
  const [location] = useLocation();

  // Parse ?fixtureId= from URL query string
  const urlFixtureId = (() => {
    const search = typeof window !== "undefined" ? window.location.search : "";
    const params = new URLSearchParams(search);
    const val = params.get("fixtureId");
    return val ? Number(val) : null;
  })();

  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [qrInput, setQrInput] = useState("");
  const [confirmingWalkup, setConfirmingWalkup] = useState(false);
  const [confirmingOverride, setConfirmingOverride] = useState(false);
  const [confirmingPayment, setConfirmingPayment] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: sessionData, isLoading } = useQuery({
    queryKey: ["scanner-sessions"],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/scanner/active-sessions`, { headers });
      if (!r.ok) throw new Error("Failed to load sessions");
      return r.json() as Promise<{ sessions: Session[]; userRole: string }>;
    },
    enabled: !profileLoading && !!profile,
    refetchInterval: 60000,
  });

  // Auto-select session: prefer URL fixtureId, then single-session fallback
  useEffect(() => {
    if (!sessionData || selectedSession) return;
    if (urlFixtureId) {
      const match = sessionData.sessions.find(
        (s) => s.type === "league_fixture" && s.id === urlFixtureId,
      );
      if (match) { setSelectedSession(match); return; }
    }
    if (sessionData.sessions.length === 1) {
      setSelectedSession(sessionData.sessions[0]);
    }
  }, [sessionData, selectedSession, urlFixtureId]);

  // Pre-fetch game card for the selected league fixture
  const fixtureId = selectedSession?.type === "league_fixture" ? selectedSession.id : null;
  const { data: gameCard } = useQuery<GameCard | null>({
    queryKey: ["game-card-fixture", fixtureId],
    queryFn: async () => {
      if (!fixtureId) return null;
      const headers = await getHeaders();
      const r = await fetch(`${API}/fixtures/${fixtureId}/game-card`, { headers });
      if (!r.ok) return null;
      return r.json() as Promise<GameCard>;
    },
    enabled: !!fixtureId,
    staleTime: 60000,
  });

  const scan = useMutation({
    mutationFn: async (qrCode: string) => {
      if (!selectedSession) throw new Error("No session selected");
      const headers = await getHeaders();
      const body: any = {
        qrCode,
        sessionType: selectedSession.type,
        sessionId: selectedSession.type === "camp_day" ? selectedSession.meta.dayId : selectedSession.id,
      };
      if (selectedSession.type === "camp_day") {
        body.campId = selectedSession.meta.campId;
      }
      const r = await fetch(`${API}/scanner/qr-scan`, {
        method: "POST", headers, body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.error ?? "Scan failed");
      }
      return r.json() as Promise<ScanResult>;
    },
    onSuccess: (data) => {
      setScanResult(data);
      setQrInput("");
    },
    onError: (e: any) => {
      toast({ title: "Scan failed", description: e.message, variant: "destructive" });
      setQrInput("");
    },
  });

  async function handleConfirmWalkup() {
    if (!scanResult?.player || !scanResult.event || !selectedSession) return;
    setConfirmingWalkup(true);
    try {
      const headers = await getHeaders();
      const event = scanResult.event;

      if (event.type === "dropin") {
        const poolId = (event as any).primaryPoolId;
        if (!poolId) {
          toast({ title: "Cannot walk-up", description: "No pool configured for this session", variant: "destructive" });
          return;
        }
        const res = await fetch(`${API}/scanner/dropin/${event.id}/walk-up`, {
          method: "POST", headers,
          body: JSON.stringify({ playerId: scanResult.player.id, poolId }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          toast({ title: "Walk-up failed", description: err.error ?? "Could not register", variant: "destructive" });
          return;
        }
        const data = await res.json();
        setScanResult({ ...scanResult, ...data, status: "registered_pending_payment" });
        toast({ title: `${scanResult.player.firstName ?? "Player"} registered — collect payment to check in` });

      } else if (event.type === "camp_day" && (event as any).campId) {
        const guardianPresent = (event as any).requiresGuardianConfirmation === true ? true : undefined;
        const res = await fetch(`${API}/scanner/camp/${(event as any).campId}/day/${event.id}/walk-up`, {
          method: "POST", headers,
          body: JSON.stringify({ playerId: scanResult.player.id, guardianPresent }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          if (res.status === 422 && err.requiresGuardianConfirmation) {
            setScanResult({
              ...scanResult,
              event: { ...(event as any), requiresGuardianConfirmation: true },
            });
            toast({
              title: "Guardian confirmation required",
              description: "Confirm the guardian is physically present to complete walk-up",
              variant: "default",
            });
            return;
          }
          toast({ title: "Walk-up failed", description: err.error ?? "Could not register", variant: "destructive" });
          return;
        }
        const data = await res.json();
        setScanResult({ ...scanResult, ...data, status: "registered_pending_payment" });
        toast({ title: `${scanResult.player.firstName ?? "Player"} registered — collect payment to check in` });
      }
    } catch (e: any) {
      toast({ title: "Walk-up failed", description: e.message, variant: "destructive" });
    } finally {
      setConfirmingWalkup(false);
    }
  }

  async function handleConfirmPayment() {
    if (!scanResult?.player || !scanResult.event || !selectedSession) return;
    setConfirmingPayment(true);
    try {
      const headers = await getHeaders();
      const event = scanResult.event;
      let url = "";
      let body: any = { playerId: scanResult.player.id };

      if (event.type === "dropin") {
        const poolId = (event as any).primaryPoolId;
        url = `${API}/scanner/dropin/${event.id}/collect-payment`;
        if (poolId) body.poolId = poolId;
      } else if (event.type === "camp_day" && (event as any).campId) {
        url = `${API}/scanner/camp/${(event as any).campId}/day/${event.id}/collect-payment`;
      } else {
        toast({ title: "Cannot confirm payment", description: "Unsupported session type", variant: "destructive" });
        return;
      }

      const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: "Payment confirmation failed", description: err.error ?? "Could not complete check-in", variant: "destructive" });
        return;
      }
      setScanResult({ ...scanResult, status: "checked_in" });
      toast({ title: `${scanResult.player.firstName ?? "Player"} checked in!` });
    } catch (e: any) {
      toast({ title: "Payment confirmation failed", description: e.message, variant: "destructive" });
    } finally {
      setConfirmingPayment(false);
    }
  }

  async function handleLeagueOverride(reason: string) {
    if (!scanResult?.player || !scanResult.event || selectedSession?.type !== "league_fixture") return;
    setConfirmingOverride(true);
    try {
      const headers = await getHeaders();
      const res = await fetch(`${API}/scanner/league/fixture/${scanResult.event.id}/walk-up-override`, {
        method: "POST", headers,
        body: JSON.stringify({ playerId: scanResult.player.id, reason: reason.trim() || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: "Override failed", description: err.error ?? "Could not check in", variant: "destructive" });
        return;
      }
      setScanResult({ ...scanResult, status: "checked_in" });
      toast({ title: `${scanResult.player.firstName ?? "Player"} checked in via override` });
    } catch (e: any) {
      toast({ title: "Override failed", description: e.message, variant: "destructive" });
    } finally {
      setConfirmingOverride(false);
    }
  }

  function handleQrKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && qrInput.trim()) {
      scan.mutate(qrInput.trim());
    }
  }

  const allowedRoles = ["admin", "staff", "ref", "coach"];

  if (profileLoading) {
    return <Layout><div className="container max-w-lg mx-auto px-4 py-8"><Skeleton className="h-64" /></div></Layout>;
  }
  if (!profile || !allowedRoles.includes(profile.role ?? "")) {
    return <Redirect to="/dashboard" />;
  }

  const sessions = sessionData?.sessions ?? [];

  return (
    <Layout>
      <div className="container max-w-lg mx-auto px-4 py-6 space-y-5">
        <div>
          <h1 className="text-2xl font-bold font-sans uppercase tracking-tight text-primary">QR Scanner</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Context-aware check-in</p>
        </div>

        {/* Session context selector */}
        {!selectedSession ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Select Your Event</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-14" />)}</div>
              ) : sessions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Clock className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p>No active sessions found for today.</p>
                  <p className="text-xs mt-1">Check back when an event is scheduled and open.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {sessions.map((s) => (
                    <button
                      key={`${s.type}-${s.id}`}
                      className="w-full text-left rounded-xl border border-border bg-muted/30 hover:bg-muted/60 transition-colors px-4 py-3 flex items-center gap-3"
                      onClick={() => setSelectedSession(s)}
                    >
                      <SessionIcon type={s.type} />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate">{s.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatEastern(new Date(s.startsAt), "h:mm a 'ET'")} ·{" "}
                          {s.type === "dropin" ? "Drop-in" : s.type === "camp_day" ? "Camp" : "League Game"}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-xs flex-shrink-0">
                        {s.type === "dropin" ? "Drop-in" : s.type === "camp_day" ? "Camp" : "League"}
                      </Badge>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ) : !scanResult ? (
          <>
            {/* Active session header */}
            <div className="flex items-center gap-2 rounded-xl bg-primary/10 border border-primary/20 px-4 py-3">
              <SessionIcon type={selectedSession.type} />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate">{selectedSession.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatEastern(new Date(selectedSession.startsAt), "h:mm a 'ET'")}
                </p>
              </div>
              <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => setSelectedSession(null)}>
                Change
              </Button>
            </div>

            {/* Game card roster panel for league fixtures */}
            {selectedSession.type === "league_fixture" && gameCard && (
              <RosterPanel gameCard={gameCard} />
            )}

            {/* QR Scanner */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <QrCode className="h-4 w-4" /> Scan Player QR
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <input
                    ref={inputRef}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    placeholder="Scan or type QR code, press Enter"
                    value={qrInput}
                    onChange={e => setQrInput(e.target.value)}
                    onKeyDown={handleQrKey}
                    autoFocus
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setScannerOpen(true)}
                    title="Scan with camera"
                  >
                    <Camera className="h-4 w-4" />
                  </Button>
                  <Button
                    onClick={() => qrInput.trim() && scan.mutate(qrInput.trim())}
                    disabled={scan.isPending || !qrInput.trim()}
                  >
                    Go
                  </Button>
                </div>

                {scan.isPending && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground animate-pulse">
                    <div className="h-3 w-3 rounded-full bg-primary animate-pulse" />
                    Checking...
                  </div>
                )}

                <div className="text-xs text-muted-foreground border-t pt-3">
                  <p className="font-medium mb-1">Scan logic for this event:</p>
                  {selectedSession.type === "dropin" && (
                    <ul className="space-y-0.5 list-disc ml-4">
                      <li>Registered spot → Check in immediately</li>
                      <li>No spot + space available → Walk-up registration prompt</li>
                      <li>Session full → Capacity notice</li>
                    </ul>
                  )}
                  {selectedSession.type === "camp_day" && (
                    <ul className="space-y-0.5 list-disc ml-4">
                      <li>Registered youth → Check in for today's camp day</li>
                      <li>Not registered + space available → Walk-up prompt (guardian must be present)</li>
                      <li>Camp full → Capacity notice</li>
                    </ul>
                  )}
                  {selectedSession.type === "league_fixture" && (
                    <ul className="space-y-0.5 list-disc ml-4">
                      <li>On game card roster → Green confirmation with name and number</li>
                      <li>Not on roster → Warning flag (override available if league-registered)</li>
                    </ul>
                  )}
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          <>
            {/* Active session reminder */}
            <div className="flex items-center gap-2 rounded-xl bg-primary/10 border border-primary/20 px-4 py-3 text-sm">
              <SessionIcon type={selectedSession.type} />
              <span className="font-medium truncate">{selectedSession.name}</span>
            </div>

            {/* Scan result */}
            <ScanResultCard
              result={scanResult}
              onReset={() => {
                setScanResult(null);
                setQrInput("");
                setTimeout(() => inputRef.current?.focus(), 100);
              }}
              onConfirmWalkup={
                scanResult.status === "walk_up_available" &&
                selectedSession.type !== "league_fixture"
                  ? handleConfirmWalkup
                  : undefined
              }
              confirmingWalkup={confirmingWalkup}
              onLeagueOverride={
                scanResult.status === "league_walk_up" && scanResult.hasLeagueReg
                  ? handleLeagueOverride
                  : undefined
              }
              confirmingOverride={confirmingOverride}
              onConfirmPayment={
                scanResult.status === "registered_pending_payment"
                  ? handleConfirmPayment
                  : undefined
              }
              confirmingPayment={confirmingPayment}
            />
          </>
        )}

        <QrScannerModal
          open={scannerOpen}
          onClose={() => setScannerOpen(false)}
          onScan={(val) => { setScannerOpen(false); scan.mutate(val); }}
        />
      </div>
    </Layout>
  );
}
