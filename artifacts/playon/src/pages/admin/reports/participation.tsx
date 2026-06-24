import React, { useState } from "react";
import { Redirect } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { useAuth } from "@clerk/react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend } from "recharts";
import { Users, Trophy, Calendar, Activity } from "lucide-react";

const TYPE_COLORS: Record<string, string> = {
  league: "var(--brand-crimson-700)",
  camp: "#0ea5e9",
  drop_in: "#22c55e",
  tournament: "#f59e0b",
};

const TYPE_LABELS: Record<string, string> = {
  league: "League",
  camp: "Camp",
  drop_in: "Drop-in",
  tournament: "Tournament",
};

export default function ParticipationReport() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { getToken } = useAuth();

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offeringType, setOfferingType] = useState("");

  const { data, isLoading } = useQuery<any>({
    queryKey: ["admin-report-participation", from, to, offeringType],
    queryFn: async () => {
      const token = await getToken();
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (offeringType) params.set("type", offeringType);
      const res = await fetch(`/api/admin/reports/participation?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !profileLoading && (profile?.role === "admin" || profile?.role === "staff" || profile?.adminLevel === "super" || profile?.adminLevel === "admin"),
  });

  if (profileLoading) return <Layout><div className="p-12"><Skeleton className="h-96" /></div></Layout>;
  if (!profile || (profile.role !== "admin" && profile.role !== "staff" && profile.adminLevel !== "super" && profile.adminLevel !== "admin")) return <Redirect to="/dashboard" />;

  const total = data?.total ?? 0;
  const byType = data?.byType ?? {};
  const byAgeGroup = data?.byAgeGroup ?? {};
  const monthlyData = data?.monthlyData ?? [];

  const types = ["league", "camp", "drop_in", "tournament"];
  const ageGroups = Object.entries(byAgeGroup as Record<string, number>).sort((a, b) => b[1] - a[1]);

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12">
        <a href="/admin" className="text-sm text-muted-foreground hover:text-foreground mb-4 block">← Admin</a>
        <h1 className="text-4xl font-bold font-sans uppercase tracking-tight text-primary mb-2">Participation Report</h1>
        <p className="text-muted-foreground mb-8">Registrations over time by offering type and age group.</p>

        <Card className="mb-6">
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label>Offering Type</Label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={offeringType}
                  onChange={e => setOfferingType(e.target.value)}
                >
                  <option value="">All types</option>
                  <option value="league">Leagues</option>
                  <option value="camp">Camps</option>
                  <option value="drop_in">Drop-ins</option>
                  <option value="tournament">Tournaments</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label>From</Label>
                <Input type="date" value={from} onChange={e => setFrom(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>To</Label>
                <Input type="date" value={to} onChange={e => setTo(e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="space-y-4">{[1,2,3].map(i => <Skeleton key={i} className="h-40" />)}</div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <Card>
                <CardHeader className="pb-1 flex flex-row items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-sm text-muted-foreground">Total Registrations</CardTitle>
                </CardHeader>
                <CardContent><p className="text-3xl font-bold">{total}</p></CardContent>
              </Card>
              {types.map(t => (
                <Card key={t}>
                  <CardHeader className="pb-1">
                    <CardTitle className="text-sm text-muted-foreground">{TYPE_LABELS[t]}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold" style={{ color: TYPE_COLORS[t] }}>{byType[t] ?? 0}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card className="mb-8">
              <CardHeader>
                <CardTitle>Registrations Over Time</CardTitle>
              </CardHeader>
              <CardContent>
                {monthlyData.length === 0 ? (
                  <p className="text-muted-foreground text-sm py-8 text-center">No data for the selected filters.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={monthlyData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} className="text-muted-foreground" />
                      <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }}
                        labelStyle={{ color: "hsl(var(--foreground))" }}
                      />
                      <Legend />
                      {types.map(t => (
                        <Bar key={t} dataKey={t} name={TYPE_LABELS[t]} stackId="a" fill={TYPE_COLORS[t]} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <Card>
                <CardHeader><CardTitle>By Offering Type</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {types.map(t => (
                      <div key={t} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: TYPE_COLORS[t] }} />
                          <span className="text-sm">{TYPE_LABELS[t]}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{byType[t] ?? 0}</span>
                          <Badge variant="secondary" className="text-xs">
                            {total > 0 ? Math.round(((byType[t] ?? 0) / total) * 100) : 0}%
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>By Age Group</CardTitle></CardHeader>
                <CardContent>
                  {ageGroups.length === 0 ? (
                    <p className="text-muted-foreground text-sm">No data.</p>
                  ) : (
                    <div className="space-y-3">
                      {ageGroups.map(([ag, count]) => (
                        <div key={ag} className="flex items-center justify-between">
                          <span className="text-sm uppercase font-medium">{ag.replace("_", "-")}</span>
                          <div className="flex items-center gap-2">
                            <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-primary rounded-full"
                                style={{ width: `${total > 0 ? (count / total) * 100 : 0}%` }}
                              />
                            </div>
                            <span className="font-semibold w-10 text-right">{count}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
