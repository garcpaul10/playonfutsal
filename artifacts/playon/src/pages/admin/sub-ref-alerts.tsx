import { API_BASE } from "@/lib/api-base";
import { useEffect, useState } from "react";
import { useAuth } from "@clerk/react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Plus, Users, CheckCircle2, XCircle, Clock, Loader2, MessageSquare } from "lucide-react";
import { toEasternISOString } from "@/lib/timezone";


interface SubRefAlert {
  id: number;
  status: "open" | "claimed" | "filled" | "cancelled";
  fixtureId: number | null;
  gameDate: string | null;
  notes: string | null;
  createdAt: string;
  requestedBy: { id: number; firstName: string | null; lastName: string | null; email: string } | null;
}

function statusColor(status: SubRefAlert["status"]) {
  switch (status) {
    case "open": return "text-amber-500 border-amber-500/30";
    case "claimed": return "text-green-500 border-green-500/30";
    case "filled": return "text-blue-500 border-blue-500/30";
    case "cancelled": return "text-muted-foreground border-muted";
  }
}

function StatusIcon({ status }: { status: SubRefAlert["status"] }) {
  switch (status) {
    case "open": return <Clock className="h-3.5 w-3.5" />;
    case "claimed": return <CheckCircle2 className="h-3.5 w-3.5" />;
    case "filled": return <CheckCircle2 className="h-3.5 w-3.5" />;
    case "cancelled": return <XCircle className="h-3.5 w-3.5" />;
  }
}

function formatDate(d: string | null) {
  if (!d) return "TBD";
  return new Date(d).toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

export default function AdminSubRefAlerts() {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const [alerts, setAlerts] = useState<SubRefAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ fixtureId: "", gameDate: "", notes: "", programType: "league" });

  async function load() {
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/sub-ref-alerts`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setAlerts(await res.json());
    } catch {
      toast({ title: "Failed to load alerts", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function create() {
    if (!form.fixtureId && !form.programType) {
      toast({ title: "Select a program type (league or tournament)", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/sub-ref-alerts`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          fixtureId: form.fixtureId ? parseInt(form.fixtureId) : undefined,
          programType: form.fixtureId ? undefined : form.programType,
          gameDate: form.gameDate ? toEasternISOString(form.gameDate) : undefined,
          notes: form.notes || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error ?? "Failed to create alert", variant: "destructive" });
        return;
      }
      toast({
        title: "Alert sent",
        description: `${data.notified} ref(s) notified — ${data.sms?.sent ?? 0} by SMS.`,
      });
      setShowDialog(false);
      setForm({ fixtureId: "", gameDate: "", notes: "", programType: "league" });
      load();
    } catch {
      toast({ title: "Failed to create alert", variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }

  async function cancel(id: number) {
    try {
      const token = await getToken();
      await fetch(`${API_BASE}/sub-ref-alerts/${id}/cancel`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      });
      load();
    } catch {
      toast({ title: "Failed to cancel alert", variant: "destructive" });
    }
  }

  const open = alerts.filter((a) => a.status === "open").length;
  const claimed = alerts.filter((a) => a.status === "claimed").length;

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">Sub-Ref Alerts</h1>
              <p className="text-muted-foreground text-sm">
                Alert all unscheduled refs about an open slot — leagues &amp; tournaments only.
              </p>
            </div>
          </div>
          <Button onClick={() => setShowDialog(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            New alert
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <Card className="bg-muted/20">
            <CardContent className="pt-5 pb-4 text-center">
              <p className="text-2xl font-bold text-amber-500">{open}</p>
              <p className="text-xs text-muted-foreground mt-1">Open slots</p>
            </CardContent>
          </Card>
          <Card className="bg-muted/20">
            <CardContent className="pt-5 pb-4 text-center">
              <p className="text-2xl font-bold text-green-500">{claimed}</p>
              <p className="text-xs text-muted-foreground mt-1">Claimed</p>
            </CardContent>
          </Card>
          <Card className="bg-muted/20">
            <CardContent className="pt-5 pb-4 text-center">
              <p className="text-2xl font-bold">{alerts.length}</p>
              <p className="text-xs text-muted-foreground mt-1">Total</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" />
              All alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : alerts.length === 0 ? (
              <div className="text-center py-10">
                <AlertTriangle className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No sub-ref alerts yet.</p>
                <p className="text-xs text-muted-foreground mt-1">
                  When a ref drops for a league or tournament fixture, create an alert here.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {alerts.map((a) => (
                  <div key={a.id} className="rounded-lg border p-4 flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Badge variant="outline" className={`gap-1 ${statusColor(a.status)}`}>
                          <StatusIcon status={a.status} />
                          {a.status}
                        </Badge>
                        {a.fixtureId && (
                          <Badge variant="secondary" className="text-xs">Fixture #{a.fixtureId}</Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {formatDate(a.gameDate)}
                        </span>
                      </div>
                      {a.notes && (
                        <p className="text-sm text-muted-foreground mt-1">{a.notes}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">
                        Sent {new Date(a.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        {a.requestedBy && ` by ${a.requestedBy.firstName ?? a.requestedBy.email}`}
                      </p>
                    </div>
                    {a.status === "open" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => cancel(a.id)}
                        className="shrink-0 text-destructive hover:text-destructive"
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-primary" />
                Send sub-ref alert
              </DialogTitle>
              <DialogDescription>
                All unscheduled refs will be texted immediately. First to claim gets the slot.
                Only for league and tournament fixtures — not drop-ins.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <Label htmlFor="programType">Program type <span className="text-destructive">*</span></Label>
                <select
                  id="programType"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm mt-1"
                  value={form.programType}
                  onChange={(e) => setForm({ ...form, programType: e.target.value })}
                  disabled={!!form.fixtureId}
                >
                  <option value="league">League</option>
                  <option value="tournament">Tournament</option>
                </select>
                <p className="text-xs text-muted-foreground mt-1">Drop-ins are not eligible for sub-ref alerts.</p>
              </div>
              <div>
                <Label htmlFor="fixtureId">Fixture ID <span className="text-muted-foreground">(optional — auto-detects program type)</span></Label>
                <Input
                  id="fixtureId"
                  type="number"
                  placeholder="e.g. 42"
                  value={form.fixtureId}
                  onChange={(e) => setForm({ ...form, fixtureId: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="gameDate">Game date &amp; time</Label>
                <Input
                  id="gameDate"
                  type="datetime-local"
                  value={form.gameDate}
                  onChange={(e) => setForm({ ...form, gameDate: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="notes">Notes <span className="text-muted-foreground">(optional)</span></Label>
                <Textarea
                  id="notes"
                  placeholder="e.g. Adult coed league, Court 1, refs get $40"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={3}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
              <Button onClick={create} disabled={creating} className="gap-2">
                {creating && <Loader2 className="h-4 w-4 animate-spin" />}
                Send alert
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
