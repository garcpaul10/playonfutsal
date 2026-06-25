import React, { useState, useEffect } from "react";
import { useRoute, Link } from "wouter";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, ChevronLeft, HeartPulse, AlertCircle, Save, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";

import { API_BASE as API } from "@/lib/api-base";

function useAuthHeaders() {
  const { getToken } = useAuth();
  return async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  };
}

const SHIRT_SIZES = ["YS", "YM", "YL", "S", "M", "L", "XL", "XXL"];

interface HealthPacketForm {
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship: string;
  medicalConditions: string;
  allergies: string;
  medications: string;
  physicianName: string;
  physicianPhone: string;
  insuranceProvider: string;
  insurancePolicyNumber: string;
  additionalNotes: string;
  authorizedPickupPersons: string;
  mediaConsent: boolean;
  returningCamper: boolean;
}

const EMPTY_FORM: HealthPacketForm = {
  emergencyContactName: "", emergencyContactPhone: "", emergencyContactRelationship: "",
  medicalConditions: "", allergies: "", medications: "",
  physicianName: "", physicianPhone: "",
  insuranceProvider: "", insurancePolicyNumber: "",
  additionalNotes: "",
  authorizedPickupPersons: "",
  mediaConsent: false,
  returningCamper: false,
};

export default function CampHealthPacket() {
  const [, params] = useRoute("/camps/:id/health-packet");
  const campId = Number(params?.id);
  const { toast } = useToast();
  const qc = useQueryClient();
  const getHeaders = useAuthHeaders();

  const [form, setForm] = useState<HealthPacketForm>(EMPTY_FORM);

  const { data: camp, isLoading: campLoading } = useQuery({
    queryKey: ["camp-detail", campId],
    queryFn: async () => {
      const r = await fetch(`${API}/camps/${campId}`);
      return r.ok ? r.json() : null;
    },
    enabled: !!campId,
  });

  const { data: packetData, isLoading: packetLoading } = useQuery({
    queryKey: ["camp-health-packet", campId],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/camps/${campId}/health-packet`, { headers });
      return r.ok ? r.json() : null;
    },
    enabled: !!campId,
  });

  useEffect(() => {
    if (packetData?.packet) {
      setForm({ ...EMPTY_FORM, ...packetData.packet });
    }
  }, [packetData]);

  const set = (field: keyof HealthPacketForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  const toggle = (field: keyof HealthPacketForm) => () =>
    setForm((prev) => ({ ...prev, [field]: !prev[field] }));

  const submit = useMutation({
    mutationFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/camps/${campId}/health-packet`, {
        method: "PUT",
        headers,
        body: JSON.stringify(form),
      });
      if (!r.ok) { const err = await r.json(); throw new Error(err.error ?? "Failed to save"); }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["camp-health-packet", campId] });
      toast({ title: "Health packet saved!", description: "Your medical information has been submitted." });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const isLoading = campLoading || packetLoading;
  const isSubmitted = !!packetData?.submittedAt;

  const fieldClass = "bg-black/30 border-white/10 text-white placeholder:text-white/25 focus:border-[#1d4ed8]";
  const labelClass = "text-xs font-semibold text-white/50 uppercase tracking-wider mb-1.5 block";

  return (
    <Layout>
      <div className="min-h-screen bg-[#0a0a0f] pb-20">
        <div className="max-w-2xl mx-auto px-4 pt-6">
          {/* Back link */}
          <Link href={`/camps/${campId}`} className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-white transition-colors mb-6">
            <ChevronLeft className="h-4 w-4" /> Back to Camp
          </Link>

          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-12 bg-white/5" />
              <Skeleton className="h-64 bg-white/5" />
            </div>
          ) : !packetData ? (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-8 text-center">
              <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" />
              <p className="text-white font-semibold">No registration found</p>
              <p className="text-sm text-white/40 mt-1">You must be registered for this camp to submit a health packet.</p>
              <Button variant="outline" className="mt-4 border-white/20 text-white" asChild>
                <Link href={`/camps/${campId}`}>Go to Camp</Link>
              </Button>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="mb-6">
                <div className="flex items-center gap-3 mb-1">
                  <HeartPulse className="h-6 w-6 text-red-400" />
                  <h1 className="text-2xl font-black text-white">Health Packet</h1>
                </div>
                <p className="text-white/40 text-sm">
                  {camp?.name} — Medical information for emergency use only.
                </p>
                {isSubmitted && (
                  <div className="mt-3 inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-3 py-1.5 text-xs text-emerald-400 font-semibold">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Submitted {new Date(packetData.submittedAt).toLocaleDateString()}
                  </div>
                )}
              </div>

              <div className="space-y-6">
                {/* Emergency Contact */}
                <section className="rounded-2xl border border-white/10 bg-[#111118] p-5 space-y-4">
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider border-b border-white/10 pb-2">Emergency Contact</h2>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className={labelClass}>Full Name *</Label>
                      <Input className={fieldClass} placeholder="Jane Smith" value={form.emergencyContactName} onChange={set("emergencyContactName")} />
                    </div>
                    <div>
                      <Label className={labelClass}>Phone *</Label>
                      <PhoneInput className={fieldClass} value={form.emergencyContactPhone} onChange={(formatted) => setForm((prev) => ({ ...prev, emergencyContactPhone: formatted }))} />
                    </div>
                  </div>
                  <div>
                    <Label className={labelClass}>Relationship to Participant *</Label>
                    <Input className={fieldClass} placeholder="Parent, Guardian, Spouse…" value={form.emergencyContactRelationship} onChange={set("emergencyContactRelationship")} />
                  </div>
                </section>

                {/* Medical Info */}
                <section className="rounded-2xl border border-white/10 bg-[#111118] p-5 space-y-4">
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider border-b border-white/10 pb-2">Medical Information</h2>
                  <div>
                    <Label className={labelClass}>Medical Conditions</Label>
                    <textarea
                      className="w-full min-h-[80px] rounded-xl border border-white/10 bg-black/30 text-white placeholder:text-white/25 focus:border-[#1d4ed8] focus:outline-none px-3 py-2 text-sm resize-none"
                      placeholder="Asthma, diabetes, heart conditions… (leave blank if none)"
                      value={form.medicalConditions}
                      onChange={set("medicalConditions")}
                    />
                  </div>
                  <div>
                    <Label className={labelClass}>Allergies</Label>
                    <textarea
                      className="w-full min-h-[80px] rounded-xl border border-white/10 bg-black/30 text-white placeholder:text-white/25 focus:border-[#1d4ed8] focus:outline-none px-3 py-2 text-sm resize-none"
                      placeholder="Food allergies, medication allergies, latex… (leave blank if none)"
                      value={form.allergies}
                      onChange={set("allergies")}
                    />
                  </div>
                  <div>
                    <Label className={labelClass}>Current Medications</Label>
                    <textarea
                      className="w-full min-h-[60px] rounded-xl border border-white/10 bg-black/30 text-white placeholder:text-white/25 focus:border-[#1d4ed8] focus:outline-none px-3 py-2 text-sm resize-none"
                      placeholder="List all current medications and dosages (leave blank if none)"
                      value={form.medications}
                      onChange={set("medications")}
                    />
                  </div>
                </section>

                {/* Physician */}
                <section className="rounded-2xl border border-white/10 bg-[#111118] p-5 space-y-4">
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider border-b border-white/10 pb-2">Physician</h2>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className={labelClass}>Physician Name</Label>
                      <Input className={fieldClass} placeholder="Dr. Smith" value={form.physicianName} onChange={set("physicianName")} />
                    </div>
                    <div>
                      <Label className={labelClass}>Physician Phone</Label>
                      <PhoneInput className={fieldClass} value={form.physicianPhone} onChange={(formatted) => setForm((prev) => ({ ...prev, physicianPhone: formatted }))} />
                    </div>
                  </div>
                </section>

                {/* Insurance */}
                <section className="rounded-2xl border border-white/10 bg-[#111118] p-5 space-y-4">
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider border-b border-white/10 pb-2">Insurance</h2>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className={labelClass}>Provider</Label>
                      <Input className={fieldClass} placeholder="Blue Cross, Aetna…" value={form.insuranceProvider} onChange={set("insuranceProvider")} />
                    </div>
                    <div>
                      <Label className={labelClass}>Policy Number</Label>
                      <Input className={fieldClass} placeholder="Policy #" value={form.insurancePolicyNumber} onChange={set("insurancePolicyNumber")} />
                    </div>
                  </div>
                </section>

                {/* Authorized Pickup Persons */}
                <section className="rounded-2xl border border-white/10 bg-[#111118] p-5 space-y-4">
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider border-b border-white/10 pb-2">Authorized Pickup Persons</h2>
                  <p className="text-xs text-white/40">List all adults authorized to pick up the participant. Include name, phone, and relationship (one per line).</p>
                  <textarea
                    className="w-full min-h-[100px] rounded-xl border border-white/10 bg-black/30 text-white placeholder:text-white/25 focus:border-[#1d4ed8] focus:outline-none px-3 py-2 text-sm resize-none"
                    placeholder={"Jane Smith, (555) 123-4567, Mother\nJohn Smith, (555) 987-6543, Father"}
                    value={form.authorizedPickupPersons}
                    onChange={set("authorizedPickupPersons")}
                  />
                </section>

                {/* Consents & Camper Status */}
                <section className="rounded-2xl border border-white/10 bg-[#111118] p-5 space-y-4">
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider border-b border-white/10 pb-2">Consents & Status</h2>
                  <label className="flex items-start gap-3 cursor-pointer" onClick={toggle("mediaConsent")}>
                    <div className={`mt-0.5 h-5 w-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${form.mediaConsent ? "bg-[#1d4ed8] border-[#1d4ed8]" : "border-white/30 bg-transparent"}`}>
                      {form.mediaConsent && <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">Media Consent</p>
                      <p className="text-xs text-white/40 mt-0.5">I authorize PlayOn to photograph and/or video the participant for promotional materials.</p>
                    </div>
                  </label>
                  <label className="flex items-start gap-3 cursor-pointer" onClick={toggle("returningCamper")}>
                    <div className={`mt-0.5 h-5 w-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${form.returningCamper ? "bg-[#1d4ed8] border-[#1d4ed8]" : "border-white/30 bg-transparent"}`}>
                      {form.returningCamper && <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">Returning Camper</p>
                      <p className="text-xs text-white/40 mt-0.5">This participant has previously attended a PlayOn camp or clinic.</p>
                    </div>
                  </label>
                </section>

                {/* Additional Notes */}
                <section className="rounded-2xl border border-white/10 bg-[#111118] p-5 space-y-4">
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider border-b border-white/10 pb-2">Additional Notes</h2>
                  <textarea
                    className="w-full min-h-[80px] rounded-xl border border-white/10 bg-black/30 text-white placeholder:text-white/25 focus:border-[#1d4ed8] focus:outline-none px-3 py-2 text-sm resize-none"
                    placeholder="Anything else the coaching staff should know…"
                    value={form.additionalNotes}
                    onChange={set("additionalNotes")}
                  />
                </section>

                <Button
                  className="w-full h-12 text-base font-semibold bg-[#1d4ed8] hover:bg-[#1e40af] border-none"
                  onClick={() => submit.mutate()}
                  disabled={submit.isPending || !form.emergencyContactName || !form.emergencyContactPhone || !form.emergencyContactRelationship}
                >
                  {submit.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving…</> : <><Save className="h-4 w-4 mr-2" />{isSubmitted ? "Update Health Packet" : "Submit Health Packet"}</>}
                </Button>
                <p className="text-xs text-white/25 text-center">This information is confidential and used for emergency purposes only.</p>
              </div>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
