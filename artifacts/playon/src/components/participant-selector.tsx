import React, { useEffect, useState } from "react";
import { Link } from "wouter";
import { Baby, User, AlertCircle, CheckCircle2, ExternalLink, Clock, FileWarning, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { useToast } from "@/hooks/use-toast";
import { ChildWaiverSignModal } from "@/components/waiver-modal";

const API = "/api";

const AGE_RANGES: Record<string, { min: number; max: number }> = {
  u8:  { min: 8,  max: 8  }, u9:  { min: 9,  max: 9  }, u10: { min: 10, max: 10 },
  u11: { min: 11, max: 11 }, u12: { min: 12, max: 12 }, u13: { min: 13, max: 13 },
  u14: { min: 14, max: 14 }, u15: { min: 15, max: 15 }, u16: { min: 16, max: 16 },
  u17: { min: 17, max: 17 }, u18: { min: 18, max: 18 }, adult: { min: 18, max: 999 },
  u8_u11: { min: 8, max: 11 }, u12_u15: { min: 12, max: 15 },
};

const AGE_GROUP_LABELS: Record<string, string> = {
  u8: "U8", u9: "U9", u10: "U10", u11: "U11", u12: "U12", u13: "U13",
  u14: "U14", u15: "U15", u16: "U16", u17: "U17", u18: "U18",
  adult: "Adult", u8_u11: "Youth 8–11", u12_u15: "Youth 12–15",
};

function ageAtDate(dobStr: string, referenceDate: Date): number {
  const dob = new Date(dobStr);
  let age = referenceDate.getFullYear() - dob.getFullYear();
  const m = referenceDate.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && referenceDate.getDate() < dob.getDate())) age--;
  return age;
}

export function isAgeEligible(ageGroups: string[], dob: string | null | undefined, eventStartDate?: string | null): boolean {
  if (!dob) return false;
  const ranges = ageGroups.map(ag => AGE_RANGES[ag]).filter(Boolean);
  if (ranges.length === 0) return true;
  const referenceDate = eventStartDate ? new Date(eventStartDate + "T12:00:00") : new Date();
  const age = ageAtDate(dob, referenceDate);
  return ranges.some(r => age >= r.min && age <= r.max);
}

export function isYouthEvent(ageGroups: string[]): boolean {
  return ageGroups.some(ag => ag !== "adult");
}

export type SelectedParticipant = {
  id: number;
  firstName: string;
  lastName: string;
  isChild: boolean;
  guardianUserId?: number;
};

interface ParticipantSelectorProps {
  ageGroups: string[];
  eventStartDate?: string | null;
  value: SelectedParticipant | null;
  onChange: (p: SelectedParticipant | null) => void;
  currentUserId?: number | null;
  currentUserProfile?: { id: number; firstName: string; lastName: string } | null;
  enabled?: boolean;
}

export function ParticipantSelector({
  ageGroups,
  eventStartDate,
  value,
  onChange,
  currentUserId,
  currentUserProfile,
  enabled = true,
}: ParticipantSelectorProps) {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [waiverDialog, setWaiverDialog] = useState<{ childId: number; childName: string } | null>(null);
  const [waiverReason, setWaiverReason] = useState("");
  const [liabilityWaiverDialog, setLiabilityWaiverDialog] = useState<{ childId: number; childName: string } | null>(null);

  const { data: guardianLinks, isLoading } = useQuery({
    queryKey: ["my-guardian-links"],
    queryFn: async () => {
      const token = await getToken();
      const r = await fetch(`${API}/me/guardian-links`, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      return r.ok ? r.json() : [];
    },
    enabled,
  });

  const allLinkedChildren: Array<{ id: number; firstName: string; lastName: string; dob: string | null }> =
    (guardianLinks ?? [])
      .filter((link: any) => link.status === "approved" && link.canRegister)
      .map((link: any) => ({
        id: link.youthUserId,
        firstName: link.youthFirstName ?? "",
        lastName: link.youthLastName ?? "",
        dob: link.youthDateOfBirth ?? null,
      }));

  const waiverResults = useQueries({
    queries: allLinkedChildren.map((child) => ({
      queryKey: ["child-age-waivers", child.id],
      queryFn: async () => {
        const token = await getToken();
        const r = await fetch(`${API}/age-group-waivers/player/${child.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) return [];
        return r.json() as Promise<Array<{ id: number; ageGroup: string; status: string }>>;
      },
      enabled: enabled && allLinkedChildren.length > 0,
    })),
  });

  const liabilityWaiverResults = useQueries({
    queries: allLinkedChildren.map((child) => ({
      queryKey: ["child-waiver-status", child.id],
      queryFn: async () => {
        const token = await getToken();
        const r = await fetch(`${API}/me/waiver-status?youthUserId=${child.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) return { hasSigned: false, isExpired: true };
        return r.json() as Promise<{ hasSigned: boolean; isExpired: boolean }>;
      },
      enabled: enabled && allLinkedChildren.length > 0,
      staleTime: 2 * 60 * 1000,
    })),
  });

  const waiversByChild = new Map<number, Array<{ id: number; ageGroup: string; status: string }>>();
  allLinkedChildren.forEach((child, i) => {
    waiversByChild.set(child.id, waiverResults[i]?.data ?? []);
  });

  const liabilityStatusByChild = new Map<number, { hasSigned: boolean; isExpired: boolean }>();
  allLinkedChildren.forEach((child, i) => {
    liabilityStatusByChild.set(child.id, liabilityWaiverResults[i]?.data ?? { hasSigned: false, isExpired: true });
  });

  function getLiabilityWaiverOk(childId: number): boolean {
    const s = liabilityStatusByChild.get(childId);
    return !!s && s.hasSigned && !s.isExpired;
  }

  function getWaiverStatus(childId: number): "approved" | "pending" | null {
    const waivers = waiversByChild.get(childId) ?? [];
    if (waivers.some(w => ageGroups.includes(w.ageGroup) && w.status === "approved")) return "approved";
    if (waivers.some(w => ageGroups.includes(w.ageGroup) && w.status === "pending")) return "pending";
    return null;
  }

  const submitWaiver = useMutation({
    mutationFn: async ({ childId, reason }: { childId: number; reason: string }) => {
      const token = await getToken();
      const results = await Promise.all(
        ageGroups.map(ag =>
          fetch(`${API}/age-group-waivers`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ playerId: childId, ageGroup: ag, reason }),
          }).then(async r => {
            if (!r.ok) {
              const body = await r.json().catch(() => ({}));
              throw new Error(body.error ?? "Failed to submit waiver");
            }
            return r.json();
          })
        )
      );
      return results;
    },
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ["child-age-waivers", variables.childId] });
      setWaiverDialog(null);
      setWaiverReason("");
      toast({ title: "Waiver requested", description: "Your age group waiver request is pending admin review." });
    },
    onError: (err: any) => {
      toast({ title: "Failed to submit waiver", description: err.message, variant: "destructive" });
    },
  });

  const eligibleChildren = allLinkedChildren.filter(child => {
    if (isAgeEligible(ageGroups, child.dob, eventStartDate)) return true;
    return getWaiverStatus(child.id) === "approved";
  });

  const ineligibleChildren = allLinkedChildren
    .filter(child => !eligibleChildren.find(e => e.id === child.id))
    .map(child => ({
      ...child,
      reason: !child.dob ? "Missing date of birth" : "Age not in eligible range",
      waiverStatus: !child.dob ? null : getWaiverStatus(child.id),
    }));

  const approvedTotal = allLinkedChildren.length;

  const includesSelf = ageGroups.includes("adult") && !!currentUserProfile;

  const selfOption: SelectedParticipant | null = includesSelf && currentUserProfile
    ? { id: currentUserProfile.id, firstName: currentUserProfile.firstName, lastName: currentUserProfile.lastName, isChild: false }
    : null;
  const childOptions: SelectedParticipant[] = eligibleChildren.map(c => ({
    id: c.id, firstName: c.firstName, lastName: c.lastName, isChild: true,
    guardianUserId: currentUserId ?? undefined,
  }));
  const allOptions: SelectedParticipant[] = selfOption ? [selfOption, ...childOptions] : childOptions;

  useEffect(() => {
    if (!enabled || isLoading || value !== null) return;
    if (allOptions.length === 1) {
      onChange(allOptions[0]);
    }
  }, [isLoading, enabled]);

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-14 bg-white/5 rounded-xl" />
        <Skeleton className="h-14 bg-white/5 rounded-xl" />
      </div>
    );
  }

  const ageGroupLabel = ageGroups.map(ag => AGE_GROUP_LABELS[ag] ?? ag.toUpperCase()).join(", ");

  if (!includesSelf && (!guardianLinks?.length || approvedTotal === 0)) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
        <p className="text-sm font-semibold text-amber-400 flex items-center gap-1.5">
          <AlertCircle className="h-4 w-4" />No linked children on your account
        </p>
        <p className="text-xs text-amber-400/70">
          Add and verify your child's profile before registering them for this event.
        </p>
        <Button variant="outline" size="sm" className="w-full border-amber-500/30 text-amber-400 hover:bg-amber-500/10" asChild>
          <Link href="/guardian/children">
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" />Add Child Profile →
          </Link>
        </Button>
      </div>
    );
  }

  if (!includesSelf && eligibleChildren.length === 0) {
    const rangeStr = ageGroups
      .map(ag => {
        const r = AGE_RANGES[ag];
        if (!r) return ag;
        return r.max === 999 ? "18+" : r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`;
      })
      .join(", ");
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 space-y-2">
        <p className="text-sm font-semibold text-red-400 flex items-center gap-1.5">
          <AlertCircle className="h-4 w-4" />No eligible children for this event
        </p>
        <p className="text-xs text-red-400/70">
          This event requires participants aged {rangeStr}. None of your linked children currently qualify.
        </p>
        {ineligibleChildren.length > 0 && (
          <div className="mt-2 space-y-2">
            {ineligibleChildren.map(c => (
              <div key={c.id} className="flex items-center justify-between text-xs bg-white/5 rounded-lg px-3 py-2">
                <span className="text-white/50">{c.firstName} {c.lastName}</span>
                {c.reason === "Missing date of birth" ? (
                  <Link href={`/guardian/children/${c.id}`} className="text-amber-400/80 hover:text-amber-400 underline underline-offset-2">
                    Add date of birth →
                  </Link>
                ) : c.waiverStatus === "pending" ? (
                  <span className="flex items-center gap-1 text-amber-400/80">
                    <Clock className="h-3 w-3" />Waiver pending review
                  </span>
                ) : c.waiverStatus === "approved" ? null : (
                  <button
                    type="button"
                    className="text-[#60a5fa] hover:text-blue-300 underline underline-offset-2"
                    onClick={() => { setWaiverReason(""); setWaiverDialog({ childId: c.id, childName: `${c.firstName} ${c.lastName}` }); }}
                  >
                    Request Age Waiver
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <WaiverDialogElement
          open={!!waiverDialog}
          onOpenChange={(open) => { if (!open) { setWaiverDialog(null); setWaiverReason(""); } }}
          childName={waiverDialog?.childName ?? ""}
          ageGroupLabel={ageGroupLabel}
          reason={waiverReason}
          onReasonChange={setWaiverReason}
          onSubmit={() => { if (waiverDialog) submitWaiver.mutate({ childId: waiverDialog.childId, reason: waiverReason }); }}
          isPending={submitWaiver.isPending}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {allOptions.map(option => {
        const isSelected = value?.id === option.id;
        const liabilityOk = !option.isChild || getLiabilityWaiverOk(option.id);
        const childName = `${option.firstName} ${option.lastName}`;
        return (
          <div key={option.id} className="space-y-1">
            <button
              type="button"
              onClick={() => liabilityOk ? onChange(option) : undefined}
              disabled={!liabilityOk}
              className={`w-full text-left p-3 rounded-xl border transition-all duration-200 flex items-center justify-between ${
                !liabilityOk
                  ? "border-amber-500/30 bg-amber-500/5 cursor-default opacity-80"
                  : isSelected
                    ? "border-[#1d4ed8] bg-[#1d4ed8]/10 text-white"
                    : "border-white/10 bg-white/5 text-white hover:bg-white/10"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                  !liabilityOk ? "bg-amber-500/20 border border-amber-500/30" : "bg-[#1d4ed8]/20 border border-[#1d4ed8]/30"
                }`}>
                  {option.isChild
                    ? <Baby className={`h-3.5 w-3.5 ${!liabilityOk ? "text-amber-400" : "text-[#60a5fa]"}`} />
                    : <User className="h-3.5 w-3.5 text-[#60a5fa]" />}
                </div>
                <div>
                  <span className="font-medium text-sm">{option.firstName} {option.lastName}</span>
                  {!option.isChild && <span className="ml-1.5 text-xs text-white/40">(me)</span>}
                  {option.isChild && liabilityOk && (
                    <span className="ml-1.5 inline-flex items-center gap-0.5 text-xs text-green-400/70">
                      <ShieldCheck className="h-3 w-3" />waiver signed
                    </span>
                  )}
                </div>
              </div>
              {liabilityOk && isSelected && <CheckCircle2 className="h-4 w-4 text-[#1d4ed8] flex-shrink-0" />}
              {!liabilityOk && <FileWarning className="h-4 w-4 text-amber-400 flex-shrink-0" />}
            </button>
            {option.isChild && !liabilityOk && (
              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/20 text-xs">
                <span className="text-amber-400/80">Liability waiver required for {option.firstName}</span>
                <button
                  type="button"
                  className="text-amber-300 hover:text-amber-200 underline underline-offset-2 font-medium ml-2 flex-shrink-0"
                  onClick={() => setLiabilityWaiverDialog({ childId: option.id, childName })}
                >
                  Sign waiver →
                </button>
              </div>
            )}
          </div>
        );
      })}
      {ineligibleChildren.length > 0 && (
        <div className="pt-1 space-y-1">
          {ineligibleChildren.map(c => (
            <div key={c.id} className="flex items-center justify-between px-2 py-1.5 text-xs rounded-lg bg-white/[0.03]">
              <span className="text-white/30">{c.firstName} {c.lastName}</span>
              {c.reason === "Missing date of birth" ? (
                <Link href={`/guardian/children/${c.id}`} className="text-amber-400/70 hover:text-amber-400 underline underline-offset-2">
                  Add date of birth →
                </Link>
              ) : c.waiverStatus === "pending" ? (
                <span className="flex items-center gap-1 text-amber-400/70">
                  <Clock className="h-3 w-3" />Waiver pending review
                </span>
              ) : (
                <button
                  type="button"
                  className="text-[#60a5fa]/80 hover:text-[#60a5fa] underline underline-offset-2"
                  onClick={() => { setWaiverReason(""); setWaiverDialog({ childId: c.id, childName: `${c.firstName} ${c.lastName}` }); }}
                >
                  Request Age Waiver
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {liabilityWaiverDialog && (
        <ChildWaiverSignModal
          open={!!liabilityWaiverDialog}
          onOpenChange={(open) => { if (!open) setLiabilityWaiverDialog(null); }}
          childId={liabilityWaiverDialog.childId}
          childName={liabilityWaiverDialog.childName}
          onComplete={() => setLiabilityWaiverDialog(null)}
        />
      )}
      <WaiverDialogElement
        open={!!waiverDialog}
        onOpenChange={(open) => { if (!open) { setWaiverDialog(null); setWaiverReason(""); } }}
        childName={waiverDialog?.childName ?? ""}
        ageGroupLabel={ageGroupLabel}
        reason={waiverReason}
        onReasonChange={setWaiverReason}
        onSubmit={() => { if (waiverDialog) submitWaiver.mutate({ childId: waiverDialog.childId, reason: waiverReason }); }}
        isPending={submitWaiver.isPending}
      />
    </div>
  );
}

interface WaiverDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  childName: string;
  ageGroupLabel: string;
  reason: string;
  onReasonChange: (val: string) => void;
  onSubmit: () => void;
  isPending: boolean;
}

function WaiverDialogElement({ open, onOpenChange, childName, ageGroupLabel, reason, onReasonChange, onSubmit, isPending }: WaiverDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#111118] border-white/10 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">Request Age Group Waiver</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <p className="text-xs text-white/40 uppercase tracking-wide font-semibold">Child</p>
            <p className="text-sm text-white/80 bg-white/5 rounded-lg px-3 py-2">{childName}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-white/40 uppercase tracking-wide font-semibold">Age Group</p>
            <p className="text-sm text-white/80 bg-white/5 rounded-lg px-3 py-2">{ageGroupLabel}</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-white/40 uppercase tracking-wide font-semibold">
              Reason for waiver request
            </label>
            <Textarea
              className="bg-white/5 border-white/10 text-white placeholder:text-white/25 resize-none focus:border-[#1d4ed8] focus:ring-0"
              rows={3}
              placeholder="Explain why this child should be allowed to participate in this age group…"
              value={reason}
              onChange={e => onReasonChange(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            className="border-white/20 text-white hover:bg-white/10"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            className="bg-[#1d4ed8] hover:bg-[#1e40af] border-none text-white"
            onClick={onSubmit}
            disabled={!reason.trim() || isPending}
          >
            {isPending ? "Submitting…" : "Submit Request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
