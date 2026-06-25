import { API_BASE } from "@/lib/api-base";
import { useEffect, useState } from "react";
import { useAuth } from "@clerk/react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, CheckCircle2, Clock, XCircle, Loader2, CalendarCheck } from "lucide-react";


interface OpenAlert {
  id: number;
  status: "open" | "claimed" | "cancelled";
  fixtureId: number | null;
  gameDate: string | null;
  notes: string | null;
  createdAt: string;
}

function formatDate(d: string | null) {
  if (!d) return "TBD";
  return new Date(d).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function RefAlerts() {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const [alerts, setAlerts] = useState<OpenAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState<number | null>(null);

  async function load() {
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/sub-ref-alerts/open`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setAlerts(await res.json());
      } else if (res.status === 403) {
        toast({
          title: "Access restricted",
          description: "Only referees can view open ref slots.",
          variant: "destructive",
        });
      }
    } catch {
      toast({ title: "Failed to load alerts", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function claim(alertId: number) {
    setClaiming(alertId);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/sub-ref-alerts/${alertId}/claim`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        toast({
          title: data.error ?? "Failed to claim slot",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Slot claimed!",
        description: "You have been assigned this slot. Contact the admin for details.",
      });
      load();
    } catch {
      toast({ title: "Failed to claim slot", variant: "destructive" });
    } finally {
      setClaiming(null);
    }
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <CalendarCheck className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">Open Ref Slots</h1>
          </div>
          <p className="text-muted-foreground">
            Open ref slots for league and tournament fixtures. First to claim gets the assignment.
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : alerts.length === 0 ? (
          <Card className="p-12 text-center border-dashed">
            <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">No open slots right now.</p>
            <p className="text-sm text-muted-foreground mt-1">
              When a slot opens up you'll get a text — check back here to claim it.
            </p>
          </Card>
        ) : (
          <div className="space-y-4">
            {alerts.map((a) => (
              <Card key={a.id} className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <Badge
                        variant="outline"
                        className="gap-1 text-amber-500 border-amber-500/30"
                      >
                        <Clock className="h-3.5 w-3.5" />
                        Open
                      </Badge>
                      {a.fixtureId && (
                        <Badge variant="secondary" className="text-xs">
                          Fixture #{a.fixtureId}
                        </Badge>
                      )}
                    </div>
                    <p className="text-lg font-semibold">{formatDate(a.gameDate)}</p>
                    {a.notes && (
                      <p className="text-sm text-muted-foreground mt-1">{a.notes}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">
                      Posted{" "}
                      {new Date(a.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <Button
                    onClick={() => claim(a.id)}
                    disabled={claiming === a.id}
                    className="shrink-0 gap-2"
                  >
                    {claiming === a.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    Claim slot
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground text-center mt-8">
          Only open slots where you are not already scheduled during that time window are shown.
        </p>
      </div>
    </Layout>
  );
}
