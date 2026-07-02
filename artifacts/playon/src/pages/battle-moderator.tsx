import React, { useState, useEffect } from "react";
import { useRoute } from "wouter";
import { useAuth } from "@clerk/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Crown, Heart, Flame, Swords, QrCode, CheckCircle2,
  AlertTriangle, Clock, Users, Trophy, ChevronRight, RefreshCw,
  Play, Flag,
} from "lucide-react";
import { format } from "date-fns";

const API = (import.meta.env.VITE_API_URL ?? "https://workspaceapi-server-production-3488.up.railway.app").replace(/\/$/, "") + "/api";

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

interface QueueEntry {
  id: number;
  teamId: number;
  position: number;
  status: string;
  teamName: string;
  teamColor: string | null;
  livesBalance: number;
  graceExpiresAt: string | null;
}

function GraceTimer({ expiresAt }: { expiresAt: string }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const update = () => {
      const diff = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
      setSeconds(diff);
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  const color = seconds < 10 ? "text-red-400" : seconds < 30 ? "text-amber-400" : "text-muted-foreground";
  return (
    <span className={`font-mono font-bold ${color}`}>
      {Math.floor(seconds / 60).toString().padStart(2, "0")}:{(seconds % 60).toString().padStart(2, "0")}
    </span>
  );
}

function TeamCard({ entry, rank, isOnCourt, onNoShow }: { entry: QueueEntry; rank: string; isOnCourt?: boolean; onNoShow?: () => void }) {
  const statusColor = entry.status === "on_court" ? "border-green-500/50 bg-green-500/5"
    : entry.status === "pending_purchase" ? "border-amber-500/50 bg-amber-500/5"
    : entry.status === "bowed_out" ? "border-red-500/30 bg-red-500/5 opacity-50"
    : "border-border bg-card";

  return (
    <div className={`rounded-xl border p-3 transition-all ${statusColor}`}>
      <div className="flex items-center gap-3">
        <div className="w-8 text-center">
          <span className={`text-sm font-bold ${isOnCourt ? "text-green-400" : "text-muted-foreground"}`}>
            {rank}
          </span>
        </div>
        <div
          className="w-8 h-8 rounded-full border-2 flex-shrink-0"
          style={{ backgroundColor: (entry.teamColor || "#444") + "40", borderColor: (entry.teamColor || "#888") + "80" }}
        />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-foreground truncate">{entry.teamName}</p>
          <div className="flex items-center gap-2 mt-0.5">
            {entry.status === "on_court" && (
              <span className="text-[10px] font-bold text-green-400 flex items-center gap-0.5">
                <Play className="h-2.5 w-2.5" />ON COURT
              </span>
            )}
            {entry.status === "pending_purchase" && (
              <span className="text-[10px] font-bold text-amber-400 flex items-center gap-1">
                <AlertTriangle className="h-2.5 w-2.5" />
                PENDING PURCHASE
                {entry.graceExpiresAt && <GraceTimer expiresAt={entry.graceExpiresAt} />}
              </span>
            )}
            {entry.status === "bowed_out" && (
              <span className="text-[10px] font-bold text-red-400">BOWED OUT</span>
            )}
          </div>
        </div>
        <div className={`flex items-center gap-1 text-sm font-bold ${entry.livesBalance <= 1 ? "text-red-400" : entry.livesBalance <= 2 ? "text-amber-400" : "text-foreground"}`}>
          <Heart className="h-3.5 w-3.5" />
          {entry.livesBalance}
        </div>
      </div>
      {onNoShow && (entry.status === "queued" || entry.status === "on_court") && (
        <div className="mt-2 pt-2 border-t border-border flex justify-end">
          <button
            onClick={onNoShow}
            className="text-[10px] font-bold text-red-400 border border-red-400/30 rounded px-2 py-1 hover:bg-red-400/10 transition-colors"
          >
            NO-SHOW PENALTY
          </button>
        </div>
      )}
    </div>
  );
}

export default function BattleModeratorPage() {
  const [, params] = useRoute("/battle-mod/:battleId");
  const battleId = Number(params?.battleId);
  const { getToken } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [courtNumber, setCourtNumber] = useState(1);
  const [qr1, setQr1] = useState("");
  const [qr2, setQr2] = useState("");
  const [activeGame, setActiveGame] = useState<{
    gameCardId: number; team1: Record<string, unknown>; team2: Record<string, unknown>;
    rulesCards: Array<{ title: string; body: string; icon: string }>;
  } | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const { data: battle, isLoading: battleLoading } = useQuery({
    queryKey: ["kotc-battle", battleId],
    queryFn: async () => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/battles/${battleId}`);
      if (!res.ok) throw new Error("Failed to load battle");
      return res.json();
    },
    enabled: !!battleId,
    refetchInterval: 10_000,
  });

  const { data: queue = [], isLoading: queueLoading } = useQuery({
    queryKey: ["kotc-queue", battleId, courtNumber],
    queryFn: async () => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/battles/${battleId}/queue?court=${courtNumber}`);
      if (!res.ok) throw new Error("Failed to load queue");
      return res.json();
    },
    enabled: !!battleId,
    refetchInterval: 5_000,
  });

  const startBattle = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/battles/${battleId}/start`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["kotc-battle", battleId] });
      qc.invalidateQueries({ queryKey: ["kotc-queue", battleId, courtNumber] });
      toast({ title: `Battle started! ${data.queuedTeams} teams in queue.` });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const scanQR = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/battles/${battleId}/scan`, {
        method: "POST",
        body: JSON.stringify({ team1QrCode: qr1.trim(), team2QrCode: qr2.trim(), courtNumber }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Scan failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setScanError(null);
      setActiveGame({
        gameCardId: data.gameCard.id,
        team1: data.team1,
        team2: data.team2,
        rulesCards: data.rulesCards,
      });
      setQr1("");
      setQr2("");
      qc.invalidateQueries({ queryKey: ["kotc-queue", battleId, courtNumber] });
    },
    onError: (e: Error) => {
      setScanError(e.message);
    },
  });

  const markNoShow = useMutation({
    mutationFn: async (teamId: number) => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/battles/${battleId}/no-show`, {
        method: "POST",
        body: JSON.stringify({ teamId, courtNumber }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "No-show recorded", description: `Team moved to back of queue. ${data.newBalance} lives remaining.` });
      qc.invalidateQueries({ queryKey: ["kotc-queue", battleId, courtNumber] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const recordResult = useMutation({
    mutationFn: async (winnerTeamId: number) => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/game-cards/${activeGame!.gameCardId}/result`, {
        method: "POST",
        body: JSON.stringify({ winnerTeamId }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Result recorded", description: `${data.newBalance} lives remaining for losing team.` });
      setActiveGame(null);
      qc.invalidateQueries({ queryKey: ["kotc-queue", battleId, courtNumber] });
      qc.invalidateQueries({ queryKey: ["kotc-battle", battleId] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const activeQueue = queue.filter((e: QueueEntry) => e.status !== "bowed_out");
  const onCourtTeams = activeQueue.filter((e: QueueEntry) => e.status === "on_court");
  const waitingTeams = activeQueue.filter((e: QueueEntry) => e.status === "queued" || e.status === "pending_purchase");

  const isBattleActive = battle?.status === "active";

  if (battleLoading) {
    return (
      <div className="min-h-screen bg-background p-4 space-y-4">
        <Skeleton className="h-20" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 pb-8 max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <Crown className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground leading-tight">Battle Moderator</h1>
            {battle && (
              <p className="text-xs text-muted-foreground">
                {format(new Date(battle.scheduledAt), "EEE, MMM d · h:mm a")} · Court {courtNumber}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(battle?.courtCount ?? 1) > 1 && (
            <div className="flex rounded-lg border border-border overflow-hidden">
              {Array.from({ length: battle?.courtCount ?? 1 }, (_, i) => i + 1).map((c) => (
                <button
                  key={c}
                  onClick={() => setCourtNumber(c)}
                  className={`px-3 py-1.5 text-xs font-semibold transition-colors ${courtNumber === c ? "bg-amber-500 text-black" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Court {c}
                </button>
              ))}
            </div>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => { qc.invalidateQueries({ queryKey: ["kotc-queue"] }); qc.invalidateQueries({ queryKey: ["kotc-battle"] }); }}
            className="gap-1"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {battle?.status === "scheduled" && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4 flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-foreground">Battle Not Started</p>
              <p className="text-sm text-muted-foreground">Start the battle to initialize the rotation queue.</p>
            </div>
            <Button onClick={() => startBattle.mutate()} disabled={startBattle.isPending} className="gap-2">
              <Play className="h-4 w-4" />
              {startBattle.isPending ? "Starting..." : "Start Battle"}
            </Button>
          </CardContent>
        </Card>
      )}

      {isBattleActive && (
        <>
          {activeGame ? (
            <Card className="border-green-500/40 bg-green-500/5">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2 text-green-400">
                  <Swords className="h-4 w-4" />
                  Game In Progress
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  {[activeGame.team1, activeGame.team2].map((team, i) => (
                    <button
                      key={String(team.id)}
                      onClick={() => recordResult.mutate(Number(team.id))}
                      disabled={recordResult.isPending}
                      className="group rounded-xl border-2 border-border p-4 text-center hover:border-green-500 hover:bg-green-500/5 transition-all focus:outline-none focus:border-green-500"
                    >
                      <div
                        className="w-12 h-12 rounded-full mx-auto mb-2 border-2"
                        style={{
                          backgroundColor: (String(team.color || "#444")) + "40",
                          borderColor: (String(team.color || "#888")) + "80",
                        }}
                      />
                      <p className="font-bold text-sm text-foreground">{String(team.name)}</p>
                      <div className="flex items-center justify-center gap-1 mt-1 text-xs text-muted-foreground">
                        <Heart className="h-3 w-3" />{Number(team.livesBalance)}
                      </div>
                      <div className="mt-3 py-2 rounded-lg bg-green-500/0 group-hover:bg-green-500/10 border border-transparent group-hover:border-green-500/40 transition-all text-xs font-bold text-green-400 opacity-0 group-hover:opacity-100">
                        TAP = WINNER
                      </div>
                    </button>
                  ))}
                </div>
                <p className="text-center text-xs text-muted-foreground">Tap the winning team to record the result</p>

                <div className="mt-2 space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Game Rules Reminder</p>
                  <div className="grid grid-cols-2 gap-2">
                    {activeGame.rulesCards.slice(0, 2).map((card) => (
                      <div key={card.title} className="rounded-lg bg-muted/50 border border-border p-3">
                        <p className="text-[11px] font-bold text-foreground mb-1">{card.title}</p>
                        <p className="text-[11px] text-muted-foreground leading-tight">{card.body}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <QrCode className="h-4 w-4 text-muted-foreground" />
                  Scan Captain QR Codes
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {scanError && (
                  <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400 flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    {scanError}
                  </div>
                )}
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">Team 1 Captain QR</label>
                    <Input
                      value={qr1}
                      onChange={(e) => setQr1(e.target.value)}
                      placeholder="Scan or enter QR code..."
                      className="mt-1 font-mono text-sm"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">Team 2 Captain QR</label>
                    <Input
                      value={qr2}
                      onChange={(e) => setQr2(e.target.value)}
                      placeholder="Scan or enter QR code..."
                      className="mt-1 font-mono text-sm"
                    />
                  </div>
                </div>
                <Button
                  onClick={() => scanQR.mutate()}
                  disabled={!qr1.trim() || !qr2.trim() || scanQR.isPending}
                  className="w-full gap-2"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {scanQR.isPending ? "Validating..." : "Validate & Start Game"}
                </Button>
              </CardContent>
            </Card>
          )}

          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <Users className="h-4 w-4" />
              Rotation Queue — Court {courtNumber}
              <span className="text-[11px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                {activeQueue.length} teams
              </span>
            </h2>

            {queueLoading && <Skeleton className="h-48" />}

            {!queueLoading && queue.length === 0 && (
              <Card>
                <CardContent className="py-8 text-center">
                  <p className="text-muted-foreground text-sm">Queue is empty</p>
                </CardContent>
              </Card>
            )}

            <div className="space-y-2">
              {onCourtTeams.map((entry: QueueEntry) => (
                <TeamCard
                  key={entry.id}
                  entry={entry}
                  rank="🏀"
                  isOnCourt
                  onNoShow={() => markNoShow.mutate(entry.teamId)}
                />
              ))}
              {waitingTeams.map((entry: QueueEntry, i: number) => (
                <TeamCard
                  key={entry.id}
                  entry={entry}
                  rank={`#${i + 1}`}
                  onNoShow={() => markNoShow.mutate(entry.teamId)}
                />
              ))}
            </div>

            {queue.filter((e: QueueEntry) => e.status === "bowed_out").length > 0 && (
              <div className="mt-4">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Bowed Out</p>
                <div className="space-y-1.5">
                  {queue.filter((e: QueueEntry) => e.status === "bowed_out").map((entry: QueueEntry) => (
                    <TeamCard key={entry.id} entry={entry} rank="✗" />
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
