import React, { useState, useRef, useEffect } from "react";
import { useRoute, Redirect, Link } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  QrCode, Search, CheckCircle2, XCircle, AlertCircle,
  Users, ChevronLeft, UserCheck, Shield, Trophy, Crown, Camera, RotateCcw, AlertTriangle, Clock,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { QrScannerModal } from "@/components/qr-scanner-modal";
import { CheckInResultOverlay, type CheckInResult } from "@/components/checkin-result-overlay";
import { friendlyDenialReason, friendlyTimingReason } from "@/lib/checkin-utils";

const API = "/api";

function useAuthHeaders() {
  const { getToken } = useAuth();
  return async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  };
}

function UndoCheckinButton({
  checkinId,
  playerName,
  isSuperAdmin,
  onVoided,
}: {
  checkinId: number;
  playerName: string;
  isSuperAdmin: boolean;
  onVoided: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [gameCardBlocked, setGameCardBlocked] = useState(false);
  const [forceConfirming, setForceConfirming] = useState(false);
  const { getToken } = useAuth();
  const { toast } = useToast();

  async function doVoid(force = false) {
    setLoading(true);
    try {
      const token = await getToken();
      const url = force ? `${API}/checkins/${checkinId}?forceVoid=true` : `${API}/checkins/${checkinId}`;
      const r = await fetch(url, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        if (err.gameCardComplete) {
          setGameCardBlocked(true);
          setConfirming(false);
          return;
        }
        toast({ title: "Undo failed", description: err.error ?? "Could not void check-in", variant: "destructive" });
        return;
      }
      toast({ title: `Check-in undone for ${playerName}` });
      setGameCardBlocked(false);
      setForceConfirming(false);
      onVoided();
    } catch (e: any) {
      toast({ title: "Undo failed", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
      setConfirming(false);
    }
  }

  if (gameCardBlocked) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-3 w-3" />
          <span>Game card finalised</span>
        </div>
        {isSuperAdmin && !forceConfirming && (
          <Button size="sm" variant="outline" className="h-7 text-xs border-destructive text-destructive" onClick={() => setForceConfirming(true)}>
            Override (super-admin)
          </Button>
        )}
        {isSuperAdmin && forceConfirming && (
          <div className="flex items-center gap-1">
            <span className="text-xs text-destructive font-medium">Force undo?</span>
            <Button size="sm" variant="destructive" className="h-7 text-xs px-2" onClick={() => doVoid(true)} disabled={loading}>
              {loading ? "..." : "Yes, override"}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => { setForceConfirming(false); setGameCardBlocked(false); }} disabled={loading}>
              Cancel
            </Button>
          </div>
        )}
        {!isSuperAdmin && (
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setGameCardBlocked(false)}>
            Dismiss
          </Button>
        )}
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-xs text-muted-foreground">Undo?</span>
        <Button size="sm" variant="destructive" className="h-7 text-xs px-2" onClick={() => doVoid(false)} disabled={loading}>
          {loading ? "..." : "Yes"}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => setConfirming(false)} disabled={loading}>
          No
        </Button>
      </div>
    );
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-7 text-xs text-muted-foreground hover:text-destructive"
      onClick={() => setConfirming(true)}
      title="Undo check-in"
    >
      <RotateCcw className="h-3 w-3" />
    </Button>
  );
}

export default function LeagueFixtureCheckin() {
  const [, params] = useRoute("/admin/leagues/fixtures/:fixtureId/checkin");
  const fixtureId = Number(params?.fixtureId);
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const getHeaders = useAuthHeaders();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [qrInput, setQrInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [lastCheckedIn, setLastCheckedIn] = useState<any>(null);
  const qrRef = useRef<HTMLInputElement>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [checkInOverlay, setCheckInOverlay] = useState<CheckInResult | null>(null);

  const isSuperAdmin = profile?.adminLevel === "super" || (profile?.role === "admin" && profile?.adminLevel !== "scoped");

  useEffect(() => { qrRef.current?.focus(); }, []);

  const { data: activeMemberships } = useQuery({
    queryKey: ["admin-memberships-active"],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/admin/memberships?status=active`, { headers });
      if (!r.ok) return [];
      return r.json();
    },
    staleTime: 60000,
  });
  const memberUserIds = new Set<number>((activeMemberships ?? []).map((m: any) => m.userId));

  const { data: checkinData, isLoading } = useQuery({
    queryKey: ["fixture-checkin", fixtureId],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/leagues/0/fixtures/${fixtureId}/checkin`, { headers });
      if (!r.ok) throw new Error("Failed to load check-in data");
      return r.json();
    },
    refetchInterval: 15000,
    enabled: !!fixtureId,
  });

  const checkIn = useMutation({
    mutationFn: async (payload: { userId?: string; qrCode?: string; method: string }) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/leagues/0/fixtures/${fixtureId}/checkin`, {
        method: "POST", headers, body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: "Check-in failed" }));
        const e = new Error(err.error ?? "Check-in failed");
        if (err.windowStart) (e as any).windowStart = err.windowStart;
        if (err.notYetActive) (e as any).notYetActive = true;
        throw e;
      }
      return r.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["fixture-checkin", fixtureId] });
      setLastCheckedIn(data);
      setQrInput(""); setSearchTerm("");
      const name = `${data.player?.firstName ?? ""} ${data.player?.lastName ?? ""}`.trim();
      if (data.eligible === false) {
        setCheckInOverlay({ result: "verified", playerName: name || "Player", reason: "Not on roster — check eligibility" });
        toast({ title: `⚠ ${name} — NOT on roster`, description: "Checked in with warning flag.", variant: "default" });
      } else {
        setCheckInOverlay({ result: "verified", playerName: name || "Player" });
        toast({ title: `✓ ${name} checked in!` });
      }
    },
    onError: (e: any) => {
      const msg = e.message ?? "Check-in failed";
      const reason = (e as any).notYetActive
        ? friendlyTimingReason((e as any).windowStart)
        : friendlyDenialReason(msg);
      setCheckInOverlay({ result: "denied", reason });
      const isAlready = msg.includes("already");
      toast({
        title: isAlready ? "Already checked in" : "Check-in failed",
        description: msg,
        variant: isAlready ? "default" : "destructive",
      });
      setQrInput("");
    },
  });

  const handleQrSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!qrInput.trim()) return;
    checkIn.mutate({ qrCode: qrInput.trim(), method: "qr" });
  };

  const handleManualCheckin = (player: any) => {
    checkIn.mutate({ userId: player.user?.clerkId ?? player.userId, method: "manual" });
  };

  if (profileLoading) return <Layout><div className="container mx-auto px-4 py-8"><Skeleton className="h-96" /></div></Layout>;
  if (!profile || (profile.role !== "admin" && profile.role !== "staff" && profile.adminLevel !== "super" && profile.adminLevel !== "admin")) return <Redirect to="/" />;

  const { fixture, homeTeam, awayTeam, homePlayers = [], awayPlayers = [] } = checkinData ?? {};
  const allPlayers = [...homePlayers.map((p: any) => ({ ...p, side: "home" })), ...awayPlayers.map((p: any) => ({ ...p, side: "away" }))];
  const filtered = searchTerm ? allPlayers.filter((p: any) => {
    const name = `${p.user?.firstName ?? ""} ${p.user?.lastName ?? ""} ${p.user?.email ?? ""}`.toLowerCase();
    return name.includes(searchTerm.toLowerCase());
  }) : [];

  const checkedInCount = [...homePlayers, ...awayPlayers].filter((p: any) => p.checkedIn).length;
  const totalCount = homePlayers.length + awayPlayers.length;

  const CHECKIN_BUFFER_MS = 30 * 60 * 1000;
  const windowStartMs = fixture?.scheduledAt ? new Date(fixture.scheduledAt).getTime() - CHECKIN_BUFFER_MS : null;
  const notYetOpen = windowStartMs ? Date.now() < windowStartMs : false;
  const windowOpenAt = windowStartMs ? new Date(windowStartMs) : null;

  return (
    <Layout>
      <div className="container mx-auto px-4 py-6 max-w-4xl">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/admin/leagues"><ChevronLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold uppercase tracking-tight">Fixture Check-In</h1>
            {fixture && (
              <p className="text-muted-foreground text-sm">
                {homeTeam?.name ?? "TBD"} vs {awayTeam?.name ?? "TBD"}
                {fixture.scheduledAt && ` · ${format(new Date(fixture.scheduledAt), "MMM d, h:mm a")}`}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-6">
          <Card>
            <CardContent className="flex items-center gap-3 p-3">
              <Users className="h-5 w-5 text-muted-foreground" />
              <div><p className="text-xs text-muted-foreground">On Roster</p><p className="text-xl font-bold">{totalCount}</p></div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-3">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <div><p className="text-xs text-muted-foreground">Checked In</p><p className="text-xl font-bold text-green-500">{checkedInCount}</p></div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-3">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              <div><p className="text-xs text-muted-foreground">Missing</p><p className="text-xl font-bold text-amber-500">{totalCount - checkedInCount}</p></div>
            </CardContent>
          </Card>
        </div>

        {notYetOpen && windowOpenAt && (
          <Alert className="mb-6 border-amber-400 bg-amber-50 dark:bg-amber-950/40">
            <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <AlertDescription className="text-amber-800 dark:text-amber-200">
              Check-in opens at {format(windowOpenAt, "h:mm a")} (30 min before start). Scanning is disabled until then.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2"><QrCode className="h-4 w-4" /> QR Scan</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleQrSubmit} className="flex gap-2">
                <Input
                  ref={qrRef}
                  className="flex-1"
                  placeholder="Scan QR or type Player ID…"
                  value={qrInput}
                  onChange={(e) => setQrInput(e.target.value)}
                  disabled={notYetOpen}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setScannerOpen(true)}
                  title="Scan with camera"
                  disabled={notYetOpen}
                >
                  <Camera className="h-4 w-4" />
                </Button>
                <Button type="submit" disabled={notYetOpen || checkIn.isPending || !qrInput}>Go</Button>
              </form>
              {lastCheckedIn && (
                <div className={`mt-3 flex items-center gap-2 rounded-lg p-2 ${lastCheckedIn.eligible !== false ? "bg-green-500/10 border border-green-500/30" : "bg-amber-500/10 border border-amber-500/30"}`}>
                  {lastCheckedIn.eligible !== false
                    ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                    : <AlertCircle className="h-4 w-4 text-amber-500" />}
                  <span className="text-sm font-medium">
                    {lastCheckedIn.player?.firstName} {lastCheckedIn.player?.lastName}
                    {lastCheckedIn.eligible === false && " — not on roster"}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2"><Search className="h-4 w-4" /> Manual Search</CardTitle>
            </CardHeader>
            <CardContent>
              <Input
                placeholder="Search by name or email…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              {searchTerm && (
                <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                  {filtered.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No matches</p>
                  ) : (
                    filtered.map((p: any) => (
                      <div key={p.id} className="flex items-center justify-between rounded bg-muted/40 px-2 py-1">
                        <div>
                          <span className="text-sm font-medium">{p.user?.firstName} {p.user?.lastName}</span>
                          <span className="text-xs text-muted-foreground ml-2">{p.side === "home" ? homeTeam?.name : awayTeam?.name}</span>
                        </div>
                        {p.checkedIn ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        ) : (
                          <Button size="sm" className="h-6 text-xs" onClick={() => handleManualCheckin(p)}
                            disabled={notYetOpen || checkIn.isPending}>
                            Check In
                          </Button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {isLoading ? (
          <Skeleton className="h-64" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { team: homeTeam, players: homePlayers, label: "Home" },
              { team: awayTeam, players: awayPlayers, label: "Away" },
            ].map(({ team, players, label }) => (
              <Card key={label}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <Shield className="h-4 w-4" />
                      {team?.name ?? label}
                    </span>
                    <span className="text-sm font-normal text-muted-foreground">
                      {players.filter((p: any) => p.checkedIn).length}/{players.length}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  {players.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No roster members</p>
                  ) : (
                    players.map((p: any) => {
                      const playerName = `${p.user?.firstName ?? ""} ${p.user?.lastName ?? ""}`.trim() || "Player";
                      return (
                        <div key={p.id} className={`flex items-center justify-between rounded-lg px-3 py-2 transition-colors ${p.checkedIn ? "bg-green-500/10" : "bg-muted/30 hover:bg-muted/50"}`}>
                          <div className="flex items-center gap-2 min-w-0">
                            {p.checkedIn
                              ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                              : <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/40 shrink-0" />}
                            <div className="min-w-0">
                              <span className="text-sm font-medium inline-flex items-center gap-1.5 truncate">
                                {p.user?.firstName ?? "—"} {p.user?.lastName ?? ""}
                                {memberUserIds.has(p.user?.id) && (
                                  <Crown className="h-3.5 w-3.5 text-amber-500 shrink-0" aria-label="PlayOn Member" />
                                )}
                              </span>
                              {p.role === "captain" && <span className="text-xs text-amber-500 ml-1">⭐ Captain</span>}
                              {p.checkedIn && p.checkedInAt && (
                                <p className="text-xs text-muted-foreground">{format(new Date(p.checkedInAt), "h:mm a")}</p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0 ml-2">
                            {!p.checkedIn && (
                              <Button size="sm" variant="ghost" className="h-7 text-xs"
                                onClick={() => handleManualCheckin(p)} disabled={notYetOpen || checkIn.isPending}>
                                <UserCheck className="h-3 w-3" />
                              </Button>
                            )}
                            {p.checkedIn && p.checkinId && (
                              <UndoCheckinButton
                                checkinId={p.checkinId}
                                playerName={playerName}
                                isSuperAdmin={!!isSuperAdmin}
                                onVoided={() => qc.invalidateQueries({ queryKey: ["fixture-checkin", fixtureId] })}
                              />
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
      <QrScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={(val) => checkIn.mutate({ qrCode: val, method: "qr" })}
      />
      <CheckInResultOverlay
        value={checkInOverlay}
        onDismiss={() => { setCheckInOverlay(null); qrRef.current?.focus(); }}
      />
    </Layout>
  );
}
