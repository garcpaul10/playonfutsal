import { API_BASE } from "@/lib/api-base";
import { useState } from "react";
import { useAuth } from "@clerk/react";
import { useGetMyProfile } from "@workspace/api-client-react";
import { Redirect, Link } from "wouter";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, addDays } from "date-fns";
import { toEasternISOString } from "@/lib/timezone";
import { CalendarDays, Lock, Trash2, AlertTriangle, Users, Tent, RefreshCw } from "lucide-react";


interface CourtBlock {
  id: number;
  courtId: number;
  startsAt: string;
  endsAt: string;
  reason: string | null;
  notes: string | null;
}

interface FixtureEvent {
  id: number;
  courtId: number | null;
  entityType: string;
  entityId: number;
  scheduledAt: string;
  durationMinutes: number;
  status: string;
}

interface DropinEvent {
  id: number;
  courtId: number;
  name: string;
  startsAt: string;
  durationMinutes: number;
  status: string;
  maxPlayers: number;
  spotsTotal: number;
  spotsTaken: number;
}

interface CampDay {
  id: number;
  campId: number;
  date: string;
  startTime: string;
  endTime: string;
  notes: string | null;
  courtId: number | null;
  campName: string;
}

interface Court {
  id: number;
  name: string;
  type: string;
}

interface CalendarData {
  courts: Court[];
  fixtures: FixtureEvent[];
  blocks: CourtBlock[];
  dropins: DropinEvent[];
  campDays: CampDay[];
}

export default function AdminCourtCalendar() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { getToken } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const today = new Date();
  const [startDate, setStartDate] = useState(format(today, "yyyy-MM-dd"));
  const [endDate, setEndDate] = useState(format(addDays(today, 14), "yyyy-MM-dd"));
  const [courtIdFilter, setCourtIdFilter] = useState("");
  const [showBlockDialog, setShowBlockDialog] = useState(false);
  const [blockForm, setBlockForm] = useState({ courtId: "", startsAt: "", endsAt: "", reason: "", notes: "" });

  const { data, isLoading, isFetching, dataUpdatedAt, refetch } = useQuery<CalendarData>({
    queryKey: ["court-calendar", startDate, endDate, courtIdFilter],
    queryFn: async () => {
      const token = await getToken();
      const params = new URLSearchParams({ startDate, endDate });
      if (courtIdFilter) params.set("courtId", courtIdFilter);
      const res = await fetch(`${API_BASE}/court-availability/calendar?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load calendar");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const createBlock = useMutation({
    mutationFn: async (body: typeof blockForm) => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/court-availability/blocks`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          courtId: parseInt(body.courtId),
          startsAt: body.startsAt,
          endsAt: body.endsAt,
          reason: body.reason || undefined,
          notes: body.notes || undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Failed");
      return d;
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["court-calendar"] });
      setShowBlockDialog(false);
      setBlockForm({ courtId: "", startsAt: "", endsAt: "", reason: "", notes: "" });
      const warn = d.conflictingFixtures?.length ?? 0;
      toast({
        title: "Court blocked",
        description: warn > 0 ? `⚠️ ${warn} existing fixture(s) overlap this block — review them.` : "Block created.",
      });
    },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const deleteBlock = useMutation({
    mutationFn: async (id: number) => {
      const token = await getToken();
      await fetch(`${API_BASE}/court-availability/blocks/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["court-calendar"] });
      toast({ title: "Block removed" });
    },
  });

  const isAdmin = profile?.role === "admin" || profile?.role === "staff" || profile?.adminLevel === "super" || profile?.adminLevel === "admin";
  if (profileLoading) return <Layout><div className="p-12"><Skeleton className="h-96" /></div></Layout>;
  if (!isAdmin) return <Redirect to="/dashboard" />;

  const courts = data?.courts ?? [];
  const fixtures = data?.fixtures ?? [];
  const blocks = data?.blocks ?? [];
  const dropins = data?.dropins ?? [];
  const campDays = data?.campDays ?? [];

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12">
        <a href="/admin" className="text-sm text-muted-foreground hover:text-foreground mb-4 block">← Admin</a>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <CalendarDays className="h-7 w-7 text-primary" />
            <h1 className="text-3xl font-bold font-sans uppercase tracking-tight text-primary">Court Calendar</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-1.5">
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
              {isFetching ? "Refreshing…" : "Refresh"}
            </Button>
            <Button asChild className="gap-2">
              <Link href="/admin/court-calendar/block">
                <Lock className="h-4 w-4" /> Block courts
              </Link>
            </Button>
          </div>
        </div>
        <p className="text-muted-foreground mb-2">
          View all scheduled events across courts — fixtures, drop-ins, camp days, and blocked periods.
          {dataUpdatedAt > 0 && (
            <span className="ml-2 text-xs">· Updated {format(new Date(dataUpdatedAt), "h:mm:ss a")} · auto-refreshes every 30s</span>
          )}
        </p>

        {/* Legend */}
        <div className="flex gap-3 flex-wrap mb-6">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="w-3 h-3 rounded-sm bg-primary/80" /> Fixture
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="w-3 h-3 rounded-sm bg-blue-500/80" /> Drop-in
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="w-3 h-3 rounded-sm bg-amber-500/80" /> Camp day
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="w-3 h-3 rounded-sm bg-destructive/80" /> Blocked
          </div>
        </div>

        <Card className="mb-6">
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label>From</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>To</Label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Court</Label>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={courtIdFilter}
                  onChange={(e) => setCourtIdFilter(e.target.value)}
                >
                  <option value="">All courts</option>
                  {courts.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="space-y-3">{[1,2,3].map((i) => <Skeleton key={i} className="h-16" />)}</div>
        ) : (
          <div className="space-y-6">
            {courts.map((court) => {
              if (courtIdFilter && String(court.id) !== courtIdFilter) return null;
              const courtFixtures = fixtures.filter((f) => f.courtId === court.id);
              const courtBlocks = blocks.filter((b) => b.courtId === court.id);
              const courtDropins = dropins.filter((d) => d.courtId === court.id);
              const courtCampDays = campDays.filter((cd) => cd.courtId === court.id);
              const totalEvents = courtFixtures.length + courtDropins.length + courtCampDays.length;

              return (
                <Card key={court.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      {court.name}
                      <Badge variant="outline" className="text-xs">{court.type}</Badge>
                      <span className="text-muted-foreground text-xs font-normal ml-auto">
                        {totalEvents} event(s) · {courtBlocks.length} block(s)
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {/* Blocks */}
                    {courtBlocks.map((b) => (
                      <div key={`block-${b.id}`} className="flex items-center justify-between rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Lock className="h-3.5 w-3.5 text-destructive" />
                          <span className="text-sm font-medium">BLOCKED</span>
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(b.startsAt), "MMM d, h:mm a")} – {format(new Date(b.endsAt), "h:mm a")}
                          </span>
                          {b.reason && <span className="text-xs text-muted-foreground">· {b.reason}</span>}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteBlock.mutate(b.id)}
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}

                    {/* Fixtures */}
                    {courtFixtures.map((f) => (
                      <div key={`fixture-${f.id}`} className="flex items-center gap-3 rounded-md bg-primary/5 border border-primary/20 px-3 py-2">
                        <Badge variant={f.status === "cancelled" ? "destructive" : "secondary"} className="text-xs">
                          {f.entityType}
                        </Badge>
                        <span className="text-sm">
                          {f.scheduledAt ? format(new Date(f.scheduledAt), "MMM d, h:mm a") : "TBD"}
                        </span>
                        <span className="text-xs text-muted-foreground">({f.durationMinutes} min)</span>
                        {f.status === "cancelled" && <Badge variant="destructive" className="text-xs ml-auto">Cancelled</Badge>}
                      </div>
                    ))}

                    {/* Drop-ins */}
                    {courtDropins.map((d) => {
                      const fillPct = d.spotsTotal > 0 ? (d.spotsTaken / d.spotsTotal) * 100 : 0;
                      const barColor = fillPct >= 80 ? "bg-red-500" : fillPct >= 50 ? "bg-amber-400" : "bg-green-500";
                      return (
                        <div key={`dropin-${d.id}`} className="flex items-center gap-3 rounded-md bg-blue-500/5 border border-blue-500/20 px-3 py-2">
                          <Users className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                          <Badge className="text-xs bg-blue-500/80 text-white">Drop-in</Badge>
                          <span className="text-sm truncate">{d.name}</span>
                          <span className="text-xs text-muted-foreground">{format(new Date(d.startsAt), "MMM d, h:mm a")}</span>
                          <span className="text-xs text-muted-foreground">({d.durationMinutes} min)</span>
                          <div className="ml-auto flex items-center gap-2 flex-shrink-0">
                            <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${barColor}`}
                                style={{ width: `${Math.min(fillPct, 100)}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground">{d.spotsTaken}/{d.spotsTotal}</span>
                          </div>
                          {d.status === "cancelled" && <Badge variant="destructive" className="text-xs">Cancelled</Badge>}
                        </div>
                      );
                    })}

                    {/* Camp days */}
                    {courtCampDays.map((cd) => (
                      <div key={`camp-${cd.id}`} className="flex items-center gap-3 rounded-md bg-amber-500/5 border border-amber-500/20 px-3 py-2">
                        <Tent className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
                        <Badge className="text-xs bg-amber-500/80 text-white">Camp day</Badge>
                        <span className="text-sm truncate">{cd.campName}</span>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(cd.date), "MMM d")} · {cd.startTime}–{cd.endTime}
                        </span>
                        {cd.notes && <span className="text-xs text-muted-foreground ml-auto truncate">{cd.notes}</span>}
                      </div>
                    ))}

                    {totalEvents === 0 && courtBlocks.length === 0 && (
                      <p className="text-sm text-muted-foreground">No events in this date range.</p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
            {courts.length === 0 && (
              <Card><CardContent className="py-12 text-center text-muted-foreground">No courts found. Add courts first.</CardContent></Card>
            )}
          </div>
        )}
      </div>

      <Dialog open={showBlockDialog} onOpenChange={setShowBlockDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Block court</DialogTitle>
            <DialogDescription>Mark a court unavailable for a time range (maintenance, external booking, etc.)</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Court <span className="text-destructive">*</span></Label>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm mt-1"
                value={blockForm.courtId}
                onChange={(e) => setBlockForm({ ...blockForm, courtId: e.target.value })}
              >
                <option value="">Select court…</option>
                {courts.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Starts at <span className="text-destructive">*</span></Label>
                <Input type="datetime-local" value={blockForm.startsAt} onChange={(e) => setBlockForm({ ...blockForm, startsAt: e.target.value })} />
              </div>
              <div>
                <Label>Ends at <span className="text-destructive">*</span></Label>
                <Input type="datetime-local" value={blockForm.endsAt} onChange={(e) => setBlockForm({ ...blockForm, endsAt: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Reason</Label>
              <Input placeholder="e.g. Maintenance, External booking…" value={blockForm.reason} onChange={(e) => setBlockForm({ ...blockForm, reason: e.target.value })} />
            </div>
            <div>
              <Label>Notes <span className="text-muted-foreground text-xs">(internal)</span></Label>
              <Input placeholder="Optional internal notes" value={blockForm.notes} onChange={(e) => setBlockForm({ ...blockForm, notes: e.target.value })} />
            </div>
            <div className="rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2 flex gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <span>Blocking a court does not auto-cancel existing fixtures. Cross-offering conflict enforcement prevents new bookings from being created during this block.</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBlockDialog(false)}>Cancel</Button>
            <Button
              onClick={() => createBlock.mutate({ ...blockForm, startsAt: blockForm.startsAt ? toEasternISOString(blockForm.startsAt) : blockForm.startsAt, endsAt: blockForm.endsAt ? toEasternISOString(blockForm.endsAt) : blockForm.endsAt })}
              disabled={createBlock.isPending || !blockForm.courtId || !blockForm.startsAt || !blockForm.endsAt}
            >
              {createBlock.isPending ? "Blocking…" : "Block court"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
