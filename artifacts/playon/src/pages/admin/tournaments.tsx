import React, { useState } from "react";
import { Redirect, Link } from "wouter";
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
import { useGetMyProfile } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { useToast } from "@/hooks/use-toast";
import { useAdminPermissions } from "@/hooks/use-admin-permissions";
import { format } from "date-fns";
import { toEasternISOString, toEasternLocalString } from "@/lib/timezone";
import {
  Plus, Pencil, Trash2, ChevronDown, ChevronUp, Trophy, Calendar,
  Users, Play, RefreshCw, CheckCircle2, AlertCircle, DollarSign,
  Layers, GitBranch, List, ClipboardList, ShieldCheck, BarChart2, UserCheck, Clock,
  Globe, Star, Smartphone,
} from "lucide-react";
import { EventSplitPanel } from "@/components/event-split-panel";

import { AGE_GROUPS } from "@workspace/brand";

const API = "/api";
const GENDER_OPTIONS = [
  { value: "boy", label: "Boys" },
  { value: "girl", label: "Girls" },
  { value: "men", label: "Men" },
  { value: "women", label: "Women" },
  { value: "coed", label: "Coed" },
];
const FORMATS = [
  { value: "5v5", label: "5v5 (Full Court)" },
  { value: "4v4", label: "4v4 (Small Court)" },
  { value: "3v3", label: "3v3 (Small Court)" },
];
const BRACKET_FORMATS = [
  { value: "single_elimination", label: "Single Elimination" },
  { value: "double_elimination", label: "Double Elimination" },
  { value: "group_knockout", label: "Group Stage → Knockout" },
];
const STATUSES = [
  { value: "upcoming", label: "Upcoming" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
];
const PAYMENT_STATUSES = [
  { value: "unpaid", label: "Unpaid" },
  { value: "partial", label: "Partial" },
  { value: "paid", label: "Paid" },
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
      const r = await fetch(`${API}/programs/${eventType}s/${eventId}/visibility`, {
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

const paymentBadge = (status: string) => {
  if (status === "paid") return <Badge className="bg-green-600 text-white">Paid</Badge>;
  if (status === "partial") return <Badge className="bg-amber-500 text-white">Partial</Badge>;
  if (status === "waived") return <Badge className="bg-blue-500 text-white">Waived</Badge>;
  return <Badge variant="destructive">Unpaid</Badge>;
};

// ─── Tournament Waitlist Panel ────────────────────────────────────────────────

function TournamentWaitlistPanel({ tournamentId }: { tournamentId: number }) {
  const { canManageTournaments } = useAdminPermissions();
  const qc = useQueryClient();
  const { toast } = useToast();
  const getHeaders = useAuthHeaders();

  const { data: waitlist, isLoading } = useQuery({
    queryKey: ["tournament-waitlist", tournamentId],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/tournaments/${tournamentId}/waitlist`, { headers });
      return r.ok ? r.json() : [];
    },
  });

  const promote = useMutation({
    mutationFn: async (regId: number) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/tournaments/${tournamentId}/waitlist/${regId}/promote`, { method: "POST", headers });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tournament-waitlist", tournamentId] });
      qc.invalidateQueries({ queryKey: ["tournament-registrations", tournamentId] });
      toast({ title: "Team promoted to registered" });
    },
    onError: (e: any) => toast({ title: "Promote failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="space-y-2"><div className="h-12 bg-muted rounded animate-pulse" /></div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Waitlisted Teams ({waitlist?.length ?? 0})
        </span>
      </div>
      {(!waitlist || waitlist.length === 0) && (
        <p className="text-sm text-muted-foreground">No teams on the waitlist.</p>
      )}
      <div className="space-y-2">
        {waitlist?.map((r: any) => (
          <div key={r.id} className="bg-background border rounded-lg p-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex-shrink-0 h-8 w-8 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 flex items-center justify-center text-xs font-bold">
                #{r.waitlistPosition ?? "?"}
              </span>
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{r.team?.name ?? `Team #${r.teamId}`}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Joined {r.createdAt ? format(new Date(r.createdAt), "MMM d, yyyy") : "—"}
                </div>
              </div>
            </div>
            {canManageTournaments && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1 flex-shrink-0"
                onClick={() => promote.mutate(r.id)}
                disabled={promote.isPending}
              >
                <UserCheck className="h-3.5 w-3.5" /> Promote
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Registrations Panel ──────────────────────────────────────────────────────

function RegistrationsPanel({ tournamentId }: { tournamentId: number }) {
  const getHeaders = useAuthHeaders();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { canManageTournaments } = useAdminPermissions();
  const [regToDelete, setRegToDelete] = useState<number | null>(null);
  const [editReg, setEditReg] = useState<{ id: number; teamId: number; teamName: string; amountPaid: string; notes: string } | null>(null);

  const { data: regs, isLoading } = useQuery({
    queryKey: ["tournament-registrations", tournamentId],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/tournaments/${tournamentId}/registrations`, { headers });
      return r.json();
    },
  });

  const { data: rosterStatus } = useQuery<Array<{
    teamId: number; teamName: string; playerCount: number; coachCount: number; isComplete: boolean;
  }>>({
    queryKey: ["tournament-roster-status", tournamentId],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/admin/tournaments/${tournamentId}/roster-status`, { headers });
      return r.ok ? r.json() : [];
    },
    enabled: !!regs?.length,
  });

  const updateReg = useMutation({
    mutationFn: async ({ regId, updates }: { regId: number; updates: any }) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/tournaments/${tournamentId}/registrations/${regId}`, {
        method: "PATCH", headers, body: JSON.stringify(updates),
      });
      if (!r.ok) throw new Error("Failed to update");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tournament-registrations", tournamentId] });
      toast({ title: "Registration updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteReg = useMutation({
    mutationFn: async (regId: number) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/tournaments/${tournamentId}/registrations/${regId}`, { method: "DELETE", headers });
      if (!r.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tournament-registrations", tournamentId] });
      qc.invalidateQueries({ queryKey: ["tournaments"] });
      toast({ title: "Registration removed" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const patchTeamName = useMutation({
    mutationFn: async ({ teamId, name }: { teamId: number; name: string }) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/teams/${teamId}`, {
        method: "PATCH", headers, body: JSON.stringify({ name }),
      });
      if (!r.ok) throw new Error("Failed to update team name");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tournament-registrations", tournamentId] });
    },
  });

  async function saveRegEdit() {
    if (!editReg) return;
    try {
      await updateReg.mutateAsync({
        regId: editReg.id,
        updates: {
          amountPaid: editReg.amountPaid,
          notes: editReg.notes,
        },
      });
      if (editReg.teamName && editReg.teamId) {
        await patchTeamName.mutateAsync({ teamId: editReg.teamId, name: editReg.teamName });
      }
      toast({ title: "Registration updated" });
      setEditReg(null);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  if (isLoading) return <Skeleton className="h-40" />;
  if (!regs?.length) return <p className="text-muted-foreground">No teams registered yet.</p>;

  return (
    <div className="space-y-3">
      {regs.map((reg: any) => (
        <div key={reg.id} className="rounded-lg border p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-semibold">{reg.team?.name || `Team #${reg.teamId}`}</div>
            <div className="text-sm text-muted-foreground">
              Total: ${reg.totalAmount} · Paid: ${reg.amountPaid} · Deposit: ${reg.depositAmount}
            </div>
            {reg.balanceDueDate && (
              <div className="text-xs text-muted-foreground">Balance due: {format(new Date(reg.balanceDueDate), "MMM d, yyyy")}</div>
            )}
            {(() => {
              const rs = rosterStatus?.find((s) => s.teamId === reg.teamId);
              const balance = parseFloat(reg.totalAmount ?? "0") - parseFloat(reg.amountPaid ?? "0");
              const isBalanceOverdue = reg.balanceDueDate && new Date(reg.balanceDueDate) < new Date();
              const missingItems: string[] = [];
              if (balance > 0) missingItems.push(`$${balance.toFixed(2)} balance${isBalanceOverdue ? " (OVERDUE)" : " due"}`);
              if (!reg.waiverSigned) missingItems.push("Waiver unsigned");
              if (!reg.selfCheckinConfirmed) missingItems.push("Self check-in pending");
              if (rs) {
                const need = Math.max(0, 5 - rs.playerCount);
                if (need > 0) missingItems.push(`${need} more player${need > 1 ? "s" : ""} needed`);
                if (rs.coachCount === 0) missingItems.push("No coach assigned");
              }
              return (
                <div className="mt-1.5 space-y-1">
                  {rs && (
                    <div className="flex items-center gap-1.5">
                      <UserCheck className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">{rs.playerCount} player{rs.playerCount !== 1 ? "s" : ""}{rs.coachCount > 0 ? ` · ${rs.coachCount} coach${rs.coachCount !== 1 ? "es" : ""}` : ""}</span>
                      {rs.isComplete
                        ? <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600 border border-green-500/30 font-medium">Roster Ready</span>
                        : <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/30 font-medium">Incomplete &lt;5</span>
                      }
                    </div>
                  )}
                  {missingItems.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {missingItems.map((item) => (
                        <span key={item} className={`text-[11px] px-1.5 py-0.5 rounded-full border font-medium ${
                          item.includes("OVERDUE") ? "bg-red-500/10 text-red-600 border-red-500/30" :
                          "bg-orange-500/10 text-orange-600 border-orange-500/30"
                        }`}>
                          ⚠ {item}
                        </span>
                      ))}
                    </div>
                  )}
                  {missingItems.length === 0 && rs?.isComplete && (
                    <span className="text-[11px] text-green-600 font-medium">✓ All requirements met</span>
                  )}
                </div>
              );
            })()}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {paymentBadge(reg.paymentStatus)}
            <Badge variant="outline">{reg.selfCheckinConfirmed ? "Self-check-in ✓" : "Not confirmed"}</Badge>
            {canManageTournaments && (
              <Select
                value={reg.paymentStatus}
                onValueChange={(v) => updateReg.mutate({ regId: reg.id, updates: { paymentStatus: v } })}
              >
                <SelectTrigger className="w-32 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {canManageTournaments && (
              <Button size="sm" variant="ghost"
                onClick={() => updateReg.mutate({ regId: reg.id, updates: { depositPaid: true } })}
              >
                Mark Deposit Paid
              </Button>
            )}
            {canManageTournaments && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditReg({
                  id: reg.id,
                  teamId: reg.teamId,
                  teamName: reg.team?.name ?? "",
                  amountPaid: reg.amountPaid ?? "0",
                  notes: reg.notes ?? "",
                })}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {canManageTournaments && (
              <Button size="sm" variant="destructive"
                onClick={() => setRegToDelete(reg.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      ))}
      <AlertDialog open={regToDelete !== null} onOpenChange={(open) => { if (!open) setRegToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove registration?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove the team's registration from the tournament. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (regToDelete !== null) { deleteReg.mutate(regToDelete); setRegToDelete(null); } }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={editReg !== null} onOpenChange={(open) => { if (!open) setEditReg(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Registration</DialogTitle>
          </DialogHeader>
          {editReg && (
            <div className="space-y-3 py-2">
              <div>
                <Label className="text-sm font-medium mb-1 block">Team Name</Label>
                <Input
                  value={editReg.teamName}
                  onChange={(e) => setEditReg((r) => r ? { ...r, teamName: e.target.value } : r)}
                  placeholder="Team name"
                />
              </div>
              <div>
                <Label className="text-sm font-medium mb-1 block">Amount Paid ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={editReg.amountPaid}
                  onChange={(e) => setEditReg((r) => r ? { ...r, amountPaid: e.target.value } : r)}
                  placeholder="0.00"
                />
              </div>
              <div>
                <Label className="text-sm font-medium mb-1 block">Notes</Label>
                <Input
                  value={editReg.notes}
                  onChange={(e) => setEditReg((r) => r ? { ...r, notes: e.target.value } : r)}
                  placeholder="Admin notes"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditReg(null)}>Cancel</Button>
            <Button onClick={saveRegEdit} disabled={updateReg.isPending}>
              {updateReg.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Seeds Panel ──────────────────────────────────────────────────────────────

function SeedsPanel({ tournamentId, divisionId }: { tournamentId: number; divisionId?: number | null }) {
  const getHeaders = useAuthHeaders();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editMode, setEditMode] = useState(false);
  const [draftSeeds, setDraftSeeds] = useState<{ teamId: number; seed: number; groupName?: string; teamName?: string }[]>([]);

  const seedsUrl = divisionId
    ? `${API}/tournaments/${tournamentId}/seeds?divisionId=${divisionId}`
    : `${API}/tournaments/${tournamentId}/seeds`;

  const { data: seeds, isLoading: seedsLoading } = useQuery({
    queryKey: ["tournament-seeds", tournamentId, divisionId ?? null],
    queryFn: async () => {
      const r = await fetch(seedsUrl);
      return r.json();
    },
  });

  const { data: regs, isLoading: regsLoading } = useQuery({
    queryKey: ["tournament-registrations", tournamentId],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/tournaments/${tournamentId}/registrations`, { headers });
      return r.json();
    },
  });

  const saveSeeds = useMutation({
    mutationFn: async (seeds: any[]) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/tournaments/${tournamentId}/seeds`, {
        method: "POST", headers, body: JSON.stringify({ seeds, ...(divisionId ? { divisionId } : {}) }),
      });
      if (!r.ok) throw new Error("Failed to save seeds");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tournament-seeds", tournamentId, divisionId ?? null] });
      setEditMode(false);
      toast({ title: "Seeds saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const generateBracket = useMutation({
    mutationFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/tournaments/${tournamentId}/brackets/generate`, {
        method: "POST", headers,
        body: JSON.stringify(divisionId ? { divisionId } : {}),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Failed"); }
      return r.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["tournament-fixtures", tournamentId, divisionId ?? null] });
      toast({ title: `Bracket generated — ${data.fixtures?.length} fixtures created` });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const enterEditMode = () => {
    if (seeds?.length > 0) {
      setDraftSeeds(seeds.map((s: any) => ({ teamId: s.teamId, seed: s.seed, groupName: s.groupName, teamName: s.team?.name })));
    } else if (regs?.length > 0) {
      setDraftSeeds(regs.map((r: any, i: number) => ({ teamId: r.teamId, seed: i + 1, teamName: r.team?.name })));
    }
    setEditMode(true);
  };

  if (seedsLoading || regsLoading) return <Skeleton className="h-40" />;

  return (
    <div className="space-y-4">
      {!editMode ? (
        <>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={enterEditMode} variant="outline">
              <Pencil className="h-4 w-4 mr-2" /> {seeds?.length > 0 ? "Edit Seeds" : "Set Seeds"}
            </Button>
            <Button size="sm" onClick={() => generateBracket.mutate()} disabled={generateBracket.isPending || !seeds?.length}>
              <GitBranch className="h-4 w-4 mr-2" /> {generateBracket.isPending ? "Generating…" : "Generate Bracket"}
            </Button>
          </div>
          {seeds?.length > 0 ? (
            <div className="space-y-2">
              {seeds.map((s: any) => (
                <div key={s.id} className="flex items-center gap-3 rounded-md border px-4 py-2">
                  <span className="text-2xl font-bold text-primary w-8">#{s.seed}</span>
                  <span className="font-medium">{s.team?.name || `Team #${s.teamId}`}</span>
                  {s.groupName && <Badge variant="secondary">Group {s.groupName}</Badge>}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">No seeds set. Click "Set Seeds" to seed teams from registrations.</p>
          )}
        </>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Drag to reorder — the seed number determines bracket slot.</p>
          {draftSeeds.map((s, i) => (
            <div key={s.teamId} className="flex items-center gap-3 rounded-md border px-4 py-2">
              <span className="text-xl font-bold text-primary w-8">#{s.seed}</span>
              <span className="flex-1 font-medium">{s.teamName || `Team #${s.teamId}`}</span>
              <Input
                type="text"
                placeholder="Group (A, B, …)"
                className="w-24 h-8 text-xs"
                value={s.groupName || ""}
                onChange={(e) => setDraftSeeds((prev) => prev.map((d, j) => j === i ? { ...d, groupName: e.target.value } : d))}
              />
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" className="h-7 w-7" disabled={i === 0}
                  onClick={() => setDraftSeeds((prev) => {
                    const next = [...prev];
                    [next[i - 1], next[i]] = [{ ...next[i], seed: next[i - 1].seed }, { ...next[i - 1], seed: next[i].seed }];
                    return next;
                  })}>
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" disabled={i === draftSeeds.length - 1}
                  onClick={() => setDraftSeeds((prev) => {
                    const next = [...prev];
                    [next[i], next[i + 1]] = [{ ...next[i + 1], seed: next[i].seed }, { ...next[i], seed: next[i + 1].seed }];
                    return next;
                  })}>
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
          <div className="flex gap-2 pt-2">
            <Button onClick={() => saveSeeds.mutate(draftSeeds)} disabled={saveSeeds.isPending}>
              {saveSeeds.isPending ? "Saving…" : "Save Seeds"}
            </Button>
            <Button variant="outline" onClick={() => setEditMode(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Fixtures Panel ───────────────────────────────────────────────────────────

function FixturesPanel({ tournamentId, divisionId }: { tournamentId: number; divisionId?: number | null }) {
  const getHeaders = useAuthHeaders();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editingFixture, setEditingFixture] = useState<number | null>(null);
  const [resultInputs, setResultInputs] = useState<Record<number, { home: string; away: string }>>({});
  const [forfeitPending, setForfeitPending] = useState<{ fixtureId: number; forfeitingTeamId: number; teamName: string } | null>(null);

  const fixturesUrl = divisionId
    ? `${API}/tournaments/${tournamentId}/fixtures?divisionId=${divisionId}`
    : `${API}/tournaments/${tournamentId}/fixtures`;

  const { data: fixtures, isLoading } = useQuery({
    queryKey: ["tournament-fixtures", tournamentId, divisionId ?? null],
    queryFn: async () => {
      const r = await fetch(fixturesUrl);
      return r.json();
    },
  });

  const submitResult = useMutation({
    mutationFn: async ({ fixtureId, homeScore, awayScore }: any) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/tournaments/${tournamentId}/fixtures/${fixtureId}/result`, {
        method: "POST", headers, body: JSON.stringify({ homeScore: Number(homeScore), awayScore: Number(awayScore) }),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Failed"); }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tournament-fixtures", tournamentId, divisionId ?? null] });
      toast({ title: "Result recorded — bracket advanced" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateFixture = useMutation({
    mutationFn: async ({ fixtureId, updates }: any) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/tournaments/${tournamentId}/fixtures/${fixtureId}`, {
        method: "PATCH", headers, body: JSON.stringify(updates),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tournament-fixtures", tournamentId, divisionId ?? null] });
      setEditingFixture(null);
      toast({ title: "Fixture updated" });
    },
  });

  const forfeit = useMutation({
    mutationFn: async ({ fixtureId, forfeitingTeamId }: any) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/tournaments/${tournamentId}/fixtures/${fixtureId}/forfeit`, {
        method: "POST", headers, body: JSON.stringify({ forfeitingTeamId }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tournament-fixtures", tournamentId, divisionId ?? null] });
      toast({ title: "Forfeit recorded" });
    },
  });

  if (isLoading) return <Skeleton className="h-60" />;
  if (!fixtures?.length) return <p className="text-muted-foreground">No fixtures yet. Generate bracket first.</p>;

  const phases = ["group", "winners", "losers", "playoff", "consolation", "grand_final"];
  const byPhase: Record<string, typeof fixtures> = {};
  for (const p of phases) {
    byPhase[p] = fixtures.filter((f: any) => f.phase === p);
  }

  const statusBadge = (status: string) => {
    if (status === "completed") return <Badge className="bg-green-600 text-white">Completed</Badge>;
    if (status === "forfeited") return <Badge variant="destructive">Forfeited</Badge>;
    if (status === "bye") return <Badge variant="secondary">Bye</Badge>;
    if (status === "pending") return <Badge variant="outline">TBD</Badge>;
    return <Badge className="bg-amber-500 text-white">Scheduled</Badge>;
  };

  return (
    <div className="space-y-6">
      {phases.map((phase) =>
        byPhase[phase]?.length > 0 ? (
          <div key={phase}>
            <h3 className="font-semibold uppercase text-sm text-muted-foreground tracking-wider mb-3">
              {phase === "group" ? "Group Stage"
                : phase === "consolation" ? "Consolation / 3rd Place"
                : phase === "winners" ? "Winners Bracket"
                : phase === "losers" ? "Losers Bracket"
                : phase === "grand_final" ? "Grand Final"
                : "Playoff / Knockout"}
            </h3>
            <div className="space-y-2">
              {byPhase[phase].map((f: any) => {
                const inputs = resultInputs[f.id] || { home: "", away: "" };
                return (
                  <div key={f.id} className="rounded-lg border p-4">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                          <span>Round {f.round}</span>
                          {f.notes && <span>· {f.notes}</span>}
                          {f.scheduledAt && <span>· {format(new Date(f.scheduledAt), "MMM d, h:mm a")}</span>}
                        </div>
                        <div className="flex items-center gap-3 font-semibold">
                          <span className="truncate">{f.homeTeam?.name || "TBD"}</span>
                          {f.status === "completed" || f.status === "forfeited" ? (
                            <span className="text-xl font-bold text-primary">{f.homeScore}–{f.awayScore}</span>
                          ) : (
                            <span className="text-muted-foreground">vs</span>
                          )}
                          <span className="truncate">{f.awayTeam?.name || "TBD"}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                        {statusBadge(f.status)}
                        {f.status === "scheduled" && (
                          <>
                            <div className="flex items-center gap-1">
                              <Input
                                className="w-14 h-8 text-center text-sm"
                                placeholder="H"
                                value={inputs.home}
                                onChange={(e) => setResultInputs((p) => ({ ...p, [f.id]: { ...inputs, home: e.target.value } }))}
                              />
                              <span>–</span>
                              <Input
                                className="w-14 h-8 text-center text-sm"
                                placeholder="A"
                                value={inputs.away}
                                onChange={(e) => setResultInputs((p) => ({ ...p, [f.id]: { ...inputs, away: e.target.value } }))}
                              />
                            </div>
                            <Button size="sm" onClick={() => submitResult.mutate({ fixtureId: f.id, homeScore: inputs.home, awayScore: inputs.away })}
                              disabled={submitResult.isPending || inputs.home === "" || inputs.away === ""}>
                              Record
                            </Button>
                            <Button size="sm" variant="ghost"
                              onClick={() => setForfeitPending({ fixtureId: f.id, forfeitingTeamId: f.homeTeamId, teamName: f.homeTeam?.name ?? "Home Team" })}>
                              Forfeit Home
                            </Button>
                          </>
                        )}
                        {f.status !== "completed" && f.status !== "bye" && (
                          <Button size="sm" variant="ghost" asChild>
                            <Link href={`/admin/tournaments/fixtures/${f.id}/checkin`}>Check-in</Link>
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" asChild title="Attendance history">
                          <Link href={`/admin/tournaments/${tournamentId}/fixtures/${f.id}/attendance`}>
                            <BarChart2 className="h-4 w-4" />
                          </Link>
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null,
      )}
      <AlertDialog open={forfeitPending !== null} onOpenChange={(open) => { if (!open) setForfeitPending(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Record forfeit?</AlertDialogTitle>
            <AlertDialogDescription>This will record a forfeit loss for {forfeitPending?.teamName}. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (forfeitPending) { forfeit.mutate({ fixtureId: forfeitPending.fixtureId, forfeitingTeamId: forfeitPending.forfeitingTeamId }); setForfeitPending(null); } }}
            >
              Record Forfeit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Self Check-in Status Panel ───────────────────────────────────────────────

function SelfCheckinPanel({ tournamentId }: { tournamentId: number }) {
  const getHeaders = useAuthHeaders();
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: status, isLoading } = useQuery({
    queryKey: ["tournament-self-checkin", tournamentId],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/tournaments/${tournamentId}/self-checkin`, { headers });
      return r.json();
    },
  });

  if (isLoading) return <Skeleton className="h-40" />;
  if (!status?.length) return <p className="text-muted-foreground">No registered teams.</p>;

  const confirmed = status.filter((s: any) => s.selfCheckinConfirmed).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <CheckCircle2 className="h-4 w-4 text-green-500" />
        {confirmed}/{status.length} teams confirmed
      </div>
      <div className="space-y-2">
        {status.map((s: any) => (
          <div key={s.id} className="rounded-lg border px-4 py-3 flex items-center justify-between gap-3">
            <div>
              <div className="font-medium">{s.team?.name || `Team #${s.teamId}`}</div>
              {s.selfCheckinConfirmedAt && (
                <div className="text-xs text-muted-foreground">
                  Confirmed {format(new Date(s.selfCheckinConfirmedAt), "MMM d, h:mm a")}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {s.selfCheckinConfirmed
                ? <Badge className="bg-green-600 text-white"><CheckCircle2 className="h-3 w-3 mr-1" />Confirmed</Badge>
                : <Badge variant="outline"><AlertCircle className="h-3 w-3 mr-1" />Pending</Badge>}
              {paymentBadge(s.paymentStatus)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Division-aware wrappers for Seeds and Fixtures panels ───────────────────

function useTournamentDivisions(tournamentId: number) {
  const getHeaders = useAuthHeaders();
  return useQuery({
    queryKey: ["tournament-divisions", tournamentId],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/tournaments/${tournamentId}/divisions`, { headers });
      return r.ok ? r.json() : [];
    },
  });
}

function SeedsPanelWithDivisions({ tournamentId }: { tournamentId: number }) {
  const { data: divisions, isLoading } = useTournamentDivisions(tournamentId);
  const [activeDivId, setActiveDivId] = useState<number | null>(null);

  const resolvedDivId = activeDivId ?? (divisions?.[0]?.id ?? null);

  if (isLoading) return <Skeleton className="h-40" />;
  if (!divisions?.length) return <SeedsPanel tournamentId={tournamentId} />;

  const isMulti = divisions.length > 1;

  return (
    <div className="space-y-4">
      {isMulti && (
        <div className="flex flex-wrap gap-2">
          {divisions.map((d: any) => (
            <button
              key={d.id}
              onClick={() => setActiveDivId(d.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-all ${
                resolvedDivId === d.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted text-muted-foreground border-border hover:border-primary/50"
              }`}
            >
              {d.name}
            </button>
          ))}
        </div>
      )}
      <SeedsPanel tournamentId={tournamentId} divisionId={resolvedDivId} />
    </div>
  );
}

function FixturesPanelWithDivisions({ tournamentId }: { tournamentId: number }) {
  const { data: divisions, isLoading } = useTournamentDivisions(tournamentId);
  const [activeDivId, setActiveDivId] = useState<number | null>(null);

  const resolvedDivId = activeDivId ?? (divisions?.[0]?.id ?? null);

  if (isLoading) return <Skeleton className="h-40" />;
  if (!divisions?.length) return <FixturesPanel tournamentId={tournamentId} />;

  const isMulti = divisions.length > 1;

  return (
    <div className="space-y-4">
      {isMulti && (
        <div className="flex flex-wrap gap-2">
          {divisions.map((d: any) => (
            <button
              key={d.id}
              onClick={() => setActiveDivId(d.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-all ${
                resolvedDivId === d.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted text-muted-foreground border-border hover:border-primary/50"
              }`}
            >
              {d.name}
            </button>
          ))}
        </div>
      )}
      <FixturesPanel tournamentId={tournamentId} divisionId={resolvedDivId} />
    </div>
  );
}

// ─── Division Management Panel ───────────────────────────────────────────────

const AGE_GROUP_OPTIONS = [
  { value: "u8", label: "U8" }, { value: "u9", label: "U9" }, { value: "u10", label: "U10" },
  { value: "u11", label: "U11" }, { value: "u12", label: "U12" }, { value: "u13", label: "U13" },
  { value: "u14", label: "U14" }, { value: "u15", label: "U15" }, { value: "u16", label: "U16" },
  { value: "u17", label: "U17" }, { value: "u18", label: "U18" }, { value: "adult", label: "Adult" },
  { value: "coed", label: "Coed" },
];

function DivisionManagementPanel({ tournamentId }: { tournamentId: number }) {
  const getHeaders = useAuthHeaders();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { canManageTournaments } = useAdminPermissions();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", ageGroups: [] as string[], bracketFormat: "", hasGroupStage: false });

  const { data: divisions, isLoading } = useQuery({
    queryKey: ["tournament-divisions", tournamentId],
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/tournaments/${tournamentId}/divisions`, { headers });
      return r.ok ? r.json() : [];
    },
  });

  const saveDivision = useMutation({
    mutationFn: async (payload: any) => {
      const headers = await getHeaders();
      const url = editingId
        ? `${API}/tournaments/${tournamentId}/divisions/${editingId}`
        : `${API}/tournaments/${tournamentId}/divisions`;
      const r = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers,
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tournament-divisions", tournamentId] });
      setShowForm(false);
      setEditingId(null);
      setForm({ name: "", ageGroups: [], bracketFormat: "", hasGroupStage: false });
      toast({ title: editingId ? "Division updated" : "Division created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteDivision = useMutation({
    mutationFn: async (divId: number) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/tournaments/${tournamentId}/divisions/${divId}`, { method: "DELETE", headers });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || "Failed"); }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tournament-divisions", tournamentId] });
      setDeleteId(null);
      toast({ title: "Division deleted" });
    },
    onError: (e: any) => { setDeleteId(null); toast({ title: "Cannot delete", description: e.message, variant: "destructive" }); },
  });

  const openEdit = (div: any) => {
    setForm({
      name: div.name,
      ageGroups: Array.isArray(div.ageGroups) ? div.ageGroups : [],
      bracketFormat: div.bracketFormat || "",
      hasGroupStage: div.hasGroupStage ?? false,
    });
    setEditingId(div.id);
    setShowForm(true);
  };

  const openNew = () => {
    setForm({ name: "", ageGroups: [], bracketFormat: "", hasGroupStage: false });
    setEditingId(null);
    setShowForm(true);
  };

  const toggleAgeGroup = (v: string) =>
    setForm((f) => ({
      ...f,
      ageGroups: f.ageGroups.includes(v) ? f.ageGroups.filter((a) => a !== v) : [...f.ageGroups, v],
    }));

  if (isLoading) return <Skeleton className="h-40" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {divisions?.length === 1
            ? "Single division tournament — all teams, seeds, and brackets share this division."
            : `${divisions?.length ?? 0} divisions — each runs its own bracket independently.`}
        </p>
        {canManageTournaments && (
          <Button size="sm" onClick={openNew} className="gap-1">
            <Plus className="h-4 w-4" /> Add Division
          </Button>
        )}
      </div>

      <div className="space-y-2">
        {divisions?.map((div: any) => (
          <div key={div.id} className="rounded-lg border p-4 flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold">{div.name}</span>
                <Badge variant="secondary" className="text-xs">{div.teamCount} team{div.teamCount !== 1 ? "s" : ""}</Badge>
                {div.bracketFormat && (
                  <Badge variant="outline" className="text-xs capitalize">{div.bracketFormat.replace(/_/g, " ")}</Badge>
                )}
              </div>
              {div.ageGroups?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {div.ageGroups.map((ag: string) => (
                    <span key={ag} className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground uppercase">{ag}</span>
                  ))}
                </div>
              )}
            </div>
            {canManageTournaments && (
              <div className="flex gap-2 flex-shrink-0">
                <Button size="sm" variant="ghost" onClick={() => openEdit(div)}><Pencil className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" onClick={() => setDeleteId(div.id)} className="text-destructive hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      <Dialog open={showForm} onOpenChange={(o) => { if (!o) { setShowForm(false); setEditingId(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Division" : "New Division"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-sm font-medium mb-1 block">Division Name *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder='e.g. "U14 Girls", "Open", "Mens A"'
              />
            </div>
            <div>
              <Label className="text-sm font-medium mb-2 block">Age Groups</Label>
              <div className="flex flex-wrap gap-1.5">
                {AGE_GROUP_OPTIONS.map((ag) => (
                  <button
                    key={ag.value}
                    type="button"
                    onClick={() => toggleAgeGroup(ag.value)}
                    className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${
                      form.ageGroups.includes(ag.value)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-border hover:border-primary/50"
                    }`}
                  >
                    {ag.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-sm font-medium mb-1 block">Bracket Format Override</Label>
              <Select value={form.bracketFormat || "inherit"} onValueChange={(v) => setForm((f) => ({ ...f, bracketFormat: v === "inherit" ? "" : v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Inherit from tournament" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">Inherit from tournament</SelectItem>
                  {BRACKET_FORMATS.map((bf) => <SelectItem key={bf.value} value={bf.value}>{bf.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="has-group-stage"
                checked={form.hasGroupStage}
                onChange={(e) => setForm((f) => ({ ...f, hasGroupStage: e.target.checked }))}
                className="h-4 w-4"
              />
              <Label htmlFor="has-group-stage" className="text-sm cursor-pointer">Has group stage (overrides tournament setting)</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowForm(false); setEditingId(null); }}>Cancel</Button>
            <Button
              disabled={!form.name.trim() || saveDivision.isPending}
              onClick={() => saveDivision.mutate({
                name: form.name.trim(),
                ageGroups: form.ageGroups,
                bracketFormat: form.bracketFormat || null,
                hasGroupStage: form.hasGroupStage,
              })}
            >
              {saveDivision.isPending ? "Saving…" : editingId ? "Save Changes" : "Create Division"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId !== null} onOpenChange={(o) => { if (!o) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete division?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the division. Teams, fixtures, and seeds in this division will have their division assignment cleared. The tournament must keep at least one division.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleteId !== null) deleteDivision.mutate(deleteId); }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Tournament Split Panel ───────────────────────────────────────────────────

function TournamentSplitPanel({ tournament }: { tournament: any }) {
  const { isSuperAdmin } = useAdminPermissions();
  const { data: courts } = useQuery({
    queryKey: ["courts"],
    queryFn: async () => {
      const r = await fetch(`${API}/courts`);
      return r.json();
    },
  });
  const venueId = courts?.find((c: any) => c.id === tournament.courtId)?.venueId ?? null;
  return (
    <EventSplitPanel
      offeringType="tournament"
      offeringId={tournament.id}
      venueId={venueId}
      eventName={tournament.name}
      isSuperAdmin={isSuperAdmin}
    />
  );
}

// ─── Tournament Detail Drawer ─────────────────────────────────────────────────

function TournamentDetail({ tournament, onClose }: { tournament: any; onClose: () => void }) {
  const [tab, setTab] = useState("registrations");

  return (
    <div className="border rounded-2xl overflow-hidden mt-4 bg-card">
      <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/30">
        <div>
          <h2 className="text-xl font-bold font-sans uppercase">{tournament.name}</h2>
          <div className="flex gap-2 mt-1">
            <Badge variant="secondary">{(Array.isArray(tournament.ageGroup) ? tournament.ageGroup.join(", ") : tournament.ageGroup ?? "").replace(/_/g, "–")}</Badge>
            <Badge variant="outline">{tournament.format}</Badge>
            <Badge variant="outline">{tournament.bracketFormat?.replace("_", " ")}</Badge>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>Close ✕</Button>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="p-6">
        <TabsList className="mb-6 flex-wrap">
          <TabsTrigger value="divisions"><Layers className="h-4 w-4 mr-1" />Divisions</TabsTrigger>
          <TabsTrigger value="registrations"><Users className="h-4 w-4 mr-1" />Teams</TabsTrigger>
          <TabsTrigger value="waitlist"><Clock className="h-4 w-4 mr-1" />Waitlist</TabsTrigger>
          <TabsTrigger value="seeds"><List className="h-4 w-4 mr-1" />Seeding</TabsTrigger>
          <TabsTrigger value="fixtures"><GitBranch className="h-4 w-4 mr-1" />Bracket</TabsTrigger>
          <TabsTrigger value="selfcheckin"><ShieldCheck className="h-4 w-4 mr-1" />Self Check-in</TabsTrigger>
          <TabsTrigger value="revenue-split"><DollarSign className="h-4 w-4 mr-1" />Revenue Split</TabsTrigger>
        </TabsList>

        <TabsContent value="divisions">
          <DivisionManagementPanel tournamentId={tournament.id} />
        </TabsContent>
        <TabsContent value="registrations">
          <RegistrationsPanel tournamentId={tournament.id} />
        </TabsContent>
        <TabsContent value="waitlist">
          <TournamentWaitlistPanel tournamentId={tournament.id} />
        </TabsContent>
        <TabsContent value="seeds">
          <SeedsPanelWithDivisions tournamentId={tournament.id} />
        </TabsContent>
        <TabsContent value="fixtures">
          <FixturesPanelWithDivisions tournamentId={tournament.id} />
        </TabsContent>
        <TabsContent value="selfcheckin">
          <SelfCheckinPanel tournamentId={tournament.id} />
        </TabsContent>
        <TabsContent value="revenue-split">
          <TournamentSplitPanel tournament={tournament} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Create / Edit Modal ──────────────────────────────────────────────────────

const emptyForm = {
  name: "",
  ageGroup: ["adult"] as string[],
  gender: "any",
  format: "5v5",
  courtId: 1,
  status: "upcoming",
  teamPrice: "",
  maxTeams: "8",
  registrationOpen: false,
  registrationDeadline: "",
  startDate: "",
  endDate: "",
  startsAt: "",
  endsAt: "",
  activeOverride: "auto",
  description: "",
  imageUrl: "",
  prizePot: "",
  bracketFormat: "single_elimination",
  hasGroupStage: false,
  consolationEnabled: false,
  depositAmount: "",
  balanceDueDate: "",
  seedingMethod: "manual",
};

type FormData = typeof emptyForm;

function TournamentForm({
  initial,
  onSave,
  onCancel,
  isSaving,
  isEditing = false,
  tournamentId,
}: {
  initial: FormData;
  onSave: (data: any) => void;
  onCancel: () => void;
  isSaving: boolean;
  isEditing?: boolean;
  tournamentId?: number;
}) {
  const [form, setForm] = useState<FormData>(initial);
  const set = (k: keyof FormData, v: any) => setForm((p) => ({ ...p, [k]: v }));

  // Fetch divisions when editing to compute union of age groups
  const { data: divisionData } = useQuery({
    queryKey: ["tournament-divisions-form", tournamentId],
    queryFn: async () => {
      if (!tournamentId) return [];
      const r = await fetch(`${API}/tournaments/${tournamentId}/divisions`);
      if (!r.ok) return [];
      return r.json();
    },
    enabled: isEditing && !!tournamentId,
  });
  const divisionAgeGroups: string[] = isEditing && divisionData?.length
    ? [...new Set<string>((divisionData as any[]).flatMap((d: any) => Array.isArray(d.ageGroups) ? d.ageGroups : []))]
    : [];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      name: form.name,
      ageGroup: Array.isArray(form.ageGroup) ? form.ageGroup : form.ageGroup ? [form.ageGroup as unknown as string] : ["adult"],
      gender: (form as any).gender === "any" ? null : ((form as any).gender || null),
      format: form.format,
      courtId: Number(form.courtId) || 1,
      status: form.status,
      teamPrice: form.teamPrice || "0",
      maxTeams: Number(form.maxTeams) || 8,
      registrationOpen: form.registrationOpen,
      registrationDeadline: form.registrationDeadline ? toEasternISOString(form.registrationDeadline) : null,
      startDate: form.startDate || null,
      endDate: form.endDate || null,
      startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
      endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      activeOverride: form.activeOverride === "auto" ? null : form.activeOverride || null,
      description: form.description || null,
      imageUrl: form.imageUrl || null,
      prizePot: form.prizePot || null,
      bracketFormat: form.bracketFormat,
      hasGroupStage: form.hasGroupStage,
      consolationEnabled: form.consolationEnabled,
      depositAmount: form.depositAmount || null,
      balanceDueDate: form.balanceDueDate ? toEasternISOString(form.balanceDueDate) : null,
      seedingMethod: form.seedingMethod,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <Label>Tournament Name *</Label>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} required />
        </div>
        <div className="md:col-span-2">
          <Label>Age Group{isEditing ? "" : " *"} {!isEditing && <span className="text-muted-foreground font-normal text-xs">(select all that apply)</span>}</Label>
          {isEditing ? (
            <div className="mt-1 p-3 rounded-md border bg-muted/30 space-y-1">
              <div className="flex flex-wrap gap-1.5">
                {divisionAgeGroups.length > 0
                  ? divisionAgeGroups.map((ag: string) => (
                      <span key={ag} className="text-xs font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">{ag.toUpperCase()}</span>
                    ))
                  : ((form.ageGroup as unknown as string[]) || []).map((ag: string) => (
                      <span key={ag} className="text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground border">{ag.toUpperCase()}</span>
                    ))
                }
                {divisionAgeGroups.length === 0 && ((form.ageGroup as unknown as string[]) || []).length === 0 && (
                  <span className="text-xs text-muted-foreground">No age groups set</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {divisionAgeGroups.length > 0
                  ? "Union of all division age groups — managed in the Divisions tab."
                  : "Managed per-division — set age groups in the Divisions tab."}
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 mt-1">
                {AGE_GROUPS.map((a) => (
                  <label key={a.value} className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox"
                      checked={((form.ageGroup as unknown as string[]) || []).includes(a.value)}
                      onChange={e => set("ageGroup" as any, e.target.checked ? [...((form.ageGroup as unknown as string[]) || []), a.value] : ((form.ageGroup as unknown as string[]) || []).filter(v => v !== a.value))}
                      className="h-4 w-4 rounded border-input accent-primary" />
                    <span className="text-sm">{a.label}</span>
                  </label>
                ))}
              </div>
              {((form.ageGroup as unknown as string[]) || []).length === 0 && <p className="text-xs text-destructive mt-1">Select at least one age group</p>}
            </>
          )}
        </div>
        <div>
          <Label>Gender</Label>
          <Select value={(form as any).gender ?? "any"} onValueChange={(v) => set("gender" as any, v)}>
            <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any</SelectItem>
              {GENDER_OPTIONS.map((g) => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Format *</Label>
          <Select value={form.format} onValueChange={(v) => set("format", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{FORMATS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Bracket Format *</Label>
          <Select value={form.bracketFormat} onValueChange={(v) => set("bracketFormat", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{BRACKET_FORMATS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Status *</Label>
          <Select value={form.status} onValueChange={(v) => set("status", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Team Entry Fee ($) *</Label>
          <Input type="number" step="0.01" min="0" value={form.teamPrice} onChange={(e) => set("teamPrice", e.target.value)} required />
        </div>
        <div>
          <Label>Max Teams</Label>
          <Input type="number" min="2" value={form.maxTeams} onChange={(e) => set("maxTeams", e.target.value)} />
        </div>
        <div>
          <Label>Deposit Amount ($)</Label>
          <Input type="number" step="0.01" min="0" placeholder="Leave blank = full amount" value={form.depositAmount} onChange={(e) => set("depositAmount", e.target.value)} />
        </div>
        <div>
          <Label>Balance Due Date</Label>
          <Input type="datetime-local" value={form.balanceDueDate} onChange={(e) => set("balanceDueDate", e.target.value)} />
        </div>
        <div>
          <Label>Start Date</Label>
          <Input type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />
        </div>
        <div>
          <Label>End Date</Label>
          <Input type="date" value={form.endDate} onChange={(e) => set("endDate", e.target.value)} />
        </div>
        <div>
          <Label>Registration Deadline</Label>
          <Input type="datetime-local" value={form.registrationDeadline} onChange={(e) => set("registrationDeadline", e.target.value)} />
        </div>
        <div>
          <Label>Active Window Start</Label>
          <Input type="datetime-local" value={form.startsAt ? form.startsAt.replace("Z", "").substring(0, 16) : ""} onChange={(e) => set("startsAt", e.target.value)} />
        </div>
        <div>
          <Label>Active Window End</Label>
          <Input type="datetime-local" value={form.endsAt ? form.endsAt.replace("Z", "").substring(0, 16) : ""} onChange={(e) => set("endsAt", e.target.value)} />
        </div>
        <div>
          <Label>Active Override</Label>
          <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm mt-0"
            value={form.activeOverride ?? "auto"}
            onChange={(e) => set("activeOverride", e.target.value)}>
            <option value="auto">Auto (use time window)</option>
            <option value="active">Force Active</option>
            <option value="closed">Force Closed</option>
          </select>
        </div>
        <div>
          <Label>Prize Pot ($)</Label>
          <Input type="number" step="0.01" min="0" value={form.prizePot} onChange={(e) => set("prizePot", e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <Label>Description</Label>
          <Input value={form.description} onChange={(e) => set("description", e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <Label>Image URL</Label>
          <Input type="url" value={form.imageUrl} onChange={(e) => set("imageUrl", e.target.value)} />
        </div>
        <div className="flex items-center gap-3">
          <input type="checkbox" id="regOpen" checked={form.registrationOpen} onChange={(e) => set("registrationOpen", e.target.checked)} />
          <Label htmlFor="regOpen">Registration Open</Label>
        </div>
        <div className="flex items-center gap-3">
          <input type="checkbox" id="consolation" checked={form.consolationEnabled} onChange={(e) => set("consolationEnabled", e.target.checked)} />
          <Label htmlFor="consolation">Consolation Bracket (3rd place)</Label>
        </div>
        <div className="flex items-center gap-3">
          <input type="checkbox" id="groupStage" checked={form.hasGroupStage} onChange={(e) => set("hasGroupStage", e.target.checked)} />
          <Label htmlFor="groupStage">Group Stage → Knockout</Label>
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={isSaving}>{isSaving ? "Saving…" : "Save Tournament"}</Button>
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminTournaments() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { canManageTournaments } = useAdminPermissions();
  const getHeaders = useAuthHeaders();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [showForm, setShowForm] = useState(false);
  const [editingTournament, setEditingTournament] = useState<any>(null);
  const [selectedTournamentId, setSelectedTournamentId] = useState<number | null>(null);
  const [tournamentToDelete, setTournamentToDelete] = useState<number | null>(null);

  const { data: tournaments, isLoading } = useQuery({
    queryKey: ["tournaments"],
    queryFn: async () => {
      const r = await fetch(`${API}/tournaments`);
      return r.json();
    },
  });

  const createTournament = useMutation({
    mutationFn: async (data: any) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/tournaments`, { method: "POST", headers, body: JSON.stringify(data) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Failed"); }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tournaments"] });
      setShowForm(false);
      toast({ title: "Tournament created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateTournament = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/tournaments/${id}`, { method: "PATCH", headers, body: JSON.stringify(data) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Failed"); }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tournaments"] });
      setEditingTournament(null);
      toast({ title: "Tournament updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const overrideTournament = useMutation({
    mutationFn: async ({ id, activeOverride }: { id: number; activeOverride: string | null }) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/tournaments/${id}/override`, { method: "PATCH", headers, body: JSON.stringify({ activeOverride }) });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tournaments"] }); toast({ title: "Active window override updated" }); },
    onError: (e: any) => toast({ title: "Override failed", description: e.message, variant: "destructive" }),
  });

  const deleteTournament = useMutation({
    mutationFn: async (id: number) => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/tournaments/${id}`, { method: "DELETE", headers });
      if (!r.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tournaments"] });
      toast({ title: "Tournament deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (profileLoading) return <Layout><div className="p-12"><Skeleton className="h-96" /></div></Layout>;
  if (profile?.role !== "admin" && profile?.role !== "staff" && profile?.adminLevel !== "super" && profile?.adminLevel !== "admin") return <Redirect to="/dashboard" />;

  const selectedTournament = tournaments?.find((t: any) => t.id === selectedTournamentId);

  const statusBadge = (s: string) => {
    if (s === "active") return <Badge className="bg-green-600 text-white">Active</Badge>;
    if (s === "completed") return <Badge variant="secondary">Completed</Badge>;
    return <Badge className="bg-amber-500 text-white">Upcoming</Badge>;
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12">
        <div className="flex items-center justify-between mb-8">
          <div>
            <Link href="/admin" className="text-sm text-muted-foreground hover:text-foreground">← Admin</Link>
            <h1 className="text-4xl font-bold font-sans uppercase tracking-tight text-primary mt-1">Tournaments</h1>
          </div>
          {canManageTournaments && (
            <Button onClick={() => { setShowForm(true); setEditingTournament(null); }}>
              <Plus className="h-4 w-4 mr-2" /> New Tournament
            </Button>
          )}
        </div>

        {showForm && !editingTournament && (
          <Card className="mb-8">
            <CardHeader><CardTitle>Create Tournament</CardTitle></CardHeader>
            <CardContent>
              <TournamentForm
                initial={emptyForm}
                onSave={(data) => createTournament.mutate(data)}
                onCancel={() => setShowForm(false)}
                isSaving={createTournament.isPending}
              />
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
        ) : !tournaments?.length ? (
          <div className="text-center py-24 text-muted-foreground">
            <Trophy className="h-12 w-12 mx-auto mb-4 opacity-30" />
            <p className="text-lg">No tournaments yet. Create one to get started.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {tournaments.map((t: any) => (
              <div key={t.id}>
                {editingTournament?.id === t.id ? (
                  <Card>
                    <CardHeader><CardTitle>Edit: {t.name}</CardTitle></CardHeader>
                    <CardContent>
                      <TournamentForm
                        isEditing
                        tournamentId={t.id}
                        initial={{
                          ...emptyForm,
                          ...t,
                          ageGroup: Array.isArray(t.ageGroup) ? t.ageGroup : t.ageGroup ? [t.ageGroup] : ["adult"],
                          gender: t.gender ?? "any",
                          teamPrice: String(t.teamPrice),
                          maxTeams: String(t.maxTeams),
                          depositAmount: t.depositAmount != null ? String(t.depositAmount) : "",
                          prizePot: t.prizePot != null ? String(t.prizePot) : "",
                          startDate: t.startDate || "",
                          endDate: t.endDate || "",
                          startsAt: t.startsAt ? t.startsAt.replace("Z", "").substring(0, 16) : "",
                          endsAt: t.endsAt ? t.endsAt.replace("Z", "").substring(0, 16) : "",
                          activeOverride: t.activeOverride ?? "auto",
                          registrationDeadline: t.registrationDeadline ? toEasternLocalString(t.registrationDeadline) : "",
                          balanceDueDate: t.balanceDueDate ? toEasternLocalString(t.balanceDueDate) : "",
                        }}
                        onSave={(data) => updateTournament.mutate({ id: t.id, data })}
                        onCancel={() => setEditingTournament(null)}
                        isSaving={updateTournament.isPending}
                      />
                    </CardContent>
                  </Card>
                ) : (
                  <div className="rounded-2xl border overflow-hidden">
                    <div
                      className="flex items-center justify-between px-6 py-4 hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => setSelectedTournamentId(selectedTournamentId === t.id ? null : t.id)}
                    >
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="min-w-0">
                          <div className="font-bold text-lg font-sans uppercase truncate">{t.name}</div>
                          <div className="flex gap-2 mt-1 flex-wrap">
                            {statusBadge(t.status)}
                            <Badge variant="secondary">{(Array.isArray(t.ageGroup) ? t.ageGroup.join(", ") : t.ageGroup ?? "").replace(/_/g, "–")}</Badge>
                            <Badge variant="outline">{t.format}</Badge>
                            <Badge variant="outline">{t.bracketFormat?.replace(/_/g, " ")}</Badge>
                            <span className="text-sm text-muted-foreground">{t.teamsRegistered}/{t.maxTeams} teams · ${t.teamPrice}</span>
                            {t.startDate && <span className="text-sm text-muted-foreground">{format(new Date(t.startDate), "MMM d, yyyy")}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {canManageTournaments && (
                          <>
                            <VisibilityToggleGroup
                              eventType="tournament"
                              eventId={t.id}
                              isPublished={t.isPublished ?? true}
                              isFeatured={t.isFeatured ?? false}
                              showOnMobile={t.showOnMobile ?? true}
                              canManage={canManageTournaments}
                              queryKey={["tournaments"]}
                            />
                            <Button
                              size="sm"
                              variant={t.activeOverride === "active" ? "default" : t.activeOverride === "closed" ? "destructive" : "outline"}
                              className="text-xs"
                              title={`Active override: ${t.activeOverride ?? "auto"}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                const next = t.activeOverride === "active" ? null : t.activeOverride === "closed" ? "active" : "closed";
                                overrideTournament.mutate({ id: t.id, activeOverride: next });
                              }}
                            >
                              {t.activeOverride === "active" ? "Force On" : t.activeOverride === "closed" ? "Force Off" : "Auto"}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEditingTournament(t); setShowForm(false); }}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive"
                              onClick={(e) => { e.stopPropagation(); setTournamentToDelete(t.id); }}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                        {selectedTournamentId === t.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </div>
                    </div>

                    {selectedTournamentId === t.id && (
                      <TournamentDetail tournament={t} onClose={() => setSelectedTournamentId(null)} />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={tournamentToDelete !== null} onOpenChange={(open) => { if (!open) setTournamentToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete tournament?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete the tournament along with all its registrations and fixtures. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (tournamentToDelete !== null) { deleteTournament.mutate(tournamentToDelete); setTournamentToDelete(null); } }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
