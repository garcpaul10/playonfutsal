import { API_BASE } from "@/lib/api-base";
import React, { useState } from "react";
import { Redirect, useLocation } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { WizardShell } from "@/components/admin/WizardShell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { useToast } from "@/hooks/use-toast";
import { format, addDays, parseISO } from "date-fns";
import { CheckCircle2, Clock, Building2, DollarSign, User, Calendar, Phone, Mail, Loader2 } from "lucide-react";

const STEPS = ["Renter Info", "Date & Court", "Review"];

interface WizardState {
  // Step 1
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  notes: string;
  adminNotes: string;
  // Step 2
  date: string;
  pricingTierId: number | null;
  courtNumber: number | null;
  startTime: string;
  paymentStatus: "paid" | "unpaid";
}

const DEFAULT_STATE: WizardState = {
  customerName: "",
  customerEmail: "",
  customerPhone: "",
  notes: "",
  adminNotes: "",
  date: format(addDays(new Date(), 1), "yyyy-MM-dd"),
  pricingTierId: null,
  courtNumber: null,
  startTime: "",
  paymentStatus: "unpaid",
};

function fmt12(t: string): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const p = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${p}`;
}

// ── Step 1: Renter Info ────────────────────────────────────────────────────────

function Step1({ state, onChange }: { state: WizardState; onChange: (u: Partial<WizardState>) => void }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-1">Who's renting?</h2>
        <p className="text-sm text-muted-foreground">Enter the customer's contact details for this booking.</p>
      </div>

      <div className="space-y-4">
        <div>
          <Label className="text-sm font-medium">
            Full Name <span className="text-red-400">*</span>
          </Label>
          <div className="relative mt-1.5">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={state.customerName}
              onChange={(e) => onChange({ customerName: e.target.value })}
              placeholder="Jane Smith"
              className="pl-9"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-sm font-medium">Email</Label>
            <div className="relative mt-1.5">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="email"
                value={state.customerEmail}
                onChange={(e) => onChange({ customerEmail: e.target.value })}
                placeholder="jane@example.com"
                className="pl-9"
              />
            </div>
          </div>
          <div>
            <Label className="text-sm font-medium">Phone</Label>
            <div className="relative mt-1.5">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="tel"
                value={state.customerPhone}
                onChange={(e) => onChange({ customerPhone: e.target.value })}
                placeholder="(555) 000-0000"
                className="pl-9"
              />
            </div>
          </div>
        </div>

        <div>
          <Label className="text-sm font-medium">Customer Notes</Label>
          <Input
            value={state.notes}
            onChange={(e) => onChange({ notes: e.target.value })}
            placeholder="e.g. Birthday party, corporate event..."
            className="mt-1.5"
          />
        </div>

        <div>
          <Label className="text-sm font-medium">Admin Notes</Label>
          <Input
            value={state.adminNotes}
            onChange={(e) => onChange({ adminNotes: e.target.value })}
            placeholder="Internal notes (not visible to customer)"
            className="mt-1.5"
          />
        </div>
      </div>
    </div>
  );
}

// ── Step 2: Date & Court ───────────────────────────────────────────────────────

function Step2({ state, onChange }: { state: WizardState; onChange: (u: Partial<WizardState>) => void }) {
  const { getToken } = useAuth();

  const { data: tiers = [] } = useQuery({
    queryKey: ["admin-rental-pricing"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/rental-pricing`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.json();
    },
  });

  const selectedTier = tiers.find((t: any) => t.id === state.pricingTierId);

  const { data: availability, isLoading: availLoading } = useQuery({
    queryKey: ["rental-availability", state.date, state.pricingTierId],
    enabled: !!state.date && !!state.pricingTierId,
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE}/rentals/availability?date=${state.date}&durationMinutes=${selectedTier?.durationMinutes}`
      );
      return res.json() as Promise<{ courtNumber: number; availableSlots: string[] }[]>;
    },
  });

  const courtSlots = (courtNum: number) =>
    availability?.find((a) => a.courtNumber === courtNum)?.availableSlots ?? [];

  // When tier changes, clear slot selection
  const handleTierChange = (tierId: number) => {
    onChange({ pricingTierId: tierId, startTime: "", courtNumber: null });
  };

  // When date changes, clear slot selection
  const handleDateChange = (date: string) => {
    onChange({ date, startTime: "", courtNumber: null });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-1">When & where?</h2>
        <p className="text-sm text-muted-foreground">Pick the date, pricing tier, and available time slot.</p>
      </div>

      {/* Date */}
      <div>
        <Label className="text-sm font-medium">
          Date <span className="text-red-400">*</span>
        </Label>
        <div className="relative mt-1.5">
          <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="date"
            value={state.date}
            min={format(new Date(), "yyyy-MM-dd")}
            onChange={(e) => handleDateChange(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Pricing tiers */}
      <div>
        <Label className="text-sm font-medium mb-2 block">
          Pricing Tier <span className="text-red-400">*</span>
        </Label>
        {tiers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active pricing tiers. Add them in Pricing Tiers settings first.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {tiers.filter((t: any) => t.isActive).map((tier: any) => (
              <button
                key={tier.id}
                type="button"
                onClick={() => handleTierChange(tier.id)}
                className={`p-3 rounded-xl border text-left transition-all ${
                  state.pricingTierId === tier.id
                    ? "border-primary bg-primary/10 ring-1 ring-primary"
                    : "border-border bg-card hover:border-primary/50"
                }`}
              >
                <p className="font-semibold text-sm text-foreground">{tier.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {tier.durationMinutes >= 60
                    ? `${tier.durationMinutes / 60}hr${tier.durationMinutes > 60 ? "s" : ""}`
                    : `${tier.durationMinutes} min`}
                </p>
                <p className="text-emerald-400 font-bold text-sm mt-1">${Number(tier.price).toFixed(2)}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Court & time slot grid */}
      {state.pricingTierId && (
        <div>
          <Label className="text-sm font-medium mb-2 block">
            Court & Time Slot <span className="text-red-400">*</span>
          </Label>
          {availLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking availability…
            </div>
          ) : (
            <div className="space-y-4">
              {[1, 2].map((court) => {
                const slots = courtSlots(court);
                return (
                  <div key={court}>
                    <p className="text-sm font-medium text-foreground mb-2">Court {court}</p>
                    {slots.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No available slots for this date and duration.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {slots.map((slot) => {
                          const isSelected = state.courtNumber === court && state.startTime === slot;
                          return (
                            <button
                              key={slot}
                              type="button"
                              onClick={() => onChange({ courtNumber: court, startTime: slot })}
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                                isSelected
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "bg-card border-border hover:border-primary/50 text-foreground"
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

      {/* Payment status */}
      <div>
        <Label className="text-sm font-medium mb-2 block">Payment Status</Label>
        <div className="flex gap-3">
          {(["unpaid", "paid"] as const).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => onChange({ paymentStatus: status })}
              className={`px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
                state.paymentStatus === status
                  ? "border-primary bg-primary/10 text-foreground ring-1 ring-primary"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {status === "paid" ? "Paid (cash/external)" : "Unpaid — collect later"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Step 3: Review ─────────────────────────────────────────────────────────────

function Step3({ state, tiers }: { state: WizardState; tiers: any[] }) {
  const selectedTier = tiers.find((t: any) => t.id === state.pricingTierId);
  const endMin = selectedTier
    ? state.startTime
        ? (() => {
            const [h, m] = state.startTime.split(":").map(Number);
            const total = h * 60 + m + selectedTier.durationMinutes;
            return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
          })()
        : ""
    : "";

  const rows: { icon: React.ElementType; label: string; value: string; accent?: string }[] = [
    { icon: User, label: "Customer", value: [state.customerName, state.customerEmail, state.customerPhone].filter(Boolean).join(" · ") },
    { icon: Calendar, label: "Date", value: state.date ? format(parseISO(state.date), "EEEE, MMMM d, yyyy") : "—" },
    { icon: Building2, label: "Court", value: state.courtNumber ? `Court ${state.courtNumber}` : "—" },
    { icon: Clock, label: "Time", value: state.startTime ? `${fmt12(state.startTime)} – ${fmt12(endMin)}` : "—" },
    { icon: DollarSign, label: "Price", value: selectedTier ? `$${Number(selectedTier.price).toFixed(2)} — ${selectedTier.name}` : "—", accent: "text-emerald-400" },
    { icon: CheckCircle2, label: "Payment", value: state.paymentStatus === "paid" ? "Paid (marked)" : "Unpaid — collect later" },
  ];

  if (state.notes) rows.push({ icon: User, label: "Notes", value: state.notes });
  if (state.adminNotes) rows.push({ icon: User, label: "Admin Notes", value: state.adminNotes });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-1">Review booking</h2>
        <p className="text-sm text-muted-foreground">Confirm the details before creating this rental.</p>
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {rows.map(({ icon: Icon, label, value, accent }, i) => (
          <div key={i} className={`flex items-start gap-4 px-5 py-4 ${i < rows.length - 1 ? "border-b border-border" : ""}`}>
            <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
              <Icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
              <p className={`text-sm font-medium ${accent ?? "text-foreground"}`}>{value || "—"}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-5 py-4">
        <p className="text-sm text-emerald-400 font-medium">
          Clicking "Confirm Booking" will create this rental as <strong>Confirmed</strong>.
          {state.paymentStatus === "paid"
            ? " It will be marked as paid."
            : " The customer will need to pay separately."}
        </p>
      </div>
    </div>
  );
}

// ── Main Wizard ───────────────────────────────────────────────────────────────

export default function NewRentalWizard() {
  const { data: profile, isLoading } = useGetMyProfile();
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(DEFAULT_STATE);
  const [submitting, setSubmitting] = useState(false);
  const [, setLocation] = useLocation();
  const { getToken } = useAuth();
  const { toast } = useToast();

  const { data: tiers = [] } = useQuery({
    queryKey: ["admin-rental-pricing"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/rental-pricing`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.json();
    },
    enabled: !!profile,
  });

  const onChange = (updates: Partial<WizardState>) => {
    setState((prev) => ({ ...prev, ...updates }));
  };

  const canProceed =
    step === 0
      ? state.customerName.trim().length > 0
      : step === 1
      ? !!state.date && !!state.pricingTierId && !!state.courtNumber && !!state.startTime
      : true;

  const handlePublish = async () => {
    setSubmitting(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/rentals`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          courtNumber: state.courtNumber,
          date: state.date,
          startTime: state.startTime,
          pricingTierId: state.pricingTierId,
          customerName: state.customerName,
          customerEmail: state.customerEmail || null,
          customerPhone: state.customerPhone || null,
          notes: state.notes || null,
          adminNotes: state.adminNotes || null,
          paymentStatus: state.paymentStatus,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        toast({ title: "Error", description: d.error, variant: "destructive" });
        return;
      }
      toast({ title: "Rental created!", description: `Court ${state.courtNumber} booked for ${state.customerName}.` });
      setLocation("/admin/rentals");
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) return null;
  if (!profile || profile.role !== "admin") return <Redirect to="/" />;

  return (
    <WizardShell
      title="New Court Rental"
      backHref="/admin/rentals"
      steps={STEPS}
      step={step}
      setStep={setStep}
      canProceed={canProceed}
      isLastStep={step === STEPS.length - 1}
      onPublish={handlePublish}
      publishLabel={submitting ? "Creating…" : "Confirm Booking"}
      publishDisabled={submitting || !canProceed}
    >
      {step === 0 && <Step1 state={state} onChange={onChange} />}
      {step === 1 && <Step2 state={state} onChange={onChange} />}
      {step === 2 && <Step3 state={state} tiers={tiers} />}
    </WizardShell>
  );
}
