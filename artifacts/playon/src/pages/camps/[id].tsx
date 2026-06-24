import React, { useState } from "react";
import { useRoute, Link } from "wouter";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar, Users, ChevronLeft, Clock, CheckCircle2, AlertCircle, ShieldCheck, Camera, Baby, MapPin, Star } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth, Show } from "@clerk/react";
import { useGetMyProfile } from "@workspace/api-client-react";
import { SectionEntry } from "@/components/brand-ui";
import { useWaiverGate } from "@/components/waiver-modal";
import { InlinePaymentDialog } from "@/components/inline-payment-dialog";
import { ParticipantSelector } from "@/components/participant-selector";

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
  adult: "Adult (18+)",
  u8_u11: "Youth Ages 8–11",
  u12_u15: "Youth Ages 12–15",
};

function PriceBadge({ price, resolvedPrice, earlyBirdPrice, earlyBirdCutoff, lateFee }: any) {
  const now = new Date();
  const isEarlyBird = earlyBirdPrice && earlyBirdCutoff && now <= new Date(earlyBirdCutoff);
  return (
    <div className="space-y-1">
      {isEarlyBird ? (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-emerald-400">${Number(earlyBirdPrice).toFixed(2)}</span>
            <span className="text-lg line-through text-white/30">${Number(price).toFixed(2)}</span>
          </div>
          <span className="inline-flex items-center text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/20">
            🐣 Early Bird — expires {format(new Date(earlyBirdCutoff), "MMM d")}
          </span>
        </>
      ) : (
        <div className="text-3xl font-black text-[#60a5fa]">${Number(resolvedPrice ?? price).toFixed(2)}</div>
      )}
      {lateFee && !isEarlyBird && (
        <p className="text-xs text-amber-400">+${Number(lateFee).toFixed(2)} late fee after deadline</p>
      )}
    </div>
  );
}

type Step = "idle" | "child_select" | "waiver" | "details" | "confirm";
const SKILL_LEVELS = ["beginner", "intermediate", "advanced", "competitive"];
const SHIRT_SIZES = ["YS", "YM", "YL", "S", "M", "L", "XL", "XXL"];

export default function CampDetail() {
  const [, params] = useRoute("/camps/:id");
  const id = Number(params?.id);
  const { toast } = useToast();
  const qc = useQueryClient();
  const getHeaders = useAuthHeaders();
  const { data: profile } = useGetMyProfile();
  const isAdmin = profile?.role === "admin" || profile?.role === "staff";
  const { ensureProfile, WaiverModalElement } = useWaiverGate();

  const [step, setStep] = useState<Step>("idle");
  const [waiverAccepted, setWaiverAccepted] = useState(false);
  const [photoConsent, setPhotoConsent] = useState<boolean | null>(null);
  const [siblingNumber, setSiblingNumber] = useState(1);
  const [selectedChild, setSelectedChild] = useState<{ id: number; firstName: string; lastName: string; isChild?: boolean } | null>(null);
  const [skillLevel, setSkillLevel] = useState("");
  const [shirtSize, setShirtSize] = useState("");
  const [useInstallment, setUseInstallment] = useState(false);
  const [installPayment, setInstallPayment] = useState<{ clientSecret: string; publishableKey: string; amount: number } | null>(null);

  const { data: camp, isLoading } = useQuery({
    queryKey: ["camp-detail", id],
    queryFn: async () => {
      const r = await fetch(`${API}/camps/${id}`);
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!id,
  });

  const { data: idData } = useQuery({
    queryKey: ["me", "id-data"],
    queryFn: async () => {
      const r = await fetch(`${API}/me/id-data`, { credentials: "include" });
      if (!r.ok) return null;
      return r.json() as Promise<{
        hasIdData: boolean;
        firstName?: string | null;
        lastName?: string | null;
        dateOfBirth?: string | null;
        addressLine1?: string | null;
      }>;
    },
  });

  const { data: days } = useQuery({
    queryKey: ["camp-days-public", id],
    queryFn: async () => {
      const r = await fetch(`${API}/camps/${id}/days`);
      return r.ok ? r.json() : [];
    },
    enabled: !!id,
  });

  const { data: coaches } = useQuery({
    queryKey: ["camp-coaches-public", id],
    queryFn: async () => {
      const r = await fetch(`${API}/camps/${id}/coaches`);
      return r.ok ? r.json() : [];
    },
    enabled: !!id,
  });

  const { data: pricing } = useQuery({
    queryKey: ["camp-price", id, siblingNumber],
    queryFn: async () => {
      const r = await fetch(`${API}/camps/${id}/price?siblingNumber=${siblingNumber}`);
      return r.ok ? r.json() : null;
    },
    enabled: !!id,
  });

  const { data: myReg } = useQuery({
    queryKey: ["my-camp-reg", id],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/camps/${id}/register/my`, { headers });
      return r.ok ? r.json() : [];
    },
    enabled: !!id && !!profile,
  });

  const isYouth = camp ? (Array.isArray(camp.ageGroup) ? camp.ageGroup : [camp.ageGroup]).some((ag: string) => ag !== "adult") : false;

  function buildPayload() {
    const base = { waiverSigned: waiverAccepted, siblingNumber, skillLevel: skillLevel || null, shirtSize: shirtSize || null };
    if (isYouth && selectedChild && selectedChild.id !== profile?.id) {
      return { ...base, playerUserId: selectedChild.id, guardianUserId: profile?.id, photoConsentGiven: photoConsent ?? false };
    }
    return { ...base, photoConsentGiven: false };
  }

  const register = useMutation({
    mutationFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/camps/${id}/register`, {
        method: "POST",
        headers,
        body: JSON.stringify(buildPayload()),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: "Registration failed" }));
        const e: any = new Error(err.error ?? "Registration failed");
        e.status = r.status;
        throw e;
      }
      const regData = await r.json();

      const campPrice = Number(camp?.price ?? 0);
      if (campPrice > 0) {
        // Installment plan: call the installment-plan endpoint and open inline dialog
        if (useInstallment && pricing?.installmentPlan) {
          const count = pricing.installmentCount ?? 3;
          const installR = await fetch(`${API}/checkout/installment-plan`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              programType: "camp",
              programId: id,
              registrationId: regData.id ?? null,
              installmentCount: count,
              playerUserId: isYouth && selectedChild && selectedChild.id !== profile?.id ? selectedChild.id : undefined,
            }),
          });
          if (!installR.ok) {
            const err = await installR.json().catch(() => ({ error: "Installment setup failed" }));
            throw new Error(err.error ?? "Installment setup failed");
          }
          const installData = await installR.json();
          return { __installment: true, ...installData };
        }

        // Full payment: Stripe hosted checkout (redirect)
        const checkoutR = await fetch(`${API}/checkout/session`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            programType: "camp",
            programId: id,
            registrationId: regData.id ?? null,
            successUrl: `${window.location.origin}/camps/${id}?payment=success`,
            cancelUrl: `${window.location.origin}/camps/${id}?payment=cancelled`,
          }),
        });
        const checkoutData = await checkoutR.json();
        if (checkoutData.sessionUrl) {
          window.location.href = checkoutData.sessionUrl;
          return { __redirected: true };
        }
      }
      return regData;
    },
    onSuccess: (data: any) => {
      if (data?.__redirected) return;
      if (data?.__installment) {
        setInstallPayment({ clientSecret: data.clientSecret, publishableKey: data.publishableKey, amount: data.amount });
        qc.invalidateQueries({ queryKey: ["camp-detail", id] });
        qc.invalidateQueries({ queryKey: ["my-camp-reg", id] });
        setStep("idle");
        return;
      }
      qc.invalidateQueries({ queryKey: ["camp-detail", id] });
      qc.invalidateQueries({ queryKey: ["my-camp-reg", id] });
      toast({ title: "Registration confirmed!", description: `You're registered for ${camp?.name}.` });
      setStep("idle");
    },
    onError: (e: any) => {
      if (e.status === 409) {
        toast({ title: "Already registered", description: "This player is already registered for this camp. View it on your dashboard.", variant: "default" });
        qc.invalidateQueries({ queryKey: ["my-camp-reg", id] });
      } else {
        toast({ title: "Registration failed", description: e.message, variant: "destructive" });
      }
      setStep("idle");
    },
  });

  function startRegistration() {
    setWaiverAccepted(false);
    setPhotoConsent(null);
    setSelectedChild(null);
    if (isYouth) {
      setStep("child_select");
    } else {
      setStep("waiver");
    }
  }

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

  if (!camp) {
    return (
      <Layout>
        <div className="bg-[#050508] min-h-screen flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-white mb-4">Camp not found</h1>
            <Button asChild className="bg-[#dc2626] hover:bg-[#b91c1c]"><Link href="/camps">Back to Camps</Link></Button>
          </div>
        </div>
      </Layout>
    );
  }

  const isFull = (camp.participantsRegistered || 0) >= camp.maxParticipants;
  const isActive = computeIsEventActive(camp);
  const canRegister = isActive && camp.registrationOpen && !isFull && (camp.status === "upcoming" || camp.status === "active");
  const activeReg = Array.isArray(myReg) ? myReg.find((r: any) => r.status !== "cancelled") : null;
  const resolvedPrice = pricing?.resolvedPrice ?? camp.price;

  return (
    <Layout>
      <div className="dark bg-[#050508] text-white min-h-screen">
        {/* Compact header */}
        <div className="bg-gradient-to-b from-[#040a14] to-[#050508] border-b border-white/10 pt-6 pb-7">
          <div className="container mx-auto px-4">
            <Button variant="ghost" size="sm" className="mb-4 text-white/50 hover:text-white -ml-2 h-8" asChild>
              <Link href="/camps"><ChevronLeft className="mr-1 h-4 w-4" /> All Camps</Link>
            </Button>
            <div className="flex flex-wrap gap-1.5 mb-3 items-center">
              <span className="inline-flex items-center bg-[#1d4ed8]/80 text-white text-xs font-bold px-2.5 py-1 rounded-full border border-[#1d4ed8]/50">
                Camp
              </span>
              {(() => {
                const campStatus: "Open" | "Full" | "Upcoming" = isFull ? "Full" : camp.registrationOpen === true ? "Open" : "Upcoming";
                const campStatusStyles: Record<string, string> = {
                  Open: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
                  Full: "bg-red-500/20 text-red-400 border-red-500/30",
                  Upcoming: "bg-white/10 text-white/60 border-white/20",
                };
                return (
                  <span className={`inline-flex items-center text-xs font-bold px-2.5 py-1 rounded-full border ${campStatusStyles[campStatus]}`}>
                    {campStatus}
                  </span>
                );
              })()}
            </div>
            <h1 className="text-2xl md:text-4xl font-black text-white uppercase tracking-tight mb-3">{camp.name}</h1>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-white/50">
              {(camp.startDate || camp.endDate) && (
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-[#60a5fa]" />
                  {camp.startDate ? format(new Date(camp.startDate + "T12:00:00"), "MMM d") : ""}
                  {camp.endDate ? ` – ${format(new Date(camp.endDate + "T12:00:00"), "MMM d, yyyy")}` : ""}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-[#60a5fa]" />
                Alumni Center · Lexington, KY
              </span>
              <span className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-[#60a5fa]" />
                {camp.participantsRegistered || 0}/{camp.maxParticipants} spots
              </span>
              {pricing ? (
                <span className="flex items-center gap-1.5 font-semibold text-[#60a5fa]">
                  {(() => {
                    const now = new Date();
                    const isEB = pricing.earlyBirdPrice && pricing.earlyBirdCutoff && now <= new Date(pricing.earlyBirdCutoff);
                    return isEB
                      ? <><span className="line-through text-white/30">${Number(camp.price).toFixed(2)}</span> ${Number(pricing.earlyBirdPrice).toFixed(2)} <span className="text-xs font-normal text-emerald-400">Early Bird</span></>
                      : `$${Number(pricing.resolvedPrice ?? camp.price).toFixed(2)}`;
                  })()}
                </span>
              ) : (
                <span className="font-semibold text-[#60a5fa]">${Number(camp.price).toFixed(2)}</span>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="bg-[#0a0a10] py-12">
          <div className="container mx-auto px-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
              {/* Left column */}
              <SectionEntry direction="left" className="lg:col-span-2 space-y-10">
                {camp.description && (
                  <section>
                    <h2 className="text-xl font-black uppercase tracking-tight text-white mb-4">About This Camp</h2>
                    <p className="whitespace-pre-line leading-relaxed text-lg text-white/50">{camp.description}</p>
                  </section>
                )}

                {days && days.length > 0 && (
                  <section>
                    <h2 className="text-xl font-black uppercase tracking-tight text-white mb-4">Schedule</h2>
                    <div className="space-y-2">
                      {days.map((day: any, i: number) => (
                        <div key={day.id} className="flex items-center gap-4 p-4 rounded-xl border border-white/10 bg-white/5">
                          <div className="w-9 h-9 rounded-full bg-[#1d4ed8]/20 border border-[#1d4ed8]/30 flex items-center justify-center text-[#60a5fa] text-sm font-black flex-shrink-0">
                            {i + 1}
                          </div>
                          <div>
                            <div className="font-semibold text-white">{format(new Date(day.date + "T12:00:00"), "EEEE, MMMM d, yyyy")}</div>
                            <div className="text-sm text-white/40 flex items-center gap-1 mt-0.5">
                              <Clock className="h-3.5 w-3.5" />
                              {day.startTime} – {day.endTime}
                              {day.notes && <span className="ml-2">· {day.notes}</span>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {coaches && coaches.length > 0 && (
                  <section>
                    <h2 className="text-xl font-black uppercase tracking-tight text-white mb-4">Coaching Staff</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {coaches.map((a: any) => (
                        <div key={a.id} className="flex items-center gap-3 p-4 rounded-xl border border-white/10 bg-white/5">
                          <div className="w-10 h-10 rounded-full bg-[#1d4ed8]/20 border border-[#1d4ed8]/30 flex items-center justify-center text-[#60a5fa] font-black text-sm flex-shrink-0">
                            {a.user?.firstName?.[0]}{a.user?.lastName?.[0]}
                          </div>
                          <div>
                            <div className="font-semibold text-white">{a.user?.firstName} {a.user?.lastName}</div>
                            <div className="text-xs text-white/40 capitalize">{a.role?.replace("_", " ")}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Bottom meta info for mobile */}
                <div className="block lg:hidden rounded-2xl border border-white/10 bg-[#111118] p-5 space-y-3">
                  {days?.length > 0 && (
                    <div className="flex items-start gap-3">
                      <Calendar className="h-4 w-4 text-white/30 mt-0.5 flex-shrink-0" />
                      <div className="text-sm">
                        <div className="font-medium text-white">Camp Schedule</div>
                        <div className="text-white/40">{days.length} day{days.length !== 1 ? "s" : ""} of training</div>
                      </div>
                    </div>
                  )}
                </div>
              </SectionEntry>

              {/* Right column: registration card */}
              <SectionEntry delay={0.15} direction="right">
                <div className="sticky top-24 rounded-2xl overflow-hidden border border-white/10 bg-[#111118] shadow-[0_8px_32px_rgba(0,0,0,0.6)]">
                  <div className="bg-white/5 border-b border-white/10 px-5 py-4">
                    <p className="text-xs text-white/30 uppercase tracking-widest font-bold">Registration</p>
                  </div>
                  <div className="px-5 py-5 space-y-5">
                    {/* Price */}
                    <div className="pb-5 border-b border-white/10">
                      <div className="text-xs text-white/30 uppercase tracking-wider mb-2">Price</div>
                      {pricing ? (
                        <PriceBadge
                          price={camp.price}
                          resolvedPrice={pricing.resolvedPrice}
                          earlyBirdPrice={pricing.earlyBirdPrice}
                          earlyBirdCutoff={pricing.earlyBirdCutoff}
                          lateFee={pricing.lateFee}
                        />
                      ) : (
                        <div className="text-3xl font-black text-[#60a5fa]">${Number(camp.price).toFixed(2)}</div>
                      )}
                    </div>

                    {/* Meta info — unique details not already in compact header */}
                    {camp.registrationDeadline && (
                      <div className="space-y-3 pb-5 border-b border-white/10">
                        <div className="flex items-start gap-3">
                          <Clock className="h-4 w-4 text-white/30 mt-0.5 flex-shrink-0" />
                          <div className="text-sm">
                            <div className="font-medium text-white">Registration Deadline</div>
                            <div className="text-white/40">{format(new Date(camp.registrationDeadline), "MMM d, yyyy h:mm a")}</div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Registration state machine */}
                    {activeReg ? (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-emerald-400 font-semibold">
                          <CheckCircle2 className="h-5 w-5" /> You're registered!
                        </div>
                        <div className="text-sm text-white/50 space-y-1">
                          <div>Status: <span className="font-medium capitalize text-white">{activeReg.status}</span></div>
                          <div>Payment: <span className="font-medium capitalize text-white">{activeReg.paymentStatus}</span></div>
                          {activeReg.balanceDue > 0 && (
                            <div className="text-amber-400 font-medium flex items-center gap-1">
                              <AlertCircle className="h-4 w-4" />Balance due: ${Number(activeReg.balanceDue).toFixed(2)}
                            </div>
                          )}
                        </div>
                          {isAdmin && (
                          <Button variant="outline" size="sm" className="w-full border-white/20 text-white hover:bg-white/10" asChild>
                            <a href="/admin/camps">Manage in Admin ↗</a>
                          </Button>
                        )}
                      </div>
                    ) : (
                      <>
                        <Show when="signed-out">
                          <Button className="w-full h-12 text-base font-semibold bg-[#dc2626] hover:bg-[#b91c1c] border-none" asChild>
                            <Link href="/sign-in">Sign in to Register</Link>
                          </Button>
                        </Show>

                        <Show when="signed-in">
                          {/* ── STEP: idle ── */}
                          {step === "idle" && (
                            <div className="space-y-3">
                              {!canRegister ? (
                                <Button className="w-full h-12 text-base" disabled>
                                  {!isActive ? "Not Currently Active" : isFull ? "Camp is Full" : !camp.registrationOpen ? "Registration Closed" : "Camp Ended"}
                                </Button>
                              ) : (
                                <>
                                  {pricing?.siblingDiscountPct && isYouth && (
                                    <div className="text-sm">
                                      <div className="font-medium text-white mb-1">Sibling discount available</div>
                                      <select
                                        className="w-full h-9 rounded-xl border border-white/10 bg-white/5 text-white px-3 text-sm focus:border-[#1d4ed8] focus:outline-none"
                                        value={siblingNumber}
                                        onChange={e => setSiblingNumber(Number(e.target.value))}
                                      >
                                        <option value={1} className="bg-[#111118]">1st child (full price)</option>
                                        <option value={2} className="bg-[#111118]">2nd child ({pricing.siblingDiscountPct}% off)</option>
                                        <option value={3} className="bg-[#111118]">3rd+ child ({pricing.siblingDiscountPct}% off)</option>
                                      </select>
                                    </div>
                                  )}
                                  {pricing?.installmentPlan && Number(camp?.price ?? 0) > 0 && (
                                    <label className="flex items-center gap-2 cursor-pointer py-1">
                                      <input
                                        type="checkbox"
                                        checked={useInstallment}
                                        onChange={e => setUseInstallment(e.target.checked)}
                                        className="rounded"
                                      />
                                      <span className="text-sm text-white/70">
                                        Pay in {pricing.installmentCount ?? 3} installments (~${(Number(resolvedPrice) / (pricing.installmentCount ?? 3)).toFixed(2)}/installment)
                                      </span>
                                    </label>
                                  )}
                                  <Button className="w-full h-12 text-base font-semibold bg-[#1d4ed8] hover:bg-[#1e40af] border-none" onClick={() => ensureProfile(startRegistration)}>
                                    Register — ${Number(resolvedPrice).toFixed(2)}
                                  </Button>
                                  {isYouth && (
                                    <p className="text-xs text-white/30 text-center flex items-center justify-center gap-1">
                                      <Baby className="h-3.5 w-3.5" />Youth camp — guardian must complete registration
                                    </p>
                                  )}
                                </>
                              )}
                            </div>
                          )}

                          {/* ── STEP: child_select (youth only) ── */}
                          {step === "child_select" && (
                            <div className="space-y-4">
                              <div className="font-semibold text-white flex items-center gap-2">
                                <Baby className="h-4 w-4 text-[#60a5fa]" />Select Your Child
                              </div>
                              <p className="text-xs text-white/40">
                                Only age-eligible children are shown. Their age is verified against the camp's requirements.
                              </p>
                              <ParticipantSelector
                                ageGroups={Array.isArray(camp.ageGroup) ? camp.ageGroup : [camp.ageGroup]}
                                eventStartDate={camp.startDate ?? null}
                                value={selectedChild ? { id: selectedChild.id, firstName: selectedChild.firstName, lastName: selectedChild.lastName, isChild: selectedChild.isChild ?? true } : null}
                                onChange={(p) => setSelectedChild(p ? { id: p.id, firstName: p.firstName, lastName: p.lastName, isChild: p.isChild } : null)}
                                currentUserId={profile?.id ?? null}
                                currentUserProfile={profile ? { id: profile.id, firstName: profile.firstName ?? "", lastName: profile.lastName ?? "" } : null}
                                enabled={step === "child_select"}
                              />
                              <div className="flex gap-2">
                                <Button variant="outline" className="flex-1 border-white/20 text-white hover:bg-white/10" onClick={() => setStep("idle")}>Back</Button>
                                <Button className="flex-1 bg-[#1d4ed8] hover:bg-[#1e40af] border-none" disabled={!selectedChild} onClick={() => setStep("waiver")}>
                                  Continue
                                </Button>
                              </div>
                            </div>
                          )}

                          {/* ── STEP: waiver ── */}
                          {step === "waiver" && (
                            <div className="space-y-4">
                              {selectedChild && (
                                <div className="text-sm bg-white/5 border border-white/10 rounded-xl p-2 flex items-center gap-2 text-white/60">
                                  <Baby className="h-4 w-4 text-white/30 flex-shrink-0" />
                                  Registering: <span className="font-medium text-white">{selectedChild.firstName} {selectedChild.lastName}</span>
                                </div>
                              )}
                              {!selectedChild && idData?.hasIdData && (
                                <div className="flex items-center gap-2 rounded-xl border bg-emerald-500/5 border-emerald-500/20 px-3 py-2 text-sm">
                                  <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
                                  <span className="text-white/50">Signing as:</span>
                                  <span className="font-medium text-white">
                                    {[idData.firstName, idData.lastName].filter(Boolean).join(" ")}
                                  </span>
                                  {idData.dateOfBirth && (
                                    <span className="text-white/30 text-xs ml-auto">DOB: {idData.dateOfBirth}</span>
                                  )}
                                </div>
                              )}
                              <div>
                                <div className="font-semibold mb-2 flex items-center gap-2 text-white"><ShieldCheck className="h-4 w-4 text-[#60a5fa]" />Liability Waiver</div>
                                <div className="text-xs text-white/40 bg-white/5 border border-white/10 rounded-xl p-3 max-h-32 overflow-y-auto leading-relaxed">
                                  By registering for this camp, I acknowledge that futsal involves physical activity and accept the inherent risks. I release the Alumni Center, its staff, coaches, and volunteers from any liability for injuries or damages arising from camp participation. I confirm that the participant is physically fit and has no medical conditions that would prevent safe participation. I grant permission to receive emergency medical treatment if necessary. This waiver is binding for the participant and their heirs.
                                </div>
                              </div>
                              <label className="flex items-start gap-2 cursor-pointer">
                                <input type="checkbox" className="mt-0.5 accent-[#1d4ed8]" checked={waiverAccepted} onChange={e => setWaiverAccepted(e.target.checked)} />
                                <span className="text-sm text-white/70">I have read and accept the liability waiver{isYouth ? " on behalf of the participant" : ""}</span>
                              </label>
                              {isYouth && (
                                <div className="space-y-2">
                                  <div className="font-semibold text-sm flex items-center gap-2 text-white"><Camera className="h-4 w-4 text-[#60a5fa]" />Photo &amp; Media Consent</div>
                                  <p className="text-xs text-white/40">Do you consent to the participant being photographed or filmed for Alumni Center promotional use?</p>
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => setPhotoConsent(true)}
                                      className={`flex-1 py-2 rounded-xl border text-sm font-medium transition-all duration-200 ${
                                        photoConsent === true
                                          ? "border-[#1d4ed8] bg-[#1d4ed8]/20 text-[#60a5fa]"
                                          : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
                                      }`}
                                    >
                                      ✓ Yes, I consent
                                    </button>
                                    <button
                                      onClick={() => setPhotoConsent(false)}
                                      className={`flex-1 py-2 rounded-xl border text-sm font-medium transition-all duration-200 ${
                                        photoConsent === false
                                          ? "border-red-500/50 bg-red-500/10 text-red-400"
                                          : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
                                      }`}
                                    >
                                      ✗ No thanks
                                    </button>
                                  </div>
                                </div>
                              )}
                              <div className="flex gap-2">
                                <Button variant="outline" className="flex-1 border-white/20 text-white hover:bg-white/10" onClick={() => isYouth ? setStep("child_select") : setStep("idle")}>Back</Button>
                                <Button
                                  className="flex-1 bg-[#1d4ed8] hover:bg-[#1e40af] border-none"
                                  disabled={!waiverAccepted || (isYouth && photoConsent === null)}
                                  onClick={() => setStep("details")}
                                >
                                  Continue
                                </Button>
                              </div>
                            </div>
                          )}

                          {/* ── STEP: details (skill level + shirt size) ── */}
                          {step === "details" && (
                            <div className="space-y-4">
                              <div className="font-semibold text-white flex items-center gap-2">
                                <Star className="h-4 w-4 text-[#60a5fa]" />Camper Details
                              </div>
                              <p className="text-xs text-white/40">Help us personalize the camp experience.</p>

                              <div>
                                <Label className="text-xs text-white/50 uppercase tracking-wider mb-2 block">Skill Level</Label>
                                <div className="grid grid-cols-2 gap-2">
                                  {SKILL_LEVELS.map((lvl) => (
                                    <button
                                      key={lvl}
                                      onClick={() => setSkillLevel(skillLevel === lvl ? "" : lvl)}
                                      className={`py-2 rounded-xl border text-sm font-medium capitalize transition-all duration-200 ${
                                        skillLevel === lvl
                                          ? "border-[#1d4ed8] bg-[#1d4ed8]/20 text-[#60a5fa]"
                                          : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
                                      }`}
                                    >
                                      {lvl}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              <div>
                                <Label className="text-xs text-white/50 uppercase tracking-wider mb-2 block">Shirt Size</Label>
                                <div className="flex flex-wrap gap-2">
                                  {SHIRT_SIZES.map((size) => (
                                    <button
                                      key={size}
                                      onClick={() => setShirtSize(shirtSize === size ? "" : size)}
                                      className={`px-3 py-1.5 rounded-lg border text-sm font-bold transition-all duration-200 ${
                                        shirtSize === size
                                          ? "border-[#1d4ed8] bg-[#1d4ed8]/20 text-[#60a5fa]"
                                          : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
                                      }`}
                                    >
                                      {size}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              <div className="flex gap-2 pt-1">
                                <Button variant="outline" className="flex-1 border-white/20 text-white hover:bg-white/10" onClick={() => isYouth ? setStep("waiver") : setStep("waiver")}>Back</Button>
                                <Button className="flex-1 bg-[#1d4ed8] hover:bg-[#1e40af] border-none" onClick={() => setStep("confirm")}>
                                  Review Registration
                                </Button>
                              </div>
                            </div>
                          )}

                          {/* ── STEP: confirm ── */}
                          {step === "confirm" && (
                            <div className="space-y-4">
                              <div className="font-semibold mb-1 text-white">Confirm Registration</div>
                              <div className="text-sm bg-white/5 border border-white/10 rounded-xl p-3 space-y-2">
                                <div className="flex justify-between text-sm">
                                  <span className="text-white/40">Camp</span>
                                  <span className="font-medium text-white">{camp.name}</span>
                                </div>
                                {selectedChild && (
                                  <div className="flex justify-between text-sm">
                                    <span className="text-white/40">Camper</span>
                                    <span className="font-medium text-white">{selectedChild.firstName} {selectedChild.lastName}</span>
                                  </div>
                                )}
                                <div className="flex justify-between text-sm">
                                  <span className="text-white/40">Age Group</span>
                                  <span className="text-white">{AGE_GROUP_LABELS[camp.ageGroup] ?? camp.ageGroup}</span>
                                </div>
                                {(camp as any).gender && (
                                  <div className="flex justify-between text-sm">
                                    <span className="text-white/40">Gender</span>
                                    <span className="text-white capitalize">{(camp as any).gender}</span>
                                  </div>
                                )}
                                <div className="flex justify-between text-sm">
                                  <span className="text-white/40">Price</span>
                                  <span className="font-black text-[#60a5fa]">${Number(resolvedPrice).toFixed(2)}</span>
                                </div>
                                {pricing?.depositAmount && (
                                  <div className="flex justify-between text-sm">
                                    <span className="text-white/40">Deposit due now</span>
                                    <span className="text-white">${Number(pricing.depositAmount).toFixed(2)}</span>
                                  </div>
                                )}
                                <div className="flex justify-between items-center text-sm">
                                  <span className="text-white/40">Waiver</span>
                                  <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-medium">
                                    <CheckCircle2 className="h-3 w-3" />Accepted
                                  </span>
                                </div>
                                {isYouth && (
                                  <div className="flex justify-between items-center text-sm">
                                    <span className="text-white/40">Photo consent</span>
                                    <span className={`text-xs font-medium ${photoConsent ? "text-emerald-400" : "text-white/30"}`}>
                                      {photoConsent ? "✓ Granted" : "Declined"}
                                    </span>
                                  </div>
                                )}
                              </div>
                              {skillLevel && (
                                <div className="flex justify-between text-sm">
                                  <span className="text-white/40">Skill Level</span>
                                  <span className="text-white capitalize">{skillLevel}</span>
                                </div>
                              )}
                              {shirtSize && (
                                <div className="flex justify-between text-sm">
                                  <span className="text-white/40">Shirt Size</span>
                                  <span className="text-white">{shirtSize}</span>
                                </div>
                              )}
                              <div className="flex gap-2 pt-2">
                                <Button variant="outline" className="flex-1 border-white/20 text-white hover:bg-white/10" onClick={() => setStep("details")}>Back</Button>
                                <Button
                                  className="flex-1 font-semibold bg-[#1d4ed8] hover:bg-[#1e40af] border-none"
                                  onClick={() => register.mutate()}
                                  disabled={register.isPending}
                                >
                                  {register.isPending ? "Confirming…" : "Confirm & Register"}
                                </Button>
                              </div>
                              <p className="text-xs text-white/25 text-center">Payment will be collected separately. Your spot is reserved.</p>
                            </div>
                          )}
                        </Show>
                      </>
                    )}
                  </div>
                </div>
              </SectionEntry>
            </div>
          </div>
        </div>
      </div>
      {WaiverModalElement}
      {installPayment && (
        <InlinePaymentDialog
          open={true}
          clientSecret={installPayment.clientSecret}
          publishableKey={installPayment.publishableKey}
          amount={installPayment.amount}
          onSuccess={() => {
            setInstallPayment(null);
            toast({ title: "First installment paid!", description: "Your installment plan is active." });
          }}
          onCancel={() => setInstallPayment(null)}
        />
      )}
    </Layout>
  );
}
