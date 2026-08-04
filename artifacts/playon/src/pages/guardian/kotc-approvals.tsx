import React from "react";
import { useAuth } from "@clerk/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Crown, Heart, Check, X, Clock, ExternalLink } from "lucide-react";
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

interface PendingPurchase {
  id: number;
  teamId: number;
  teamName: string | null;
  teamColor: string | null;
  seasonName: string | null;
  packName: string;
  packLives: number;
  packPriceCents: number;
  expiresAt: string | null;
  createdAt: string;
}

export default function GuardianKotcApprovals() {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: pending = [], isLoading } = useQuery({
    queryKey: ["kotc-pending-purchases"],
    queryFn: async () => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/pending-purchases`);
      if (!res.ok) return [];
      return res.json() as Promise<PendingPurchase[]>;
    },
  });

  const respond = useMutation({
    mutationFn: async ({ id, action }: { id: number; action: "approve" | "decline" }) => {
      const token = await getToken();
      const res = await authFetch(token, `${API}/kotc/pending-purchases/${id}/${action}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to respond to purchase request");
      return data as { ok: boolean; checkoutUrl?: string };
    },
    onSuccess: (data, variables) => {
      qc.invalidateQueries({ queryKey: ["kotc-pending-purchases"] });
      if (variables.action === "approve") {
        toast({ title: "Purchase approved", description: "Opening checkout to complete payment…" });
        if (data.checkoutUrl) window.open(data.checkoutUrl, "_blank");
      } else {
        toast({ title: "Purchase declined" });
      }
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Layout>
      <div className="max-w-lg mx-auto px-4 py-6 space-y-5">
        <div className="flex items-center gap-2">
          <Crown className="h-6 w-6 text-amber-400" />
          <h1 className="text-2xl font-bold text-foreground">Kings of the Court — Approvals</h1>
        </div>
        <p className="text-sm text-muted-foreground -mt-3">
          Life pack purchase requests from your player, waiting on your approval.
        </p>

        {isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        )}

        {!isLoading && pending.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center space-y-2">
              <Heart className="h-8 w-8 text-muted-foreground/40 mx-auto" />
              <p className="text-muted-foreground font-medium">No pending requests</p>
              <p className="text-sm text-muted-foreground">
                You'll see any life pack purchase requests here that need your approval.
              </p>
            </CardContent>
          </Card>
        )}

        {pending.map((p) => (
          <Card key={p.id} className="border-amber-500/20">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div
                    className="w-9 h-9 rounded-full border-2 flex-shrink-0"
                    style={{ backgroundColor: (p.teamColor ?? "#888") + "40", borderColor: (p.teamColor ?? "#888") + "80" }}
                  />
                  <div>
                    <p className="font-semibold text-sm text-foreground">{p.teamName ?? "Team"}</p>
                    <p className="text-xs text-muted-foreground">{p.seasonName ?? "Kings of the Court"}</p>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground flex items-center gap-1 flex-shrink-0">
                  <Clock className="h-3 w-3" />
                  {formatDistanceToNow(new Date(p.createdAt), { addSuffix: true })}
                </span>
              </div>

              <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Heart className="h-4 w-4 text-red-400" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">{p.packName}</p>
                    <p className="text-xs text-muted-foreground">{p.packLives} lives</p>
                  </div>
                </div>
                <p className="text-lg font-bold text-amber-500">${(p.packPriceCents / 100).toFixed(2)}</p>
              </div>

              {p.expiresAt && (
                <p className="text-[11px] text-muted-foreground">
                  Expires {formatDistanceToNow(new Date(p.expiresAt), { addSuffix: true })}
                </p>
              )}

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1 gap-1.5 text-red-500 border-red-500/30 hover:bg-red-500/10"
                  disabled={respond.isPending}
                  onClick={() => respond.mutate({ id: p.id, action: "decline" })}
                >
                  <X className="h-4 w-4" />
                  Decline
                </Button>
                <Button
                  className="flex-1 gap-1.5 bg-green-600 hover:bg-green-700 text-white"
                  disabled={respond.isPending}
                  onClick={() => respond.mutate({ id: p.id, action: "approve" })}
                >
                  <Check className="h-4 w-4" />
                  Approve & Pay
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}

        {pending.length > 0 && (
          <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1">
            <ExternalLink className="h-3 w-3" />
            Approving opens Stripe checkout in a new tab to complete payment.
          </p>
        )}
      </div>
    </Layout>
  );
}
