import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@clerk/react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Loader2, ArrowLeft, RefreshCw } from "lucide-react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

function getParams() {
  const sp = new URLSearchParams(window.location.search);
  return {
    programType: sp.get("programType") ?? "",
    programId: sp.get("programId") ? parseInt(sp.get("programId")!) : null,
    programName: sp.get("programName") ?? "Program",
    teamId: sp.get("teamId") ? parseInt(sp.get("teamId")!) : undefined,
    playerClerkId: sp.get("playerClerkId") ?? undefined,
  };
}

const TYPE_LABELS: Record<string, string> = {
  league: "League",
  camp: "Camp",
  tournament: "Tournament",
  drop_in: "Drop-in",
};

export default function ReEnroll() {
  const [, navigate] = useLocation();
  const { getToken } = useAuth();
  const { toast } = useToast();

  const params = getParams();
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);

  if (!params.programId || !params.programType) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-16 max-w-md text-center">
          <p className="text-muted-foreground">Missing registration details. Please try again from your dashboard.</p>
          <Button className="mt-4" onClick={() => navigate("/dashboard")}>Back to dashboard</Button>
        </div>
      </Layout>
    );
  }

  async function confirm() {
    setConfirming(true);
    try {
      const token = await getToken();
      const body: Record<string, unknown> = {
        programType: params.programType,
        programId: params.programId,
      };
      if (params.teamId) body.teamId = params.teamId;
      if (params.playerClerkId) body.targetPlayerClerkId = params.playerClerkId;

      const res = await fetch(`${API_BASE}/registrations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        toast({
          title: data.error ?? "Registration failed",
          variant: "destructive",
        });
        return;
      }

      setDone(true);
      toast({
        title: "You're registered!",
        description: `Successfully re-registered for ${params.programName}.`,
      });
    } catch {
      toast({ title: "Something went wrong", variant: "destructive" });
    } finally {
      setConfirming(false);
    }
  }

  if (done) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-16 max-w-md text-center">
          <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">You're in!</h1>
          <p className="text-muted-foreground mb-6">
            You're registered for <span className="font-semibold">{params.programName}</span>. Payment is due before your first session.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button variant="outline" onClick={() => navigate("/dashboard")}>
              Back to dashboard
            </Button>
            <Button onClick={() => navigate("/dashboard")}>
              View my registrations
            </Button>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-lg">
        <button
          onClick={() => navigate("/dashboard")}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-8 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </button>

        <div className="flex items-center gap-3 mb-8">
          <RefreshCw className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Re-register</h1>
            <p className="text-muted-foreground text-sm">Confirm your registration for this program.</p>
          </div>
        </div>

        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Registration summary</CardTitle>
            <CardDescription>Review the details below and confirm.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Program type</span>
              <Badge variant="secondary" className="uppercase">
                {TYPE_LABELS[params.programType] ?? params.programType}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Program</span>
              <span className="text-sm font-medium">{params.programName}</span>
            </div>
            {params.teamId && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Team</span>
                <span className="text-sm font-medium">Same team as before</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Payment</span>
              <span className="text-sm font-medium text-amber-500">Due before first session</span>
            </div>
          </CardContent>
        </Card>

        <Button
          onClick={confirm}
          disabled={confirming}
          size="lg"
          className="w-full gap-2"
        >
          {confirming ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          {confirming ? "Registering…" : "Confirm registration"}
        </Button>

        <p className="text-xs text-muted-foreground text-center mt-4">
          You can cancel at any time before your first session per the refund policy.
        </p>
      </div>
    </Layout>
  );
}
