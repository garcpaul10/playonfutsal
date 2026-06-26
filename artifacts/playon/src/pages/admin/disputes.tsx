import { API_BASE } from "@/lib/api-base";
import React, { useState } from "react";
import { Redirect } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { format } from "date-fns";
import { AlertTriangle, ExternalLink, ShieldAlert } from "lucide-react";

function fmt(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

interface DisputeRow {
  id: number;
  userId: number | null;
  entityType: string;
  entityId: number;
  amount: string;
  currency: string;
  status: string;
  providerChargeId: string | null;
  disputeStatus: string;
  disputedAt: string | null;
  createdAt: string;
  userName: string | null;
  userEmail: string | null;
}

type FilterStatus = "all" | "open" | "won" | "lost";

const OPEN_STATUSES = new Set(["needs_response", "under_review", "warning_needs_response", "warning_under_review"]);

function disputeStatusBadge(status: string) {
  if (status === "won") return <Badge className="bg-green-100 text-green-800 border-0">Won</Badge>;
  if (status === "lost") return <Badge className="bg-red-100 text-red-800 border-0">Lost</Badge>;
  if (status === "warning_closed") return <Badge className="bg-gray-100 text-gray-700 border-0">Warning Closed</Badge>;
  if (status === "needs_response") return <Badge className="bg-amber-100 text-amber-800 border-0">Needs Response</Badge>;
  if (status === "under_review") return <Badge className="bg-blue-100 text-blue-800 border-0">Under Review</Badge>;
  if (status === "warning_needs_response") return <Badge className="bg-amber-100 text-amber-800 border-0">Warning — Needs Response</Badge>;
  if (status === "warning_under_review") return <Badge className="bg-blue-100 text-blue-800 border-0">Warning — Under Review</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

export default function AdminDisputes() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { getToken } = useAuth();
  const [filter, setFilter] = useState<FilterStatus>("all");

  const { data: disputes, isLoading } = useQuery<DisputeRow[]>({
    queryKey: ["admin-disputes"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/disputes?limit=200`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load disputes");
      return res.json();
    },
  });

  if (profileLoading) return <Layout><div className="p-12"><Skeleton className="h-96" /></div></Layout>;
  const canView =
    profile?.role === "admin" ||
    profile?.role === "staff" ||
    profile?.adminLevel === "super" ||
    profile?.adminLevel === "admin";
  if (!canView) return <Redirect to="/dashboard" />;

  const filtered = (disputes ?? []).filter((d) => {
    if (filter === "open") return OPEN_STATUSES.has(d.disputeStatus);
    if (filter === "won") return d.disputeStatus === "won";
    if (filter === "lost") return d.disputeStatus === "lost";
    return true;
  });

  const openCount = (disputes ?? []).filter((d) => OPEN_STATUSES.has(d.disputeStatus)).length;
  const wonCount = (disputes ?? []).filter((d) => d.disputeStatus === "won").length;
  const lostCount = (disputes ?? []).filter((d) => d.disputeStatus === "lost").length;
  const lostTotal = (disputes ?? [])
    .filter((d) => d.disputeStatus === "lost")
    .reduce((sum, d) => sum + Number(d.amount), 0);

  const FILTER_TABS: { key: FilterStatus; label: string }[] = [
    { key: "all", label: `All (${(disputes ?? []).length})` },
    { key: "open", label: `Open (${openCount})` },
    { key: "won", label: `Won (${wonCount})` },
    { key: "lost", label: `Lost (${lostCount})` },
  ];

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12">
        <a href="/admin" className="text-sm text-muted-foreground hover:text-foreground mb-4 block">
          ← Admin
        </a>
        <div className="flex items-center gap-3 mb-2">
          <ShieldAlert className="w-8 h-8 text-rose-500" />
          <h1 className="text-4xl font-bold font-sans uppercase tracking-tight text-primary">
            Disputes
          </h1>
          {openCount > 0 && (
            <Badge className="bg-rose-500 text-white text-sm px-2 py-0.5">{openCount} open</Badge>
          )}
        </div>
        <p className="text-muted-foreground mb-8">
          Stripe chargebacks and disputes on player payments. Submit evidence directly in the{" "}
          <a
            href="https://dashboard.stripe.com/disputes"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            Stripe Dashboard
          </a>
          .
        </p>

        {openCount > 0 && (
          <div className="flex items-start gap-3 p-4 mb-6 rounded-lg border border-amber-200 bg-amber-50 text-amber-900">
            <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0 text-amber-600" />
            <div>
              <p className="font-medium">
                {openCount} dispute{openCount !== 1 ? "s" : ""} require attention
              </p>
              <p className="text-sm text-amber-700 mt-1">
                Stripe typically requires a response within 7–21 days. Visit the Stripe Dashboard
                to submit evidence and avoid losing these disputes.
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm text-muted-foreground">Open / Needs Response</CardTitle>
            </CardHeader>
            <CardContent>
              <p className={`text-2xl font-bold ${openCount > 0 ? "text-amber-600" : "text-gray-500"}`}>
                {openCount}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm text-muted-foreground">Disputes Won</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-green-600">{wonCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm text-muted-foreground">Disputes Lost</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-red-500">{lostCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm text-muted-foreground">Total Lost Amount</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-red-500">{fmt(lostTotal)}</p>
            </CardContent>
          </Card>
        </div>

        <div className="flex gap-1 mb-4 border-b">
          {FILTER_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                filter === t.key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8">
                <Skeleton className="h-48" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                <ShieldAlert className="w-12 h-12 mx-auto mb-4 opacity-20" />
                <p className="text-lg font-medium">No disputes found</p>
                <p className="text-sm mt-1">
                  {filter === "open"
                    ? "No open disputes — you're all clear."
                    : "No disputes match this filter."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground bg-muted/30">
                      <th className="px-4 py-3 text-left">Player</th>
                      <th className="px-4 py-3 text-left">Offering</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                      <th className="px-4 py-3 text-left">Opened</th>
                      <th className="px-4 py-3 text-left">Dispute Status</th>
                      <th className="px-4 py-3 text-left">Stripe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((d) => (
                      <tr key={d.id} className="border-b last:border-0 hover:bg-muted/20">
                        <td className="px-4 py-3">
                          <p className="font-medium">{d.userName ?? "—"}</p>
                          {d.userEmail && (
                            <p className="text-xs text-muted-foreground">{d.userEmail}</p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className="text-xs capitalize">
                            {d.entityType.replace(/_/g, " ")}
                          </Badge>
                          <span className="ml-2 text-muted-foreground text-xs">#{d.entityId}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-medium">
                          {fmt(Number(d.amount))}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {d.disputedAt
                            ? format(new Date(d.disputedAt), "MMM d, yyyy")
                            : "—"}
                        </td>
                        <td className="px-4 py-3">{disputeStatusBadge(d.disputeStatus)}</td>
                        <td className="px-4 py-3">
                          {d.providerChargeId ? (
                            <Button variant="ghost" size="sm" asChild className="gap-1 h-7 px-2">
                              <a
                                href={`https://dashboard.stripe.com/charges/${d.providerChargeId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <ExternalLink className="w-3 h-3" />
                                View
                              </a>
                            </Button>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
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
    </Layout>
  );
}
