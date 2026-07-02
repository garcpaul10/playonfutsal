import React, { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@clerk/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Crown, Plus, Users, ChevronRight, Trophy, Heart, Swords, Mail, Check, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const API = (import.meta.env.VITE_API_URL ?? "https://workspaceapi-server-production-3488.up.railway.app").replace(/\/$/, "") + "/api";

function authFetch(token: string | null, url: string, opts?: RequestInit) {
  return fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

const TEAM_COLORS = [
  { label: "Gold", value: "#F59E0B" },
  { label: "Red", value: "#EF4444" },
  { label: "Blue", value: "#3B82F6" },
  { label: "Green", value: "#22C55E" },
  { label: "Purple", value: "#A855F7" },
  { label: "Orange", value: "#F97316" },
  { label: "Pink", value: "#EC4899" },
  { label: "Teal", value: "#14B8A6" },
];

export default function KotcMyTeamsPage() {
  const { getToken } = useAuth();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [showCreate, setShowCreate] = useState(false);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>("");
  const [teamName, setTeamName] = useState("");
  const [teamColor, setTeamColor] = useState(TEAM_COLORS[0].value);
  const [courtPreference, setCourtPreference] = useState("1");

  const { data: seasons = [], isLoading: seasonsLoading } = useQuery({
    queryKey: ["kotc-seasons-my"],
    queryFn: async () => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/seasons`);
      if (!res.ok) return [];
      return res.json() as Promise<Array<Record<string, unknown>>>;
    },
  });

  const activeSeason = (seasons as Array<Record<string, unknown>>).find(
    (s) => s.status === "active"
  ) ?? (seasons as Array<Record<string, unknown>>)[0];

  const { data: myTeams = [], isLoading: teamsLoading } = useQuery({
    queryKey: ["kotc-my-teams"],
    queryFn: async () => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/my-teams`);
      if (!res.ok) return [];
      return res.json() as Promise<Array<Record<string, unknown>>>;
    },
  });

  const { data: myInvites = [] } = useQuery({
    queryKey: ["kotc-my-invites"],
    queryFn: async () => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/my-invites`);
      if (!res.ok) return [];
      return res.json() as Promise<Array<{
        id: number; teamId: number; teamName: string | null; teamColor: string | null;
        seasonId: number; seasonName: string | null; captainName: string | null; invitedAt: string;
      }>>;
    },
  });

  const respondInvite = useMutation({
    mutationFn: async ({ id, action }: { id: number; action: "accept" | "decline" }) => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/team-invites/${id}/${action}`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to respond to invite");
      return res.json();
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["kotc-my-invites"] });
      qc.invalidateQueries({ queryKey: ["kotc-my-teams"] });
      toast({
        title: variables.action === "accept" ? "Invite accepted!" : "Invite declined",
        description: variables.action === "accept" ? "You're on the team." : undefined,
      });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const createTeam = useMutation({
    mutationFn: async () => {
      if (!selectedSeasonId) throw new Error("Select a season");
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/seasons/${selectedSeasonId}/teams`, {
        method: "POST",
        body: JSON.stringify({
          name: teamName.trim(),
          color: teamColor,
          courtPreference: Number(courtPreference),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as Record<string, string>).error ?? "Failed to create team");
      }
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["kotc-my-teams"] });
      toast({ title: "Team created!", description: `"${data.name}" is ready to battle.` });
      setShowCreate(false);
      setTeamName("");
      navigate(`/kotc/teams/${data.id}`);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const isLoading = seasonsLoading || teamsLoading;
  const teams = myTeams as Array<Record<string, unknown>>;

  return (
    <Layout>
      <div className="max-w-lg mx-auto px-4 py-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Crown className="h-6 w-6 text-amber-400" />
            <h1 className="text-2xl font-bold text-foreground">My Teams</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/kotc/leaderboard")}
            >
              <Trophy className="h-4 w-4 mr-1" />
              Leaderboard
            </Button>
            {activeSeason && (
              <Button
                size="sm"
                onClick={() => {
                  setSelectedSeasonId(String(activeSeason.id));
                  setShowCreate(true);
                }}
                className="bg-amber-500 hover:bg-amber-600 text-black font-bold"
              >
                <Plus className="h-4 w-4 mr-1" />
                New Team
              </Button>
            )}
          </div>
        </div>

        {activeSeason && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-2.5 flex items-center gap-2">
            <Swords className="h-4 w-4 text-amber-400 flex-shrink-0" />
            <p className="text-sm text-amber-200">
              Active season: <span className="font-bold">{String(activeSeason.name)}</span>
              <span className="text-amber-400/70 ml-2">· {String(activeSeason.sport).toUpperCase()}</span>
            </p>
          </div>
        )}

        {myInvites.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" />
              Pending Invites ({myInvites.length})
            </h2>
            {myInvites.map((inv) => (
              <div
                key={inv.id}
                className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-3.5 flex items-center gap-3"
              >
                <div
                  className="w-9 h-9 rounded-full border-2 flex-shrink-0"
                  style={{ backgroundColor: (inv.teamColor ?? "#888") + "40", borderColor: (inv.teamColor ?? "#888") + "80" }}
                />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-foreground truncate">{inv.teamName ?? "Team"}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {inv.captainName ? `Invited by ${inv.captainName}` : "Invited"}
                    {inv.seasonName ? ` · ${inv.seasonName}` : ""}
                    {" · "}
                    {formatDistanceToNow(new Date(inv.invitedAt), { addSuffix: true })}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 px-2.5 text-red-500 border-red-500/30 hover:bg-red-500/10"
                    disabled={respondInvite.isPending}
                    onClick={() => respondInvite.mutate({ id: inv.id, action: "decline" })}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 px-3 gap-1 bg-green-600 hover:bg-green-700 text-white"
                    disabled={respondInvite.isPending}
                    onClick={() => respondInvite.mutate({ id: inv.id, action: "accept" })}
                  >
                    <Check className="h-3.5 w-3.5" />
                    Accept
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        )}

        {!isLoading && teams.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center space-y-3">
              <Crown className="h-10 w-10 text-amber-400/40 mx-auto" />
              <p className="text-muted-foreground font-medium">No teams yet</p>
              <p className="text-sm text-muted-foreground">
                Create a team to start competing in Kings of the Court.
              </p>
              {activeSeason && (
                <Button
                  onClick={() => {
                    setSelectedSeasonId(String(activeSeason.id));
                    setShowCreate(true);
                  }}
                  className="mt-2 bg-amber-500 hover:bg-amber-600 text-black font-bold"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Create Your First Team
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {!isLoading && teams.length > 0 && (
          <div className="space-y-3">
            {teams.map((team) => {
              const color = String(team.color ?? "#888");
              return (
                <button
                  key={String(team.id)}
                  onClick={() => navigate(`/kotc/teams/${team.id}`)}
                  className="w-full rounded-xl border border-border bg-card p-4 text-left transition-all hover:border-amber-500/40 hover:bg-amber-500/5"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-full border-2 flex-shrink-0"
                      style={{ backgroundColor: color + "40", borderColor: color + "80" }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-foreground truncate">{String(team.name)}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {Number(team.playerCount ?? 0)} players
                        </span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Heart className="h-3 w-3 text-red-400" />
                          {Number(team.livesBalance ?? 0)} lives
                        </span>
                        {team.wins !== undefined && (
                          <span className="text-xs text-muted-foreground">
                            {Number(team.wins)}W – {Number(team.losses ?? 0)}L
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={showCreate} onOpenChange={(open) => { if (!open) setShowCreate(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-amber-400" />Create a Team
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {(seasons as Array<Record<string, unknown>>).length > 1 && (
              <div>
                <Label>Season</Label>
                <Select value={selectedSeasonId} onValueChange={setSelectedSeasonId}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select season" /></SelectTrigger>
                  <SelectContent>
                    {(seasons as Array<Record<string, unknown>>).map((s) => (
                      <SelectItem key={String(s.id)} value={String(s.id)}>
                        {String(s.name)} {s.status === "active" ? "· Active" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Team Name</Label>
              <Input
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="The Ballers"
                className="mt-1"
                maxLength={40}
              />
            </div>
            <div>
              <Label>Team Color</Label>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {TEAM_COLORS.map((c) => (
                  <button
                    key={c.value}
                    title={c.label}
                    onClick={() => setTeamColor(c.value)}
                    className={`w-8 h-8 rounded-full border-2 transition-transform ${teamColor === c.value ? "border-white scale-110" : "border-transparent scale-100"}`}
                    style={{ backgroundColor: c.value }}
                  />
                ))}
              </div>
            </div>
            <div>
              <Label>Preferred Court # <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                type="number"
                min={1}
                value={courtPreference}
                onChange={(e) => setCourtPreference(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              disabled={!teamName.trim() || !selectedSeasonId || createTeam.isPending}
              onClick={() => createTeam.mutate()}
              className="bg-amber-500 hover:bg-amber-600 text-black font-bold"
            >
              {createTeam.isPending ? "Creating..." : "Create Team"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
