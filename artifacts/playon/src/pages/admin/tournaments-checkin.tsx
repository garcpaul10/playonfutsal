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
  Users, ChevronLeft, UserCheck, Shield, Trophy, UserPlus, Crown, Camera, Clock,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { QrScannerModal } from "@/components/qr-scanner-modal";
import { CheckInResultOverlay, type CheckInResult } from "@/components/checkin-result-overlay";
import { friendlyDenialReason, friendlyTimingReason } from "@/lib/checkin-utils";

import { API_BASE as API } from "@/lib/api-base";

function useAuthHeaders() {
  const { getToken } = useAuth();
  return async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  };
}

export default function TournamentFixtureCheckin() {
  const [, params] = useRoute("/admin/tournaments/fixtures/:fixtureId/checkin");
  const fixtureId = Number(params?.fixtureId);
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const getHeaders = useAuthHeaders();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [qrInput, setQrInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [lastCheckedIn, setLastCheckedIn] = useState<any>(null);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAdd, setQuickAdd] = useState({ firstName: "", lastName: "", email: "" });
  const [tournamentId, setTournamentId] = useState<number | null>(null);

  const qrRef = useRef<HTMLInputElement>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [checkInOverlay, setCheckInOverlay] = useState<CheckInResult | null>(null);
  useEffect(() => { qrRef.current?.focus(); }, []);

  // Load fixture info to find tournament id
  const { data: fixtureInfo } = useQuery({
    queryKey: ["fixture-info-raw", fixtureId],
    queryFn: async () => {
      const r = await fetch(`${API}/fixtures/${fixtureId}`).catch(() => null);
      if (!r || !r.ok) return null;
      return r.json();
    },
    enabled: !!fixtureId,
  });

  // We need to know which tournament this fixture belongs to.
  // The fixture entityType = "tournament" and entityId = tournamentId.
  // Load all tournaments to cross-reference.
  const { data: tournaments } = useQuery({
    queryKey: ["tournaments"],
    queryFn: async () => {
      const r = await fetch(`${API}/tournaments`);
      return r.json();
    },
    enabled: !!fixtureId,
  });

  // Fetch checkin data using tournament fixtures checkin route.
  // We find the tournamentId from all fixtures matching this fixtureId.
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
    queryKey: ["tournament-fixture-checkin", fixtureId],
    queryFn: async () => {
      if (!tournamentId) return null;
      const headers = await getHeaders();
      const r = await fetch(`${API}/tournaments/${tournamentId}/fixtures/${fixtureId}/checkin`, { headers });
      if (!r.ok) throw new Error("Failed to load check-in data");
      return r.json();
    },
    enabled: !!tournamentId,
    refetchInterval: 15000,
  });

  // Find tournamentId from fixtures list
  const { data: allFixtures } = useQuery({
    queryKey: ["all-tournament-fixtures-for-checkin"],
    queryFn: async () => {
      if (!tournaments?.length) return [];
      const results: any[] = [];
      for (const t of tournaments) {
        const r = await fetch(`${API}/tournaments/${t.id}/fixtures`);
        if (r.ok) {
          const fixtures = await r.json();
          const match = fixtures.find((f: any) => f.id === fixtureId);
          if (match) {
            setTournamentId(t.id);
            return { tournamentId: t.id, tournament: t, fixture: match };
          }
        }
      }
      return null;
    },
    enabled: !!tournaments?.length && !!fixtureId,
  });

  const checkIn = useMutation({
    mutationFn: async (payload: { userId?: number; qrCode?: string; method: string }) => {
      if (!tournamentId) throw new Error("Tournament not found");
      const headers = await getHeaders();
      const r = await fetch(`${API}/tournaments/${tournamentId}/fixtures/${fixtureId}/checkin`, {
        method: "POST", headers, body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: "Check-in failed" }));
        const e = new Error(err.error || "Check-in failed");
        if (err.windowStart) (e as any).windowStart = err.windowStart;
        if (err.notYetActive) (e as any).notYetActive = true;
        throw e;
      }
      return r.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["tournament-fixture-checkin", fixtureId] });
      const name = `${data.user?.firstName || ""} ${data.user?.lastName || ""}`.trim();
      setLastCheckedIn({ name, method: data.checkin?.method });
      setCheckInOverlay({ result: "verified", playerName: name || "Player" });
      toast({ title: "Checked in!", description: name });
      setQrInput("");
    },
    onError: (e: any) => {
      const msg = e.message ?? "Check-in failed";
      const reason = (e as any).notYetActive
        ? friendlyTimingReason((e as any).windowStart)
        : friendlyDenialReason(msg);
      setCheckInOverlay({ result: "denied", reason });
      toast({ title: "Check-in failed", description: msg, variant: "destructive" });
      setQrInput("");
    },
  });

  const quickAddMutation = useMutation({
    mutationFn: async () => {
      if (!tournamentId) throw new Error("Tournament not found");
      const headers = await getHeaders();
      const r = await fetch(`${API}/tournaments/${tournamentId}/fixtures/${fixtureId}/checkin/quickadd`, {
        method: "POST", headers, body: JSON.stringify(quickAdd),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Failed"); }
      return r.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["tournament-fixture-checkin", fixtureId] });
      const name = `${data.user?.firstName || ""} ${data.user?.lastName || ""}`.trim();
      setLastCheckedIn({ name, method: "walk_in" });
      toast({ title: "Walk-in added", description: name });
      setShowQuickAdd(false);
      setQuickAdd({ firstName: "", lastName: "", email: "" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleQrSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!qrInput.trim()) return;
    checkIn.mutate({ qrCode: qrInput.trim(), method: "qr" });
  };

  if (profileLoading) return <Layout><div className="p-12"><Skeleton className="h-96" /></div></Layout>;
  if (profile?.role !== "admin" && profile?.role !== "staff" && profile?.adminLevel !== "super" && profile?.adminLevel !== "admin") return <Redirect to="/dashboard" />;

  const players = checkinData?.players || [];
  const filtered = searchTerm
    ? players.filter((p: any) =>
        `${p.firstName} ${p.lastName}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.email?.toLowerCase().includes(searchTerm.toLowerCase()),
      )
    : players;

  const stats = checkinData?.stats || { total: 0, checkedIn: 0, unpaid: 0 };
  const fixture = checkinData?.fixture || (allFixtures as any)?.fixture;
  const tournament = (allFixtures as any)?.tournament;

  const CHECKIN_BUFFER_MS = 30 * 60 * 1000;
  const windowStartMs = fixture?.scheduledAt ? new Date(fixture.scheduledAt).getTime() - CHECKIN_BUFFER_MS : null;
  const notYetOpen = windowStartMs ? Date.now() < windowStartMs : false;
  const windowOpenAt = windowStartMs ? new Date(windowStartMs) : null;

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        {notYetOpen && windowOpenAt && (
          <Alert className="mb-6 border-amber-400 bg-amber-50 dark:bg-amber-950/40">
            <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <AlertDescription className="text-amber-800 dark:text-amber-200">
              Check-in opens at {format(windowOpenAt, "h:mm a")} (30 min before start). Scanning is disabled until then.
            </AlertDescription>
          </Alert>
        )}

        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/admin/tournaments" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
            <ChevronLeft className="h-4 w-4" /> Tournaments
          </Link>
          <div>
            <h1 className="text-2xl font-bold font-sans uppercase tracking-tight text-primary">
              Fixture Check-in
            </h1>
            {tournament && (
              <p className="text-sm text-muted-foreground">{tournament.name}</p>
            )}
            {fixture && (
              <p className="text-sm text-muted-foreground">
                {fixture.homeTeam?.name || "TBD"} vs {fixture.awayTeam?.name || "TBD"}
                {fixture.scheduledAt && ` · ${format(new Date(fixture.scheduledAt), "MMM d, h:mm a")}`}
                {" · "}Round {fixture.round} · {fixture.phase}
              </p>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <Card>
            <CardContent className="pt-4 pb-4 text-center">
              <div className="text-3xl font-bold">{stats.checkedIn}</div>
              <div className="text-sm text-muted-foreground">Checked In</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4 text-center">
              <div className="text-3xl font-bold">{stats.total}</div>
              <div className="text-sm text-muted-foreground">Expected</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4 text-center">
              <div className={`text-3xl font-bold ${stats.unpaid > 0 ? "text-destructive" : "text-green-500"}`}>
                {stats.unpaid}
              </div>
              <div className="text-sm text-muted-foreground">Unpaid</div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* QR + controls */}
          <div className="space-y-4">
            {/* QR scanner */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <QrCode className="h-5 w-5" /> QR Scanner
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleQrSubmit} className="space-y-3">
                  <div className="flex gap-2">
                    <Input
                      ref={qrRef}
                      value={qrInput}
                      onChange={(e) => setQrInput(e.target.value)}
                      placeholder="Scan QR code here…"
                      className="font-mono text-sm"
                      autoComplete="off"
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
                  </div>
                  <Button type="submit" className="w-full" disabled={notYetOpen || !qrInput.trim() || checkIn.isPending}>
                    {checkIn.isPending ? "Checking in…" : "Check In"}
                  </Button>
                </form>

                {lastCheckedIn && (
                  <div className="mt-4 p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-center">
                    <CheckCircle2 className="h-6 w-6 text-green-500 mx-auto mb-1" />
                    <p className="font-semibold text-green-500">{lastCheckedIn.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{lastCheckedIn.method?.replace("_", " ")}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Quick add walk-in */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <UserPlus className="h-4 w-4" /> Walk-in Player
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!showQuickAdd ? (
                  <Button variant="outline" className="w-full" onClick={() => setShowQuickAdd(true)} disabled={notYetOpen}>
                    Add Walk-in
                  </Button>
                ) : (
                  <div className="space-y-2">
                    <Input placeholder="First name *" value={quickAdd.firstName} onChange={(e) => setQuickAdd((p) => ({ ...p, firstName: e.target.value }))} />
                    <Input placeholder="Last name *" value={quickAdd.lastName} onChange={(e) => setQuickAdd((p) => ({ ...p, lastName: e.target.value }))} />
                    <Input placeholder="Email" type="email" value={quickAdd.email} onChange={(e) => setQuickAdd((p) => ({ ...p, email: e.target.value }))} />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => quickAddMutation.mutate()} disabled={notYetOpen || !quickAdd.firstName || !quickAdd.lastName || quickAddMutation.isPending}>
                        {quickAddMutation.isPending ? "Adding…" : "Add & Check In"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setShowQuickAdd(false)}>Cancel</Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Teams */}
            {checkinData?.teams?.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-base">Teams in Fixture</CardTitle></CardHeader>
                <CardContent>
                  {checkinData.teams.map((team: any) => (
                    <div key={team.id} className="py-2 border-b last:border-0">
                      <div className="font-medium">{team.name}</div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Player list */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" /> Players
                </CardTitle>
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder="Search by name or email…"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-60" />
                ) : filtered.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No players found.</p>
                ) : (
                  <div className="space-y-2">
                    {filtered.map((p: any) => (
                      <div
                        key={p.userId}
                        className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 transition-colors ${
                          p.checkedIn ? "bg-green-500/5 border-green-500/20" : ""
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {p.checkedIn
                            ? <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
                            : <XCircle className="h-5 w-5 text-muted-foreground flex-shrink-0" />}
                          <div className="min-w-0">
                            <div className="font-medium truncate flex items-center gap-1.5">
                              {p.firstName} {p.lastName}
                              {memberUserIds.has(p.userId) && (
                                <Crown className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" aria-label="PlayOn Member" />
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">{p.email}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {p.paymentBlocked && (
                            <Badge variant="destructive" className="text-xs">
                              <AlertCircle className="h-3 w-3 mr-1" /> Unpaid
                            </Badge>
                          )}
                          {!p.checkedIn && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => checkIn.mutate({ userId: p.userId, method: "manual" })}
                              disabled={notYetOpen || checkIn.isPending}
                            >
                              <UserCheck className="h-4 w-4 mr-1" /> Check In
                            </Button>
                          )}
                          {p.checkedIn && (
                            <Badge className="bg-green-600 text-white">Checked In</Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
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
