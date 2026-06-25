import { API_BASE } from "@/lib/api-base";
import React, { useState } from "react";
import { Redirect, Link } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import {
  ClipboardList, Calendar, MapPin, AlertTriangle, CheckCheck,
  ChevronRight, Shield, Flag,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";


const STATUS_COLORS: Record<string, { bg: string; label: string }> = {
  upcoming:          { bg: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",         label: "Upcoming" },
  in_progress:       { bg: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",     label: "In Progress" },
  pending_approval:  { bg: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300", label: "Pending Approval" },
  approved:          { bg: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",     label: "Approved" },
  completed:         { bg: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",     label: "Completed" },
  cancelled:         { bg: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",             label: "Cancelled" },
};

interface GameCard {
  id: number;
  fixtureId: number;
  entityType: string;
  entityId: number;
  homeTeamName: string | null;
  awayTeamName: string | null;
  homeScore: number;
  awayScore: number;
  status: string;
  disciplinaryFlagged: boolean;
  scorekeeperName: string | null;
  refNames: string[];
  fixture: { scheduledAt: string | null; durationMinutes: number; status: string } | null;
  court: { id: number; name: string } | null;
}

export default function AdminGameCards() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { getToken } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>("pending_approval");
  const [approveConfirmId, setApproveConfirmId] = useState<number | null>(null);

  const isAdmin = !profileLoading && (profile?.role === "admin" || profile?.role === "staff" || profile?.adminLevel === "super" || profile?.adminLevel === "admin");

  const { data: cards = [], isLoading } = useQuery<GameCard[]>({
    queryKey: ["admin-game-cards", filter],
    enabled: isAdmin,
    queryFn: async () => {
      const token = await getToken();
      const params = filter !== "all" ? `?status=${filter}` : "";
      const res = await fetch(`${API_BASE}/admin/game-cards${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load game cards");
      return res.json();
    },
  });

  const approveOverrideMutation = useMutation({
    mutationFn: async (cardId: number) => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/game-cards/${cardId}/approve-override`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Failed");
      return d;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-game-cards"] });
      toast({ title: "Game card approved on behalf of ref" });
    },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  if (profileLoading) return <Layout><div className="p-12"><Skeleton className="h-64" /></div></Layout>;
  if (!isAdmin) return <Redirect to="/admin" />;

  const sorted = [...cards].sort((a, b) => {
    const ta = a.fixture?.scheduledAt ? new Date(a.fixture.scheduledAt).getTime() : 0;
    const tb = b.fixture?.scheduledAt ? new Date(b.fixture.scheduledAt).getTime() : 0;
    return tb - ta;
  });

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-5xl">
        <div className="mb-8 flex items-start gap-3">
          <ClipboardList className="h-8 w-8 text-primary mt-0.5 shrink-0" />
          <div>
            <h1 className="text-3xl font-bold font-sans uppercase tracking-tight text-primary">Game Card History</h1>
            <p className="text-muted-foreground mt-1">View, approve, and manage all game cards</p>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {["pending_approval", "all", "in_progress", "approved", "completed"].map((f) => (
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
          <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div>
        ) : sorted.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <ClipboardList className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No game cards in this category.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {sorted.map((card) => {
              const s = STATUS_COLORS[card.status] ?? { bg: "bg-gray-100 text-gray-800", label: card.status };
              const scheduledAt = card.fixture?.scheduledAt ? new Date(card.fixture.scheduledAt) : null;
              const isPending = card.status === "pending_approval";

              return (
                <Card key={card.id} className={`${isPending ? "border-purple-300" : ""}`}>
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${s.bg}`}>
                            {s.label}
                          </span>
                          <span className="text-xs text-muted-foreground capitalize">{card.entityType}</span>
                          {card.disciplinaryFlagged && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
                              <AlertTriangle className="h-3 w-3" /> Disciplinary
                            </span>
                          )}
                          {isPending && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                              <Shield className="h-3 w-3" /> Awaiting Ref Approval
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
                          {card.refNames && card.refNames.length > 0 && (
                            <span className="text-xs">Ref: {card.refNames.join(", ")}</span>
                          )}
                          {card.scorekeeperName && (
                            <span className="text-xs">Scorekeeper: {card.scorekeeperName}</span>
                          )}
                        </div>

                        {(card.status === "approved" || card.status === "completed") && (
                          <div className="mt-1 text-sm font-medium">
                            Final: {card.homeTeamName ?? "Home"} {card.homeScore} – {card.awayScore} {card.awayTeamName ?? "Away"}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isPending && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1 text-purple-700 border-purple-300 hover:bg-purple-50"
                            onClick={() => setApproveConfirmId(card.id)}
                            disabled={approveOverrideMutation.isPending}
                          >
                            <CheckCheck className="h-3.5 w-3.5" />
                            Approve on Behalf of Ref
                          </Button>
                        )}
                        <Link href={`/staff/game-cards/${card.id}`}>
                          <Button size="sm" variant="ghost" className="gap-1">
                            View <ChevronRight className="h-4 w-4" />
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      <AlertDialog open={approveConfirmId !== null} onOpenChange={(open) => { if (!open) setApproveConfirmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve on behalf of ref?</AlertDialogTitle>
            <AlertDialogDescription>This will lock the game card and update standings. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (approveConfirmId !== null) { approveOverrideMutation.mutate(approveConfirmId); setApproveConfirmId(null); } }}
            >
              Approve
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>
    </Layout>
  );
}
