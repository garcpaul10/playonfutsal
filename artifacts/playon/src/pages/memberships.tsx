import { API_BASE } from "@/lib/api-base";
import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Crown, CheckCircle2, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { InlinePaymentDialog } from "@/components/inline-payment-dialog";


export default function MembershipsPage() {
  const { isSignedIn } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [paymentData, setPaymentData] = useState<{ clientSecret: string; publishableKey: string; amount: number } | null>(null);

  const { data: plans = [], isLoading: plansLoading } = useQuery({
    queryKey: ["membership-plans"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/membership-plans`);
      if (!r.ok) return [];
      return r.json();
    },
  });

  const { data: myMembership } = useQuery({
    queryKey: ["memberships", "my"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/memberships/my`, { credentials: "include" });
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!isSignedIn,
  });

  const subscribe = useMutation({
    mutationFn: async (planId: number) => {
      const r = await fetch(`${API_BASE}/memberships/subscribe`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Failed to start checkout");
      return r.json();
    },
    onSuccess: (data) => {
      if (data.clientSecret) {
        setPaymentData({ clientSecret: data.clientSecret, publishableKey: data.publishableKey, amount: data.amount });
      } else {
        toast({ title: "Membership activated!", description: "You're now a member." });
        window.location.href = "/profile";
      }
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  function handlePaymentSuccess() {
    setPaymentData(null);
    qc.invalidateQueries({ queryKey: ["memberships", "my"] });
    toast({ title: "Membership activated!", description: "You're now a member. Welcome!" });
    setTimeout(() => { window.location.href = "/profile"; }, 1200);
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <div className="text-center mb-10">
          <div className="flex justify-center mb-4">
            <Crown className="h-12 w-12 text-amber-500" />
          </div>
          <h1 className="text-4xl font-bold font-sans uppercase tracking-tight mb-3">
            PlayOn Membership
          </h1>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto">
            Join as a member to unlock exclusive pricing on leagues, drop-ins, camps, and more.
          </p>
        </div>

        {/* Current membership status */}
        {myMembership && (
          <div className="mb-8 p-4 rounded-xl border border-amber-200 bg-amber-50 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Crown className="h-5 w-5 text-amber-500" />
              <div>
                <span className="font-semibold">You're an active {myMembership.plan?.name ?? "member"}</span>
                <Badge className="ml-2 bg-amber-100 text-amber-800 border-amber-300 text-xs">
                  <CheckCircle2 className="h-3 w-3 mr-1" />Active
                </Badge>
              </div>
            </div>
            <Button variant="outline" size="sm" asChild>
              <a href="/profile">Manage</a>
            </Button>
          </div>
        )}

        {plansLoading ? (
          <div className="grid gap-6 md:grid-cols-2">
            <Skeleton className="h-64 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        ) : plans.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              No membership plans are available at this time. Check back soon!
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            {plans.map((plan: any, i: number) => {
              const isCurrentPlan = myMembership?.planId === plan.id;
              const isPopular = i === 0 && plans.length > 1;
              return (
                <Card
                  key={plan.id}
                  className={[
                    "relative flex flex-col",
                    isPopular ? "border-primary shadow-md" : "",
                    isCurrentPlan ? "border-amber-400" : "",
                  ].join(" ")}
                >
                  {isPopular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <Badge className="bg-primary text-primary-foreground px-3">
                        <Zap className="h-3 w-3 mr-1" />Most Popular
                      </Badge>
                    </div>
                  )}
                  {isCurrentPlan && (
                    <div className="absolute -top-3 right-4">
                      <Badge className="bg-amber-500 text-white px-3">
                        <CheckCircle2 className="h-3 w-3 mr-1" />Your Plan
                      </Badge>
                    </div>
                  )}
                  <CardHeader className="pb-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2 text-xl">
                          <Crown className="h-5 w-5 text-amber-500" />
                          {plan.name}
                        </CardTitle>
                        {plan.description && (
                          <CardDescription className="mt-1">{plan.description}</CardDescription>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-3xl font-bold">${Number(plan.price).toFixed(2)}</div>
                        <div className="text-sm text-muted-foreground">/{plan.billingCycle}</div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-col flex-1 gap-4">
                    {plan.features?.length > 0 && (
                      <ul className="space-y-2 flex-1">
                        {plan.features.map((f: string, fi: number) => (
                          <li key={fi} className="flex items-start gap-2 text-sm">
                            <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {plan.trialDays > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Includes a {plan.trialDays}-day free trial
                      </p>
                    )}
                    {isCurrentPlan ? (
                      <Button disabled className="w-full">
                        <CheckCircle2 className="h-4 w-4 mr-2" />Current Plan
                      </Button>
                    ) : !isSignedIn ? (
                      <Button className="w-full" asChild>
                        <a href="/sign-in">Sign In to Subscribe</a>
                      </Button>
                    ) : (
                      <Button
                        className="w-full"
                        onClick={() => subscribe.mutate(plan.id)}
                        disabled={subscribe.isPending || !!myMembership}
                      >
                        {subscribe.isPending ? "Starting…" : myMembership ? "Already a Member" : "Get Started"}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground mt-8">
          Memberships renew automatically. Cancel anytime from your profile.
        </p>
      </div>

      {paymentData && (
        <InlinePaymentDialog
          open={!!paymentData}
          clientSecret={paymentData.clientSecret}
          publishableKey={paymentData.publishableKey}
          amount={paymentData.amount}
          title="Activate Your Membership"
          label={`Subscribe — $${Number(paymentData.amount).toFixed(2)}`}
          onSuccess={handlePaymentSuccess}
          onCancel={() => setPaymentData(null)}
        />
      )}
    </Layout>
  );
}
