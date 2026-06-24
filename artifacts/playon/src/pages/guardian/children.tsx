import React, { useState } from "react";
import { Redirect, Link, useLocation } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { format } from "date-fns";
import {
  QrCode, Baby, PlusCircle, ChevronRight, CheckCircle2,
  ArrowLeft, AlertCircle, UserPlus, X, Loader2,
} from "lucide-react";
import { WaiverSignature, type SignatureResult } from "@/components/waiver-signature";

const API = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

interface WaiverTemplate {
  id: number;
  name: string;
  version: number;
  body: string;
}

interface GuardianLink {
  id: number;
  youthUserId: number;
  youthFirstName: string | null;
  youthLastName: string | null;
  youthDateOfBirth: string | null;
  relationship: string;
  isPrimary: boolean;
  canRegister: boolean;
  canPickup: boolean;
  status: "pending" | "approved" | "rejected";
  notes: string | null;
  createdAt: string;
}

interface CreatedChild {
  id: number;
  firstName: string | null;
  lastName: string | null;
  playonId: string | null;
}

type View = "list" | "create" | "success" | "link-by-id";
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

function childDisplayName(link: GuardianLink) {
  return [link.youthFirstName, link.youthLastName].filter(Boolean).join(" ") || `Child #${link.youthUserId}`;
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
              step > s.num
                ? "bg-primary text-primary-foreground"
                : step === s.num
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
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

export default function GuardianChildren() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { getToken } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const [view, setView] = useState<View>("list");
  const [step, setStep] = useState<CreateStep>(1);
  const [form, setForm] = useState(EMPTY_FORM);
  const [fieldError, setFieldError] = useState("");
  const [consentChecked, setConsentChecked] = useState(false);
  const [signatureResult, setSignatureResult] = useState<SignatureResult | null>(null);
  const [createdChild, setCreatedChild] = useState<CreatedChild | null>(null);

  const { data: waiverTemplate, isLoading: waiverLoading, error: waiverError } = useQuery<WaiverTemplate>({
    queryKey: ["waiver", "active"],
    queryFn: async () => {
      const r = await fetch(`${API}/waivers/active`);
      if (!r.ok) throw new Error("Failed to load waiver");
      return r.json();
    },
    staleTime: 10 * 60 * 1000,
    retry: 2,
    enabled: view === "create",
  });

  const [linkForm, setLinkForm] = useState({
    youthUserId: "",
    relationship: "parent",
    notes: "",
  });

  const { data: links, isLoading } = useQuery<GuardianLink[]>({
    queryKey: ["me-guardian-links"],
    enabled: !profileLoading && !!profile,
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/me/guardian-links", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load children");
      return res.json();
    },
  });

  const createChild = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/youth", {
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
      queryClient.invalidateQueries({ queryKey: ["me-guardian-links"] });
      setCreatedChild({
        id: data.youth.id,
        firstName: data.youth.firstName,
        lastName: data.youth.lastName,
        playonId: data.youth.playonId,
      });
      setView("success");
      setForm(EMPTY_FORM);
      setConsentChecked(false);
      setSignatureResult(null);
      setStep(1);
      setFieldError("");
    },
    onError: (err: Error) => {
      setFieldError(err.message);
    },
  });

  const addLink = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/guardians", {
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
      queryClient.invalidateQueries({ queryKey: ["me-guardian-links"] });
      setLinkForm({ youthUserId: "", relationship: "parent", notes: "" });
      setView("list");
      toast({ title: "Link request sent", description: "An admin will review and approve the request." });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to send request", description: err.message, variant: "destructive" });
    },
  });

  const removeLink = useMutation({
    mutationFn: async (id: number) => {
      const token = await getToken();
      const res = await fetch(`/api/guardians/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok && res.status !== 204) throw new Error("Failed to remove");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me-guardian-links"] });
      toast({ title: "Removed", description: "Your child has been removed from your account." });
    },
    onError: () => {
      toast({ title: "Could not remove", variant: "destructive" });
    },
  });

  function startCreate() {
    setForm(EMPTY_FORM);
    setConsentChecked(false);
    setStep(1);
    setFieldError("");
    setView("create");
  }

  function cancelCreate() {
    setView("list");
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

  if (profileLoading) {
    return <Layout><div className="p-12"><Skeleton className="h-64" /></div></Layout>;
  }

  if (!profile) {
    return <Redirect to="/sign-in" />;
  }

  const approvedLinks = links?.filter((l) => l.status === "approved") ?? [];
  const pendingLinks = links?.filter((l) => l.status === "pending") ?? [];

  return (
    <Layout>
      <div className="container mx-auto px-4 py-10 max-w-2xl">

        {/* ── Success state ── */}
        {view === "success" && createdChild && (
          <div className="text-center py-8">
            <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="h-8 w-8 text-green-600" />
            </div>
            <h1 className="text-2xl font-bold mb-1">
              {createdChild.firstName} is all set!
            </h1>
            <p className="text-muted-foreground mb-8">
              Their profile is ready. You can register them for programs or pull up their check-in QR code any time.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center mb-8">
              <Link href={`/guardian/children/${createdChild.id}`}>
                <Button className="w-full sm:w-auto">
                  View {createdChild.firstName}'s profile
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </Link>
              <Link href="/guardian/children/qr">
                <Button variant="outline" className="w-full sm:w-auto flex items-center gap-2">
                  <QrCode className="h-4 w-4" />
                  Check-in QR codes
                </Button>
              </Link>
              <Link href="/leagues">
                <Button variant="outline" className="w-full sm:w-auto">
                  Browse programs
                </Button>
              </Link>
            </div>
            <button
              className="text-sm text-primary hover:underline"
              onClick={() => setView("list")}
            >
              ← Back to all children
            </button>
          </div>
        )}

        {/* ── Create flow ── */}
        {view === "create" && (
          <div>
            <div className="mb-6 flex items-center gap-3">
              <button
                onClick={cancelCreate}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div>
                <h1 className="text-2xl font-bold">Add your child</h1>
                <p className="text-muted-foreground text-sm">We'll create their profile and link it to your account.</p>
              </div>
            </div>

            <StepIndicator step={step} />

            <Card>
              <CardContent className="pt-6 pb-7 space-y-5">

                {step === 1 && (
                  <>
                    <div>
                      <h2 className="font-semibold mb-4">What's your child's name and date of birth?</h2>
                      <div className="grid grid-cols-2 gap-3 mb-4">
                        <div className="space-y-1.5">
                          <Label htmlFor="firstName">First name <span className="text-destructive">*</span></Label>
                          <Input
                            id="firstName"
                            placeholder="Alex"
                            value={form.firstName}
                            onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                            autoFocus
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="lastName">Last name <span className="text-destructive">*</span></Label>
                          <Input
                            id="lastName"
                            placeholder="Smith"
                            value={form.lastName}
                            onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                          />
                        </div>
                      </div>
                      <div className="space-y-1.5 mb-4">
                        <Label htmlFor="dob">Date of birth <span className="text-muted-foreground text-xs">(optional)</span></Label>
                        <Input
                          id="dob"
                          placeholder="MM/DD/YYYY"
                          value={form.dateOfBirth}
                          onChange={(e) => setForm((f) => ({ ...f, dateOfBirth: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="gender">Gender <span className="text-muted-foreground text-xs">(optional)</span></Label>
                        <select
                          id="gender"
                          value={form.gender}
                          onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value }))}
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                        >
                          <option value="">Prefer not to say</option>
                          <option value="male">Male</option>
                          <option value="female">Female</option>
                          <option value="non_binary">Non-binary</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                    </div>
                  </>
                )}

                {step === 2 && (
                  <>
                    <div>
                      <h2 className="font-semibold mb-1">Emergency contact</h2>
                      <p className="text-sm text-muted-foreground mb-4">
                        Who should we reach in case of an emergency?
                      </p>
                      <div className="space-y-4">
                        <div className="space-y-1.5">
                          <Label htmlFor="ecName">Contact name <span className="text-destructive">*</span></Label>
                          <Input
                            id="ecName"
                            placeholder="Jane Smith"
                            value={form.emergencyContactName}
                            onChange={(e) => setForm((f) => ({ ...f, emergencyContactName: e.target.value }))}
                            autoFocus
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="ecPhone">Phone number <span className="text-destructive">*</span></Label>
                          <PhoneInput
                            id="ecPhone"
                            value={form.emergencyContactPhone}
                            onChange={(formatted) => setForm((f) => ({ ...f, emergencyContactPhone: formatted }))}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="ecRel">Their relationship to your child <span className="text-muted-foreground text-xs">(optional)</span></Label>
                          <Input
                            id="ecRel"
                            placeholder="Mother / Father / Grandparent"
                            value={form.emergencyContactRelationship}
                            onChange={(e) => setForm((f) => ({ ...f, emergencyContactRelationship: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-1.5 pt-2 border-t">
                          <Label htmlFor="relationship">Your relationship to this child</Label>
                          <select
                            id="relationship"
                            value={form.relationship}
                            onChange={(e) => setForm((f) => ({ ...f, relationship: e.target.value }))}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                          >
                            {RELATIONSHIP_OPTIONS.map((r) => (
                              <option key={r} value={r} className="capitalize">
                                {r.charAt(0).toUpperCase() + r.slice(1)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {step === 3 && (
                  <>
                    <div>
                      <h2 className="font-semibold mb-1">Confirm your consent</h2>
                      <p className="text-sm text-muted-foreground mb-4">
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
                    </div>
                  </>
                )}

                {fieldError && (
                  <div className="flex items-center gap-2 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {fieldError}
                  </div>
                )}

                <div className="flex justify-between gap-3 pt-2">
                  {step > 1 ? (
                    <Button
                      variant="outline"
                      onClick={() => { setStep((s) => (s - 1) as CreateStep); setFieldError(""); }}
                    >
                      Back
                    </Button>
                  ) : (
                    <Button variant="outline" onClick={cancelCreate}>Cancel</Button>
                  )}
                  {step < 3 ? (
                    <Button onClick={handleNext}>Continue</Button>
                  ) : (
                    <Button
                      onClick={handleSubmit}
                      disabled={createChild.isPending || waiverLoading || !!waiverError || !waiverTemplate || !consentChecked || !signatureResult}
                    >
                      {createChild.isPending ? "Adding…" : `Add ${form.firstName || "child"}`}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── Link by ID flow ── */}
        {view === "link-by-id" && (
          <div>
            <div className="mb-6 flex items-center gap-3">
              <button
                onClick={() => setView("list")}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div>
                <h1 className="text-2xl font-bold">Link an existing account</h1>
                <p className="text-muted-foreground text-sm">Enter the player's account ID to request a link.</p>
              </div>
            </div>
            <Card>
              <CardContent className="pt-6 pb-7 space-y-4">
                <p className="text-sm text-muted-foreground">
                  If a player profile already exists (for example, an existing PlayOn member), you can link it to your guardian account using their account ID.
                  An admin will review the request before it's approved.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="youthUserId">Player account ID</Label>
                  <Input
                    id="youthUserId"
                    type="number"
                    placeholder="e.g. 1042"
                    value={linkForm.youthUserId}
                    onChange={(e) => setLinkForm((f) => ({ ...f, youthUserId: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="linkRelationship">Your relationship</Label>
                  <select
                    id="linkRelationship"
                    value={linkForm.relationship}
                    onChange={(e) => setLinkForm((f) => ({ ...f, relationship: e.target.value }))}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    {RELATIONSHIP_OPTIONS.map((r) => (
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
                    onChange={(e) => setLinkForm((f) => ({ ...f, notes: e.target.value }))}
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <Button variant="outline" onClick={() => setView("list")} className="flex-1">Cancel</Button>
                  <Button
                    className="flex-1"
                    disabled={!linkForm.youthUserId || addLink.isPending}
                    onClick={() => addLink.mutate()}
                  >
                    {addLink.isPending ? "Sending…" : "Send link request"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── Main list ── */}
        {view === "list" && (
          <>
            <div className="flex items-center justify-between mb-8">
              <div>
                <h1 className="text-3xl font-bold font-sans uppercase tracking-tight text-primary">Your Children</h1>
                <p className="text-muted-foreground mt-1">Add your children to register them and check them in.</p>
              </div>
              <Link href="/guardian/children/qr">
                <Button variant="outline" className="flex items-center gap-2">
                  <QrCode className="h-4 w-4" />
                  Check-in QR
                </Button>
              </Link>
            </div>

            {isLoading ? (
              <div className="space-y-3">{[1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div>
            ) : links?.length === 0 ? (
              /* ── Empty state ── */
              <div className="text-center py-16">
                <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <Baby className="h-8 w-8 text-primary" />
                </div>
                <h2 className="text-xl font-semibold mb-2">Add your first child</h2>
                <p className="text-muted-foreground text-sm max-w-xs mx-auto mb-6">
                  Create their profile and you'll be able to register them for programs and check them in with a QR code.
                </p>
                <Button size="lg" onClick={startCreate} className="flex items-center gap-2 mx-auto">
                  <PlusCircle className="h-4 w-4" />
                  Add your child
                </Button>
              </div>
            ) : (
              /* ── Children list ── */
              <div className="space-y-3">
                {links!.map((link) => (
                  <Card key={link.id} className="overflow-hidden">
                    <CardContent className="pt-0 pb-0">
                      <div className="flex items-center gap-4 py-4">
                        <div className="h-11 w-11 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary shrink-0">
                          {(link.youthFirstName?.[0] ?? "?").toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold">{childDisplayName(link)}</p>
                            {link.status === "pending" && (
                              <span className="text-xs px-2 py-0.5 rounded bg-yellow-100 text-yellow-800 font-medium">
                                Pending approval
                              </span>
                            )}
                            {link.status === "rejected" && (
                              <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-800 font-medium">
                                Not approved
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground capitalize">
                            {link.relationship}
                            {link.youthDateOfBirth && ` · Born ${format(new Date(link.youthDateOfBirth + "T00:00:00"), "MMM d, yyyy")}`}
                          </p>
                          {link.status === "pending" && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              An admin will review this shortly.
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {link.status === "approved" && (
                            <Link href={`/guardian/children/${link.youthUserId}`}>
                              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                                View
                                <ChevronRight className="h-4 w-4 ml-0.5" />
                              </Button>
                            </Link>
                          )}
                          <button
                            onClick={() => removeLink.mutate(link.id)}
                            disabled={removeLink.isPending}
                            className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                            title="Remove"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}

                {/* Add another child */}
                <button
                  onClick={startCreate}
                  className="w-full flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/25 py-5 text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
                >
                  <PlusCircle className="h-5 w-5" />
                  <span className="font-medium">Add another child</span>
                </button>
              </div>
            )}

            {/* Pending approvals notice */}
            {pendingLinks.length > 0 && approvedLinks.length > 0 && (
              <p className="text-xs text-muted-foreground text-center mt-4">
                {pendingLinks.length} link request{pendingLinks.length > 1 ? "s" : ""} pending admin review
              </p>
            )}

            {/* Secondary: link by ID */}
            <div className="text-center mt-10 pt-6 border-t">
              <button
                onClick={() => setView("link-by-id")}
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Already have an account ID? Link an existing profile
              </button>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
