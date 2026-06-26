import { API_BASE } from "@/lib/api-base";
import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DollarSign, Pencil, Trash2, Plus, ShieldCheck } from "lucide-react";

interface SplitRule {
  id: number;
  name: string;
  venueId: number | null;
  offeringType: string | null;
  offeringId: number | null;
  splitType: "percentage" | "flat" | "hybrid";
  facilityPct: string | null;
  flatFee: string | null;
  flatFeeUnit: string | null;
  version: number;
  isLatest: boolean;
  isActive: boolean;
  notes: string | null;
}

interface SplitPreview {
  grossAmount: number;
  facilityAmount: number;
  serviceFeeAmount: number;
  playonNet: number;
}

interface Props {
  offeringType: "league" | "tournament" | "camp" | "drop_in";
  offeringId: number;
  venueId?: number | null;
  eventName?: string;
  isSuperAdmin: boolean;
}

const OFFERING_TYPE_LABELS: Record<string, string> = {
  league: "League",
  tournament: "Tournament",
  camp: "Camp",
  drop_in: "Drop-in",
};

function splitTypeLabel(rule: SplitRule): string {
  if (rule.splitType === "percentage") return `${rule.facilityPct}% to facility`;
  if (rule.splitType === "flat") return `$${rule.flatFee} flat ${rule.flatFeeUnit ?? ""}`;
  return `$${rule.flatFee} flat + ${rule.facilityPct}%`;
}

function fmt(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const emptyForm = {
  name: "",
  splitType: "percentage" as "percentage" | "flat" | "hybrid",
  facilityPct: "",
  flatFee: "",
  flatFeeUnit: "per_event",
  notes: "",
};

export function EventSplitPanel({ offeringType, offeringId, venueId, eventName, isSuperAdmin }: Props) {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [previewGross, setPreviewGross] = useState("100");
  const [preview, setPreview] = useState<SplitPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const authHeader = async () => ({
    Authorization: `Bearer ${await getToken()}`,
    "Content-Type": "application/json",
  });

  const eventRuleQK = ["split-rules-event", offeringType, offeringId];
  const venueRuleQK = ["split-rules-venue", venueId];

  const { data: eventRules, isLoading: eventLoading } = useQuery<SplitRule[]>({
    queryKey: eventRuleQK,
    queryFn: async () => {
      const headers = await authHeader();
      const params = new URLSearchParams({ offeringType, offeringId: String(offeringId) });
      const res = await fetch(`${API_BASE}/admin/facility-split-rules?${params}`, { headers });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: venueRules } = useQuery<SplitRule[]>({
    queryKey: venueRuleQK,
    queryFn: async () => {
      if (!venueId) return [];
      const headers = await authHeader();
      const params = new URLSearchParams({ venueId: String(venueId) });
      const res = await fetch(`${API_BASE}/admin/facility-split-rules?${params}`, { headers });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!venueId,
  });

  // Follow backend precedence: venue-scoped event rule first, then null-venue event rule
  const venueScopedEventRule = venueId
    ? (eventRules?.find(r => r.isActive && r.venueId === venueId) ?? null)
    : null;
  const nullVenueEventRule = eventRules?.find(r => r.isActive && !r.venueId) ?? null;
  const eventRule = venueScopedEventRule ?? nullVenueEventRule;
  const venueDefaultRule = venueRules?.find(r => r.isActive && !r.offeringType && !r.offeringId) ?? null;
  const effectiveRule = eventRule ?? venueDefaultRule;

  async function computePreview() {
    const gross = parseFloat(previewGross);
    if (!gross || gross <= 0) return;
    setPreviewLoading(true);
    try {
      const headers = await authHeader();
      // Use the stateless preview endpoint — no DB writes, no side effects
      const previewPayload: Record<string, unknown> = {
        grossAmount: gross,
        paymentMethod: "card",
      };
      if (showForm) {
        // Inline rule from form
        previewPayload.splitType = form.splitType;
        if (form.facilityPct) previewPayload.facilityPct = Number(form.facilityPct);
        if (form.flatFee) previewPayload.flatFee = Number(form.flatFee);
        previewPayload.flatFeeUnit = form.flatFeeUnit || null;
      } else if (effectiveRule) {
        // Preview against the currently applied rule
        previewPayload.splitType = effectiveRule.splitType;
        if (effectiveRule.facilityPct) previewPayload.facilityPct = Number(effectiveRule.facilityPct);
        if (effectiveRule.flatFee) previewPayload.flatFee = Number(effectiveRule.flatFee);
        previewPayload.flatFeeUnit = effectiveRule.flatFeeUnit ?? null;
      }
      const res = await fetch(`${API_BASE}/admin/facility-split-rules/preview`, {
        method: "POST",
        headers,
        body: JSON.stringify(previewPayload),
      });
      if (res.ok) setPreview(await res.json());
    } catch {
      // silent
    } finally {
      setPreviewLoading(false);
    }
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const headers = await authHeader();
      const payload = {
        name: form.name || `${OFFERING_TYPE_LABELS[offeringType]} Override`,
        venueId: venueId ?? null,
        offeringType,
        offeringId,
        splitType: form.splitType,
        facilityPct: form.facilityPct ? Number(form.facilityPct) : null,
        flatFee: form.flatFee ? Number(form.flatFee) : null,
        flatFeeUnit: form.flatFeeUnit || null,
        notes: form.notes || null,
      };
      if (editingId) {
        const res = await fetch(`${API_BASE}/admin/facility-split-rules/${editingId}`, {
          method: "PATCH", headers, body: JSON.stringify(payload),
        });
        if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Failed"); }
        return res.json();
      } else {
        const res = await fetch(`${API_BASE}/admin/facility-split-rules`, {
          method: "POST", headers, body: JSON.stringify(payload),
        });
        if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Failed"); }
        return res.json();
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: eventRuleQK });
      qc.invalidateQueries({ queryKey: venueRuleQK });
      setShowForm(false);
      setEditingId(null);
      setForm({ ...emptyForm });
      setPreview(null);
      toast({ title: editingId ? "Override updated" : "Event split override created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: async () => {
      if (!eventRule) return;
      const headers = await authHeader();
      const res = await fetch(`${API_BASE}/admin/facility-split-rules/${eventRule.id}`, { method: "DELETE", headers });
      if (!res.ok && res.status !== 204) {
        const e = await res.json().catch(() => ({}));
        throw new Error((e as any).error ?? "Failed to remove override");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: eventRuleQK });
      qc.invalidateQueries({ queryKey: venueRuleQK });
      setShowRemoveConfirm(false);
      toast({ title: "Event override removed — venue default will apply" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function openCreate() {
    setEditingId(null);
    setForm({
      ...emptyForm,
      name: eventName ? `${eventName} Override` : `${OFFERING_TYPE_LABELS[offeringType]} Override`,
    });
    setPreview(null);
    setShowForm(true);
  }

  function openEdit(rule: SplitRule) {
    setEditingId(rule.id);
    setForm({
      name: rule.name,
      splitType: rule.splitType,
      facilityPct: rule.facilityPct ?? "",
      flatFee: rule.flatFee ?? "",
      flatFeeUnit: rule.flatFeeUnit ?? "per_event",
      notes: rule.notes ?? "",
    });
    setPreview(null);
    setShowForm(true);
  }

  if (eventLoading) {
    return (
      <div className="border-t bg-muted/30 px-4 py-4">
        <Skeleton className="h-12" />
      </div>
    );
  }

  return (
    <div className="border-t bg-muted/30 px-4 py-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <DollarSign className="h-3.5 w-3.5" /> Revenue Split
        </span>
        {isSuperAdmin && !showForm && (
          <div className="flex gap-2">
            {eventRule ? (
              <>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => openEdit(eventRule)}>
                  <Pencil className="h-3 w-3" /> Edit Override
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-red-500 border-red-300 hover:bg-red-50"
                  onClick={() => setShowRemoveConfirm(true)}>
                  <Trash2 className="h-3 w-3" /> Remove Override
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={openCreate}>
                <Plus className="h-3 w-3" /> Add Override
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Effective rule display */}
      {effectiveRule ? (
        <div className="space-y-2">
          <div className="rounded-lg border bg-background px-3 py-2.5">
            <div className="flex items-center gap-2 mb-1">
              {eventRule ? (
                <Badge className="text-xs bg-blue-600">Event Override</Badge>
              ) : (
                <Badge variant="secondary" className="text-xs">Venue Default</Badge>
              )}
              <span className="text-sm font-medium">{effectiveRule.name}</span>
              <Badge variant="outline" className="text-xs">v{effectiveRule.version}</Badge>
            </div>
            <div className="text-sm text-muted-foreground">{splitTypeLabel(effectiveRule)}</div>
            {effectiveRule.notes && (
              <div className="text-xs text-muted-foreground italic mt-1">{effectiveRule.notes}</div>
            )}
          </div>

          {/* Show venue default as fallback info when event override exists */}
          {eventRule && venueDefaultRule && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
              <ShieldCheck className="h-3 w-3 text-muted-foreground/60" />
              <span>Venue default: <span className="font-medium">{splitTypeLabel(venueDefaultRule)}</span> ({venueDefaultRule.name})</span>
            </div>
          )}
          {eventRule && !venueDefaultRule && venueId && (
            <div className="text-xs text-muted-foreground px-1">No venue-level default configured.</div>
          )}
          {!venueId && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground/70 px-1">
              <ShieldCheck className="h-3 w-3" />
              Venue default lookup not available — this event type has no direct venue association.
            </div>
          )}

          {/* Payout preview for the effective rule (outside form) */}
          {!showForm && (
            <div className="rounded-md border bg-muted/40 px-3 py-2">
              <div className="flex items-center gap-2 mb-2">
                <Label className="text-xs font-semibold text-muted-foreground">Payout Preview</Label>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  className="h-6 w-24 text-xs"
                  value={previewGross}
                  onChange={e => setPreviewGross(e.target.value)}
                />
                <span className="text-xs text-muted-foreground">gross</span>
                <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={computePreview} disabled={previewLoading}>
                  {previewLoading ? "..." : "Calculate"}
                </Button>
              </div>
              {preview && (
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <div><p className="text-muted-foreground">Gross</p><p className="font-semibold">{fmt(preview.grossAmount)}</p></div>
                  <div><p className="text-muted-foreground">Facility</p><p className="font-semibold text-amber-500">{fmt(preview.facilityAmount)}</p></div>
                  <div><p className="text-muted-foreground">Svc Fee</p><p className="font-semibold text-blue-500">{fmt(preview.serviceFeeAmount)}</p></div>
                  <div><p className="text-muted-foreground">PlayOn Net</p><p className="font-semibold text-green-500">{fmt(preview.playonNet)}</p></div>
                </div>
              )}
              {!preview && <p className="text-xs text-muted-foreground">Enter an amount and click Calculate to preview.</p>}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-1">
          <div className="text-sm text-muted-foreground">
            {venueId
              ? "No split rule configured for this event or venue."
              : "No event-specific split rule configured."}
            {isSuperAdmin && !showForm && (
              <button className="ml-2 text-primary underline text-xs" onClick={openCreate}>Add one</button>
            )}
          </div>
          {!venueId && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
              <ShieldCheck className="h-3 w-3" />
              Venue default lookup not available — this event type has no direct venue association.
            </div>
          )}
        </div>
      )}

      {/* Override form */}
      {showForm && (
        <Card className="mt-3 border-primary/30">
          <CardContent className="pt-4 space-y-3">
            <p className="text-sm font-semibold text-primary">
              {editingId ? "Edit Event Override (creates new version)" : "New Event Split Override"}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2 space-y-1">
                <Label className="text-xs">Rule Name</Label>
                <Input
                  className="h-8 text-sm"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder={`${OFFERING_TYPE_LABELS[offeringType]} Override`}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Split Type</Label>
                <select
                  className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm"
                  value={form.splitType}
                  onChange={e => setForm(f => ({ ...f, splitType: e.target.value as any }))}
                >
                  <option value="percentage">Percentage</option>
                  <option value="flat">Flat Fee</option>
                  <option value="hybrid">Hybrid (flat + percentage)</option>
                </select>
              </div>
              {(form.splitType === "percentage" || form.splitType === "hybrid") && (
                <div className="space-y-1">
                  <Label className="text-xs">Facility % *</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    className="h-8 text-sm"
                    placeholder="e.g. 20"
                    value={form.facilityPct}
                    onChange={e => setForm(f => ({ ...f, facilityPct: e.target.value }))}
                  />
                </div>
              )}
              {(form.splitType === "flat" || form.splitType === "hybrid") && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">Flat Fee ($) *</Label>
                    <Input
                      type="number"
                      step="0.01"
                      className="h-8 text-sm"
                      placeholder="e.g. 50"
                      value={form.flatFee}
                      onChange={e => setForm(f => ({ ...f, flatFee: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Flat Fee Unit</Label>
                    <select
                      className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm"
                      value={form.flatFeeUnit}
                      onChange={e => setForm(f => ({ ...f, flatFeeUnit: e.target.value }))}
                    >
                      <option value="per_session">Per Session</option>
                      <option value="per_event">Per Event</option>
                      <option value="per_hour">Per Hour</option>
                    </select>
                  </div>
                </>
              )}
              <div className="md:col-span-2 space-y-1">
                <Label className="text-xs">Notes (optional)</Label>
                <Input
                  className="h-8 text-sm"
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="e.g. Tournament final deal agreed on 2026-06-01"
                />
              </div>
            </div>

            {/* Live payout preview */}
            <div className="rounded-md border bg-muted/40 px-3 py-2.5">
              <div className="flex items-center gap-2 mb-2">
                <Label className="text-xs font-semibold text-muted-foreground">Payout Preview</Label>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  className="h-6 w-24 text-xs"
                  value={previewGross}
                  onChange={e => setPreviewGross(e.target.value)}
                />
                <span className="text-xs text-muted-foreground">gross</span>
                <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={computePreview} disabled={previewLoading}>
                  {previewLoading ? "..." : "Calculate"}
                </Button>
              </div>
              {preview && (
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <div><p className="text-muted-foreground">Gross</p><p className="font-semibold">{fmt(preview.grossAmount)}</p></div>
                  <div><p className="text-muted-foreground">Facility</p><p className="font-semibold text-amber-500">{fmt(preview.facilityAmount)}</p></div>
                  <div><p className="text-muted-foreground">Svc Fee</p><p className="font-semibold text-blue-500">{fmt(preview.serviceFeeAmount)}</p></div>
                  <div><p className="text-muted-foreground">PlayOn Net</p><p className="font-semibold text-green-500">{fmt(preview.playonNet)}</p></div>
                </div>
              )}
              {!preview && <p className="text-xs text-muted-foreground">Enter an amount and click Calculate to preview.</p>}
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                onClick={() => saveMutation.mutate()}
                disabled={
                  saveMutation.isPending ||
                  (form.splitType === "percentage" && !form.facilityPct) ||
                  (form.splitType === "flat" && !form.flatFee) ||
                  (form.splitType === "hybrid" && (!form.facilityPct || !form.flatFee))
                }
              >
                {saveMutation.isPending ? "Saving..." : editingId ? "Save New Version" : "Create Override"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setShowForm(false); setEditingId(null); setPreview(null); }}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Remove override confirmation */}
      <AlertDialog open={showRemoveConfirm} onOpenChange={setShowRemoveConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove event split override?</AlertDialogTitle>
            <AlertDialogDescription>
              This will deactivate the event-specific rule <strong>{eventRule?.name}</strong>.
              {venueDefaultRule
                ? <> Payments will revert to the venue default: <strong>{splitTypeLabel(venueDefaultRule)}</strong> ({venueDefaultRule.name}).</>
                : <> No venue default is configured — payments will proceed with no facility split.</>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Override</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => removeMutation.mutate()}
              disabled={removeMutation.isPending}
            >
              {removeMutation.isPending ? "Removing..." : "Remove Override"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
