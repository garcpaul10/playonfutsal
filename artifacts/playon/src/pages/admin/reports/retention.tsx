import { API_BASE } from "@/lib/api-base";
import React from "react";
import { Redirect } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { useAuth } from "@clerk/react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend } from "recharts";
import { Users, UserPlus, RefreshCw, TrendingUp } from "lucide-react";

export default function RetentionReport() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { getToken } = useAuth();

  const { data, isLoading } = useQuery<any>({
    queryKey: ["admin-report-retention"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/reports/retention`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !profileLoading && (profile?.role === "admin" || profile?.role === "staff" || profile?.adminLevel === "super" || profile?.adminLevel === "admin"),
  });

  if (profileLoading) return <Layout><div className="p-12"><Skeleton className="h-96" /></div></Layout>;
  if (!profile || (profile.role !== "admin" && profile.role !== "staff" && profile.adminLevel !== "super" && profile.adminLevel !== "admin")) return <Redirect to="/dashboard" />;

  const seasons: any[] = data?.seasons ?? [];
  const summary = data?.summary;

  const avgRetention = seasons.length > 0
    ? Math.round(seasons.reduce((s: number, d: any) => s + d.retentionRate, 0) / seasons.length)
    : 0;

  const chartData = [...seasons].reverse().map((s: any) => ({
    name: s.seasonName?.length > 16 ? s.seasonName.slice(0, 14) + "…" : s.seasonName,
    "New Players": s.newPlayers,
    "Returning Players": s.returningPlayers,
    fullName: s.seasonName,
  }));

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12">
        <a href="/admin" className="text-sm text-muted-foreground hover:text-foreground mb-4 block">← Admin</a>
        <h1 className="text-4xl font-bold font-sans uppercase tracking-tight text-primary mb-2">Retention Report</h1>
        <p className="text-muted-foreground mb-8">New vs. returning players per season. Measure re-enrollment and loyalty.</p>

        {isLoading ? (
          <div className="space-y-4">{[1,2,3].map(i => <Skeleton key={i} className="h-40" />)}</div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <Card>
                <CardHeader className="pb-1 flex flex-row items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-sm text-muted-foreground">Total Users</CardTitle>
                </CardHeader>
                <CardContent><p className="text-3xl font-bold">{summary?.totalRegisteredUsers ?? 0}</p></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-1 flex flex-row items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  <CardTitle className="text-sm text-muted-foreground">Active Players</CardTitle>
                </CardHeader>
                <CardContent><p className="text-3xl font-bold text-primary">{summary?.totalActivePlayers ?? 0}</p></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-1 flex flex-row items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-green-500" />
                  <CardTitle className="text-sm text-muted-foreground">Avg. Retention</CardTitle>
                </CardHeader>
                <CardContent><p className="text-3xl font-bold text-green-500">{avgRetention}%</p></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-1 flex flex-row items-center gap-2">
                  <RefreshCw className="h-4 w-4 text-amber-500" />
                  <CardTitle className="text-sm text-muted-foreground">Seasons Tracked</CardTitle>
                </CardHeader>
                <CardContent><p className="text-3xl font-bold text-amber-500">{seasons.length}</p></CardContent>
              </Card>
            </div>

            <Card className="mb-8">
              <CardHeader>
                <CardTitle>New vs. Returning Players by Season</CardTitle>
              </CardHeader>
              <CardContent>
                {chartData.length === 0 ? (
                  <p className="text-muted-foreground text-sm py-8 text-center">
                    No season data. Seasons with date ranges will appear here once registrations exist.
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }}
                        labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? ""}
                      />
                      <Legend />
                      <Bar dataKey="New Players" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Returning Players" fill="var(--brand-crimson-700)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Season-by-Season Breakdown</CardTitle></CardHeader>
              <CardContent className="p-0">
                {seasons.length === 0 ? (
                  <p className="text-muted-foreground text-sm p-6">No seasons found.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-muted-foreground">
                          <th className="px-4 py-3 text-left">Season</th>
                          <th className="px-4 py-3 text-right">Total</th>
                          <th className="px-4 py-3 text-right">
                            <span className="flex items-center gap-1 justify-end"><UserPlus className="h-3 w-3" />New</span>
                          </th>
                          <th className="px-4 py-3 text-right">
                            <span className="flex items-center gap-1 justify-end"><RefreshCw className="h-3 w-3" />Returning</span>
                          </th>
                          <th className="px-4 py-3 text-right">Retention Rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {seasons.map((s: any) => (
                          <tr key={s.seasonId} className="border-b last:border-0 hover:bg-muted/30">
                            <td className="px-4 py-3 font-medium">{s.seasonName}</td>
                            <td className="px-4 py-3 text-right">{s.totalPlayers}</td>
                            <td className="px-4 py-3 text-right text-sky-500">{s.newPlayers}</td>
                            <td className="px-4 py-3 text-right text-primary">{s.returningPlayers}</td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center gap-2 justify-end">
                                <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-green-500 rounded-full"
                                    style={{ width: `${s.retentionRate}%` }}
                                  />
                                </div>
                                <span className={s.retentionRate >= 50 ? "text-green-500 font-semibold" : "text-muted-foreground"}>
                                  {s.retentionRate}%
                                </span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </Layout>
  );
}
