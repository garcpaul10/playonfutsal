import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import { AlertCircle, Shield, Users, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { WaiverSignature, type SignatureResult } from "@/components/waiver-signature";

const API = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

interface WaiverTemplate {
  id: number;
  name: string;
  version: number;
  body: string;
}

export interface WaiverData {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  signatureName: string;
  signatureData: string;
  signatureType: "typed" | "drawn";
  templateId: number;
  isForChild: boolean;
}

interface WaiverFormProps {
  onSubmit: (data: WaiverData) => void | Promise<void>;
  disabled?: boolean;
  submitLabel?: string;
}

function useActiveWaiver() {
  return useQuery<WaiverTemplate>({
    queryKey: ["waiver", "active"],
    queryFn: async () => {
      const r = await fetch(`${API}/waivers/active`);
      if (!r.ok) throw new Error("Failed to load waiver");
      return r.json();
    },
    staleTime: 10 * 60 * 1000,
    retry: 2,
  });
}

export function WaiverForm({ onSubmit, disabled, submitLabel }: WaiverFormProps) {
  const { data: template, isLoading: waiverLoading, error: waiverError } = useActiveWaiver();

  const [isForChild, setIsForChild] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [emergencyContactName, setEmergencyContactName] = useState("");
  const [emergencyContactPhone, setEmergencyContactPhone] = useState("");

  const [agreed, setAgreed] = useState(false);
  const [signature, setSignature] = useState<SignatureResult | null>(null);
  const [error, setError] = useState("");

  const inputClass =
    "bg-[var(--brand-teal-700)] border-[var(--brand-teal-600)] text-white placeholder:text-[var(--brand-neutral-500)] focus:border-primary focus:ring-primary h-11";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!firstName.trim()) { setError("First name is required."); return; }
    if (!lastName.trim()) { setError("Last name is required."); return; }
    if (!dateOfBirth) { setError("Date of birth is required."); return; }
    if (!emergencyContactName.trim()) { setError("Emergency contact name is required."); return; }
    if (!emergencyContactPhone.trim()) { setError("Emergency contact phone is required."); return; }
    if (!agreed) { setError("Please acknowledge the liability waiver to continue."); return; }
    if (!signature) { setError("Please provide your signature to continue."); return; }
    if (!template) { setError("Waiver template not loaded. Please try again."); return; }

    onSubmit({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      dateOfBirth,
      emergencyContactName: emergencyContactName.trim(),
      emergencyContactPhone: emergencyContactPhone.trim(),
      signatureName: signature.mode === "typed" ? signature.data : `${firstName} ${lastName}`.trim(),
      signatureData: signature.data,
      signatureType: signature.mode,
      templateId: template.id,
      isForChild,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="rounded-xl bg-[#2b353a] border border-[#3b474c] p-4 flex items-start gap-3">
        <Shield className="h-4 w-4 text-primary shrink-0 mt-0.5" />
        <p className="text-[#99a1a3] text-xs leading-relaxed">
          Before your first registration, we need a few details for emergency contact and liability purposes.
          This only needs to be completed once.
        </p>
      </div>

      <div>
        <button
          type="button"
          onClick={() => setIsForChild((v) => !v)}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all text-left ${
            isForChild
              ? "border-primary bg-primary/15"
              : "border-[var(--brand-teal-600)] bg-[var(--brand-teal-700)]/50 hover:bg-[var(--brand-teal-700)]"
          }`}
        >
          <Users className={`h-5 w-5 shrink-0 ${isForChild ? "text-primary" : "text-[#99a1a3]"}`} />
          <div>
            <p className={`text-sm font-semibold ${isForChild ? "text-white" : "text-[#99a1a3]"}`}>
              {isForChild ? "✓ Registering for my child" : "Registering for my child"}
            </p>
            <p className="text-[#99a1a3] text-xs">
              {isForChild
                ? "Enter your child's details below. You remain the account holder."
                : "Toggle this if you are a parent registering your child."}
            </p>
          </div>
        </button>
      </div>

      <div>
        <h3 className="text-white text-sm font-semibold mb-3">
          {isForChild ? "Child's information" : "Participant information"}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="waiverFirstName" className="text-white text-sm font-medium">First name</Label>
            <Input
              id="waiverFirstName"
              placeholder="First"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              autoComplete="given-name"
              className={inputClass}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="waiverLastName" className="text-white text-sm font-medium">Last name</Label>
            <Input
              id="waiverLastName"
              placeholder="Last"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
              autoComplete="family-name"
              className={inputClass}
            />
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="waiverDob" className="text-white text-sm font-medium">Date of birth</Label>
        <Input
          id="waiverDob"
          type="date"
          value={dateOfBirth}
          onChange={(e) => setDateOfBirth(e.target.value)}
          required
          max={new Date().toISOString().split("T")[0]}
          className={inputClass}
        />
      </div>

      <div>
        <h3 className="text-white text-sm font-semibold mb-3">Emergency contact</h3>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="waiverEcName" className="text-white text-sm font-medium">Contact name</Label>
            <Input
              id="waiverEcName"
              placeholder="Full name"
              value={emergencyContactName}
              onChange={(e) => setEmergencyContactName(e.target.value)}
              required
              className={inputClass}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="waiverEcPhone" className="text-white text-sm font-medium">Contact phone</Label>
            <PhoneInput
              id="waiverEcPhone"
              value={emergencyContactPhone}
              onChange={(formatted) => setEmergencyContactPhone(formatted)}
              required
              autoComplete="tel"
              className={inputClass}
            />
          </div>
        </div>
      </div>

      {waiverLoading ? (
        <div className="rounded-xl bg-[#1a2626] border border-[#3b474c] p-6 flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 text-primary animate-spin" />
          <span className="text-[#99a1a3] text-sm">Loading waiver…</span>
        </div>
      ) : waiverError || !template ? (
        <div className="rounded-xl bg-red-900/20 border border-red-800/40 p-4">
          <p className="text-red-400 text-sm">Failed to load the waiver document. Please refresh and try again.</p>
        </div>
      ) : (
        <WaiverSignature
          waiverText={template.body}
          waiverName={`${template.name} (v${template.version})`}
          isForChild={isForChild}
          onSignatureChange={setSignature}
          onAgreedChange={setAgreed}
          agreed={agreed}
          disabled={disabled}
        />
      )}

      {error && (
        <div className="rounded-lg bg-red-900/30 border border-red-800/50 px-4 py-3 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      <Button
        type="submit"
        disabled={disabled || waiverLoading || !template}
        className="w-full h-11 bg-primary hover:bg-primary/85 text-primary-foreground font-semibold text-sm transition-colors disabled:opacity-60"
      >
        {submitLabel ?? "Complete & Continue →"}
      </Button>
    </form>
  );
}
