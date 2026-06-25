import { API_BASE } from "@/lib/api-base";
import React from "react";
import { useRoute, useLocation } from "wouter";
import { useAuth } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Shield, Users, ChevronLeft } from "lucide-react";


export default function FixtureGameCardPage() {
  const [, params] = useRoute("/fixtures/:id/game-card");
  const fixtureId = params?.id ? Number(params.id) : null;
  const [, navigate] = useLocation();
  const { getToken, isSignedIn } = useAuth();

  const { data: card, isLoading, error } = useQuery({
    queryKey: ["fixture-game-card", fixtureId],
    enabled: !!fixtureId && isSignedIn === true,
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/fixtures/${fixtureId}/game-card`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 403) throw new Error("403");
      if (res.status === 404) throw new Error("404");
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  if (!isSignedIn) {
    return (
      <Layout>
        <div className="max-w-lg mx-auto py-20 text-center space-y-4">
          <Shield className="h-12 w-12 mx-auto text-muted-foreground opacity-40" />
          <h2 className="text-xl font-semibold">Sign in to view game results</h2>
          <p className="text-muted-foreground text-sm">
            Game cards are available to registered players, coaches, and refs after the game is completed.
          </p>
          <Button onClick={() => navigate("/sign-in")}>Sign in</Button>
        </div>
      </Layout>
    );
  }

  if (isLoading) {
    return (
      <Layout>
        <div className="max-w-2xl mx-auto py-8 space-y-4">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      </Layout>
    );
  }

  if (error) {
    const msg = (error as Error).message;
    return (
      <Layout>
        <div className="max-w-lg mx-auto py-20 text-center space-y-4">
          <Shield className="h-12 w-12 mx-auto text-muted-foreground opacity-40" />
          <h2 className="text-xl font-semibold">
            {msg === "403"
              ? "Game card not accessible yet"
              : msg === "404"
              ? "No game card found"
              : "Failed to load game card"}
          </h2>
          <p className="text-muted-foreground text-sm">
            {msg === "403"
              ? "Game cards are visible to players and coaches once the game is completed."
              : msg === "404"
              ? "No game card has been generated for this fixture."
              : "Something went wrong. Please try again."}
          </p>
          <Button variant="outline" onClick={() => navigate(-1 as any)}>Go back</Button>
        </div>
      </Layout>
    );
  }

  if (!card) return null;

  const homeRoster: any[] = Array.isArray(card.homeRoster) ? card.homeRoster : [];
  const awayRoster: any[] = Array.isArray(card.awayRoster) ? card.awayRoster : [];
  const fouls: any[] = Array.isArray(card.fouls) ? card.fouls : [];
  const disciplinary: any[] = Array.isArray(card.disciplinaryActions) ? card.disciplinaryActions : [];

  return (
    <Layout>
      <div className="max-w-2xl mx-auto py-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1 as any)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-bold">Game Results</h1>
            {card.fixture?.scheduledAt && (
              <p className="text-sm text-muted-foreground">
                {new Date(card.fixture.scheduledAt).toLocaleDateString("en-US", {
                  weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
                })}
              </p>
            )}
          </div>
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1 text-center">
                <p className="text-sm text-muted-foreground mb-1">Home</p>
                <p className="font-bold text-lg">{card.homeTeamName ?? "TBD"}</p>
                <p className="text-4xl font-black mt-2">{card.homeScore ?? 0}</p>
              </div>
              <div className="text-center">
                <Badge variant={card.status === "completed" ? "secondary" : "outline"} className="text-xs">
                  {card.status}
                </Badge>
              </div>
              <div className="flex-1 text-center">
                <p className="text-sm text-muted-foreground mb-1">Away</p>
                <p className="font-bold text-lg">{card.awayTeamName ?? "TBD"}</p>
                <p className="text-4xl font-black mt-2">{card.awayScore ?? 0}</p>
              </div>
            </div>
            {card.court && (
              <p className="text-xs text-center text-muted-foreground mt-4">Court: {card.court.name}</p>
            )}
          </CardContent>
        </Card>

        {(homeRoster.length > 0 || awayRoster.length > 0) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {homeRoster.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    {card.homeTeamName} Roster
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  {homeRoster.map((p: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      {p.jerseyNumber && (
                        <span className="text-xs text-muted-foreground w-6 text-right">#{p.jerseyNumber}</span>
                      )}
                      <span>{p.firstName} {p.lastName}</span>
                      {p.role && p.role !== "player" && (
                        <Badge variant="outline" className="text-xs ml-auto">{p.role}</Badge>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
            {awayRoster.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    {card.awayTeamName} Roster
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  {awayRoster.map((p: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      {p.jerseyNumber && (
                        <span className="text-xs text-muted-foreground w-6 text-right">#{p.jerseyNumber}</span>
                      )}
                      <span>{p.firstName} {p.lastName}</span>
                      {p.role && p.role !== "player" && (
                        <Badge variant="outline" className="text-xs ml-auto">{p.role}</Badge>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {fouls.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Fouls</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {fouls.map((f: any, i: number) => (
                <div key={i} className="text-sm flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">{f.team === "home" ? card.homeTeamName : card.awayTeamName}</Badge>
                  <span>{f.playerName ?? "Unknown"}</span>
                  {f.minute && <span className="text-muted-foreground text-xs">min {f.minute}</span>}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {disciplinary.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Disciplinary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {disciplinary.map((d: any, i: number) => (
                <div key={i} className="text-sm flex items-center gap-2">
                  <Badge variant={d.cardType === "red" ? "destructive" : "outline"} className="text-xs capitalize">
                    {d.cardType} card
                  </Badge>
                  <Badge variant="outline" className="text-xs">{d.team === "home" ? card.homeTeamName : card.awayTeamName}</Badge>
                  <span>{d.playerName ?? "Unknown"}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
