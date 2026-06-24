import React, { useState } from "react";
import { Redirect } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { useAuth } from "@clerk/react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Gift, Settings, CheckCircle2, Clock, Users, DollarSign } from "lucide-react";
import { format } from "date-fns";

function fmt(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default function AdminReferrals() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { getToken } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [editReward, setEditReward] = useState("");
  const [editEnabled, setEditEnabled] = useState<boolean | null>(null);

  const { data: referrals, isLoading: refsLoading } = useQuery<any[]>({
    queryKey: ["admin-referrals"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/admin/referrals", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: profile?.role === "admin" || profile?.role === "staff" || profile?.adminLevel === "super" || profile?.adminLevel === "admin",
  });

  const { data: config, isLoading: configLoading } = useQuery<any>({
    queryKey: ["admin-referrals-config"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/admin/referrals/config", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: profile?.role === "admin" || profile?.adminLevel === "super" || profile?.adminLevel === "admin",
  });

  const configMutation = useMutation({
    mutationFn: async (body: { rewardCreditCents?: number; isEnabled?: boolean }) => {
      const token = await getToken();
      const res = await fetch("/api/admin/referrals/config", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-referrals-config"] });
      toast({ title: "Config saved" });
    },
    onError: () => toast({ title: "Error", description: "Failed to save config.", variant: "destructive" }),
  });

  if (profileLoading) return <Layout><div className="p-12"><Skeleton className="h-96" /></div></Layout>;
  if (!profile || (profile.role !== "admin" && profile.role !== "staff" && profile.adminLevel !== "super" && profile.adminLevel !== "admin")) return <Redirect to="/dashboard" />;

  const completed = referrals?.filter(r => r.status === "completed") ?? [];
  const pending = referrals?.filter(r => r.status === "pending") ?? [];
  const totalRewardCents = completed.reduce((s: number, r: any) => s + (r.rewardCreditCents ?? 0), 0);

  function saveConfig() {
    const body: any = {};
    const cents = parseInt(editReward);
    if (!isNaN(cents) && cents > 0) body.rewardCreditCents = cents;
    if (editEnabled !== null) body.isEnabled = editEnabled;
    if (Object.keys(body).length) configMutation.mutate(body);
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12">
        <a href="/admin" className="text-sm text-muted-foreground hover:text-foreground mb-4 block">← Admin</a>
        <h1 className="text-4xl font-bold font-sans uppercase tracking-tight text-primary mb-2">Referral Program</h1>
        <p className="text-muted-foreground mb-8">Manage referral codes, view attribution, and configure rewards.</p>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardHeader className="pb-1 flex flex-row items-center gap-2">
              <Gift className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm text-muted-foreground">Total Codes</CardTitle>
            </CardHeader>
            <CardContent><p className="text-2xl font-bold">{referrals?.length ?? "—"}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1 flex flex-row items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <CardTitle className="text-sm text-muted-foreground">Completed</CardTitle>
            </CardHeader>
            <CardContent><p className="text-2xl font-bold text-green-500">{completed.length}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1 flex flex-row items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm text-muted-foreground">Pending</CardTitle>
            </CardHeader>
            <CardContent><p className="text-2xl font-bold">{pending.length}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1 flex flex-row items-center gap-2">
              <DollarSign className="h-4 w-4 text-amber-500" />
              <CardTitle className="text-sm text-muted-foreground">Credits Issued</CardTitle>
            </CardHeader>
            <CardContent><p className="text-2xl font-bold text-amber-500">{fmt(totalRewardCents)}</p></CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" /> All Referrals</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {refsLoading ? (
                  <div className="p-6 space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-10" />)}</div>
                ) : !referrals?.length ? (
                  <p className="text-muted-foreground text-sm p-6 text-center">No referrals yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-muted-foreground">
                          <th className="px-4 py-3 text-left">Code</th>
                          <th className="px-4 py-3 text-left">Referrer</th>
                          <th className="px-4 py-3 text-left">Status</th>
                          <th className="px-4 py-3 text-right">Reward</th>
                          <th className="px-4 py-3 text-left">Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {referrals?.map((r: any) => (
                          <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                            <td className="px-4 py-3 font-mono text-xs">{r.code}</td>
                            <td className="px-4 py-3 text-muted-foreground">{r.referrerEmail ?? `#${r.referrerId}`}</td>
                            <td className="px-4 py-3">
                              <Badge variant={r.status === "completed" ? "default" : "secondary"}>{r.status}</Badge>
                            </td>
                            <td className="px-4 py-3 text-right text-green-500">
                              {r.status === "completed" ? fmt(r.rewardCreditCents) : "—"}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                              {format(new Date(r.createdAt), "MMM d, yyyy")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {(profile.role === "admin" || profile.adminLevel === "super" || profile.adminLevel === "admin") && (
            <div>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Settings className="h-5 w-5" /> Configuration</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {configLoading ? (
                    <Skeleton className="h-24" />
                  ) : (
                    <>
                      <div className="space-y-1">
                        <Label>Current Reward</Label>
                        <p className="text-2xl font-bold text-primary">{fmt(config?.rewardCreditCents ?? 1000)}</p>
                        <p className="text-xs text-muted-foreground">Account credit per successful referral</p>
                      </div>
                      <div className="space-y-1">
                        <Label>Status</Label>
                        <Badge variant={config?.isEnabled ? "default" : "secondary"}>
                          {config?.isEnabled ? "Enabled" : "Disabled"}
                        </Badge>
                      </div>
                      <hr className="border-border" />
                      <div className="space-y-1">
                        <Label>New Reward (cents)</Label>
                        <Input
                          type="number"
                          placeholder={String(config?.rewardCreditCents ?? 1000)}
                          value={editReward}
                          onChange={e => setEditReward(e.target.value)}
                          min={0}
                        />
                        <p className="text-xs text-muted-foreground">1000 = $10.00</p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => { setEditEnabled(true); }}
                          className={editEnabled === true ? "border-primary text-primary" : ""}
                        >Enable</Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => { setEditEnabled(false); }}
                          className={editEnabled === false ? "border-destructive text-destructive" : ""}
                        >Disable</Button>
                      </div>
                      <Button className="w-full" onClick={saveConfig} disabled={configMutation.isPending}>
                        {configMutation.isPending ? "Saving…" : "Save Config"}
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
