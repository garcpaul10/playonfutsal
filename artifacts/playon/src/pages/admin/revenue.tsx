import { API_BASE } from "@/lib/api-base";
import React, { useState } from "react";
import { Redirect } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { format } from "date-fns";
import { Crown, Users, TrendingUp } from "lucide-react";

interface RevenueRecord {
  id: number;
  entityType: string;
  entityId: number | null;
  splitRuleId: number | null;
  category: string;
  grossAmount: string;
  facilityAmount: string;
  serviceFeeAmount: string;
  playonNet: string;
  revenueDate: string;
  description: string | null;
  ruleTier: "event" | "venue" | null;
  ruleName: string | null;
  ruleOfferingType: string | null;
  ruleOfferingId: number | null;
}

interface RevenueOverview {
  records: RevenueRecord[];
  totals: {
    grossAmount: number;
    facilityAmount: number;
    serviceFeeAmount: number;
    playonNet: number;
  };
}

function fmt(n: number) { return n.toLocaleString("en-US", { style: "currency", currency: "USD" }); }

export default function AdminRevenue() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { getToken } = useAuth();

  const [category, setCategory] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data, isLoading } = useQuery<RevenueOverview>({
    queryKey: ["revenue", category, from, to],
    queryFn: async () => {
      const token = await getToken();
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await fetch(`${API_BASE}/admin/revenue?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: activeMemberships } = useQuery<any[]>({
    queryKey: ["admin-memberships-active"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/memberships?status=active`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 60000,
  });

  const { data: membershipPlans } = useQuery<any[]>({
    queryKey: ["membership-plans"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/membership-plans`);
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 60000,
  });

  const canView = profile?.role === "admin" || profile?.role === "staff" || profile?.adminLevel === "super" || profile?.adminLevel === "admin";

  if (profileLoading) return <Layout><div className="p-12"><Skeleton className="h-96" /></div></Layout>;
  if (!canView) return <Redirect to="/dashboard" />;

  const totals = data?.totals;

  const activeMemberCount = activeMemberships?.length ?? 0;
  const planPriceMap = new Map<number, number>(
    (membershipPlans ?? []).map((p: any) => [p.id, Number(p.price ?? 0)])
  );
  const estimatedMrr = (activeMemberships ?? []).reduce((sum: number, m: any) => {
    const price = planPriceMap.get(m.planId) ?? 0;
    return sum + price;
  }, 0);

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12">
        <a href="/admin" className="text-sm text-muted-foreground hover:text-foreground mb-4 block">← Admin</a>
        <h1 className="text-4xl font-bold font-sans uppercase tracking-tight text-primary mb-2">Revenue Overview</h1>
        <p className="text-muted-foreground mb-8">Gross revenue, facility cut, and PlayOn net per offering. Updated on every payment.</p>

        {/* Membership Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <Card className="border-amber-500/30">
            <CardHeader className="pb-1 flex flex-row items-center gap-2">
              <Crown className="h-4 w-4 text-amber-500" />
              <CardTitle className="text-sm text-muted-foreground">Active Members</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-amber-500">{activeMemberCount}</p>
              <p className="text-xs text-muted-foreground mt-1">Current active memberships</p>
            </CardContent>
          </Card>
          <Card className="border-amber-500/30">
            <CardHeader className="pb-1 flex flex-row items-center gap-2">
              <TrendingUp className="h-4 w-4 text-amber-500" />
              <CardTitle className="text-sm text-muted-foreground">Est. MRR</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-amber-500">{fmt(estimatedMrr)}</p>
              <p className="text-xs text-muted-foreground mt-1">Monthly recurring (active plans)</p>
            </CardContent>
          </Card>
          <Card className="border-amber-500/30">
            <CardHeader className="pb-1 flex flex-row items-center gap-2">
              <Users className="h-4 w-4 text-amber-500" />
              <CardTitle className="text-sm text-muted-foreground">Plans Available</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{membershipPlans?.length ?? 0}</p>
              <p className="text-xs text-muted-foreground mt-1">Membership tiers configured</p>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label>Category</Label>
                <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={category} onChange={e => setCategory(e.target.value)}>
                  <option value="">All categories</option>
                  <option value="drop_in">Drop-in</option>
                  <option value="camp">Camp</option>
                  <option value="league">League</option>
                  <option value="tournament">Tournament</option>
                </select>
              </div>
              <div className="space-y-1"><Label>From</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
              <div className="space-y-1"><Label>To</Label><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
            </div>
          </CardContent>
        </Card>

        {/* Totals */}
        {totals && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <Card>
              <CardHeader className="pb-1"><CardTitle className="text-sm text-muted-foreground">Gross Revenue</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold">{fmt(totals.grossAmount)}</p></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1"><CardTitle className="text-sm text-muted-foreground">Facility Cut</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold text-amber-500">{fmt(totals.facilityAmount)}</p></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1"><CardTitle className="text-sm text-muted-foreground">Service Fees</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold text-blue-500">{fmt(totals.serviceFeeAmount)}</p></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1"><CardTitle className="text-sm text-muted-foreground">PlayOn Net</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold text-green-500">{fmt(totals.playonNet)}</p></CardContent>
            </Card>
          </div>
        )}

        {/* Records table */}
        {isLoading ? (
          <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-14" />)}</div>
        ) : !data?.records.length ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No revenue records found. Records are created automatically when payments are processed.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="px-4 py-3 text-left">Date</th>
                      <th className="px-4 py-3 text-left">Category</th>
                      <th className="px-4 py-3 text-left">Description</th>
                      <th className="px-4 py-3 text-left">Rule</th>
                      <th className="px-4 py-3 text-right">Gross</th>
                      <th className="px-4 py-3 text-right">Facility</th>
                      <th className="px-4 py-3 text-right">Svc Fee</th>
                      <th className="px-4 py-3 text-right font-semibold">PlayOn Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.records.map(r => (
                      <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-3 whitespace-nowrap">{format(new Date(r.revenueDate), "MMM d, yyyy")}</td>
                        <td className="px-4 py-3"><Badge variant="outline" className="text-xs">{r.category}</Badge></td>
                        <td className="px-4 py-3 text-muted-foreground">{r.description ?? `${r.entityType} #${r.entityId}`}</td>
                        <td className="px-4 py-3">
                          {r.ruleTier === "event" ? (
                            <Badge className="text-xs bg-blue-600" title={r.ruleName ?? undefined}>Event Override</Badge>
                          ) : r.ruleTier === "venue" ? (
                            <Badge variant="secondary" className="text-xs" title={r.ruleName ?? undefined}>Venue Default</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground/50">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">{fmt(Number(r.grossAmount))}</td>
                        <td className="px-4 py-3 text-right text-amber-500">{fmt(Number(r.facilityAmount))}</td>
                        <td className="px-4 py-3 text-right text-blue-500">{fmt(Number(r.serviceFeeAmount))}</td>
                        <td className="px-4 py-3 text-right font-semibold text-green-500">{fmt(Number(r.playonNet))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
