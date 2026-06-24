import React, { useState, useEffect, useRef } from "react";
import { useRoute, Link } from "wouter";
import { useGetDropin } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Calendar, Users, ChevronLeft, Clock, CheckCircle2, MapPin, Activity, QrCode, CreditCard } from "lucide-react";
import QRCode from "qrcode";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { Show } from "@clerk/react";
import { useAuth } from "@clerk/react";
import { SectionEntry } from "@/components/brand-ui";
import { useWaiverGate } from "@/components/waiver-modal";
import { InlinePaymentDialog } from "@/components/inline-payment-dialog";
import { ParticipantSelector } from "@/components/participant-selector";
import { useGetMyProfile } from "@workspace/api-client-react";

const API = "/api";

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

function useAuthHeaders() {
  const { getToken } = useAuth();
  return async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  };
}

const AGE_GROUP_LABELS: Record<string, string> = {
  u8: "U8", u9: "U9", u10: "U10", u11: "U11",
  u12: "U12", u13: "U13", u14: "U14", u15: "U15",
  u16: "U16", u17: "U17", u18: "U18",
  adult: "Adult",
  u8_u11: "Youth 8-11",
  u12_u15: "Youth 12-15",
  all_ages: "All Ages",
};

function useCountdown(expiresAt: string | null | undefined): string | null {
  const [remaining, setRemaining] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (!expiresAt) { setRemaining(null); return; }
    const target = new Date(expiresAt).getTime();
    const tick = () => setRemaining(Math.max(0, Math.floor((target - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  if (remaining === null) return null;
  if (remaining <= 0) return "Expired";
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

function PaymentStatusBadge({ status, isFree }: { status: string; isFree?: boolean }) {
  const resolvedStatus = isFree && status === "unpaid" ? "confirmed_free" : status;
  const labels: Record<string, string> = {
    confirmed_free: "Confirmed",
    unpaid: "Unpaid",
    payment_pending: "Payment Pending",
    paid_inapp: "Paid",
    paid_external: "Paid (cash)",
    refunded: "Refunded",
    waived: "Waived",
  };
  const colors: Record<string, string> = {
    confirmed_free: "bg-emerald-500/20 text-emerald-400 border-emerald-500/20",
    unpaid: "bg-red-500/20 text-red-400 border-red-500/20",
    payment_pending: "bg-amber-500/20 text-amber-400 border-amber-500/20",
    paid_inapp: "bg-emerald-500/20 text-emerald-400 border-emerald-500/20",
    paid_external: "bg-emerald-500/20 text-emerald-400 border-emerald-500/20",
    refunded: "bg-white/10 text-white/50 border-white/10",
    waived: "bg-white/10 text-white/50 border-white/10",
  };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${colors[resolvedStatus] ?? "bg-white/10 text-white/50 border-white/10"}`}>
      {labels[resolvedStatus] ?? resolvedStatus}
    </span>
  );
}

function SpotQRCode({ spot, dropin }: { spot: any; dropin: any }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const payload = JSON.stringify({ spotId: spot.id, dropinId: dropin.id, sessionName: dropin.name, poolId: spot.poolId });

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, payload, {
        width: 160, margin: 1,
        color: { dark: "#ffffff", light: "#111118" },
      }).catch(() => {});
    }
  }, [payload]);

  return (
    <div className="flex flex-col items-center gap-2 py-3">
      <canvas ref={canvasRef} className="rounded-xl" />
      <p className="text-xs text-white/30">Show this at check-in</p>
      <p className="text-xs text-white/20 font-mono">Spot #{spot.id}</p>
    </div>
  );
}

function computeIsPoolActive(pool: any): boolean {
  if (!pool) return false;
  if (pool.activeOverride === "active") return true;
  if (pool.activeOverride === "closed") return false;
  if (!pool.startsAt) return false;
  const start = new Date(pool.startsAt).getTime();
  const end = start + (Number(pool.durationMinutes) || 120) * 60 * 1000;
  const now = Date.now();
  return now >= start - ACTIVE_BUFFER_MS && now <= end + ACTIVE_BUFFER_MS;
}

// ─── Guest RSVP Form ──────────────────────────────────────────────────────────

function GuestRsvpForm({
  poolId, name, email, onNameChange, onEmailChange, onSuccess, onCancel,
}: {
  poolId: number;
  name: string;
  email: string;
  onNameChange: (v: string) => void;
  onEmailChange: (v: string) => void;
  onSuccess: (result: { spot: any; qrPayload: string; name: string }) => void;
  onCancel: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Please enter your name."); return; }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Please enter a valid email address."); return;
    }
    setSubmitting(true);
    setError("");
    try {
      const r = await fetch(`${API}/dropins/pools/${poolId}/rsvp/guest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      });
      const data = await r.json();
      if (!r.ok) {
        if (r.status === 409) {
          setError("This email is already registered for this pool.");
        } else {
          setError(data.error ?? "Registration failed. Please try again.");
        }
        return;
      }
      onSuccess({ spot: data, qrPayload: data.qrPayload, name: name.trim() });
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-white/70 text-xs">Your name</Label>
        <Input
          value={name}
          onChange={(e) => { onNameChange(e.target.value); setError(""); }}
          placeholder="First and last name"
          className="bg-white/5 border-white/10 text-white placeholder:text-white/30 h-11"
          disabled={submitting}
          autoComplete="name"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-white/70 text-xs">Email address</Label>
        <Input
          type="email"
          value={email}
          onChange={(e) => { onEmailChange(e.target.value); setError(""); }}
          placeholder="you@example.com"
          className="bg-white/5 border-white/10 text-white placeholder:text-white/30 h-11"
          disabled={submitting}
          autoComplete="email"
        />
        <p className="text-white/30 text-[11px]">We'll send your confirmation + QR code here.</p>
      </div>
      {error && (
        <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
      )}
      <div className="flex gap-2 pt-1">
        <Button type="button" variant="ghost" className="flex-1 border border-white/10 text-white/50 hover:text-white hover:bg-white/5" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" className="flex-1 bg-[#dc2626] hover:bg-[#b91c1c] border-none text-white font-semibold" disabled={submitting}>
          {submitting ? "Registering…" : "I'm In!"}
        </Button>
      </div>
    </form>
  );
}

// ─── Guest Spot QR Code ───────────────────────────────────────────────────────

function GuestSpotQRCode({ qrPayload, spot }: { qrPayload: string; spot: any }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, qrPayload, {
        width: 160, margin: 1,
        color: { dark: "#ffffff", light: "#111118" },
      }).catch(() => {});
    }
  }, [qrPayload]);
  return (
    <div className="flex flex-col items-center gap-2 py-3">
      <canvas ref={canvasRef} className="rounded-xl" />
      <p className="text-xs text-white/30">Show this at check-in</p>
      <p className="text-xs text-white/20 font-mono">Spot #{spot?.id}</p>
    </div>
  );
}

function CourtPoolCard({ pool, dropinId, dropin, sessionStatus }: { pool: any; dropinId: number; dropin: any; sessionStatus: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const getHeaders = useAuthHeaders();
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [showQr, setShowQr] = useState(false);
  const { ensureProfile, WaiverModalElement } = useWaiverGate();
  const [paymentData, setPaymentData] = useState<{ clientSecret: string; publishableKey: string; amount: number; basePrice: number; serviceFeeAmount: number } | null>(null);
  const [showSelector, setShowSelector] = useState(false);
  const [selectedParticipant, setSelectedParticipant] = useState<{ id: number; firstName: string; lastName: string; isChild?: boolean } | null>(null);
  const { data: profile } = useGetMyProfile();

  // Guest RSVP state
  const [guestSheetOpen, setGuestSheetOpen] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestResult, setGuestResult] = useState<{ spot: any; qrPayload: string; name: string } | null>(null);

  const ageGroupArr: string[] = Array.isArray(pool.ageGroup) ? pool.ageGroup : pool.ageGroup ? [pool.ageGroup] : ["adult"];
  const isPoolYouth = ageGroupArr.some(ag => ag !== "adult" && ag !== "all_ages");
  // Pool-level price — fall back to session price if pool hasn't been migrated yet
  const poolPrice = Number(pool.price ?? dropin?.price ?? 0);
  const isSimplified = !!(pool.simplifiedRegistration) && poolPrice === 0;

  const { data: mySpots } = useQuery({
    queryKey: ["my-spot", dropinId, pool.id],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/dropins/${dropinId}/my-spots`, { headers });
      if (!r.ok) return [];
      const spots: any[] = await r.json();
      return spots.filter((s: any) => s.poolId === pool.id);
    },
  });

  const rsvp = useMutation({
    mutationFn: async (playerUserId?: number) => {
      const headers = await getHeaders();
      const body = playerUserId ? JSON.stringify({ playerUserId }) : undefined;
      const r = await fetch(`${API}/dropins/pools/${pool.id}/rsvp`, { method: "POST", headers, body });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: "Registration failed" }));
        const e: any = new Error(err.error ?? "Registration failed");
        e.status = r.status;
        throw e;
      }
      return r.json();
    },
    onSuccess: (spot) => {
      qc.invalidateQueries({ queryKey: ["my-spot", dropinId, pool.id] });
      qc.invalidateQueries({ queryKey: ["dropin-pools", dropinId] });
      toast({
        title: spot.waitlisted ? `Added to waitlist at position #${spot.waitlistPosition}` : "Spot reserved!",
        description: spot.waitlisted ? "You will be notified if a spot opens up." : "You are registered for this session.",
      });
    },
    onError: (e: any) => {
      if (e.status === 409) {
        toast({ title: "Already registered", description: "You already have an active spot for this session. View it on your dashboard.", variant: "default" });
      } else {
        toast({ title: "Registration failed", description: e.message, variant: "destructive" });
      }
    },
  });

  const checkout = useMutation({
    mutationFn: async (playerUserId?: number) => {
      const headers = await getHeaders();
      const body = playerUserId ? JSON.stringify({ playerUserId }) : undefined;
      const r = await fetch(`${API}/dropins/pools/${pool.id}/checkout`, { method: "POST", headers, body });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: "Checkout failed" }));
        const e: any = new Error(err.error ?? "Checkout failed");
        e.status = r.status;
        throw e;
      }
      return r.json();
    },
    onSuccess: (data) => {
      if (data.clientSecret) {
        setPaymentData({
          clientSecret: data.clientSecret,
          publishableKey: data.publishableKey,
          amount: data.amount,
          basePrice: data.basePrice ?? data.amount,
          serviceFeeAmount: data.serviceFeeAmount ?? 0,
        });
      }
    },
    onError: (e: any) => {
      if (e.status === 409) {
        toast({ title: "Already registered", description: "You already have an active spot for this session. View it on your dashboard.", variant: "default" });
      } else {
        toast({ title: "Checkout failed", description: e.message, variant: "destructive" });
      }
    },
  });

  function handlePaymentSuccess() {
    setPaymentData(null);
    qc.invalidateQueries({ queryKey: ["my-spot", dropinId, pool.id] });
    qc.invalidateQueries({ queryKey: ["dropin-pools", dropinId] });
    const isMobile = localStorage.getItem("playon_mobile_return") === "1";
    if (isMobile) {
      localStorage.removeItem("playon_mobile_return");
      setTimeout(() => { window.location.href = "playon-mobile://checkout-complete?status=success"; }, 800);
    } else {
      toast({ title: "Payment confirmed!", description: "Your spot is reserved." });
    }
  }

  const cancel = useMutation({
    mutationFn: async (spotId: number) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/dropins/spots/${spotId}`, { method: "DELETE", headers });
      if (!r.ok) { const err = await r.json(); throw new Error(err.error ?? "Cancellation failed"); }
      return r.json();
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["my-spot", dropinId, pool.id] });
      qc.invalidateQueries({ queryKey: ["dropin-pools", dropinId] });
      const refundAmount = data?.refundOutcome?.refundAmount;
      if (refundAmount > 0) {
        toast({
          title: "Spot cancelled",
          description: `A refund of $${Number(refundAmount).toFixed(2)} will appear on your card in 5–10 business days.`,
        });
      } else {
        toast({ title: "Spot cancelled" });
      }
      setCancellingId(null);
    },
    onError: (e: any) => { toast({ title: "Cancellation failed", description: e.message, variant: "destructive" }); setCancellingId(null); },
  });

  const joinWaitlist = useMutation({
    mutationFn: async (playerUserId?: number) => {
      const headers = await getHeaders();
      const body = playerUserId ? JSON.stringify({ playerUserId }) : undefined;
      const r = await fetch(`${API}/dropins/pools/${pool.id}/waitlist`, { method: "POST", headers, body });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: "Waitlist join failed" }));
        const e: any = new Error(err.error ?? "Waitlist join failed");
        e.status = r.status;
        throw e;
      }
      return r.json();
    },
    onSuccess: (spot) => {
      qc.invalidateQueries({ queryKey: ["my-spot", dropinId, pool.id] });
      qc.invalidateQueries({ queryKey: ["dropin-pools", dropinId] });
      toast({
        title: `Added to waitlist at position #${spot.waitlistPosition}`,
        description: "You'll be notified when a spot opens up and have a time window to pay.",
      });
    },
    onError: (e: any) => {
      if (e.status === 409) {
        toast({ title: "Already on waitlist", description: "You already have a spot or are on the waitlist for this session.", variant: "default" });
      } else {
        toast({ title: "Waitlist join failed", description: e.message, variant: "destructive" });
      }
    },
  });

  const retryPayment = useMutation({
    mutationFn: async (spotId: number) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/dropins/spots/${spotId}/pay`, { method: "POST", headers });
      if (r.status === 409) {
        const err = await r.json();
        if (err.error === "already_paid") {
          return { alreadyPaid: true, message: err.message };
        }
        throw new Error(err.error ?? "Payment failed");
      }
      if (!r.ok) { const err = await r.json(); throw new Error(err.error ?? "Payment failed"); }
      return r.json();
    },
    onSuccess: (data) => {
      if ((data as any).alreadyPaid) {
        toast({ title: "Payment already received", description: (data as any).message ?? "Your spot is confirmed!" });
        qc.invalidateQueries({ queryKey: ["my-spot"] });
        return;
      }
      if (data.clientSecret) {
        setPaymentData({
          clientSecret: data.clientSecret,
          publishableKey: data.publishableKey,
          amount: data.amount,
          basePrice: data.basePrice ?? data.amount,
          serviceFeeAmount: data.serviceFeeAmount ?? 0,
        });
      }
    },
    onError: (e: any) => toast({ title: "Payment failed", description: e.message, variant: "destructive" }),
  });

  const myActiveSpot = mySpots?.find((s: any) => s.status === "reserved");
  const countdown = useCountdown((myActiveSpot as any)?.expiresAt);
  const isFull = pool.spotsTaken >= pool.cap;
  // isPoolCurrentlyActive is used for check-in only — not for registration eligibility
  const isPoolCurrentlyActive = computeIsPoolActive(pool) || computeIsEventActive(dropin);
  const canRsvp = pool.registrationOpen && sessionStatus !== "completed" && sessionStatus !== "cancelled" && !pool.isClosed && !myActiveSpot;

  return (
    <div className="rounded-2xl border border-white/10 bg-[#111118] overflow-hidden">
      <div className="bg-white/5 border-b border-white/10 px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-white font-bold">
              Court #{pool.courtId} — {ageGroupArr.map(ag => AGE_GROUP_LABELS[ag] ?? ag).join(", ")}
              {pool.skillLevel !== "all" && <span className="ml-2 text-sm font-normal text-white/40 capitalize">({pool.skillLevel})</span>}
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm mt-1">
              <div className="flex items-center gap-1.5 text-white/40">
                <Users className="h-4 w-4" />
                <span className={isFull ? "text-orange-400 font-medium" : ""}>{pool.spotsTaken} / {pool.cap} spots</span>
              </div>
              {pool.waitlistCount > 0 && (
                <span className="text-orange-400 text-xs">{pool.waitlistCount} on waitlist</span>
              )}
              {pool.startsAt && (
                <span className="text-white/40 text-xs flex items-center gap-1">
                  <Calendar className="h-3 w-3" />{format(new Date(pool.startsAt), "EEE MMM d · h:mm a")} · {pool.durationMinutes} min
                </span>
              )}
              <span className="text-[#4ade80] text-xs font-semibold">
                {poolPrice > 0 ? `$${poolPrice.toFixed(2)}` : "Free"}
              </span>
            </div>
          </div>
          {pool.isClosed && <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-red-500/20 text-red-400 border border-red-500/20">Closed</span>}
        </div>
      </div>

      <div className="p-5 space-y-3">
        {myActiveSpot && (
          <div className={`rounded-xl p-3 ${
            myActiveSpot.waitlisted && myActiveSpot.offerSentAt
              ? "bg-amber-500/10 border border-amber-500/30"
              : myActiveSpot.waitlisted
              ? "bg-orange-500/10 border border-orange-500/20"
              : "bg-emerald-500/10 border border-emerald-500/20"
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className={`h-4 w-4 ${
                  myActiveSpot.waitlisted && myActiveSpot.offerSentAt
                    ? "text-amber-400"
                    : myActiveSpot.waitlisted
                    ? "text-orange-400"
                    : "text-emerald-400"
                }`} />
                <span className="text-sm font-semibold text-white">
                  {myActiveSpot.waitlisted && myActiveSpot.offerSentAt
                    ? "Spot available — payment required!"
                    : myActiveSpot.waitlisted
                    ? `Waitlisted — position #${myActiveSpot.waitlistPosition}`
                    : "Spot reserved!"}
                </span>
              </div>
              <PaymentStatusBadge status={myActiveSpot.paymentStatus} isFree={poolPrice === 0} />
            </div>

            {/* Waitlist offer banner: player has a time-limited spot offer to pay for */}
            {myActiveSpot.waitlisted && myActiveSpot.offerSentAt && (
              <div className="mt-2 rounded-lg bg-amber-500/15 border border-amber-500/30 px-3 py-2.5 space-y-2">
                <div className="flex items-start gap-2">
                  <Clock className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-300 font-medium leading-tight">
                    {(() => {
                      const offerCountdown = myActiveSpot.offerExpiresAt
                        ? Math.max(0, Math.floor((new Date(myActiveSpot.offerExpiresAt).getTime() - Date.now()) / 60000))
                        : null;
                      if (offerCountdown === null) return "A spot is waiting — pay now to secure it.";
                      if (offerCountdown <= 0) return "Your offer window has expired.";
                      const h = Math.floor(offerCountdown / 60);
                      const m = offerCountdown % 60;
                      return h > 0
                        ? `Pay within ${h}h ${m}m to secure this spot.`
                        : `Pay within ${m} minutes to secure this spot.`;
                    })()}
                  </p>
                </div>
                {poolPrice > 0 && (
                  <Button
                    size="sm"
                    className="w-full bg-amber-500 hover:bg-amber-600 border-none text-black font-semibold text-xs h-8"
                    onClick={() => ensureProfile(() => retryPayment.mutate(myActiveSpot.id))}
                    disabled={retryPayment.isPending}
                  >
                    <CreditCard className="h-3.5 w-3.5 mr-1.5" />
                    {retryPayment.isPending ? "Loading…" : `Complete Payment — $${poolPrice.toFixed(2)}`}
                  </Button>
                )}
              </div>
            )}

            {/* Expiry countdown for payment_pending spots */}
            {!myActiveSpot.waitlisted && myActiveSpot.paymentStatus === "payment_pending" && (
              <div className="mt-2 rounded-lg bg-amber-500/15 border border-amber-500/30 px-3 py-2.5 space-y-2">
                <div className="flex items-start gap-2">
                  <Clock className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-300 font-medium leading-tight">
                    {countdown && countdown !== "Expired"
                      ? `This spot will be released if payment isn't completed in ${countdown}.`
                      : countdown === "Expired"
                      ? "Payment window expired — this spot will be released shortly."
                      : "Complete payment to secure this spot (15-minute window)."}
                  </p>
                </div>
                {poolPrice > 0 && (
                  <Button
                    size="sm"
                    className="w-full bg-amber-500 hover:bg-amber-600 border-none text-black font-semibold text-xs h-8"
                    onClick={() => ensureProfile(() => retryPayment.mutate(myActiveSpot.id))}
                    disabled={retryPayment.isPending}
                  >
                    <CreditCard className="h-3.5 w-3.5 mr-1.5" />
                    {retryPayment.isPending ? "Loading…" : `Complete Payment — $${poolPrice.toFixed(2)}`}
                  </Button>
                )}
              </div>
            )}

            {/* QR Code and pay buttons for confirmed/paid spots */}
            {!myActiveSpot.waitlisted && myActiveSpot.paymentStatus !== "payment_pending" && (
              <>
                {showQr ? (
                  <SpotQRCode spot={myActiveSpot} dropin={dropin} />
                ) : (
                  <Button size="sm" variant="ghost" className="mt-2 w-full text-white/40 hover:text-white text-xs h-7 border border-white/10 hover:bg-white/5"
                    onClick={() => setShowQr(true)}>
                    <QrCode className="h-3.5 w-3.5 mr-1.5" /> Show Check-in QR Code
                  </Button>
                )}

                {/* Pay Now button for spots with unpaid status (e.g. cash/external) */}
                {poolPrice > 0 && myActiveSpot.paymentStatus === "unpaid" && (
                  <Button
                    size="sm"
                    className="mt-2 w-full bg-amber-500 hover:bg-amber-600 border-none text-black font-semibold text-xs h-8"
                    onClick={() => ensureProfile(() => checkout.mutate(undefined))}
                    disabled={checkout.isPending}
                  >
                    <CreditCard className="h-3.5 w-3.5 mr-1.5" />
                    {checkout.isPending ? "Loading…" : `Pay Now — $${poolPrice.toFixed(2)}`}
                  </Button>
                )}
              </>
            )}

            {cancellingId === myActiveSpot.id ? (
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="destructive" onClick={() => cancel.mutate(myActiveSpot.id)} disabled={cancel.isPending}>
                  {cancel.isPending ? "Cancelling..." : "Confirm cancel"}
                </Button>
                <Button size="sm" variant="outline" className="border-white/20 text-white hover:bg-white/10" onClick={() => setCancellingId(null)}>Keep spot</Button>
              </div>
            ) : (
              <Button size="sm" variant="ghost" className="mt-1 text-white/30 text-xs h-7 hover:text-white" onClick={() => setCancellingId(myActiveSpot.id)}>
                Cancel registration
              </Button>
            )}
          </div>
        )}

        <Show when="signed-in">
          {canRsvp && !showSelector && (
            <Button
              className={`w-full ${isFull ? "bg-orange-500/20 border border-orange-500/30 text-orange-400 hover:bg-orange-500/30" : "bg-[#dc2626] hover:bg-[#b91c1c] border-none text-white"}`}
              onClick={() => {
                if (isPoolYouth) {
                  setShowSelector(true);
                } else {
                  ensureProfile(() => (poolPrice > 0 && !isFull) ? checkout.mutate(undefined) : (poolPrice > 0 && isFull) ? joinWaitlist.mutate(undefined) : rsvp.mutate(undefined));
                }
              }}
              disabled={rsvp.isPending || checkout.isPending}
            >
              {rsvp.isPending || checkout.isPending
                ? "Processing…"
                : isFull
                ? "Join Waitlist"
                : poolPrice > 0
                ? `Save My Spot — $${poolPrice.toFixed(2)}`
                : "Save My Spot — Free"}
            </Button>
          )}
          {canRsvp && showSelector && (
            <div className="space-y-3 pt-1">
              <p className="text-sm font-semibold text-white">Who is this spot for?</p>
              <ParticipantSelector
                ageGroups={ageGroupArr}
                eventStartDate={pool.startsAt ? new Date(pool.startsAt).toISOString().split("T")[0] : (dropin?.startsAt ? new Date(dropin.startsAt).toISOString().split("T")[0] : null)}
                value={selectedParticipant ? { id: selectedParticipant.id, firstName: selectedParticipant.firstName, lastName: selectedParticipant.lastName, isChild: selectedParticipant.isChild ?? true } : null}
                onChange={(p) => setSelectedParticipant(p ? { id: p.id, firstName: p.firstName, lastName: p.lastName, isChild: p.isChild } : null)}
                currentUserId={(profile as any)?.id ?? null}
                currentUserProfile={(profile as any)?.id ? { id: (profile as any).id, firstName: (profile as any).firstName ?? "", lastName: (profile as any).lastName ?? "" } : null}
                enabled={showSelector}
              />
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 border-white/20 text-white hover:bg-white/10"
                  onClick={() => { setShowSelector(false); setSelectedParticipant(null); }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className={`flex-1 ${isFull ? "bg-orange-500/20 border border-orange-500/30 text-orange-400" : "bg-[#dc2626] hover:bg-[#b91c1c] border-none text-white"}`}
                  disabled={!selectedParticipant || rsvp.isPending || checkout.isPending}
                  onClick={() => {
                    if (!selectedParticipant) return;
                    setShowSelector(false);
                    const childId = selectedParticipant.isChild !== false ? selectedParticipant.id : undefined;
                    ensureProfile(() =>
                      (poolPrice > 0 && !isFull)
                        ? checkout.mutate(childId)
                        : (poolPrice > 0 && isFull)
                        ? joinWaitlist.mutate(childId)
                        : rsvp.mutate(childId)
                    );
                  }}
                >
                  {rsvp.isPending || checkout.isPending
                    ? "Processing…"
                    : isFull
                    ? "Join Waitlist"
                    : poolPrice > 0
                    ? `Pay — $${poolPrice.toFixed(2)}`
                    : "Confirm"}
                </Button>
              </div>
            </div>
          )}
          {!canRsvp && !myActiveSpot && pool.isClosed && (
            <p className="text-center text-sm text-white/30">This pool is closed.</p>
          )}
          {!canRsvp && !myActiveSpot && !pool.isClosed && !pool.registrationOpen && (
            <p className="text-center text-sm text-white/30">Registration is not open for this pool.</p>
          )}
          {!canRsvp && !myActiveSpot && !pool.isClosed && pool.registrationOpen && (sessionStatus === "completed" || sessionStatus === "cancelled") && (
            <p className="text-center text-sm text-white/30">This session has ended.</p>
          )}
        </Show>

        <Show when="signed-out">
          {isSimplified && canRsvp && !isFull ? (
            <Button
              className="w-full bg-[#dc2626] hover:bg-[#b91c1c] border-none text-white"
              onClick={() => setGuestSheetOpen(true)}
            >
              I'm In — Register as Guest
            </Button>
          ) : (
            <Button className="w-full bg-[#dc2626] hover:bg-[#b91c1c] border-none" asChild>
              <Link href="/sign-in">Sign in to Register</Link>
            </Button>
          )}
        </Show>
        {WaiverModalElement}

        {/* Guest RSVP Dialog */}
        <Dialog open={guestSheetOpen} onOpenChange={(v) => { if (!v) { setGuestSheetOpen(false); setGuestResult(null); setGuestName(""); setGuestEmail(""); } }}>
          <DialogContent className="bg-[#111118] border border-white/10 text-white max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-white text-lg font-bold">
                {guestResult ? "See you there! 🎉" : "Register as Guest"}
              </DialogTitle>
              {!guestResult && (
                <DialogDescription className="text-white/50 text-sm">
                  No account needed. Enter your name and email to reserve your free spot.
                </DialogDescription>
              )}
            </DialogHeader>

            {guestResult ? (
              <div className="space-y-4 text-center">
                <div className="flex flex-col items-center gap-1">
                  <p className="text-white/60 text-sm">Welcome, <span className="text-white font-semibold">{guestResult.name}</span>!</p>
                  <p className="text-white/40 text-xs">Your spot is confirmed. Check your email for a copy.</p>
                </div>
                <GuestSpotQRCode qrPayload={guestResult.qrPayload} spot={guestResult.spot} />
                <p className="text-white/30 text-xs">Show this QR code at check-in</p>
                <Button className="w-full bg-emerald-600 hover:bg-emerald-700 border-none text-white" onClick={() => { setGuestSheetOpen(false); setGuestResult(null); }}>
                  Done
                </Button>
              </div>
            ) : (
              <GuestRsvpForm
                poolId={pool.id}
                name={guestName}
                email={guestEmail}
                onNameChange={setGuestName}
                onEmailChange={setGuestEmail}
                onSuccess={(result) => setGuestResult(result)}
                onCancel={() => setGuestSheetOpen(false)}
              />
            )}
          </DialogContent>
        </Dialog>
        {paymentData && (
          <InlinePaymentDialog
            open={!!paymentData}
            clientSecret={paymentData.clientSecret}
            publishableKey={paymentData.publishableKey}
            amount={paymentData.amount}
            basePrice={paymentData.basePrice}
            serviceFeeAmount={paymentData.serviceFeeAmount}
            title="Reserve Your Spot"
            label={`Pay ${paymentData.amount.toLocaleString("en-US", { style: "currency", currency: "USD" })}`}
            onSuccess={handlePaymentSuccess}
            onCancel={() => setPaymentData(null)}
          />
        )}
      </div>
    </div>
  );
}

export default function DropinDetail() {
  const [, params] = useRoute("/dropins/:id");
  const id = Number(params?.id);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("mobile_return") === "1") {
      localStorage.setItem("playon_mobile_return", "1");
    }
  }, []);

  const { data: dropin, isLoading: dropinLoading } = useGetDropin(id);

  const { data: pools, isLoading: poolsLoading } = useQuery({
    queryKey: ["dropin-pools", id],
    queryFn: async () => {
      const r = await fetch(`${API}/dropins/${id}/pools`);
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!id,
  });

  if (dropinLoading) {
    return (
      <Layout>
        <div className="bg-[#050508] min-h-screen">
          <Skeleton className="h-64 w-full bg-white/10" />
          <div className="container mx-auto px-4 py-8">
            <Skeleton className="h-96 w-full bg-white/5 rounded-2xl" />
          </div>
        </div>
      </Layout>
    );
  }

  if (!dropin) {
    return (
      <Layout>
        <div className="bg-[#050508] min-h-screen flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-white mb-4">Drop-in session not found</h1>
            <Button asChild className="bg-[#dc2626] hover:bg-[#b91c1c]"><Link href="/dropins">Back to Drop-ins</Link></Button>
          </div>
        </div>
      </Layout>
    );
  }

  const hasPools = pools && pools.length > 0;

  // Header time/price: compute range across all pools
  const sortedPoolsByTime = (pools ?? []).filter((p: any) => p.startsAt).sort((a: any, b: any) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  const earliestPool = sortedPoolsByTime[0];
  const latestPool = sortedPoolsByTime[sortedPoolsByTime.length - 1];
  const displayStartsAt: Date | null = earliestPool?.startsAt ? new Date(earliestPool.startsAt) : (dropin.startsAt ? new Date(dropin.startsAt) : null);
  const displayLatestStartsAt: Date | null = latestPool?.startsAt ? new Date(latestPool.startsAt) : null;
  const hasPoolTimeRange = displayStartsAt && displayLatestStartsAt && displayLatestStartsAt.getTime() - displayStartsAt.getTime() > 30 * 60 * 1000;
  const displayDuration: number = earliestPool?.durationMinutes ?? (dropin as any).durationMinutes ?? 120;
  const poolPrices = (pools ?? []).map((p: any) => Number(p.price ?? 0));
  const minPrice = poolPrices.length ? Math.min(...poolPrices) : 0;
  const maxPrice = poolPrices.length ? Math.max(...poolPrices) : 0;
  const headerPriceLabel = poolPrices.length === 0 ? "Free"
    : minPrice === 0 && maxPrice === 0 ? "Free"
    : minPrice === maxPrice ? `$${minPrice.toFixed(2)}`
    : `$${minPrice.toFixed(2)}–$${maxPrice.toFixed(2)}`;

  const spotsTaken = (dropin as any).spotsTaken ?? 0;
  const spotsTotal = (dropin as any).spotsTotal ?? (dropin as any).maxPlayers ?? 0;
  const dropinDisplayStatus = spotsTaken >= spotsTotal && spotsTotal > 0
    ? "Full"
    : dropin.status === "upcoming"
    ? "Open"
    : "Upcoming";
  const dropinStatusStyles: Record<string, string> = {
    Open: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    Full: "bg-red-500/20 text-red-400 border-red-500/30",
    Upcoming: "bg-white/10 text-white/60 border-white/20",
  };

  return (
    <Layout>
      <div className="dark bg-[#050508] text-white min-h-screen">
        {/* Compact header */}
        <div className="bg-gradient-to-b from-[#050f08] to-[#050508] border-b border-white/10 pt-6 pb-7">
          <div className="container mx-auto px-4">
            <Button variant="ghost" size="sm" className="mb-4 text-white/50 hover:text-white -ml-2 h-8" asChild>
              <Link href="/dropins"><ChevronLeft className="mr-1 h-4 w-4" /> All Drop-ins</Link>
            </Button>
            <div className="flex flex-wrap gap-1.5 mb-3 items-center">
              <span className="inline-flex items-center bg-[#166534]/80 text-[#4ade80] text-xs font-bold px-2.5 py-1 rounded-full border border-[#4ade80]/30">
                Drop-in
              </span>
              <span className={`inline-flex items-center text-xs font-bold px-2.5 py-1 rounded-full border ${dropinStatusStyles[dropinDisplayStatus]}`}>
                {dropinDisplayStatus}
              </span>
            </div>
            <h1 className="text-2xl md:text-4xl font-black text-white uppercase tracking-tight mb-3">{dropin.name}</h1>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-white/50">
              {displayStartsAt && (
                <>
                  <span className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-[#4ade80]" />
                    {format(displayStartsAt, "EEEE, MMMM d, yyyy")}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-[#4ade80]" />
                    {hasPoolTimeRange
                      ? `${format(displayStartsAt!, "h:mm a")}–${format(displayLatestStartsAt!, "h:mm a")}`
                      : `${format(displayStartsAt, "h:mm a")} · ${displayDuration} min`}
                  </span>
                </>
              )}
              <span className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-[#4ade80]" />
                Alumni Center · Lexington, KY
              </span>
              <span className="font-semibold text-[#4ade80]">
                {headerPriceLabel}
              </span>
            </div>
          </div>
        </div>

        {/* Content — full width, pools first */}
        <div className="bg-[#0a0a10] py-10">
          <div className="container mx-auto px-4 max-w-3xl space-y-8">
            {/* Court pools — primary action, always first */}
            {hasPools && (
              <SectionEntry direction="left">
                <h2 className="text-lg font-black uppercase tracking-tight text-white mb-1">Court Pools</h2>
                <p className="text-white/40 text-sm mb-4">
                  Each court has its own capacity. Register for the pool that matches your age group.
                </p>
                {poolsLoading ? (
                  <div className="space-y-4">{[1,2].map(i => <Skeleton key={i} className="h-40 bg-white/5 rounded-2xl" />)}</div>
                ) : (
                  <div className="space-y-4">
                    {pools.map((pool: any) => (
                      <CourtPoolCard key={pool.id} pool={pool} dropinId={id} dropin={dropin} sessionStatus={dropin.status} />
                    ))}
                  </div>
                )}
              </SectionEntry>
            )}

            {!hasPools && (
              <SectionEntry direction="left">
                <Show when="signed-out">
                  <Button className="w-full h-12 text-base font-semibold bg-[#dc2626] hover:bg-[#b91c1c] border-none" asChild>
                    <Link href="/sign-in">Sign in to Register</Link>
                  </Button>
                </Show>
                <Show when="signed-in">
                  <p className="text-sm text-center text-white/30 py-8">
                    {dropin.status !== "upcoming" ? "This session has already started or ended." : "No court pools configured yet."}
                  </p>
                </Show>
              </SectionEntry>
            )}

            {dropin.description && (
              <SectionEntry direction="left">
                <h2 className="text-lg font-black uppercase tracking-tight text-white mb-3">About This Session</h2>
                <p className="text-white/50 leading-relaxed">{dropin.description}</p>
              </SectionEntry>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
