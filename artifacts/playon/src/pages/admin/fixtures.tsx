import { useState } from "react";
import { useAuth } from "@clerk/react";
import { useGetMyProfile } from "@workspace/api-client-react";
import { Redirect } from "wouter";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarClock, XCircle, RefreshCw, Search, Trash2, UserPlus, UserX } from "lucide-react";
import { toEasternISOString, toEasternLocalString } from "@/lib/timezone";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

interface Fixture {
  id: number;
  entityType: string;
  entityId: number;
  courtId: number | null;
  scheduledAt: string | null;
  durationMinutes: number;
  status: string;
  homeTeamId: number | null;
  awayTeamId: number | null;
}

interface Court { id: number; name: string; }

interface ScorekeeperAssignment {
  id: number;
  staffUserId: number;
  status: string;
  notes: string | null;
  firstName: string | null;
  lastName: string | null;
}

interface GameEventsResponse {
  fixtureId: number;
  homeScore: number;
  awayScore: number;
  homeTeam: { id: number; name: string } | null;
  awayTeam: { id: number; name: string } | null;
  homeFouls: number;
  awayFouls: number;
  events: Array<{ id: number; eventType: string; teamId: number | null; value: number; occurredAt: string; }>;
}

/** Inline live scoreboard card, auto-refetched every 30s. Admin can delete events. */
function LiveScoreboard({ fixture, getToken }: { fixture: Fixture; getToken: () => Promise<string | null> }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<GameEventsResponse>({
    queryKey: ["game-events", fixture.id],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/fixtures/${fixture.id}/events`);
      if (!res.ok) throw new Error("Failed to load events");
      return res.json();
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const deleteEvent = useMutation({
    mutationFn: async (eventId: number) => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/fixtures/${fixture.id}/events/${eventId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to delete event");
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["game-events", fixture.id] }); toast({ title: "Event removed" }); },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  if (isLoading) return <Skeleton className="h-16 w-full mt-3" />;
  if (!data) return null;

  const { homeScore, awayScore, homeTeam, awayTeam, homeFouls, awayFouls, events } = data;

  return (
    <div className="mt-3 border-t pt-3">
      <div className="flex items-center justify-around gap-2 mb-2">
        <div className="text-center flex-1 min-w-0">
          <p className="text-xs text-muted-foreground truncate">{homeTeam?.name ?? "Home"}</p>
          <p className="text-2xl font-black text-primary">{homeScore}</p>
          <p className="text-xs text-muted-foreground">{homeFouls} foul{homeFouls !== 1 ? "s" : ""}</p>
        </div>
        <span className="text-muted-foreground font-bold text-sm">VS</span>
        <div className="text-center flex-1 min-w-0">
          <p className="text-xs text-muted-foreground truncate">{awayTeam?.name ?? "Away"}</p>
          <p className="text-2xl font-black text-primary">{awayScore}</p>
          <p className="text-xs text-muted-foreground">{awayFouls} foul{awayFouls !== 1 ? "s" : ""}</p>
        </div>
      </div>
      {events.length > 0 ? (
        <div className="space-y-1 max-h-32 overflow-y-auto">
          {[...events].reverse().slice(0, 5).map((ev) => (
            <div key={ev.id} className="flex items-center justify-between text-xs text-muted-foreground gap-2">
              <span>
                {ev.eventType === "score" ? "⚽" : ev.eventType === "foul" ? "🟨" : "⏱"}{" "}
                {ev.eventType} · {format(new Date(ev.occurredAt), "h:mm a")}
              </span>
              <button onClick={() => deleteEvent.mutate(ev.id)} disabled={deleteEvent.isPending} className="hover:text-destructive transition-colors" title="Remove event">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground text-center py-1">No events recorded yet</p>
      )}
    </div>
  );
}

/** Scorekeeper assignment panel for a fixture. */
function ScorekeeperPanel({ fixture, getToken }: { fixture: Fixture; getToken: () => Promise<string | null> }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);

  const { data } = useQuery<{ fixtureId: number; scorekeepers: ScorekeeperAssignment[] }>({
    queryKey: ["fixture-scorekeeper", fixture.id],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/fixtures/${fixture.id}/scorekeeper`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load scorekeeper");
      return res.json();
    },
  });

  // Search for scorekeeper users
  const { data: searchResults, isFetching: searching } = useQuery<any[]>({
    queryKey: ["user-search-scorekeeper", searchTerm],
    queryFn: async () => {
      if (!searchTerm || searchTerm.length < 2) return [];
      const token = await getToken();
      // Search all users by name; filter client-side for scorekeeper role
      const res = await fetch(`${API_BASE}/users?q=${encodeURIComponent(searchTerm)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      const d = await res.json();
      const users = Array.isArray(d) ? d : [];
      return users.filter((u: any) => u.role === "scorekeeper");
    },
    enabled: searchTerm.length >= 2,
  });

  const assignMutation = useMutation({
    mutationFn: async (userId: number) => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/fixtures/${fixture.id}/scorekeeper`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Failed to assign"); }
      return res.json();
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["fixture-scorekeeper", fixture.id] });
      setAssignDialogOpen(false);
      setSearchTerm("");
      toast({ title: "Scorekeeper assigned", description: `${d.user?.firstName ?? ""} ${d.user?.lastName ?? ""}`.trim() });
    },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: async (userId: number) => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/fixtures/${fixture.id}/scorekeeper/${userId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to remove");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fixture-scorekeeper", fixture.id] });
      toast({ title: "Scorekeeper removed" });
    },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const current = data?.scorekeepers ?? [];

  return (
    <div className="mt-3 border-t pt-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Scorekeeper</p>
        <Button size="sm" variant="ghost" className="text-xs gap-1 h-6 px-2" onClick={() => setAssignDialogOpen(true)}>
          <UserPlus className="h-3 w-3" /> Assign
        </Button>
      </div>
      {current.length > 0 ? current.map((sk) => (
        <div key={sk.id} className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{sk.firstName} {sk.lastName}</span>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">{sk.status}</Badge>
            <button onClick={() => removeMutation.mutate(sk.staffUserId)} disabled={removeMutation.isPending} className="text-muted-foreground hover:text-destructive transition-colors" title="Remove">
              <UserX className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )) : (
        <p className="text-xs text-muted-foreground italic">No scorekeeper assigned</p>
      )}

      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Assign Scorekeeper</DialogTitle>
            <DialogDescription>Search for a user with the scorekeeper role to assign to this fixture.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search by name…" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            </div>
            {searching && <p className="text-xs text-muted-foreground text-center">Searching…</p>}
            {searchResults && searchResults.length > 0 && (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {searchResults.map((u: any) => (
                  <button key={u.id} onClick={() => assignMutation.mutate(u.id)} disabled={assignMutation.isPending} className="w-full text-left px-3 py-2 rounded-md hover:bg-muted text-sm flex items-center justify-between gap-2">
                    <span>{u.firstName} {u.lastName}</span>
                    <Badge variant="secondary" className="text-xs shrink-0">{u.role}</Badge>
                  </button>
                ))}
              </div>
            )}
            {searchResults && searchResults.length === 0 && searchTerm.length >= 2 && !searching && (
              <p className="text-xs text-muted-foreground text-center">No scorekeepers found matching "{searchTerm}".</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAssignDialogOpen(false); setSearchTerm(""); }}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AdminFixtures() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { getToken } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [entityType, setEntityType] = useState("league");
  const [entityId, setEntityId] = useState("");
  const [cancelTarget, setCancelTarget] = useState<Fixture | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [rescheduleTarget, setRescheduleTarget] = useState<Fixture | null>(null);
  const [rescheduleForm, setRescheduleForm] = useState({ scheduledAt: "", courtId: "", durationMinutes: "" });
  const [expandedScoreboard, setExpandedScoreboard] = useState<Set<number>>(new Set());
  const [expandedScorekeeper, setExpandedScorekeeper] = useState<Set<number>>(new Set());

  const { data: courts = [] } = useQuery<Court[]>({
    queryKey: ["courts"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/courts`);
      return res.json();
    },
  });

  const { data: fixtures, isLoading } = useQuery<Fixture[]>({
    queryKey: ["fixtures", entityType, entityId],
    queryFn: async () => {
      const token = await getToken();
      if (!entityId) return [];
      const res = await fetch(`${API_BASE}/${entityType}s/${entityId}/fixtures`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load fixtures");
      return res.json();
    },
    enabled: !!entityId && !!profile,
  });

  const cancelFixture = useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string }) => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/fixtures/${id}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reason, notifyParties: true }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Failed");
      return d;
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["fixtures"] });
      setCancelTarget(null);
      setCancelReason("");
      toast({ title: "Fixture cancelled", description: `${d.notified} party/parties notified.` });
    },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const rescheduleFixture = useMutation({
    mutationFn: async ({ id }: { id: number }) => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/fixtures/${id}/reschedule`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduledAt: rescheduleForm.scheduledAt ? toEasternISOString(rescheduleForm.scheduledAt) : undefined,
          courtId: rescheduleForm.courtId ? parseInt(rescheduleForm.courtId) : undefined,
          durationMinutes: rescheduleForm.durationMinutes ? parseInt(rescheduleForm.durationMinutes) : undefined,
          notifyParties: true,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Failed");
      return d;
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["fixtures"] });
      setRescheduleTarget(null);
      setRescheduleForm({ scheduledAt: "", courtId: "", durationMinutes: "" });
      toast({ title: "Fixture rescheduled", description: `${d.notified} party/parties notified.` });
    },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const isAdmin = profile?.role === "admin" || profile?.role === "staff" || profile?.adminLevel === "super" || profile?.adminLevel === "admin";
  if (profileLoading) return <Layout><div className="p-12"><Skeleton className="h-96" /></div></Layout>;
  if (!isAdmin) return <Redirect to="/dashboard" />;

  const STATUS_COLORS: Record<string, string> = {
    scheduled: "bg-blue-600", completed: "bg-green-600", cancelled: "bg-red-700", in_progress: "bg-amber-600",
  };

  function toggleSet(set: Set<number>, id: number): Set<number> {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12">
        <a href="/admin" className="text-sm text-muted-foreground hover:text-foreground mb-4 block">← Admin</a>
        <div className="flex items-center gap-3 mb-2">
          <CalendarClock className="h-7 w-7 text-primary" />
          <h1 className="text-3xl font-bold font-sans uppercase tracking-tight text-primary">Fixture Operations</h1>
        </div>
        <p className="text-muted-foreground mb-8">Cancel or reschedule fixtures, assign scorekeepers, and monitor live scores.</p>

        <Card className="mb-6">
          <CardContent className="pt-4">
            <div className="flex gap-4 items-end">
              <div className="space-y-1">
                <Label>Program type</Label>
                <select className="rounded-md border bg-background px-3 py-2 text-sm" value={entityType} onChange={(e) => { setEntityType(e.target.value); setEntityId(""); }}>
                  <option value="league">League</option>
                  <option value="tournament">Tournament</option>
                </select>
              </div>
              <div className="space-y-1 flex-1 max-w-xs">
                <Label>Program ID</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-9" type="number" placeholder="e.g. 1" value={entityId} onChange={(e) => setEntityId(e.target.value)} />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {!entityId ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">Enter a program ID to load fixtures.</CardContent></Card>
        ) : isLoading ? (
          <div className="space-y-3">{[1,2,3].map((i) => <Skeleton key={i} className="h-16" />)}</div>
        ) : !fixtures?.length ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">No fixtures found for this program.</CardContent></Card>
        ) : (
          <div className="space-y-2">
            {fixtures.map((f) => (
              <Card key={f.id}>
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3 flex-wrap">
                      <Badge className={`text-xs text-white ${STATUS_COLORS[f.status] ?? "bg-gray-600"}`}>{f.status}</Badge>
                      <span className="text-sm font-medium">
                        {f.scheduledAt ? format(new Date(f.scheduledAt), "EEE, MMM d · h:mm a") : "TBD"}
                      </span>
                      <span className="text-xs text-muted-foreground">({f.durationMinutes} min)</span>
                      {f.courtId && courts.find((c) => c.id === f.courtId) && (
                        <Badge variant="outline" className="text-xs">{courts.find((c) => c.id === f.courtId)!.name}</Badge>
                      )}
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <Button size="sm" variant="ghost" className="text-xs gap-1" onClick={() => setExpandedScoreboard((s) => toggleSet(s, f.id))}>
                        {expandedScoreboard.has(f.id) ? "Hide Score" : "Live Score"}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-xs gap-1" onClick={() => setExpandedScorekeeper((s) => toggleSet(s, f.id))}>
                        <UserPlus className="h-3.5 w-3.5" />{expandedScorekeeper.has(f.id) ? "Hide" : "Scorekeeper"}
                      </Button>
                      {f.status !== "cancelled" && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            onClick={() => { setRescheduleTarget(f); setRescheduleForm({ scheduledAt: f.scheduledAt ? toEasternLocalString(f.scheduledAt) : "", courtId: f.courtId ? String(f.courtId) : "", durationMinutes: String(f.durationMinutes) }); }}
                          >
                            <RefreshCw className="h-3.5 w-3.5" /> Reschedule
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10"
                            onClick={() => { setCancelTarget(f); setCancelReason(""); }}
                          >
                            <XCircle className="h-3.5 w-3.5" /> Cancel
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  {expandedScoreboard.has(f.id) && <LiveScoreboard fixture={f} getToken={getToken} />}
                  {expandedScorekeeper.has(f.id) && <ScorekeeperPanel fixture={f} getToken={getToken} />}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={!!cancelTarget} onOpenChange={() => setCancelTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel fixture</DialogTitle>
            <DialogDescription>Players, guardians, and assigned refs/scorekeepers will be notified.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Reason <span className="text-muted-foreground text-xs">(optional but recommended)</span></Label>
              <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="e.g. Weather cancellation, Court maintenance" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)}>Back</Button>
            <Button variant="destructive" onClick={() => cancelFixture.mutate({ id: cancelTarget!.id, reason: cancelReason })} disabled={cancelFixture.isPending}>
              {cancelFixture.isPending ? "Cancelling…" : "Cancel fixture"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rescheduleTarget} onOpenChange={() => setRescheduleTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reschedule fixture</DialogTitle>
            <DialogDescription>Court conflicts will be checked. Players and refs/scorekeepers will be notified.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>New date & time <span className="text-destructive">*</span></Label>
              <Input type="datetime-local" value={rescheduleForm.scheduledAt} onChange={(e) => setRescheduleForm({ ...rescheduleForm, scheduledAt: e.target.value })} />
            </div>
            <div>
              <Label>Court <span className="text-muted-foreground text-xs">(optional — keeps current if not changed)</span></Label>
              <select className="w-full rounded-md border bg-background px-3 py-2 text-sm mt-1" value={rescheduleForm.courtId} onChange={(e) => setRescheduleForm({ ...rescheduleForm, courtId: e.target.value })}>
                <option value="">Keep current</option>
                {courts.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Duration (minutes)</Label>
              <Input type="number" value={rescheduleForm.durationMinutes} onChange={(e) => setRescheduleForm({ ...rescheduleForm, durationMinutes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRescheduleTarget(null)}>Cancel</Button>
            <Button onClick={() => rescheduleFixture.mutate({ id: rescheduleTarget!.id })} disabled={rescheduleFixture.isPending || !rescheduleForm.scheduledAt}>
              {rescheduleFixture.isPending ? "Rescheduling…" : "Reschedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
