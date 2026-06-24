import React, { useState } from "react";
import { useRoute } from "wouter";
import { useAuth } from "@clerk/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Crown, Heart, Users, QrCode, Calendar, ChevronRight,
  CheckCircle2, Clock, Plus, UserPlus, Trophy, Swords, Flame,
  AlertTriangle, SkipForward, Minus, ShoppingBag, LogOut,
  ListOrdered, Loader2,
} from "lucide-react";
import { format } from "date-fns";

const API = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

function authFetch(token: string | null, url: string, opts?: RequestInit) {
  return fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts?.headers ?? {}),
    },
  });
}

function RulesAcknowledgment({
  cards, onAcknowledge, loading,
}: {
  cards: Array<{ title: string; body: string; icon: string }>;
  onAcknowledge: () => void;
  loading: boolean;
}) {
  const [step, setStep] = useState(0);

  return (
    <div className="fixed inset-0 bg-background/95 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-4">
            <Crown className="h-7 w-7 text-amber-400" />
          </div>
          <h2 className="text-2xl font-bold text-foreground">Season Rules</h2>
          <p className="text-sm text-muted-foreground mt-1">Read and acknowledge before your first battle</p>
        </div>

        <div className="flex gap-1 justify-center">
          {cards.map((_, i) => (
            <div key={i} className={`h-1.5 rounded-full transition-all ${i <= step ? "bg-amber-400 w-8" : "bg-muted w-4"}`} />
          ))}
        </div>

        {cards[step] && (
          <Card className="border-amber-500/20 bg-amber-500/5">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                  <Trophy className="h-5 w-5 text-amber-400" />
                </div>
                <h3 className="text-lg font-bold text-foreground">{cards[step].title}</h3>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{cards[step].body}</p>
            </CardContent>
          </Card>
        )}

        <div className="flex gap-3">
          {step > 0 && (
            <Button variant="outline" onClick={() => setStep((s) => s - 1)} className="flex-1">
              Back
            </Button>
          )}
          {step < cards.length - 1 ? (
            <Button onClick={() => setStep((s) => s + 1)} className="flex-1 gap-2">
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={onAcknowledge} disabled={loading} className="flex-1 gap-2 bg-amber-500 hover:bg-amber-600 text-black">
              <CheckCircle2 className="h-4 w-4" />
              {loading ? "Saving..." : "I Understand — Let's Play"}
            </Button>
          )}
        </div>

        <p className="text-center text-[11px] text-muted-foreground">
          Card {step + 1} of {cards.length}
        </p>
      </div>
    </div>
  );
}

export default function KotcTeamPage() {
  const [, params] = useRoute("/kotc/teams/:teamId");
  const teamId = Number(params?.teamId);
  const { getToken } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [showInvite, setShowInvite] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [inviteUserId, setInviteUserId] = useState("");
  const [selectedBattleId, setSelectedBattleId] = useState<number | null>(null);
  const [showDissolveDlg, setShowDissolveDlg] = useState(false);

  const { data: team, isLoading: teamLoading } = useQuery({
    queryKey: ["kotc-team", teamId],
    queryFn: async () => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/teams/${teamId}`);
      if (!res.ok) throw new Error("Failed to load team");
      return res.json();
    },
    enabled: !!teamId,
  });

  const { data: rules } = useQuery({
    queryKey: ["kotc-rules", team?.seasonId],
    enabled: !!team?.seasonId,
    queryFn: async () => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/seasons/${team.seasonId}/rules`);
      if (!res.ok) return null;
      return res.json();
    },
  });

  const { data: battles = [] } = useQuery({
    queryKey: ["kotc-battles", team?.seasonId],
    enabled: !!team?.seasonId,
    queryFn: async () => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/seasons/${team.seasonId}/battles`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: registrations = [] } = useQuery({
    queryKey: ["kotc-registrations", teamId],
    enabled: !!teamId,
    queryFn: async () => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/teams/${teamId}/registrations`);
      if (!res.ok) return [];
      return res.json() as Promise<Array<{ id: number; battleId: number; courtNumber: number; actingCaptainUserId: number | null }>>;
    },
  });

  const { data: ledger = [] } = useQuery({
    queryKey: ["kotc-ledger", teamId],
    enabled: !!teamId,
    queryFn: async () => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/teams/${teamId}/life-ledger`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: lifePacks = [] } = useQuery({
    queryKey: ["kotc-life-packs", team?.seasonId],
    enabled: !!team?.seasonId,
    queryFn: async () => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/seasons/${team.seasonId}/life-packs`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.lifePacks ?? [];
    },
  });

  const { data: pendingPurchases = [] } = useQuery({
    queryKey: ["kotc-pending-purchases", teamId],
    enabled: !!teamId,
    queryFn: async () => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/teams/${teamId}/pending-purchases`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: waitlistStatus = [] } = useQuery({
    queryKey: ["kotc-waitlist-status", teamId, team?.seasonId],
    enabled: !!teamId && !!team?.seasonId,
    queryFn: async () => {
      const token = await getToken();
      const bRes = await authFetch(token, `${API}/kotc/seasons/${team.seasonId}/battles`);
      if (!bRes.ok) return [];
      const allBattles = await bRes.json();
      const upcoming = allBattles.filter((b: Record<string, unknown>) => b.status === "scheduled" || b.status === "upcoming");
      const results = await Promise.all(upcoming.map(async (b: Record<string, unknown>) => {
        const wRes = await authFetch(token, `${API}/kotc/battles/${b.id}/waitlist`);
        if (!wRes.ok) return null;
        const wList = await wRes.json();
        const myEntry = wList.find((w: Record<string, unknown>) => Number(w.teamId) === teamId);
        return myEntry ? { battleId: Number(b.id), waitlistEntry: myEntry } : null;
      }));
      return results.filter(Boolean);
    },
  });

  // Fetch the authenticated user's own profile to get their DB user ID
  const { data: myProfile } = useQuery({
    queryKey: ["kotc-me-profile"],
    queryFn: async () => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/me/player-profile`);
      if (!res.ok) return null;
      return res.json() as Promise<{ userId: number } | null>;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Match current authenticated user's team player entry by DB user ID
  const myMember = myProfile
    ? team?.players?.find((p: Record<string, unknown>) => Number(p.userId) === myProfile.userId)
    : undefined;
  const needsAcknowledgment = myMember && !myMember.rulesAcknowledgedAt;

  const acknowledgeRules = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/teams/${teamId}/acknowledge-rules`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kotc-team", teamId] });
      toast({ title: "Rules acknowledged — you're all set!" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const invitePlayer = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/teams/${teamId}/invite`, {
        method: "POST",
        body: JSON.stringify({ inviteeUserId: Number(inviteUserId) }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to invite");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kotc-team", teamId] });
      toast({ title: "Player invited!" });
      setShowInvite(false);
      setInviteUserId("");
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const playShort = useMutation({
    mutationFn: async (battleId: number) => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/teams/${teamId}/play-short`, {
        method: "POST",
        body: JSON.stringify({ battleId }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => toast({ title: "Playing short-handed", description: "No penalty applied — good luck!" }),
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const skipTurn = useMutation({
    mutationFn: async (battleId: number) => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/teams/${teamId}/skip-turn`, {
        method: "POST",
        body: JSON.stringify({ battleId }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kotc-team", teamId] });
      toast({ title: "Turn skipped", description: "You've been moved to the back of the queue." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const [actingCaptainRegistrationId, setActingCaptainRegistrationId] = useState<number | null>(null);
  const [actingCaptainUserId, setActingCaptainUserId] = useState("");

  const setActingCaptain = useMutation({
    mutationFn: async ({ registrationId, userId }: { registrationId: number; userId: number }) => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/registrations/${registrationId}/acting-captain`, {
        method: "PATCH",
        body: JSON.stringify({ actingCaptainUserId: userId }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kotc-registrations", teamId] });
      toast({ title: "Acting captain set!" });
      setActingCaptainRegistrationId(null);
      setActingCaptainUserId("");
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const registerForBattle = useMutation({
    mutationFn: async (battleId: number) => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/battles/${battleId}/register`, {
        method: "POST",
        body: JSON.stringify({ teamId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to register");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Registered for battle!" });
      setShowRegister(false);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const checkoutLifePack = useMutation({
    mutationFn: async (packIndex: number) => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/teams/${teamId}/checkout`, {
        method: "POST",
        body: JSON.stringify({ packIndex }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: (data) => {
      if (data.requiresGuardianApproval) {
        toast({ title: "Guardian Approval Sent", description: "Your guardian will be notified to approve the purchase." });
        qc.invalidateQueries({ queryKey: ["kotc-pending-purchases", teamId] });
      } else if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const joinWaitlist = useMutation({
    mutationFn: async (battleId: number) => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/battles/${battleId}/waitlist`, {
        method: "POST",
        body: JSON.stringify({ teamId }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kotc-waitlist-status", teamId, team?.seasonId] });
      toast({ title: "Joined waitlist!" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const leaveWaitlist = useMutation({
    mutationFn: async (battleId: number) => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/battles/${battleId}/waitlist/${teamId}`, { method: "DELETE" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kotc-waitlist-status", teamId, team?.seasonId] });
      toast({ title: "Left waitlist" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const bowOut = useMutation({
    mutationFn: async (battleId: number) => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/teams/${teamId}/bow-out`, {
        method: "POST",
        body: JSON.stringify({ battleId }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kotc-registrations", teamId] });
      toast({ title: "Left battle", description: "You have voluntarily withdrawn from this battle." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const dissolveTeam = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/teams/${teamId}/dissolve`, { method: "POST" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["kotc-team", teamId] });
      setShowDissolveDlg(false);
      toast({ title: "Team Dissolved", description: data.refundMessage });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (teamLoading) {
    return (
      <Layout>
        <div className="p-4 space-y-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-48" />
        </div>
      </Layout>
    );
  }

  if (!team) {
    return (
      <Layout>
        <div className="p-4 text-center py-16">
          <p className="text-muted-foreground">Team not found.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      {needsAcknowledgment && rules?.cards && (
        <RulesAcknowledgment
          cards={rules.cards}
          onAcknowledge={() => acknowledgeRules.mutate()}
          loading={acknowledgeRules.isPending}
        />
      )}

      <div className="max-w-2xl mx-auto p-4 space-y-5">
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5">
          <div className="flex items-center gap-4">
            <div
              className="w-16 h-16 rounded-2xl border-2 flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: (team.color || "#444") + "40", borderColor: (team.color || "#888") + "80" }}
            >
              <Crown className="h-8 w-8 text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-foreground">{team.name}</h1>
                {team.isReigning && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
                    <Crown className="h-2.5 w-2.5" />REIGNING KING
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 mt-1">
                <div className="flex items-center gap-1.5">
                  <Heart className={`h-4 w-4 ${team.livesBalance <= 1 ? "text-red-400" : team.livesBalance <= 2 ? "text-amber-400" : "text-red-400"}`} />
                  <span className="font-bold text-lg text-foreground">{team.livesBalance}</span>
                  <span className="text-sm text-muted-foreground">lives</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">{team.players?.filter((p: Record<string, unknown>) => p.status === "active").length ?? 0} players</span>
                </div>
              </div>
            </div>
          </div>

          {team.livesBalance <= 2 && (
            <div className={`mt-4 rounded-xl p-3 flex items-center gap-3 ${team.livesBalance === 0 ? "bg-red-500/10 border border-red-500/20" : "bg-amber-500/10 border border-amber-500/20"}`}>
              <AlertTriangle className={`h-5 w-5 flex-shrink-0 ${team.livesBalance === 0 ? "text-red-400" : "text-amber-400"}`} />
              <p className="text-sm text-foreground">
                {team.livesBalance === 0
                  ? "Your team is out of lives! Purchase more to continue playing."
                  : `Only ${team.livesBalance} lives remaining. Consider buying more.`}
              </p>
            </div>
          )}
        </div>

        <Tabs defaultValue="roster">
          <TabsList className="w-full flex-wrap gap-0.5">
            <TabsTrigger value="roster" className="flex-1 gap-1.5 text-xs"><Users className="h-3.5 w-3.5" />Roster</TabsTrigger>
            <TabsTrigger value="battles" className="flex-1 gap-1.5 text-xs"><Swords className="h-3.5 w-3.5" />Battles</TabsTrigger>
            <TabsTrigger value="buy" className="flex-1 gap-1.5 text-xs"><ShoppingBag className="h-3.5 w-3.5" />Buy Lives</TabsTrigger>
            <TabsTrigger value="qr" className="flex-1 gap-1.5 text-xs"><QrCode className="h-3.5 w-3.5" />QR</TabsTrigger>
            <TabsTrigger value="lives" className="flex-1 gap-1.5 text-xs"><Heart className="h-3.5 w-3.5" />Lives</TabsTrigger>
            <TabsTrigger value="rules" className="flex-1 gap-1.5 text-xs"><Trophy className="h-3.5 w-3.5" />Rules</TabsTrigger>
          </TabsList>

          <TabsContent value="roster" className="space-y-3 mt-4">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Team Roster</h2>
              <Button size="sm" variant="outline" onClick={() => setShowInvite(true)} className="gap-1.5">
                <UserPlus className="h-3.5 w-3.5" />
                Invite Player
              </Button>
            </div>
            <div className="space-y-2">
              {(team.players ?? []).map((p: Record<string, unknown>) => (
                <div key={String(p.id)} className="rounded-xl border border-border bg-card p-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-muted border border-border flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-bold text-muted-foreground">
                      {String(p.firstName || "?")[0]?.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-foreground">
                      {p.firstName ? `${p.firstName} ${p.lastName ?? ""}`.trim() : `User #${p.userId}`}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {String(p.role) === "captain" && (
                        <span className="text-[10px] font-bold text-amber-400 flex items-center gap-0.5">
                          <Crown className="h-2.5 w-2.5" />CAPTAIN
                        </span>
                      )}
                      {p.rulesAcknowledgedAt ? (
                        <span className="text-[10px] text-green-400 flex items-center gap-0.5">
                          <CheckCircle2 className="h-2.5 w-2.5" />Rules acknowledged
                        </span>
                      ) : (
                        <span className="text-[10px] text-amber-400 flex items-center gap-0.5">
                          <Clock className="h-2.5 w-2.5" />Rules pending
                        </span>
                      )}
                    </div>
                  </div>
                  <span className={`text-[11px] px-2 py-0.5 rounded font-medium ${String(p.status) === "active" ? "bg-green-500/10 text-green-400" : "bg-muted text-muted-foreground"}`}>
                    {String(p.status)}
                  </span>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="battles" className="space-y-3 mt-4">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Season Battles</h2>
              {battles.length > 0 && (
                <Button size="sm" onClick={() => setShowRegister(true)} className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" />Register
                </Button>
              )}
            </div>
            {battles.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center">
                  <Swords className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No battles scheduled yet.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {battles.map((b: Record<string, unknown>) => (
                  <div key={String(b.id)} className={`rounded-xl border bg-card p-3 space-y-3 ${String(b.status) === "active" ? "border-green-500/30 bg-green-500/5" : "border-border"}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${String(b.status) === "active" ? "bg-green-500/10 border border-green-500/20" : "bg-amber-500/10 border border-amber-500/20"}`}>
                        <Swords className={`h-4 w-4 ${String(b.status) === "active" ? "text-green-400" : "text-amber-400"}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm text-foreground">
                          {format(new Date(String(b.scheduledAt)), "EEE, MMM d · h:mm a")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {Number(b.courtCount)} court{Number(b.courtCount) > 1 ? "s" : ""} · {Number(b.maxTeamsPerCourt)} teams/court
                        </p>
                      </div>
                      <span className={`text-[11px] px-2 py-0.5 rounded font-medium ${String(b.status) === "active" ? "bg-green-500/10 text-green-400" : String(b.status) === "completed" ? "bg-muted text-muted-foreground" : "bg-blue-500/10 text-blue-400"}`}>
                        {String(b.status)}
                      </span>
                    </div>
                    {String(b.status) === "active" && (() => {
                      const reg = registrations.find((r) => r.battleId === Number(b.id));
                      const actingCap = reg?.actingCaptainUserId
                        ? (team.players ?? []).find((p: Record<string, unknown>) => Number(p.userId) === reg.actingCaptainUserId)
                        : null;
                      return (
                        <div className="space-y-2 pt-1 border-t border-green-500/20">
                          {actingCap && (
                            <p className="text-[11px] text-green-400 flex items-center gap-1">
                              <Crown className="h-3 w-3" />
                              Acting captain: {actingCap ? `${String(actingCap.firstName ?? "")} ${String(actingCap.lastName ?? "")}`.trim() : "Unknown"}
                            </p>
                          )}
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="flex-1 gap-1.5 text-xs"
                              disabled={playShort.isPending}
                              onClick={() => playShort.mutate(Number(b.id))}
                            >
                              <Minus className="h-3 w-3" />
                              Play Short
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="flex-1 gap-1.5 text-xs text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
                              disabled={skipTurn.isPending}
                              onClick={() => skipTurn.mutate(Number(b.id))}
                            >
                              <SkipForward className="h-3 w-3" />
                              Skip Turn
                            </Button>
                            {reg && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1.5 text-xs border-amber-500/30 hover:bg-amber-500/10"
                                onClick={() => setActingCaptainRegistrationId(reg.id)}
                              >
                                <Crown className="h-3 w-3" />
                                Acting Cap
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5 text-xs text-red-400 border-red-500/30 hover:bg-red-500/10"
                              disabled={bowOut.isPending}
                              onClick={() => { if (confirm("Voluntarily leave this battle? Lives will not be refunded.")) bowOut.mutate(Number(b.id)); }}
                            >
                              <LogOut className="h-3 w-3" />
                              Bow Out
                            </Button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="buy" className="space-y-4 mt-4">
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1">Buy Lives</h2>
              <p className="text-xs text-muted-foreground">Purchase life packs to keep your team in the game. Lives are non-refundable after your first battle.</p>
            </div>

            {(lifePacks as Array<{ name: string; lives: number; priceCents: number }>).length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center">
                  <ShoppingBag className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No life packs available for this season yet.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3">
                {(lifePacks as Array<{ name: string; lives: number; priceCents: number }>).map((pack, i) => (
                  <div key={i} className="rounded-xl border border-border bg-card p-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-green-500/10 border border-green-500/20 flex items-center justify-center flex-shrink-0">
                        <Heart className="h-5 w-5 text-red-400" />
                      </div>
                      <div>
                        <p className="font-semibold text-sm text-foreground">{pack.name}</p>
                        <p className="text-xs text-muted-foreground">{pack.lives} lives</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <p className="font-bold text-foreground">${(pack.priceCents / 100).toFixed(2)}</p>
                      <Button
                        size="sm"
                        onClick={() => checkoutLifePack.mutate(i)}
                        disabled={checkoutLifePack.isPending || team?.status === "dissolved"}
                        className="gap-1.5"
                      >
                        {checkoutLifePack.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShoppingBag className="h-3.5 w-3.5" />}
                        Buy
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {pendingPurchases.filter((p: Record<string, unknown>) => p.status === "pending").length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Pending Guardian Approval</h3>
                {(pendingPurchases as Array<Record<string, unknown>>).filter((p) => p.status === "pending").map((p) => (
                  <div key={String(p.id)} className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 flex items-center gap-3">
                    <Clock className="h-4 w-4 text-amber-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{String(p.packName)}</p>
                      <p className="text-xs text-muted-foreground">{Number(p.packLives)} lives · ${(Number(p.packPriceCents) / 100).toFixed(2)} · Awaiting guardian approval</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="pt-2 border-t border-border">
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2 text-red-400 border-red-500/30 hover:bg-red-500/10"
                onClick={() => setShowDissolveDlg(true)}
                disabled={team?.status === "dissolved"}
              >
                <LogOut className="h-3.5 w-3.5" />
                {team?.status === "dissolved" ? "Team Dissolved" : "Dissolve Team"}
              </Button>
              <p className="text-[11px] text-muted-foreground text-center mt-2">
                Full refund available if no games played within 48 hrs of first purchase.
              </p>
            </div>
          </TabsContent>

          <TabsContent value="qr" className="mt-4">
            <Card className="text-center">
              <CardContent className="p-8 space-y-4">
                <div>
                  <QrCode className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                  <h3 className="font-bold text-foreground">Team QR Code</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Show this to the Battle Moderator before each game.
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-muted p-6 text-center">
                  <p className="text-xs font-mono text-muted-foreground break-all">{team.qrCode}</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  QR code is tied to this team for the entire season.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="lives" className="space-y-3 mt-4">
            <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Heart className={`h-8 w-8 ${team.livesBalance <= 1 ? "text-red-400" : "text-red-400"}`} />
                <div>
                  <p className="text-3xl font-bold text-foreground">{team.livesBalance}</p>
                  <p className="text-xs text-muted-foreground">lives remaining</p>
                </div>
              </div>
              <div className="ml-auto text-right">
                <p className="text-sm font-medium text-muted-foreground">{team.livesConsumed} consumed</p>
                <p className="text-xs text-muted-foreground">this season</p>
              </div>
            </div>

            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Life Ledger</h3>
            {ledger.length === 0 ? (
              <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">No transactions yet</CardContent></Card>
            ) : (
              <div className="space-y-2">
                {ledger.slice(0, 20).map((entry: Record<string, unknown>) => (
                  <div key={String(entry.id)} className="rounded-xl border border-border bg-card p-3 flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${Number(entry.delta) > 0 ? "bg-green-500/10" : "bg-red-500/10"}`}>
                      <Heart className={`h-4 w-4 ${Number(entry.delta) > 0 ? "text-green-400" : "text-red-400"}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground capitalize">{String(entry.reason).replace(/_/g, " ")}</p>
                      <p className="text-xs text-muted-foreground">{format(new Date(String(entry.createdAt)), "MMM d, h:mm a")}</p>
                    </div>
                    <div className="text-right">
                      <p className={`font-bold text-sm ${Number(entry.delta) > 0 ? "text-green-400" : "text-red-400"}`}>
                        {Number(entry.delta) > 0 ? "+" : ""}{Number(entry.delta)}
                      </p>
                      <p className="text-[11px] text-muted-foreground">→ {Number(entry.balanceAfter)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="rules" className="space-y-3 mt-4">
            {rules?.cards ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Season rules for {rules.season?.sport ?? "your sport"}. Always accessible here.</p>
                {rules.cards.map((card: { title: string; body: string }) => (
                  <Card key={card.title}>
                    <CardContent className="p-4">
                      <h3 className="font-bold text-foreground mb-2">{card.title}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">{card.body}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Skeleton className="h-48" />
            )}
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={showDissolveDlg} onOpenChange={setShowDissolveDlg}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400">
              <AlertTriangle className="h-5 w-5" />Dissolve Team
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This will permanently dissolve your team. All players will be removed.
            </p>
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
              <p className="text-xs font-semibold text-amber-400 mb-1">Refund Policy</p>
              <p className="text-xs text-muted-foreground">
                A full refund is available if the team dissolves within 48 hours of the first purchase AND before playing any battles.
                Otherwise, life pack purchases are final.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDissolveDlg(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => dissolveTeam.mutate()} disabled={dissolveTeam.isPending}>
              {dissolveTeam.isPending ? "Dissolving..." : "Dissolve Team"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />Invite Player
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Player User ID</Label>
              <Input
                value={inviteUserId}
                onChange={(e) => setInviteUserId(e.target.value)}
                placeholder="Enter user ID"
                className="mt-1"
                type="number"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInvite(false)}>Cancel</Button>
            <Button onClick={() => invitePlayer.mutate()} disabled={!inviteUserId || invitePlayer.isPending}>
              {invitePlayer.isPending ? "Inviting..." : "Send Invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showRegister} onOpenChange={setShowRegister}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Swords className="h-5 w-5 text-amber-400" />Register for Battle
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {battles.filter((b: Record<string, unknown>) => b.status === "scheduled").map((b: Record<string, unknown>) => (
              <button
                key={String(b.id)}
                onClick={() => setSelectedBattleId(Number(b.id))}
                className={`w-full rounded-xl border p-3 text-left transition-all ${selectedBattleId === Number(b.id) ? "border-amber-500 bg-amber-500/5" : "border-border hover:border-amber-500/40"}`}
              >
                <p className="font-medium text-sm text-foreground">
                  {format(new Date(String(b.scheduledAt)), "EEE, MMM d · h:mm a")}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {Number(b.courtCount)} court{Number(b.courtCount) > 1 ? "s" : ""}
                </p>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRegister(false)}>Cancel</Button>
            <Button
              onClick={() => selectedBattleId && registerForBattle.mutate(selectedBattleId)}
              disabled={!selectedBattleId || registerForBattle.isPending}
            >
              {registerForBattle.isPending ? "Registering..." : "Register"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={actingCaptainRegistrationId !== null} onOpenChange={(open) => { if (!open) setActingCaptainRegistrationId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-amber-400" />Set Acting Captain
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Select the player who will scan the QR code and captain the team in this battle.</p>
            <div className="space-y-1.5">
              {(team?.players ?? [])
                .filter((p: Record<string, unknown>) => p.status === "active")
                .map((p: Record<string, unknown>) => (
                  <button
                    key={String(p.id)}
                    onClick={() => setActingCaptainUserId(String(p.userId))}
                    className={`w-full rounded-xl border p-3 text-left transition-all flex items-center gap-3 ${actingCaptainUserId === String(p.userId) ? "border-amber-500 bg-amber-500/5" : "border-border hover:border-amber-500/40"}`}
                  >
                    <div className="w-8 h-8 rounded-full bg-muted border border-border flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-bold text-muted-foreground">{String(p.firstName || "?")[0]?.toUpperCase()}</span>
                    </div>
                    <span className="text-sm font-medium text-foreground">
                      {p.firstName ? `${String(p.firstName)} ${String(p.lastName ?? "")}`.trim() : `User #${p.userId}`}
                    </span>
                    {String(p.role) === "captain" && (
                      <span className="ml-auto text-[10px] font-bold text-amber-400">CAPTAIN</span>
                    )}
                  </button>
                ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActingCaptainRegistrationId(null)}>Cancel</Button>
            <Button
              disabled={!actingCaptainUserId || setActingCaptain.isPending}
              onClick={() => actingCaptainRegistrationId && setActingCaptain.mutate({
                registrationId: actingCaptainRegistrationId,
                userId: Number(actingCaptainUserId),
              })}
            >
              {setActingCaptain.isPending ? "Saving..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
