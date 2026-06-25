import React, { useState } from "react";
import { useRoute, Link } from "wouter";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ChevronLeft, CheckCircle2, AlertCircle, Users, Trophy, Crown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth, Show } from "@clerk/react";
import { useGetTournament, getGetTournamentQueryKey } from "@workspace/api-client-react";
import { useGetMyProfile } from "@workspace/api-client-react";

import { API_BASE as API } from "@/lib/api-base";

export default function TournamentSelfCheckin() {
  const [, params] = useRoute("/tournaments/:id/self-checkin");
  const id = Number(params?.id);
  const { getToken } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: tournament, isLoading: tLoading } = useGetTournament(id, {
    query: { enabled: !!id, queryKey: getGetTournamentQueryKey(id) },
  });

  const { data: profile } = useGetMyProfile();

  const { data: myMembership } = useQuery({
    queryKey: ["memberships", "my"],
    queryFn: async () => {
      const r = await fetch(`${API}/memberships/my`, { credentials: "include" });
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!profile,
  });

  // Load user's teams to find which one is registered
  const { data: myTeams } = useQuery({
    queryKey: ["my-teams"],
    queryFn: async () => {
      const token = await getToken();
      const r = await fetch(`${API}/teams?myTeams=true`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!profile,
  });

  // Load registrations for this tournament
  const { data: registrations } = useQuery({
    queryKey: ["tournament-registrations-public", id],
    queryFn: async () => {
      const token = await getToken();
      if (!token) return [];
      const r = await fetch(`${API}/tournaments/${id}/registrations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!id && !!profile,
  });

  // Find the captain's registered team
  const myTeamIds = new Set((myTeams || []).map((t: any) => t.id));
  const myRegistration = (registrations || []).find((r: any) => myTeamIds.has(r.teamId));
  const myTeam = myRegistration ? (myTeams || []).find((t: any) => t.id === myRegistration.teamId) : null;

  // Load team members for the registered team
  const { data: teamMembers } = useQuery({
    queryKey: ["team-members", myTeam?.id],
    queryFn: async () => {
      const token = await getToken();
      const r = await fetch(`${API}/teams/${myTeam!.id}/members`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!myTeam?.id,
  });

  const [selectedPlayers, setSelectedPlayers] = useState<Set<number>>(new Set());
  const [confirmed, setConfirmed] = useState(false);

  // Pre-select all players if roster already confirmed
  const isAlreadyConfirmed = myRegistration?.selfCheckinConfirmed;

  const handleToggle = (userId: number) => {
    setSelectedPlayers((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      const r = await fetch(`${API}/tournaments/${id}/self-checkin`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId: myTeam!.id,
          rosterPlayerIds: Array.from(selectedPlayers),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed to confirm roster");
      return data;
    },
    onSuccess: () => {
      setConfirmed(true);
      qc.invalidateQueries({ queryKey: ["tournament-registrations-public", id] });
      toast({ title: "Roster confirmed!", description: "Your team is confirmed for the tournament." });
    },
    onError: (e: any) => {
      toast({ title: "Failed to confirm", description: e.message, variant: "destructive" });
    },
  });

  if (tLoading) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-8 max-w-2xl">
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <Button variant="outline" size="sm" className="mb-6" asChild>
          <Link href={`/tournaments/${id}`}>
            <ChevronLeft className="mr-2 h-4 w-4" /> Back to Tournament
          </Link>
        </Button>

        {tournament && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-1">
              <Trophy className="h-5 w-5 text-primary" />
              <span className="text-sm text-muted-foreground font-medium uppercase tracking-wider">
                Team Confirmation
              </span>
            </div>
            <h1 className="text-3xl font-bold font-sans uppercase">{tournament.name}</h1>
            <p className="text-muted-foreground mt-1">
              Confirm your team's roster for tournament day. This helps the organizers prepare check-in.
            </p>
          </div>
        )}

        <Show when="signed-out">
          <Card>
            <CardContent className="pt-6 text-center">
              <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
              <p className="text-lg font-semibold mb-4">Sign in to confirm your team</p>
              <Button asChild>
                <Link href="/sign-in">Sign In</Link>
              </Button>
            </CardContent>
          </Card>
        </Show>

        <Show when="signed-in">
          {!myRegistration ? (
            <Card>
              <CardContent className="pt-6 text-center">
                <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
                <p className="text-lg font-semibold mb-2">No registered team found</p>
                <p className="text-muted-foreground text-sm mb-4">
                  None of your teams are registered for this tournament.
                </p>
                <Button asChild variant="outline">
                  <Link href={`/tournaments/${id}`}>Register a Team</Link>
                </Button>
              </CardContent>
            </Card>
          ) : (isAlreadyConfirmed || confirmed) ? (
            <Card className="border-green-500/30">
              <CardContent className="pt-6 text-center">
                <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-4" />
                <p className="text-xl font-bold mb-2">Roster Confirmed!</p>
                <p className="text-muted-foreground">
                  <strong>{myTeam?.name}</strong> is confirmed for {tournament?.name}.
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  See you on tournament day. Check-in with the admin when you arrive.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  {myTeam?.name || "Your Team"}
                </CardTitle>
                <CardDescription>
                  Select the players who will be attending. Then confirm your roster.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {myRegistration.paymentStatus !== "paid" && myRegistration.paymentStatus !== "waived" && !myRegistration.balanceOverriddenByAdmin && (
                  <div className="flex items-start gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4">
                    <AlertCircle className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-yellow-600 dark:text-yellow-400">Payment outstanding</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Your team has an outstanding balance. Please contact admin before tournament day.
                      </p>
                    </div>
                  </div>
                )}

                <div className="space-y-3 max-h-80 overflow-y-auto">
                  {(teamMembers || []).length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No team members found. Contact admin to add players.
                    </p>
                  )}
                  {(teamMembers || []).map((m: any) => {
                    const isMe = m.user?.id && profile && m.user.id === (profile as any).id;
                    const hasMembership = isMe && !!myMembership;
                    return (
                      <div
                        key={m.id}
                        className="flex items-center justify-between rounded-lg border px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
                        onClick={() => m.user?.id && handleToggle(m.user.id)}
                      >
                        <div className="flex items-center gap-3">
                          <Checkbox
                            checked={m.user?.id ? selectedPlayers.has(m.user.id) : false}
                            onCheckedChange={() => m.user?.id && handleToggle(m.user.id)}
                          />
                          <div>
                            <p className="font-medium text-sm flex items-center gap-1.5">
                              {m.user?.firstName} {m.user?.lastName}
                              {hasMembership && (
                                <span title="PlayOn Member" className="inline-flex items-center gap-0.5 text-amber-500">
                                  <Crown className="h-3.5 w-3.5" />
                                </span>
                              )}
                            </p>
                            {m.user?.email && (
                              <p className="text-xs text-muted-foreground">{m.user.email}</p>
                            )}
                          </div>
                        </div>
                        <Badge variant={m.role === "captain" ? "default" : "secondary"} className="text-xs capitalize">
                          {m.role}
                        </Badge>
                      </div>
                    );
                  })}
                </div>

                <div className="pt-2 border-t flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {selectedPlayers.size} player{selectedPlayers.size !== 1 ? "s" : ""} selected
                  </span>
                  <Button
                    onClick={() => confirmMutation.mutate()}
                    disabled={confirmMutation.isPending || selectedPlayers.size === 0}
                    className="min-w-[160px]"
                  >
                    {confirmMutation.isPending ? "Confirming…" : "Confirm Roster"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </Show>
      </div>
    </Layout>
  );
}
