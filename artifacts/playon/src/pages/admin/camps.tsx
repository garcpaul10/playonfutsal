import React, { useState } from "react";
import { Redirect, useLocation } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { useAdminPermissions } from "@/hooks/use-admin-permissions";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { toEasternISOString, toEasternLocalString } from "@/lib/timezone";
import {
  Plus, Pencil, Trash2, Download, ClipboardList,
  ChevronDown, ChevronUp, UserPlus, Calendar, Users,
  CheckCircle2, AlertCircle, ShieldCheck, BarChart2, HeartPulse,
  ArrowUpCircle, Clock, DollarSign,
  Globe, Star, Smartphone,
} from "lucide-react";
import { EventSplitPanel } from "@/components/event-split-panel";
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

import { AGE_GROUPS } from "@workspace/brand";

const API = "/api";
const GENDER_OPTIONS = [
  { value: "boy", label: "Boys" },
  { value: "girl", label: "Girls" },
  { value: "men", label: "Men" },
  { value: "women", label: "Women" },
  { value: "coed", label: "Coed" },
];

const PAYMENT_STATUSES = [
  { value: "unpaid", label: "Unpaid" },
  { value: "paid_inapp", label: "Paid (In-App)" },
  { value: "paid_external", label: "Paid (External)" },
  { value: "refunded", label: "Refunded" },
  { value: "waived", label: "Waived" },
];

function useAuthHeaders() {
  const { getToken } = useAuth();
  return async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  };
}

function VisibilityToggleGroup({ eventType, eventId, isPublished, isFeatured, showOnMobile, canManage, queryKey }: {
  eventType: string; eventId: number;
  isPublished: boolean; isFeatured: boolean; showOnMobile: boolean;
  canManage: boolean; queryKey: string[];
}) {
  const getHeaders = useAuthHeaders();
  const qc = useQueryClient();
  const { toast } = useToast();

  const patchVisibility = useMutation({
    mutationFn: async (patch: { isPublished?: boolean; isFeatured?: boolean; showOnMobile?: boolean }) => {
      const headers = await getHeaders();
      const r = await fetch(`/api/programs/${eventType}s/${eventId}/visibility`, {
        method: "PATCH", headers, body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey }); },
    onError: (e: any) => toast({ title: "Error saving visibility", description: e.message, variant: "destructive" }),
  });

  if (!canManage) return null;

  return (
    <div className="flex items-center gap-0.5 border rounded-md overflow-hidden" title="Visibility controls">
      <button
        type="button"
        className={`h-7 w-8 flex items-center justify-center transition-colors ${isPublished ? "bg-green-500/15 text-green-500 hover:bg-green-500/25" : "text-muted-foreground/40 hover:bg-muted"}`}
        title={isPublished ? "Published — click to unpublish" : "Unpublished — click to publish"}
        onClick={(e) => { e.stopPropagation(); patchVisibility.mutate({ isPublished: !isPublished }); }}
      >
        <Globe className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className={`h-7 w-8 flex items-center justify-center transition-colors border-l ${isFeatured ? "bg-amber-500/15 text-amber-500 hover:bg-amber-500/25" : "text-muted-foreground/40 hover:bg-muted"}`}
        title={isFeatured ? "Featured on homepage — click to unfeature" : "Not featured — click to feature on homepage"}
        onClick={(e) => { e.stopPropagation(); patchVisibility.mutate({ isFeatured: !isFeatured }); }}
      >
        <Star className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className={`h-7 w-8 flex items-center justify-center transition-colors border-l ${showOnMobile ? "bg-blue-500/15 text-blue-500 hover:bg-blue-500/25" : "text-muted-foreground/40 hover:bg-muted"}`}
        title={showOnMobile ? "Visible in mobile app — click to hide" : "Hidden from mobile app — click to show"}
        onClick={(e) => { e.stopPropagation(); patchVisibility.mutate({ showOnMobile: !showOnMobile }); }}
      >
        <Smartphone className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ─── Coaches Panel ─────────────────────────────────────────────────────────────

function CoachesPanel({ campId }: { campId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const getHeaders = useAuthHeaders();
  const { canManageCamps } = useAdminPermissions();
  const [addingCoach, setAddingCoach] = useState(false);
  const [newCoach, setNewCoach] = useState({ staffUserId: "", role: "coach", compensationAmount: "" });

  const { data: coaches, isLoading } = useQuery({
    queryKey: ["camp-coaches", campId],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/camps/${campId}/coaches`, { headers });
      return r.json();
    },
  });

  const { data: staff } = useQuery({
    queryKey: ["staff-list"],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/staff-profiles`, { headers });
      return r.ok ? r.json() : [];
    },
  });

  const addCoach = useMutation({
    mutationFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/camps/${campId}/coaches`, {
        method: "POST", headers,
        body: JSON.stringify({ staffUserId: Number(newCoach.staffUserId), role: newCoach.role, compensationAmount: newCoach.compensationAmount || null }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["camp-coaches", campId] }); toast({ title: "Coach assigned" }); setAddingCoach(false); setNewCoach({ staffUserId: "", role: "coach", compensationAmount: "" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const removeCoach = useMutation({
    mutationFn: async (assignmentId: number) => {
      const headers = await getHeaders();
      await fetch(`${API}/camps/${campId}/coaches/${assignmentId}`, { method: "DELETE", headers });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["camp-coaches", campId] }); toast({ title: "Coach removed" }); },
  });

  if (isLoading) return <div className="px-4 pb-4"><Skeleton className="h-12" /></div>;

  return (
    <div className="border-t bg-muted/30 px-4 py-4 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Coaches</span>
        {canManageCamps && (
          <Button size="sm" variant="outline" onClick={() => setAddingCoach(v => !v)}>
            <Plus className="h-3 w-3 mr-1" /> Assign Coach
          </Button>
        )}
      </div>

      {addingCoach && (
        <Card className="p-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
            <div>
              <Label className="text-xs">Staff Member</Label>
              <Input className="h-8 text-xs" placeholder="Staff user ID" value={newCoach.staffUserId} onChange={e => setNewCoach(c => ({ ...c, staffUserId: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Role</Label>
              <select className="w-full h-8 rounded border border-input bg-background px-2 text-xs" value={newCoach.role} onChange={e => setNewCoach(c => ({ ...c, role: e.target.value }))}>
                <option value="coach">Coach</option>
                <option value="assistant_coach">Assistant Coach</option>
                <option value="supervisor">Supervisor</option>
              </select>
            </div>
            <div>
              <Label className="text-xs">Pay ($)</Label>
              <Input type="number" step="0.01" className="h-8 text-xs" value={newCoach.compensationAmount} onChange={e => setNewCoach(c => ({ ...c, compensationAmount: e.target.value }))} />
            </div>
          </div>
          <div className="flex gap-2 justify-end mt-2">
            <Button size="sm" variant="outline" onClick={() => setAddingCoach(false)}>Cancel</Button>
            <Button size="sm" onClick={() => addCoach.mutate()} disabled={addCoach.isPending || !newCoach.staffUserId}>Assign</Button>
          </div>
        </Card>
      )}

      {coaches?.length === 0 && <p className="text-xs text-muted-foreground">No coaches assigned.</p>}

      {coaches?.map((a: any) => {
        // ── Background-check expiry logic ───────────────────────────────────
        // Background checks expire 2 years from backgroundCheckDate.
        const bgDate = a.staffProfile?.backgroundCheckDate ? new Date(a.staffProfile.backgroundCheckDate) : null;
        const bgExpiry = bgDate ? new Date(bgDate.getFullYear() + 2, bgDate.getMonth(), bgDate.getDate()) : null;
        const now = new Date();
        const daysUntilExpiry = bgExpiry ? Math.floor((bgExpiry.getTime() - now.getTime()) / 86_400_000) : null;
        const bgExpired = daysUntilExpiry !== null && daysUntilExpiry < 0;
        const bgExpiringSoon = daysUntilExpiry !== null && daysUntilExpiry >= 0 && daysUntilExpiry <= 90;
        const bgCleared = a.staffProfile?.backgroundCheckStatus === "approved" && !bgExpired;

        return (
          <div key={a.id} className={`bg-background border rounded-lg p-3 flex items-start justify-between gap-3 ${bgExpired ? "border-destructive/40" : bgExpiringSoon ? "border-amber-400/60" : ""}`}>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm">{a.user?.firstName} {a.user?.lastName} <span className="text-muted-foreground text-xs">({a.user?.email})</span></div>
              <div className="flex flex-wrap gap-2 mt-1">
                <Badge variant="secondary" className="text-xs capitalize">{a.role}</Badge>
                {a.staffProfile?.backgroundCheckStatus ? (
                  <>
                    <Badge
                      variant={bgExpired ? "destructive" : bgExpiringSoon ? "outline" : bgCleared ? "default" : "destructive"}
                      className={`text-xs ${bgExpiringSoon && !bgExpired ? "border-amber-500 text-amber-700 dark:text-amber-400" : ""}`}
                    >
                      <ShieldCheck className="h-3 w-3 mr-1" />
                      {bgExpired
                        ? `BG EXPIRED (${bgExpiry ? format(bgExpiry, "MMM d, yyyy") : ""})`
                        : bgExpiringSoon
                          ? `BG Expiring in ${daysUntilExpiry}d`
                          : bgCleared
                            ? `Cleared${bgExpiry ? ` until ${format(bgExpiry, "MMM yyyy")}` : ""}`
                            : `BG: ${a.staffProfile.backgroundCheckStatus}`}
                    </Badge>
                    {(bgExpired || bgExpiringSoon) && (
                      <span className={`text-xs font-medium flex items-center gap-1 ${bgExpired ? "text-destructive" : "text-amber-600 dark:text-amber-400"}`}>
                        <AlertCircle className="h-3 w-3" />
                        {bgExpired ? "Action required — renewal overdue" : "Renewal needed soon"}
                      </span>
                    )}
                  </>
                ) : (
                  <Badge variant="outline" className="text-xs text-muted-foreground">No BG check on file</Badge>
                )}
                {a.staffProfile?.certifications?.length > 0 && (
                  <Badge variant="outline" className="text-xs">{a.staffProfile.certifications.join(", ")}</Badge>
                )}
              </div>
            </div>
            {canManageCamps && (
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive h-7 w-7 p-0 flex-shrink-0" onClick={() => removeCoach.mutate(a.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Camp Days Panel ───────────────────────────────────────────────────────────

function CampDaysPanel({ campId }: { campId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const getHeaders = useAuthHeaders();
  const { canManageCamps } = useAdminPermissions();
  const [addingDay, setAddingDay] = useState(false);
  const [newDay, setNewDay] = useState({ date: "", startTime: "09:00", endTime: "12:00", notes: "" });

  const { data: days, isLoading } = useQuery({
    queryKey: ["camp-days", campId],
    queryFn: async () => {
      const r = await fetch(`${API}/camps/${campId}/days`);
      return r.json();
    },
  });

  const addDay = useMutation({
    mutationFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/camps/${campId}/days`, { method: "POST", headers, body: JSON.stringify(newDay) });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["camp-days", campId] }); toast({ title: "Day added" }); setAddingDay(false); setNewDay({ date: "", startTime: "09:00", endTime: "12:00", notes: "" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const removeDay = useMutation({
    mutationFn: async (dayId: number) => {
      const headers = await getHeaders();
      await fetch(`${API}/camps/${campId}/days/${dayId}`, { method: "DELETE", headers });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["camp-days", campId] }); },
  });

  if (isLoading) return <div className="px-4 pb-4"><Skeleton className="h-12" /></div>;

  return (
    <div className="border-t bg-muted/30 px-4 py-4 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Camp Days</span>
        {canManageCamps && (
          <Button size="sm" variant="outline" onClick={() => setAddingDay(v => !v)}>
            <Plus className="h-3 w-3 mr-1" /> Add Day
          </Button>
        )}
      </div>

      {addingDay && (
        <Card className="p-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
            <div>
              <Label className="text-xs">Date</Label>
              <Input type="date" className="h-8 text-xs" value={newDay.date} onChange={e => setNewDay(d => ({ ...d, date: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Start</Label>
              <Input type="time" className="h-8 text-xs" value={newDay.startTime} onChange={e => setNewDay(d => ({ ...d, startTime: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">End</Label>
              <Input type="time" className="h-8 text-xs" value={newDay.endTime} onChange={e => setNewDay(d => ({ ...d, endTime: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Notes</Label>
              <Input className="h-8 text-xs" value={newDay.notes} onChange={e => setNewDay(d => ({ ...d, notes: e.target.value }))} />
            </div>
          </div>
          <div className="flex gap-2 justify-end mt-2">
            <Button size="sm" variant="outline" onClick={() => setAddingDay(false)}>Cancel</Button>
            <Button size="sm" onClick={() => addDay.mutate()} disabled={addDay.isPending || !newDay.date}>Add Day</Button>
          </div>
        </Card>
      )}

      {days?.length === 0 && <p className="text-xs text-muted-foreground">No camp days added yet.</p>}

      <div className="space-y-2">
        {days?.map((day: any) => (
          <div key={day.id} className="bg-background border rounded-lg p-3 flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">{format(new Date(day.date + "T12:00:00"), "EEE, MMM d, yyyy")}</div>
              <div className="text-xs text-muted-foreground">{day.startTime} – {day.endTime}{day.notes ? ` · ${day.notes}` : ""}</div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="h-7 text-xs" asChild>
                <a href={`/admin/camps/${campId}/checkin/${day.id}`}><ClipboardList className="h-3.5 w-3.5 mr-1" />Check-in</a>
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" asChild title="Attendance history">
                <a href={`/admin/camps/${campId}/attendance/${day.id}`}><BarChart2 className="h-3.5 w-3.5 mr-1" />Attendance</a>
              </Button>
              {canManageCamps && (
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive h-7 w-7 p-0" onClick={() => removeDay.mutate(day.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Roster Panel ─────────────────────────────────────────────────────────────

function RosterPanel({ campId, campStartDate }: { campId: number; campStartDate: string | null }) {
  const { canManageCamps } = useAdminPermissions();
  const qc = useQueryClient();
  const { toast } = useToast();
  const getHeaders = useAuthHeaders();

  const { data: roster, isLoading } = useQuery({
    queryKey: ["camp-roster", campId],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/camps/${campId}/roster`, { headers });
      return r.json();
    },
  });

  const patchReg = useMutation({
    mutationFn: async ({ regId, patch }: { regId: number; patch: any }) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/camps/${campId}/roster/${regId}`, { method: "PATCH", headers, body: JSON.stringify(patch) });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["camp-roster", campId] }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const cancelReg = useMutation({
    mutationFn: async (regId: number) => {
      const headers = await getHeaders();
      await fetch(`${API}/camps/${campId}/roster/${regId}`, { method: "DELETE", headers });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["camp-roster", campId] }); toast({ title: "Registration cancelled" }); },
  });

  const handleExport = async () => {
    const headers = await getHeaders();
    const r = await fetch(`${API}/camps/${campId}/roster/export`, { headers });
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `camp-${campId}-roster.csv`; a.click();
  };

  if (isLoading) return <div className="px-4 pb-4"><Skeleton className="h-32" /></div>;

  return (
    <div className="border-t bg-muted/30 px-4 py-4 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Roster ({roster?.length ?? 0})
        </span>
        <Button size="sm" variant="outline" onClick={handleExport}>
          <Download className="h-3 w-3 mr-1" /> Export CSV
        </Button>
      </div>

      {roster?.length === 0 && <p className="text-xs text-muted-foreground">No registrations yet.</p>}

      <div className="space-y-2">
        {roster?.map((r: any) => (
          <div key={r.id} className="bg-background border rounded-lg p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-sm flex items-center gap-1.5">
                  <a
                    href={`/admin/players?search=${encodeURIComponent(r.player?.email ?? r.player?.firstName ?? "")}`}
                    className="hover:underline hover:text-primary transition-colors"
                    title="View in admin player records"
                  >
                    {r.player?.firstName} {r.player?.lastName}
                  </a>
                  <span className="text-xs text-muted-foreground">{r.player?.email}</span>
                </div>
                <div className="flex gap-2 mt-1 flex-wrap">
                  <Badge variant={r.status === "confirmed" ? "default" : "secondary"} className="text-xs">{r.status}</Badge>
                  <Badge variant={r.paymentStatus === "unpaid" ? "destructive" : "secondary"} className="text-xs">{r.paymentStatus}</Badge>
                  {r.balanceDue > 0 && <Badge variant="destructive" className="text-xs">Owes ${r.balanceDue.toFixed(2)}</Badge>}
                  {r.waiverSignedAt ? <Badge variant="secondary" className="text-xs text-green-600"><CheckCircle2 className="h-3 w-3 mr-1" />Waiver</Badge>
                    : <Badge variant="destructive" className="text-xs"><AlertCircle className="h-3 w-3 mr-1" />No Waiver</Badge>}
                  {r.photoConsentGiven && <Badge variant="secondary" className="text-xs">📷 Photo OK</Badge>}
                  {(() => {
                    if (r.healthPacketSubmittedAt) {
                      return <Badge variant="secondary" className="text-xs text-green-600"><CheckCircle2 className="h-3 w-3 mr-1" />Health Packet</Badge>;
                    }
                    const sevenDaysOut = campStartDate && new Date(campStartDate + "T12:00:00") < new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
                    return sevenDaysOut
                      ? <Badge variant="destructive" className="text-xs"><AlertCircle className="h-3 w-3 mr-1" />HP Overdue</Badge>
                      : <Badge variant="outline" className="text-xs text-amber-600 border-amber-400">HP Missing</Badge>;
                  })()}
                </div>
              </div>
              {canManageCamps && (
                <div className="flex gap-2 items-center">
                  <select
                    className="h-7 rounded border border-input bg-background px-2 text-xs"
                    value={r.paymentStatus}
                    onChange={e => patchReg.mutate({ regId: r.id, patch: { paymentStatus: e.target.value } })}
                  >
                    {PAYMENT_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive h-7 w-7 p-0" onClick={() => cancelReg.mutate(r.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Health Packets Panel ──────────────────────────────────────────────────────

function HealthPacketsPanel({ campId }: { campId: number }) {
  const getHeaders = useAuthHeaders();

  const { data: packets, isLoading } = useQuery({
    queryKey: ["camp-health-packets", campId],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/camps/${campId}/health-packets`, { headers });
      return r.json();
    },
  });

  const handleExportCSV = () => {
    if (!packets?.length) return;
    const header = [
      "Player Name", "Submitted At",
      "Emergency Contact", "Relationship", "Emergency Phone",
      "Medical Conditions", "Allergies", "Medications",
      "Physician Name", "Physician Phone",
      "Insurance Provider", "Insurance Policy #",
      "Authorized Pickup Persons", "Additional Notes",
      "Media Consent", "Returning Camper",
    ].join(",");
    const rows = packets.map((entry: any) => {
      const pk = entry.packet ?? {};
      return [
        entry.playerName ?? "",
        entry.submittedAt ? new Date(entry.submittedAt).toLocaleString() : "",
        pk.emergencyContactName ?? "",
        pk.emergencyContactRelationship ?? "",
        pk.emergencyContactPhone ?? "",
        pk.medicalConditions ?? "",
        pk.allergies ?? "",
        pk.medications ?? "",
        pk.physicianName ?? "",
        pk.physicianPhone ?? "",
        pk.insuranceProvider ?? "",
        pk.insurancePolicyNumber ?? "",
        pk.authorizedPickupPersons ?? "",
        pk.additionalNotes ?? "",
        String(pk.mediaConsent ?? ""),
        String(pk.returningCamper ?? ""),
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",");
    });
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `camp-${campId}-health-packets.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) return <div className="px-4 pb-4"><Skeleton className="h-12" /></div>;

  return (
    <div className="border-t bg-muted/30 px-4 py-4 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Health Packets ({packets?.length ?? 0})
        </span>
        <Button size="sm" variant="outline" onClick={handleExportCSV} disabled={!packets?.length}>
          <Download className="h-3 w-3 mr-1" /> Export CSV
        </Button>
      </div>

      {packets?.length === 0 && (
        <p className="text-xs text-muted-foreground">No health packets submitted for this camp yet.</p>
      )}

      <div className="space-y-2">
        {packets?.map((entry: any) => {
          const pk = entry.packet ?? {};
          return (
            <div key={entry.regId} className="bg-background border rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="font-medium text-sm">{entry.playerName || "Unknown Player"}</div>
                <span className="text-xs text-muted-foreground">
                  Submitted {entry.submittedAt ? format(new Date(entry.submittedAt), "MMM d, yyyy") : "—"}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {pk.emergencyContactName && (
                  <div>
                    <span className="font-medium text-foreground">Emergency: </span>
                    {pk.emergencyContactName}
                    {pk.emergencyContactRelationship ? ` (${pk.emergencyContactRelationship})` : ""}
                    {pk.emergencyContactPhone ? ` · ${pk.emergencyContactPhone}` : ""}
                  </div>
                )}
                {pk.medicalConditions && (
                  <div><span className="font-medium text-foreground">Medical: </span>{pk.medicalConditions}</div>
                )}
                {pk.allergies && (
                  <div><span className="font-medium text-foreground">Allergies: </span>{pk.allergies}</div>
                )}
                {pk.medications && (
                  <div><span className="font-medium text-foreground">Medications: </span>{pk.medications}</div>
                )}
                {pk.physicianName && (
                  <div>
                    <span className="font-medium text-foreground">Physician: </span>
                    {pk.physicianName}{pk.physicianPhone ? ` · ${pk.physicianPhone}` : ""}
                  </div>
                )}
                {pk.insuranceProvider && (
                  <div>
                    <span className="font-medium text-foreground">Insurance: </span>
                    {pk.insuranceProvider}{pk.insurancePolicyNumber ? ` #${pk.insurancePolicyNumber}` : ""}
                  </div>
                )}
                {pk.authorizedPickupPersons && (
                  <div><span className="font-medium text-foreground">Pickup: </span>{pk.authorizedPickupPersons}</div>
                )}
                {pk.additionalNotes && (
                  <div className="md:col-span-2"><span className="font-medium text-foreground">Notes: </span>{pk.additionalNotes}</div>
                )}
              </div>
              {(pk.mediaConsent || pk.returningCamper) && (
                <div className="flex gap-2 flex-wrap">
                  {pk.mediaConsent && <Badge variant="secondary" className="text-xs">📷 Media Consent</Badge>}
                  {pk.returningCamper && <Badge variant="secondary" className="text-xs">Returning Camper</Badge>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Waitlist Panel ────────────────────────────────────────────────────────────

function WaitlistPanel({ campId }: { campId: number }) {
  const { canManageCamps } = useAdminPermissions();
  const qc = useQueryClient();
  const { toast } = useToast();
  const getHeaders = useAuthHeaders();

  const { data: waitlist, isLoading } = useQuery({
    queryKey: ["camp-waitlist", campId],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/camps/${campId}/waitlist`, { headers });
      return r.ok ? r.json() : [];
    },
  });

  const promote = useMutation({
    mutationFn: async (regId: number) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/camps/${campId}/waitlist/${regId}/promote`, { method: "POST", headers });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["camp-waitlist", campId] });
      qc.invalidateQueries({ queryKey: ["camp-roster", campId] });
      qc.invalidateQueries({ queryKey: ["admin-camps"] });
      toast({ title: "Player promoted to confirmed" });
    },
    onError: (e: any) => toast({ title: "Promote failed", description: e.message, variant: "destructive" }),
  });

  const cancelWaitlist = useMutation({
    mutationFn: async (regId: number) => {
      const headers = await getHeaders();
      await fetch(`${API}/camps/${campId}/roster/${regId}`, { method: "DELETE", headers });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["camp-waitlist", campId] });
      toast({ title: "Removed from waitlist" });
    },
  });

  if (isLoading) return <div className="px-4 pb-4"><div className="h-12 bg-muted rounded animate-pulse" /></div>;

  return (
    <div className="border-t bg-muted/30 px-4 py-4 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Waitlist ({waitlist?.length ?? 0})
        </span>
      </div>

      {(!waitlist || waitlist.length === 0) && (
        <p className="text-xs text-muted-foreground">No players on the waitlist.</p>
      )}

      <div className="space-y-2">
        {waitlist?.map((r: any) => (
          <div key={r.id} className="bg-background border rounded-lg p-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex-shrink-0 h-7 w-7 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 flex items-center justify-center text-xs font-bold">
                #{r.waitlistPosition ?? "?"}
              </span>
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">
                  {r.player?.firstName} {r.player?.lastName}
                  <span className="text-xs text-muted-foreground ml-1.5">{r.player?.email}</span>
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Joined {r.createdAt ? format(new Date(r.createdAt), "MMM d, yyyy") : "—"}
                </div>
              </div>
            </div>
            {canManageCamps && (
              <div className="flex gap-2 flex-shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1"
                  onClick={() => promote.mutate(r.id)}
                  disabled={promote.isPending}
                >
                  <ArrowUpCircle className="h-3.5 w-3.5" /> Promote
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive h-7 w-7 p-0"
                  onClick={() => cancelWaitlist.mutate(r.id)}
                  disabled={cancelWaitlist.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Camps Tab ─────────────────────────────────────────────────────────────────

function CampsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const getHeaders = useAuthHeaders();
  const { canManageCamps, isSuperAdmin } = useAdminPermissions();
  const [, navigate] = useLocation();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [expandedSection, setExpandedSection] = useState<{ campId: number; section: "days" | "coaches" | "roster" | "health-packets" | "waitlist" | "revenue-split" } | null>(null);
  const [campToDelete, setCampToDelete] = useState<number | null>(null);
  const [form, setForm] = useState({
    name: "", ageGroup: ["u8"] as string[], gender: "", courtId: "1", status: "upcoming",
    price: "0", maxParticipants: "20", registrationOpen: false,
    startDate: "", endDate: "", registrationDeadline: "",
    startsAt: "", endsAt: "", activeOverride: "auto",
    description: "", imageUrl: "", coachName: "", pricingRuleId: "",
  });

  const { data: camps, isLoading } = useQuery({
    queryKey: ["admin-camps"],
    queryFn: async () => {
      const r = await fetch(`${API}/camps`);
      return r.json();
    },
  });

  const { data: courts } = useQuery({
    queryKey: ["courts"],
    queryFn: async () => {
      const r = await fetch(`${API}/courts`);
      return r.json();
    },
  });

  const { data: pricingRules } = useQuery({
    queryKey: ["pricing-rules-camp"],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/pricing-rules?category=camp&isLatest=true`, { headers });
      return r.ok ? r.json() : [];
    },
  });

  const upsert = useMutation({
    mutationFn: async (data: any) => {
      const headers = await getHeaders();
      const url = editId ? `${API}/camps/${editId}` : `${API}/camps`;
      const r = await fetch(url, { method: editId ? "PATCH" : "POST", headers, body: JSON.stringify(data) });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-camps"] }); toast({ title: editId ? "Camp updated" : "Camp created" }); setShowForm(false); setEditId(null); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => {
      const headers = await getHeaders();
      await fetch(`${API}/camps/${id}`, { method: "DELETE", headers });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-camps"] }); toast({ title: "Camp deleted" }); },
  });

  const overrideCamp = useMutation({
    mutationFn: async ({ id, activeOverride }: { id: number; activeOverride: string | null }) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/camps/${id}/override`, { method: "PATCH", headers, body: JSON.stringify({ activeOverride }) });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-camps"] }); toast({ title: "Active window override updated" }); },
    onError: (e: any) => toast({ title: "Override failed", description: e.message, variant: "destructive" }),
  });

  function openEdit(c: any) {
    setForm({
      name: c.name, ageGroup: Array.isArray(c.ageGroup) ? c.ageGroup : c.ageGroup ? [c.ageGroup] : ["u8"], gender: c.gender ?? "", courtId: String(c.courtId), status: c.status,
      price: String(c.price ?? 0), maxParticipants: String(c.maxParticipants), registrationOpen: c.registrationOpen,
      startDate: c.startDate ?? "", endDate: c.endDate ?? "",
      registrationDeadline: c.registrationDeadline ? toEasternLocalString(c.registrationDeadline) : "",
      startsAt: c.startsAt ? c.startsAt.replace("Z", "").substring(0, 16) : "",
      endsAt: c.endsAt ? c.endsAt.replace("Z", "").substring(0, 16) : "",
      activeOverride: c.activeOverride ?? "auto",
      description: c.description ?? "", imageUrl: c.imageUrl ?? "", coachName: c.coachName ?? "",
      pricingRuleId: String(c.pricingRuleId ?? ""),
    });
    setEditId(c.id); setShowForm(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    upsert.mutate({
      name: form.name, ageGroup: form.ageGroup, gender: form.gender || null, courtId: Number(form.courtId), status: form.status,
      price: form.price, maxParticipants: Number(form.maxParticipants), registrationOpen: form.registrationOpen,
      startDate: form.startDate || null, endDate: form.endDate || null,
      registrationDeadline: form.registrationDeadline ? toEasternISOString(form.registrationDeadline) : null,
      startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
      endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      activeOverride: form.activeOverride === "auto" ? null : form.activeOverride || null,
      description: form.description || null, imageUrl: form.imageUrl || null, coachName: form.coachName || null,
      pricingRuleId: form.pricingRuleId ? Number(form.pricingRuleId) : null,
    });
  }

  function toggleSection(campId: number, section: "days" | "coaches" | "roster" | "health-packets" | "waitlist" | "revenue-split") {
    setExpandedSection(prev => (prev?.campId === campId && prev.section === section) ? null : { campId, section });
  }

  return (
    <div className="space-y-6">
      {canManageCamps && (
        <div className="flex justify-end">
          <Button onClick={() => navigate("/admin/camps/new")}>
            <Plus className="h-4 w-4 mr-2" /> New Camp
          </Button>
        </div>
      )}

      {showForm && (
        <Card>
          <CardHeader><CardTitle>Edit Camp</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <Label>Camp Name</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required placeholder="Summer Futsal Camp 2026" />
              </div>
              <div className="col-span-2">
                <Label>Age Group <span className="text-muted-foreground font-normal text-xs">(select all that apply)</span></Label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {AGE_GROUPS.map(a => (
                    <label key={a.value} className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox"
                        checked={((form.ageGroup as string[]) || []).includes(a.value)}
                        onChange={e => setForm(f => ({ ...f, ageGroup: e.target.checked ? [...((f.ageGroup as string[]) || []), a.value] : ((f.ageGroup as string[]) || []).filter(v => v !== a.value) }))}
                        className="h-4 w-4 rounded border-input accent-primary" />
                      <span className="text-sm">{a.label}</span>
                    </label>
                  ))}
                </div>
                {((form.ageGroup as string[]) || []).length === 0 && <p className="text-xs text-destructive mt-1">Select at least one age group</p>}
              </div>
              <div>
                <Label>Gender</Label>
                <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.gender} onChange={e => setForm(f => ({ ...f, gender: e.target.value }))}>
                  <option value="">Any</option>
                  {GENDER_OPTIONS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
                </select>
              </div>
              <div>
                <Label>Court</Label>
                <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.courtId} onChange={e => setForm(f => ({ ...f, courtId: e.target.value }))}>
                  {courts?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <Label>Status</Label>
                <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                  {["upcoming","active","completed","cancelled"].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <Label>Max Participants</Label>
                <Input type="number" value={form.maxParticipants} onChange={e => setForm(f => ({ ...f, maxParticipants: e.target.value }))} />
              </div>
              <div>
                <Label>Start Date</Label>
                <Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
              </div>
              <div>
                <Label>End Date</Label>
                <Input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} />
              </div>
              <div>
                <Label>Registration Deadline</Label>
                <Input type="datetime-local" value={form.registrationDeadline} onChange={e => setForm(f => ({ ...f, registrationDeadline: e.target.value }))} />
              </div>
              <div>
                <Label>Active Window Start</Label>
                <Input type="datetime-local" value={form.startsAt} onChange={e => setForm(f => ({ ...f, startsAt: e.target.value }))} />
              </div>
              <div>
                <Label>Active Window End</Label>
                <Input type="datetime-local" value={form.endsAt} onChange={e => setForm(f => ({ ...f, endsAt: e.target.value }))} />
              </div>
              <div>
                <Label>Active Override</Label>
                <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.activeOverride} onChange={e => setForm(f => ({ ...f, activeOverride: e.target.value }))}>
                  <option value="auto">Auto (use time window)</option>
                  <option value="active">Force Active</option>
                  <option value="closed">Force Closed</option>
                </select>
              </div>
              <div>
                <Label>Default Price ($)</Label>
                <Input type="number" step="0.01" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
              </div>
              <div>
                <Label>Pricing Rule (optional)</Label>
                <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.pricingRuleId} onChange={e => setForm(f => ({ ...f, pricingRuleId: e.target.value }))}>
                  <option value="">— None (use default price) —</option>
                  {(pricingRules ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div>
                <Label>Lead Coach Name</Label>
                <Input value={form.coachName} onChange={e => setForm(f => ({ ...f, coachName: e.target.value }))} />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <input type="checkbox" id="regOpen" checked={form.registrationOpen} onChange={e => setForm(f => ({ ...f, registrationOpen: e.target.checked }))} />
                <Label htmlFor="regOpen">Registration Open</Label>
              </div>
              <div className="md:col-span-2">
                <Label>Description</Label>
                <textarea className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="md:col-span-2">
                <Label>Image URL (optional)</Label>
                <Input value={form.imageUrl} onChange={e => setForm(f => ({ ...f, imageUrl: e.target.value }))} placeholder="https://..." />
              </div>
              <div className="md:col-span-2 flex gap-2 justify-end">
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
                <Button type="submit" disabled={upsert.isPending}>{upsert.isPending ? "Saving..." : "Save Camp"}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-24" />)}</div>
      ) : camps?.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground border border-dashed rounded-xl">No camps yet.</div>
      ) : (
        <div className="space-y-3">
          {camps?.map((camp: any) => (
            <Card key={camp.id} className="overflow-hidden">
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <Calendar className="h-5 w-5 text-primary flex-shrink-0" />
                  <div>
                    <div className="font-semibold">{camp.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {camp.startDate ? format(new Date(camp.startDate + "T12:00:00"), "MMM d") : "?"} –{" "}
                      {camp.endDate ? format(new Date(camp.endDate + "T12:00:00"), "MMM d, yyyy") : "?"}
                      {camp.coachName && ` · ${camp.coachName}`}
                    </div>
                    <div className="flex gap-2 mt-1 flex-wrap">
                      <Badge variant="secondary" className="text-xs uppercase">{(Array.isArray(camp.ageGroup) ? camp.ageGroup : [camp.ageGroup]).map((ag: string) => AGE_GROUPS.find(a => a.value === ag)?.label ?? ag).join(" · ")}</Badge>
                      <Badge variant={camp.registrationOpen ? "default" : "outline"} className="text-xs">{camp.registrationOpen ? "Open" : "Closed"}</Badge>
                      <Badge variant="outline" className="text-xs">{camp.status}</Badge>
                      <Badge variant="secondary" className="text-xs"><Users className="h-3 w-3 mr-1" />{camp.participantsRegistered}/{camp.maxParticipants}</Badge>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-wrap justify-end">
                  <Button size="sm" variant={expandedSection?.campId === camp.id && expandedSection?.section === "days" ? "default" : "outline"} className="text-xs h-8" onClick={() => toggleSection(camp.id, "days")}>
                    <Calendar className="h-3.5 w-3.5 mr-1" /> Days
                    {expandedSection?.campId === camp.id && expandedSection?.section === "days" ? <ChevronUp className="h-3 w-3 ml-1" /> : <ChevronDown className="h-3 w-3 ml-1" />}
                  </Button>
                  <Button size="sm" variant={expandedSection?.campId === camp.id && expandedSection?.section === "coaches" ? "default" : "outline"} className="text-xs h-8" onClick={() => toggleSection(camp.id, "coaches")}>
                    <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Coaches
                    {expandedSection?.campId === camp.id && expandedSection?.section === "coaches" ? <ChevronUp className="h-3 w-3 ml-1" /> : <ChevronDown className="h-3 w-3 ml-1" />}
                  </Button>
                  <Button size="sm" variant={expandedSection?.campId === camp.id && expandedSection?.section === "roster" ? "default" : "outline"} className="text-xs h-8" onClick={() => toggleSection(camp.id, "roster")}>
                    <Users className="h-3.5 w-3.5 mr-1" /> Roster
                    {expandedSection?.campId === camp.id && expandedSection?.section === "roster" ? <ChevronUp className="h-3 w-3 ml-1" /> : <ChevronDown className="h-3 w-3 ml-1" />}
                  </Button>
                  <Button size="sm" variant={expandedSection?.campId === camp.id && expandedSection?.section === "health-packets" ? "default" : "outline"} className="text-xs h-8" onClick={() => toggleSection(camp.id, "health-packets")}>
                    <HeartPulse className="h-3.5 w-3.5 mr-1" /> Health Packets
                    {expandedSection?.campId === camp.id && expandedSection?.section === "health-packets" ? <ChevronUp className="h-3 w-3 ml-1" /> : <ChevronDown className="h-3 w-3 ml-1" />}
                  </Button>
                  <Button size="sm" variant={expandedSection?.campId === camp.id && expandedSection?.section === "waitlist" ? "default" : "outline"} className="text-xs h-8" onClick={() => toggleSection(camp.id, "waitlist")}>
                    <Clock className="h-3.5 w-3.5 mr-1" /> Waitlist
                    {expandedSection?.campId === camp.id && expandedSection?.section === "waitlist" ? <ChevronUp className="h-3 w-3 ml-1" /> : <ChevronDown className="h-3 w-3 ml-1" />}
                  </Button>
                  <Button size="sm" variant={expandedSection?.campId === camp.id && expandedSection?.section === "revenue-split" ? "default" : "outline"} className="text-xs h-8" onClick={() => toggleSection(camp.id, "revenue-split")}>
                    <DollarSign className="h-3.5 w-3.5 mr-1" /> Revenue Split
                    {expandedSection?.campId === camp.id && expandedSection?.section === "revenue-split" ? <ChevronUp className="h-3 w-3 ml-1" /> : <ChevronDown className="h-3 w-3 ml-1" />}
                  </Button>
                  {canManageCamps && (
                    <>
                      <VisibilityToggleGroup
                        eventType="camp"
                        eventId={camp.id}
                        isPublished={camp.isPublished ?? true}
                        isFeatured={camp.isFeatured ?? false}
                        showOnMobile={camp.showOnMobile ?? true}
                        canManage={canManageCamps}
                        queryKey={["admin-camps"]}
                      />
                      <Button
                        variant={camp.activeOverride === "active" ? "default" : camp.activeOverride === "closed" ? "destructive" : "outline"}
                        size="sm"
                        className="h-8 text-xs"
                        title={`Active override: ${camp.activeOverride ?? "auto"}`}
                        onClick={() => {
                          const next = camp.activeOverride === "active" ? null : camp.activeOverride === "closed" ? "active" : "closed";
                          overrideCamp.mutate({ id: camp.id, activeOverride: next });
                        }}
                      >
                        {camp.activeOverride === "active" ? "Force On" : camp.activeOverride === "closed" ? "Force Off" : "Auto"}
                      </Button>
                      <Button variant="outline" size="sm" className="h-8" onClick={() => openEdit(camp)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button variant="outline" size="sm" className="h-8" onClick={() => setCampToDelete(camp.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </>
                  )}
                </div>
              </div>
              {expandedSection?.campId === camp.id && expandedSection?.section === "days" && <CampDaysPanel campId={camp.id} />}
              {expandedSection?.campId === camp.id && expandedSection?.section === "coaches" && <CoachesPanel campId={camp.id} />}
              {expandedSection?.campId === camp.id && expandedSection?.section === "roster" && <RosterPanel campId={camp.id} campStartDate={camp.startDate ?? null} />}
              {expandedSection?.campId === camp.id && expandedSection?.section === "health-packets" && <HealthPacketsPanel campId={camp.id} />}
              {expandedSection?.campId === camp.id && expandedSection?.section === "waitlist" && <WaitlistPanel campId={camp.id} />}
              {expandedSection?.campId === camp.id && expandedSection?.section === "revenue-split" && (
                <EventSplitPanel
                  offeringType="camp"
                  offeringId={camp.id}
                  venueId={courts?.find((c: any) => c.id === camp.courtId)?.venueId ?? null}
                  eventName={camp.name}
                  isSuperAdmin={isSuperAdmin}
                />
              )}
            </Card>
          ))}
        </div>
      )}
      <AlertDialog open={campToDelete !== null} onOpenChange={(open) => { if (!open) setCampToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete camp?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete the camp and all its registrations. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (campToDelete !== null) { remove.mutate(campToDelete); setCampToDelete(null); } }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminCamps() {
  const { data: profile, isLoading } = useGetMyProfile();

  if (isLoading) return <Layout><div className="p-12"><Skeleton className="h-96" /></div></Layout>;
  if (profile?.role !== "admin" && profile?.role !== "staff" && profile?.adminLevel !== "super" && profile?.adminLevel !== "admin") return <Redirect to="/dashboard" />;

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12">
        <div className="mb-8">
          <a href="/admin" className="text-sm text-muted-foreground hover:text-foreground">Admin</a>
          <span className="mx-2 text-muted-foreground">/</span>
          <span className="text-sm font-medium">Camps</span>
        </div>
        <h1 className="text-4xl font-bold font-sans uppercase tracking-tight mb-8 text-primary">Camp Management</h1>
        <CampsTab />
      </div>
    </Layout>
  );
}
