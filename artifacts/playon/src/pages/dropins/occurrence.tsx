/**
 * Player-facing detail page for a new-style template occurrence.
 * Route: /dropins/occ/:templateId/:date
 */

import React, { useState, useCallback, useEffect } from "react";
import { useRoute, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { Show } from "@clerk/react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Calendar, Users, ChevronLeft, Clock, CheckCircle2, MapPin, Activity, CreditCard, X, AlertTriangle,
} from "lucide-react";
import { format } from "date-fns";
import { formatEastern } from "@/lib/timezone";
import { useToast } from "@/hooks/use-toast";
import { useGetMyProfile } from "@workspace/api-client-react";
import { AGE_GROUPS } from "@workspace/brand";
import { InlinePaymentDialog } from "@/components/inline-payment-dialog";
import { ParticipantSelector } from "@/components/participant-selector";
import { useWaiverGate } from "@/components/waiver-modal";

import { API_BASE as API } from "@/lib/api-base";

function useCountdown(expiresAt: string | null | undefined): string | null {
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
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

function useAuthHeaders() {
  const { getToken } = useAuth();
  return useCallback(async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  }, [getToken]);
}

function useAuthedFetch() {
  const { getToken } = useAuth();
  return useCallback(async (url: string) => {
    const token = await getToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error("Failed");
    return r.json();
  }, [getToken]);
}

const SPORT_EMOJIS: Record<string, string> = {
  basketball: "🏀", soccer: "⚽", futsal: "⚽", volleyball: "🏐", tennis: "🎾",
  pickleball: "🏓", badminton: "🏸", hockey: "🏒", other: "🏃",
};

function FillBar({ taken, cap }: { taken: number; cap: number }) {
  const pct = cap > 0 ? Math.min(100, Math.round((taken / cap) * 100)) : 0;
  const color = pct >= 100 ? "bg-red-500" : pct >= 75 ? "bg-orange-400" : pct >= 50 ? "bg-yellow-400" : "bg-emerald-500";
  return (
    <div className="flex items-center gap-2 text-sm">
      <div className="h-2 w-32 rounded-full bg-white/10 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={pct >= 100 ? "text-red-400 font-medium" : "text-white/60"}>
        {taken}/{cap} {pct >= 100 ? "(full)" : "spots"}
      </span>
    </div>
  );
}

function PoolCard({ pool, templateId, date, sessionStartsAt, onRegistered }: {
  pool: any;
  templateId: number;
  date: string;
  sessionStartsAt: Date | null;
  onRegistered: () => void;
}) {
  const getHeaders = useAuthHeaders();
  const { toast } = useToast();
  const { data: profile } = useGetMyProfile();
  const qc = useQueryClient();
  const { ensureProfile, WaiverModalElement } = useWaiverGate();

  // Server-provided mySpot (set after registration, from query invalidation)
  const mySpot = pool.mySpot ?? null;

  const [paymentData, setPaymentData] = useState<{
    clientSecret: string; publishableKey: string; amount: number; basePrice: number; serviceFeeAmount: number;
  } | null>(null);
  const [showSelector, setShowSelector] = useState(false);
  const [selectedParticipant, setSelectedParticipant] = useState<{
    id: number; firstName: string; lastName: string; isChild?: boolean;
  } | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [useCredits, setUseCredits] = useState(false);
  const [discountCode, setDiscountCode] = useState("");
  const [showPromoInput, setShowPromoInput] = useState(false);

  const price = Number(pool.price ?? 0);
  const isFull = (pool.spotsTaken ?? 0) >= pool.cap;
  const isOpen = pool.registrationOpen !== false;
  const ageLabel = (pool.ageGroup ?? ["adult"]).map((ag: string) => AGE_GROUPS.find(a => a.value === ag)?.label ?? ag).join(", ");

  const poolStartsAt = pool.effectiveStartsAt ? new Date(pool.effectiveStartsAt) : null;
  const poolEndsAt = poolStartsAt && pool.effectiveDurationMinutes
    ? new Date(poolStartsAt.getTime() + Number(pool.effectiveDurationMinutes) * 60 * 1000)
    : null;
  const hasCustomTime = poolStartsAt && sessionStartsAt
    && poolStartsAt.getTime() !== sessionStartsAt.getTime();

  const earlyBird = pool.earlyBirdPricing;
  const earlyBirdActive = (() => {
    if (!earlyBird) return false;
    if (earlyBird.triggerType === "date" && earlyBird.triggerDate) {
      return new Date() <= new Date(earlyBird.triggerDate + "T23:59:59Z");
    }
    if (earlyBird.triggerType === "spots_taken" && earlyBird.triggerSpotsCount != null) {
      const remaining = pool.cap - (pool.spotsTaken ?? 0);
      return remaining >= Number(earlyBird.triggerSpotsCount);
    }
    return false;
  })();
  const effectivePrice = earlyBirdActive ? Number(earlyBird.price) : price;

  const doRsvp = useMutation({
    mutationFn: async (opts: { participantUserId?: number; useCreditsVal?: boolean; discountCodeVal?: string } = {}) => {
      const headers = await getHeaders();
      const body: Record<string, any> = {};
      if (opts.participantUserId) body.participantUserId = opts.participantUserId;
      if (opts.useCreditsVal) body.useCredits = true;
      if (opts.discountCodeVal) body.discountCode = opts.discountCodeVal;
      const r = await fetch(`${API}/dropin-occurrences/${templateId}/${date}/pools/${pool.id}/rsvp`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Registration failed"); }
      return r.json();
    },
    onSuccess: (data) => {
      if (data.paid && data.clientSecret) {
        setPaymentData({
          clientSecret: data.clientSecret,
          publishableKey: data.publishableKey,
          amount: data.amount,
          basePrice: data.basePrice,
          serviceFeeAmount: data.serviceFeeAmount,
        });
        return;
      }
      onRegistered();
      toast({ title: "Registered!", description: "You're in. See you on the court." });
    },
    onError: (e: any) => toast({ title: "Registration failed", description: e.message, variant: "destructive" }),
  });

  const doCancel = useMutation({
    mutationFn: async () => {
      if (!mySpot?.id) throw new Error("No active spot to cancel");
      const headers = await getHeaders();
      const r = await fetch(`${API}/dropins/spots/${mySpot.id}`, { method: "DELETE", headers });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        // Treat "already cancelled" as success — spot is gone, which is what the user wants
        if (e.error === "Spot already cancelled") return;
        throw new Error(e.error ?? "Cancellation failed");
      }
    },
    onSuccess: () => {
      setCancelConfirm(false);
      onRegistered();
      toast({ title: "Cancelled", description: "Your spot has been released." });
    },
    onError: (e: any) => {
      setCancelConfirm(false);
      toast({ title: "Cancellation failed", description: e.message, variant: "destructive" });
    },
  });

  const retryPayment = useMutation({
    mutationFn: async (spotId: number) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/dropins/spots/${spotId}/pay`, { method: "POST", headers });
      if (r.status === 409) {
        const err = await r.json();
        if (err.error === "already_paid") return { alreadyPaid: true, message: err.message };
        throw new Error(err.error ?? "Payment failed");
      }
      if (!r.ok) { const err = await r.json(); throw new Error(err.error ?? "Payment failed"); }
      return r.json();
    },
    onSuccess: (data) => {
      if ((data as any).alreadyPaid) {
        toast({ title: "Payment already received", description: (data as any).message ?? "Your spot is confirmed!" });
        onRegistered();
        return;
      }
      if (data.clientSecret) {
        setPaymentData({
          clientSecret: data.clientSecret,
          publishableKey: data.publishableKey,
          amount: data.amount,
          basePrice: data.basePrice,
          serviceFeeAmount: data.serviceFeeAmount,
        });
      }
    },
    onError: (e: any) => toast({ title: "Payment failed", description: e.message, variant: "destructive" }),
  });

  const countdown = useCountdown(mySpot?.expiresAt ?? null);

  function handleRegister(childId?: number) {
    setShowSelector(false);
    doRsvp.mutate({
      participantUserId: childId,
      useCreditsVal: effectivePrice > 0 ? useCredits : undefined,
      discountCodeVal: effectivePrice > 0 && discountCode.trim() ? discountCode.trim() : undefined,
    });
  }

  function handlePaymentSuccess() {
    setPaymentData(null);
    onRegistered();
    toast({ title: "Payment complete!", description: "Your spot is confirmed. See you on the court." });
  }

  // ── Registered state ──────────────────────────────────────────────────────
  if (mySpot && mySpot.status !== "cancelled") {
    const isWaitlisted = mySpot.waitlisted;
    const isPaymentPending = mySpot.paymentStatus === "payment_pending";

    // ── Payment pending: amber warning card ───────────────────────────────
    if (isPaymentPending && !isWaitlisted) {
      return (
        <div className="border border-amber-500/30 bg-amber-500/10 rounded-xl p-5">
          <div className="flex items-center gap-2 font-semibold mb-1 text-amber-400">
            <Clock className="h-4 w-4" />
            Payment required
          </div>
          <p className="text-sm text-white/60">{ageLabel} · {pool.skillLevel !== "all" ? pool.skillLevel : "All levels"}{pool.gender ? ` · ${pool.gender}` : ""}</p>
          {poolStartsAt && (
            <p className="text-xs text-white/40 mt-1 flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatEastern(poolStartsAt, "h:mm a 'ET'")}{poolEndsAt ? ` — ${formatEastern(poolEndsAt, "h:mm a 'ET'")}` : ""}
            </p>
          )}
          <div className="mt-3 rounded-lg bg-amber-500/15 border border-amber-500/30 px-3 py-2.5 space-y-2">
            <p className="text-xs text-amber-300 font-medium leading-tight">
              {countdown && countdown !== "Expired"
                ? `Complete payment within ${countdown} to secure this spot.`
                : countdown === "Expired"
                ? "Payment window expired — this spot will be released shortly."
                : "Complete payment to secure this spot (15-minute window)."}
            </p>
            {effectivePrice > 0 && (
              <Button
                size="sm"
                className="w-full bg-amber-500 hover:bg-amber-600 border-none text-black font-semibold text-xs h-8"
                onClick={() => retryPayment.mutate(mySpot.id)}
                disabled={retryPayment.isPending || countdown === "Expired"}
              >
                <CreditCard className="h-3.5 w-3.5 mr-1.5" />
                {retryPayment.isPending ? "Loading…" : `Complete Payment — $${effectivePrice.toFixed(2)}`}
              </Button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setCancelConfirm(true)}
            className="mt-3 text-xs text-white/30 hover:text-white/60 underline transition-colors"
          >
            Cancel registration
          </button>
          {cancelConfirm && (
            <div className="mt-3 flex flex-col gap-2 border border-red-500/20 rounded-lg p-3 bg-red-500/5">
              <p className="text-xs text-red-400 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                Cancel your spot? This cannot be undone.
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="flex-1 text-xs border-white/20 text-white/60 h-8"
                  onClick={() => setCancelConfirm(false)} disabled={doCancel.isPending}>
                  Keep spot
                </Button>
                <Button size="sm" className="flex-1 text-xs bg-red-600 hover:bg-red-700 text-white h-8"
                  onClick={() => doCancel.mutate()} disabled={doCancel.isPending}>
                  {doCancel.isPending ? "Cancelling…" : "Yes, cancel"}
                </Button>
              </div>
            </div>
          )}
          {paymentData && (
            <InlinePaymentDialog
              open={!!paymentData}
              clientSecret={paymentData.clientSecret}
              publishableKey={paymentData.publishableKey}
              amount={paymentData.amount}
              basePrice={paymentData.basePrice}
              serviceFeeAmount={paymentData.serviceFeeAmount}
              title="Complete Payment"
              label={`Pay ${paymentData.amount.toLocaleString("en-US", { style: "currency", currency: "USD" })}`}
              onSuccess={handlePaymentSuccess}
              onCancel={() => setPaymentData(null)}
            />
          )}
        </div>
      );
    }

    return (
      <div className={`border rounded-xl p-5 ${isWaitlisted ? "border-orange-500/30 bg-orange-500/10" : "border-emerald-500/30 bg-emerald-500/10"}`}>
        <div className={`flex items-center gap-2 font-semibold mb-1 ${isWaitlisted ? "text-orange-400" : "text-emerald-400"}`}>
          {isWaitlisted ? <Users className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
          {isWaitlisted ? `Waitlisted${mySpot.waitlistPosition ? ` — position #${mySpot.waitlistPosition}` : ""}` : "You're registered!"}
        </div>
        <p className="text-sm text-white/60">{ageLabel} · {pool.skillLevel !== "all" ? pool.skillLevel : "All levels"}{pool.gender ? ` · ${pool.gender}` : ""}</p>
        {poolStartsAt && (
          <p className="text-xs text-white/40 mt-1 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatEastern(poolStartsAt, "h:mm a 'ET'")}{poolEndsAt ? ` — ${formatEastern(poolEndsAt, "h:mm a 'ET'")}` : ""}
          </p>
        )}

        {/* Cancel flow */}
        {!cancelConfirm ? (
          <button
            type="button"
            onClick={() => setCancelConfirm(true)}
            className="mt-3 text-xs text-white/30 hover:text-white/60 underline transition-colors"
          >
            Cancel registration
          </button>
        ) : (
          <div className="mt-3 flex flex-col gap-2 border border-red-500/20 rounded-lg p-3 bg-red-500/5">
            <p className="text-xs text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
              Cancel your spot? This cannot be undone.
            </p>
            {/* Cancellation policy messaging — derived from pool policy */}
            {(() => {
              const isPaid = mySpot?.paymentStatus === "paid_inapp" || mySpot?.paymentStatus === "payment_pending";
              const sessionStart = poolStartsAt ?? sessionStartsAt;
              if (!sessionStart) return null;
              const minutesUntilStart = (sessionStart.getTime() - Date.now()) / 60_000;
              // Use cancellationWindowMinutes from the materialized court pool when available;
              // fall back to 120 min (standard drop-in policy) when the pool hasn't been
              // materialized yet (no legacyPoolId) or the column is null.
              const windowMinutes: number = pool.cancellationWindowMinutes ?? 120;
              const deadlineMs = sessionStart.getTime() - windowMinutes * 60_000;
              const deadlineLabel = new Date(deadlineMs).toLocaleTimeString("en-US", {
                hour: "numeric", minute: "2-digit", hour12: true,
              });
              const withinWindow = minutesUntilStart <= windowMinutes;
              if (isPaid) {
                if (!withinWindow) {
                  return (
                    <p className="text-xs text-white/50 flex items-start gap-1.5">
                      <Clock className="h-3 w-3 mt-0.5 shrink-0 text-amber-400" />
                      Refund eligible — cancellations before {deadlineLabel} qualify for a refund per our drop-in policy.
                    </p>
                  );
                } else {
                  return (
                    <p className="text-xs text-white/50 flex items-start gap-1.5">
                      <Clock className="h-3 w-3 mt-0.5 shrink-0 text-red-400" />
                      Outside the {windowMinutes}-minute cancellation window — this spot is no longer refund-eligible.
                    </p>
                  );
                }
              } else {
                return (
                  <p className="text-xs text-white/40 flex items-start gap-1.5">
                    <Clock className="h-3 w-3 mt-0.5 shrink-0" />
                    Your spot will be released and may be offered to the next player in line.
                  </p>
                );
              }
            })()}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="flex-1 text-xs border-white/20 text-white/60 h-8"
                onClick={() => setCancelConfirm(false)} disabled={doCancel.isPending}>
                Keep spot
              </Button>
              <Button size="sm" className="flex-1 text-xs bg-red-600 hover:bg-red-700 text-white h-8"
                onClick={() => doCancel.mutate()} disabled={doCancel.isPending}>
                {doCancel.isPending ? "Cancelling…" : "Yes, cancel"}
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Registration / waitlist UI ────────────────────────────────────────────
  return (
    <div className="border border-white/10 rounded-xl p-5 space-y-4 bg-white/5">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-semibold text-white">{ageLabel}</p>
          <p className="text-sm text-white/50 mt-0.5">
            {pool.skillLevel !== "all" ? pool.skillLevel : "All skill levels"}
            {pool.gender ? ` · ${pool.gender}` : ""}
          </p>
          {poolStartsAt && (
            <p className="text-xs text-white/40 mt-1 flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatEastern(poolStartsAt, "h:mm a 'ET'")}{poolEndsAt ? ` — ${formatEastern(poolEndsAt, "h:mm a 'ET'")}` : ""}
            </p>
          )}
        </div>
        <div className="text-right">
          {effectivePrice > 0 ? (
            <div>
              <span className="text-lg font-bold text-white">${effectivePrice.toFixed(2)}</span>
              {earlyBirdActive && <Badge className="ml-1.5 text-xs bg-amber-500/20 text-amber-400 border-amber-500/30">Early Bird</Badge>}
              {earlyBirdActive && <p className="text-xs text-white/40">Regular: ${price.toFixed(2)}</p>}
            </div>
          ) : (
            <span className="text-lg font-bold text-emerald-400">Free</span>
          )}
        </div>
      </div>

      <FillBar taken={pool.spotsTaken ?? 0} cap={pool.cap} />

      {!isOpen ? (
        <p className="text-sm text-white/40 italic">Registration is currently closed for this pool.</p>
      ) : isFull ? (
        <Show when="signed-in" fallback={
          <Link href="/sign-in"><Button className="w-full bg-white/10 text-white/70 border-white/10">Sign in to join waitlist</Button></Link>
        }>
          {pool.waitlistEnabled === false ? (
            <Button className="w-full bg-orange-500/20 border border-orange-500/30 text-orange-300" disabled>
              <Users className="h-4 w-4 mr-2" /> Waitlist closed
            </Button>
          ) : (
            <Button
              className="w-full bg-orange-500/20 border border-orange-500/30 text-orange-300 hover:bg-orange-500/30"
              onClick={() => ensureProfile(() => doRsvp.mutate())}
              disabled={doRsvp.isPending}
            >
              <Users className="h-4 w-4 mr-2" />
              {doRsvp.isPending
                ? "Joining…"
                : `Join Waitlist${(pool.waitlistCount ?? 0) > 0 ? ` — position #${(pool.waitlistCount) + 1}` : ""}`}
            </Button>
          )}
        </Show>
      ) : (
        <Show when="signed-in" fallback={
          <Link href="/sign-in"><Button className="w-full bg-[#dc2626] hover:bg-[#b91c1c] text-white">Sign in to register</Button></Link>
        }>
          {!showSelector ? (
            <Button
              className="w-full bg-[#dc2626] hover:bg-[#b91c1c] text-white"
              onClick={() => ensureProfile(() => setShowSelector(true))}
              disabled={doRsvp.isPending}
            >
              {effectivePrice > 0 ? <CreditCard className="h-4 w-4 mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              {doRsvp.isPending
                ? "Loading…"
                : effectivePrice > 0
                ? `Register — $${effectivePrice.toFixed(2)}`
                : "Register — Free"}
            </Button>
          ) : (
            <div className="space-y-3 pt-1">
              <p className="text-sm font-semibold text-white">Who is this spot for?</p>
              <ParticipantSelector
                ageGroups={pool.ageGroup ?? ["adult"]}
                eventStartDate={pool.effectiveStartsAt
                  ? new Date(pool.effectiveStartsAt).toISOString().split("T")[0]
                  : sessionStartsAt ? sessionStartsAt.toISOString().split("T")[0] : null}
                value={selectedParticipant ? {
                  id: selectedParticipant.id,
                  firstName: selectedParticipant.firstName,
                  lastName: selectedParticipant.lastName,
                  isChild: selectedParticipant.isChild ?? true,
                } : null}
                onChange={(p) => setSelectedParticipant(p ? {
                  id: p.id,
                  firstName: p.firstName,
                  lastName: p.lastName,
                  isChild: p.isChild,
                } : null)}
                currentUserId={(profile as any)?.id ?? null}
                currentUserProfile={(profile as any)?.id ? {
                  id: (profile as any).id,
                  firstName: (profile as any).firstName ?? "",
                  lastName: (profile as any).lastName ?? "",
                } : null}
                enabled={showSelector}
              />
              {/* Credits / promo for paid pools */}
              {effectivePrice > 0 && (
                <div className="space-y-2 pt-1">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={useCredits}
                      onChange={(e) => setUseCredits(e.target.checked)}
                      className="rounded border-white/20 bg-white/10 accent-red-500"
                    />
                    <span className="text-xs text-white/60">Apply account credits</span>
                  </label>
                  {!showPromoInput ? (
                    <button
                      type="button"
                      onClick={() => setShowPromoInput(true)}
                      className="text-xs text-white/35 hover:text-white/55 underline"
                    >
                      Have a promo code?
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={discountCode}
                        onChange={(e) => setDiscountCode(e.target.value.toUpperCase())}
                        placeholder="PROMO CODE"
                        className="flex-1 text-xs bg-white/10 border border-white/20 rounded px-2 py-1.5 text-white placeholder:text-white/30 outline-none focus:border-white/40"
                      />
                      <button
                        type="button"
                        onClick={() => { setDiscountCode(""); setShowPromoInput(false); }}
                        className="text-white/35 hover:text-white/60"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 border-white/20 text-white hover:bg-white/10"
                  onClick={() => { setShowSelector(false); setSelectedParticipant(null); }}
                >
                  <X className="h-3.5 w-3.5 mr-1" /> Cancel
                </Button>
                <Button
                  size="sm"
                  className={`flex-1 ${isFull ? "bg-orange-500/20 border border-orange-500/30 text-orange-400" : "bg-[#dc2626] hover:bg-[#b91c1c] border-none text-white"}`}
                  disabled={!selectedParticipant || doRsvp.isPending}
                  onClick={() => {
                    if (!selectedParticipant) return;
                    const childId = selectedParticipant.isChild !== false ? selectedParticipant.id : undefined;
                    handleRegister(childId);
                  }}
                >
                  {doRsvp.isPending
                    ? "Processing…"
                    : effectivePrice > 0
                    ? `Pay — $${effectivePrice.toFixed(2)}`
                    : "Confirm"}
                </Button>
              </div>
            </div>
          )}
        </Show>
      )}

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
      {WaiverModalElement}
    </div>
  );
}

export default function DropinOccurrenceDetail() {
  const [, params] = useRoute("/dropins/occ/:templateId/:date");
  const templateId = Number(params?.templateId);
  const date = params?.date ?? "";
  const qc = useQueryClient();
  const authedFetch = useAuthedFetch();

  const { data: occurrence, isLoading, error } = useQuery({
    queryKey: ["dropin-occurrence", templateId, date],
    queryFn: () => authedFetch(`${API}/dropin-occurrences/${templateId}/${date}`),
    enabled: !isNaN(templateId) && !!date,
  });

  if (isLoading) {
    return (
      <Layout>
        <div className="min-h-screen bg-[#0a0a10] py-12 px-4">
          <div className="max-w-2xl mx-auto space-y-4">
            <Skeleton className="h-8 w-48 bg-white/10" />
            <Skeleton className="h-48 rounded-xl bg-white/10" />
            <Skeleton className="h-32 rounded-xl bg-white/10" />
          </div>
        </div>
      </Layout>
    );
  }

  if (!occurrence || error) {
    return (
      <Layout>
        <div className="min-h-screen bg-[#0a0a10] py-12 px-4 text-center text-white/50">
          <p>Session not found.</p>
          <Link href="/dropins"><Button variant="link" className="mt-3 text-white/50">Back to Drop-ins</Button></Link>
        </div>
      </Layout>
    );
  }

  const template = occurrence.template ?? {};
  const rule = template.recurrenceRule ?? {};
  const pools: any[] = occurrence.pools ?? [];
  const startsAt = occurrence.startsAt ? new Date(occurrence.startsAt) : null;
  const endsAt = startsAt && rule.durationMinutes ? new Date(startsAt.getTime() + Number(rule.durationMinutes) * 60 * 1000) : null;
  const sport = template.sport ?? "other";

  return (
    <Layout>
      <div className="min-h-screen bg-[#0a0a10]">
        {/* Hero */}
        <div className="border-b border-white/5 bg-gradient-to-b from-[#0f1a0f] to-[#0a0a10] px-6 py-12">
          <div className="max-w-2xl mx-auto">
            <Link href="/dropins">
              <button type="button" className="flex items-center gap-1.5 text-white/40 hover:text-white text-sm mb-6 transition-colors">
                <ChevronLeft className="h-4 w-4" /> Drop-ins
              </button>
            </Link>

            <div className="flex items-start gap-4">
              <span className="text-4xl">{SPORT_EMOJIS[sport] ?? "🏃"}</span>
              <div>
                <h1 className="text-2xl font-bold text-white">{template.name ?? "Drop-in Session"}</h1>
                {template.description && (
                  <p className="text-sm text-white/60 mt-1 max-w-lg">{template.description}</p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-4 mt-6 text-sm text-white/60">
              {startsAt && (
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-4 w-4 text-emerald-400" />
                  <span>{format(startsAt, "EEEE, MMMM d, yyyy")}</span>
                </div>
              )}
              {startsAt && (
                <div className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-emerald-400" />
                  <span>{formatEastern(startsAt, "h:mm a 'ET'")}{endsAt ? ` — ${formatEastern(endsAt, "h:mm a 'ET'")}` : ""}</span>
                </div>
              )}
              {pools.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <Users className="h-4 w-4 text-emerald-400" />
                  <span>{pools.reduce((s: number, p: any) => s + (p.cap ?? 0), 0)} total spots</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Pools */}
        <div className="max-w-2xl mx-auto px-6 py-10 space-y-4">
          {pools.length === 0 ? (
            <p className="text-white/40 text-sm">No pools configured for this session.</p>
          ) : (
            <>
              <h2 className="text-sm font-semibold text-white/50 uppercase tracking-wide mb-4">
                {pools.length} Court{pools.length !== 1 ? "s" : ""}
              </h2>
              {pools.map((pool: any) => (
                <PoolCard
                  key={pool.id}
                  pool={pool}
                  templateId={templateId}
                  date={date}
                  sessionStartsAt={startsAt}
                  onRegistered={() => qc.invalidateQueries({ queryKey: ["dropin-occurrence", templateId, date] })}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
