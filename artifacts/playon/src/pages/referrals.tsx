import React from "react";
import { useAuth, Show } from "@clerk/react";
import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Gift, Copy, Users, CheckCircle2, Clock, Link2 } from "lucide-react";
import { format } from "date-fns";

function fmt(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default function ReferralsPage() {
  return (
    <Layout>
      <Show when="signed-out">
        <div className="container mx-auto px-4 py-24 text-center max-w-lg">
          <Gift className="h-14 w-14 text-primary mx-auto mb-6" />
          <h1 className="text-3xl font-bold uppercase tracking-tight mb-4">Refer &amp; Earn</h1>
          <p className="text-muted-foreground mb-8">
            Share PlayOn with friends and earn account credits when they sign up. Sign in to get your referral link.
          </p>
          <Button asChild size="lg" className="rounded-full px-8">
            <Link href="/sign-in">Sign In to Get Started</Link>
          </Button>
        </div>
      </Show>
      <Show when="signed-in">
        <ReferralHub />
      </Show>
    </Layout>
  );
}

function ReferralHub() {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<any>({
    queryKey: ["referrals-my"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/referrals/my", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load referrals");
      return res.json();
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/referrals/generate", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to generate code");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["referrals-my"] }),
    onError: () => toast({ title: "Error", description: "Could not generate referral link.", variant: "destructive" }),
  });

  function copyLink() {
    if (data?.link) {
      navigator.clipboard.writeText(data.link);
      toast({ title: "Copied!", description: "Referral link copied to clipboard." });
    }
  }

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-2xl">
        <Skeleton className="h-12 w-64 mb-4" />
        <Skeleton className="h-40 mb-4" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const disabled = data?.isEnabled === false;

  return (
    <div className="container mx-auto px-4 py-12 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-4xl font-bold uppercase tracking-tight mb-2">Refer &amp; Earn</h1>
        <p className="text-muted-foreground">
          Share PlayOn with friends. When they sign up using your link, you earn{" "}
          <span className="font-semibold text-foreground">{fmt(data?.rewardCreditCents ?? 1000)}</span> in account credit.
        </p>
      </div>

      {disabled ? (
        <Card className="mb-6 border-yellow-500/30">
          <CardContent className="py-6 text-center text-muted-foreground">
            The referral program is currently paused. Check back soon!
          </CardContent>
        </Card>
      ) : (
        <Card className="mb-8 border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="h-5 w-5 text-primary" />
              Your Referral Link
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data?.link ? (
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-background border border-input rounded-md px-3 py-2 text-sm font-mono truncate">
                  {data.link}
                </code>
                <Button variant="outline" size="sm" onClick={copyLink}>
                  <Copy className="h-4 w-4 mr-1" /> Copy
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-start gap-3">
                <p className="text-sm text-muted-foreground">You don't have a referral link yet.</p>
                <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
                  {generateMutation.isPending ? "Generating…" : "Generate My Link"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-4 mb-8">
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-3xl font-bold">{data?.referrals?.length ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-1">Links Shared</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-3xl font-bold text-green-500">{data?.completedCount ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-1">Completed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-3xl font-bold text-primary">
              {fmt((data?.completedCount ?? 0) * (data?.rewardCreditCents ?? 0))}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Credits Earned</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" /> Referral History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!data?.referrals?.length ? (
            <p className="text-muted-foreground text-sm py-4 text-center">
              No referrals yet. Share your link to get started!
            </p>
          ) : (
            <div className="space-y-3">
              {data.referrals.map((r: any) => (
                <div key={r.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div className="flex items-center gap-3">
                    <code className="text-xs bg-muted px-2 py-1 rounded font-mono">{r.code}</code>
                    {r.status === "completed" ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <Clock className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="text-sm text-muted-foreground">
                      {format(new Date(r.createdAt), "MMM d, yyyy")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.status === "completed" && (
                      <span className="text-sm font-semibold text-green-500">+{fmt(r.rewardCreditCents)}</span>
                    )}
                    <Badge variant={r.status === "completed" ? "default" : "secondary"}>
                      {r.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-8 bg-muted/40 rounded-xl p-6">
        <h3 className="font-semibold mb-3">How it works</h3>
        <ol className="space-y-2 text-sm text-muted-foreground list-none">
          <li className="flex gap-3"><span className="text-primary font-bold">1.</span> Generate your unique referral link above.</li>
          <li className="flex gap-3"><span className="text-primary font-bold">2.</span> Share it with friends, teammates, or anyone interested in futsal.</li>
          <li className="flex gap-3"><span className="text-primary font-bold">3.</span> When they sign up and claim your code, you automatically receive {fmt(data?.rewardCreditCents ?? 1000)} in account credit.</li>
          <li className="flex gap-3"><span className="text-primary font-bold">4.</span> Credits apply automatically toward your next registration.</li>
        </ol>
      </div>
    </div>
  );
}
