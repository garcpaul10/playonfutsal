import { API_BASE } from "@/lib/api-base";
import React, { useState } from "react";
import { Link, useParams, Redirect } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { useAuth } from "@clerk/react";
import { Layout } from "@/components/layout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, AlertCircle, CalendarDays, Trophy, Tent, Zap, Pencil, ShieldCheck, Clock, CheckCircle, XCircle, Plus, CreditCard } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { InlinePaymentDialog } from "@/components/inline-payment-dialog";


const USYS_AGE_GROUPS = [
  "u8","u9","u10","u11","u12","u13","u14","u15","u16","u17","u18","u19","adult",
];

interface AgeGroupWaiver {
  id: number;
  ageGroup: string;
  reason: string;
  status: string;
  adminNote: string | null;
  createdAt: string;
}

interface ChildDetailData {
  child: {
    id: number;
    firstName: string | null;
    lastName: string | null;
    dateOfBirth: string | null;
    relationship: string;
  };
  registrations: Array<{
    id: number;
    programType: string;
    programName: string | null;
    programId: number;
    status: string;
    paymentStatus: string;
    amountPaid: string;
    createdAt: string;
  }>;
  campRegistrations: Array<{
    id: number;
    campId: number;
    campName: string;
    startDate: string | null;
    endDate: string | null;
    status: string;
    paymentStatus: string;
    pricePaid: string | null;
    createdAt: string;
  }>;
  dropinSpots: Array<{
    id: number;
    dropinName: string;
    dropinId: number;
    poolId: number | null;
    startsAt: string;
    endsAt: string | null;
    status: string;
    paymentStatus: string;
    createdAt: string;
  }>;
}

interface EditForm {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship: string;
  primaryPosition: string;
}

function paymentBadgeClass(status: string) {
  if (status === "paid") return "bg-green-100 text-green-800 border-green-200";
  if (status === "partial") return "bg-yellow-100 text-yellow-800 border-yellow-200";
  return "bg-red-100 text-red-800 border-red-200";
}

function statusColor(status: string) {
  if (status === "approved") return "bg-green-500/10 text-green-600 border-green-500/30";
  if (status === "denied") return "bg-red-500/10 text-red-600 border-red-500/30";
  return "bg-amber-500/10 text-amber-600 border-amber-500/30";
}

function WaiverStatusIcon({ status }: { status: string }) {
  if (status === "approved") return <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />;
  if (status === "denied") return <XCircle className="h-4 w-4 text-red-500 shrink-0" />;
  return <Clock className="h-4 w-4 text-amber-500 shrink-0" />;
}

export default function ChildDetail() {
  const { youthUserId } = useParams<{ youthUserId: string }>();
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [editOpen, setEditOpen] = useState(false);
  const [waiverOpen, setWaiverOpen] = useState(false);
  const [waiverAgeGroup, setWaiverAgeGroup] = useState("");
  const [waiverReason, setWaiverReason] = useState("");
  const [paymentData, setPaymentData] = useState<{
    clientSecret: string;
    publishableKey: string;
    amount: number;
    basePrice: number;
    serviceFeeAmount: number;
    label: string;
  } | null>(null);
  const [payingItemId, setPayingItemId] = useState<string | null>(null);
  const [form, setForm] = useState<EditForm>({
    firstName: "",
    lastName: "",
    dateOfBirth: "",
    gender: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    emergencyContactRelationship: "",
    primaryPosition: "",
  });
  const [saveError, setSaveError] = useState("");

  const { data, isLoading, error } = useQuery<ChildDetailData>({
    queryKey: ["child-detail", youthUserId],
    enabled: !!profile && !!youthUserId,
    queryFn: async () => {
      const res = await fetch(`${import.meta.env.BASE_URL}api/family-dashboard/child/${youthUserId}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to load child detail");
      }
      return res.json();
    },
  });

  const { data: waivers, isLoading: waiversLoading } = useQuery<AgeGroupWaiver[]>({
    queryKey: ["child-age-waivers", youthUserId],
    enabled: !!profile && !!youthUserId,
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/age-group-waivers/player/${youthUserId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const submitWaiverMutation = useMutation({
    mutationFn: async ({ ageGroup, reason }: { ageGroup: string; reason: string }) => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/age-group-waivers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ playerId: Number(youthUserId), ageGroup, reason }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to submit waiver request");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["child-age-waivers", youthUserId] });
      setWaiverOpen(false);
      setWaiverAgeGroup("");
      setWaiverReason("");
      toast({ title: "Request submitted", description: "Your age group waiver request has been sent for admin review." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (values: EditForm) => {
      const res = await fetch(`${import.meta.env.BASE_URL}api/youth/${youthUserId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: values.firstName || undefined,
          lastName: values.lastName || undefined,
          dateOfBirth: values.dateOfBirth || undefined,
          gender: values.gender || undefined,
          emergencyContactName: values.emergencyContactName || undefined,
          emergencyContactPhone: values.emergencyContactPhone || undefined,
          emergencyContactRelationship: values.emergencyContactRelationship || undefined,
          primaryPosition: values.primaryPosition || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to save changes");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["child-detail", youthUserId] });
      queryClient.invalidateQueries({ queryKey: ["guardian-links"] });
      setEditOpen(false);
      setSaveError("");
    },
    onError: (err: Error) => {
      setSaveError(err.message);
    },
  });

  const checkoutRegMutation = useMutation({
    mutationFn: async ({ programType, programId, registrationId, campRegId, label }: { programType: string; programId: number; registrationId?: number; campRegId?: number; label: string }) => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/checkout/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ programType, programId, registrationId, ...(campRegId != null ? { campRegId } : {}) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Checkout failed");
      return { ...body, label };
    },
    onSuccess: (data) => {
      setPayingItemId(null);
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
      setPayingItemId(null);
      toast({ title: "Checkout failed", description: err.message, variant: "destructive" });
    },
  });

  const checkoutDropinMutation = useMutation({
    mutationFn: async ({ spotId, label }: { spotId: number; label: string }) => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/dropins/spots/${spotId}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Checkout failed");
      return { ...body, label };
    },
    onSuccess: (data) => {
      setPayingItemId(null);
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
      setPayingItemId(null);
      toast({ title: "Checkout failed", description: err.message, variant: "destructive" });
    },
  });

  function handlePaymentSuccess() {
    setPaymentData(null);
    queryClient.invalidateQueries({ queryKey: ["child-detail", youthUserId] });
    toast({ title: "Payment confirmed!", description: "Your balance has been cleared." });
  }

  function openEdit() {
    const child = data?.child;
    setForm({
      firstName: child?.firstName ?? "",
      lastName: child?.lastName ?? "",
      dateOfBirth: child?.dateOfBirth
        ? (() => {
            const [y, m, d] = child.dateOfBirth.split("-");
            return `${m}/${d}/${y}`;
          })()
        : "",
      gender: "",
      emergencyContactName: "",
      emergencyContactPhone: "",
      emergencyContactRelationship: "",
      primaryPosition: "",
    });
    setSaveError("");
    setEditOpen(true);
  }

  if (profileLoading) {
    return <Layout><div className="container mx-auto px-4 py-12"><Skeleton className="h-64 w-full" /></div></Layout>;
  }

  if (!profile) {
    return <Redirect to="/sign-in" />;
  }

  const child = data?.child;
  const fullName = child ? `${child.firstName ?? ""} ${child.lastName ?? ""}`.trim() : "Child";
  const allRegistrations = data?.registrations ?? [];
  const campRegistrations = data?.campRegistrations ?? [];
  const dropinSpots = data?.dropinSpots ?? [];

  const PAID_STATUSES = ["paid", "paid_inapp", "paid_external", "waived"];
  const hasUnpaid =
    allRegistrations.some((r) => !PAID_STATUSES.includes(r.paymentStatus)) ||
    campRegistrations.some((c) => !PAID_STATUSES.includes(c.paymentStatus)) ||
    dropinSpots.some((s) => !PAID_STATUSES.includes(s.paymentStatus));

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-3xl">
        <div className="mb-8">
          <Link href="/me?tab=family">
            <Button variant="ghost" size="sm" className="mb-4 -ml-2 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to Family
            </Button>
          </Link>

          {isLoading ? (
            <Skeleton className="h-12 w-48" />
          ) : (
            <div className="flex items-center gap-4">
              <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-xl">
                {(child?.firstName?.[0] ?? "?").toUpperCase()}
              </div>
              <div className="flex-1">
                <h1 className="text-3xl font-bold font-sans uppercase tracking-tight">{fullName}</h1>
                <p className="text-muted-foreground capitalize">
                  {child?.relationship}
                  {child?.dateOfBirth && ` · Born ${format(new Date(child.dateOfBirth), "MMM d, yyyy")}`}
                </p>
              </div>
              {!isLoading && child && (
                <Button variant="outline" size="sm" onClick={openEdit} className="shrink-0">
                  <Pencil className="h-4 w-4 mr-1.5" />
                  Edit
                </Button>
              )}
            </div>
          )}
        </div>

        {error && (
          <Card className="p-6 border-destructive/50 bg-destructive/5">
            <p className="text-destructive font-medium">Failed to load registration history.</p>
            <p className="text-sm text-muted-foreground mt-1">{(error as Error).message}</p>
          </Card>
        )}

        {hasUnpaid && !isLoading && (
          <div className="mb-6 flex items-center gap-3 rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3">
            <AlertCircle className="h-5 w-5 text-yellow-600 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-yellow-800">Outstanding balance</p>
              <p className="text-xs text-yellow-700">One or more registrations have unpaid or partially-paid balances.</p>
            </div>
          </div>
        )}

        <div className="space-y-8">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          ) : allRegistrations.length > 0 && (
            <section>
              <h2 className="text-xl font-bold font-sans uppercase mb-4 flex items-center gap-2">
                <Trophy className="h-5 w-5" />
                Programs &amp; Leagues
              </h2>
              <div className="space-y-3">
                {allRegistrations.map((reg) => {
                  const isUnpaid = reg.paymentStatus !== "paid" && reg.paymentStatus !== "paid_inapp" && reg.paymentStatus !== "paid_external" && reg.paymentStatus !== "waived";
                  const itemKey = `reg-${reg.id}`;
                  const isPaying = payingItemId === itemKey;
                  return (
                  <Card key={reg.id} className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <Badge variant="secondary" className="uppercase text-xs">
                            {reg.programType.replace(/_/g, " ")}
                          </Badge>
                          <Badge variant={reg.status === "confirmed" ? "default" : "outline"} className="uppercase text-xs">
                            {reg.status}
                          </Badge>
                        </div>
                        <p className="font-semibold truncate">{reg.programName || `Program #${reg.programId}`}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Registered {format(new Date(reg.createdAt), "MMM d, yyyy")}
                        </p>
                      </div>
                      <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
                        <p className="font-medium">${reg.amountPaid}</p>
                        <span className={`inline-block text-xs px-2 py-0.5 rounded font-medium border ${paymentBadgeClass(reg.paymentStatus)}`}>
                          {reg.paymentStatus}
                        </span>
                        {isUnpaid && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs border-amber-400 text-amber-700 hover:bg-amber-50"
                            disabled={isPaying || checkoutRegMutation.isPending}
                            onClick={() => {
                              setPayingItemId(itemKey);
                              checkoutRegMutation.mutate({
                                programType: reg.programType,
                                programId: reg.programId,
                                registrationId: reg.id,
                                label: `Pay — ${reg.programName || "Registration"}`,
                              });
                            }}
                          >
                            <CreditCard className="h-3 w-3 mr-1" />
                            {isPaying ? "Loading…" : "Pay Now"}
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                  );
                })}
              </div>
            </section>
          )}

          {!isLoading && campRegistrations.length > 0 && (
            <section>
              <h2 className="text-xl font-bold font-sans uppercase mb-4 flex items-center gap-2">
                <Tent className="h-5 w-5" />
                Camps
              </h2>
              <div className="space-y-3">
                {campRegistrations.map((cr) => {
                  const isUnpaid = cr.paymentStatus !== "paid" && cr.paymentStatus !== "paid_inapp" && cr.paymentStatus !== "paid_external" && cr.paymentStatus !== "waived";
                  const itemKey = `camp-${cr.id}`;
                  const isPaying = payingItemId === itemKey;
                  return (
                  <Card key={cr.id} className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <Badge variant="secondary" className="uppercase text-xs">Camp</Badge>
                          <Badge variant={cr.status === "confirmed" ? "default" : "outline"} className="uppercase text-xs">
                            {cr.status}
                          </Badge>
                        </div>
                        <p className="font-semibold truncate">{cr.campName}</p>
                        {cr.startDate && (
                          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                            <CalendarDays className="h-3 w-3" />
                            {format(new Date(cr.startDate), "MMM d")}
                            {cr.endDate && ` – ${format(new Date(cr.endDate), "MMM d, yyyy")}`}
                          </p>
                        )}
                      </div>
                      <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
                        <p className="font-medium">{cr.pricePaid != null ? `$${cr.pricePaid}` : "—"}</p>
                        <span className={`inline-block text-xs px-2 py-0.5 rounded font-medium border ${paymentBadgeClass(cr.paymentStatus)}`}>
                          {cr.paymentStatus}
                        </span>
                        {isUnpaid && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs border-amber-400 text-amber-700 hover:bg-amber-50"
                            disabled={isPaying || checkoutRegMutation.isPending}
                            onClick={() => {
                              setPayingItemId(itemKey);
                              checkoutRegMutation.mutate({
                                programType: "camp",
                                programId: cr.campId,
                                campRegId: cr.id,
                                label: `Pay — ${cr.campName}`,
                              });
                            }}
                          >
                            <CreditCard className="h-3 w-3 mr-1" />
                            {isPaying ? "Loading…" : "Pay Now"}
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                  );
                })}
              </div>
            </section>
          )}

          {!isLoading && dropinSpots.length > 0 && (
            <section>
              <h2 className="text-xl font-bold font-sans uppercase mb-4 flex items-center gap-2">
                <Zap className="h-5 w-5" />
                Drop-ins
              </h2>
              <div className="space-y-3">
                {dropinSpots.map((s) => {
                  const isUnpaid = s.paymentStatus !== "paid" && s.paymentStatus !== "paid_inapp" && s.paymentStatus !== "paid_external" && s.paymentStatus !== "waived";
                  const itemKey = `dropin-${s.id}`;
                  const isPaying = payingItemId === itemKey;
                  return (
                  <Card key={s.id} className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <Badge variant="secondary" className="uppercase text-xs">Drop-in</Badge>
                          <Badge variant={s.status === "reserved" ? "default" : "outline"} className="uppercase text-xs">
                            {s.status}
                          </Badge>
                        </div>
                        <p className="font-semibold truncate">{s.dropinName}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                          <CalendarDays className="h-3 w-3" />
                          {format(new Date(s.startsAt), "EEE MMM d, h:mm a")}{s.endsAt ? ` – ${format(new Date(s.endsAt), "h:mm a")}` : ""}
                        </p>
                      </div>
                      <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
                        <span className={`inline-block text-xs px-2 py-0.5 rounded font-medium border ${paymentBadgeClass(s.paymentStatus)}`}>
                          {s.paymentStatus}
                        </span>
                        {isUnpaid && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs border-amber-400 text-amber-700 hover:bg-amber-50"
                            disabled={isPaying || checkoutDropinMutation.isPending}
                            onClick={() => {
                              setPayingItemId(itemKey);
                              checkoutDropinMutation.mutate({
                                spotId: s.id,
                                label: `Pay — ${s.dropinName}`,
                              });
                            }}
                          >
                            <CreditCard className="h-3 w-3 mr-1" />
                            {isPaying ? "Loading…" : "Pay Now"}
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                  );
                })}
              </div>
            </section>
          )}

          {!isLoading && !error && allRegistrations.length === 0 && campRegistrations.length === 0 && dropinSpots.length === 0 && (
            <Card className="p-12 text-center border-dashed">
              <p className="text-muted-foreground mb-4">No registrations found for {fullName}.</p>
              <div className="flex justify-center gap-4">
                <Link href="/leagues" className="text-primary hover:underline font-medium">Browse Leagues</Link>
                <span className="text-muted-foreground">·</span>
                <Link href="/camps" className="text-primary hover:underline font-medium">Find Camps</Link>
              </div>
            </Card>
          )}

          {/* Age Group Waivers Section */}
          {!isLoading && (
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold font-sans uppercase flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5" />
                  Age Group Waivers
                </h2>
                <Button size="sm" variant="outline" onClick={() => setWaiverOpen(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Request Waiver
                </Button>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Request a play-up or play-down waiver if your child needs to participate in an age group outside their USYS bracket. Waivers require admin approval.
              </p>
              {waiversLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : (waivers ?? []).length === 0 ? (
                <Card className="p-6 text-center border-dashed">
                  <p className="text-sm text-muted-foreground">No waiver requests yet.</p>
                </Card>
              ) : (
                <div className="space-y-3">
                  {(waivers ?? []).map((w) => (
                    <Card key={w.id} className="p-4">
                      <div className="flex items-start gap-3">
                        <WaiverStatusIcon status={w.status} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded uppercase font-semibold">{w.ageGroup}</span>
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusColor(w.status)}`}>
                              {w.status}
                            </span>
                            <span className="text-xs text-muted-foreground ml-auto">
                              {format(new Date(w.createdAt), "MMM d, yyyy")}
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{w.reason}</p>
                          {w.adminNote && (
                            <p className="text-xs mt-1 italic text-foreground/70">
                              Admin note: {w.adminNote}
                            </p>
                          )}
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      {/* Age Group Waiver Request Dialog */}
      <Dialog open={waiverOpen} onOpenChange={(o) => { setWaiverOpen(o); if (!o) { setWaiverAgeGroup(""); setWaiverReason(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Request Age Group Waiver</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Request permission for {fullName} to play in an age group outside their USYS bracket. An admin will review and approve or deny the request.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="waiver-ageGroup">Age Group</Label>
              <Select value={waiverAgeGroup} onValueChange={setWaiverAgeGroup}>
                <SelectTrigger id="waiver-ageGroup">
                  <SelectValue placeholder="Select age group…" />
                </SelectTrigger>
                <SelectContent>
                  {USYS_AGE_GROUPS.map((ag) => (
                    <SelectItem key={ag} value={ag}>{ag.toUpperCase()}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="waiver-reason">Reason</Label>
              <Textarea
                id="waiver-reason"
                value={waiverReason}
                onChange={(e) => setWaiverReason(e.target.value)}
                placeholder="Explain why this waiver is needed (e.g. player is developmentally ready for a higher age group, plays with older siblings, etc.)"
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setWaiverOpen(false); setWaiverAgeGroup(""); setWaiverReason(""); }} disabled={submitWaiverMutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => submitWaiverMutation.mutate({ ageGroup: waiverAgeGroup, reason: waiverReason })}
              disabled={!waiverAgeGroup || !waiverReason.trim() || submitWaiverMutation.isPending}
            >
              {submitWaiverMutation.isPending ? "Submitting…" : "Submit Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Child Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit {fullName}&apos;s Profile</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-firstName">First Name</Label>
                <Input
                  id="edit-firstName"
                  value={form.firstName}
                  onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                  placeholder="First name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-lastName">Last Name</Label>
                <Input
                  id="edit-lastName"
                  value={form.lastName}
                  onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                  placeholder="Last name"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-dob">Date of Birth</Label>
                <Input
                  id="edit-dob"
                  value={form.dateOfBirth}
                  onChange={(e) => setForm((f) => ({ ...f, dateOfBirth: e.target.value }))}
                  placeholder="MM/DD/YYYY"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-gender">Gender</Label>
                <Select
                  value={form.gender}
                  onValueChange={(v) => setForm((f) => ({ ...f, gender: v }))}
                >
                  <SelectTrigger id="edit-gender">
                    <SelectValue placeholder="Select gender" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="non_binary">Non-binary</SelectItem>
                    <SelectItem value="prefer_not_to_say">Prefer not to say</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-position">Primary Position <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input
                id="edit-position"
                value={form.primaryPosition}
                onChange={(e) => setForm((f) => ({ ...f, primaryPosition: e.target.value }))}
                placeholder="e.g. Forward, Goalkeeper"
              />
            </div>

            <div className="pt-2 border-t">
              <p className="text-sm font-medium mb-3">Emergency Contact</p>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-ecName">Contact Name</Label>
                  <Input
                    id="edit-ecName"
                    value={form.emergencyContactName}
                    onChange={(e) => setForm((f) => ({ ...f, emergencyContactName: e.target.value }))}
                    placeholder="Full name"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-ecPhone">Phone</Label>
                    <Input
                      id="edit-ecPhone"
                      value={form.emergencyContactPhone}
                      onChange={(e) => setForm((f) => ({ ...f, emergencyContactPhone: e.target.value }))}
                      placeholder="(555) 000-0000"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-ecRel">Relationship</Label>
                    <Input
                      id="edit-ecRel"
                      value={form.emergencyContactRelationship}
                      onChange={(e) => setForm((f) => ({ ...f, emergencyContactRelationship: e.target.value }))}
                      placeholder="e.g. Mother, Coach"
                    />
                  </div>
                </div>
              </div>
            </div>

            {saveError && (
              <p className="text-sm text-destructive">{saveError}</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saveMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
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
          title="Complete Payment"
          label={paymentData.label}
          onSuccess={handlePaymentSuccess}
          onCancel={() => setPaymentData(null)}
        />
      )}
    </Layout>
  );
}
