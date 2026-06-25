import React, { useState, useEffect, useRef } from "react";
import { useRoute, Redirect } from "wouter";
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
import {
  QrCode, Search, CheckCircle2, XCircle, AlertCircle,
  Users, DollarSign, Clock, ChevronLeft, Crown, Camera, RotateCcw,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { QrScannerModal } from "@/components/qr-scanner-modal";
import { CheckInResultOverlay, type CheckInResult } from "@/components/checkin-result-overlay";
import { friendlyDenialReason, friendlyTimingReason } from "@/lib/checkin-utils";
import { format } from "date-fns";

import { API_BASE as API } from "@/lib/api-base";

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
  onVoided,
}: {
  checkinId: number;
  playerName: string;
  onVoided: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const { getToken } = useAuth();
  const { toast } = useToast();

  async function handleVoid() {
    setLoading(true);
    try {
      const token = await getToken();
      const r = await fetch(`${API}/checkins/${checkinId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        toast({ title: "Undo failed", description: err.error ?? "Could not void check-in", variant: "destructive" });
        return;
      }
      toast({ title: `Check-in undone for ${playerName}` });
      onVoided();
    } catch (e: any) {
      toast({ title: "Undo failed", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
      setConfirming(false);
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-xs text-muted-foreground">Undo?</span>
        <Button size="sm" variant="destructive" className="h-7 text-xs px-2" onClick={handleVoid} disabled={loading}>
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
      className="h-8 text-xs text-muted-foreground hover:text-destructive"
      onClick={() => setConfirming(true)}
      title="Undo check-in"
    >
      <RotateCcw className="h-3.5 w-3.5 mr-1" />
      Undo
    </Button>
  );
}

export default function CampCheckin() {
  const [, params] = useRoute("/admin/camps/:campId/checkin/:dayId");
  const campId = Number(params?.campId);
  const dayId = Number(params?.dayId);

  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const qc = useQueryClient();
  const { toast } = useToast();
  const getHeaders = useAuthHeaders();

  const [searchTerm, setSearchTerm] = useState("");
  const [qrInput, setQrInput] = useState("");
  const [lastCheckedIn, setLastCheckedIn] = useState<any>(null);
  const qrRef = useRef<HTMLInputElement>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [checkInOverlay, setCheckInOverlay] = useState<CheckInResult | null>(null);

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
    queryKey: ["camp-day-checkin", campId, dayId],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/camps/${campId}/days/${dayId}/checkin`, { headers });
      if (!r.ok) throw new Error("Failed to load check-in data");
      return r.json();
    },
    refetchInterval: 15000,
  });

  const checkIn = useMutation({
    mutationFn: async (payload: { userId?: number; qrCode?: string; method: string }) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/camps/${campId}/days/${dayId}/checkin`, {
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
      qc.invalidateQueries({ queryKey: ["camp-day-checkin", campId, dayId] });
      setLastCheckedIn(data);
      setQrInput(""); setSearchTerm("");
      const name = `${data.player?.firstName ?? ""} ${data.player?.lastName ?? ""}`.trim();
      if (data.alreadyCheckedIn) {
        setCheckInOverlay({ result: "verified", playerName: name || "Player", reason: "Already checked in" });
        toast({ title: `${name} already checked in`, variant: "default" });
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
      toast({ title: "Check-in failed", description: msg, variant: "destructive" });
      setQrInput("");
    },
  });

  const qrTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function handleQrChange(val: string) {
    setQrInput(val);
    if (qrTimer.current) clearTimeout(qrTimer.current);
    qrTimer.current = setTimeout(() => {
      if (val.trim().length > 0) {
        checkIn.mutate({ qrCode: val.trim(), method: "qr" });
      }
    }, 300);
  }

  function handleManualCheckIn(playerUserId: number) {
    checkIn.mutate({ userId: playerUserId, method: "manual" });
  }

  const filteredRoster = checkinData?.roster?.filter((r: any) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      r.player?.firstName?.toLowerCase().includes(term) ||
      r.player?.lastName?.toLowerCase().includes(term) ||
      r.player?.email?.toLowerCase().includes(term)
    );
  }) ?? [];

  const checkedInCount = checkinData?.checkedInCount ?? 0;
  const total = checkinData?.totalCampers ?? 0;
  const waiverMissing = checkinData?.roster?.filter((r: any) => !r.waiverSigned).length ?? 0;
  const unpaid = checkinData?.roster?.filter((r: any) => r.paymentStatus === "unpaid").length ?? 0;

  if (profileLoading) return <Layout><div className="p-12"><Skeleton className="h-96" /></div></Layout>;
  if (profile?.role !== "admin" && profile?.role !== "staff" && profile?.adminLevel !== "super" && profile?.adminLevel !== "admin") return <Redirect to="/dashboard" />;

  const CHECKIN_BUFFER_MS = 30 * 60 * 1000;
  const dayStartStr = checkinData?.day?.date && checkinData?.day?.startTime
    ? `${checkinData.day.date}T${checkinData.day.startTime}`
    : null;
  const windowStartMs = dayStartStr ? new Date(dayStartStr).getTime() - CHECKIN_BUFFER_MS : null;
  const notYetOpen = windowStartMs ? Date.now() < windowStartMs : false;
  const windowOpenAt = windowStartMs ? new Date(windowStartMs) : null;

  return (
    <Layout>
      <div className="container mx-auto px-4 py-6 max-w-2xl">
        <div className="mb-6">
          <a href="/admin/camps" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-3">
            <ChevronLeft className="h-4 w-4 mr-1" /> Back to Camps
          </a>
          {isLoading ? <Skeleton className="h-8 w-64" /> : (
            <>
              <h1 className="text-2xl font-bold font-sans uppercase tracking-tight text-primary">{checkinData?.camp?.name}</h1>
              {checkinData?.day && (
                <p className="text-muted-foreground text-sm mt-1">
                  {format(new Date(checkinData.day.date + "T12:00:00"), "EEEE, MMMM d, yyyy")}
                  {" · "}{checkinData.day.startTime} – {checkinData.day.endTime}
                </p>
              )}
            </>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Card className="text-center p-3">
            <div className="text-2xl font-bold text-primary">{checkedInCount}/{total}</div>
            <div className="text-xs text-muted-foreground mt-1">Checked In</div>
          </Card>
          <Card className="text-center p-3">
            <div className="text-2xl font-bold text-muted-foreground">{total - checkedInCount}</div>
            <div className="text-xs text-muted-foreground mt-1">Not Yet</div>
          </Card>
          <Card className={`text-center p-3 ${unpaid > 0 ? "border-destructive" : ""}`}>
            <div className={`text-2xl font-bold ${unpaid > 0 ? "text-destructive" : "text-green-600"}`}>{unpaid}</div>
            <div className="text-xs text-muted-foreground mt-1">Unpaid</div>
          </Card>
          <Card className={`text-center p-3 ${waiverMissing > 0 ? "border-amber-400" : ""}`}>
            <div className={`text-2xl font-bold ${waiverMissing > 0 ? "text-amber-500" : "text-green-600"}`}>{waiverMissing}</div>
            <div className="text-xs text-muted-foreground mt-1">No Waiver</div>
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

        <Card className="mb-6 border-primary/30">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <QrCode className="h-6 w-6 text-primary flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium mb-1">Scan QR Code</p>
                <Input
                  ref={qrRef}
                  placeholder="Focus here and scan player QR code…"
                  value={qrInput}
                  onChange={e => handleQrChange(e.target.value)}
                  className="font-mono"
                  autoFocus
                  disabled={notYetOpen}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setScannerOpen(true)}
                title="Scan with camera"
                className="flex-shrink-0"
                disabled={notYetOpen}
              >
                <Camera className="h-5 w-5" />
              </Button>
            </div>
            {lastCheckedIn && (
              <div className={`mt-3 p-2 rounded-md text-sm font-medium flex items-center gap-2 ${lastCheckedIn.alreadyCheckedIn ? "bg-muted" : "bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300"}`}>
                {lastCheckedIn.alreadyCheckedIn ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                {lastCheckedIn.alreadyCheckedIn ? "Already checked in: " : "Checked in: "}
                {lastCheckedIn.player?.firstName} {lastCheckedIn.player?.lastName}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search camper name or email…"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-16" />)}</div>
        ) : (
          <div className="space-y-2">
            {filteredRoster.map((r: any) => {
              const playerName = `${r.player?.firstName ?? ""} ${r.player?.lastName ?? ""}`.trim() || "Camper";
              return (
                <Card key={r.registrationId} className={`transition-all ${r.checkedIn ? "border-green-400 bg-green-50/30 dark:bg-green-950/20" : ""}`}>
                  <div className="flex items-center justify-between p-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${r.checkedIn ? "bg-green-100 dark:bg-green-900" : "bg-muted"}`}>
                        {r.checkedIn
                          ? <CheckCircle2 className="h-5 w-5 text-green-600" />
                          : <XCircle className="h-5 w-5 text-muted-foreground" />
                        }
                      </div>
                      <div>
                        <div className="font-medium text-sm flex items-center gap-1.5">
                          {r.player?.firstName} {r.player?.lastName}
                          {r.userId && memberUserIds.has(r.userId) && (
                            <Crown className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" aria-label="PlayOn Member" />
                          )}
                        </div>
                        <div className="flex gap-1.5 mt-0.5 flex-wrap">
                          {r.paymentStatus === "unpaid" && (
                            <Badge variant="destructive" className="text-xs h-5"><DollarSign className="h-3 w-3 mr-0.5" />Owes ${r.balanceDue?.toFixed(2) ?? "?"}</Badge>
                          )}
                          {!r.waiverSigned && (
                            <Badge className="text-xs h-5 bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"><AlertCircle className="h-3 w-3 mr-0.5" />Waiver</Badge>
                          )}
                          {r.paymentStatus !== "unpaid" && r.waiverSigned && (
                            <Badge variant="secondary" className="text-xs h-5 text-green-600"><CheckCircle2 className="h-3 w-3 mr-0.5" />All clear</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {!r.checkedIn && (
                        <Button
                          size="sm"
                          className="h-9 text-sm"
                          onClick={() => handleManualCheckIn(r.playerUserId ?? r.userId)}
                          disabled={notYetOpen || checkIn.isPending}
                        >
                          Check In
                        </Button>
                      )}
                      {r.checkedIn && r.checkinId && (
                        <UndoCheckinButton
                          checkinId={r.checkinId}
                          playerName={playerName}
                          onVoided={() => qc.invalidateQueries({ queryKey: ["camp-day-checkin", campId, dayId] })}
                        />
                      )}
                      {r.checkedIn && !r.checkinId && (
                        <span className="text-xs text-green-600 font-medium">Present</span>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
            {filteredRoster.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">No campers found.</div>
            )}
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
