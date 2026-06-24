import React, { useEffect, useState } from "react";
import { useAuth } from "@clerk/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Users, Calendar, DollarSign, Star, Loader2, Baby, Trophy,
  PlusCircle, AlertCircle, ChevronRight, QrCode, UserPlus,
  ArrowLeft, CheckCircle2, Clock, Tent, Sun, X, CreditCard,
} from "lucide-react";
import { InlinePaymentDialog } from "@/components/inline-payment-dialog";
import { Link } from "wouter";
import { WaiverSignature, type SignatureResult } from "@/components/waiver-signature";
import QRCode from "qrcode";
import { format } from "date-fns";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

interface UpcomingEvent {
  type: string;
  childName: string;
  description: string;
  scheduledAt: string | null;
  entityId?: number;
  entityType?: string;
}

interface Child {
  youthUserId: number;
  firstName: string | null;
  lastName: string | null;
  relationship: string;
  dateOfBirth: string | null;
  registrations: number;
  campRegistrations: number;
  upcomingEvent: UpcomingEvent | null;
  unpaidCount: number;
}

interface Balance {
  youthUserId: number | null;
  childName: string;
  type: string;
  programName: string;
  paymentStatus: string;
  amountPaid: string;
  programId: number | null;
  registrationId: number | null;
  spotId: number | null;
  poolId: number | null;
  campRegId?: number | null;
}

interface Recap {
  id: number;
  userId: number;
  seasonLabel: string;
  gamesPlayed: number;
  gamesAttended: number;
  attendanceRate: string | null;
  coachNote: string | null;
  positiveHighlight: string | null;
  createdAt: string;
}

interface FamilyDashboard {
  children: Child[];
  upcomingThisWeek: UpcomingEvent[];
  outstandingBalances: Balance[];
  recentRecaps: Recap[];
}

interface TodayEvent {
  type: string;
  id: number;
  name: string;
  dayId?: number | null;
  date?: string;
  startTime?: string | null;
  endTime?: string | null;
  checkedIn: boolean;
}

interface ChildQrData {
  youthUserId: number;
  firstName: string | null;
  lastName: string | null;
  relationship: string;
  isPrimary: boolean;
  qrCode: string | null;
  playonId: string | null;
  todayEvents: TodayEvent[];
  hasEventsToday: boolean;
}

interface WaiverTemplate {
  id: number;
  name: string;
  version: number;
  body: string;
}

interface ActiveCheckIn {
  entityType: string;
  entityId: number;
  eventName: string | null;
  eventType: string | null;
  checkedInAt: string;
  endsAt: string | null;
  childName?: string;
}

type CreateStep = 1 | 2 | 3;

const EMPTY_FORM = {
  firstName: "",
  lastName: "",
  dateOfBirth: "",
  gender: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  emergencyContactRelationship: "",
  relationship: "parent",
};

const RELATIONSHIP_OPTIONS = ["parent", "guardian", "grandparent", "sibling", "other"];

function childName(c: { firstName: string | null; lastName: string | null; youthUserId?: number }) {
  return [c.firstName, c.lastName].filter(Boolean).join(" ") || "Child";
}

function formatDate(dt: string | null) {
  if (!dt) return "TBD";
  return new Date(dt).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function StepIndicator({ step }: { step: CreateStep }) {
  const steps = [
    { num: 1, label: "Name & DOB" },
    { num: 2, label: "Emergency contact" },
    { num: 3, label: "Consent" },
  ];
  return (
    <div className="flex items-center gap-1 mb-6">
      {steps.map((s, i) => (
        <React.Fragment key={s.num}>
          <div className="flex items-center gap-1.5">
            <div className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
              step >= s.num ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}>
              {step > s.num ? <CheckCircle2 className="h-3.5 w-3.5" /> : s.num}
            </div>
            <span className={`text-xs hidden sm:block ${step === s.num ? "text-foreground font-medium" : "text-muted-foreground"}`}>
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className={`flex-1 h-px mx-1 ${step > s.num ? "bg-primary" : "bg-muted"}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

function hasOverlappingEvents(events: TodayEvent[]): boolean {
  if (events.length <= 1) return false;
  const times = events
    .map(e => e.startTime)
    .filter((t): t is string => t != null)
    .map(t => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m;
    });
  for (let i = 0; i < times.length; i++) {
    for (let j = i + 1; j < times.length; j++) {
      if (Math.abs(times[i] - times[j]) < 120) return true;
    }
  }
  return false;
}

function ChildQrModal({ child, open, onClose }: {
  child: ChildQrData | null;
  open: boolean;
  onClose: () => void;
}) {
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [selectedEventIdx, setSelectedEventIdx] = useState<number>(0);
  const name = child ? childName(child) : "";

  useEffect(() => {
    if (!open || !child?.qrCode) { setQrDataUrl(""); return; }
    QRCode.toDataURL(child.qrCode, {
      width: 220,
      margin: 2,
      color: { dark: "#1E2829", light: "#FFFFFF" },
    }).then(setQrDataUrl).catch(() => {});
  }, [open, child?.qrCode]);

  if (!child) return null;

  const checkedIn = child.todayEvents.some(e => e.checkedIn);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="h-4 w-4 text-primary" />
            {name}'s Check-in QR
          </DialogTitle>
        </DialogHeader>

        {child.hasEventsToday && (
          <div className="flex items-center gap-2 rounded-xl bg-blue-500/10 border border-blue-500/20 px-3 py-2 text-sm">
            <Sun className="h-4 w-4 text-blue-500 shrink-0" />
            <span className="text-blue-700 text-xs">
              {child.todayEvents.length} event{child.todayEvents.length !== 1 ? "s" : ""} today · {format(new Date(), "EEEE, MMMM d")}
            </span>
          </div>
        )}

        {child.qrCode ? (
          <div className="flex flex-col items-center gap-4">
            <div className="bg-white p-4 rounded-2xl shadow-sm">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt={`QR code for ${name}`}
                  className="w-[200px] h-[200px]"
                  style={{ imageRendering: "pixelated" }}
                />
              ) : (
                <div className="w-[200px] h-[200px] flex items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>

            <div className="text-center">
              <p className="font-semibold">{name}</p>
              {child.playonId && (
                <p className="text-xs text-muted-foreground font-mono mt-0.5">{child.playonId}</p>
              )}
              {checkedIn && (
                <Badge className="mt-1 bg-green-500 text-white text-xs">Checked in</Badge>
              )}
            </div>

            {child.todayEvents.length > 0 && (
              <div className="w-full space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Today's Events</p>

                {hasOverlappingEvents(child.todayEvents) && !child.todayEvents.every(e => e.checkedIn) && (
                  <div className="rounded-lg border bg-amber-500/10 border-amber-500/20 p-3 space-y-2">
                    <p className="text-xs font-medium text-amber-700">
                      Multiple events overlap — which one is {child.firstName ?? "this child"} heading to?
                    </p>
                    <div className="space-y-1">
                      {child.todayEvents.map((ev, i) => (
                        <button
                          key={i}
                          className={`w-full text-left rounded-md px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                            selectedEventIdx === i
                              ? "bg-primary text-primary-foreground"
                              : "bg-background border hover:bg-muted"
                          }`}
                          onClick={() => setSelectedEventIdx(i)}
                        >
                          <span className="flex-1 font-medium">{ev.name}</span>
                          {ev.startTime && <span className="text-xs opacity-70">{ev.startTime}</span>}
                          {ev.checkedIn && <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {child.todayEvents.map((ev, i) => (
                  <div
                    key={i}
                    className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                      ev.checkedIn
                        ? "bg-green-500/10 border border-green-500/20"
                        : "bg-background border"
                    }`}
                  >
                    <div>
                      <span className="font-medium">{ev.name}</span>
                      {ev.startTime && <span className="text-muted-foreground ml-2 text-xs">{ev.startTime}</span>}
                    </div>
                    {ev.checkedIn ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <span className="text-xs text-muted-foreground">Pending</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            <p className="text-xs text-muted-foreground text-center">
              Show this QR code to the coach or staff member at check-in
            </p>
          </div>
        ) : (
          <div className="text-center py-4">
            <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No QR code found for this player.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Ask the player to log in and complete their player profile.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function FamilyDashboard() {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [showWizard, setShowWizard] = useState(false);
  const [showLinkById, setShowLinkById] = useState(false);
  const [step, setStep] = useState<CreateStep>(1);
  const [form, setForm] = useState(EMPTY_FORM);
  const [fieldError, setFieldError] = useState("");
  const [consentChecked, setConsentChecked] = useState(false);
  const [signatureResult, setSignatureResult] = useState<SignatureResult | null>(null);

  const [linkForm, setLinkForm] = useState({ youthUserId: "", relationship: "parent", notes: "" });

  const [qrModalChildId, setQrModalChildId] = useState<number | null>(null);
  const [paymentData, setPaymentData] = useState<{
    clientSecret: string;
    publishableKey: string;
    amount: number;
    basePrice: number;
    serviceFeeAmount: number;
    label: string;
  } | null>(null);
  const [payingBalanceIdx, setPayingBalanceIdx] = useState<number | null>(null);

  const { data, isLoading, refetch } = useQuery<FamilyDashboard>({
    queryKey: ["family-dashboard-page"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/family-dashboard`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to load family dashboard");
      }
      return res.json();
    },
  });

  const { data: qrData } = useQuery<{ children: ChildQrData[] }>({
    queryKey: ["children-qr-today"],
    queryFn: async () => {
      const token = await getToken();
      const r = await fetch(`${API_BASE}/me/children-qr-today`, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      if (!r.ok) throw new Error("Failed to load QR data");
      return r.json();
    },
    refetchInterval: 60000,
  });

  const { data: activeCheckInsData } = useQuery<{ checkIns: ActiveCheckIn[] }>({
    queryKey: ["family-active-checkins"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/checkin/my-active?familyMode=true`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { checkIns: [] };
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const activeCheckIns = activeCheckInsData?.checkIns ?? [];

  const { data: waiverTemplate, isLoading: waiverLoading, error: waiverError } = useQuery<WaiverTemplate>({
    queryKey: ["waiver", "active"],
    queryFn: async () => {
      const token = await getToken();
      const r = await fetch(`${API_BASE}/waivers/active`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error("Failed to load waiver");
      return r.json();
    },
    staleTime: 10 * 60 * 1000,
    retry: 2,
    enabled: showWizard,
  });

  function openWizard() {
    setForm(EMPTY_FORM);
    setConsentChecked(false);
    setSignatureResult(null);
    setStep(1);
    setFieldError("");
    setShowWizard(true);
  }

  function closeWizard() {
    setShowWizard(false);
    setForm(EMPTY_FORM);
    setConsentChecked(false);
    setSignatureResult(null);
    setStep(1);
    setFieldError("");
  }

  function validateStep1() {
    if (!form.firstName.trim()) return "First name is required.";
    if (!form.lastName.trim()) return "Last name is required.";
    return null;
  }

  function validateStep2() {
    if (!form.emergencyContactName.trim()) return "Emergency contact name is required.";
    if (!form.emergencyContactPhone.trim()) return "Emergency contact phone is required.";
    return null;
  }

  function handleNext() {
    if (step === 1) {
      const err = validateStep1();
      if (err) { setFieldError(err); return; }
      setFieldError("");
      setStep(2);
    } else if (step === 2) {
      const err = validateStep2();
      if (err) { setFieldError(err); return; }
      setFieldError("");
      setStep(3);
    }
  }

  const createChild = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/youth`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          dateOfBirth: form.dateOfBirth.trim() || undefined,
          gender: form.gender.trim() || undefined,
          emergencyContactName: form.emergencyContactName.trim(),
          emergencyContactPhone: form.emergencyContactPhone.trim(),
          emergencyContactRelationship: form.emergencyContactRelationship.trim() || undefined,
          relationship: form.relationship,
          guardianConsentGiven: true,
          signatureData: signatureResult!.data,
          signatureType: signatureResult!.mode,
          templateId: waiverTemplate!.id,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Could not add your child. Please try again.");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["family-dashboard-page"] });
      queryClient.invalidateQueries({ queryKey: ["children-qr-today"] });
      closeWizard();
      toast({ title: `${data.youth?.firstName ?? "Child"} added!`, description: "Their profile is now linked to your account." });
    },
    onError: (err: Error) => {
      setFieldError(err.message);
    },
  });

  function handleSubmit() {
    if (!consentChecked) {
      setFieldError("Please read and agree to the waiver before continuing.");
      return;
    }
    if (!signatureResult) {
      setFieldError("Please provide your signature before continuing.");
      return;
    }
    if (!waiverTemplate) {
      setFieldError("Waiver not loaded yet. Please wait a moment and try again.");
      return;
    }
    setFieldError("");
    createChild.mutate();
  }

  const addLink = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/guardians`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          youthUserId: parseInt(linkForm.youthUserId, 10),
          relationship: linkForm.relationship,
          canRegister: true,
          canPickup: true,
          isPrimary: false,
          notes: linkForm.notes || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to send link request");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["family-dashboard-page"] });
      setLinkForm({ youthUserId: "", relationship: "parent", notes: "" });
      setShowLinkById(false);
      toast({ title: "Link request sent", description: "An admin will review and approve the request." });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to send request", description: err.message, variant: "destructive" });
    },
  });

  const checkoutBalanceMutation = useMutation({
    mutationFn: async (b: Balance & { _idx: number }) => {
      const token = await getToken();
      if (b.type === "drop_in" && b.spotId) {
        const res = await fetch(`${API_BASE}/dropins/spots/${b.spotId}/pay`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Checkout failed");
        return { ...body, label: `Pay — ${b.programName}` };
      } else {
        const res = await fetch(`${API_BASE}/checkout/session`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            programType: b.type,
            programId: b.programId,
            ...(b.registrationId ? { registrationId: b.registrationId } : {}),
            ...(b.campRegId != null ? { campRegId: b.campRegId } : {}),
          }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Checkout failed");
        return { ...body, label: `Pay — ${b.programName}` };
      }
    },
    onSuccess: (data) => {
      setPayingBalanceIdx(null);
      setPaymentData({
        clientSecret: data.clientSecret,
        publishableKey: data.publishableKey,
        amount: data.amount,
        basePrice: data.basePrice ?? data.amount,
        serviceFeeAmount: data.serviceFeeAmount ?? 0,
        label: data.label,
      });
    },
    onError: (err: Error) => {
      setPayingBalanceIdx(null);
      toast({ title: "Checkout failed", description: err.message, variant: "destructive" });
    },
  });

  function handlePaymentSuccess() {
    setPaymentData(null);
    queryClient.invalidateQueries({ queryKey: ["family-dashboard-page"] });
    toast({ title: "Payment confirmed!", description: "Your balance has been cleared." });
  }

  const qrModalChild = qrData?.children.find(c => c.youthUserId === qrModalChildId) ?? null;

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-5xl">

        {/* Header */}
        <div className="mb-8 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Users className="h-7 w-7 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">My Family</h1>
              <p className="text-muted-foreground text-sm">Schedules, balances, and check-in QR codes for your children.</p>
            </div>
          </div>
          <Button onClick={openWizard} className="flex items-center gap-2">
            <PlusCircle className="h-4 w-4" />
            Add Child
          </Button>
        </div>

        {/* Add Child Wizard Dialog */}
        <Dialog open={showWizard} onOpenChange={(o) => !o && closeWizard()}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add your child</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground -mt-2 mb-2">
              We'll create their profile and link it to your account.
            </p>

            <StepIndicator step={step} />

            <div className="space-y-4">
              {step === 1 && (
                <>
                  <h2 className="font-semibold">What's your child's name and date of birth?</h2>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="firstName">First name <span className="text-destructive">*</span></Label>
                      <Input id="firstName" placeholder="Alex" value={form.firstName} onChange={(e) => setForm(f => ({ ...f, firstName: e.target.value }))} autoFocus />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="lastName">Last name <span className="text-destructive">*</span></Label>
                      <Input id="lastName" placeholder="Smith" value={form.lastName} onChange={(e) => setForm(f => ({ ...f, lastName: e.target.value }))} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="dob">Date of birth <span className="text-muted-foreground text-xs">(optional)</span></Label>
                    <Input id="dob" placeholder="MM/DD/YYYY" value={form.dateOfBirth} onChange={(e) => setForm(f => ({ ...f, dateOfBirth: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="gender">Gender <span className="text-muted-foreground text-xs">(optional)</span></Label>
                    <select
                      id="gender"
                      value={form.gender}
                      onChange={(e) => setForm(f => ({ ...f, gender: e.target.value }))}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">Prefer not to say</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="non_binary">Non-binary</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </>
              )}

              {step === 2 && (
                <>
                  <h2 className="font-semibold">Emergency contact</h2>
                  <p className="text-sm text-muted-foreground -mt-2">Who should we reach in case of an emergency?</p>
                  <div className="space-y-1.5">
                    <Label htmlFor="ecName">Contact name <span className="text-destructive">*</span></Label>
                    <Input id="ecName" placeholder="Jane Smith" value={form.emergencyContactName} onChange={(e) => setForm(f => ({ ...f, emergencyContactName: e.target.value }))} autoFocus />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ecPhone">Phone number <span className="text-destructive">*</span></Label>
                    <PhoneInput id="ecPhone" value={form.emergencyContactPhone} onChange={(formatted) => setForm(f => ({ ...f, emergencyContactPhone: formatted }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ecRel">Relationship to child <span className="text-muted-foreground text-xs">(optional)</span></Label>
                    <Input id="ecRel" placeholder="Mother / Father / Grandparent" value={form.emergencyContactRelationship} onChange={(e) => setForm(f => ({ ...f, emergencyContactRelationship: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5 pt-2 border-t">
                    <Label htmlFor="relationship">Your relationship to this child</Label>
                    <select
                      id="relationship"
                      value={form.relationship}
                      onChange={(e) => setForm(f => ({ ...f, relationship: e.target.value }))}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {RELATIONSHIP_OPTIONS.map(r => (
                        <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {step === 3 && (
                <>
                  <h2 className="font-semibold">Confirm your consent</h2>
                  <p className="text-sm text-muted-foreground -mt-2">
                    Before we create {form.firstName || "your child"}'s profile, please read the waiver and sign below.
                  </p>
                  {waiverLoading ? (
                    <div className="rounded-xl border p-6 flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      <span className="text-muted-foreground text-sm">Loading waiver…</span>
                    </div>
                  ) : waiverError || !waiverTemplate ? (
                    <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
                      <p className="text-destructive text-sm">Failed to load the waiver document. Please go back and try again.</p>
                    </div>
                  ) : (
                    <WaiverSignature
                      waiverText={waiverTemplate.body}
                      waiverName={`${waiverTemplate.name} (v${waiverTemplate.version})`}
                      isForChild={true}
                      onSignatureChange={setSignatureResult}
                      onAgreedChange={setConsentChecked}
                      agreed={consentChecked}
                      disabled={createChild.isPending}
                    />
                  )}
                </>
              )}

              {fieldError && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {fieldError}
                </div>
              )}

              <div className="flex justify-between gap-3 pt-1">
                {step > 1 ? (
                  <Button variant="outline" onClick={() => { setStep(s => (s - 1) as CreateStep); setFieldError(""); }}>
                    Back
                  </Button>
                ) : (
                  <Button variant="outline" onClick={closeWizard}>Cancel</Button>
                )}
                {step < 3 ? (
                  <Button onClick={handleNext}>Continue</Button>
                ) : (
                  <Button
                    onClick={handleSubmit}
                    disabled={createChild.isPending || waiverLoading || !!waiverError || !waiverTemplate || !consentChecked || !signatureResult}
                  >
                    {createChild.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-1" />Adding…</> : `Add ${form.firstName || "child"}`}
                  </Button>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Link by ID Dialog */}
        <Dialog open={showLinkById} onOpenChange={(o) => { if (!o) { setShowLinkById(false); setLinkForm({ youthUserId: "", relationship: "parent", notes: "" }); } }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Link an existing account</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              If a player profile already exists (for example, an existing PlayOn member), you can link it to your guardian account using their account ID. An admin will review the request before it's approved.
            </p>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="linkId">Player account ID</Label>
                <Input
                  id="linkId"
                  type="number"
                  placeholder="e.g. 1042"
                  value={linkForm.youthUserId}
                  onChange={(e) => setLinkForm(f => ({ ...f, youthUserId: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="linkRel">Your relationship</Label>
                <select
                  id="linkRel"
                  value={linkForm.relationship}
                  onChange={(e) => setLinkForm(f => ({ ...f, relationship: e.target.value }))}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {RELATIONSHIP_OPTIONS.map(r => (
                    <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="linkNotes">Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Input
                  id="linkNotes"
                  placeholder="Any relevant notes for the admin"
                  value={linkForm.notes}
                  onChange={(e) => setLinkForm(f => ({ ...f, notes: e.target.value }))}
                />
              </div>
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => { setShowLinkById(false); setLinkForm({ youthUserId: "", relationship: "parent", notes: "" }); }}>
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  disabled={!linkForm.youthUserId || addLink.isPending}
                  onClick={() => addLink.mutate()}
                >
                  {addLink.isPending ? "Sending…" : "Send link request"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* QR Code Modal */}
        <ChildQrModal
          child={qrModalChild}
          open={qrModalChildId !== null}
          onClose={() => setQrModalChildId(null)}
        />

        {/* Empty state */}
        {!data || data.children.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Baby className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h2 className="text-lg font-semibold mb-2">No children linked yet</h2>
              <p className="text-muted-foreground text-sm mb-6">
                Add your children to see their schedules and balances here.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Button onClick={openWizard} className="flex items-center gap-2">
                  <PlusCircle className="h-4 w-4" />
                  Add your first child
                </Button>
                <Button variant="outline" onClick={() => setShowLinkById(true)} className="flex items-center gap-2">
                  <UserPlus className="h-4 w-4" />
                  Link by ID
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Checked in today */}
            {activeCheckIns.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  Checked In Today
                </h3>
                {(() => {
                  const byChild = new Map<string, ActiveCheckIn[]>();
                  for (const ci of activeCheckIns) {
                    const key = ci.childName ?? "__self__";
                    if (!byChild.has(key)) byChild.set(key, []);
                    byChild.get(key)!.push(ci);
                  }
                  return [...byChild.entries()].map(([name, cis]) => (
                    <div key={name}>
                      {name !== "__self__" && (
                        <p className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1.5">
                          <Baby className="h-3 w-3" />
                          {name}
                        </p>
                      )}
                      <div className="space-y-2">
                        {cis.map((ci, i) => (
                          <div key={i} className="bg-green-500/8 border border-green-500/25 border-l-4 border-l-green-500 rounded-xl p-4 flex items-center gap-4">
                            <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold text-sm text-foreground">{ci.eventName ?? "Event"}</p>
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                {ci.eventType && (
                                  <span className="text-[11px] font-semibold uppercase bg-green-500/15 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full">
                                    {ci.eventType}
                                  </span>
                                )}
                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  Checked in {format(new Date(ci.checkedInAt), "h:mm a")}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ));
                })()}
              </div>
            )}

            {/* Children cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {data.children.map((c) => {
                const qrChild = qrData?.children.find(q => q.youthUserId === c.youthUserId);
                const hasEventsToday = qrChild?.hasEventsToday ?? false;
                return (
                  <Card key={c.youthUserId} className="bg-muted/20 hover:bg-muted/30 transition-colors h-full flex flex-col">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2">
                          <Baby className="h-4 w-4 text-primary" />
                          {childName(c)}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setQrModalChildId(c.youthUserId)}
                            className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                            title="Show QR code"
                          >
                            <QrCode className="h-4 w-4" />
                          </button>
                          <Link href={`/guardian/children/${c.youthUserId}`}>
                            <button className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                              <ChevronRight className="h-4 w-4" />
                            </button>
                          </Link>
                        </div>
                      </CardTitle>
                      <p className="text-xs text-muted-foreground capitalize">{c.relationship}</p>
                    </CardHeader>
                    <CardContent className="text-sm space-y-2 flex-1">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Registrations</span>
                        <span className="font-medium">{c.registrations + c.campRegistrations}</span>
                      </div>
                      {c.dateOfBirth && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Date of birth</span>
                          <span className="font-medium">
                            {new Date(c.dateOfBirth).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          </span>
                        </div>
                      )}
                      {c.upcomingEvent && (
                        <div className="mt-2 rounded-md bg-primary/5 border border-primary/10 px-2 py-1.5 text-xs">
                          <span className="text-primary font-medium">Next: </span>
                          <span className="text-foreground">{c.upcomingEvent.description}</span>
                          {c.upcomingEvent.scheduledAt && (
                            <span className="text-muted-foreground block mt-0.5">{formatDate(c.upcomingEvent.scheduledAt)}</span>
                          )}
                        </div>
                      )}
                      {hasEventsToday && (
                        <div className="flex items-center gap-1.5 text-xs text-blue-600">
                          <Tent className="h-3 w-3" />
                          <span>Event today</span>
                        </div>
                      )}
                      {c.unpaidCount > 0 && (
                        <Badge variant="outline" className="text-amber-500 border-amber-500/30 w-full justify-center">
                          {c.unpaidCount} unpaid balance{c.unpaidCount > 1 ? "s" : ""}
                        </Badge>
                      )}
                    </CardContent>
                  </Card>
                );
              })}

              {/* Add another child card */}
              <button
                onClick={openWizard}
                className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/25 p-6 text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors min-h-[140px]"
              >
                <PlusCircle className="h-8 w-8" />
                <span className="text-sm font-medium">Add another child</span>
              </button>
            </div>

            {/* Weekly schedule + Outstanding balances */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-primary" />
                    This week's schedule
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {data.upcomingThisWeek.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nothing scheduled this week.</p>
                  ) : (
                    <ul className="space-y-3">
                      {data.upcomingThisWeek.map((e, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <div className="mt-0.5 h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <Trophy className="h-3.5 w-3.5 text-primary" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">{e.childName}</p>
                            <p className="text-xs text-muted-foreground capitalize">
                              {e.description} · {formatDate(e.scheduledAt)}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-primary" />
                    Outstanding balances
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {data.outstandingBalances.length === 0 ? (
                    <p className="text-sm text-muted-foreground">You're all paid up.</p>
                  ) : (
                    <ul className="space-y-3">
                      {data.outstandingBalances.map((b, i) => {
                        const canPay = b.type === "drop_in" ? !!b.poolId : !!b.programId;
                        const isPaying = payingBalanceIdx === i;
                        return (
                        <li key={i} className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{b.childName}</p>
                            <p className="text-xs text-muted-foreground">{b.programName}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Badge variant="outline" className="text-amber-500 border-amber-500/30">
                              {b.paymentStatus === "partial" ? "Partial" : "Unpaid"}
                            </Badge>
                            {canPay && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs border-amber-400 text-amber-700 hover:bg-amber-50"
                                disabled={isPaying || checkoutBalanceMutation.isPending}
                                onClick={() => {
                                  setPayingBalanceIdx(i);
                                  checkoutBalanceMutation.mutate({ ...b, _idx: i });
                                }}
                              >
                                <CreditCard className="h-3 w-3 mr-1" />
                                {isPaying ? "Loading…" : "Pay Now"}
                              </Button>
                            )}
                          </div>
                        </li>
                        );
                      })}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Season recaps */}
            {data.recentRecaps.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Star className="h-4 w-4 text-primary" />
                    Recent season recaps
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {data.recentRecaps.map((r) => (
                    <div key={r.id} className="rounded-lg border p-4 bg-muted/20">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-semibold text-sm">{r.seasonLabel}</h3>
                        <Badge variant="secondary" className="text-xs">
                          {r.attendanceRate ?? "N/A"} attendance
                        </Badge>
                      </div>
                      <div className="flex gap-4 text-xs text-muted-foreground mb-2">
                        <span>{r.gamesPlayed} games played</span>
                        <span>{r.gamesAttended} attended</span>
                      </div>
                      {r.positiveHighlight && (
                        <p className="text-sm text-foreground mb-1">✨ {r.positiveHighlight}</p>
                      )}
                      {r.coachNote && (
                        <p className="text-sm italic text-muted-foreground">"{r.coachNote}"</p>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Link by ID footer */}
            <div className="text-center pt-4 border-t">
              <button
                onClick={() => setShowLinkById(true)}
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Already have an account ID? Link an existing profile
              </button>
            </div>

            <div className="flex justify-end text-sm">
              <Link href="/notification-preferences">
                <span className="text-primary hover:underline cursor-pointer">Notification preferences →</span>
              </Link>
            </div>
          </div>
        )}
      </div>
      {paymentData && (
        <InlinePaymentDialog
          open={!!paymentData}
          clientSecret={paymentData.clientSecret}
          publishableKey={paymentData.publishableKey}
          amount={paymentData.amount}
          basePrice={paymentData.basePrice}
          serviceFeeAmount={paymentData.serviceFeeAmount}
          title="Complete Payment"
          label={paymentData.label}
          onSuccess={handlePaymentSuccess}
          onCancel={() => setPaymentData(null)}
        />
      )}
    </Layout>
  );
}
