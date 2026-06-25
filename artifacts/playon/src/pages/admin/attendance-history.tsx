import React, { useState, useMemo } from "react";
import { Redirect } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { format } from "date-fns";
import {
  Users, CheckCircle2, XCircle, DollarSign, Download,
  ChevronUp, ChevronDown, ChevronsUpDown, BarChart3, Ban,
} from "lucide-react";

import { API_BASE as API } from "@/lib/api-base";

function useAuthHeaders() {
  const { getToken } = useAuth();
  return async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  };
}

const PAYMENT_LABELS: Record<string, string> = {
  unpaid: "Unpaid",
  paid_inapp: "Paid (app)",
  paid_external: "Paid (ext.)",
  refunded: "Refunded",
  waived: "Waived",
  paid: "Paid",
  partial: "Partial",
  unknown: "Unknown",
};

const PAYMENT_BADGE: Record<string, string> = {
  unpaid: "destructive",
  paid_inapp: "default",
  paid_external: "default",
  paid: "default",
  refunded: "secondary",
  waived: "secondary",
  partial: "outline",
  unknown: "outline",
};

type SortKey = "name" | "checkedInAt" | "method" | "paymentStatus" | "team";
type SortDir = "asc" | "desc";

function SortButton({
  col,
  current,
  dir,
  onSort,
  children,
}: {
  col: SortKey;
  current: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
  children: React.ReactNode;
}) {
  const active = col === current;
  return (
    <button
      className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground select-none"
      onClick={() => onSort(col)}
    >
      {children}
      {active ? (
        dir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
      ) : (
        <ChevronsUpDown className="h-3 w-3 opacity-40" />
      )}
    </button>
  );
}

function exportCsv(attendance: any[], sessionName: string, showTeam: boolean) {
  const headers = [
    "Player Name",
    "Email",
    showTeam ? "Team" : null,
    "Checked In",
    "Check-in Time",
    "Method",
    "Payment Status",
    "No-Show",
    "Voided",
    "Voided At",
    "Voided By",
  ].filter(Boolean) as string[];

  const rows = attendance.map((a) => [
    [a.firstName, a.lastName].filter(Boolean).join(" ") || `User #${a.userId}`,
    a.email ?? "",
    showTeam ? (a.teamName ?? "") : null,
    a.checkedIn ? "Yes" : "No",
    a.checkedInAt ? format(new Date(a.checkedInAt), "yyyy-MM-dd HH:mm:ss") : "",
    a.methodLabel ?? a.method ?? "",
    PAYMENT_LABELS[a.paymentStatus] ?? a.paymentStatus ?? "",
    a.noShow ? "Yes" : "No",
    a.voided ? "Yes" : "No",
    a.voidedAt ? format(new Date(a.voidedAt), "yyyy-MM-dd HH:mm:ss") : "",
    a.voidedByName ?? "",
  ].filter((v) => v !== null) as string[]);

  const csvContent = [headers, ...rows]
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csvContent], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `attendance-${sessionName.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

interface AttendanceHistoryPageProps {
  fetchUrl: string;
  queryKey: (string | number)[];
  backHref: string;
  backLabel: string;
}

export function AttendanceHistoryPage({
  fetchUrl,
  queryKey,
  backHref,
  backLabel,
}: AttendanceHistoryPageProps) {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const getHeaders = useAuthHeaders();
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filterCheckedIn, setFilterCheckedIn] = useState<"all" | "checked" | "no-show" | "voided">("all");

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}${fetchUrl}`, { headers });
      if (!r.ok) throw new Error("Failed to load attendance data");
      return r.json();
    },
    staleTime: 30000,
  });

  function handleSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  }

  const showTeam = data?.attendance?.some((a: any) => a.teamName);
  const hasVoided = data?.attendance?.some((a: any) => a.voided);

  const sorted = useMemo(() => {
    if (!data?.attendance) return [];
    let arr = [...data.attendance];

    if (filterCheckedIn === "checked") arr = arr.filter((a: any) => a.checkedIn);
    else if (filterCheckedIn === "no-show") arr = arr.filter((a: any) => !a.checkedIn && !a.voided);
    else if (filterCheckedIn === "voided") arr = arr.filter((a: any) => a.voided);

    arr.sort((a: any, b: any) => {
      let va: string, vb: string;
      switch (sortKey) {
        case "name":
          va = [a.firstName, a.lastName].filter(Boolean).join(" ").toLowerCase();
          vb = [b.firstName, b.lastName].filter(Boolean).join(" ").toLowerCase();
          break;
        case "checkedInAt":
          va = a.checkedInAt ?? "";
          vb = b.checkedInAt ?? "";
          break;
        case "method":
          va = a.methodLabel ?? "";
          vb = b.methodLabel ?? "";
          break;
        case "paymentStatus":
          va = a.paymentStatus ?? "";
          vb = b.paymentStatus ?? "";
          break;
        case "team":
          va = a.teamName ?? "";
          vb = b.teamName ?? "";
          break;
        default:
          va = vb = "";
      }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [data?.attendance, sortKey, sortDir, filterCheckedIn]);

  if (profileLoading) return <Layout><div className="p-12"><Skeleton className="h-96" /></div></Layout>;
  if (profile?.role !== "admin" && profile?.role !== "staff" && profile?.adminLevel !== "super" && profile?.adminLevel !== "admin") return <Redirect to="/dashboard" />;

  const session = data?.session;
  const stats = data?.stats;

  return (
    <Layout>
      <div className="container mx-auto px-4 py-6 max-w-4xl">
        <div className="mb-5 flex items-center gap-2 text-sm">
          <a href={backHref} className="text-muted-foreground hover:text-foreground">{backLabel}</a>
          <span className="text-muted-foreground">/</span>
          <span className="font-medium">Attendance History</span>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
          </div>
        ) : !session ? (
          <div className="text-center py-16 text-muted-foreground">Session not found</div>
        ) : (
          <>
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold font-sans uppercase tracking-tight text-primary">
                  {session.name}
                </h1>
                {session.startsAt && (
                  <p className="text-muted-foreground text-sm mt-1">
                    {format(new Date(session.startsAt), "EEE, MMM d, yyyy · h:mm a")}
                  </p>
                )}
                {session.campName && session.date && (
                  <p className="text-muted-foreground text-sm mt-0.5">{session.campName}</p>
                )}
                {session.tournamentName && (
                  <p className="text-muted-foreground text-sm mt-0.5">{session.tournamentName}</p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Badge variant="outline" className="text-xs flex items-center gap-1">
                  <BarChart3 className="h-3 w-3" /> Attendance Report
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => exportCsv(data.attendance, session.name, showTeam)}
                >
                  <Download className="h-4 w-4 mr-1" /> Export CSV
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <Card>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Registered</span>
                  </div>
                  <div className="text-2xl font-bold">{stats?.totalRegistered ?? 0}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Attended</span>
                  </div>
                  <div className="text-2xl font-bold text-green-500">{stats?.totalCheckedIn ?? 0}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <XCircle className="h-4 w-4 text-red-400" />
                    <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">No-shows</span>
                  </div>
                  <div className="text-2xl font-bold text-red-400">{stats?.noShows ?? 0}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <DollarSign className="h-4 w-4 text-amber-400" />
                    <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Unpaid</span>
                  </div>
                  <div className="text-2xl font-bold text-amber-400">{stats?.unpaid ?? 0}</div>
                </CardContent>
              </Card>
            </div>

            <div className="flex gap-1 mb-4 flex-wrap">
              {(["all", "checked", "no-show", ...(hasVoided ? ["voided"] : [])] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilterCheckedIn(f as any)}
                  className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${
                    filterCheckedIn === f
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/70"
                  }`}
                >
                  {f === "all" ? "All Players" : f === "checked" ? "Checked In" : f === "no-show" ? "No-Shows" : "Voided"}
                </button>
              ))}
              <span className="ml-auto text-xs text-muted-foreground self-center">
                {sorted.length} player{sorted.length !== 1 ? "s" : ""}
              </span>
            </div>

            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left px-4 py-3">
                        <SortButton col="name" current={sortKey} dir={sortDir} onSort={handleSort}>
                          Player
                        </SortButton>
                      </th>
                      {showTeam && (
                        <th className="text-left px-4 py-3">
                          <SortButton col="team" current={sortKey} dir={sortDir} onSort={handleSort}>
                            Team
                          </SortButton>
                        </th>
                      )}
                      <th className="text-left px-4 py-3">
                        <SortButton col="checkedInAt" current={sortKey} dir={sortDir} onSort={handleSort}>
                          Check-in Time
                        </SortButton>
                      </th>
                      <th className="text-left px-4 py-3">
                        <SortButton col="method" current={sortKey} dir={sortDir} onSort={handleSort}>
                          Method
                        </SortButton>
                      </th>
                      <th className="text-left px-4 py-3">
                        <SortButton col="paymentStatus" current={sortKey} dir={sortDir} onSort={handleSort}>
                          Payment
                        </SortButton>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.length === 0 ? (
                      <tr>
                        <td colSpan={showTeam ? 5 : 4} className="px-4 py-12 text-center text-muted-foreground">
                          No attendance records found.
                        </td>
                      </tr>
                    ) : sorted.map((a: any, i: number) => {
                      const name = [a.firstName, a.lastName].filter(Boolean).join(" ") || a.email || `User #${a.userId}`;
                      const isVoided = a.voided === true;
                      return (
                        <tr
                          key={`${a.userId}-${i}`}
                          className={`border-b last:border-0 ${
                            isVoided
                              ? "bg-muted/30 opacity-70"
                              : a.checkedIn
                              ? "bg-green-500/5"
                              : a.noShow
                              ? "bg-red-500/5 opacity-70"
                              : ""
                          }`}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {isVoided ? (
                                <Ban className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                              ) : a.checkedIn ? (
                                <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                              ) : (
                                <XCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
                              )}
                              <div>
                                <div className={`font-medium ${isVoided ? "line-through text-muted-foreground" : ""}`}>
                                  {name}
                                </div>
                                {a.email && (
                                  <div className="text-xs text-muted-foreground">{a.email}</div>
                                )}
                                {isVoided && (
                                  <div className="flex items-center gap-1 mt-0.5">
                                    <Badge variant="outline" className="text-xs h-4 text-muted-foreground border-muted-foreground/40">
                                      Voided
                                      {a.voidedByName && ` by ${a.voidedByName}`}
                                      {a.voidedAt && ` · ${format(new Date(a.voidedAt), "h:mm a")}`}
                                    </Badge>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                          {showTeam && (
                            <td className="px-4 py-3">
                              <div className={`text-sm ${isVoided ? "text-muted-foreground" : ""}`}>
                                {a.teamName ?? <span className="text-muted-foreground">—</span>}
                              </div>
                              {a.side && a.side !== "walk-in" && (
                                <div className="text-xs text-muted-foreground capitalize">{a.side}</div>
                              )}
                              {a.side === "walk-in" && (
                                <Badge variant="outline" className="text-xs">Walk-in</Badge>
                              )}
                            </td>
                          )}
                          <td className="px-4 py-3 text-sm">
                            {a.checkedInAt ? (
                              <span className={isVoided ? "text-muted-foreground line-through" : ""}>
                                {format(new Date(a.checkedInAt), "h:mm a")}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {a.checkedIn && !isVoided ? (
                              <Badge variant="outline" className="text-xs">
                                {a.methodLabel ?? a.method ?? "—"}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              variant={(PAYMENT_BADGE[a.paymentStatus] ?? "outline") as any}
                              className={`text-xs ${isVoided ? "opacity-50" : ""}`}
                            >
                              {PAYMENT_LABELS[a.paymentStatus] ?? a.paymentStatus ?? "—"}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    </Layout>
  );
}
