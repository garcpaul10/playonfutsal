import { API_BASE } from "@/lib/api-base";
import React, { useState } from "react";
import { Redirect, Link } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { format } from "date-fns";
import { ClipboardList, Calendar, MapPin, Users, ChevronRight, AlertTriangle } from "lucide-react";


interface GameCard {
  id: number;
  fixtureId: number;
  entityType: string;
  entityId: number;
  homeTeamName: string | null;
  awayTeamName: string | null;
  homeScore: number;
  awayScore: number;
  homePresent: boolean;
  awayPresent: boolean;
  status: string;
  disciplinaryFlagged: boolean;
  homeRoster: any[];
  awayRoster: any[];
  fixture: {
    scheduledAt: string | null;
    durationMinutes: number;
    status: string;
  } | null;
  court: { id: number; name: string } | null;
}

const STATUS_COLORS: Record<string, { bg: string; label: string }> = {
  upcoming:          { bg: "bg-blue-100 text-blue-800",       label: "Upcoming" },
  in_progress:       { bg: "bg-amber-100 text-amber-800",     label: "In Progress" },
  pending_approval:  { bg: "bg-purple-100 text-purple-800",   label: "Pending Approval" },
  completed:         { bg: "bg-green-100 text-green-800",     label: "Completed" },
  cancelled:         { bg: "bg-red-100 text-red-800",         label: "Cancelled" },
};

export default function StaffGameCards() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { getToken } = useAuth();
  const [filter, setFilter] = useState<string>("all");

  const roleStr = profile?.role as string | undefined;
  const isStaff = !profileLoading && (
    roleStr === "staff" || roleStr === "admin" ||
    roleStr === "ref" || roleStr === "coach" ||
    roleStr === "scorekeeper"
  );

  const { data: cards = [], isLoading } = useQuery<GameCard[]>({
    queryKey: ["my-game-cards"],
    enabled: isStaff,
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/game-cards/my-games`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load game cards");
      return res.json();
    },
  });

  if (profileLoading) {
    return <Layout><div className="p-12"><Skeleton className="h-64" /></div></Layout>;
  }
  if (!isStaff) return <Redirect to="/dashboard" />;

  const filtered = filter === "all" ? cards : cards.filter((c) => c.status === filter);
  const sorted = [...filtered].sort((a, b) => {
    const ta = a.fixture?.scheduledAt ? new Date(a.fixture.scheduledAt).getTime() : 0;
    const tb = b.fixture?.scheduledAt ? new Date(b.fixture.scheduledAt).getTime() : 0;
    return ta - tb;
  });

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <div className="mb-8 flex items-start gap-3">
          <ClipboardList className="h-8 w-8 text-primary mt-0.5 shrink-0" />
          <div>
            <h1 className="text-3xl font-bold font-sans uppercase tracking-tight text-primary">My Games</h1>
            <p className="text-muted-foreground mt-1">Your upcoming and recent game cards</p>
          </div>
        </div>

        <div className="flex gap-2 mb-6 flex-wrap">
          {["all", "upcoming", "in_progress", "pending_approval", "completed"].map((f) => (
            <Button
              key={f}
              variant={filter === f ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All" : STATUS_COLORS[f]?.label ?? f}
            </Button>
          ))}
        </div>

        {isLoading ? (
          <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
        ) : sorted.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <ClipboardList className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No game cards found.</p>
              <p className="text-sm text-muted-foreground mt-1">
                Game cards are automatically created when fixtures are scheduled and you are assigned as referee.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {sorted.map((card) => {
              const s = STATUS_COLORS[card.status] ?? { bg: "bg-gray-100 text-gray-800", label: card.status };
              const scheduledAt = card.fixture?.scheduledAt ? new Date(card.fixture.scheduledAt) : null;
              const isPast = scheduledAt ? scheduledAt < new Date() : false;

              return (
                <Link key={card.id} href={`/staff/game-cards/${card.id}`}>
                  <Card className="cursor-pointer hover:border-primary/50 transition-colors">
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${s.bg}`}>
                              {s.label}
                            </span>
                            <span className="text-xs text-muted-foreground capitalize">{card.entityType}</span>
                            {card.disciplinaryFlagged && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                <AlertTriangle className="h-3 w-3" />
                                Disciplinary
                              </span>
                            )}
                          </div>
                          <div className="font-semibold text-base truncate">
                            {card.homeTeamName ?? "TBD"} vs {card.awayTeamName ?? "TBD"}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground flex-wrap">
                            {scheduledAt && (
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3.5 w-3.5" />
                                {format(scheduledAt, "EEE, MMM d · h:mm a")}
                              </span>
                            )}
                            {card.court && (
                              <span className="flex items-center gap-1">
                                <MapPin className="h-3.5 w-3.5" />
                                {card.court.name}
                              </span>
                            )}
                            <span className="flex items-center gap-1">
                              <Users className="h-3.5 w-3.5" />
                              {card.homeRoster.length + card.awayRoster.length} players
                            </span>
                          </div>
                          {card.status === "completed" && (
                            <div className="mt-1 text-sm font-medium">
                              Final: {card.homeTeamName ?? "Home"} {card.homeScore} – {card.awayScore} {card.awayTeamName ?? "Away"}
                            </div>
                          )}
                        </div>
                        <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
