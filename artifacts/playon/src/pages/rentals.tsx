import { API_BASE } from "@/lib/api-base";
import React, { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { useAuth, useUser } from "@clerk/react";
import { useToast } from "@/hooks/use-toast";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { CheckoutElementsProvider, PaymentElement, useCheckout } from "@stripe/react-stripe-js/checkout";
import {
  Calendar, Clock, CheckCircle2, ArrowLeft, Loader2, Building2, ChevronRight, Users,
} from "lucide-react";
import { format, addDays, startOfToday, parseISO, isBefore, isAfter } from "date-fns";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PricingTier {
  id: number;
  name: string;
  durationMinutes: number;
  price: string;
}

interface CourtAvailability {
  courtNumber: number;
  availableSlots: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt12(time24: string): string {
  const [h, m] = time24.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function addMinutes(time24: string, minutes: number): string {
  const [h, m] = time24.split(":").map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// ── Stripe Payment Form ────────────────────────────────────────────────────────

function PaymentForm({ onSuccess }: { onSuccess: () => void }) {
  const checkoutResult = useCheckout();
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const ready = checkoutResult.type === "success";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (checkoutResult.type !== "success") return;
    setLoading(true);
    try {
      const result = await checkoutResult.checkout.confirm({ redirect: "if_required" });
      if (result.type === "error") {
        toast({ title: "Payment failed", description: (result as any).error?.message, variant: "destructive" });
      } else {
        onSuccess();
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <PaymentElement />
      <Button type="submit" disabled={loading || !ready} className="w-full h-12 text-base font-bold">
        {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Processing…</> : "Complete Booking"}
      </Button>
    </form>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function RentalsPage() {
  const [, setLocation] = useLocation();
  const { getToken, isSignedIn } = useAuth();
  const { toast } = useToast();

  // Step: "pick" | "payment" | "done"
  const [step, setStep] = useState<"pick" | "payment" | "done">("pick");

  const [tiers, setTiers] = useState<PricingTier[]>([]);
  const [tiersLoading, setTiersLoading] = useState(true);
  const [courts, setCourts] = useState<{ id: number; name: string }[]>([]);

  // Load courts for real names
  useEffect(() => {
    fetch(`${API_BASE}/courts`)
      .then((r) => r.json())
      .then((data: any[]) => setCourts(data.map((c) => ({ id: c.id, name: c.name }))))
      .catch(() => {});
  }, []);

  // Selections
  const today = startOfToday();
  const [selectedDate, setSelectedDate] = useState<Date>(addDays(today, 1));
  const [unavailableDates, setUnavailableDates] = useState<Set<string>>(new Set());
  const [selectedTier, setSelectedTier] = useState<PricingTier | null>(null);
  const [availability, setAvailability] = useState<CourtAvailability[]>([]);
  const [availLoading, setAvailLoading] = useState(false);
  const [selectedCourt, setSelectedCourt] = useState<number | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [headcount, setHeadcount] = useState(1);

  // Payment
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  // Booking summary for confirmation
  const [bookedSummary, setBookedSummary] = useState<{ date: string; court: number; start: string; end: string; name: string; waiverToken?: string } | null>(null);

  // Load unavailable dates for the next 30 days so the picker can grey them out
  useEffect(() => {
    const from = format(addDays(today, 1), "yyyy-MM-dd");
    const to   = format(addDays(today, 30), "yyyy-MM-dd");
    fetch(`${API_BASE}/rentals/unavailable-dates?from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((dates: string[]) => setUnavailableDates(new Set(dates)))
      .catch(() => {});
  }, []);

  // Load pricing tiers
  useEffect(() => {
    fetch(`${API_BASE}/rentals/pricing`)
      .then((r) => r.json())
      .then((data) => {
        setTiers(data);
        if (data.length) setSelectedTier(data[0]);
      })
      .catch(() => {})
      .finally(() => setTiersLoading(false));
  }, []);

  // Load availability whenever date or tier changes
  useEffect(() => {
    if (!selectedTier) return;
    setAvailLoading(true);
    setSelectedCourt(null);
    setSelectedSlot(null);
    const dateStr = format(selectedDate, "yyyy-MM-dd");
    fetch(`${API_BASE}/rentals/availability?date=${dateStr}&durationMinutes=${selectedTier.durationMinutes}`)
      .then((r) => r.json())
      .then(setAvailability)
      .catch(() => setAvailability([]))
      .finally(() => setAvailLoading(false));
  }, [selectedDate, selectedTier]);

  const handleSelectSlot = (court: number, slot: string) => {
    setSelectedCourt(court);
    setSelectedSlot(slot);
  };

  const handleBook = async () => {
    if (!isSignedIn) {
      setLocation("/sign-in");
      return;
    }
    if (!selectedTier || !selectedCourt || !selectedSlot) return;
    setCheckoutLoading(true);
    try {
      const token = await getToken();
      // Get publishable key
      const pkRes = await fetch(`${API_BASE}/checkout/publishable-key`);
      const { publishableKey } = await pkRes.json();

      const res = await fetch(`${API_BASE}/rentals/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          date: format(selectedDate, "yyyy-MM-dd"),
          startTime: selectedSlot,
          pricingTierId: selectedTier.id,
          courtNumber: selectedCourt,
          headcount,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Booking error", description: data.error, variant: "destructive" });
        return;
      }

      setStripePromise(loadStripe(publishableKey));
      setClientSecret(data.clientSecret);
      setBookedSummary({
        date: format(selectedDate, "EEE, MMMM d, yyyy"),
        court: selectedCourt,
        start: selectedSlot,
        end: addMinutes(selectedSlot, selectedTier.durationMinutes),
        name: selectedTier.name,
        waiverToken: data.groupWaiverToken,
      });
      setStep("payment");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setCheckoutLoading(false);
    }
  };

  if (step === "done") {
    return (
      <Layout>
        <div className="min-h-screen bg-[#050508] flex items-center justify-center px-4">
          <div className="text-center max-w-md">
            <div className="w-20 h-20 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="h-10 w-10 text-emerald-400" />
            </div>
            <h1 className="text-3xl font-black text-white mb-3">You're booked!</h1>
            {bookedSummary && (
              <div className="bg-white/5 border border-white/10 rounded-2xl p-5 text-left mb-6 space-y-2">
                <p className="text-white/60 text-sm flex items-center gap-2">
                  <Building2 className="h-4 w-4" /> {courts.find((c) => c.id === bookedSummary.court)?.name ?? `Court ${bookedSummary.court}`} — {bookedSummary.name}
                </p>
                <p className="text-white/60 text-sm flex items-center gap-2">
                  <Calendar className="h-4 w-4" /> {bookedSummary.date}
                </p>
                <p className="text-white/60 text-sm flex items-center gap-2">
                  <Clock className="h-4 w-4" /> {fmt12(bookedSummary.start)} – {fmt12(bookedSummary.end)}
                </p>
              </div>
            )}
            <p className="text-white/40 text-sm mb-4">A confirmation email has been sent with your group waiver link.</p>
            {bookedSummary?.waiverToken && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6 text-left">
                <p className="text-white/60 text-xs font-semibold uppercase tracking-wide mb-2 flex items-center gap-2">
                  <Users className="h-3.5 w-3.5" /> Group Waiver Link
                </p>
                <p className="text-white/50 text-xs mb-3">Share this with everyone joining you so they can sign before arriving.</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-white/5 rounded px-2 py-1.5 text-white/70 truncate">
                    {window.location.origin}/waiver/rental/{bookedSummary.waiverToken}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/waiver/rental/${bookedSummary!.waiverToken}`);
                      toast({ title: "Link copied!" });
                    }}
                    className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground font-medium shrink-0"
                  >
                    Copy
                  </button>
                </div>
              </div>
            )}
            <Button onClick={() => setLocation("/")} className="w-full">Back to Home</Button>
          </div>
        </div>
      </Layout>
    );
  }

  if (step === "payment" && stripePromise && clientSecret) {
    return (
      <Layout>
        <div className="min-h-screen bg-[#050508] py-10 px-4">
          <div className="max-w-lg mx-auto">
            <button onClick={() => setStep("pick")} className="flex items-center gap-2 text-white/50 hover:text-white text-sm mb-8 transition-colors">
              <ArrowLeft className="h-4 w-4" /> Back
            </button>

            <h1 className="text-3xl font-black text-white mb-2">Complete Booking</h1>

            {bookedSummary && (
              <div className="bg-white/5 border border-white/10 rounded-2xl p-4 mb-6 space-y-1">
                <p className="text-white font-semibold">{courts.find((c) => c.id === bookedSummary.court)?.name ?? `Court ${bookedSummary.court}`} Rental — {bookedSummary.name}</p>
                <p className="text-white/50 text-sm">{bookedSummary.date}</p>
                <p className="text-white/50 text-sm">{fmt12(bookedSummary.start)} – {fmt12(bookedSummary.end)}</p>
                <p className="text-emerald-400 font-bold text-lg">${Number(selectedTier?.price ?? 0).toFixed(2)}</p>
              </div>
            )}

            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <CheckoutElementsProvider stripe={stripePromise} options={{ clientSecret }}>
                <PaymentForm onSuccess={() => setStep("done")} />
              </CheckoutElementsProvider>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  // Date options: today + next 30 days
  const dateOptions = Array.from({ length: 30 }, (_, i) => addDays(today, i + 1));

  return (
    <Layout>
      <div className="bg-[#050508] min-h-screen">
        {/* Hero */}
        <div className="bg-gradient-to-b from-[#0a0a12] to-[#050508] border-b border-white/5 pt-10 pb-8">
          <div className="container mx-auto px-4">
            <h1 className="text-4xl md:text-5xl font-black uppercase tracking-tight text-white mb-2">Court Rentals</h1>
            <p className="text-white/50 text-base">Reserve a court at the Alumni Center for your own training, practice, or events.</p>
          </div>
        </div>

        <div className="container mx-auto px-4 py-8 max-w-3xl">

          {/* Step 1: Pick a date */}
          <div className="mb-8">
            <h2 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-white/10 text-white text-sm font-bold flex items-center justify-center">1</span>
              Pick a Date
            </h2>
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
              {dateOptions.map((d) => {
                const dateStr = format(d, "yyyy-MM-dd");
                const isSelected = dateStr === format(selectedDate, "yyyy-MM-dd");
                const isUnavailable = unavailableDates.has(dateStr);
                return (
                  <button
                    key={d.toISOString()}
                    onClick={() => !isUnavailable && setSelectedDate(d)}
                    disabled={isUnavailable}
                    title={isUnavailable ? "No availability — court blocked" : undefined}
                    className={`flex-shrink-0 flex flex-col items-center px-4 py-3 rounded-xl border transition-all relative ${
                      isUnavailable
                        ? "bg-white/3 border-white/5 text-white/20 cursor-not-allowed opacity-50"
                        : isSelected
                        ? "bg-primary border-primary text-white"
                        : "bg-white/5 border-white/10 text-white/60 hover:border-white/30 hover:text-white"
                    }`}
                  >
                    <span className="text-xs font-semibold uppercase tracking-wide">{format(d, "EEE")}</span>
                    <span className="text-xl font-black leading-none mt-0.5">{format(d, "d")}</span>
                    <span className="text-xs opacity-70">{format(d, "MMM")}</span>
                    {isUnavailable && (
                      <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[9px] font-bold text-red-400/70 uppercase tracking-wider leading-none">
                        Closed
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 2: Pick duration */}
          <div className="mb-8">
            <h2 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-white/10 text-white text-sm font-bold flex items-center justify-center">2</span>
              Choose Duration
            </h2>
            {tiersLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[...Array(3)].map((_, i) => <div key={i} className="h-24 rounded-xl bg-white/5 animate-pulse" />)}
              </div>
            ) : tiers.length === 0 ? (
              <p className="text-white/40 text-sm">No pricing options available yet. Check back soon.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {tiers.map((tier) => {
                  const isSelected = selectedTier?.id === tier.id;
                  return (
                    <button
                      key={tier.id}
                      onClick={() => setSelectedTier(tier)}
                      className={`flex flex-col items-start p-4 rounded-xl border text-left transition-all ${
                        isSelected
                          ? "bg-primary/20 border-primary text-white"
                          : "bg-white/5 border-white/10 text-white/60 hover:border-white/30 hover:text-white"
                      }`}
                    >
                      <span className="font-bold text-base">{tier.name}</span>
                      <span className="text-xs text-white/40 mt-0.5">
                        {tier.durationMinutes >= 60
                          ? `${tier.durationMinutes / 60}hr${tier.durationMinutes > 60 ? "s" : ""}`
                          : `${tier.durationMinutes} min`}
                      </span>
                      <span className="text-emerald-400 font-black text-xl mt-2">${Number(tier.price).toFixed(2)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Step 3: Pick a slot */}
          {selectedTier && (
            <div className="mb-8">
              <h2 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
                <span className="w-7 h-7 rounded-full bg-white/10 text-white text-sm font-bold flex items-center justify-center">3</span>
                Select a Court & Time
              </h2>

              {availLoading ? (
                <div className="space-y-4">
                  {[1, 2].map((c) => <div key={c} className="h-32 rounded-xl bg-white/5 animate-pulse" />)}
                </div>
              ) : (
                <div className="space-y-4">
                  {availability.map(({ courtNumber: courtNum, availableSlots: slots }) => {
                    const courtName = courts.find((c) => c.id === courtNum)?.name ?? `Court ${courtNum}`;
                    return (
                      <div key={courtNum} className="bg-white/5 border border-white/10 rounded-2xl p-4">
                        <p className="text-white font-semibold mb-3 flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-white/40" />
                          {courtName}
                        </p>
                        {slots.length === 0 ? (
                          <p className="text-white/30 text-sm">No availability on this day</p>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {slots.map((slot) => {
                              const isSelected = selectedCourt === courtNum && selectedSlot === slot;
                              return (
                                <button
                                  key={slot}
                                  onClick={() => handleSelectSlot(courtNum, slot)}
                                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-all ${
                                    isSelected
                                      ? "bg-primary border-primary text-white"
                                      : "bg-white/5 border-white/10 text-white/60 hover:border-white/30 hover:text-white"
                                  }`}
                                >
                                  {fmt12(slot)}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Headcount + Book */}
          {selectedCourt && selectedSlot && selectedTier && (
            <div className="sticky bottom-4">
              <div className="bg-[#111118] border border-white/10 rounded-2xl p-4 shadow-2xl space-y-3">
                {/* Headcount picker */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white text-sm font-semibold flex items-center gap-1.5">
                      <Users className="h-4 w-4 text-white/40" /> How many people (including you)?
                    </p>
                    <p className="text-white/30 text-xs">Used to track group waiver signing</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setHeadcount(Math.max(1, headcount - 1))} className="w-8 h-8 rounded-lg bg-white/10 text-white font-bold hover:bg-white/20 transition-colors">−</button>
                    <span className="text-white font-bold text-lg w-6 text-center">{headcount}</span>
                    <button onClick={() => setHeadcount(Math.min(20, headcount + 1))} className="w-8 h-8 rounded-lg bg-white/10 text-white font-bold hover:bg-white/20 transition-colors">+</button>
                  </div>
                </div>
                {/* Summary + book */}
                <div className="flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold text-sm">{courts.find((c) => c.id === selectedCourt)?.name ?? `Court ${selectedCourt}`} · {selectedTier.name}</p>
                    <p className="text-white/40 text-xs">{format(selectedDate, "EEE, MMM d")} · {fmt12(selectedSlot)} – {fmt12(addMinutes(selectedSlot, selectedTier.durationMinutes))}</p>
                  </div>
                  <p className="text-emerald-400 font-black text-lg shrink-0">${Number(selectedTier.price).toFixed(2)}</p>
                  <Button onClick={handleBook} disabled={checkoutLoading} className="shrink-0">
                    {checkoutLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Book <ChevronRight className="h-4 w-4 ml-1" /></>}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
