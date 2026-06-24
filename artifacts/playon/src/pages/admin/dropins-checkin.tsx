import React, { useState, useRef } from "react";
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
import { format } from "date-fns";
import { QrCode, Search, DollarSign, AlertTriangle, CheckCircle2, UserX, ChevronUp, Crown, Camera, RotateCcw, AlertCircle, Clock } from "lucide-react";
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

const PAYMENT_LABELS: Record<string, string> = {
  unpaid: "Owes",
  paid_inapp: "Paid (app)",
  paid_external: "Paid (cash/ext.)",
  refunded: "Refunded",
  waived: "Waived",
};
const PAYMENT_COLORS: Record<string, string> = {
  unpaid: "destructive",
  paid_inapp: "default",
  paid_external: "default",
  refunded: "secondary",
  waived: "secondary",
};

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
      toast({ title: `Check-in undone for ${playerName}`, description: "Spot returned to available capacity." });
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
      <RotateCcw className="h-3.5 w-3.5" />
    </Button>
  );
}

function SpotRow({
  spot,
  onCheckin,
  onMarkPayment,
  onNoShow,
  onPromote,
  checkinLoading,
  dropinId,
  isMember,
  onVoided,
}: {
  spot: any;
  onCheckin: (userId: number | null, method: "manual", spotId?: number) => void;
  onMarkPayment: (spotId: number, status: string) => void;
  onNoShow: (spotId: number, promote: boolean) => void;
  onPromote: (spotId: number) => void;
  checkinLoading: boolean;
  dropinId: number;
  isMember?: boolean;
  onVoided: () => void;
}) {
  const [showPayMenu, setShowPayMenu] = useState(false);
  const isGuest = !spot.userId && (spot.guestName || spot.guestEmail);
  const name = [spot.userFirstName, spot.userLastName].filter(Boolean).join(" ") || spot.guestName || spot.userEmail || spot.guestEmail || "Guest";

  return (
    <div className={`flex items-center justify-between py-3 px-3 rounded-lg ${spot.checkedIn ? "bg-green-500/10" : spot.noShow ? "bg-red-500/10 opacity-60" : "bg-muted/50"} border mb-2`}>
      <div className="flex items-center gap-3 min-w-0">
        {spot.checkedIn
          ? <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
          : spot.noShow
          ? <UserX className="h-5 w-5 text-red-500 flex-shrink-0" />
          : <div className="h-5 w-5 rounded-full border-2 border-muted-foreground flex-shrink-0" />}
        <div className="min-w-0">
          <div className="font-semibold text-sm truncate flex items-center gap-1.5">
            {spot.waitlisted && <span className="text-orange-400 mr-1">#{spot.waitlistPosition}</span>}
            {name}
            {isGuest && (
              <Badge variant="outline" className="text-xs px-1 py-0 border-blue-400 text-blue-600 dark:text-blue-400">Guest</Badge>
            )}
            {isMember && <Crown className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" aria-label="PlayOn Member" />}
          </div>
          {isGuest && spot.guestEmail && (
            <div className="text-xs text-muted-foreground mt-0.5">{spot.guestEmail}</div>
          )}
          <div className="flex gap-1 flex-wrap">
            <Badge variant={PAYMENT_COLORS[spot.paymentStatus] as any} className="text-xs px-1 py-0">
              {PAYMENT_LABELS[spot.paymentStatus] ?? spot.paymentStatus}
            </Badge>
            {!spot.waiverSigned && !isGuest && (
              <Badge variant="destructive" className="text-xs px-1 py-0">
                <AlertTriangle className="h-2.5 w-2.5 mr-0.5" /> Waiver
              </Badge>
            )}
            {spot.promotedFromWaitlist && <Badge variant="secondary" className="text-xs px-1 py-0">Promoted</Badge>}
          </div>
        </div>
      </div>

      <div className="flex gap-1 flex-shrink-0 ml-2">
        {!spot.checkedIn && !spot.noShow && !spot.waitlisted && (
          <Button
            size="sm"
            className="h-8 text-xs"
            onClick={() => onCheckin(spot.userId ?? null, "manual", spot.id)}
            disabled={checkinLoading}
          >
            Check In
          </Button>
        )}
        {spot.checkedIn && spot.checkinId && (
          <UndoCheckinButton checkinId={spot.checkinId} playerName={name} onVoided={onVoided} />
        )}
        {spot.waitlisted && (
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => onPromote(spot.id)}>
            <ChevronUp className="h-3 w-3 mr-1" /> Promote
          </Button>
        )}
        {!spot.noShow && !spot.waitlisted && (
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => onNoShow(spot.id, true)}>
            No-Show
          </Button>
        )}
        <div className="relative">
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setShowPayMenu(p => !p)}>
            <DollarSign className="h-3 w-3" />
          </Button>
          {showPayMenu && (
            <div className="absolute right-0 top-full z-50 bg-background border rounded-md shadow-lg p-1 min-w-[140px]" onClick={() => setShowPayMenu(false)}>
              {["unpaid", "paid_external", "paid_inapp", "waived", "refunded"].map(s => (
                <button key={s} className="w-full text-left text-xs px-3 py-1.5 hover:bg-muted rounded" onClick={() => onMarkPayment(spot.id, s)}>
                  {PAYMENT_LABELS[s]}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminDropinCheckin() {
  const [, params] = useRoute("/admin/dropins/:id/checkin");
  const id = Number(params?.id);
  const qc = useQueryClient();
  const { toast } = useToast();
  const getHeaders = useAuthHeaders();
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const [qrInput, setQrInput] = useState("");
  const [manualSearch, setManualSearch] = useState("");
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

  const { data: view, isLoading } = useQuery({
    queryKey: ["checkin-view", id],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/dropins/${id}/checkin`, { headers });
      if (!r.ok) throw new Error("Failed to load check-in view");
      return r.json();
    },
    refetchInterval: 15000,
  });

  const { data: allUsers } = useQuery({
    queryKey: ["users-search", manualSearch],
    enabled: manualSearch.length >= 2,
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/admin/users`, { headers });
      const users: any[] = await r.json();
      const q = manualSearch.toLowerCase();
      return users.filter((u: any) =>
        `${u.firstName} ${u.lastName} ${u.email}`.toLowerCase().includes(q)
      ).slice(0, 8);
    },
  });

  const checkin = useMutation({
    mutationFn: async ({ qrCode, userId, spotId, method }: { qrCode?: string; userId?: number; spotId?: number; method: string }) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/dropins/${id}/checkin`, {
        method: "POST", headers,
        body: JSON.stringify({ qrCode, userId, spotId, method }),
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
      qc.invalidateQueries({ queryKey: ["checkin-view", id] });
      const name = data.guestName || [data.userFirstName, data.userLastName].filter(Boolean).join(" ");
      setCheckInOverlay({ result: "verified", playerName: name || "Player" });
      toast({ title: `${name || "Player"} checked in via ${data.method ?? "qr"}` });
      setQrInput(""); setManualSearch("");
    },
    onError: (e: any) => {
      const msg = e.message ?? "Check-in failed";
      const reason = (e as any).notYetActive
        ? friendlyTimingReason((e as any).windowStart)
        : friendlyDenialReason(msg);
      setCheckInOverlay({ result: "denied", reason });
      toast({ title: "Check-in failed", description: msg, variant: "destructive" });
    },
  });

  const markPayment = useMutation({
    mutationFn: async ({ spotId, status }: { spotId: number; status: string }) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/dropins/spots/${spotId}/payment`, {
        method: "PATCH", headers, body: JSON.stringify({ paymentStatus: status }),
      });
      if (!r.ok) throw new Error("Failed to update payment");
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["checkin-view", id] }); toast({ title: "Payment status updated" }); },
    onError: () => toast({ title: "Error updating payment", variant: "destructive" }),
  });

  const markNoShow = useMutation({
    mutationFn: async ({ spotId, promote }: { spotId: number; promote: boolean }) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/dropins/spots/${spotId}/noshow`, {
        method: "PATCH", headers, body: JSON.stringify({ promote }),
      });
      if (!r.ok) throw new Error("Failed to mark no-show");
      return r.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["checkin-view", id] });
      toast({ title: data.promoted ? "No-show recorded, next player promoted" : "No-show recorded" });
    },
    onError: () => toast({ title: "Error marking no-show", variant: "destructive" }),
  });

  const promoteWaitlisted = useMutation({
    mutationFn: async (spotId: number) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/dropins/spots/${spotId}/promote`, {
        method: "POST", headers,
      });
      if (!r.ok) { const err = await r.json(); throw new Error(err.error ?? "Promotion failed"); }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["checkin-view", id] });
      toast({ title: "Player promoted from waitlist" });
    },
    onError: (e: any) => toast({ title: "Promotion failed", description: e.message, variant: "destructive" }),
  });

  function handleQrKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && qrInput.trim()) {
      checkin.mutate({ qrCode: qrInput.trim(), method: "qr" });
    }
  }

  if (profileLoading) return <Layout><div className="p-12"><Skeleton className="h-96" /></div></Layout>;
  if (profile?.role !== "admin" && profile?.role !== "staff" && profile?.adminLevel !== "super" && profile?.adminLevel !== "admin") return <Redirect to="/dashboard" />;

  const dropin = view?.dropin;

  const CHECKIN_BUFFER_MS = 30 * 60 * 1000;
  const windowStartMs = dropin?.startsAt ? new Date(dropin.startsAt).getTime() - CHECKIN_BUFFER_MS : null;
  const notYetOpen = windowStartMs ? Date.now() < windowStartMs : false;
  const windowOpenAt = windowStartMs ? new Date(windowStartMs) : null;

  return (
    <Layout>
      <div className="container mx-auto px-2 sm:px-4 py-4 max-w-2xl">
        <div className="mb-4">
          <a href="/admin/dropins" className="text-sm text-muted-foreground hover:text-foreground">Drop-ins</a>
          <span className="mx-2 text-muted-foreground">/</span>
          <span className="text-sm font-medium">Check-in</span>
        </div>

        {isLoading ? (
          <div className="space-y-4">{[1,2,3].map(i => <Skeleton key={i} className="h-32" />)}</div>
        ) : !dropin ? (
          <div className="text-center py-16">Session not found</div>
        ) : (
          <>
            <div className="mb-6">
              <h1 className="text-2xl font-bold font-sans uppercase tracking-tight text-primary">{dropin.name}</h1>
              <p className="text-muted-foreground text-sm mt-1">
                {format(new Date(dropin.startsAt), "EEE, MMM d · h:mm a")} · {dropin.durationMinutes} min
              </p>
            </div>

            {notYetOpen && windowOpenAt && (
              <Alert className="mb-4 border-amber-400 bg-amber-50 dark:bg-amber-950/40">
                <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <AlertDescription className="text-amber-800 dark:text-amber-200">
                  Check-in opens at {format(windowOpenAt, "h:mm a")} (30 min before start). Scanning is disabled until then.
                </AlertDescription>
              </Alert>
            )}

            <Card className="mb-4">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <QrCode className="h-4 w-4" /> Scan Player QR Code
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <Input
                    ref={qrRef}
                    placeholder="Scan or type QR code, press Enter"
                    value={qrInput}
                    onChange={e => setQrInput(e.target.value)}
                    onKeyDown={handleQrKey}
                    autoFocus
                    className="font-mono"
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
                  <Button
                    onClick={() => qrInput.trim() && checkin.mutate({ qrCode: qrInput.trim(), method: "qr" })}
                    disabled={notYetOpen || checkin.isPending || !qrInput.trim()}
                  >
                    Check In
                  </Button>
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Search className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Manual search (fallback)</span>
                  </div>
                  <Input
                    placeholder="Search by name or email..."
                    value={manualSearch}
                    onChange={e => setManualSearch(e.target.value)}
                    disabled={notYetOpen}
                  />
                  {allUsers && manualSearch.length >= 2 && (
                    <div className="mt-1 border rounded-md overflow-hidden">
                      {allUsers.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">No results</div>
                      ) : allUsers.map((u: any) => (
                        <button
                          key={u.id}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex justify-between items-center"
                          onClick={() => { checkin.mutate({ userId: u.id, method: "manual" }); setManualSearch(""); }}
                        >
                          <span>{u.firstName} {u.lastName}</span>
                          <span className="text-muted-foreground text-xs">{u.email}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {view?.pools?.map((pw: any) => {
              const pool = pw.pool;
              const spots = pw.spots;
              const active = spots.filter((s: any) => !s.waitlisted);
              const waitlisted = spots.filter((s: any) => s.waitlisted);
              const checkedInCount = active.filter((s: any) => s.checkedIn).length;
              const owingCount = active.filter((s: any) => s.paymentStatus === "unpaid").length;

              return (
                <Card key={pool.id} className="mb-4">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">Court #{pool.courtId} — {(Array.isArray(pool.ageGroup) ? pool.ageGroup.join(", ") : pool.ageGroup ?? "").replace(/_/g, "-").toUpperCase()}</CardTitle>
                      <div className="flex gap-2">
                        <Badge variant="secondary">{pool.spotsTaken}/{pool.cap} spots</Badge>
                        {pool.isClosed && <Badge variant="destructive">Closed</Badge>}
                      </div>
                    </div>
                    <div className="flex gap-4 text-sm text-muted-foreground mt-1">
                      <span className="flex items-center gap-1 text-green-500"><CheckCircle2 className="h-3.5 w-3.5" /> {checkedInCount} checked in</span>
                      {owingCount > 0 && <span className="flex items-center gap-1 text-red-400"><DollarSign className="h-3.5 w-3.5" /> {owingCount} owes</span>}
                      {waitlisted.length > 0 && <span className="text-orange-400">{waitlisted.length} waitlisted</span>}
                    </div>
                  </CardHeader>
                  <CardContent>
                    {active.length === 0 && waitlisted.length === 0 ? (
                      <p className="text-muted-foreground text-sm">No players registered yet.</p>
                    ) : (
                      <>
                        {active.map((spot: any) => (
                          <SpotRow
                            key={spot.id} spot={spot} dropinId={id}
                            checkinLoading={notYetOpen || checkin.isPending}
                            isMember={memberUserIds.has(spot.userId)}
                            onCheckin={(userId, _method, spotId) => checkin.mutate({ userId: userId ?? undefined, spotId, method: "manual" })}
                            onMarkPayment={(spotId, status) => markPayment.mutate({ spotId, status })}
                            onNoShow={(spotId, promote) => markNoShow.mutate({ spotId, promote })}
                            onPromote={(spotId) => promoteWaitlisted.mutate(spotId)}
                            onVoided={() => qc.invalidateQueries({ queryKey: ["checkin-view", id] })}
                          />
                        ))}
                        {waitlisted.length > 0 && (
                          <div className="mt-3">
                            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Waitlist</div>
                            {waitlisted.map((spot: any) => (
                              <SpotRow
                                key={spot.id} spot={spot} dropinId={id}
                                checkinLoading={notYetOpen || checkin.isPending}
                                isMember={memberUserIds.has(spot.userId)}
                                onCheckin={(userId, _method, spotId) => checkin.mutate({ userId: userId ?? undefined, spotId, method: "manual" })}
                                onMarkPayment={(spotId, status) => markPayment.mutate({ spotId, status })}
                                onNoShow={(spotId, promote) => markNoShow.mutate({ spotId, promote })}
                                onPromote={(spotId) => promoteWaitlisted.mutate(spotId)}
                                onVoided={() => qc.invalidateQueries({ queryKey: ["checkin-view", id] })}
                              />
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </>
        )}
      </div>
      <QrScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={(val) => checkin.mutate({ qrCode: val, method: "qr" })}
      />
      <CheckInResultOverlay
        value={checkInOverlay}
        onDismiss={() => { setCheckInOverlay(null); qrRef.current?.focus(); }}
      />
    </Layout>
  );
}
